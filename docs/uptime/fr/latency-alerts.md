# Dégradation de latence et rétablissement stable

## Étapes

À la création ou dans Paramètres, ouvrez Latence et politique d’alerte puis activez-la. Elle est disponible pour chaque compte. L’ajout rapide et les moniteurs sans politique conservent leur comportement. null désactive explicitement et restaure l’ancien comportement. Modifier ou remplacer en lot par une politique différente remet les séries à zéro ; une politique identique ou une autre modification les conserve. Contrôles, incidents et reçus ne sont pas supprimés.

## Comportement

Les seuils sont facultatifs. Activez la détection lente pour définir seuil supérieur et nombre consécutif. La durée représente cette requête HTTP en millisecondes, lecture des assertions comprise, pas le chargement du navigateur. Toutes les assertions doivent réussir sur la même réponse avant la latence. Injoignable, statut non admissible et assertion échouée deviennent indisponibles selon le seuil de panne existant. Avec politique active, une réponse inattendue sous 400 échoue aussi ; les anciens moniteurs gardent Dégradé dans ce cas.

Une réponse valide strictement au-dessus du seuil supérieur est lente. Le nombre consécutif configuré fait passer Disponible à Dégradé. L’égalité n’est pas lente. Une réponse valide inférieure ou égale au seuil de rétablissement avance sa série ; l’égalité compte, zéro est accepté. Ce seuil ne dépasse pas le seuil supérieur. Les valeurs intermédiaires remettent le progrès à zéro et conservent Indisponible/Dégradé. Indisponible est prioritaire jusqu’à la série complète de rétablissement, même avec des réponses valides lentes. Sans seuil de latence, toute réponse valide avance le rétablissement. Comptes 1–10, seuils jusqu’à 60 000ms, délai minimal entre alertes jusqu’à 3 600 secondes.

Le moniteur affiche l’état maintenu et la progression ; chaque contrôle garde son échantillon brut Disponible/Indisponible/Dégradé. Un seul incident mesuré reste ouvert lors d’une condition lente → panne persistante, et le rétablissement compté le clôt. Le motif lent conserve durée et seuil de l’époque. Le graphe affiche le seuil actuel ; les durées manquantes restent des lacunes. Modifier la politique ne requalifie pas les contrôles passés.

Critique et Avertissement utilisent les canaux sélectionnés/par défaut. Information conserve pannes et incidents sans alerte opérationnelle ; cela compte toujours dans la disponibilité brute. Les canaux disposent de Notifier les dégradations, désactivé au départ pour anciens et nouveaux canaux. Les choix de panne/rétablissement restent inchangés. TLS conserve sa politique indépendante.

Les transitions configurées entrent dans une file durable. Une nouvelle alerte attend le délai depuis la dernière livraison effective ; maintenance/suspension peuvent ajouter de l’attente. Le rétablissement ignore ce délai et vise seulement les destinations exactes avec reçu réussi de l’épisode actuel, dont une dégradation livrée si l’alerte de panne suivante est retardée ou désactivée. L’escalade garde cette identité. Désactiver la politique conserve l’association des reçus et le rétablissement durable d’un épisode configuré. Une nouvelle dégradation ancienne ne réutilise pas les reçus d’un épisode rétabli.

## Exemple

L’historique distingue les tentatives, acceptations, échecs et suppressions selon les preuves disponibles. L’acceptation du fournisseur ne prouve pas la réception dans la boîte de messagerie. Examinez un échec avant de réessayer ; un résultat incertain peut entraîner un doublon.

Tester est un échantillon explicite : validité brute des assertions/latence, pas l’état maintenu après plusieurs échantillons. Aucun progrès, historique, incident ni notification n’est modifié. POST exige confirmation pour ses effets possibles ; enregistrer ne teste pas automatiquement.

L’interface est disponible en anglais, arabe, français, allemand et espagnol. Les lectures REST exposent la politique et les compteurs non secrets. Chaque compte peut utiliser des clés API de portée `read` pour lire et `full` pour écrire. Envoyez la clé du compte avec `Authorization: Bearer`, jamais dans une URL.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)
