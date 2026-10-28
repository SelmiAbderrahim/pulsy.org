# Réponse personnelle aux incidents

## Étapes

Ouvrez Incidents depuis le tableau de bord. Recherchez nom de moniteur ou cause,
puis filtrez Non résolus (Ouverts et Acquittés), Ouverts (non acquittés et encore mesurés défaillants), Acquittés,
Résolus ou Tous. La sévérité est l'importance enregistrée au départ d'un nouvel
incident ; les anciens ont Inconnue, sans inventer une valeur historique. Chaque
ligne montre compte propriétaire, début, durée en secondes et dernière mise à
jour. Les pages par curseur utilisent un ordre stable début/identifiant. Filtres,
pages et incident choisi sont dans l'URL : rechargement et Précédent/Suivant
gardent le contexte. Un lien de moniteur ou groupe filtre seulement vos données ;
l'identifiant d'un autre compte ne donne aucun accès.

## Préférences d’affichage des heures

Ouvrez le menu du compte en bas de la barre latérale, puis **Préférences**. Choisissez **Langue** et **Fuseau horaire du compte**, puis **Enregistrer**. La langue est enregistrée dans ce navigateur ; un fuseau IANA explicite est enregistré dans votre compte sur tous vos appareils. Cochez **Utiliser le fuseau du navigateur** pour suivre chaque navigateur. Ces réglages modifient l’affichage, sans changer le début des incidents ni les périodes des rapports.

## Comportement

Vous pouvez retirer l’acquittement d’un incident non résolu pour le remettre à Ouvert. Acquitter ou retirer l’acquittement modifie uniquement la réponse humaine ; la résolution dépend toujours du rétablissement mesuré. Les deux actions figurent dans la chronologie privée.

Acquitter enregistre votre réponse, acteur et heure. Cela ne suspend pas les
contrôles, ne modifie pas disponibilité, ne clôture pas l'incident mesuré et ne
publie rien. Seule une vraie récupération le ferme. Notes privées et descriptions
de procédure sont du texte brut de 2 000 caractères maximum. Les valeurs de
requête/authentification/en-tête/corps connues sont masquées avant stockage ;
ne collez pas de secrets. Les liens de procédure acceptent HTTP(S), sans
identifiants intégrés, paramètres de requête ou fragments. Enregistrer un lien
omis/vide efface explicitement l'ancien. Ils s'ouvrent dans un contexte séparé.
Notes et procédures restent privées, sans usage comme annonces client.

## Exemple

Sélectionnez les incidents exacts sur la page de curseur courante pour créer un
groupe de réponse. Il organise votre réponse sans fusionner les incidents mesurés
ni déduire une cause commune. Changer filtres/pages efface la sélection. Tous
les identifiants sont validés serveur dans une transaction ; un ID étranger ou
manquant rejette l'opération entière. Jusqu'à 100 incidents sélectionnés et
200 groupes par compte actuellement : plafonds techniques.

La chronologie enregistre acquittements, notes, procédures et regroupements.
Nouvelles transitions et résultats d'alerte sont enregistrés séparément des
contrôles bruts : leur nettoyage n'efface pas la trace de réponse. Les transitions
et résultats historiques sont affichés si leurs sources retenues existent.
Aucun corps de réponse, destinataire, erreur de fournisseur, secret ou configuration
privée n'est projeté. Le panneau montre les 100 derniers événements avec indication
de troncature. Jusqu'à 1 000 actions humaines privées par incident. Les événements
suivent rétention/suppression de l'incident : pas une archive d'audit permanente.

Ce workflow appartient au compte propriétaire. Le modèle d’autorisation actuel ne permet ni l’attribution à un équipier ni la gestion partagée des incidents entre comptes.

## Escalade différée

L'escalade différée optionnelle utilise un plan immuable par incident mesuré,
avec un canal principal et éventuellement un second canal propre distinct.
Chaque délai absolu part du début d'incident, entre 60 et 86 400 secondes ;
un délai dépassé devient éligible au prochain scan. Le second attend la fin de
la première tentative, puis peut notifier tant que l'incident reste ouvert et
non acquitté. Modifier la destination affecte les tentatives suivantes ; les
reçus exacts empêchent rejeu/récupération vers une nouvelle destination. Annulez
explicitement pour arrêter les rappels restants. Acquitter arrête seulement les
rappels de cet incident, pas les transitions ordinaires, les rappels d'un autre
ou une vraie récupération. Pause, importance informative ou récupération arrêtent
les rappels. Maintenance les reporte sans changer les mesures.

## Notifications de rétablissement

La récupération atteint aussi les destinations inchangées, activées pour elle,
qui ont reçu une escalade, même sans alerte initiale livrée. Une destination sans
rappel livré n'a aucune récupération inventée. La politique ordinaire existante
reste en place. Annonces client/abonnements sont distincts des actions privées.
L’accès API, les rapports SLA et les rapports mensuels sont disponibles pour chaque compte.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)

Sélectionnez au moins deux incidents pour créer un groupe de réponse. Les actions restent sous la liste sans déplacer les lignes. Le panneau possède un seul bouton de fermeture fixe et une zone de défilement ; Échap le ferme et rend le focus à la ligne sélectionnée.
