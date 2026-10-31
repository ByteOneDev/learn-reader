// Construit l'extension Obsidian : obsidian-plugin/dist/learn-reader/{main.js, manifest.json, styles.css},
// le dossier à copier dans <coffre>/.obsidian/plugins/. La version suit celle de l'app.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// fileURLToPath et non URL.pathname : sous Windows, pathname donne « /D:/… ».
const here = fileURLToPath(new URL('.', import.meta.url))
const out = join(here, 'dist', 'learn-reader')
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [join(here, 'src', 'main.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  outfile: join(out, 'main.js'),
  logLevel: 'warning',
  banner: { js: '/* Learn — extension Obsidian. https://github.com/ByteOneDev/learn-reader */' }
})

const version = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')).version
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
manifest.version = version
writeFileSync(join(here, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
copyFileSync(join(here, 'styles.css'), join(out, 'styles.css'))
console.log(`Extension Obsidian ${version} → ${out}`)
