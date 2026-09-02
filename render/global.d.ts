import type { ExpandPreloadIpc } from '@quiteer/electron-ipc/web'
import type { PreloadClipboard, PreloadIpc, PreloadWebFrame } from '@quiteer/electron-preload'

declare global {
  interface Window {
    $ipc: PreloadIpc & ExpandPreloadIpc
    $clipboard: PreloadClipboard
    $webFrame: PreloadWebFrame
  }
}

export {}
