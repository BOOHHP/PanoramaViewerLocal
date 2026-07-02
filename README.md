# Panorama Viewer Local

轻量本地全景图查看器，基于 Vite、TypeScript 和原生 WebGL。它在浏览器本地读取文件夹内的全景图，不上传图像文件，适合快速浏览等距柱状 360 全景图，并为后续封装成本地 exe 保持轻量内核。

## 功能

- 选择本地文件夹并读取多张全景图。
- 在软件内浏览图像列表并自由切换查看。
- 支持窗口查看和全屏查看。
- 鼠标拖拽调整视角，滚轮调整视野范围。
- 自动识别约 2:1 的等距柱状 360 图；其他比例会按平面全景适配显示。
- 支持在自动、360、平面三种投影方式之间手动切换。
- 使用参考项目同款 WebGL shader 采样方式打开 360 全景，并在超出 WebGL 纹理上限时自动降采样。
- 简约专业的本地影像工具界面。

## 图像说明

标准 360 全景图应接近 2:1 宽高比，例如 `14400 x 7200`。DJI 拼接源图（例如 `PANO_0001.JPG`，常见比例不是 2:1）不是最终 360 成品，软件会标记为“源图”并按平面模式显示，避免错误扭曲。

## 开发运行

```bash
npm install
npm run dev
```

浏览器打开终端中显示的本地地址即可使用。目录选择能力在 Chromium/Edge 的本地开发地址下体验最佳；其他浏览器会回退到文件夹输入方式。

## 构建

```bash
npm run build
```

Web 构建产物会输出到 `web-dist` 目录。

## 本地应用程序

当前项目已支持 Neutralino 轻量本地应用打包，不需要 Rust 或 Visual Studio 编译工具链：

```bash
npm run local:build
```

Windows 可执行文件会生成到：

```text
dist/PanoramaViewerLocal/PanoramaViewerLocal-win_x64.exe
```

分发时请把整个 `dist/PanoramaViewerLocal` 文件夹一起交付，因为 exe 需要同目录下的 `resources.neu`。
当前也会额外生成一个便于拷贝的压缩包：

```text
dist/PanoramaViewerLocal-win_x64.zip
```

## 后续封装 exe

当前查看内核不依赖 Three.js 或后端服务，只有 Vite + 原生 WebGL。项目里也保留了 Tauri 配置；如果后续要接入更强的原生文件对话框或系统能力，可以安装 Rust/Cargo 后运行 `npm run desktop:build` 生成 Tauri 安装包。