## Installer

| Système | Fichier à télécharger |
|---|---|
| Mac Apple Silicon (M1, M2, M3, M4…) | `Learn-…-arm64.dmg` |
| Mac Intel | `Learn-….dmg` (sans `arm64`) |
| Windows | `Learn Setup ….exe` |
| Linux | `Learn-….AppImage` (ou `.deb` pour Debian/Ubuntu) |

**Mac** : ouvre le `.dmg` et glisse Learn dans Applications. Si cette version est signée et notarisée par Apple, elle s'ouvre directement. Sinon (signature ad hoc), et si macOS dit que l'app « est endommagée », lance une fois dans le Terminal :

```
xattr -cr /Applications/Learn.app
```

**Windows** : si SmartScreen s'affiche, clique sur *Informations complémentaires* puis *Exécuter quand même*.

**Linux** : `chmod +x Learn-*.AppImage` puis lance-le.

**Extension Obsidian** : télécharge `learn-obsidian-….zip`, décompresse-le dans `<ton coffre>/.obsidian/plugins/` (tu obtiens un dossier `learn-reader`), puis active « Learn » dans *Réglages → Modules complémentaires de la communauté*.
