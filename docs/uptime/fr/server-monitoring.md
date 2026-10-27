# Serveur Linux

Surveillez les ressources de l’hôte et la connexion de l’agent avec vos sites web.

## Installation

Choisissez **Ajouter un serveur** et conservez le jeton affiché une seule fois. Chaque compte peut surveiller des serveurs. L’intervalle par défaut est de 60 secondes ; les valeurs admises sont des secondes entières de 60 à 3 600.

Exécutez la commande affichée sur l’hôte Linux amd64 ou arm64. L’installateur télécharge des fichiers versionnés depuis votre origine Pulsy HTTPS et vérifie leurs sommes de contrôle, puis configure et démarre l’agent. Copiée juste après la création ou le renouvellement du jeton, la commande le contient et ne demande aucune saisie ; elle reste dans l’historique du shell de l’hôte, traitez-la comme un mot de passe. Ensuite le jeton n’est plus affiché et l’installateur le demande dans une invite masquée. Jamais dans une URL ou un ticket. Il faut un accès HTTPS sortant, un certificat approuvé et une horloge exacte. Aucun port entrant n’est nécessaire.

L’installation systemd nécessite root ; le service utilise ensuite le compte dédié `pulsy-agent`. Configuration protégée : `/etc/pulsy-agent/config.json`. Diagnostic : `sudo systemctl status pulsy-agent` et `sudo journalctl -u pulsy-agent`. Une réinstallation conserve la configuration.

## Docker Compose

Utilisez la commande Compose ; elle nécessite Docker avec le plugin Compose, démarre elle-même le conteneur et échoue en affichant ses journaux s’il ne reste pas actif. Les fichiers sont dans `/opt/pulsy-agent` et la configuration n’est lisible que par root et l’utilisateur du conteneur. L’agent utilise des montages en lecture seule de `/proc` et `/`, sans mode privilégié, capacités ni socket Docker. Il mesure l’hôte, pas les limites du conteneur. L’administrateur doit autoriser ces montages. Les mesures inaccessibles restent indisponibles. Le magasin de certificats de l’hôte est monté en lecture seule.

## Mesures et alertes

Le processeur est calculé par différence des compteurs Linux : premier relevé, redémarrage ou remise à zéro donnent une valeur indisponible. La RAM utilise `MemAvailable`. Sans swap, sa valeur est indisponible. Les systèmes de fichiers utilisent l’espace disponible pour les utilisateurs non privilégiés ; les montages virtuels et de conteneurs sont exclus. Les exclusions couvrent aussi les sous-chemins. La charge correspond à 1, 5 et 15 minutes ; la durée de fonctionnement part du démarrage de l’hôte.

Seuils par défaut : 90 % pour le processeur, la RAM et chaque système de fichiers. Trois dépassements consécutifs activent une condition ; deux rapports sous le seuil la résolvent. Les conditions sont indépendantes. La pression donne l’état dégradé. Trois intervalles sans rapport accepté donnent l’état hors ligne ; deux rapports confirment le retour, sous réserve des autres conditions. Les échéances sont vérifiées toutes les cinq secondes. Les notifications respectent canaux, maintenance et tentatives de livraison. Un moniteur en pause ne déclenche pas d’alertes ; sa reprise ouvre une nouvelle fenêtre de connexion.

Avant le premier rapport, le moniteur reste en attente ; le dépannage apparaît après trois intervalles. Une RAM élevée n’est pas une détection de processus tués par manque de mémoire. Une mesure manquante ne résout pas une alerte ; restaurez un montage disparu ou excluez-le explicitement.

## Historique et confidentialité

L’heure de réception détermine la disponibilité. Les doublons et échantillons anciens ne prolongent pas la connexion. La conservation suit le réglage de l’opérateur `CHECK_LOG_RETENTION_DAYS`, fixé par défaut à 30 jours. Le graphique affiche jusqu’à 1 000 rapports et le tableau les 50 derniers affichés. Le nettoyage supprime les anciennes mesures par lots. Supprimer le moniteur supprime ses mesures et son jeton. Les pages publiques n’exposent ni métadonnées hôte, ni chemins, ni mesures privées.

## Rotation, mise à jour et suppression

Renouvelez le jeton dans les paramètres, puis lancez l’installateur téléchargé avec `--rotate` avant l’argument d’origine ; il demande le nouveau jeton et redémarre systemd. L’ancien cesse immédiatement de fonctionner. Téléchargez l’installateur de la version souhaitée puis utilisez `--upgrade` pour une mise à jour. Redémarrage : `sudo systemctl restart pulsy-agent`. Suppression : installateur avec `--uninstall`.

Pour Compose, relancez `--compose` pour mettre à jour ou renouveler le jeton ; le conteneur est recréé automatiquement. Pour supprimer : `sudo docker compose -f /opt/pulsy-agent/compose.yaml down`, puis supprimez `/opt/pulsy-agent`. Supprimez séparément le moniteur dans Pulsy.

## Dépannage et limites

Vérifiez journaux, DNS/HTTPS sortant, certificats, jeton, horloge et permissions. Attendez deux relevés pour le processeur. Respectez l’intervalle effectif retourné par Pulsy. La version 1 ne détecte pas les OOM kills, ne surveille pas les processus, n’exécute pas de commandes distantes et ne prend pas en charge Windows ou macOS.

Activez les notifications d’état dégradé du canal pour les alertes CPU, RAM et systèmes de fichiers, et les notifications de panne pour les rapports manquants.

## Systèmes de fichiers exclus

Dans les Paramètres du serveur, saisissez un chemin absolu par ligne, par exemple `/var/lib/docker`. Chaque entrée commence par `/` ; les listes séparées par des virgules et les chemins relatifs ne sont pas acceptés. Limite : 32 chemins, chacun de 512 octets UTF-8 maximum, sans caractères de contrôle. Un chemin exclu exclut aussi ses descendants.
