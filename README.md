# Learn

**Lire, surligner, réfléchir.** Learn réunit tes flux RSS, Reddit, Mastodon, Bluesky, forums et articles web dans un lecteur pensé pour la recherche : surlignages, notes en Markdown, export vers Obsidian. Les livres EPUB/PDF et les mind maps arrivent dans les prochaines versions.

Direction graphique inspirée de [Reeder](https://reederapp.com) (2024), avec sa propre identité.

![Lecture, surlignages et notes](docs/screenshots/lecture-sombre.png)

| Thème clair | Hémicycle des médias au premier lancement |
|---|---|
| ![](docs/screenshots/lecture-clair.png) | ![](docs/screenshots/hemicycle.png) |

## Ce que fait la v0.1

- **Toutes tes sources dans une timeline** : RSS, Atom, JSON Feed, Reddit (`r/linux`), Mastodon (`@compte@instance`), Bluesky (`@pseudo.bsky.social`), forums (Hacker News, Lobsters, Lemmy, Discourse, LinuxFr…), YouTube (flux de chaîne). X/Twitter via une passerelle RSS que tu fournis (RSSHub, rss.app…), à régler dans les Réglages.
- **Premier lancement guidé** : langue (FR/EN), thèmes d'intérêt, puis un catalogue de ~140 médias, subreddits et comptes, pré-cochés. Import OPML pour récupérer tes abonnements Reeder.
- **Hémicycle politique** : les médias politiques sont placés sur un demi-cercle, de la gauche radicale à la droite radicale, pour voir d'un coup d'œil si ta sélection penche d'un côté. Le placement est **indicatif** et le dit.
- **Mode lecture** : bascule « Texte du flux / Texte complet » (extraction avec Mozilla Readability).
- **Surlignages en 5 couleurs, notes en Markdown**, panneau récapitulatif, réancrage automatique si le texte bouge.
- **Plus tard, Signets, Favoris, Tags, Liens à lire** (n'importe quelle page web).
- **Export Obsidian** : un fichier Markdown par document, avec frontmatter, identifiants de bloc `^h-…` et métadonnées cachées. Ce que tu écris sous le repère de fin est conservé à chaque réexport.
- **Clavier** : `j`/`k` naviguer, `l` plus tard, `b` signet, `f` favori, `m` lu/non lu, `o` navigateur, `h` surlignages, `r` actualiser, `/` rechercher, `[` barre latérale, `Échap` fermer.
- **Thèmes** sombre / clair / système, police avec ou sans empattement, taille réglable. Compteurs de non-lus désactivés par défaut (comme le nouveau Reeder), activables.

## Installer

Les installeurs sont produits par GitHub Actions (onglet **Actions → Build desktop apps**, ou la page **Releases** pour une version taguée) :

| Système | Fichier |
|---|---|
| macOS (Apple Silicon et Intel) | `Learn-x.y.z-arm64.dmg` / `Learn-x.y.z.dmg` |
| Windows | `Learn Setup x.y.z.exe` |
| Linux | `Learn-x.y.z.AppImage` ou `.deb` |

Les builds ne sont **pas encore signés**. Sur macOS : clic droit sur l'app → *Ouvrir* la première fois. Sur Windows : *Informations complémentaires → Exécuter quand même*.

## Développer

Prérequis : Node.js 22.

```bash
npm install
```

```bash
npm run dev        # l'app Electron avec rechargement à chaud
```

```bash
npm run web        # l'interface seule dans un navigateur, sur une API simulée (http://localhost:5199)
```

```bash
npm test           # tests unitaires et d'intégration (Vitest)
```

```bash
npm run typecheck && npm run build
```

```bash
npm run dist       # installeur pour le système courant, dans release/
```

Pour publier une version : créer un tag `v0.1.0` et le pousser, le workflow produit les trois installeurs et prépare une release en brouillon.

## Architecture

```
src/
  shared/      Modèle de données, ancrage des surlignages, catalogue de médias (JSON)
  main/        Processus principal : base SQLite, flux, extraction, export, IPC
    core.ts    Logique métier sans dépendance à Electron (testée avec Node seul)
    db.ts      SQLite en WebAssembly (sql.js) : aucun module natif à recompiler
    feeds/     Résolution des adresses, téléchargement, analyse RSS/Atom/RDF/JSON Feed
    export/    Génération du Markdown Obsidian
  preload/     Pont minimal et typé entre l'interface et le système
  renderer/    Interface React (Zustand, Framer Motion, Lucide)
tests/         Vitest : analyse, résolution, OPML, Markdown, ancrage, catalogue, intégration HTTP
```

Le modèle (SQLite, surlignages façon W3C Web Annotation, Markdown Obsidian) ne dépend pas d'Electron : la future app native pourra rouvrir la même bibliothèque.

### Sécurité

Le contenu des flux vient d'Internet et doit être traité comme hostile :

- fenêtre en `sandbox`, `contextIsolation`, sans `nodeIntegration` ; l'interface ne parle au système que par une liste fermée de méthodes IPC, et seule la fenêtre de l'app peut les appeler ;
- HTML des articles nettoyé par DOMPurify (pas de scripts, iframes, formulaires, styles ni SVG) ;
- Content-Security-Policy stricte en production (aucun script distant ou inline) ;
- liens ouverts dans le navigateur, navigation interne bloquée, permissions (caméra, micro…) refusées ;
- icônes des sites mises en cache localement (pas de service tiers), SVG refusés.

## Le catalogue de médias

[`scripts/gen-catalog.mjs`](scripts/gen-catalog.mjs) génère [`src/shared/catalog.json`](src/shared/catalog.json). Pour ajouter un média : une ligne dans le script, puis `node scripts/gen-catalog.mjs`.

Les adresses de flux changent souvent : le workflow **Feeds health** les vérifie chaque lundi (et `npm run check-feeds` en local) et liste celles qui ne répondent plus.

L'orientation politique (−3 à +3) est une estimation de Learn à partir des lignes éditoriales publiques. C'est un repère pour diversifier ses lectures, pas un verdict. Pour l'anglais, compare avec [AllSides](https://www.allsides.com/media-bias/ratings) ou [Ad Fontes Media](https://adfontesmedia.com).

## Feuille de route

- **v0.2** : EPUB et PDF avec surlignage ; bilan de lecture dans l'hémicycle ; propriétaires des médias
- **v0.3** : synchronisation bidirectionnelle avec Obsidian (surveillance du coffre)
- **v0.4** : Boards, des mind maps et canvas où glisser surlignages et extraits, export JSON Canvas (Obsidian Canvas)
- **v0.5** : Notion (export puis synchro)
- **Ensuite** : podcasts, vidéos YouTube, extension Obsidian, app native

## Licence

MIT
