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
    // Podcast donné par son nom : on fait la même recherche que l'app (Apple Podcasts).
    if (url.startsWith('podcast:')) {
      const name = url.slice(8)
      const r = await fetch(`https://itunes.apple.com/search?media=podcast&entity=podcast&limit=10&country=${entry.lang === 'en' ? 'US' : 'FR'}&term=${encodeURIComponent(name)}`)
      const found = ((await r.json()).results ?? []).find((x) => x.feedUrl)
      if (!found) return { entry, url, ok: false, error: 'Podcast introuvable dans Apple Podcasts' }
      url = found.feedUrl
    }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' }).finally(() => clearTimeout(timer))
    if (!res.ok) return { entry, url, ok: false, error: `HTTP ${res.status}` }
    const full = await res.text()
    const looksLikeFeed = (b) => /<rss\b|<feed\b|<rdf:RDF\b|"version"\s*:\s*"https:\/\/jsonfeed/i.test(b.slice(0, 4000))
    if (looksLikeFeed(full)) return { entry, url, ok: true }
    // Page HTML (chaîne YouTube…) : le flux est annoncé par <link rel="alternate">, comme le fait l'app.
    const tag = (full.match(/<link\b[^>]*>/gi) ?? []).find((t) => /rel=["']?alternate/i.test(t) && /application\/(rss|atom)\+xml/i.test(t))
    const href = tag?.match(/href=["']([^"']+)["']/i)?.[1]
    if (!href) return { entry, url, ok: false, error: 'Page sans flux annoncé' }
    const feedUrl = new URL(href.replace(/&amp;/g, '&'), url).href
    const r2 = await fetch(feedUrl, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (!r2.ok) return { entry, url: feedUrl, ok: false, error: `HTTP ${r2.status}` }
    return looksLikeFeed(await r2.text()) ? { entry, url: feedUrl, ok: true } : { entry, url: feedUrl, ok: false, error: 'Réponse qui ne ressemble pas à un flux' }
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
