use serde::Serialize;
use std::{env, fs, path::{Path, PathBuf}, time::UNIX_EPOCH};

const MAX_DIRECTORY_ENTRIES: usize = 500;
const MAX_COLLECTED_IMAGES: usize = 5000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserRoot {
  name: String,
  path: String,
  kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEntry {
  name: String,
  path: String,
  kind: String,
  size: Option<u64>,
  modified_at: Option<u128>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
  path: String,
  parent_path: Option<String>,
  entries: Vec<BrowserEntry>,
  truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImage {
  name: String,
  path: String,
  size: u64,
  modified_at: Option<u128>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalImageCollection {
  directory: String,
  images: Vec<LocalImage>,
  truncated: bool,
}

#[tauri::command]
pub fn list_roots() -> Vec<BrowserRoot> {
  let mut roots = Vec::new();

  if let Some(user_profile) = env::var_os("USERPROFILE").map(PathBuf::from) {
    push_known_folder(&mut roots, "桌面", user_profile.join("Desktop"));
    push_known_folder(&mut roots, "下载", user_profile.join("Downloads"));
    push_known_folder(&mut roots, "文档", user_profile.join("Documents"));
    push_known_folder(&mut roots, "图片", user_profile.join("Pictures"));
  }

  for letter in b'A'..=b'Z' {
    let path = format!("{}:\\", letter as char);
    if PathBuf::from(&path).exists() {
      roots.push(BrowserRoot {
        name: path.clone(),
        path,
        kind: "drive".into(),
      });
    }
  }

  roots
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<DirectoryListing, String> {
  let requested_path = PathBuf::from(path);
  let canonical_path = requested_path
    .canonicalize()
    .map_err(|error| format!("无法访问该路径：{}", error))?;

  if !canonical_path.is_dir() {
    return Err("该路径不是文件夹。".into());
  }

  let mut entries = Vec::new();
  let mut truncated = false;
  let read_dir = fs::read_dir(&canonical_path).map_err(|error| format!("无法读取文件夹：{}", error))?;

  for entry_result in read_dir {
    if entries.len() >= MAX_DIRECTORY_ENTRIES {
      truncated = true;
      break;
    }

    let Ok(entry) = entry_result else {
      continue;
    };
    let name = entry.file_name().to_string_lossy().to_string();
    let entry_path = entry.path();
    let file_type = entry.file_type().ok();
    let is_directory = file_type.as_ref().is_some_and(|item| item.is_dir());
    let is_file = file_type.as_ref().is_some_and(|item| item.is_file());

    if !is_directory && !(is_file && is_image_name(&name)) {
      continue;
    }

    let kind = if is_directory {
      "directory"
    } else if is_file {
      "image"
    } else {
      "other"
    };
    let metadata = if is_file {
      entry.metadata().ok()
    } else {
      entry_path.symlink_metadata().ok()
    };

    entries.push(BrowserEntry {
      name,
      path: display_path(&entry_path),
      kind: kind.into(),
      size: metadata.as_ref().filter(|item| item.is_file()).map(|item| item.len()),
      modified_at: metadata
        .and_then(|item| item.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis()),
    });
  }

  entries.sort_by(|left, right| {
    entry_rank(&left.kind)
      .cmp(&entry_rank(&right.kind))
      .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
  });

  Ok(DirectoryListing {
    parent_path: canonical_path.parent().map(display_path),
    path: display_path(&canonical_path),
    entries,
    truncated,
  })
}

fn display_path(path: &Path) -> String {
  let text = path.to_string_lossy();
  if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
    format!(r"\\{}", stripped)
  } else if let Some(stripped) = text.strip_prefix(r"\\?\") {
    stripped.to_string()
  } else {
    text.to_string()
  }
}

#[tauri::command]
pub fn filter_folders_with_images(paths: Vec<String>) -> Vec<String> {
  paths
    .into_iter()
    .filter(|path| directory_contains_image_shallow(Path::new(path), 4))
    .collect()
}

fn directory_contains_image_shallow(directory: &Path, max_depth: usize) -> bool {
  if max_depth == 0 {
    return false;
  }

  let Ok(read_dir) = fs::read_dir(directory) else {
    return false;
  };

  for entry in read_dir.take(120).flatten() {
    let Ok(file_type) = entry.file_type() else {
      continue;
    };

    if file_type.is_file() && is_image_name(&entry.file_name().to_string_lossy()) {
      return true;
    }

    if file_type.is_dir() && directory_contains_image_shallow(&entry.path(), max_depth - 1) {
      return true;
    }
  }

  false
}

fn push_known_folder(roots: &mut Vec<BrowserRoot>, name: &str, path: PathBuf) {
  if path.is_dir() {
    roots.push(BrowserRoot {
      name: name.into(),
      path: path.to_string_lossy().to_string(),
      kind: "quickAccess".into(),
    });
  }
}

fn entry_rank(kind: &str) -> u8 {
  match kind {
    "directory" => 0,
    "image" => 1,
    _ => 2,
  }
}

fn is_image_name(name: &str) -> bool {
  let Some(extension) = name.rsplit('.').next() else {
    return false;
  };

  matches!(
    extension.to_ascii_lowercase().as_str(),
    "jpg" | "jpeg" | "png" | "webp" | "avif" | "bmp"
  )
}

#[cfg(test)]
mod tests {
  use super::{collect_images_from_directory, filter_folders_with_images, is_image_name, list_directory};
  use std::{fs, time::{SystemTime, UNIX_EPOCH}};

  #[test]
  fn detects_supported_image_names() {
    assert!(is_image_name("PANO_0001.JPG"));
    assert!(is_image_name("preview.webp"));
    assert!(!is_image_name("notes.txt"));
  }

  #[test]
  fn collects_images_recursively() {
    let unique = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_nanos();
    let root = std::env::temp_dir().join(format!("panorama-viewer-test-{unique}"));
    let nested = root.join("nested");
    fs::create_dir_all(&nested).unwrap();
    fs::write(root.join("root.JPG"), b"root").unwrap();
    fs::write(nested.join("child.webp"), b"child").unwrap();
    fs::write(nested.join("notes.txt"), b"notes").unwrap();

    let collection = collect_images_from_directory(root.to_string_lossy().to_string()).unwrap();
    let names: Vec<String> = collection.images.into_iter().map(|image| image.name).collect();

    assert_eq!(names.len(), 2);
    assert!(names.contains(&"root.JPG".to_string()));
    assert!(names.contains(&"child.webp".to_string()));

    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn lists_images_and_all_folders_without_deep_scan() {
    let unique = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_nanos();
    let root = std::env::temp_dir().join(format!("panorama-viewer-list-test-{unique}"));
    let image_folder = root.join("image-folder");
    let empty_folder = root.join("empty-folder");
    fs::create_dir_all(&image_folder).unwrap();
    fs::create_dir_all(&empty_folder).unwrap();
    fs::write(root.join("root.png"), b"root").unwrap();
    fs::write(root.join("notes.txt"), b"notes").unwrap();
    fs::write(image_folder.join("child.jpg"), b"child").unwrap();

    let listing = list_directory(root.to_string_lossy().to_string()).unwrap();
    assert!(!listing.path.starts_with(r"\\?\"));
    let names: Vec<String> = listing.entries.into_iter().map(|entry| entry.name).collect();

    assert!(names.contains(&"root.png".to_string()));
    assert!(names.contains(&"image-folder".to_string()));
    assert!(names.contains(&"empty-folder".to_string()));
    assert!(!names.contains(&"notes.txt".to_string()));

    let with_images = filter_folders_with_images(vec![
      image_folder.to_string_lossy().to_string(),
      empty_folder.to_string_lossy().to_string(),
    ]);
    assert_eq!(with_images.len(), 1);
    assert!(with_images[0].ends_with("image-folder"));

    fs::remove_dir_all(root).unwrap();
  }
}

#[tauri::command]
pub fn collect_images_from_directory(path: String) -> Result<LocalImageCollection, String> {
  let requested_path = PathBuf::from(path);
  let canonical_path = requested_path
    .canonicalize()
    .map_err(|error| format!("无法访问该路径：{}", error))?;

  if !canonical_path.is_dir() {
    return Err("该路径不是文件夹。".into());
  }

  let mut images = Vec::new();
  let mut truncated = false;
  collect_images_recursive(&canonical_path, &mut images, &mut truncated)?;
  images.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));

  Ok(LocalImageCollection {
    directory: display_path(&canonical_path),
    images,
    truncated,
  })
}

fn collect_images_recursive(
  directory: &PathBuf,
  images: &mut Vec<LocalImage>,
  truncated: &mut bool,
) -> Result<(), String> {
  if images.len() >= MAX_COLLECTED_IMAGES {
    *truncated = true;
    return Ok(());
  }

  let read_dir = fs::read_dir(directory).map_err(|error| format!("无法读取文件夹：{}", error))?;

  for entry_result in read_dir {
    if images.len() >= MAX_COLLECTED_IMAGES {
      *truncated = true;
      break;
    }

    let Ok(entry) = entry_result else {
      continue;
    };
    let entry_path = entry.path();
    let Ok(metadata) = entry.metadata() else {
      continue;
    };

    if metadata.is_dir() {
      let _ = collect_images_recursive(&entry_path, images, truncated);
    } else if metadata.is_file() {
      let name = entry.file_name().to_string_lossy().to_string();
      if is_image_name(&name) {
        images.push(LocalImage {
          name,
          path: display_path(&entry_path),
          size: metadata.len(),
          modified_at: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis()),
        });
      }
    }
  }

  Ok(())
}
