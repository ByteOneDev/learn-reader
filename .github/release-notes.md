## Installer

| Système | Fichier à télécharger |
|---|---|
| Mac Apple Silicon (M1, M2, M3, M4…) | `Learn-…-arm64.dmg` |
| Mac Intel | `Learn-….dmg` (sans `arm64`) |
| Windows | `Learn Setup ….exe` |
| Linux | `Learn-….AppImage` (ou `.deb` pour Debian/Ubuntu) |

Les builds ne sont pas encore signés par un certificat officiel.

**Mac** : ouvre le `.dmg`, glisse Learn dans Applications. Si macOS dit que l'app « est endommagée » ou « ne peut pas être ouverte », lance une fois dans le Terminal :

```
xattr -cr /Applications/Learn.app
```

puis ouvre Learn normalement (ou clic droit → Ouvrir).

**Windows** : si SmartScreen s'affiche, clique sur *Informations complémentaires* puis *Exécuter quand même*.

**Linux** : `chmod +x Learn-*.AppImage` puis lance-le.
