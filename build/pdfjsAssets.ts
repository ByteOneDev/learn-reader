import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Plugin } from 'vite'

// pdf.js charge à la demande des fichiers annexes : polices standard, cartes de caractères (CJK)
// et décodeurs d'images en WebAssembly. On les sert sous /pdfjs/ en dev et on les copie au build.
const ROOT = resolve(__dirname, '../node_modules/pdfjs-dist')
const DIRS = ['cmaps', 'standard_fonts', 'wasm']

function files(): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  for (const dir of DIRS) {
    for (const name of readdirSync(join(ROOT, dir))) {
      const abs = join(ROOT, dir, name)
      if (statSync(abs).isFile() && !name.startsWith('LICENSE')) out.push({ rel: `pdfjs/${dir}/${name}`, abs })
    }
  }
  return out
}

export function pdfjsAssets(): Plugin {
  return {
    name: 'learn-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/pdfjs/')) return next()
        const f = files().find((x) => '/' + x.rel === url)
        if (!f) return next()
        res.setHeader('Content-Type', f.abs.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        res.end(readFileSync(f.abs))
      })
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: 'asset', fileName: f.rel, source: readFileSync(f.abs) })
    }
  }
}
