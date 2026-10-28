# Importer et exporter

Ouvrez [Importer et exporter](/dashboard/import-export) pour exporter les réglages des moniteurs sélectionnés ou vérifier une configuration avant de l’importer.

## Étapes

Ouvrez **Développer → Importer et exporter** dans la navigation. Sélectionnez explicitement des moniteurs puis Exporter la configuration sélectionnée. Télécharger JSON est disponible seulement après export ou aperçu expurgé réussi. Charger un fichier ou modifier le texte invalide aperçu et téléchargement. Limites : 200 éléments, 256 KiB de JSON UTF-8, profondeur 16 et 20 000 valeurs. Cela déplace les réglages, pas historique, incidents, publication, abonnés, destinataires, clés API ou sauvegarde de secours. L’interface est disponible pour chaque compte.

## Format du fichier

Version 1 : `format: "pulsy-monitor-configuration"`, `version: 1` et tableau `monitors`. Chaque élément a `key` durable local au compte, `type`, `name`, `interval` en secondes, `active` et `tags`. Clés ASCII avec lettres, chiffres, souligné, point, deux-points et tiret, commençant par lettre/chiffre, 100 caractères maximum. Casse des étiquettes et limites existantes par type restent. HTTP exige aussi `url`, `method`, `expectedStatus`, `timeout` en millisecondes, `failureThreshold` et `redirectPolicy`. `httpAssertions` et `latencyPolicy` sont optionnels : omission conserve l’existant, null désactive la politique de latence. Heartbeat exige `graceSeconds`. HTTP, DNS, TCP et les heartbeats à intervalle sont pris en charge. Les calendriers cron et adaptateurs tiers ne le sont pas.

## Exemple

```json
{
  "format": "pulsy-monitor-configuration",
  "version": 1,
  "monitors": [{
    "key": "api-production", "type": "http", "name": "API production",
    "url": "https://example.invalid/health", "method": "GET",
    "expectedStatus": 200, "timeout": 10000, "interval": 300,
    "failureThreshold": 3, "redirectPolicy": "follow", "active": false,
    "tags": ["production"],
    "httpAssertions": [{ "type": "json", "path": "$.status", "op": "equals", "value": "ok" }]
  }]
}
```

## Clés et renommages

L’export utilise la clé externe existante ou `pulsy:<monitorId>` pour un moniteur non lié. Réappliquer au même compte lie la clé sans remplacer le moniteur. Une nouvelle clé crée un moniteur. Pour renommer délibérément, ajoutez `previousKey` avec l’ancienne clé détenue et choisissez le nouveau `key` ; l’aperçu montre le changement. Cela ne sélectionne pas un moniteur d’un autre compte. Ancienne clé absente, deux entrées pour un moniteur, conflit ancien/nouveau ou changement du type lié sont refusés. Répéter un renommage déjà appliqué reste idempotent. Retirez previousKey avant transfert vers un autre compte. Clés sensibles à la casse. Aucun identifiant secret dans noms, tags, clés ou assertions.

## Valeurs privées et limites

Les valeurs privées sont omises et jamais retournées. `needsReentry` liste request, url, assertions ou heartbeatToken non remplis. Toute URL avec requête ou fragment est omise par prudence, comme les URL avec identifiants ou secrets connus. url null conserve l’URL existante ; un nouveau moniteur exige une URL sûre. Assertions d’en-tête sensibles et règles contenant des valeurs privées connues sont omises ; les règles existantes omises restent. Les champs importés de requête/auth/corps/token/destinataires/abonnés sont retirés avant validation, ainsi que leurs répétitions connues dans noms, tags, URL et assertions. L’aperçu remplace le texte par JSON expurgé. Clés d’objet dangereuses, champs inconnus, clés doublonnées et versions non prises en charge sont refusés. Maximum 500 valeurs privées élémentaires examinées par moniteur. C’est un format de champs à ressaisir, sans intégration à un coffre de secrets.

Aucun import ne remplace ni n’efface les secrets conservés. Un corps POST conservé interdit le passage à GET/HEAD ; effacez ou remplacez-le explicitement dans les paramètres d’abord. Les nouveaux moniteurs HTTP avec valeurs/règles à ressaisir restent inactifs. Heartbeat n’exporte ni token ni URL : les nouveaux jobs restent inactifs jusqu’à rotation/copie du token et activation dans les paramètres. L’activation des jobs existants reste malgré le active du manifeste ; utilisez leurs commandes habituelles. Intervalle/grâce changent sans inventer reçu, rétablissement ou santé. Hash et historique des exécutions restent intacts.

`channelIds` optionnel référence seulement des canaux détenus existants, sans destinataires, identifiants de fournisseur ni cible d’envoi. Omission conserve les liens ; tableau vide retire les références sans supprimer les canaux. Sur une autre installation, retirez-les ou remplacez-les par les IDs détenus là-bas. Référence absente, étrangère, retirée ou non admissible refuse l’import. Modèles, vues, calendriers, fournisseurs et appartenance aux pages publiques sont hors manifeste.

## Prévisualiser et appliquer

Valider et prévisualiser ne fait aucune écriture ni sonde. Il affiche changements exacts et nombres créer/modifier/inchangé/refusé. Appliquer est explicite et atomique : toute entrée refusée, erreur de stockage ou configuration périmée annule l’ensemble. La révision vérifie réglages et identité des références, pas les changements ordinaires de santé. Les créations simultanées sont sérialisées par un verrou transactionnel sur la ligne du propriétaire, comme les moniteurs classiques et heartbeat, sans limite du nombre de moniteurs. IDs, contrôles, incidents, appartenance publique et secrets omis restent. Aucun effacement, prune ou remplacement silencieux. HTTP actif commence les requêtes planifiées ; POST peut avoir des effets. Réprévisualisez pour voir Inchangé sans créer de doublon. Aucun changement à appliquer si tout est inchangé.

## Accès par API

Chaque compte peut utiliser des clés API de portée `read` pour lire et `full` pour écrire. Envoyez la clé du compte avec `Authorization: Bearer`, jamais dans une URL. L’export et l’aperçu utilisent l’accès en lecture ; appliquer exige `full`. L’interface est disponible en cinq langues. Les deux premières routes POST utilisent la lecture :

```sh
curl -X POST "$PULSY_URL/api/v1/configuration/export" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data '{"monitorIds":["owned-monitor-id"]}'
curl -X POST "$PULSY_URL/api/v1/configuration/preview" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data-binary @preview-request.json
curl -X POST "$PULSY_URL/api/v1/configuration/apply" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data-binary @apply-request.json
```

preview-request.json contient `{"text":"<JSON-escaped native manifest>"}`. apply-request.json garde ce texte et ajoute revision reçu, par exemple `{"text":"<same escaped JSON>","revision":"<64-character revision>"}`. Utilisez l’encodage JSON standard du CI, sans insérer du contenu non échappé dans une commande shell. Vérifiez l’aperçu avant d’autoriser l’étape appliquer. Révision périmée HTTP 409, refus/invalide 422, borne parseur 413, JSON malformé 400, compression non acceptée 415. Succès no-store. Aucun nouvel outil CLI, paquet, daemon de synchronisation ou contournement des droits.

Un import répété garde le moniteur HTTP inactif tant que les valeurs privées ou règles requises omises ne sont pas configurées. Renseignez-les dans les paramètres avant de demander l’activation par un nouvel import. Les valeurs privées déjà configurées sont conservées.

La version1 comprend aussi DNS et TCP : `type` vaut `dns` ou `tcp` ; `configuration` contient l’hôte et les attentes typées ou l’hôte/port, avec délai et seuil d’échec. Intervalle configuré, historique préservé sur une clé appartenant au compte, sans publication ni promesse TLS.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)

Les erreurs JSON apparaissent sous l’éditeur avec une explication sûre et la ligne/colonne. Par exemple, `{"bad":` est incomplet à la ligne 1, colonne 8. Le focus passe à l’erreur sans effacer votre saisie. Les messages ne reproduisent jamais les valeurs secrètes collées.


## Sélection pour l’export

Utilisez **Sélectionner tous les moniteurs éligibles** pour choisir jusqu’à 200 moniteurs HTTP, DNS, TCP et heartbeats. L’export des serveurs Linux est désactivé avec une explication : leur agent nécessite de nouveaux identifiants. Le serveur rejette aussi ces demandes. Les anciens manifestes restent importables et créent des serveurs inactifs en attente de configuration. **Télécharger un exemple** fournit un exemple HTTP inactif indépendant de l’éditeur ; **Télécharger JSON** enregistre uniquement un manifeste exporté ou vérifié et nettoyé.
