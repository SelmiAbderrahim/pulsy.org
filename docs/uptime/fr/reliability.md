# Objectifs de fiabilité et contexte des événements

## Étapes

Dans l’Historique du moniteur, choisissez 24 heures, 7 jours, 30 jours ou une période personnalisée en heure locale, dans l’historique conservé. Actualiser met à jour les périodes glissantes. Les tendances quotidiennes UTC présentent disponibilité, couverture observée et durée de requête, résolution ou connexion. La durée d’exécution d’un signal de tâche n’est pas une latence de requête.

## Fuseaux horaires

Les heures des moniteurs et incidents suivent Préférences → Fuseau horaire du compte, ou le fuseau du navigateur si choisi. Pour les périodes personnalisées et les heures d’annotation, utilisez le fuseau indiqué près des champs. Les périodes des rapports SLA et les tendances quotidiennes restent explicitement en UTC ; changer le fuseau d’affichage ne déplace pas ces limites.

## Comportement

La disponibilité pondérée par la durée divise le temps Up par le temps observé. Les états Down et Degraded consomment le budget d’indisponibilité. Elle est distincte du taux de réussite des contrôles. Chaque nouvelle observation couvre au plus un intervalle configuré, plafonné à sept jours, et se termine plus tôt à l’observation suivante. L’historique antérieur sans observation capturée et les lacunes après cet horizon restent inconnus. Un signal jamais reçu reste inconnu. Les échéances des signaux déterminent toujours l’état réel ; ces estimations n’infèrent pas une santé historique continue à partir d’un échantillon périmé.

La couverture indique la part observée de la période. Le temps inconnu ne fournit aucun budget d’indisponibilité. Une période entièrement observée de 30 jours à 99,9 % autorise exactement 2 592 secondes (43 minutes 12 secondes) d’indisponibilité. Une couverture partielle réduit le budget au temps observé admissible. Sans temps observé, ni pourcentage ni budget ne sont connus. Le budget restant ne devient pas négatif ; le dépassement est enregistré séparément.

## Objectifs et annotations

Les objectifs facultatifs ne modifient ni contrôles, ni alertes, ni état mesuré, ni PDF SLA ou rapports mensuels existants. Le budget de disponibilité utilise l’objectif actuel comme référence explicite. Le respect de la latence utilise la politique capturée avec chaque observation, compte uniquement les observations Up/Degraded valides et inclut l’égalité exacte. Une modification crée une version ; un réglage identique ne la duplique pas. Les versions antérieures restent visibles dans l’historique conservé.

L’ajustement de maintenance est facultatif et séparé des résultats bruts. Seuls les intervalles capturés avec une politique d’exclusion active sont retirés ; les chevauchements comptent une seule fois. Suspendre les alertes ne retire jamais de temps mesuré. Modifier ultérieurement les horaires ne réécrit pas les périodes capturées. Sans temps ajusté admissible, pourcentage et budget ajustés restent inconnus. Cette vue opérationnelle ne redéfinit pas un contrat SLA.

## Valeurs privées et limites

Les annotations privées horodatées contiennent environnement, version, courte description et lien HTTP(S) public facultatif sans identifiants, paramètres ni fragment. Elles sont réservées au propriétaire et n’apparaissent jamais sur les pages publiques. Les secrets de requête connus sont masqués ; ne saisissez toutefois pas de secrets. Les repères indiquent une corrélation, pas une cause démontrée. Utilisez uniquement des dates de l’historique conservé jusqu’au présent ; les éléments anciens sont paginés dans un ordre stable par date et identifiant.

Exporter la période affichée télécharge exactement les mesures visibles : période, date de calcul, couverture et politique. Ce n’est ni un PDF SLA, ni un envoi mensuel, ni une sauvegarde de reprise. Les PDF SLA et les rapports mensuels sont également disponibles pour chaque compte.

Chaque compte peut utiliser des clés API de portée `read` pour lire et `full` pour écrire. Envoyez la clé du compte avec `Authorization: Bearer`, jamais dans une URL.

## Exemple

Lecture : GET /api/v1/monitors/ID/reliability?from=2026-10-09T00%3A00%3A00.000Z&to=2026-10-10T00%3A00%3A00.000Z

Insertion : POST /api/v1/monitors/ID/annotations avec JSON {"at":"2026-10-10T00:00:00.000Z","environment":"staging","version":"v2","text":"Déploiement observé","link":null}. La création renvoie 201. GET sur le même chemin avec from/to et limit/cursor facultatifs permet la pagination privée. Ne placez jamais de clé API dans une URL.

L’historique public exige l’activation explicite par le propriétaire d’une page publiée. Il montre sept journées UTC complètes, avec disponibilité brute, couverture, ajustement de maintenance séparé et durées typées. La page demande tous les composants sélectionnés en une seule requête au dépliage ; chaque panneau monte seulement à son ouverture. Les lacunes restent inconnues. Les noms, URL, notes, objectifs, identifiants de moniteur et secrets privés ne sont pas projetés. Le temps d’une requête n’est pas le chargement d’une page dans un navigateur. Cette publication facultative rend visibles des mesures de disponibilité et de performance : vérifiez ce choix avant de l’activer.

Le contexte pagine tous les incidents mesurés chevauchant la période visible. Les durées sont limitées aux deux bornes, y compris les incidents déjà ouverts et rétablis plus tard. Les causes classent les 1 000 incidents correspondants les plus récents par durée cumulée ; une étiquette partielle apparaît au-delà, tandis que la pagination reste complète. Les incidents simultanés peuvent se chevaucher : ces totaux ne calculent pas la disponibilité. Les causes privées sont masquées selon la configuration actuelle des requêtes. La date d’une annotation seule ne prouve pas une cause.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)
