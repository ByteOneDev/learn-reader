// Construit l'extension Obsidian : obsidian-plugin/dist/learn-reader/{main.js, manifest.json, styles.css},
// le dossier à copier dans <coffre>/.obsidian/plugins/. La version suit celle de l'app.
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const here = new URL('.', import.meta.url).pathname
const out = `${here}dist/learn-reader`
mkdirSync(out, { recursive: true })

await build({
  entryPoints: [`${here}src/main.ts`],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  outfile: `${out}/main.js`,
  logLevel: 'warning',
  banner: { js: '/* Learn — extension Obsidian. https://github.com/ByteOneDev/learn-reader */' }
})

const version = JSON.parse(readFileSync(`${here}../package.json`, 'utf8')).version
const manifest = JSON.parse(readFileSync(`${here}manifest.json`, 'utf8'))
manifest.version = version
writeFileSync(`${here}manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
copyFileSync(`${here}styles.css`, `${out}/styles.css`)
console.log(`Extension Obsidian ${version} → ${out}`)
