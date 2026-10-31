import type { Plugin } from 'vite'

// La CSP n'est injectée qu'au build : en dev, Vite a besoin de scripts inline (React Refresh).
// Le contenu des articles vient d'Internet : aucun script distant ni inline ne doit pouvoir s'exécuter.
export const CSP = [
  "default-src 'self'",
  // pdf.js décode certaines images (JPEG 2000, JBIG2) en WebAssembly.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src * blob:',
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export function cspPlugin(): Plugin {
  return {
    name: 'learn-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
    }
  }
}
