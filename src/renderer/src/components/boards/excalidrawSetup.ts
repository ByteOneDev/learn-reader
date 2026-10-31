// Importé avant Excalidraw : ses polices sont servies par l'app (dossier excalidraw/fonts/, copié au build)
// plutôt que par un CDN, interdit par la CSP et indisponible hors ligne.
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

window.EXCALIDRAW_ASSET_PATH = new URL('excalidraw/', document.baseURI).href

export {}
