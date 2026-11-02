import type { SourceKind } from './types'

// Import d'abonnements venus d'ailleurs : fichier Google Takeout (abonnements YouTube) ou liste collée
// (une source par ligne : r/linux, une adresse, @compte@instance…). Chaque ligne reçoit une catégorie
// devinée (catalogue d'abord, puis mots-clés), modifiable avant l'abonnement.

export interface ImportCandidate {
  input: string
  title: string
  kind?: SourceKind
  category: string
}

/** Découpe une ligne CSV (guillemets, virgules dans les champs). */
function csvRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * subscriptions.csv de Google Takeout (« Channel Id,Channel Url,Channel Title », en-têtes traduits selon la
 * langue du compte). On repère les colonnes par leur contenu : identifiant UC…, adresse, titre.
 */
export function parseTakeoutCsv(text: string): { channelId: string; url: string; title: string }[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const out: { channelId: string; url: string; title: string }[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const cells = csvRow(line)
    const id = cells.find((c) => /^UC[\w-]{22}$/.test(c))
    if (!id || seen.has(id)) continue
    seen.add(id)
    const url = cells.find((c) => /youtube\.com\//.test(c)) ?? `https://www.youtube.com/channel/${id}`
    const title = cells.find((c) => c && c !== id && c !== url) ?? id
    out.push({ channelId: id, url: url.replace(/^http:/, 'https:'), title })
  }
  return out
}

/** Liste collée : une source par ligne ; puces, numéros et commentaires ignorés, doublons retirés. */
export function parseList(text: string): { input: string; title: string; kind?: SourceKind }[] {
  const out: { input: string; title: string; kind?: SourceKind }[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/#.*$/, '')
      .replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '')
      .trim()
    if (!line) continue
    // Subreddit écrit seul, avec ou sans « r/ ».
    const sub = line.match(/^\/?r\/([\w-]{2,})\/?$/i)
    const input = sub ? `r/${sub[1]}` : line
    const key = input.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ input, title: input, kind: sub || /reddit\.com\/r\//i.test(line) ? 'reddit' : /youtube\.com|youtu\.be/i.test(line) ? 'youtube' : undefined })
  }
  return out
}

// Mots-clés → catégorie du catalogue. Volontairement simple : l'utilisateur corrige avant de valider.
const KEYWORDS: [string, RegExp][] = [
  ['sport', /chess|échec|echec|blitz|foot|sport|nba|f1\b|formula|tennis|rugby|cycl|tour de france|gotham/i],
  ['histoire', /histoire|history|historique|napol|médiév|medieval|antiqu|rome|ww[12]|guerre|war\b|archéo|archeo|nota bene|patrimoine/i],
  ['sciences', /science|kurzgesagt|math|physi|astro|espace|space|nasa|biolog|chimi|chem|veritasium|vsauce|e-penser|dirty biology|nature|climat/i],
  ['jeux', /minecraft|gaming|gamer|jeu|game|nintendo|zelda|pokemon|pokémon|hollow ?knight|wakfu|dofus|createmod|modded|steam|xbox|playstation|speedrun/i],
  ['politique', /politi|actu|news|décrypt|decrypt|journal|monde|élection|election|géopo|geopo/i],
  ['economie', /écono|econo|bourse|finance|invest|crypto|business|entrepren/i],
  ['tech', /tech|linux|unix|mac|apple|ios|android|app|dev|code|coding|program|github|open ?source|privacy|obsidian|pkm|tui|claude|\bai\b|\bia\b|jailbreak|42|software|logiciel|hardware|réseau|network|cyber|hack|terminal|vim|rust|python|javascript/i],
  ['culture', /lego|ninjago|monkie|dreamzzz|tintin|cinéma|cinema|film|movie|livre|book|musique|music|art|bd\b|manga|anime|culture|philo|fuze/i],
  ['sante', /santé|sante|health|médec|medic|nutrition|sport santé/i]
]

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Catégorie devinée : même source dans le catalogue, sinon mots-clés du titre et de l'adresse, sinon « Autres » (''). */
export function guessCategory(title: string, input: string, catalog: { title: string; input: string; category: string }[]): string {
  const t = norm(title)
  const i = norm(input)
  const known = catalog.find((e) => (t && norm(e.title).startsWith(t)) || (t.length > 3 && t.startsWith(norm(e.title))) || norm(e.input) === i)
  if (known) return known.category
  const text = `${title} ${input.replace(/^https?:\/\/(www\.)?/, '')}`
  return KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? ''
}
