// Diagnostic : l'app réelle (Electron) s'abonne à tout le catalogue d'une langue, par paquets de 6 comme
// l'accueil, et liste chaque échec avec son motif.  node scripts/catalog-check.mjs [fr|en]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { _electron } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lang = process.argv[2] ?? 'fr'
const catalog = JSON.parse(readFileSync(join(root, 'src/shared/catalog.json'), 'utf8'))
const entries = catalog.entries.filter((e) => e.lang === lang)
const profile = mkdtempSync(join(tmpdir(), 'learn-catalog-'))
const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)('electron'),
  args: [root, `--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
})
try {
  const w = await app.firstWindow()
  await w.waitForFunction(() => !!window.learn)
  const t0 = Date.now()
  const failed = []
  for (let i = 0; i < entries.length; i += 6) {
    const chunk = entries.slice(i, i + 6).map((e) => ({ input: e.input, kind: e.kind, title: e.title, category: e.category, lang: e.lang }))
    const s = Date.now()
    const r = await w.evaluate((c) => window.learn.addSources(c).catch((e) => ({ added: [], failed: c.map((x) => ({ input: x.title, error: 'IPC : ' + e.message })) })), chunk)
    failed.push(...r.failed.map((f) => `${f.input} → ${f.error}`))
    console.log(`paquet ${i / 6 + 1} : ${r.added.length}/${chunk.length} en ${((Date.now() - s) / 1000).toFixed(1)} s`)
  }
  const sources = await w.evaluate(() => window.learn.listSources())
  const byKind = {}
  for (const s of sources) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1
  console.log(`\n${sources.length}/${entries.length} sources abonnées en ${((Date.now() - t0) / 1000).toFixed(0)} s :`, JSON.stringify(byKind))
  console.log(`${failed.length} échec(s) :\n${failed.map((f) => '  - ' + f).join('\n')}`)
} finally {
  await app.close().catch(() => {})
  rmSync(profile, { recursive: true, force: true })
}
