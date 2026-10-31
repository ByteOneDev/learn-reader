import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Plugin } from 'vite'

// Fichiers annexes chargés à la demande par des bibliothèques, servis sous le même domaine que l'app
// (la CSP interdit les CDN) : en dev par un middleware, au build en tant qu'assets.
// - pdf.js : polices standard, cartes de caractères (CJK), décodeurs WebAssembly → /pdfjs/
// - Excalidraw : ses polices (sans Xiaolai, 13 Mo, réservée au chinois) → /excalidraw/fonts/
const MOUNTS = [
  { root: resolve(__dirname, '../node_modules/pdfjs-dist'), dirs: ['cmaps', 'standard_fonts', 'wasm'], prefix: 'pdfjs' },
  { root: resolve(__dirname, '../node_modules/@excalidraw/excalidraw/dist/prod'), dirs: ['fonts'], prefix: 'excalidraw', skip: ['Xiaolai'] }
]

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name)
    return statSync(abs).isDirectory() ? walk(abs) : [abs]
  })
}

function files(): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  for (const m of MOUNTS) {
    for (const dir of m.dirs) {
      for (const abs of walk(join(m.root, dir))) {
        const rel = relative(m.root, abs).split('\\').join('/')
        if (rel.split('/').some((p) => p.startsWith('LICENSE') || m.skip?.includes(p))) continue
        out.push({ rel: `${m.prefix}/${rel}`, abs })
      }
    }
  }
  return out
}

const TYPES: Record<string, string> = { wasm: 'application/wasm', woff2: 'font/woff2', ttf: 'font/ttf' }

export function pdfjsAssets(): Plugin {
  return {
    name: 'learn-static-assets',
    configureServer(server) {
      const list = files()
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent(req.url?.split('?')[0] ?? '')
        const f = list.find((x) => '/' + x.rel === url)
        if (!f) return next()
        res.setHeader('Content-Type', TYPES[f.abs.split('.').pop() ?? ''] ?? 'application/octet-stream')
        res.end(readFileSync(f.abs))
      })
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: 'asset', fileName: f.rel, source: readFileSync(f.abs) })
    }
  }
}
