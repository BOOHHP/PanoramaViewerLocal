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

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<DirectoryHandle>
  }
}

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'bmp'])
const app = document.querySelector<HTMLDivElement>('#app')!
const initialFov = 75

app.innerHTML = `
  <div class="app-shell">
    <aside class="library-panel" aria-label="全景图库">
      <header class="brand-block">
        <div class="brand-mark" aria-hidden="true"></div>
        <div>
          <p class="eyebrow">Local 360 Studio</p>
          <h1>Panorama Viewer</h1>
        </div>
      </header>

      <div class="panel-actions">
        <button class="primary-action" id="pickFolderButton" type="button">选择文件夹</button>
        <button class="ghost-action" id="clearButton" type="button" disabled>清空</button>
        <input id="folderInput" type="file" accept="image/*" multiple hidden />
      </div>

      <div class="library-meta">
        <span id="imageCount">0 张图像</span>
        <span id="activeImageName">未载入</span>
      </div>

      <div class="library-scroll">
        <div class="image-list" id="imageList" aria-label="可查看的全景图"></div>
      </div>
    </aside>

    <main class="viewer-shell" id="viewerShell">
      <div class="viewer-surface" id="viewerSurface" aria-label="全景图查看区域">
        <canvas id="panoCanvas"></canvas>
        <img class="flat-image" id="flatImage" alt="" hidden />
        <button class="nav-button nav-button-previous" id="previousImageButton" type="button" aria-label="上一张图像" title="上一张" disabled>‹</button>
        <button class="nav-button nav-button-next" id="nextImageButton" type="button" aria-label="下一张图像" title="下一张" disabled>›</button>
        <div class="viewer-message" id="viewerMessage" hidden></div>
        <div class="empty-state" id="emptyState">
          <p class="empty-title">选择本地全景图库</p>
          <button class="primary-action" id="emptyPickButton" type="button">打开文件夹</button>
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
  </div>
`

const pickFolderButton = document.querySelector<HTMLButtonElement>('#pickFolderButton')!
const emptyPickButton = document.querySelector<HTMLButtonElement>('#emptyPickButton')!
const clearButton = document.querySelector<HTMLButtonElement>('#clearButton')!
const resetViewButton = document.querySelector<HTMLButtonElement>('#resetViewButton')!
const projectionButton = document.querySelector<HTMLButtonElement>('#projectionButton')!
const fullscreenButton = document.querySelector<HTMLButtonElement>('#fullscreenButton')!
const previousImageButton = document.querySelector<HTMLButtonElement>('#previousImageButton')!
const nextImageButton = document.querySelector<HTMLButtonElement>('#nextImageButton')!
const folderInput = document.querySelector<HTMLInputElement>('#folderInput')!
const imageList = document.querySelector<HTMLDivElement>('#imageList')!
const imageCount = document.querySelector<HTMLSpanElement>('#imageCount')!
const activeImageName = document.querySelector<HTMLSpanElement>('#activeImageName')!
const fileDetails = document.querySelector<HTMLSpanElement>('#fileDetails')!
const viewDetails = document.querySelector<HTMLSpanElement>('#viewDetails')!
const viewerShell = document.querySelector<HTMLElement>('#viewerShell')!
const viewerSurface = document.querySelector<HTMLDivElement>('#viewerSurface')!
const emptyState = document.querySelector<HTMLDivElement>('#emptyState')!
const viewerMessage = document.querySelector<HTMLDivElement>('#viewerMessage')!
const panoCanvas = document.querySelector<HTMLCanvasElement>('#panoCanvas')!
const flatImage = document.querySelector<HTMLImageElement>('#flatImage')!

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

pickFolderButton.addEventListener('click', () => void pickFolder())
emptyPickButton.addEventListener('click', () => void pickFolder())
clearButton.addEventListener('click', clearImages)
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

viewerSurface.addEventListener('pointerdown', (event) => {
  if (!activeImageId) {
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

async function pickFolder() {
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

async function readImageInfo(image: PanoramaImage): Promise<PanoramaImage> {
  const dimensions = await getImageDimensions(image.url)
  image.width = dimensions.width
  image.height = dimensions.height
  image.kind = isEquirectangular(image) ? 'sphere' : 'flat'
  return image
}

function renderLibrary() {
  const listScrollTop = imageList.scrollTop
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

    button.type = 'button'
    button.className = 'image-item'
    button.dataset.active = String(image.id === activeImageId)
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
  }

  imageList.scrollTop = listScrollTop
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
  if (event.key === 'ArrowLeft' || event.code === 'Numpad4') {
    event.preventDefault()
    showAdjacentImage(-1)
  } else if (event.key === 'ArrowRight' || event.code === 'Numpad6') {
    event.preventDefault()
    showAdjacentImage(1)
  }
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
  activeImageName.textContent = '未载入'
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
  activeImageName.textContent = image?.name ?? '未载入'
  fileDetails.textContent = image ? `${image.name} · ${formatBytes(image.size)}` : '等待图像'
  const projection = activeMode === 'sphere' ? '360' : '平面'
  const dimensions = image ? ` · ${image.width}x${image.height}` : ''
  viewDetails.textContent = `${projection} · FOV ${Math.round(fov)}${dimensions}`
}

function applyFlatTransform() {
  flatImage.style.transform = `translate(${flatX}px, ${flatY}px) scale(${flatScale})`
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
