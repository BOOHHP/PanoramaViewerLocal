use serde::Serialize;
use std::{
  collections::hash_map::DefaultHasher,
  env, fs,
  hash::{Hash, Hasher},
  path::{Path, PathBuf},
  process::Command,
  sync::OnceLock,
  time::UNIX_EPOCH,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static FFMPEG_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
static FFPROBE_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoToolsStatus {
  ffmpeg: bool,
  ffprobe: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProbe {
  spherical: bool,
}

#[tauri::command(async)]
pub fn video_tools_status() -> VideoToolsStatus {
  VideoToolsStatus {
    ffmpeg: resolve_tool("ffmpeg").is_some(),
    ffprobe: resolve_tool("ffprobe").is_some(),
  }
}

#[tauri::command(async)]
pub fn probe_video(path: String) -> Result<VideoProbe, String> {
  let tool = resolve_tool("ffprobe").ok_or("未找到 ffprobe，无法读取视频元数据。")?;
  let output = new_command(&tool)
    .args(["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format"])
    .arg(&path)
    .output()
    .map_err(|error| format!("ffprobe 执行失败：{error}"))?;

  let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
  Ok(VideoProbe {
    spherical: text.contains("spherical"),
  })
}

#[tauri::command(async)]
pub fn prepare_video(path: String) -> Result<String, String> {
  if is_native_video(&path) {
    return Ok(path);
  }

  let tool = resolve_tool("ffmpeg")
    .ok_or("播放该格式需要 ffmpeg：请将 ffmpeg.exe 放到程序目录或加入系统 PATH 后重试。")?;
  let target = cache_file_path(&path, "mp4")?;
  if target.exists() {
    return Ok(target.to_string_lossy().to_string());
  }

  let output = new_command(&tool)
    .args(["-y", "-i"])
    .arg(&path)
    .args(["-c", "copy", "-movflags", "+faststart"])
    .arg(&target)
    .output()
    .map_err(|error| format!("ffmpeg 执行失败：{error}"))?;

  if !output.status.success() {
    let _ = fs::remove_file(&target);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let tail = stderr.lines().rev().take(2).collect::<Vec<_>>().join(" ");
    return Err(format!("视频转换失败（可能包含 MP4 容器不支持的编码）：{tail}"));
  }

  Ok(target.to_string_lossy().to_string())
}

#[tauri::command(async)]
pub fn get_video_thumbnail(path: String) -> Result<String, String> {
  let tool = resolve_tool("ffmpeg").ok_or("未找到 ffmpeg，无法生成视频缩略图。")?;
  let target = cache_file_path(&path, "jpg")?;
  if target.exists() {
    return Ok(target.to_string_lossy().to_string());
  }

  for seek in ["1", "0"] {
    let output = new_command(&tool)
      .args(["-y", "-ss", seek, "-i"])
      .arg(&path)
      .args(["-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5"])
      .arg(&target)
      .output()
      .map_err(|error| format!("ffmpeg 执行失败：{error}"))?;

    let created = output.status.success()
      && fs::metadata(&target).map(|meta| meta.len() > 0).unwrap_or(false);
    if created {
      return Ok(target.to_string_lossy().to_string());
    }
  }

  let _ = fs::remove_file(&target);
  Err("无法生成视频缩略图。".into())
}

fn is_native_video(path: &str) -> bool {
  let extension = Path::new(path)
    .extension()
    .map(|item| item.to_string_lossy().to_ascii_lowercase())
    .unwrap_or_default();
  matches!(extension.as_str(), "mp4" | "webm" | "mov" | "m4v")
}

fn resolve_tool(name: &str) -> Option<PathBuf> {
  let cache = if name == "ffmpeg" { &FFMPEG_PATH } else { &FFPROBE_PATH };
  cache.get_or_init(|| find_tool(name)).clone()
}

fn find_tool(name: &str) -> Option<PathBuf> {
  let mut candidates = Vec::new();
  if let Ok(exe) = env::current_exe() {
    if let Some(dir) = exe.parent() {
      candidates.push(dir.join(format!("{name}.exe")));
    }
  }
  candidates.push(PathBuf::from(format!("{name}.exe")));

  for candidate in candidates {
    let mut command = Command::new(&candidate);
    apply_flags(&mut command);
    let works = command
      .arg("-version")
      .output()
      .map(|output| output.status.success())
      .unwrap_or(false);
    if works {
      return Some(candidate);
    }
  }

  None
}

fn new_command(tool: &Path) -> Command {
  let mut command = Command::new(tool);
  apply_flags(&mut command);
  command
}

#[cfg_attr(not(windows), allow(unused_variables))]
fn apply_flags(command: &mut Command) {
  #[cfg(windows)]
  command.creation_flags(CREATE_NO_WINDOW);
}

fn cache_file_path(source: &str, extension: &str) -> Result<PathBuf, String> {
  let metadata = fs::metadata(source).map_err(|error| format!("无法读取源文件：{error}"))?;
  let mut hasher = DefaultHasher::new();
  source.hash(&mut hasher);
  metadata.len().hash(&mut hasher);
  if let Ok(modified) = metadata.modified() {
    if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
      duration.as_millis().hash(&mut hasher);
    }
  }
  let digest = hasher.finish();

  let base = env::var_os("LOCALAPPDATA")
    .map(PathBuf::from)
    .unwrap_or_else(env::temp_dir)
    .join("PanoramaViewerLocal")
    .join("media-cache");
  fs::create_dir_all(&base).map_err(|error| format!("无法创建缓存目录：{error}"))?;
  Ok(base.join(format!("{digest:016x}.{extension}")))
}

#[cfg(test)]
mod tests {
  use super::is_native_video;

  #[test]
  fn detects_native_video_extensions() {
    assert!(is_native_video("clip.MP4"));
    assert!(is_native_video("clip.webm"));
    assert!(!is_native_video("movie.mkv"));
    assert!(!is_native_video("notes.txt"));
  }
}
