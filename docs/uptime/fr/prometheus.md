# Export Prometheus

## Étapes

GET /api/v1/metrics lit uniquement l'état enregistré des moniteurs du compte
authentifié. Créez une clé API dans [Développer → Clés API](/dashboard/api-keys). Chaque compte peut
utiliser une clé de portée `read` ou `full` pour collecter les métriques.
La collecte ne lance aucun contrôle, résolution DNS, connexion ou worker.

Si vous choisissez une date d’expiration pour la clé API, elle doit être postérieure à aujourd’hui en UTC. La clé expire à 23:59:59.999 UTC à la date choisie. Sans date, elle reste valable jusqu’à révocation.

## Configuration du scrape

Exemple de configuration, avec votre propre domaine :

```yaml
scrape_configs:
  - job_name: pulsy
    scheme: https
    metrics_path: /api/v1/metrics
    static_configs:
      - targets: ['pulsy.example.com']
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/pulsy-api-key
    scrape_interval: 60s
```

## Comportement

Placez la clé dans ce fichier à accès restreint, jamais dans une URL, un dépôt
ou une capture. Pour la remplacer, créez une nouvelle clé, modifiez le fichier,
puis révoquez l'ancienne. L'expiration et la révocation habituelles s'appliquent.

Les sept métriques sont des gauges préfixées par pulsy_monitor_ :

## Exemples de requêtes

- status : -1 inconnu, 0 indisponible, 1 disponible, 2 dégradé. Une observation
  absente ou un état pending reste inconnu.
- fresh : 1 seulement si le moniteur est actif, l'état connu et l'âge compris
  entre zéro et deux intervalles plus le délai maximal, bornes incluses.
  Un heartbeat nécessite aussi un enregistrement d'échéance ; une prochaine
  échéance éventuelle ne doit pas être dépassée de plus de dix secondes.
- active : 1 activé, 0 en pause.
- last_check_timestamp_seconds : date du dernier contrôle en secondes Unix,
  ou NaN si absente.
- duration_seconds : durée HTTP, résolution DNS ou connexion TCP en secondes.
  Zéro reste zéro ; une valeur absente ou un heartbeat donne NaN.
- open_incident : 1 si un incident mesuré est ouvert, sinon 0.
- tls_expiry_timestamp_seconds : dernière expiration TLS observée pour HTTP,
  en secondes Unix ; NaN si absente ou pour les autres types.

Une pause, un état ancien ou une date future donne fresh=0 sans réécrire la
santé enregistrée. Un heartbeat Down sans prochaine échéance reste Down.
Une connexion TCP ne prouve pas la santé de l'application. La durée d'un job
n'est pas une latence réseau ; un certificat exporté n'est pas une nouvelle mesure.

## Valeurs privées et limites

Sélectionnez explicitement les états connus et récents :

```promql
pulsy_monitor_status{job="pulsy"} >= 0
  and on (job, instance, monitor_id) pulsy_monitor_fresh{job="pulsy"} == 1
```

Seul monitor_id apparaît dans les labels : aucun nom, URL, tag, adresse,
secret ou contenu de réponse. Une requête bornée lit moniteurs et incidents,
avec au besoin une lecture groupée des échéances heartbeat, sans historique.
Maximum 1 000 moniteurs par réponse ; au-delà, code 422. Pour les grandes
installations, monitorIds accepte de 1 à 200 identifiants séparés par des virgules.
Les identifiants étrangers ou inexistants ne produisent aucune série.

La limite API existante s'applique : 60 requêtes/minute/clé par défaut, 429 avec
Retry-After. Clé invalide : 401 ; accès insuffisant : 403 ; requête invalide : 422.
Les réponses sont private, no-store ; aucun cache public partagé. Après un
redémarrage, la collecte reprend depuis les données durables.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)
