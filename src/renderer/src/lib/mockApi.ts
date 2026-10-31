// API simulée, en mémoire : permet de développer et tester l'interface dans un simple navigateur
// (npm run web), sans Electron ni réseau. Jamais utilisée dans l'application réelle.
import type { Board, Counts, Highlight, Item, ItemQuery, LearnAPI, LearnEvent, NewSource, ReadingBalance, Settings, Source, TocEntry, View } from '@shared/types'
import { layoutMindmap } from '@shared/boardLayout'
import { DEFAULT_SETTINGS } from '@shared/types'
import { uid } from '@shared/util'

function thumb(hue: number, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,30%)"/></linearGradient></defs><rect width="320" height="320" fill="url(#g)"/><text x="24" y="290" font-family="sans-serif" font-size="34" font-weight="700" fill="rgba(255,255,255,.85)">${label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function icon(color: string, letter: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="${color}"/><text x="32" y="43" text-anchor="middle" font-family="sans-serif" font-size="32" font-weight="700" fill="#fff">${letter}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const now = Date.now()
const H = 3600_000

const sources: Source[] = [
  { id: 's1', kind: 'rss', title: 'Le Journal Tech', url: 'https://exemple.fr/tech.xml', siteUrl: 'https://exemple.fr', icon: icon('#e5484d', 'T'), category: 'tech', lang: 'fr', createdAt: now },
  { id: 's2', kind: 'rss', title: 'Sciences Ouvertes', url: 'https://exemple.fr/sciences.xml', siteUrl: 'https://exemple.fr', icon: icon('#3e63dd', 'S'), category: 'sciences', lang: 'fr', createdAt: now },
  { id: 's3', kind: 'rss', title: 'Revue d’Histoire', url: 'https://exemple.fr/histoire.xml', icon: icon('#ad7f58', 'H'), category: 'histoire', lang: 'fr', createdAt: now },
  { id: 's4', kind: 'reddit', title: 'r/networking', url: 'https://www.reddit.com/r/networking/.rss', icon: icon('#ff4500', 'r'), createdAt: now },
  { id: 's5', kind: 'mastodon', title: '@exemple@mastodon.social', url: 'https://mastodon.social/@exemple.rss', icon: icon('#6364ff', 'M'), createdAt: now },
  { id: 's6', kind: 'bluesky', title: '@exemple.bsky.social', url: 'https://bsky.app/profile/exemple.bsky.social/rss', createdAt: now },
  { id: 's7', kind: 'forum', title: 'LinuxFr.org', url: 'https://linuxfr.org/news.atom', icon: icon('#2f9e44', 'L'), createdAt: now },
  { id: 'lib', kind: 'book', title: 'Bibliothèque', url: 'learn:library', createdAt: now },
  { id: 'p1', kind: 'rss', title: 'Journal Rouge', url: 'https://exemple.fr/p1.xml', leaning: -2, owner: 'Coopérative', createdAt: now },
  { id: 'p2', kind: 'rss', title: 'Le Quotidien du Centre', url: 'https://exemple.fr/p2.xml', leaning: 0, createdAt: now },
  { id: 'p3', kind: 'rss', title: 'La Gazette Bleue', url: 'https://exemple.fr/p3.xml', leaning: 2, owner: 'Groupe Exemple', createdAt: now },
  { id: 'p4', kind: 'rss', title: 'L’Hebdo Libéral', url: 'https://exemple.fr/p4.xml', leaning: 1, createdAt: now }
]

// ── Livres de démonstration ────────────────────────────────────────────────

const chapters = [
  {
    title: 'I. Le temps des relais',
    html: '<h2>I. Le temps des relais</h2>' + [0, 1, 2].map(() => '<p>Avant l’électricité, transmettre une information à distance supposait une chaîne humaine : coursiers, relais de poste, signaux de fumée. Chaque maillon ajoutait du délai et du risque d’erreur, et la vitesse d’un message dépendait de celle d’un cheval.</p><p>Le génie du télégraphe optique fut de remplacer le transport d’objets par le transport de signes. Une tour voyait la précédente et répétait ses signaux ; le sens du message restait opaque aux opérateurs.</p>').join('') + '<p>Voir aussi <a href="#ch2">le chapitre sur les protocoles</a>.</p>'
  },
  {
    title: 'II. Codes et erreurs',
    html: '<h2>II. Codes et erreurs</h2>' + [0, 1].map(() => '<p>Un code partagé est un contrat. Les opérateurs Chappe disposaient d’un vocabulaire de plusieurs milliers d’entrées, et toute ambiguïté coûtait cher. Les premiers mécanismes de correction d’erreurs étaient humains : répéter, accuser réception, signaler un doute.</p>').join('')
  },
  {
    title: 'III. Naissance des protocoles',
    html: '<h2>III. Naissance des protocoles</h2>' + [0, 1].map(() => '<p>Un protocole fixe qui parle, quand, et comment l’on sait que le message est arrivé. Les réseaux modernes ont formalisé ces règles en couches, chacune ignorant le détail des autres : exactement comme les guetteurs des tours ignoraient le sens des dépêches.</p>').join('')
  }
]
const bookToc: TocEntry[] = chapters.map((c, i) => ({ title: c.title, chapter: i, depth: 0 }))

/** Petit PDF valide généré à la volée (3 pages de texte), pour tester le lecteur PDF sans fichier. */
function samplePdf(): Uint8Array {
  const esc = (t: string): string =>
    Array.from(t)
      .map((c) => {
        const code = c.charCodeAt(0)
        if (c === '(' || c === ')' || c === '\\') return '\\' + c
        if (code > 126) return '\\' + (code === 8217 ? 146 : code).toString(8).padStart(3, '0')
        return c
      })
      .join('')
  const pages = [
    ['Histoire des réseaux', 'Notes de lecture', '', 'Le télégraphe optique de Chappe relie Paris à Lille en 1794.', 'Les opérateurs relaient des signaux sans en connaître le sens.', 'Cette séparation entre transport et signification annonce', 'les couches des réseaux modernes.'],
    ['Chapitre 2', '', 'Le télégraphe électrique supplante le réseau optique au XIXe siècle.', 'Il est plus rapide et indifférent au brouillard.', 'Le code Morse devient le premier protocole de masse.'],
    ['Chapitre 3', '', 'ARPANET relie quatre universités en 1969.', 'La commutation de paquets découpe les messages en morceaux', 'qui voyagent chacun par leur propre chemin.']
  ]
  const objs: string[] = []
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  pages.forEach((lines, i) => {
    const stream = ['BT', '/F1 22 Tf', '72 720 Td', `(${esc(lines[0])}) Tj`, '/F1 13 Tf', '0 -34 Td', ...lines.slice(1).flatMap((l) => [`(${esc(l)}) Tj`, '0 -20 Td']), 'ET'].join('\n')
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Uint8Array.from(out, (c) => c.charCodeAt(0))
}

const lorem = [
  'Pendant des décennies, le routage d’Internet a reposé sur une confiance implicite entre opérateurs. Chaque réseau annonçait les préfixes qu’il savait joindre, et ses voisins le croyaient sur parole.',
  'Cette architecture a permis une croissance spectaculaire, mais elle a aussi rendu possibles des détournements de trafic à grande échelle, parfois accidentels, parfois délibérés.',
  'Les mécanismes de validation cryptographique des annonces se sont imposés lentement : ils exigent une coordination entre des milliers d’acteurs aux intérêts divergents.',
  'L’histoire rappelle que les infrastructures critiques évoluent rarement par rupture. Le télégraphe, puis le téléphone, ont connu les mêmes tensions entre ouverture et contrôle.',
  'Reste une question ouverte : qui doit porter le coût de la sécurité d’un bien commun dont tout le monde profite, mais que personne ne possède ?'
]

const titles: [string, string, number, string][] = [
  ['s1', 'Comment le routage d’Internet tente enfin de se sécuriser', 2, 'BGP'],
  ['s2', 'Une nouvelle mesure de la constante de Hubble relance le débat', 5, 'Cosmos'],
  ['s3', 'Le télégraphe Chappe, premier réseau de données de l’histoire', 9, 'Chappe'],
  ['s4', 'Retour d’expérience : migrer 400 commutateurs sans coupure', 13, 'Switch'],
  ['s1', 'Les processeurs RISC-V arrivent dans les serveurs', 20, 'RISC-V'],
  ['s5', '', 26, ''],
  ['s2', 'Ce que les échecs ont appris aux chercheurs en IA', 30, 'Échecs'],
  ['s7', 'Noyau Linux : ce qui change dans la nouvelle version', 40, 'Linux'],
  ['s3', 'Pourquoi l’imprimerie a mis un siècle à transformer l’Europe', 52, 'Gutenberg'],
  ['s6', '', 60, ''],
  ['s1', 'Chiffrement post-quantique : les navigateurs franchissent le pas', 75, 'PQC'],
  ['s2', 'Le sommeil consolide-t-il vraiment la mémoire ?', 90, 'Neuro']
]

const items: Item[] = titles.map(([sourceId, title, hoursAgo, label], i) => {
  const social = !title
  const body = social
    ? `<p>Lecture du jour : un excellent fil sur l’histoire des protocoles réseau et les compromis de conception qui nous suivent encore aujourd’hui. #réseau #histoire</p>`
    : lorem.map((p) => `<p>${p}</p>`).join('') + `<h2>Une question de coordination</h2>` + lorem.slice(0, 3).map((p) => `<p>${p}</p>`).join('')
  return {
    id: `i${i + 1}`,
    sourceId,
    guid: `g${i}`,
    url: `https://exemple.fr/article-${i + 1}`,
    title: social ? 'Lecture du jour : un excellent fil sur l’histoire des protocoles réseau et les compromis de conception…' : title,
    author: social ? undefined : ['Claire Martin', 'Hugo Bernard', 'Inès Moreau', undefined][i % 4],
    summary: social ? 'Lecture du jour : un excellent fil sur l’histoire des protocoles réseau et les compromis de conception qui nous suivent encore aujourd’hui.' : lorem[0] + ' ' + lorem[1],
    contentHtml: body,
    imageUrl: label ? thumb((i * 47) % 360, label) : undefined,
    publishedAt: now - hoursAgo * H,
    fetchedAt: now,
    read: i > 6,
    later: i === 2 || i === 6,
    bookmarked: i === 0,
    favorite: i === 2,
    tags: i === 0 ? ['Réseau'] : i === 2 ? ['Histoire'] : i === 6 ? ['Échecs', 'Sciences'] : [],
    highlightCount: 0
  }
})

items.push(
  {
    id: 'b1',
    sourceId: 'lib',
    guid: 'b1',
    title: 'Une brève histoire des réseaux',
    author: 'Inès Moreau',
    summary: '3 chapitres',
    imageUrl: thumb(160, 'EPUB'),
    publishedAt: now - 3 * H,
    fetchedAt: now,
    read: true,
    later: false,
    bookmarked: false,
    favorite: true,
    tags: [],
    format: 'epub',
    progress: 0.34,
    position: JSON.stringify({ chapter: 1, scroll: 0 })
  },
  {
    id: 'b2',
    sourceId: 'lib',
    guid: 'b2',
    title: 'notes-reseaux.pdf',
    publishedAt: now - 4 * H,
    fetchedAt: now,
    read: false,
    later: false,
    bookmarked: false,
    favorite: false,
    tags: [],
    format: 'pdf',
    progress: 0
  },
  ...[
    ['p1', 6],
    ['p2', 3],
    ['p3', 2],
    ['p4', 1]
  ].flatMap(([sourceId, n]) =>
    Array.from({ length: n as number }, (_, k) => ({
      id: `${sourceId}-${k}`,
      sourceId: sourceId as string,
      guid: `${sourceId}-${k}`,
      title: `Article politique ${k + 1}`,
      summary: 'Exemple.',
      publishedAt: now - (100 + k) * H,
      fetchedAt: now,
      read: true,
      readAt: now - k * H,
      later: false,
      bookmarked: false,
      favorite: false,
      tags: []
    }))
  )
)

let highlights: Highlight[] = []

const boards: Board[] = [
  {
    id: 'board1',
    title: 'Confiance et réseaux',
    mode: 'mindmap',
    createdAt: now,
    updatedAt: now,
    data: {
      nodes: [
        { id: 'r', kind: 'note', text: 'Pourquoi les réseaux reposent-ils sur la confiance ?', x: 0, y: 0, root: true },
        { id: 'q1', kind: 'excerpt', itemId: 'i1', layer: 'feed', quote: 'Chaque réseau annonçait les préfixes qu’il savait joindre, et ses voisins le croyaient sur parole.', itemTitle: 'Comment le routage d’Internet tente enfin de se sécuriser', color: 'yellow', x: 0, y: 0 },
        { id: 'q2', kind: 'excerpt', itemId: 'i3', layer: 'feed', quote: 'Les opérateurs ne comprenaient pas les messages qu’ils relayaient.', itemTitle: 'Le télégraphe Chappe, premier réseau de données de l’histoire', color: 'green', x: 0, y: 0 },
        { id: 'n1', kind: 'note', text: 'Même problème en 1794 et en 2026 : qui vérifie le relais ?', x: 0, y: 0 },
        { id: 'n2', kind: 'note', text: 'Contre-exemple : la validation cryptographique (RPKI)', x: 0, y: 0 }
      ],
      edges: [
        { id: 'e1', from: 'r', to: 'q1' },
        { id: 'e2', from: 'r', to: 'q2' },
        { id: 'e3', from: 'q2', to: 'n1', label: 'soutient' },
        { id: 'e4', from: 'q1', to: 'n2', label: 'contredit' }
      ]
    }
  }
]
for (const b of boards) for (const [id, p] of layoutMindmap(b.data)) Object.assign(b.data.nodes.find((n) => n.id === id)!, p)
let settings: Settings = { ...DEFAULT_SETTINGS, onboarded: new URLSearchParams(location.search).get('onboarding') === null, obsidianVault: '/Users/moi/Obsidian' }
const listeners = new Set<(e: LearnEvent) => void>()
const emit = (e: LearnEvent): void => listeners.forEach((l) => l(e))
const delay = <T,>(v: T, ms = 60): Promise<T> => new Promise((r) => setTimeout(() => r(structuredClone(v)), ms))

function matches(view: View, it: Item): boolean {
  const src = sources.find((s) => s.id === it.sourceId)
  switch (view.type) {
    case 'home':
      return src?.kind !== 'links' && src?.kind !== 'book' && !src?.leaning && src?.leaning !== 0
    case 'library':
      return src?.kind === 'book'
    case 'later':
      return it.later
    case 'bookmarks':
      return it.bookmarked
    case 'favorites':
      return it.favorite
    case 'links':
      return src?.kind === 'links'
    case 'highlights':
      return highlights.some((h) => h.itemId === it.id)
    case 'tag':
      return it.tags.includes(view.tag)
    case 'kind':
      return src?.kind === view.kind
    case 'source':
      return it.sourceId === view.sourceId
    default:
      return false
  }
}

function counts(): Counts {
  const tags: Record<string, number> = {}
  items.forEach((i) => i.tags.forEach((t) => (tags[t] = (tags[t] ?? 0) + 1)))
  const unreadBySource: Record<string, number> = {}
  items.filter((i) => !i.read).forEach((i) => (unreadBySource[i.sourceId] = (unreadBySource[i.sourceId] ?? 0) + 1))
  return {
    later: items.filter((i) => i.later).length,
    bookmarks: items.filter((i) => i.bookmarked).length,
    favorites: items.filter((i) => i.favorite).length,
    links: items.filter((i) => matches({ type: 'links' }, i)).length,
    library: items.filter((i) => matches({ type: 'library' }, i)).length,
    highlights: new Set(highlights.map((h) => h.itemId)).size,
    tags,
    unreadBySource,
    unreadTotal: items.filter((i) => !i.read).length
  }
}

function addMockSource(n: NewSource): Source {
  const s: Source = { id: uid('s_'), kind: n.kind ?? 'rss', title: n.title ?? n.input, url: n.input, category: n.category, lang: n.lang, createdAt: Date.now() }
  sources.push(s)
  return s
}

export const mockApi: LearnAPI = {
  platform: 'web',
  getSettings: () => delay(settings),
  updateSettings: async (patch) => {
    settings = { ...settings, ...patch }
    return delay(settings)
  },
  listSources: () => delay(sources),
  resolveInput: async (input) => {
    if (input.startsWith('r/')) return { kind: 'reddit', url: `https://www.reddit.com/${input}/.rss`, title: input }
    if (/^@[^@]+@/.test(input)) return { kind: 'mastodon', url: input, title: input }
    if (input.startsWith('@')) return { kind: 'bluesky', url: input, title: input }
    return { kind: 'rss', url: input }
  },
  addSource: async (n) => delay(addMockSource(n), 400),
  addSources: async (list) => {
    const added = list.map(addMockSource)
    return delay({ added, failed: [] }, 900)
  },
  updateSource: async (id, patch) => {
    const s = sources.find((x) => x.id === id)!
    Object.assign(s, patch)
    return delay(s)
  },
  removeSource: async (id) => {
    sources.splice(
      sources.findIndex((s) => s.id === id),
      1
    )
    emit({ type: 'items-changed' })
  },
  listItems: async (q: ItemQuery) => {
    const search = q.search?.toLowerCase().trim()
    const list = items
      .filter((i) => matches(q.view, i) && (!q.unreadOnly || !i.read) && (!search || i.title.toLowerCase().includes(search)))
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100))
      .map((i) => ({ ...i, contentHtml: undefined, highlightCount: highlights.filter((h) => h.itemId === i.id).length }))
    return delay(list)
  },
  getItem: async (id) => delay(items.find((i) => i.id === id) ?? null),
  updateItem: async (id, patch) => {
    const it = items.find((i) => i.id === id)!
    Object.assign(it, patch)
    return delay(it)
  },
  markAllRead: async (view) => {
    items.filter((i) => matches(view, i)).forEach((i) => (i.read = true))
  },
  extractFullText: async (id) => {
    const it = items.find((i) => i.id === id)!
    it.fullHtml = (it.contentHtml ?? '') + '<p><em>(Texte complet simulé.)</em></p>'
    return delay(it, 500)
  },
  saveLink: async (url) => {
    let src = sources.find((s) => s.kind === 'links')
    if (!src) {
      src = { id: 'links', kind: 'links', title: 'Liens enregistrés', url: 'learn:links', createdAt: Date.now() }
      sources.push(src)
    }
    const it: Item = { ...items[0], id: uid('i_'), sourceId: src.id, url, title: url, later: true, bookmarked: false, favorite: false, tags: [], publishedAt: Date.now() }
    items.push(it)
    emit({ type: 'items-changed' })
    return delay(it, 500)
  },
  counts: () => delay(counts()),
  allTags: () => delay([...new Set(items.flatMap((i) => i.tags))].sort()),
  listHighlights: (itemId) => delay(itemId ? highlights.filter((h) => h.itemId === itemId) : highlights),
  addHighlight: async (h) => {
    const created: Highlight = { ...h, id: uid('h_'), createdAt: Date.now(), updatedAt: Date.now() }
    highlights.push(created)
    return delay(created)
  },
  updateHighlight: async (id, patch) => {
    highlights = highlights.map((h) => (h.id === id ? { ...h, ...patch, updatedAt: Date.now() } : h))
    return delay(highlights.find((h) => h.id === id)!)
  },
  removeHighlight: async (id) => {
    highlights = highlights.filter((h) => h.id !== id)
  },
  importBooks: async () => delay({ added: [], failed: [] }),
  bookToc: async () => delay(bookToc),
  bookChapter: async (_id, index) => delay({ ...chapters[index], count: chapters.length }, 120),
  readBookFile: async () => samplePdf(),
  savePosition: async (id, position, progress) => {
    const it = items.find((i) => i.id === id)
    if (it) Object.assign(it, { position, progress })
  },
  updateBook: async (id, patch) => {
    const it = items.find((i) => i.id === id)!
    Object.assign(it, patch)
    return delay(it)
  },
  readingBalance: async (days): Promise<ReadingBalance> => {
    const since = Date.now() - days * 24 * H
    const entries = sources
      .filter((s) => s.leaning !== undefined)
      .map((s) => ({ sourceId: s.id, title: s.title, leaning: s.leaning!, owner: s.owner, reads: items.filter((i) => i.sourceId === s.id && (i.readAt ?? 0) >= since).length }))
      .sort((a, b) => a.leaning - b.leaning)
    return delay({ days, entries, otherReads: items.filter((i) => i.read && !sources.find((s) => s.id === i.sourceId)?.leaning).length })
  },
  listBoards: async () => delay(boards.map((b) => ({ id: b.id, title: b.title, mode: b.mode, nodeCount: b.data.nodes.length, updatedAt: b.updatedAt }))),
  createBoard: async (title, mode) => {
    const b: Board = { id: uid('b_'), title, mode, data: { nodes: [], edges: [] }, createdAt: Date.now(), updatedAt: Date.now() }
    boards.unshift(b)
    return delay(b)
  },
  getBoard: async (id) => delay(boards.find((b) => b.id === id) ?? null),
  saveBoard: async (id, patch) => {
    const b = boards.find((x) => x.id === id)!
    Object.assign(b, patch, { updatedAt: Date.now() })
    return delay(b)
  },
  deleteBoard: async (id) => {
    boards.splice(
      boards.findIndex((b) => b.id === id),
      1
    )
  },
  addToBoard: async (id, node) => {
    const b = boards.find((x) => x.id === id)!
    const nid = uid('n_')
    const root = b.data.nodes.find((n) => n.root) ?? b.data.nodes[0]
    b.data.nodes.push({ ...node, id: nid, x: 0, y: 0, root: !root })
    if (root) b.data.edges.push({ id: uid('e_'), from: root.id, to: nid })
    for (const [i, p] of layoutMindmap(b.data)) Object.assign(b.data.nodes.find((n) => n.id === i)!, p)
    return delay(b)
  },
  allHighlights: async () => delay(highlights.map((h) => ({ ...h, itemTitle: items.find((i) => i.id === h.itemId)?.title ?? '' }))),
  exportBoardToObsidian: async (id) => delay({ path: `/Users/moi/Obsidian/Learn/Boards/${boards.find((b) => b.id === id)?.title}.canvas` }),
  boardMarkdown: async (id) => delay(`# ${boards.find((b) => b.id === id)?.title}\n`),
  refresh: async () => {
    emit({ type: 'refresh-started' })
    await delay(null, 800)
    const result = { sources: sources.length, newItems: 0, errors: [] }
    emit({ type: 'refresh-finished', result })
    return result
  },
  chooseFolder: () => delay('/Users/moi/Obsidian'),
  exportToObsidian: async () => delay({ path: '/Users/moi/Obsidian/Learn/Article.md' }),
  exportAllToObsidian: async () => delay({ count: new Set(highlights.map((h) => h.itemId)).size, folder: '/Users/moi/Obsidian/Learn' }),
  markdownFor: async (id) => delay(`# ${items.find((i) => i.id === id)?.title}\n`),
  importOpml: async () => delay({ added: 0, failed: 0 }),
  exportOpml: async () => delay(null),
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener')
  },
  onEvent: (cb) => {
    listeners.add(cb)
    return () => listeners.delete(cb)
  }
}
