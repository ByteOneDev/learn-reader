# Landing page de Learn

Page statique, sans dépendance : `index.html` et `assets/` (captures en WebP, icône).

- **Aperçu local** : `python3 -m http.server -d site 5500`, puis http://localhost:5500
- **Mise en ligne** : GitHub Pages, workflow manuel « Landing page » (Settings → Pages → Source : GitHub Actions, puis Actions → Landing page → Run workflow).
- Les boutons de téléchargement pointent vers les fichiers de la dernière release (API GitHub), avec la page des versions en repli.
- Les captures viennent de l'aperçu de l'app (`npm run web`) ; les refaire après un changement d'interface.
