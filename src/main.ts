import './style.css'

type DirectoryHandle = {
  kind: 'directory'
  name: string
  values: () => AsyncIterable<FileHandle | DirectoryHandle>
}

type FileHandle = {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
}

type ProjectionMode = 'sphere' | 'flat'
type ProjectionChoice = 'auto' | ProjectionMode

type PanoramaImage = {
  id: string
  name: string
  url: string
  size: number
  modifiedAt: number
  width: number
  height: number
  kind: ProjectionMode
}

type BrowserRoot = {
  name: string
  path: string
  kind: 'quickAccess' | 'drive'
}

type BrowserEntry = {
  name: string
  path: string
  kind: 'directory' | 'image' | 'other'
  size?: number
  modifiedAt?: number
}

type DirectoryListing = {
  path: string
  parentPath?: string
  entries: BrowserEntry[]
  truncated: boolean
}

type LocalImage = {
  name: string
  path: string
  size: number
  modifiedAt?: number
}

type LocalImageCollection = {
  directory: string
  images: LocalImage[]
  truncated: boolean
}

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
    showDirectoryPicker?: () => Promise<DirectoryHandle>
  }
}

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp'])
const app = document.querySelector<HTMLDivElement>('#app')!
const appVersion = '0.1.1'
const initialFov = 75

app.innerHTML = `
  <div class="app-shell">
    <aside class="library-panel" aria-label="全景图库">
      <header class="brand-block">
        <div class="brand-mark" aria-hidden="true"></div>
        <div>
          <p class="eyebrow">Local 360 Studio · v${appVersion}</p>
          <h1>Panorama Viewer</h1>
        </div>
        <button class="folder-icon-button library-toggle-button" id="libraryToggleButton" type="button" aria-label="收起图库">‹</button>
      </header>

      <div class="library-meta">
        <span id="imageCount">0 张图像</span>
        <button class="clear-inline-button" id="clearButton" type="button" disabled>清空</button>
      </div>

      <input id="folderInput" type="file" accept="image/*" multiple hidden />

      <div class="library-scroll">
        <div class="image-list" id="imageList" aria-label="可查看的全景图"></div>
      </div>
    </aside>

    <main class="viewer-shell" id="viewerShell">
      <div class="viewer-surface" id="viewerSurface" aria-label="全景图查看区域">
        <canvas id="panoCanvas"></canvas>
        <img class="flat-image" id="flatImage" alt="" hidden draggable="false" />
        <button class="nav-button nav-button-previous" id="previousImageButton" type="button" aria-label="上一张图像" title="上一张" disabled>‹</button>
        <button class="nav-button nav-button-next" id="nextImageButton" type="button" aria-label="下一张图像" title="下一张" disabled>›</button>
        <div class="viewer-message" id="viewerMessage" hidden></div>
        <div class="empty-state" id="emptyState">
          <p class="empty-title">选择本地全景图库</p>
        </div>
      </div>

      <div class="viewer-toolbar" aria-label="查看器控制">
        <button class="tool-button" id="resetViewButton" type="button" disabled>居中</button>
        <button class="tool-button projection-tool" id="projectionButton" type="button" disabled>投影 自动</button>
        <button class="tool-button" id="fullscreenButton" type="button" disabled>全屏</button>
      </div>

      <div class="status-strip">
        <span id="fileDetails">等待图像</span>
        <span id="viewDetails">FOV 75</span>
      </div>
    </main>

    <div class="library-resizer" id="libraryResizer" role="separator" aria-orientation="vertical" aria-label="调整图库宽度"></div>
    <div class="folder-browser-resizer" id="folderBrowserResizer" role="separator" aria-orientation="horizontal" aria-label="调整文件浏览器高度"></div>

    <div class="folder-browser-overlay" id="folderBrowserOverlay">
      <section class="folder-browser" role="region" aria-labelledby="folderBrowserTitle">
        <header class="folder-browser-header">
          <div>
            <p class="eyebrow">Local folders</p>
            <h2 id="folderBrowserTitle">选择图像文件夹</h2>
          </div>
        </header>

        <div class="folder-browser-pathbar">
          <button class="folder-icon-button" id="folderBrowserBackButton" type="button" aria-label="后退" title="后退" disabled>‹</button>
          <button class="folder-icon-button" id="folderBrowserForwardButton" type="button" aria-label="前进" title="前进" disabled>›</button>
          <button class="folder-icon-button" id="folderBrowserUpButton" type="button" aria-label="上一级" disabled>↑</button>
          <button class="sort-button" id="folderBrowserSortButton" type="button" title="切换排序方式">名称</button>
          <button class="sort-button" id="folderBrowserViewButton" type="button" title="切换视图">列表</button>
          <input class="grid-size-slider" id="gridSizeSlider" type="range" min="96" max="220" step="4" title="缩略图大小" hidden />
          <input class="folder-path-input" id="folderBrowserPathInput" type="text" spellcheck="false" autocomplete="off" list="folderPathSuggestions" placeholder="输入或粘贴文件夹路径后回车，点击查看历史" />
          <datalist id="folderPathSuggestions"></datalist>
          <button class="folder-icon-button" id="folderBrowserGoButton" type="button" aria-label="打开路径">↵</button>
          <div class="history-menu" id="browserHistoryMenu" hidden></div>
        </div>

        <div class="folder-browser-body">
          <nav class="folder-browser-roots" id="folderBrowserRoots" aria-label="快速访问和磁盘"></nav>
          <div class="folder-browser-main">
            <div class="folder-browser-message" id="folderBrowserMessage" aria-live="polite">正在准备文件夹浏览器...</div>
            <div class="folder-browser-list" id="folderBrowserList" role="listbox" aria-label="当前目录内容"></div>
          </div>
        </div>

        <footer class="folder-browser-footer">
          <span id="folderBrowserSummary">本阶段仅验证内置目录浏览，下一步接入图库加载。</span>
          <div class="folder-browser-footer-actions">
            <button class="ghost-action" id="folderBrowserSystemButton" type="button">系统选择</button>
            <button class="primary-action" id="folderBrowserUseButton" type="button" disabled>使用此文件夹</button>
          </div>
        </footer>
      </section>
    </div>
  </div>
`

const appShell = document.querySelector<HTMLDivElement>('.app-shell')!
const libraryToggleButton = document.querySelector<HTMLButtonElement>('#libraryToggleButton')!
const libraryResizer = document.querySelector<HTMLDivElement>('#libraryResizer')!
const folderBrowserResizer = document.querySelector<HTMLDivElement>('#folderBrowserResizer')!
const clearButton = document.querySelector<HTMLButtonElement>('#clearButton')!
const resetViewButton = document.querySelector<HTMLButtonElement>('#resetViewButton')!
const projectionButton = document.querySelector<HTMLButtonElement>('#projectionButton')!
const fullscreenButton = document.querySelector<HTMLButtonElement>('#fullscreenButton')!
const previousImageButton = document.querySelector<HTMLButtonElement>('#previousImageButton')!
const nextImageButton = document.querySelector<HTMLButtonElement>('#nextImageButton')!
const folderInput = document.querySelector<HTMLInputElement>('#folderInput')!
const imageList = document.querySelector<HTMLDivElement>('#imageList')!
const imageCount = document.querySelector<HTMLSpanElement>('#imageCount')!
const fileDetails = document.querySelector<HTMLSpanElement>('#fileDetails')!
const viewDetails = document.querySelector<HTMLSpanElement>('#viewDetails')!
const viewerShell = document.querySelector<HTMLElement>('#viewerShell')!
const viewerSurface = document.querySelector<HTMLDivElement>('#viewerSurface')!
const emptyState = document.querySelector<HTMLDivElement>('#emptyState')!
const viewerMessage = document.querySelector<HTMLDivElement>('#viewerMessage')!
const panoCanvas = document.querySelector<HTMLCanvasElement>('#panoCanvas')!
const flatImage = document.querySelector<HTMLImageElement>('#flatImage')!
const folderBrowserBackButton = document.querySelector<HTMLButtonElement>('#folderBrowserBackButton')!
const folderBrowserForwardButton = document.querySelector<HTMLButtonElement>('#folderBrowserForwardButton')!
const folderBrowserUpButton = document.querySelector<HTMLButtonElement>('#folderBrowserUpButton')!
const folderBrowserSortButton = document.querySelector<HTMLButtonElement>('#folderBrowserSortButton')!
const folderBrowserViewButton = document.querySelector<HTMLButtonElement>('#folderBrowserViewButton')!
const gridSizeSlider = document.querySelector<HTMLInputElement>('#gridSizeSlider')!
const folderBrowserSystemButton = document.querySelector<HTMLButtonElement>('#folderBrowserSystemButton')!
const folderBrowserUseButton = document.querySelector<HTMLButtonElement>('#folderBrowserUseButton')!
const folderBrowserGoButton = document.querySelector<HTMLButtonElement>('#folderBrowserGoButton')!
const folderBrowserRoots = document.querySelector<HTMLElement>('#folderBrowserRoots')!
const folderBrowserList = document.querySelector<HTMLDivElement>('#folderBrowserList')!
const folderBrowserPathInput = document.querySelector<HTMLInputElement>('#folderBrowserPathInput')!
const folderBrowserMessage = document.querySelector<HTMLDivElement>('#folderBrowserMessage')!
const folderBrowserSummary = document.querySelector<HTMLSpanElement>('#folderBrowserSummary')!
const folderPathSuggestions = document.querySelector<HTMLDataListElement>('#folderPathSuggestions')!
const browserHistoryMenu = document.querySelector<HTMLDivElement>('#browserHistoryMenu')!

folderInput.setAttribute('webkitdirectory', '')

let images: PanoramaImage[] = []
let activeImageId = ''
let activeMode: ProjectionMode = 'sphere'
let projectionChoice: ProjectionChoice = 'auto'
let yaw = 0
let pitch = 0
let fov = initialFov
let flatScale = 1
let flatX = 0
let flatY = 0
let pointerStartX = 0
let pointerStartY = 0
let startYaw = 0
let startPitch = 0
let startFlatX = 0
let startFlatY = 0
let isDragging = false
let gl: WebGLRenderingContext | null = null
let panoProgram: WebGLProgram | null = null
let panoBuffer: WebGLBuffer | null = null
let panoTexture: WebGLTexture | null = null
let panoMaxTextureSize = 4096
let panoTextureReady = false
let panoLoadTicket = 0
let browserRoots: BrowserRoot[] = []
let browserEntries: BrowserEntry[] = []
let browserCurrentPath = ''
let browserParentPath = ''
let browserSelectedPath = ''
let browserTruncated = false
let browserError = ''
let browserLoading = false
let browserLoadTicket = 0
let libraryCollapsed = false
let savedLibraryWidth = ''
let activeResize: 'library' | 'browser' | '' = ''
let browserHistory: string[] = []
let browserHistoryIndex = -1
let browserImagelessFolders = new Set<string>()
let browserSortMode: 'name' | 'date' | 'size' = readStoredChoice('browserSortMode', ['name', 'date', 'size'], 'name')
let browserViewMode: 'list' | 'grid' = readStoredChoice('browserViewMode', ['list', 'grid'], 'list')
let gridTileSize = clamp(Number(localStorage.getItem('browserGridSize')) || 132, 96, 220)
let convertSrc: ((path: string) => string) | null = null
let pathSuggestTicket = 0
let pathSuggestTimer = 0

clearButton.addEventListener('click', clearImages)
libraryToggleButton.addEventListener('click', toggleLibraryPanel)
libraryResizer.addEventListener('pointerdown', (event) => startLayoutResize(event, 'library'))
folderBrowserResizer.addEventListener('pointerdown', (event) => startLayoutResize(event, 'browser'))
resetViewButton.addEventListener('click', resetView)
projectionButton.addEventListener('click', cycleProjection)
fullscreenButton.addEventListener('click', () => void toggleFullscreen())
previousImageButton.addEventListener('pointerdown', (event) => event.stopPropagation())
previousImageButton.addEventListener('click', () => showAdjacentImage(-1))
nextImageButton.addEventListener('pointerdown', (event) => event.stopPropagation())
nextImageButton.addEventListener('click', () => showAdjacentImage(1))
folderInput.addEventListener('change', () => void loadFiles(Array.from(folderInput.files ?? [])))
document.addEventListener('keydown', handleKeyboardNavigation)
document.addEventListener('fullscreenchange', updateFullscreenLabel)
window.addEventListener('resize', resizeViewer)
folderBrowserBackButton.addEventListener('click', () => void goBrowserHistory(-1))
folderBrowserForwardButton.addEventListener('click', () => void goBrowserHistory(1))
folderBrowserUpButton.addEventListener('click', () => void enterBrowserDirectory(browserParentPath))
folderBrowserSortButton.addEventListener('click', cycleBrowserSortMode)
folderBrowserViewButton.addEventListener('click', toggleBrowserViewMode)
gridSizeSlider.addEventListener('input', () => {
  gridTileSize = clamp(Number(gridSizeSlider.value) || 132, 96, 220)
  localStorage.setItem('browserGridSize', String(gridTileSize))
  applyGridTileSize()
})
folderBrowserSystemButton.addEventListener('click', () => {
  void pickSystemFolder()
})
folderBrowserUseButton.addEventListener('click', () => void useBrowserCurrentFolder())
folderBrowserGoButton.addEventListener('click', () => void enterBrowserDirectory(folderBrowserPathInput.value.trim()))
folderBrowserPathInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault()
    void enterBrowserDirectory(folderBrowserPathInput.value.trim())
  }
})
folderBrowserPathInput.addEventListener('input', () => {
  hideBrowserHistoryMenu()
  window.clearTimeout(pathSuggestTimer)
  pathSuggestTimer = window.setTimeout(() => void updatePathSuggestions(), 200)
})
folderBrowserPathInput.addEventListener('focus', showBrowserHistoryMenu)
folderBrowserPathInput.addEventListener('click', showBrowserHistoryMenu)
document.addEventListener('pointerdown', (event) => {
  const target = event.target as Node
  if (!browserHistoryMenu.hidden && !browserHistoryMenu.contains(target) && target !== folderBrowserPathInput) {
    hideBrowserHistoryMenu()
  }
})
document.addEventListener('pointermove', resizeLayout)
document.addEventListener('pointerup', stopLayoutResize)

void checkForAppUpdates()
restoreBrowserHistory()
applyGridTileSize()
gridSizeSlider.value = String(gridTileSize)
void (async () => {
  await initializeFolderBrowser()
  const lastPath = browserHistory[browserHistoryIndex]
  if (lastPath) {
    await enterBrowserDirectory(lastPath, undefined, true)
  }
})()

viewerSurface.addEventListener('pointerdown', (event) => {
  if (!activeImageId || event.button !== 0) {
    return
  }

  isDragging = true
  pointerStartX = event.clientX
  pointerStartY = event.clientY
  startYaw = yaw
  startPitch = pitch
  startFlatX = flatX
  startFlatY = flatY
  viewerSurface.setPointerCapture(event.pointerId)
  viewerSurface.classList.add('is-dragging')
  clearNavigationProximity()
})

viewerSurface.addEventListener('pointermove', (event) => {
  updateNavigationProximity(event)

  if (!isDragging) {
    return
  }

  if (activeMode === 'sphere') {
    yaw = startYaw - (event.clientX - pointerStartX) * 0.005
    pitch = clamp(startPitch - (event.clientY - pointerStartY) * 0.005, -1.45, 1.45)
    renderPano()
  } else if (flatScale > 1) {
    flatX = startFlatX + event.clientX - pointerStartX
    flatY = startFlatY + event.clientY - pointerStartY
    applyFlatTransform()
  }
})

viewerSurface.addEventListener('pointerup', releasePointer)
viewerSurface.addEventListener('pointercancel', releasePointer)
viewerSurface.addEventListener('pointerleave', clearNavigationProximity)
viewerSurface.addEventListener('dragstart', (event) => event.preventDefault())
viewerSurface.addEventListener('wheel', (event) => {
  if (!activeImageId) {
    return
  }

  event.preventDefault()
  if (activeMode === 'sphere') {
    fov = clamp(fov + (event.deltaY > 0 ? 4 : -4), 35, 100)
    renderPano()
  } else {
    flatScale = clamp(flatScale + (event.deltaY < 0 ? 0.15 : -0.15), 1, 8)
    if (flatScale === 1) {
      flatX = 0
      flatY = 0
    }
    applyFlatTransform()
  }
  updateStatus()
}, { passive: false })

resizeViewer()

async function pickSystemFolder() {
  if (window.showDirectoryPicker) {
    try {
      const directory = await window.showDirectoryPicker()
      const files = await collectImages(directory)
      await loadFiles(files)
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }
    }
  }

  folderInput.value = ''
  folderInput.click()
}

async function getTauriInvoke() {
  if (!window.__TAURI_INTERNALS__) {
    return null
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke as TauriInvoke
  } catch (error) {
    console.error('Failed to load Tauri invoke API:', error)
    return null
  }
}

async function initializeFolderBrowser(providedInvoke?: TauriInvoke) {
  const invoke = providedInvoke ?? await getTauriInvoke()
  if (!invoke) {
    browserError = '内置文件浏览器仅在桌面版中可用，可使用系统选择。'
    renderFolderBrowser()
    return
  }

  browserError = ''
  browserSelectedPath = ''
  renderFolderBrowser()

  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    convertSrc = convertFileSrc
  } catch {
    convertSrc = null
  }

  try {
    browserLoading = true
    renderFolderBrowser()
    browserRoots = await invoke<BrowserRoot[]>('list_roots')
    if (browserRoots.length === 0) {
      browserLoading = false
      browserError = '没有找到可浏览的本地目录。'
    }
  } catch (error) {
    browserError = String(error)
  } finally {
    browserLoading = false
    renderFolderBrowser()
  }
}

async function useBrowserCurrentFolder() {
  if (!browserCurrentPath || browserLoading) {
    return
  }

  const invoke = await getTauriInvoke()
  if (!invoke) {
    browserError = '当前环境不支持内置文件夹浏览。'
    renderFolderBrowser()
    return
  }

  try {
    browserLoading = true
    browserError = ''
    renderFolderBrowser()
    const collection = await invoke<LocalImageCollection>('collect_images_from_directory', { path: browserCurrentPath })
    await loadLocalImages(collection)
  } catch (error) {
    browserLoading = false
    browserError = String(error)
    renderFolderBrowser()
  }
}

async function enterBrowserDirectory(path: string, providedInvoke?: TauriInvoke, fromHistory = false) {
  if (!path) {
    return
  }

  hideBrowserHistoryMenu()
  const invoke = providedInvoke ?? await getTauriInvoke()
  if (!invoke) {
    return
  }

  const ticket = ++browserLoadTicket
  browserLoading = true
  browserError = ''
  browserSelectedPath = path
  renderFolderBrowser()

  try {
    const listing = await invoke<DirectoryListing>('list_directory', { path })
    if (ticket !== browserLoadTicket) {
      return
    }

    browserCurrentPath = listing.path
    browserParentPath = listing.parentPath ?? ''
    browserEntries = listing.entries
    sortBrowserEntries()
    browserSelectedPath = listing.path
    browserTruncated = listing.truncated
    browserImagelessFolders = new Set()
    void markFoldersWithImages(listing.path, invoke)

    if (!fromHistory && browserHistory[browserHistoryIndex] !== listing.path) {
      browserHistory = browserHistory.slice(0, browserHistoryIndex + 1)
      browserHistory.push(listing.path)
      browserHistoryIndex = browserHistory.length - 1
    }
    persistBrowserHistory()
  } catch (error) {
    if (ticket !== browserLoadTicket) {
      return
    }

    browserError = String(error)
  } finally {
    if (ticket === browserLoadTicket) {
      browserLoading = false
      renderFolderBrowser()
    }
  }
}

async function goBrowserHistory(direction: -1 | 1) {
  const nextIndex = browserHistoryIndex + direction
  const nextPath = browserHistory[nextIndex]
  if (!nextPath) {
    return
  }

  browserHistoryIndex = nextIndex
  await enterBrowserDirectory(nextPath, undefined, true)
}

function readStoredChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const stored = localStorage.getItem(key)
  return allowed.includes(stored as T) ? stored as T : fallback
}

function cycleBrowserSortMode() {
  browserSortMode = browserSortMode === 'name' ? 'date' : browserSortMode === 'date' ? 'size' : 'name'
  localStorage.setItem('browserSortMode', browserSortMode)
  sortBrowserEntries()
  renderFolderBrowser()
}

function toggleBrowserViewMode() {
  browserViewMode = browserViewMode === 'list' ? 'grid' : 'list'
  localStorage.setItem('browserViewMode', browserViewMode)
  renderFolderBrowser()
}

function applyGridTileSize() {
  folderBrowserList.style.setProperty('--grid-tile', `${gridTileSize}px`)
}

function persistBrowserHistory() {
  const maxEntries = 30
  const start = Math.max(0, browserHistory.length - maxEntries)
  const paths = browserHistory.slice(start)
  const index = clamp(browserHistoryIndex - start, 0, paths.length - 1)
  localStorage.setItem('browserHistory', JSON.stringify({ paths, index }))
}

function restoreBrowserHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem('browserHistory') ?? 'null') as { paths?: unknown, index?: unknown } | null
    if (!stored || !Array.isArray(stored.paths)) {
      return
    }

    const paths = stored.paths.filter((item): item is string => typeof item === 'string' && item.length > 0)
    if (paths.length === 0) {
      return
    }

    browserHistory = paths
    browserHistoryIndex = clamp(typeof stored.index === 'number' ? stored.index : paths.length - 1, 0, paths.length - 1)
  } catch {
    // 存储损坏时忽略，从空历史开始
  }
}

function sortBrowserEntries() {
  const rank = (kind: BrowserEntry['kind']) => kind === 'directory' ? 0 : kind === 'image' ? 1 : 2
  browserEntries.sort((left, right) => {
    const rankDiff = rank(left.kind) - rank(right.kind)
    if (rankDiff !== 0) {
      return rankDiff
    }

    if (browserSortMode === 'date') {
      return (right.modifiedAt ?? 0) - (left.modifiedAt ?? 0)
    }

    if (browserSortMode === 'size' && left.kind === 'image') {
      return (right.size ?? 0) - (left.size ?? 0)
    }

    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

async function markFoldersWithImages(listingPath: string, invoke: TauriInvoke) {
  const folderPaths = browserEntries.filter((entry) => entry.kind === 'directory').map((entry) => entry.path)
  if (folderPaths.length === 0) {
    return
  }

  try {
    const withImages = await invoke<string[]>('filter_folders_with_images', { paths: folderPaths })
    if (browserCurrentPath !== listingPath) {
      return
    }

    const withImagesSet = new Set(withImages)
    browserImagelessFolders = new Set(folderPaths.filter((path) => !withImagesSet.has(path)))
    for (const button of folderBrowserList.querySelectorAll<HTMLButtonElement>('.folder-entry-button[data-kind="directory"]')) {
      button.dataset.dim = String(browserImagelessFolders.has(button.dataset.path ?? ''))
    }
  } catch {
    // 后台标记失败不影响浏览
  }
}

async function updatePathSuggestions() {
  const invoke = await getTauriInvoke()
  if (!invoke) {
    return
  }

  const raw = folderBrowserPathInput.value
  const separatorIndex = Math.max(raw.lastIndexOf('\\'), raw.lastIndexOf('/'))
  if (separatorIndex < 2) {
    folderPathSuggestions.replaceChildren()
    return
  }

  const parent = raw.slice(0, separatorIndex + 1)
  const fragment = raw.slice(separatorIndex + 1).toLowerCase()
  const ticket = ++pathSuggestTicket

  try {
    const listing = await invoke<DirectoryListing>('list_directory', { path: parent })
    if (ticket !== pathSuggestTicket) {
      return
    }

    const options = listing.entries
      .filter((entry) => entry.kind === 'directory' && entry.name.toLowerCase().startsWith(fragment))
      .slice(0, 12)
      .map((entry) => {
        const option = document.createElement('option')
        option.value = entry.path
        return option
      })
    folderPathSuggestions.replaceChildren(...options)
  } catch {
    // 输入中的路径可能不完整，忽略
  }
}

function formatHistoryPath(path: string) {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 4) {
    return path
  }

  return `${parts[0]}\\${parts[1]}\\...\\${parts[parts.length - 2]}\\${parts[parts.length - 1]}`
}

function showBrowserHistoryMenu() {
  if (browserHistory.length <= 1) {
    return
  }

  browserHistoryMenu.style.left = `${folderBrowserPathInput.offsetLeft}px`
  browserHistoryMenu.style.width = `${folderBrowserPathInput.offsetWidth}px`
  browserHistoryMenu.replaceChildren()
  for (let index = browserHistory.length - 1; index >= 0; index -= 1) {
    const path = browserHistory[index]
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'history-menu-item'
    item.dataset.current = String(index === browserHistoryIndex)
    item.textContent = formatHistoryPath(path)
    item.title = path
    item.addEventListener('click', () => {
      hideBrowserHistoryMenu()
      if (index !== browserHistoryIndex) {
        browserHistoryIndex = index
        void enterBrowserDirectory(path, undefined, true)
      }
    })
    browserHistoryMenu.append(item)
  }

  const clearItem = document.createElement('button')
  clearItem.type = 'button'
  clearItem.className = 'history-menu-item history-menu-clear'
  clearItem.textContent = '清空历史'
  clearItem.addEventListener('click', () => {
    browserHistory = browserCurrentPath ? [browserCurrentPath] : []
    browserHistoryIndex = browserHistory.length - 1
    persistBrowserHistory()
    hideBrowserHistoryMenu()
    renderFolderBrowser()
  })
  browserHistoryMenu.append(clearItem)

  browserHistoryMenu.hidden = false
}

function hideBrowserHistoryMenu() {
  browserHistoryMenu.hidden = true
}

function renderFolderBrowser() {
  renderBrowserRoots()
  renderBrowserEntries()
  if (document.activeElement !== folderBrowserPathInput) {
    folderBrowserPathInput.value = browserCurrentPath || ''
  }
  folderBrowserBackButton.disabled = browserHistoryIndex <= 0 || browserLoading
  folderBrowserForwardButton.disabled = browserHistoryIndex >= browserHistory.length - 1 || browserLoading
  folderBrowserUpButton.disabled = !browserParentPath || browserLoading
  folderBrowserUseButton.disabled = !browserCurrentPath || browserLoading
  folderBrowserSortButton.textContent = browserSortMode === 'name' ? '名称' : browserSortMode === 'date' ? '日期' : '大小'
  folderBrowserViewButton.textContent = browserViewMode === 'list' ? '列表' : '网格'
  gridSizeSlider.hidden = browserViewMode !== 'grid'

  const imageCount = browserEntries.filter((entry) => entry.kind === 'image').length
  const suffix = browserTruncated ? ' · 仅显示前 500 项' : ''
  folderBrowserSummary.textContent = browserCurrentPath
    ? `当前目录发现 ${imageCount} 张图像${suffix}。使用此文件夹会扫描子目录并加载图库。`
    : '选择左侧常用目录或磁盘开始浏览。'

  if (browserLoading) {
    folderBrowserMessage.textContent = '正在读取目录...'
    folderBrowserMessage.hidden = false
  } else if (browserError) {
    folderBrowserMessage.textContent = browserError
    folderBrowserMessage.hidden = false
  } else if (!browserCurrentPath) {
    folderBrowserMessage.textContent = '选择左侧常用目录或磁盘开始浏览。'
    folderBrowserMessage.hidden = false
  } else if (browserEntries.length === 0) {
    folderBrowserMessage.textContent = '此目录没有可浏览条目。'
    folderBrowserMessage.hidden = false
  } else {
    folderBrowserMessage.hidden = true
  }
}

function renderBrowserRoots() {
  folderBrowserRoots.replaceChildren()

  for (const root of browserRoots) {
    const button = document.createElement('button')
    const marker = document.createElement('span')
    const label = document.createElement('span')

    button.type = 'button'
    button.className = 'folder-root-button'
    button.dataset.active = String(root.path === browserCurrentPath)
    button.addEventListener('click', () => void enterBrowserDirectory(root.path))
    marker.className = `folder-entry-icon ${root.kind}`
    marker.textContent = root.kind === 'drive' ? 'D' : 'Q'
    label.textContent = root.name
    button.append(marker, label)
    folderBrowserRoots.append(button)
  }
}

function renderBrowserEntries() {
  folderBrowserList.replaceChildren()
  folderBrowserList.dataset.view = browserViewMode

  for (const entry of browserEntries) {
    const button = document.createElement('button')

    button.type = 'button'
    button.className = 'folder-entry-button'
    button.dataset.kind = entry.kind
    button.dataset.path = entry.path
    button.dataset.selected = String(entry.path === browserSelectedPath)
    if (entry.kind === 'directory') {
      button.dataset.dim = String(browserImagelessFolders.has(entry.path))
    }
    button.addEventListener('click', () => {
      browserSelectedPath = entry.path
      renderFolderBrowser()
    })
    button.addEventListener('dblclick', () => {
      if (entry.kind === 'directory') {
        void enterBrowserDirectory(entry.path)
      }
    })

    const name = document.createElement('span')
    name.className = 'folder-entry-name'
    name.textContent = entry.name

    if (browserViewMode === 'grid') {
      const tile = document.createElement('span')
      tile.className = 'folder-tile-thumb'
      if (entry.kind === 'image' && convertSrc) {
        const thumb = document.createElement('img')
        thumb.loading = 'lazy'
        thumb.decoding = 'async'
        thumb.alt = ''
        thumb.src = convertSrc(entry.path)
        tile.append(thumb)
      } else {
        tile.dataset.kind = entry.kind
        tile.textContent = getBrowserEntryIcon(entry.kind)
      }
      button.title = entry.name
      button.append(tile, name)
    } else {
      const icon = document.createElement('span')
      const kind = document.createElement('span')
      const meta = document.createElement('span')
      icon.className = `folder-entry-icon ${entry.kind}`
      icon.textContent = getBrowserEntryIcon(entry.kind)
      kind.className = 'folder-entry-kind'
      kind.textContent = getBrowserEntryKindLabel(entry.kind)
      meta.className = 'folder-entry-meta'
      meta.textContent = getBrowserEntryMeta(entry)
      button.append(icon, name, kind, meta)
    }

    folderBrowserList.append(button)
  }
}

async function collectImages(directory: DirectoryHandle): Promise<File[]> {
  const files: File[] = []

  for await (const entry of directory.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      if (isImageFile(file)) {
        files.push(file)
      }
    } else {
      files.push(...await collectImages(entry))
    }
  }

  return files
}

async function loadFiles(files: File[]) {
  showMessage('正在读取图像尺寸...')
  const nextImages = files
    .filter(isImageFile)
    .map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${file.size}-${index}`,
      name: file.name,
      url: URL.createObjectURL(file),
      size: file.size,
      modifiedAt: file.lastModified,
      width: 0,
      height: 0,
      kind: 'flat' as ProjectionMode,
    }))

  clearImageUrls()
  images = await Promise.all(nextImages.map(readImageInfo))
  images.sort((left, right) => Number(right.kind === 'sphere') - Number(left.kind === 'sphere') || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  activeImageId = images[0]?.id ?? ''
  projectionChoice = 'auto'
  renderLibrary()

  if (activeImageId) {
    loadImage(activeImageId)
  } else {
    setEmptyState()
  }
}

async function loadLocalImages(collection: LocalImageCollection) {
  showMessage('正在读取本地文件夹图像...')
  const { convertFileSrc } = await import('@tauri-apps/api/core')
  const nextImages = collection.images.map((image, index) => ({
    id: `${image.path}-${index}`,
    name: image.name,
    url: convertFileSrc(image.path),
    size: image.size,
    modifiedAt: image.modifiedAt ?? 0,
    width: 0,
    height: 0,
    kind: 'flat' as ProjectionMode,
  }))

  clearImageUrls()
  images = await Promise.all(nextImages.map(readImageInfo))
  images.sort((left, right) => Number(right.kind === 'sphere') - Number(left.kind === 'sphere') || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  activeImageId = images[0]?.id ?? ''
  projectionChoice = 'auto'
  renderLibrary()

  if (activeImageId) {
    loadImage(activeImageId)
    if (collection.truncated) {
      showMessage('当前文件夹图像数量较多，仅加载前 5000 张。')
    }
  } else {
    setEmptyState()
    showMessage('当前文件夹中没有找到支持的图像。')
  }
}

async function readImageInfo(image: PanoramaImage): Promise<PanoramaImage> {
  const dimensions = await getImageDimensions(image.url)
  image.width = dimensions.width
  image.height = dimensions.height
  image.kind = isEquirectangular(image) ? 'sphere' : 'flat'
  return image
}

function renderLibrary() {
  const listScrollTop = imageList.scrollTop
  let activeItemButton: HTMLButtonElement | null = null
  imageList.replaceChildren()
  const panoramaCount = images.filter((image) => image.kind === 'sphere').length
  imageCount.textContent = images.length > 0 ? `${panoramaCount} 张全景 / ${images.length} 张图像` : '0 张图像'
  clearButton.disabled = images.length === 0
  resetViewButton.disabled = images.length === 0
  projectionButton.disabled = images.length === 0
  fullscreenButton.disabled = images.length === 0
  updateNavigationButtons()

  for (const image of images) {
    const button = document.createElement('button')
    const thumb = document.createElement('span')
    const content = document.createElement('span')
    const row = document.createElement('span')
    const name = document.createElement('span')
    const kind = document.createElement('span')
    const meta = document.createElement('span')
    const isActive = image.id === activeImageId

    button.type = 'button'
    button.className = 'image-item'
    button.dataset.active = String(isActive)
    button.title = image.name
    button.addEventListener('click', () => loadImage(image.id))

    thumb.className = 'image-thumb'
    thumb.style.backgroundImage = `url("${image.url}")`
    content.className = 'image-copy'
    row.className = 'image-title-row'
    name.className = 'image-name'
    kind.className = `image-kind ${image.kind}`
    meta.className = 'image-meta'
    name.textContent = image.name
    kind.textContent = image.kind === 'sphere' ? '360' : '源图'
    meta.textContent = `${formatBytes(image.size)} · ${image.width}x${image.height} · ${formatDate(image.modifiedAt)}`

    row.append(name, kind)
    content.append(row, meta)
    button.append(thumb, content)
    imageList.append(button)

    if (isActive) {
      activeItemButton = button
    }
  }

  imageList.scrollTop = listScrollTop

  if (libraryCollapsed) {
    activeItemButton?.scrollIntoView({ block: 'nearest' })
  }
}

function loadImage(imageId: string) {
  const image = images.find((item) => item.id === imageId)
  if (!image) {
    return
  }

  activeImageId = image.id
  emptyState.hidden = true
  viewerSurface.classList.add('has-image')
  renderLibrary()
  resetView()
  applyProjection(image)
}

function showAdjacentImage(direction: -1 | 1) {
  if (images.length <= 1) {
    return
  }

  const activeIndex = getActiveImageIndex()
  const nextIndex = (activeIndex + direction + images.length) % images.length
  const nextImage = images[nextIndex]

  if (!nextImage) {
    return
  }

  loadImage(nextImage.id)
}

function handleKeyboardNavigation(event: KeyboardEvent) {
  if (handleFolderBrowserKeyboard(event)) {
    return
  }

  if (event.key === 'ArrowLeft' || event.code === 'Numpad4') {
    event.preventDefault()
    showAdjacentImage(-1)
  } else if (event.key === 'ArrowRight' || event.code === 'Numpad6') {
    event.preventDefault()
    showAdjacentImage(1)
  }
}

function handleFolderBrowserKeyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
    return false
  }

  if (event.key === 'Escape') {
    if (!browserHistoryMenu.hidden) {
      hideBrowserHistoryMenu()
      return true
    }
    return false
  } else if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowLeft')) {
    event.preventDefault()
    void goBrowserHistory(-1)
    return true
  } else if (event.altKey && event.key === 'ArrowRight') {
    event.preventDefault()
    void goBrowserHistory(1)
    return true
  } else if (event.altKey && event.key === 'ArrowUp') {
    event.preventDefault()
    void enterBrowserDirectory(browserParentPath)
    return true
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusBrowserEntry(1)
    return true
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    focusBrowserEntry(-1)
    return true
  } else if (event.key === 'Enter') {
    const activeElement = document.activeElement as HTMLElement | null
    if (activeElement?.classList.contains('folder-entry-button') && activeElement.dataset.kind === 'directory') {
      event.preventDefault()
      void enterBrowserDirectory(activeElement.dataset.path ?? '')
      return true
    }
  }

  return false
}

function focusBrowserEntry(direction: 1 | -1) {
  const entries = Array.from(folderBrowserList.querySelectorAll<HTMLButtonElement>('.folder-entry-button'))
  if (entries.length === 0) {
    return
  }

  const currentIndex = entries.findIndex((entry) => entry === document.activeElement)
  const nextIndex = currentIndex < 0
    ? 0
    : clamp(currentIndex + direction, 0, entries.length - 1)
  entries[nextIndex]?.focus()
}

function updateNavigationButtons() {
  const disabled = images.length <= 1 || getActiveImageIndex() < 0
  previousImageButton.disabled = disabled
  nextImageButton.disabled = disabled
}

function getActiveImageIndex() {
  return images.findIndex((image) => image.id === activeImageId)
}

function updateNavigationProximity(event: PointerEvent) {
  if (isDragging || images.length <= 1) {
    clearNavigationProximity()
    return
  }

  const bounds = viewerSurface.getBoundingClientRect()
  const distanceFromLeft = event.clientX - bounds.left
  const distanceFromRight = bounds.right - event.clientX
  const proximity = Math.min(120, Math.max(72, bounds.width * 0.12))
  viewerSurface.classList.toggle('nav-near-left', distanceFromLeft <= proximity)
  viewerSurface.classList.toggle('nav-near-right', distanceFromRight <= proximity)
}

function clearNavigationProximity() {
  viewerSurface.classList.remove('nav-near-left', 'nav-near-right')
}

function applyProjection(image: PanoramaImage) {
  activeMode = resolveProjectionMode(image)
  projectionButton.textContent = getProjectionLabel()
  flatImage.hidden = activeMode !== 'flat'
  panoCanvas.hidden = activeMode !== 'sphere'
  panoTextureReady = false

  if (activeMode === 'sphere') {
    flatImage.removeAttribute('src')
    loadPanoTexture(image)
  } else {
    hideMessage()
    flatImage.src = image.url
    applyFlatTransform()
  }

  updateStatus()
}

function resolveProjectionMode(image: PanoramaImage): ProjectionMode {
  if (projectionChoice !== 'auto') {
    return projectionChoice
  }

  return image.kind
}

function getProjectionLabel() {
  if (projectionChoice === 'auto') {
    return activeMode === 'sphere' ? '投影 自动360' : '投影 自动平面'
  }

  return projectionChoice === 'sphere' ? '投影 360' : '投影 平面'
}

function cycleProjection() {
  projectionChoice = projectionChoice === 'auto'
    ? 'sphere'
    : projectionChoice === 'sphere'
      ? 'flat'
      : 'auto'

  const image = images.find((item) => item.id === activeImageId)
  if (image) {
    resetView()
    applyProjection(image)
  }
}

function clearImages() {
  clearImageUrls()
  images = []
  activeImageId = ''
  projectionChoice = 'auto'
  panoTextureReady = false
  flatImage.removeAttribute('src')
  renderLibrary()
  setEmptyState()
}

function setEmptyState() {
  fileDetails.textContent = '等待图像'
  viewDetails.textContent = `FOV ${Math.round(fov)}`
  projectionButton.textContent = '投影 自动'
  emptyState.hidden = false
  viewerSurface.classList.remove('has-image')
  flatImage.hidden = true
  panoCanvas.hidden = false
  hideMessage()
}

function resetView() {
  yaw = 0
  pitch = 0
  fov = initialFov
  flatScale = 1
  flatX = 0
  flatY = 0
  applyFlatTransform()
  resizeViewer()
  updateStatus()
}

function initPano() {
  if (gl) {
    return true
  }

  gl = panoCanvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: true })
  if (!gl) {
    showMessage('当前环境不支持 WebGL，无法使用 360 全景查看。')
    return false
  }

  panoMaxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096
  const vertexSource = 'attribute vec2 p;varying vec2 v;void main(){v=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}'
  const fragmentSource = 'precision mediump float;varying vec2 v;uniform sampler2D tex;uniform vec2 res;uniform float yaw;uniform float pitch;uniform float fov;const float PI=3.141592653589793;mat3 ry(float a){float s=sin(a),c=cos(a);return mat3(c,0.0,s,0.0,1.0,0.0,-s,0.0,c);}mat3 rx(float a){float s=sin(a),c=cos(a);return mat3(1.0,0.0,0.0,0.0,c,-s,0.0,s,c);}void main(){vec2 xy=(v*2.0-1.0)*vec2(res.x/res.y,1.0);float z=1.0/tan(radians(fov)*0.5);vec3 dir=normalize(vec3(xy.x,xy.y,-z));dir=ry(yaw)*rx(pitch)*dir;float u=atan(dir.x,-dir.z)/(2.0*PI)+0.5;float vv=asin(clamp(dir.y,-1.0,1.0))/PI+0.5;gl_FragColor=texture2D(tex,vec2(u,1.0-vv));}'
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  const program = gl.createProgram()

  if (!vertexShader || !fragmentShader || !program) {
    showMessage('360 全景查看初始化失败。')
    return false
  }

  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    showMessage('360 全景查看初始化失败。')
    return false
  }

  panoProgram = program
  panoBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, panoBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  panoTexture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, panoTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return true
}

function compileShader(context: WebGLRenderingContext, type: number, source: string) {
  const shader = context.createShader(type)
  if (!shader) {
    return null
  }

  context.shaderSource(shader, source)
  context.compileShader(shader)
  return shader
}

function loadPanoTexture(image: PanoramaImage) {
  if (!initPano() || !gl || !panoTexture) {
    return
  }

  const ticket = ++panoLoadTicket
  panoTextureReady = false
  showMessage('正在加载 360 全景图...')
  const sourceImage = new Image()
  sourceImage.crossOrigin = 'anonymous'
  sourceImage.onload = () => {
    if (ticket !== panoLoadTicket) {
      return
    }

    try {
      const source = preparePanoSource(sourceImage)
      gl!.bindTexture(gl!.TEXTURE_2D, panoTexture)
      gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false)
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source)
      const error = gl!.getError()
      if (error !== gl!.NO_ERROR) {
        throw new Error(`WebGL texture upload failed: ${error}`)
      }

      panoTextureReady = true
      hideMessage()
      resizeViewer()
      renderPano()
    } catch (error) {
      console.error(error)
      panoTextureReady = false
      showMessage('360 全景加载失败。图片可能超过当前 WebGL 纹理限制，或不是标准 2:1 成品全景图。')
    }
  }
  sourceImage.onerror = () => {
    if (ticket === panoLoadTicket) {
      showMessage('图片加载失败。')
    }
  }
  sourceImage.src = image.url
}

function preparePanoSource(image: HTMLImageElement): TexImageSource {
  const maxSide = Math.max(image.naturalWidth, image.naturalHeight)
  if (maxSide <= panoMaxTextureSize) {
    return image
  }

  const ratio = panoMaxTextureSize / maxSide
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(image.naturalWidth * ratio))
  canvas.height = Math.max(1, Math.floor(image.naturalHeight * ratio))
  const context = canvas.getContext('2d', { alpha: false })!
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  showMessage(`已自动降采样到 ${canvas.width} x ${canvas.height} 以适配当前 WebGL。`)
  window.setTimeout(() => {
    if (activeMode === 'sphere') {
      hideMessage()
    }
  }, 1600)
  return canvas
}

function renderPano() {
  if (!gl || !panoProgram || !panoBuffer || !panoTexture || !panoTextureReady || activeMode !== 'sphere') {
    return
  }

  resizeCanvas()
  gl.viewport(0, 0, panoCanvas.width, panoCanvas.height)
  gl.useProgram(panoProgram)
  const position = gl.getAttribLocation(panoProgram, 'p')
  gl.bindBuffer(gl.ARRAY_BUFFER, panoBuffer)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.uniform2f(gl.getUniformLocation(panoProgram, 'res'), panoCanvas.width, panoCanvas.height)
  gl.uniform1f(gl.getUniformLocation(panoProgram, 'yaw'), yaw)
  gl.uniform1f(gl.getUniformLocation(panoProgram, 'pitch'), pitch)
  gl.uniform1f(gl.getUniformLocation(panoProgram, 'fov'), fov)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, panoTexture)
  gl.uniform1i(gl.getUniformLocation(panoProgram, 'tex'), 0)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
}

function resizeViewer() {
  resizeCanvas()
  renderPano()
}

function resizeCanvas() {
  const width = Math.max(1, panoCanvas.clientWidth)
  const height = Math.max(1, panoCanvas.clientHeight)
  if (panoCanvas.width !== width || panoCanvas.height !== height) {
    panoCanvas.width = width
    panoCanvas.height = height
  }
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen()
    return
  }

  await viewerShell.requestFullscreen()
}

function updateFullscreenLabel() {
  fullscreenButton.textContent = document.fullscreenElement ? '窗口' : '全屏'
  resizeViewer()
}

function updateStatus() {
  const image = images.find((item) => item.id === activeImageId)
  fileDetails.textContent = image ? `${image.name} · ${formatBytes(image.size)}` : '等待图像'
  const projection = activeMode === 'sphere' ? '360' : '平面'
  const dimensions = image ? ` · ${image.width}x${image.height}` : ''
  viewDetails.textContent = `${projection} · FOV ${Math.round(fov)}${dimensions}`
}

function applyFlatTransform() {
  flatImage.style.transform = `translate(${flatX}px, ${flatY}px) scale(${flatScale})`
}

async function checkForAppUpdates() {
  if (!window.__TAURI_INTERNALS__) {
    return
  }

  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      return
    }

    const releaseNotes = update.body ? `\n\n${update.body}` : ''
    const shouldInstall = window.confirm(`发现新版本 ${update.version}。${releaseNotes}\n\n是否立即下载并安装？`)
    if (!shouldInstall) {
      return
    }

    showMessage('正在下载并安装更新...')
    await update.downloadAndInstall((event) => {
      if (event.event === 'Progress') {
        showMessage('正在下载更新...')
      } else if (event.event === 'Finished') {
        showMessage('更新下载完成，正在安装...')
      }
    })
    showMessage('更新已安装。Windows 会自动退出应用完成安装。')
  } catch (error) {
    console.error('Failed to check for app updates:', error)
  }
}

function releasePointer(event: PointerEvent) {
  if (!isDragging) {
    return
  }

  isDragging = false
  viewerSurface.releasePointerCapture(event.pointerId)
  viewerSurface.classList.remove('is-dragging')
}

function showMessage(message: string) {
  viewerMessage.textContent = message
  viewerMessage.hidden = false
}

function hideMessage() {
  viewerMessage.textContent = ''
  viewerMessage.hidden = true
}

function clearImageUrls() {
  for (const image of images) {
    URL.revokeObjectURL(image.url)
  }
}

function toggleLibraryPanel() {
  libraryCollapsed = !libraryCollapsed

  if (libraryCollapsed) {
    savedLibraryWidth = appShell.style.getPropertyValue('--library-width')
    appShell.style.removeProperty('--library-width')
  } else if (savedLibraryWidth) {
    appShell.style.setProperty('--library-width', savedLibraryWidth)
  }

  appShell.classList.toggle('library-collapsed', libraryCollapsed)
  libraryToggleButton.textContent = libraryCollapsed ? '›' : '‹'
  libraryToggleButton.setAttribute('aria-label', libraryCollapsed ? '展开图库' : '收起图库')
  resizeViewer()

  if (libraryCollapsed) {
    imageList.querySelector<HTMLButtonElement>('.image-item[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }
}

function startLayoutResize(event: PointerEvent, target: 'library' | 'browser') {
  event.preventDefault()
  activeResize = target
  document.body.classList.add('is-resizing-layout')
}

function resizeLayout(event: PointerEvent) {
  if (!activeResize) {
    return
  }

  if (activeResize === 'library') {
    libraryCollapsed = false
    appShell.classList.remove('library-collapsed')
    libraryToggleButton.textContent = '‹'
    libraryToggleButton.setAttribute('aria-label', '收起图库')
    const width = clamp(event.clientX, 240, Math.min(520, window.innerWidth * 0.46))
    appShell.style.setProperty('--library-width', `${Math.round(width)}px`)
  } else {
    const height = clamp(window.innerHeight - event.clientY, 180, Math.min(520, window.innerHeight * 0.55))
    appShell.style.setProperty('--browser-height', `${Math.round(height)}px`)
  }
}

function stopLayoutResize() {
  if (!activeResize) {
    return
  }

  activeResize = ''
  document.body.classList.remove('is-resizing-layout')
  resizeViewer()
}

function getBrowserEntryIcon(kind: BrowserEntry['kind']) {
  return kind === 'directory' ? 'F' : kind === 'image' ? 'I' : 'O'
}

function getBrowserEntryKindLabel(kind: BrowserEntry['kind']) {
  return kind === 'directory' ? '文件夹' : kind === 'image' ? '图像' : '其他'
}

function getBrowserEntryMeta(entry: BrowserEntry) {
  const date = typeof entry.modifiedAt === 'number' ? formatDate(entry.modifiedAt) : ''
  if (entry.kind === 'image' && typeof entry.size === 'number') {
    return date ? `${formatBytes(entry.size)} · ${date}` : formatBytes(entry.size)
  }

  return date
}

function isImageFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.type.startsWith('image/') || imageExtensions.has(extension)
}

function isEquirectangular(image: PanoramaImage) {
  if (!image.width || !image.height) {
    return false
  }

  const aspect = image.width / image.height
  return aspect >= 1.95 && aspect <= 2.05
}

function getImageDimensions(url: string) {
  return new Promise<{ width: number, height: number }>((resolve) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = url
  })
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(timestamp)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
