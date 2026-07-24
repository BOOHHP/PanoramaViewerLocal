# 视频与全景视频支持方案

日期：2026-07-24 ｜ 状态：Phase 1、2、3 已实施

## 背景与目标

在现有全景图查看器基础上，新增对普通（平面）视频与 360 全景视频的本地播放支持，交互参考 PotPlayer 的简化子集，保持"轻量本地"定位。

## 技术调研结论

### 播放通道

- 复用现有 `convertFileSrc`（Tauri asset 协议）→ `<video>` 元素。asset 协议支持 HTTP Range 请求，进度条拖动（seek）可用。
- 项目 `assetProtocol.scope` 已为 `**/*`，CSP 为 null，无需配置改动。
- Tauri 官方文档中 `convertFileSrc` 的示例场景即本地视频播放。

### 格式支持层级

| 层级 | 覆盖格式 | 成本 |
|---|---|---|
| A. WebView2 原生（Chromium） | MP4(H.264/AAC)、WebM(VP8/VP9/AV1)、MOV(H.264)、Ogg | 零；覆盖无人机/全景相机主流导出 |
| B. + 系统 HEVC 扩展 | MP4/MOV(H.265) | 用户自装 Microsoft Store「HEVC 视频扩展」；用 `canPlayType`/error 事件检测提示 |
| C. ffmpeg sidecar | MKV(remux)、AVI/WMV/FLV/RMVB(重编码) | 体积 +~25MB，复杂度中（Phase 3 评估） |
| D. libmpv 嵌入内核 | 全格式（PotPlayer 级） | 重量级，与轻量定位冲突，不采用 |

Phase 1/2 采用层级 A + B 检测提示。

### 360 视频渲染

- WebGL `texImage2D` 原生接受 `HTMLVideoElement`，现有 equirectangular shader 无需改动。
- 播放时 `requestAnimationFrame` 每帧上传视频帧为纹理并渲染；暂停/seek 时单帧上传。
- `video.crossOrigin = 'anonymous'`（沿用图片跨源纹理修复经验）。
- 360 识别沿用约 2:1 宽高比 + 手动投影切换（自动/360/平面）。
- 8K(7680px) 在常见 `MAX_TEXTURE_SIZE`(16384) 内；实际流畅度依赖硬件解码，超载时提示（视频无法像图片降采样）。

## 实施方案

### Phase 1 — 平面视频 MVP

1. Rust `file_browser.rs`：
   - 扩展名集合新增 `mp4 / webm / mov / m4v`（`is_video_name` / `is_media_name`）。
   - `list_directory` 条目 `kind` 新增 `"video"`；排序 目录 → 图片 → 视频。
   - `collect_images_from_directory`、无图文件夹淡化扫描按"媒体文件"处理。
   - 单测同步覆盖视频文件。
2. 文件浏览器 / 图库：视频条目专属图标、"视频"类型标签、大小/日期 meta；双击或 Enter 单个打开；网格视图显示视频图标磁贴。
3. 查看器：新增 `<video>` 元素（与平面图共用缩放/拖拽变换）+ 底部播放控制条（播放/暂停、可拖 seek、时间、音量、倍速 0.5–2x），复用邻近渐显。
4. 快捷键：视频激活时 `空格`=播放/暂停、`←/→`=±5s seek、`,`/`.`=上/下一个媒体；图片行为不变。
5. 解码失败提示：error 事件 → 提示安装 HEVC 视频扩展。

### Phase 2 — 360 全景视频

1. 约 2:1 视频自动进入 360 模式：`<video>` 转为隐藏纹理源，canvas 渲染。
2. 播放中 rAF 帧循环上传纹理；暂停/seek 单帧刷新。
3. 拖拽视角、滚轮 FOV、投影切换、居中/全屏全部复用现有逻辑；播放控制条在 360 模式继续可用。

### Phase 3 — ffmpeg 增强（已实施，探测式启用）

设计取跡：**不随安装包分发 ffmpeg**（完整二进制 ≈100MB，与轻量定位冲突）。程序启动后自动探测：

1. 程序目录下的 `ffmpeg.exe` / `ffprobe.exe`；
2. 系统 PATH。

探测到即启用以下能力，否则优雅降级：

- **MKV 播放**：打开 MKV 时后台流复制 remux 为 MP4（`-c copy`，秒级，不重编码），结果缓存；无 ffmpeg 时提示安装方式。含 MP4 不兼容编码时报错。
- **视频缩略图**：图库与网格视图异步生成 320px 抽帧缩略图（串行队列，避免进程风暴）；无 ffmpeg 时回退播放图标。
- **spherical metadata 识别**：打开视频时 ffprobe 检测球面元数据，与宽高比启发式取并集修正投影；无 ffprobe 时保持 2:1 启发式。

缓存位置：`%LOCALAPPDATA%\PanoramaViewerLocal\media-cache`，按 路径+大小+修改时间 哈希命名（remux 为 .mp4，缩略图为 .jpg）。

Rust 命令（src-tauri/src/video_tools.rs，均为 async 命令不阻塞主线程）：

- `video_tools_status` → { ffmpeg, ffprobe }
- `prepare_video(path)` → 原生容器直接返回；MKV 返回缓存 MP4 路径
- `get_video_thumbnail(path)` → 缓存 JPG 路径（-ss 1 失败回退 -ss 0）
- `probe_video(path)` → { spherical }

### 后续可选（未实施）

- 非 remux 可达格式（AVI/WMV/FLV/RMVB）的后台重编码队列。
- 随安装包可选携带 ffmpeg 的安装选项。

## 风险与取舍

- H.265 视频在未安装系统 HEVC 扩展的机器上无法解码（有检测提示兜底）。
- MKV/AVI 等容器 Phase 1/2 不支持（Phase 3 评估）。
- 8K 360 视频性能取决于用户 GPU 硬解能力。
- 视频缩略图 Phase 1/2 以图标代替，不抓帧。
