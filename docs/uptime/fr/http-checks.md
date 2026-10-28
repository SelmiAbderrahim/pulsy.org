# Contrôles HTTP avancés

## Étapes

L’ajout rapide conserve GET par défaut. Dans Nouveau moniteur ou Paramètres, ouvrez Contrôles HTTP avancés pour ajouter des assertions et valeurs privées. Chaque règle active doit réussir sur la même réponse ; un ensemble d’assertions n’ajoute aucun sondage. Les redirections peuvent effectuer jusqu’à six requêtes, première comprise.

## Comportement

Règles : corps contient/ne contient pas, en-tête égal/contient, JSON existe/égal/différent/inférieur/au plus/supérieur/au moins. Un chemin JSON commence par `$`, puis clés ASCII séparées par des points ou indices numériques, par exemple `$.status` et `$.jobs[0].depth`. Clés entre guillemets, jokers, scripts, clés de prototype et expressions sont refusés. Saisissez les valeurs attendues comme `"ok"`, `0`, `false`, `null` ou un tableau plat de ces valeurs. Absent diffère de null, false, zéro, texte vide et tableau vide. Un champ absent échoue à toute comparaison, même différent. Les comparaisons numériques ne convertissent pas les chaînes. Un JSON invalide fait échouer les assertions JSON actives.

## Exemple

HTTP 200 ET `$.status` égal `"ok"` ET `$.queueDepth` inférieur à `100` exige les trois conditions. HTTP 200 avec `{"status":"error"}` devient indisponible si la règle de statut est active. La configuration avancée considère un statut HTTP non admissible comme indisponible. Les anciens moniteurs sans configuration avancée gardent leur comportement, y compris dégradé pour une réponse inattendue sous 400. Le timing mesure la requête, pas le chargement du navigateur.

## Valeurs privées et limites

En-têtes privés, authentification Basic/Bearer et corps POST sont chiffrés ensemble avec ENCRYPTION_KEY existant. L’éditeur ne permet pas leur récupération. Conserver ne change rien ; Remplacer demande une nouvelle saisie et supprime les valeurs omises ; Effacer retire tout. requestConfig omis dans l’API conserve, null efface, un objet remplace. Ne placez aucun identifiant dans URL ou assertions. Les identifiants d’URL sont refusés à la création/modification. Un corps exige POST ; changer de méthode demande d’effacer ou remplacer délibérément le corps conservé.

Les noms d’en-têtes sont uniques sans distinction de casse. Host, Content-Length, Connection et Transfer-Encoding ne peuvent être remplacés. Limites : 20 en-têtes, 16 KiB de configuration encodée, 4 096 caractères par valeur, 64 KiB de corps UTF-8. Un nom Basic ne contient pas deux-points. Les valeurs privées sont absentes des pages publiques, partages et projections REST/propriétaire. Les liens de partage omettent les réglages avancés. Les modèles et manifestes natifs conservent les assertions et politiques de latence non secrètes prises en charge, sans valeurs privées de requête.

Avec valeurs privées, assertions ou redirection non standard, Suivre valide chaque destination selon la politique réseau existante, s’arrête après cinq sauts et retire en-têtes/authentification configurés si l’origine change. Un changement d’origine 307/308 avec corps est refusé ; 301/302 POST et 303 sauf HEAD deviennent GET sans corps. Inspecter retourne la première réponse ; Refuser fait échouer les redirections. Les anciens contrôles HTTP valident aussi chaque destination de redirection. Les cibles HTTP(S) refusent les adresses non spécifiées, de métadonnées et de liaison locale dans tous les déploiements. Les cibles privées et internes (boucle locale, RFC1918, CGNAT, adresses uniques locales, `localhost`, `*.internal`, noms de service à un seul libellé) sont autorisées par défaut avec `MONITOR_ALLOW_PRIVATE_NETWORKS=true`. Définissez `false` pour les refuser à l’enregistrement ou à l’import puis à nouveau à la connexion. Les connexions HTTP utilisent toujours des réponses DNS validées au moment de la connexion.

Les règles de corps/JSON lisent au plus 512 KiB décompressés. JSON est borné à profondeur 16 et 10 000 nœuds. Les règles d’en-tête seules ne lisent pas le corps. Une règle de corps HEAD échoue comme non lue, sans inventer un corps vide observé. Le délai reste actif pendant la lecture. Trop volumineux et non lu sont distincts. Corps complets et valeurs de réponse d’assertion ne sont jamais conservés ; les logs contiennent index, réussite et code de motif borné.

## Tester sans enregistrer

Tester sans enregistrer effectue un sondage explicite unique sans planification, historique ni changement de santé. Il emploie le même contrôleur et la même configuration effective que l’enregistrement. POST peut avoir des effets et demande confirmation. Enregistrer ne teste jamais automatiquement.

Chaque compte peut utiliser des clés API de portée `read` pour lire et `full` pour écrire. Envoyez la clé du compte avec `Authorization: Bearer`, jamais dans une URL.

Une assertion échouée donne un motif sûr tel que Assertion 1: mismatch, ouvre l’incident mesuré après le seuil de panne existant et utilise les notifications et suppressions de maintenance. Elle ne publie aucune annonce et ne change pas la définition de disponibilité. Un chiffrement corrompu exige une nouvelle saisie avec la clé configurée. Ne remplacez ni ne faites tourner la clé sans préserver les secrets.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)

## Adresses des moniteurs

Créer un moniteur, Ajout rapide et Ajout en masse acceptent un nom d’hôte comme `example.com` et affichent l’adresse normalisée `https://example.com/`. Un nom manquant est remplacé par le nom d’hôte. La détection des doublons compare les adresses canoniques à vos moniteurs existants et au lot actuel, y compris les variantes avec une barre oblique finale, et indique le nom du moniteur existant. Les paramètres de requête restent significatifs. Les nouveaux moniteurs utilisent trois échecs consécutifs par défaut ; les seuils enregistrés restent inchangés.

## Codes acceptés et TLS

Le code attendu accepte `200,204`, `2xx` et `200–299`, ainsi que leurs combinaisons. Les codes doivent être compris entre 100 et 599 et les plages doivent être croissantes. La même règle s’applique aux vérifications ordinaires et avancées. Un code unique conserve le comportement précédent. Le commutateur de surveillance du certificat TLS dans les paramètres désactive les contrôles d’expiration et les alertes, puis efface le résultat enregistré. La vérification du transport HTTPS reste active. Les modèles et exports conservent ces réglages.

Les configurations partagées conservent aussi les règles des codes acceptés et le réglage de surveillance TLS, sans observations de certificat ni identifiants. Le clonage vérifie les URL canoniques par rapport à vos moniteurs existants et au lot sélectionné, y compris vos propres partages.

## Noms et enregistrement

Le nom est facultatif à la création d’un moniteur HTTP : vide, il reprend le nom d’hôte de l’URL. Les moniteurs DNS, TCP, serveur et heartbeat ainsi que les modèles enregistrés exigent un nom. En modification, Enregistrer reste désactivé tant que les valeurs ne diffèrent pas de la version enregistrée. Rétablir les valeurs initiales retire l’avertissement de modifications non enregistrées. Les champs invalides affichent un message et un récapitulatif ; l’envoi place le focus sur le premier champ invalide. Un échec conserve le brouillon.
