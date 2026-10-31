# Signer et notariser Learn pour macOS

Sans signature Apple, macOS bloque l'app téléchargée (« endommagée », « développeur non identifié »). Le workflow **Build desktop apps** sait déjà signer avec un certificat **Developer ID** et faire **notariser** l'app par Apple. Il lui manque seulement tes identifiants, à déposer comme secrets du dépôt GitHub. Sans eux, il continue de produire une app signée « ad hoc ».

Ce qu'il te faut : un compte **Apple Developer Program** (99 $/an, sur [developer.apple.com/programs](https://developer.apple.com/programs/)) et un Mac pour créer le certificat.

## 1. Le certificat « Developer ID Application »

1. Sur ton Mac, ouvre **Trousseaux d'accès**, puis le menu *Trousseaux d'accès → Assistant de certification → Demander un certificat à une autorité de certification…*. Saisis ton e-mail, choisis **Enregistré sur le disque**. Tu obtiens un fichier `.certSigningRequest`.
2. Sur [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates/list), clique sur **+**, choisis **Developer ID Application**, envoie le fichier `.certSigningRequest`, puis télécharge le certificat `.cer`.
3. Double-clique sur le `.cer` : il s'installe dans ton trousseau, avec sa clé privée.
4. Dans Trousseaux d'accès, catégorie *Mes certificats*, fais un clic droit sur **Developer ID Application : ton nom (TEAMID)**, puis **Exporter…**, au format `.p12`. Choisis un mot de passe solide.
5. Convertis le `.p12` en texte et copie-le :
   ```bash
   base64 -i Certificats.p12 | pbcopy
   ```

## 2. La clé API App Store Connect (pour la notarisation)

1. Sur [appstoreconnect.apple.com/access/integrations/api](https://appstoreconnect.apple.com/access/integrations/api), onglet **Team Keys** (clés d'équipe), clique sur **+**, nomme la clé « Learn CI », rôle **Developer**.
2. Télécharge le fichier `AuthKey_XXXXXXXXXX.p8`. Attention : Apple ne le propose qu'**une seule fois**.
3. Note le **Key ID**, affiché dans la liste, et l'**Issuer ID**, affiché en haut de la page.

## 3. Les secrets GitHub

Sur GitHub, ouvre ton dépôt, puis **Settings → Secrets and variables → Actions → New repository secret**. Crée les cinq secrets suivants :

| Nom du secret | Valeur |
|---|---|
| `MAC_CERTIFICATE_P12` | le texte base64 copié à l'étape 1.5 |
| `MAC_CERTIFICATE_PASSWORD` | le mot de passe du `.p12` |
| `APPLE_API_KEY_P8` | tout le contenu du fichier `AuthKey_….p8` (lignes `-----BEGIN PRIVATE KEY-----` comprises) |
| `APPLE_API_KEY_ID` | le Key ID |
| `APPLE_API_ISSUER` | l'Issuer ID |

## 4. Publier une version signée

Incrémente `version` dans `package.json` et pousse sur `main`. Tu peux aussi relancer le workflow à la main : **Actions → Build desktop apps → Run workflow**.

Dans le journal de l'étape **Package** sur macOS, tu dois voir « Signature Developer ID et notarisation Apple ». L'étape **Vérifier la signature macOS** affiche `Authority=Developer ID Application: …`, puis `accepted` et `source=Notarized Developer ID`. La notarisation ajoute quelques minutes au build.

## En cas de problème

- **Certificat fourni mais pas de clé API** : l'app est signée mais pas notarisée. macOS affichera encore un avertissement au premier lancement.
- **`The specified item could not be found in the keychain`** : le `.p12` exporté ne contient pas la clé privée. Refais l'export depuis *Mes certificats*, pas depuis *Certificats*.
- **Notarisation refusée** : le journal d'Apple est affiché dans l'étape Package. Le plus souvent, c'est un certificat « Apple Development » au lieu de « Developer ID Application ».

Windows a son propre système de signature, payant et séparé (certificat de signature de code). Sans lui, SmartScreen continuera d'afficher un avertissement au premier lancement.
