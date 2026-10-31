// Génère src/shared/catalog.json à partir de tableaux compacts, plus lisibles à maintenir.
// Usage : node scripts/gen-catalog.mjs
import { writeFileSync } from 'node:fs'

const categories = [
  { id: 'tech', fr: 'Tech & informatique', en: 'Tech & computing', icon: 'cpu' },
  { id: 'politique', fr: 'Politique', en: 'Politics', icon: 'landmark' },
  { id: 'sciences', fr: 'Sciences', en: 'Science', icon: 'atom' },
  { id: 'economie', fr: 'Économie', en: 'Economy', icon: 'trending-up' },
  { id: 'geopolitique', fr: 'Géopolitique', en: 'World affairs', icon: 'globe' },
  { id: 'histoire', fr: 'Histoire', en: 'History', icon: 'scroll' },
  { id: 'sport', fr: 'Sport & échecs', en: 'Sport & chess', icon: 'trophy' },
  { id: 'culture', fr: 'Culture & idées', en: 'Culture & ideas', icon: 'book-open' },
  { id: 'sante', fr: 'Santé', en: 'Health', icon: 'heart-pulse' },
  { id: 'jeux', fr: 'Jeux vidéo', en: 'Video games', icon: 'gamepad-2' }
]

// [catégorie, langue, type, titre, entrée, pré-coché, orientation (−3 gauche radicale … +3 droite radicale)]
const rows = [
  // ── Tech FR
  ['tech', 'fr', 'rss', 'Numerama', 'https://www.numerama.com/feed/', 1],
  ['tech', 'fr', 'rss', 'Frandroid', 'https://www.frandroid.com/feed', 1],
  ['tech', 'fr', 'rss', 'Next', 'https://next.ink/feed/', 1],
  ['tech', 'fr', 'rss', 'Korben', 'https://korben.info/feed', 1],
  ['tech', 'fr', 'rss', 'Journal du Geek', 'https://www.journaldugeek.com/feed/', 0],
  ['tech', 'fr', 'rss', 'Clubic', 'https://www.clubic.com/feed/news.rss', 0],
  ['tech', 'fr', 'rss', 'Presse-citron', 'https://www.presse-citron.net/feed/', 0],
  ['tech', 'fr', 'rss', '01net', 'https://www.01net.com/feed/', 0],
  ['tech', 'fr', 'rss', 'Les Numériques', 'https://www.lesnumeriques.com/rss.xml', 0],
  ['tech', 'fr', 'rss', 'Siècle Digital', 'https://siecledigital.fr/feed/', 0],
  ['tech', 'fr', 'forum', 'LinuxFr.org', 'https://linuxfr.org/news.atom', 1],
  ['tech', 'fr', 'reddit', 'r/developpeurs', 'r/developpeurs', 0],
  // ── Tech EN
  ['tech', 'en', 'rss', 'Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index', 1],
  ['tech', 'en', 'rss', 'The Verge', 'https://www.theverge.com/rss/index.xml', 1],
  ['tech', 'en', 'rss', '404 Media', 'https://www.404media.co/rss/', 1],
  ['tech', 'en', 'rss', 'TechCrunch', 'https://techcrunch.com/feed/', 0],
  ['tech', 'en', 'rss', 'Wired', 'https://www.wired.com/feed/rss', 0],
  ['tech', 'en', 'rss', 'MIT Technology Review', 'https://www.technologyreview.com/feed/', 0],
  ['tech', 'en', 'rss', 'LWN.net', 'https://lwn.net/headlines/rss', 0],
  ['tech', 'en', 'rss', 'Krebs on Security', 'https://krebsonsecurity.com/feed/', 0],
  ['tech', 'en', 'forum', 'Hacker News', 'https://hnrss.org/frontpage', 1],
  ['tech', 'en', 'forum', 'Lobsters', 'https://lobste.rs/rss', 0],
  ['tech', 'en', 'forum', 'Lemmy — Technology', 'https://lemmy.world/feeds/c/technology.xml', 0],
  ['tech', 'en', 'reddit', 'r/technology', 'r/technology', 0],
  ['tech', 'en', 'reddit', 'r/programming', 'r/programming', 0],
  ['tech', 'en', 'reddit', 'r/linux', 'r/linux', 1],
  ['tech', 'en', 'reddit', 'r/sysadmin', 'r/sysadmin', 0],
  ['tech', 'en', 'reddit', 'r/networking', 'r/networking', 0],
  ['tech', 'en', 'reddit', 'r/selfhosted', 'r/selfhosted', 0],
  ['tech', 'en', 'reddit', 'r/netsec', 'r/netsec', 0],
  ['tech', 'en', 'mastodon', 'nixCraft', '@nixCraft@mastodon.social', 0],
  ['tech', 'en', 'bluesky', 'The Verge', '@theverge.com', 0],
  ['tech', 'en', 'bluesky', '404 Media', '@404media.co', 0],

  // ── Politique FR (orientation indicative, à discuter)
  ["politique", 'fr', 'rss', "L'Humanité", 'https://www.humanite.fr/feed', 1, -3],
  ['politique', 'fr', 'rss', 'Le Monde diplomatique', 'https://www.monde-diplomatique.fr/recents.xml', 0, -2],
  ['politique', 'fr', 'rss', 'Mediapart', 'https://www.mediapart.fr/articles/feed', 0, -2],
  ['politique', 'fr', 'rss', 'Reporterre', 'https://reporterre.net/spip.php?page=backend', 0, -2],
  ['politique', 'fr', 'rss', 'Libération', 'https://www.liberation.fr/arc/outboundfeeds/rss-all/?outputType=xml', 1, -2],
  ['politique', 'fr', 'rss', 'Le Monde — Politique', 'https://www.lemonde.fr/politique/rss_full.xml', 1, -1],
  ['politique', 'fr', 'rss', 'franceinfo — Politique', 'https://www.francetvinfo.fr/politique.rss', 1, 0],
  ['politique', 'fr', 'rss', 'Marianne', 'https://www.marianne.net/rss.xml', 0, 0],
  ['politique', 'fr', 'rss', "L'Express", 'https://www.lexpress.fr/arc/outboundfeeds/rss/alaune.xml', 0, 1],
  ['politique', 'fr', 'rss', 'Le Point — Politique', 'https://www.lepoint.fr/politique/rss.xml', 1, 1],
  ['politique', 'fr', 'rss', 'Contrepoints', 'https://www.contrepoints.org/feed', 0, 1],
  ['politique', 'fr', 'rss', 'Le Figaro — Politique', 'https://www.lefigaro.fr/rss/figaro_politique.xml', 1, 2],
  ['politique', 'fr', 'rss', 'Causeur', 'https://www.causeur.fr/feed', 0, 2],
  ['politique', 'fr', 'rss', 'Valeurs actuelles', 'https://www.valeursactuelles.com/feed', 1, 3],
  ['politique', 'fr', 'reddit', 'r/france', 'r/france', 0],
  ['politique', 'fr', 'bluesky', 'Le Monde', '@lemonde.fr', 0],
  // ── Politics EN
  ['politique', 'en', 'rss', 'Jacobin', 'https://jacobin.com/feed/', 0, -3],
  ['politique', 'en', 'rss', 'The Nation', 'https://www.thenation.com/feed/?post_type=article', 0, -2],
  ['politique', 'en', 'rss', 'The Guardian — Politics', 'https://www.theguardian.com/politics/rss', 1, -2],
  ['politique', 'en', 'rss', 'The New York Times — Politics', 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', 1, -1],
  ['politique', 'en', 'rss', 'NPR — Politics', 'https://feeds.npr.org/1014/rss.xml', 0, -1],
  ['politique', 'en', 'rss', 'BBC — Politics', 'https://feeds.bbci.co.uk/news/politics/rss.xml', 1, 0],
  ['politique', 'en', 'rss', 'The Economist', 'https://www.economist.com/united-states/rss.xml', 0, 0],
  ['politique', 'en', 'rss', 'The Wall Street Journal — World', 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', 1, 1],
  ['politique', 'en', 'rss', 'Reason', 'https://reason.com/feed/', 0, 1],
  ['politique', 'en', 'rss', 'The Telegraph — Politics', 'https://www.telegraph.co.uk/politics/rss.xml', 0, 2],
  ['politique', 'en', 'rss', 'National Review', 'https://www.nationalreview.com/feed/', 1, 2],
  ['politique', 'en', 'rss', 'Fox News — Politics', 'https://moxie.foxnews.com/google-publisher/politics.xml', 0, 2],
  ['politique', 'en', 'rss', 'The Federalist', 'https://thefederalist.com/feed/', 0, 3],
  ['politique', 'en', 'rss', 'Breitbart', 'https://feeds.feedburner.com/breitbart', 1, 3],
  ['politique', 'en', 'reddit', 'r/moderatepolitics', 'r/moderatepolitics', 0],
  ['politique', 'en', 'reddit', 'r/PoliticalDiscussion', 'r/PoliticalDiscussion', 0],

  // ── Sciences
  ['sciences', 'fr', 'rss', 'The Conversation France', 'https://theconversation.com/fr/articles.atom', 1],
  ['sciences', 'fr', 'rss', 'CNRS Le journal', 'https://lejournal.cnrs.fr/rss', 1],
  ['sciences', 'fr', 'rss', 'Futura Sciences', 'https://www.futura-sciences.com/rss/actualites.xml', 1],
  ['sciences', 'fr', 'rss', 'Sciences et Avenir', 'https://www.sciencesetavenir.fr/rss.xml', 0],
  ['sciences', 'fr', 'rss', 'Le Monde — Sciences', 'https://www.lemonde.fr/sciences/rss_full.xml', 0],
  ['sciences', 'en', 'rss', 'Quanta Magazine', 'https://www.quantamagazine.org/feed/', 1],
  ['sciences', 'en', 'rss', 'Nature', 'https://www.nature.com/nature.rss', 1],
  ['sciences', 'en', 'rss', 'New Scientist', 'https://www.newscientist.com/feed/home/', 0],
  ['sciences', 'en', 'rss', 'ScienceDaily', 'https://www.sciencedaily.com/rss/all.xml', 0],
  ['sciences', 'en', 'rss', 'Phys.org', 'https://phys.org/rss-feed/', 0],
  ['sciences', 'en', 'rss', 'NASA', 'https://www.nasa.gov/feed/', 1],
  ['sciences', 'en', 'reddit', 'r/science', 'r/science', 0],
  ['sciences', 'en', 'reddit', 'r/askscience', 'r/askscience', 0],
  ['sciences', 'en', 'reddit', 'r/space', 'r/space', 0],
  ['sciences', 'en', 'bluesky', 'Nature', '@nature.com', 0],

  // ── Économie
  ['economie', 'fr', 'rss', 'Les Échos', 'https://syndication.lesechos.fr/rss/rss_une.xml', 1],
  ['economie', 'fr', 'rss', 'Le Monde — Économie', 'https://www.lemonde.fr/economie/rss_full.xml', 1],
  ['economie', 'fr', 'rss', 'Alternatives Économiques', 'https://www.alternatives-economiques.fr/rss.xml', 0],
  ['economie', 'fr', 'rss', 'La Tribune', 'https://www.latribune.fr/feed.xml', 0],
  ['economie', 'fr', 'reddit', 'r/vosfinances', 'r/vosfinances', 0],
  ['economie', 'en', 'rss', 'The Economist — Finance & economics', 'https://www.economist.com/finance-and-economics/rss.xml', 1],
  ['economie', 'en', 'rss', 'BBC — Business', 'https://feeds.bbci.co.uk/news/business/rss.xml', 1],
  ['economie', 'en', 'rss', 'The Guardian — Business', 'https://www.theguardian.com/business/rss', 0],
  ['economie', 'en', 'rss', 'Marginal Revolution', 'https://marginalrevolution.com/feed', 0],
  ['economie', 'en', 'reddit', 'r/AskEconomics', 'r/AskEconomics', 0],
  ['economie', 'en', 'reddit', 'r/economics', 'r/economics', 0],

  // ── Géopolitique
  ['geopolitique', 'fr', 'rss', 'Le Grand Continent', 'https://legrandcontinent.eu/fr/feed/', 1],
  ['geopolitique', 'fr', 'rss', 'Le Monde — International', 'https://www.lemonde.fr/international/rss_full.xml', 1],
  ['geopolitique', 'fr', 'rss', 'Courrier international', 'https://www.courrierinternational.com/feed/all/rss.xml', 1],
  ['geopolitique', 'fr', 'rss', 'France 24', 'https://www.france24.com/fr/rss', 0],
  ['geopolitique', 'fr', 'rss', 'RFI', 'https://www.rfi.fr/fr/rss', 0],
  ['geopolitique', 'fr', 'rss', 'IRIS', 'https://www.iris-france.org/feed/', 0],
  ['geopolitique', 'fr', 'rss', 'Diploweb', 'https://www.diploweb.com/spip.php?page=backend', 0],
  ['geopolitique', 'en', 'rss', 'Foreign Policy', 'https://foreignpolicy.com/feed/', 1],
  ['geopolitique', 'en', 'rss', 'Foreign Affairs', 'https://www.foreignaffairs.com/rss.xml', 1],
  ['geopolitique', 'en', 'rss', 'BBC — World', 'https://feeds.bbci.co.uk/news/world/rss.xml', 1],
  ['geopolitique', 'en', 'rss', 'Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml', 0],
  ['geopolitique', 'en', 'rss', 'The Diplomat', 'https://thediplomat.com/feed/', 0],
  ['geopolitique', 'en', 'rss', 'War on the Rocks', 'https://warontherocks.com/feed/', 0],
  ['geopolitique', 'en', 'reddit', 'r/geopolitics', 'r/geopolitics', 0],

  // ── Histoire
  ['histoire', 'fr', 'rss', "L'Histoire", 'https://www.lhistoire.fr/rss.xml', 1],
  ['histoire', 'fr', 'rss', 'Hérodote.net', 'https://www.herodote.net/rss.xml', 1],
  ['histoire', 'fr', 'rss', 'RetroNews', 'https://www.retronews.fr/rss.xml', 0],
  ['histoire', 'en', 'rss', 'History Today', 'https://www.historytoday.com/feed/rss.xml', 1],
  ['histoire', 'en', 'rss', 'JSTOR Daily', 'https://daily.jstor.org/feed/', 1],
  ['histoire', 'en', 'rss', 'Smithsonian — History', 'https://www.smithsonianmag.com/rss/history/', 0],
  ['histoire', 'en', 'reddit', 'r/AskHistorians', 'r/AskHistorians', 1],
  ['histoire', 'en', 'reddit', 'r/history', 'r/history', 0],

  // ── Sport & échecs
  ['sport', 'fr', 'rss', "L'Équipe", 'https://dwh.lequipe.fr/api/edito/rss?path=/', 1],
  ['sport', 'fr', 'rss', 'RMC Sport', 'https://rmcsport.bfmtv.com/rss/info/flux-rss/flux-toutes-les-actualites/', 0],
  ['sport', 'fr', 'rss', 'So Foot', 'https://www.sofoot.com/rss.xml', 0],
  ['sport', 'fr', 'reddit', 'r/Ligue1', 'r/Ligue1', 0],
  ['sport', 'en', 'rss', 'BBC Sport', 'https://feeds.bbci.co.uk/sport/rss.xml', 1],
  ['sport', 'en', 'rss', 'The Guardian — Sport', 'https://www.theguardian.com/sport/rss', 0],
  ['sport', 'en', 'rss', 'ESPN', 'https://www.espn.com/espn/rss/news', 0],
  ['sport', 'en', 'rss', 'Chess.com — News', 'https://www.chess.com/rss/news', 1],
  ['sport', 'en', 'rss', 'ChessBase', 'https://en.chessbase.com/feed', 0],
  ['sport', 'en', 'reddit', 'r/chess', 'r/chess', 1],

  // ── Culture & idées
  ['culture', 'fr', 'rss', 'Télérama', 'https://www.telerama.fr/rss/une.xml', 1],
  ['culture', 'fr', 'rss', 'Le Monde — Culture', 'https://www.lemonde.fr/culture/rss_full.xml', 1],
  ['culture', 'fr', 'rss', 'Les Inrocks', 'https://www.lesinrocks.com/feed/', 0],
  ['culture', 'en', 'rss', 'Aeon', 'https://aeon.co/feed.rss', 1],
  ['culture', 'en', 'rss', 'The Atlantic', 'https://www.theatlantic.com/feed/all/', 1],
  ['culture', 'en', 'rss', 'The New Yorker — Culture', 'https://www.newyorker.com/feed/culture', 0],
  ['culture', 'en', 'rss', 'Open Culture', 'https://www.openculture.com/feed', 0],
  ['culture', 'en', 'reddit', 'r/books', 'r/books', 0],

  // ── Santé
  ['sante', 'fr', 'rss', 'Le Monde — Santé', 'https://www.lemonde.fr/sante/rss_full.xml', 1],
  ['sante', 'fr', 'rss', 'Inserm — Presse', 'https://presse.inserm.fr/feed/', 1],
  ['sante', 'en', 'rss', 'STAT News', 'https://www.statnews.com/feed/', 1],
  ['sante', 'en', 'rss', 'BBC — Health', 'https://feeds.bbci.co.uk/news/health/rss.xml', 1],
  ['sante', 'en', 'rss', 'The Guardian — Health', 'https://www.theguardian.com/society/health/rss', 0],
  ['sante', 'en', 'reddit', 'r/Health', 'r/Health', 0],

  // ── Jeux vidéo
  ['jeux', 'fr', 'rss', 'jeuxvideo.com', 'https://www.jeuxvideo.com/rss/rss.xml', 1],
  ['jeux', 'fr', 'rss', 'Gamekult', 'https://www.gamekult.com/feed.xml', 1],
  ['jeux', 'fr', 'reddit', 'r/jeuxvideo', 'r/jeuxvideo', 0],
  ['jeux', 'en', 'rss', 'Rock Paper Shotgun', 'https://www.rockpapershotgun.com/feed', 1],
  ['jeux', 'en', 'rss', 'Eurogamer', 'https://www.eurogamer.net/feed', 1],
  ['jeux', 'en', 'rss', 'Polygon', 'https://www.polygon.com/rss/index.xml', 0],
  ['jeux', 'en', 'reddit', 'r/Games', 'r/Games', 0]
]

// Propriétaires, tels que connus lors de la constitution du catalogue (2025) : à vérifier, ça bouge.
// Seuls les cas bien établis sont renseignés.
const owners = {
  'Le Monde — Politique': 'Groupe Le Monde',
  'Le Monde diplomatique': 'Groupe Le Monde (majoritaire), lecteurs et salariés',
  Mediapart: 'Fonds pour une presse libre (non lucratif)',
  Libération: 'Fonds de dotation pour une presse indépendante (créé par Patrick Drahi)',
  'franceinfo — Politique': 'France Télévisions et Radio France (service public)',
  Reporterre: 'Association (non lucratif)',
  "L'Express": 'Alain Weill',
  'Le Point — Politique': 'Groupe Artémis (famille Pinault)',
  'Le Figaro — Politique': 'Groupe Dassault',
  'The Guardian — Politics': 'Scott Trust',
  'The New York Times — Politics': 'The New York Times Company (famille Sulzberger)',
  'NPR — Politics': 'Radio publique (non lucratif)',
  'BBC — Politics': 'Service public britannique',
  'The Economist': 'The Economist Group',
  'The Wall Street Journal — World': 'News Corp (famille Murdoch)',
  'Fox News — Politics': 'Fox Corporation (famille Murdoch)',
  Reason: 'Reason Foundation (non lucratif)'
}

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const ids = new Set()
const entries = rows.map(([category, lang, kind, title, input, preselected, leaning]) => {
  let id = `${lang}-${category}-${slug(title)}`
  while (ids.has(id)) id += '-2'
  ids.add(id)
  const e = { id, category, lang, kind, title, input, preselected: !!preselected }
  if (leaning !== undefined) e.leaning = leaning
  if (owners[title]) e.owner = owners[title]
  return e
})

const catalog = {
  version: 1,
  note:
    "Catalogue de départ. Les adresses de flux sont vérifiées chaque semaine par scripts/check-feeds.mjs. L'orientation politique (−3 gauche radicale … +3 droite radicale) est indicative : c'est un repère pour diversifier ses lectures, pas un jugement. Chacun peut la corriger.",
  categories,
  entries
}

writeFileSync(new URL('../src/shared/catalog.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n')
console.log(`${entries.length} entrées, ${categories.length} catégories`)
