# Heartbeats à intervalle

## Configurer un heartbeat

Choisissez **Ajouter un moniteur → Heartbeat de tâche**. Indiquez un nom, l’intervalle attendu et le délai de grâce avant de déclarer une panne. L’intervalle va de 30 secondes à sept jours ; la grâce de zéro à sept jours. Il s’agit d’intervalles, pas d’expressions cron. Vérifiez la prochaine échéance, la fin de grâce et le fuseau avant d’enregistrer.

Vue d’ensemble et Paramètres affichent une URL de ping masquée. Utilisez Afficher ou Copier l’URL au besoin ; les jetons créés ou renouvelés sont chiffrés au repos et récupérables uniquement par le propriétaire connecté. Les anciens jetons conservés uniquement sous forme de hachage exigent une rotation dans Paramètres pour permettre la copie. La rotation invalide immédiatement l’ancien jeton sans effacer l’historique. Gardez ces URL secrètes hors des journaux, captures et fichiers versionnés. Le proxy nginx fourni exclut les chemins heartbeat des journaux, quelle que soit la casse, y compris les requêtes en erreur ; appliquez la même exclusion à tout proxy externe.

## Envoyer un résultat

Après réussite, envoyez la requête ci-dessous avec votre adresse de déploiement et votre jeton. En cas d’échec, utilisez `/api/heartbeat/fail`. Pour mesurer la durée, envoyez `/api/heartbeat/start` avant le traitement puis `/api/heartbeat/success` ou `/api/heartbeat/fail`. Utilisez le même `runId` au départ et à la fin pour les exécutions concurrentes ou reprises.

L’URL copiée est `/api/heartbeat/{token}/success`. Envoyez un POST avec `Content-Type: application/json` et le corps `{}`, même sans autre donnée. Remplacez `success` par `start` ou `fail` pour les autres événements. Les routes utilisant l’en-tête `Authorization: Bearer` restent disponibles ; ne combinez pas URL avec jeton et en-tête d’authentification.

```sh
curl -fsS -m 10 --retry 3 "$PULSY_SERVER/api/heartbeat/$PULSY_HEARTBEAT_TOKEN/success"
```

```sh
curl -fsS -m 10 --retry 3 -X POST "$PULSY_SERVER/api/heartbeat/success" \
  -H "Authorization: Bearer $PULSY_HEARTBEAT_TOKEN" \
  -H 'Content-Type: application/json' -d '{"runId":"nightly-42"}'
```

## Comprendre le résultat

Nouveau signifie qu’aucun succès n’a été reçu, pas que la tâche fonctionne. Le premier succès est attendu un intervalle après la création. Son absence devient En retard à l’échéance, puis En panne à la fin de grâce. Sans grâce, le passage en panne est direct. Un succès rétablit le service et recommence l’intervalle ; un échec signale immédiatement une panne. Un départ ne repousse pas l’échéance et ne rétablit pas la santé.

Le retard n’ouvre pas d’incident ; seule la panne en ouvre un. Si le contrôle est tardif, le début de panne reste l’échéance attendue plus la grâce, et non l’heure du contrôle. Les heures utilisent le fuseau du compte, ou celui du navigateur si choisi dans Préférences.

La durée mesure le temps entre la réception du départ et de la fin, pas une latence HTTP. Un succès simple conserve la dernière durée ou la laisse inconnue. Le taux de réussite concerne les échantillons enregistrés, pas une disponibilité continue. Des signaux répétés du même état peuvent être regroupés en un échantillon par intervalle.

## Valeurs privées et limites

Envoyez un objet JSON de 10 Kio maximum. Le `runId` facultatif accepte 64 lettres ou chiffres ASCII, tirets bas, points, deux-points ou tirets. Les métadonnées facultatives acceptent seulement `environment` et `version`, chacun jusqu’à 64 lettres, chiffres, tirets bas, points ou tirets. N’envoyez ni journaux ni sortie privée. Répéter un identifiant ne répète pas son résultat ; un résultat nommé exige un départ existant. Utilisez de nouveaux identifiants pour de nouvelles tâches, car seuls les identifiants récents sont conservés.

La pause suspend les contrôles d’absence et les alertes ; les résultats reçus peuvent toujours modifier la santé. La maintenance suspend les alertes, pas la mesure. Importer/exporter transfère la configuration sans jetons ni historique ; les modèles HTTP et liens de partage ne copient pas les heartbeats.

## Dépannage

Pour 404, vérifiez le chemin et le jeton actuel. Pour 400, vérifiez le JSON ; pour 413, réduisez sa taille. Pour 409, envoyez d’abord le départ avec le même identifiant. Pour 429 ou 503, respectez `Retry-After` ; chaque jeton autorise jusqu’à 120 requêtes par minute. Si la tâche reste en retard ou en panne, comparez le dernier succès à l’échéance et vérifiez son envoi par votre tâche.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)
