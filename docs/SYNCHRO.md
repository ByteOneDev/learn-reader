# Synchronisation entre appareils (bêta)

Learn peut synchroniser tes abonnements, catégories, filtres, marques (lu, plus tard, signets, favoris),
tags, positions de lecture, surlignages, notes et boards entre plusieurs ordinateurs, via un projet
[Supabase](https://supabase.com) qui t’appartient. Le texte des articles et les livres restent sur chaque appareil.

## Mise en place (5 minutes, une seule fois)

1. Crée un compte sur supabase.com, puis un **nouveau projet** (l’offre gratuite suffit largement).
2. Dans le projet : **SQL Editor › New query**, colle tout le contenu de [`supabase/schema.sql`](../supabase/schema.sql), puis **Run**.
3. **Project Settings › API** : copie l’**URL du projet** (`https://xxxx.supabase.co`) et la clé **anon / public**.
   (Jamais la clé `service_role` : elle donne tous les droits.)
4. Facultatif, pour un usage perso : **Authentication › Providers › Email**, désactive *Confirm email*,
   sinon il faut cliquer le lien reçu par e-mail avant la première connexion.
5. Dans Learn : **Réglages › Synchronisation entre appareils**, colle l’URL et la clé, choisis un e-mail et
   un mot de passe, puis **Créer un compte** (premier appareil) ou **Se connecter** (les suivants).

## Fonctionnement

- Chaque élément est une ligne de la table `learn_records`, protégée par Row Level Security : un compte
  ne voit que ses propres lignes, même avec la clé publique.
- En cas de modification sur deux appareils, **la plus récente gagne** (horodatage de l’appareil).
- Envoi quelques secondes après chaque changement, réception toutes les minutes et au démarrage.
- À la connexion, le premier envoi comprend les abonnements, les articles marqués des 30 derniers jours,
  tous les surlignages et tous les boards.
- La session est chiffrée sur le disque (trousseau du système), le mot de passe n’est jamais conservé.

## Bêta-testeurs

Pour l’instant, chacun utilise son propre projet Supabase. Un projet partagé pour plusieurs personnes
fonctionne déjà tel quel (chaque compte est isolé par RLS) : il suffira de distribuer l’URL et la clé anon.
