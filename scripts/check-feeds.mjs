// Vérifie que chaque flux du catalogue répond et ressemble bien à un flux.
// Usage : node --experimental-strip-types scripts/check-feeds.mjs [--strict]
// Lancé chaque semaine par .github/workflows/feeds-health.yml ; le rapport s'affiche dans le résumé du job.
import { appendFileSync, readFileSync } from 'node:fs'
import { resolveInput } from '../src/main/feeds/resolve.ts'

const catalog = JSON.parse(readFileSync(new URL('../src/shared/catalog.json', import.meta.url), 'utf8'))
const UA = 'Mozilla/5.0 (compatible; Learn/0.1; +https://github.com/ByteOneDev/learn-reader)'
const strict = process.argv.includes('--strict')

async function check(entry) {
  let url
  try {
    url = resolveInput(entry.input).url
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' }).finally(() => clearTimeout(timer))
    if (!res.ok) return { entry, url, ok: false, error: `HTTP ${res.status}` }
    const body = (await res.text()).slice(0, 4000)
    const looksLikeFeed = /<rss\b|<feed\b|<rdf:RDF\b|"version"\s*:\s*"https:\/\/jsonfeed/i.test(body)
    return looksLikeFeed ? { entry, url, ok: true } : { entry, url, ok: false, error: 'Réponse qui ne ressemble pas à un flux' }
  } catch (e) {
    return { entry, url, ok: false, error: e.name === 'AbortError' ? 'Délai dépassé' : e.message }
  }
}

const results = []
const queue = [...catalog.entries]
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (queue.length) results.push(await check(queue.shift()))
  })
)

const failed = results.filter((r) => !r.ok).sort((a, b) => a.entry.id.localeCompare(b.entry.id))
const lines = [
  `## Santé du catalogue : ${results.length - failed.length}/${results.length} flux valides`,
  '',
  ...(failed.length
    ? ['| Source | Langue | Catégorie | Adresse | Problème |', '|---|---|---|---|---|', ...failed.map((r) => `| ${r.entry.title} | ${r.entry.lang} | ${r.entry.category} | ${r.url ?? r.entry.input} | ${r.error} |`)]
    : ['Tous les flux répondent.'])
]
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n')
if (strict && failed.length) process.exit(1)
