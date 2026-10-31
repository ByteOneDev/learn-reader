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

// Sources plus pointues, podcasts et chaînes YouTube (marquées « niche » à l'affichage).
// Même format que `rows`. Les chaînes YouTube sont données par leur @pseudo : Learn trouve leur flux.
const nicheRows = [
  // ── Tech
  ['tech', 'fr', 'rss', 'Stéphane Bortzmeyer (réseaux, DNS)', 'https://www.bortzmeyer.org/feed-full.atom', 0],
  ['tech', 'fr', 'rss', 'CERT-FR — Alertes et avis', 'https://www.cert.ssi.gouv.fr/feed/', 0],
  ['tech', 'fr', 'rss', 'La Quadrature du Net', 'https://www.laquadrature.net/feed/', 0],
  ['tech', 'fr', 'rss', 'Framablog', 'https://framablog.org/feed/', 0],
  ['tech', 'fr', 'forum', 'Journal du hacker', 'https://www.journalduhacker.net/rss', 0],
  ['tech', 'fr', 'podcast', 'Les Cast Codeurs', 'https://lescastcodeurs.libsyn.com/rss', 0],
  ['tech', 'fr', 'youtube', 'Underscore_', 'https://www.youtube.com/@Underscore_', 1],
  ['tech', 'fr', 'youtube', 'Micode', 'https://www.youtube.com/@Micode', 0],
  ['tech', 'fr', 'youtube', 'Cocadmin (sysadmin, réseaux)', 'https://www.youtube.com/@cocadmin', 0],
  ['tech', 'fr', 'youtube', 'Grafikart', 'https://www.youtube.com/@grafikart', 0],
  ['tech', 'en', 'rss', 'Julia Evans', 'https://jvns.ca/atom.xml', 0],
  ['tech', 'en', 'rss', 'Cloudflare Blog', 'https://blog.cloudflare.com/rss/', 0],
  ['tech', 'en', 'rss', 'APNIC Blog (Internet, routage)', 'https://blog.apnic.net/feed/', 0],
  ['tech', 'en', 'rss', 'ipSpace.net (réseaux)', 'https://blog.ipspace.net/atom.xml', 0],
  ['tech', 'en', 'rss', 'Schneier on Security', 'https://www.schneier.com/feed/atom/', 0],
  ['tech', 'en', 'rss', 'Dan Luu', 'https://danluu.com/atom.xml', 0],
  ['tech', 'en', 'rss', 'Simon Willison', 'https://simonwillison.net/atom/everything/', 0],
  ['tech', 'en', 'forum', 'Hacker News — Best', 'https://hnrss.org/best', 0],
  ['tech', 'en', 'podcast', 'Darknet Diaries', 'https://feeds.megaphone.fm/darknetdiaries', 1],
  ['tech', 'en', 'podcast', 'Security Now', 'https://feeds.twit.tv/sn.xml', 0],
  ['tech', 'en', 'podcast', 'The Changelog', 'https://changelog.com/podcast/feed', 0],
  ['tech', 'en', 'podcast', 'Hard Fork', 'https://feeds.simplecast.com/l2i9YnTd', 0],
  ['tech', 'en', 'youtube', 'NetworkChuck', 'https://www.youtube.com/@NetworkChuck', 0],
  ['tech', 'en', 'youtube', 'Computerphile', 'https://www.youtube.com/@Computerphile', 0],
  ['tech', 'en', 'youtube', 'Ben Eater', 'https://www.youtube.com/@BenEater', 0],
  ['tech', 'en', 'youtube', 'Low Level', 'https://www.youtube.com/@LowLevelTV', 0],
  ['tech', 'en', 'youtube', 'Fireship', 'https://www.youtube.com/@Fireship', 0],

  // ── Politique
  ['politique', 'fr', 'rss', 'Le Vent Se Lève', 'https://lvsl.fr/feed/', 0, -2],
  ['politique', 'fr', 'rss', "L'Incorrect", 'https://lincorrect.org/feed/', 0, 2],
  ['politique', 'fr', 'youtube', 'HugoDécrypte', 'https://www.youtube.com/@HugoDecrypte', 0],
  ['politique', 'en', 'rss', 'Slow Boring', 'https://www.slowboring.com/feed', 0, -1],
  ['politique', 'en', 'rss', 'The Free Press', 'https://www.thefp.com/feed', 0, 1],
  ['politique', 'en', 'podcast', 'The Daily (NYT)', 'https://feeds.simplecast.com/54nAGcIl', 0],
  ['politique', 'en', 'youtube', 'Johnny Harris', 'https://www.youtube.com/@johnnyharris', 0],

  // ── Sciences
  ['sciences', 'fr', 'rss', 'Science étonnante (blog)', 'https://scienceetonnante.com/feed/', 0],
  ['sciences', 'fr', 'youtube', 'Science Étonnante', 'https://www.youtube.com/@ScienceEtonnante', 1],
  ['sciences', 'fr', 'youtube', 'DirtyBiology', 'https://www.youtube.com/@DirtyBiology', 0],
  ['sciences', 'fr', 'youtube', 'Le Réveilleur', 'https://www.youtube.com/@LeReveilleur', 0],
  ['sciences', 'fr', 'youtube', 'Monsieur Phi', 'https://www.youtube.com/@MonsieurPhi', 0],
  ['sciences', 'fr', 'youtube', 'Fouloscopie', 'https://www.youtube.com/@Fouloscopie', 0],
  ['sciences', 'en', 'rss', 'Astral Codex Ten', 'https://www.astralcodexten.com/feed', 0],
  ['sciences', 'en', 'rss', 'Nautilus', 'https://nautil.us/feed/', 0],
  ['sciences', 'en', 'rss', 'Retraction Watch', 'https://retractionwatch.com/feed/', 0],
  ['sciences', 'en', 'rss', 'Terence Tao', 'https://terrytao.wordpress.com/feed/', 0],
  ['sciences', 'en', 'podcast', 'Radiolab', 'https://feeds.simplecast.com/EmVW7VGp', 0],
  ['sciences', 'en', 'youtube', 'Kurzgesagt', 'https://www.youtube.com/@kurzgesagt', 1],
  ['sciences', 'en', 'youtube', 'Veritasium', 'https://www.youtube.com/@veritasium', 0],
  ['sciences', 'en', 'youtube', '3Blue1Brown', 'https://www.youtube.com/@3blue1brown', 0],
  ['sciences', 'en', 'youtube', 'Numberphile', 'https://www.youtube.com/@numberphile', 0],

  // ── Économie
  ['economie', 'fr', 'youtube', 'Gaspard G', 'https://www.youtube.com/@GaspardG', 0],
  ['economie', 'en', 'rss', 'Noahpinion', 'https://www.noahpinion.blog/feed', 0],
  ['economie', 'en', 'podcast', 'Planet Money', 'https://feeds.npr.org/510289/podcast.xml', 0],
  ['economie', 'en', 'podcast', 'Freakonomics Radio', 'https://feeds.simplecast.com/Y8lFbOT4', 0],
  ['economie', 'en', 'youtube', 'PolyMatter', 'https://www.youtube.com/@PolyMatter', 0],
  ['economie', 'en', 'youtube', 'Wendover Productions', 'https://www.youtube.com/@Wendoverproductions', 0],

  // ── Géopolitique
  ['geopolitique', 'fr', 'youtube', 'Mister Geopolitix', 'https://www.youtube.com/@MisterGeopolitix', 0],
  ['geopolitique', 'en', 'youtube', 'CaspianReport', 'https://www.youtube.com/@CaspianReport', 0],
  ['geopolitique', 'en', 'youtube', 'RealLifeLore', 'https://www.youtube.com/@RealLifeLore', 0],

  // ── Histoire
  ['histoire', 'fr', 'rss', 'Actuel Moyen Âge', 'https://actuelmoyenage.wordpress.com/feed/', 0],
  ['histoire', 'fr', 'youtube', 'Nota Bene', 'https://www.youtube.com/@NotaBeneMovies', 0],
  ['histoire', 'fr', 'youtube', 'Histony', 'https://www.youtube.com/@Histony', 0],
  ['histoire', 'en', 'rss', 'A Collection of Unmitigated Pedantry', 'https://acoup.blog/feed/', 0],
  ['histoire', 'en', 'rss', 'The Public Domain Review', 'https://publicdomainreview.org/rss.xml', 0],
  ['histoire', 'en', 'podcast', 'In Our Time (BBC)', 'https://podcasts.files.bbci.co.uk/b006qykl.rss', 0],
  ['histoire', 'en', 'youtube', 'OverSimplified', 'https://www.youtube.com/@OverSimplified', 0],
  ['histoire', 'en', 'youtube', 'Kings and Generals', 'https://www.youtube.com/@KingsandGenerals', 0],

  // ── Sport & échecs
  ['sport', 'fr', 'youtube', 'Blitzstream', 'https://www.youtube.com/@Blitzstream', 0],
  ['sport', 'en', 'rss', 'Lichess Blog', 'https://lichess.org/blog.atom', 0],
  ['sport', 'en', 'youtube', 'GothamChess', 'https://www.youtube.com/@GothamChess', 0],
  ['sport', 'en', 'youtube', 'agadmator', 'https://www.youtube.com/@agadmator', 0],

  // ── Culture & idées
  ['culture', 'fr', 'podcast', 'Les Pieds sur terre (France Culture)', 'https://radiofrance-podcast.net/podcast09/rss_10078.xml', 0],
  ['culture', 'fr', 'youtube', 'Linguisticae', 'https://www.youtube.com/@Linguisticae', 0],
  ['culture', 'en', 'rss', 'The Marginalian', 'https://www.themarginalian.org/feed/', 0],
  ['culture', 'en', 'rss', 'Kottke', 'https://feeds.kottke.org/main', 0],
  ['culture', 'en', 'podcast', '99% Invisible', 'https://feeds.simplecast.com/BqbsxVfO', 0],
  ['culture', 'en', 'youtube', 'Nerdwriter', 'https://www.youtube.com/@Nerdwriter1', 0],

  // ── Santé
  ['sante', 'en', 'rss', 'Science-Based Medicine', 'https://sciencebasedmedicine.org/feed/', 0],

  // ── Jeux vidéo
  ['jeux', 'fr', 'youtube', 'Joueur du Grenier', 'https://www.youtube.com/@joueurdugrenier', 0],
  ['jeux', 'en', 'rss', 'Game Developer', 'https://www.gamedeveloper.com/rss.xml', 0],
  ['jeux', 'en', 'youtube', "Game Maker's Toolkit", 'https://www.youtube.com/@GMTK', 0],
  ['jeux', 'en', 'youtube', 'Noclip', 'https://www.youtube.com/@NoclipDocs', 0],

  // ── Dans l'esprit de tes abonnements Reeder : tech et vulgarisation francophones.
  // Les podcasts sont donnés par leur nom (« podcast:… ») : Learn trouve le flux dans Apple Podcasts.
  ['tech', 'fr', 'rss', 'BDM (Blog du Modérateur)', 'https://www.blogdumoderateur.com/feed/', 0],
  ['tech', 'fr', 'rss', 'PhonAndroid', 'https://www.phonandroid.com/feed', 0],
  ['tech', 'fr', 'podcast', 'Choses à Savoir TECH', 'podcast:Choses à Savoir TECH', 1],
  ['tech', 'fr', 'podcast', 'De quoi jme mail', 'podcast:De quoi jme mail', 0],
  ['tech', 'fr', 'podcast', 'Mémoire vive', 'podcast:Mémoire vive', 0],
  ['tech', 'fr', 'podcast', 'Tech_Sama Show', 'podcast:Tech_Sama Show', 0],
  ['tech', 'fr', 'podcast', 'Speakeasy (Influx)', 'podcast:Speakeasy Influx', 0],
  ['tech', 'fr', 'podcast', 'Le podcast de Robin', 'podcast:Le podcast de Robin', 0],
  ['tech', 'fr', 'podcast', 'Underscore_ (podcast)', 'podcast:Underscore_', 0],
  ['tech', 'fr', 'youtube', 'Léo Duff', 'https://www.youtube.com/@LeoDuff', 0],
  ['tech', 'fr', 'youtube', 'Nightech', 'https://www.youtube.com/@Nightech', 0],
  ['tech', 'fr', 'youtube', 'Numerama (vidéos)', 'https://www.youtube.com/@Numerama', 0],
  ['tech', 'fr', 'youtube', 'V2F', 'https://www.youtube.com/@V2F', 0],
  ['tech', 'fr', 'youtube', 'Millomaker', 'https://www.youtube.com/@Millomaker', 0],
  ['tech', 'fr', 'youtube', 'Paulygones', 'https://www.youtube.com/@Paulygones', 0],
  ['tech', 'fr', 'youtube', 'Robin Tyonnel', 'https://www.youtube.com/@RobinTyonnel', 0],
  ['tech', 'fr', 'youtube', 'Charlie Haid', 'https://www.youtube.com/@CharlieHaid', 0],
  ['tech', 'en', 'podcast', 'Waveform: The MKBHD Podcast', 'podcast:Waveform: The MKBHD Podcast', 1],
  ['tech', 'en', 'youtube', 'Marques Brownlee (MKBHD)', 'https://www.youtube.com/@mkbhd', 0],
  ['tech', 'en', 'youtube', 'Linus Tech Tips', 'https://www.youtube.com/@LinusTechTips', 0],
  ['tech', 'en', 'youtube', 'Dave2D', 'https://www.youtube.com/@Dave2D', 0],
  ['tech', 'en', 'youtube', 'Snazzy Labs', 'https://www.youtube.com/@SnazzyLabs', 0],
  ['tech', 'en', 'reddit', 'r/macapps', 'r/macapps', 0],
  ['tech', 'en', 'reddit', 'r/apple', 'r/apple', 0],
  ['politique', 'fr', 'podcast', 'HugoDécrypte — Actus du jour', 'podcast:HugoDécrypte Actus du jour', 0],
  ['histoire', 'fr', 'podcast', "Entrez dans l'Histoire", "podcast:Entrez dans l'Histoire", 0],
  ['histoire', 'fr', 'youtube', 'La Folle Histoire', 'https://www.youtube.com/@LaFolleHistoire', 0],
  ['culture', 'fr', 'podcast', 'ÊTRE ÉTUDIANT — Le Podcast', 'podcast:ÊTRE ÉTUDIANT Le Podcast', 0],
  ['culture', 'fr', 'youtube', 'Fabien Olicard', 'https://www.youtube.com/@FabienOlicard', 0],
  ['culture', 'fr', 'youtube', 'Abrège', 'https://www.youtube.com/@Abrege', 0],
  ['culture', 'fr', 'youtube', 'Adrien Boulisset', 'https://www.youtube.com/@AdrienBoulisset', 0]
]

const slug = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const ids = new Set()
const entries = [...rows.map((r) => [...r.slice(0, 6), r[6], false]), ...nicheRows.map((r) => [...r.slice(0, 6), r[6], true])].map(([category, lang, kind, title, input, preselected, leaning, niche]) => {
  let id = `${lang}-${category}-${slug(title)}`
  while (ids.has(id)) id += '-2'
  ids.add(id)
  const e = { id, category, lang, kind, title, input, preselected: !!preselected }
  if (leaning !== undefined) e.leaning = leaning
  if (owners[title]) e.owner = owners[title]
  if (niche) e.niche = true
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
