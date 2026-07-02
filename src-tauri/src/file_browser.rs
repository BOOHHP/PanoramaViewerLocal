use serde::Serialize;
use std::{env, fs, path::PathBuf, time::UNIX_EPOCH};

const MAX_DIRECTORY_ENTRIES: usize = 500;

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
    let entry_path = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();
    let metadata = entry.metadata().ok();
    let is_directory = metadata.as_ref().is_some_and(|item| item.is_dir());
    let is_file = metadata.as_ref().is_some_and(|item| item.is_file());
    let kind = if is_directory {
      "directory"
    } else if is_file && is_image_name(&name) {
      "image"
    } else {
      "other"
    };

    entries.push(BrowserEntry {
      name,
      path: entry_path.to_string_lossy().to_string(),
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
    parent_path: canonical_path.parent().map(|parent| parent.to_string_lossy().to_string()),
    path: canonical_path.to_string_lossy().to_string(),
    entries,
    truncated,
  })
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
  use super::is_image_name;

  #[test]
  fn detects_supported_image_names() {
    assert!(is_image_name("PANO_0001.JPG"));
    assert!(is_image_name("preview.webp"));
    assert!(!is_image_name("notes.txt"));
  }
}