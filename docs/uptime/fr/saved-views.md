# Vues personnelles enregistrées et groupes

## Étapes

Réglez recherche, état, correspondance des étiquettes, tri, densité et regroupement
dans le tableau de bord, puis Enregistrer une nouvelle vue. Une vue conserve les
filtres de votre compte : elle ne crée ni moniteur, espace de travail, composant
public ni usage supplémentaire. Les vues sont personnelles et limitées au compte propriétaire. Les vues partagées exigent un modèle d'autorisation
compatible et ne sont pas présentées comme disponibles.

## Comportement

Vous pouvez conserver 200 vues personnelles, avec noms de 80 caractères,
recherches de 100 caractères et 50 étiquettes sélectionnées maximum. Ce sont des
protections techniques pour chaque compte. Supprimez
une vue inutilisée si le plafond est atteint. Épingler place la vue avant les
autres. Un seul choix par défaut existe par compte ; les modifications simultanées
sont sérialisées. Il ne s'applique qu'à un tableau de bord sans paramètres de
filtre. Un lien explicite a priorité. Effacer les filtres enregistre un état
explicitement vide, empêchant de réappliquer immédiatement la vue par défaut.

Appliquer une vue ajoute une entrée à l'historique du navigateur. Précédent/Suivant
et rechargement restaurent les filtres exacts de l'URL. Modifier un filtre change
l'URL mais laisse la vue enregistrée intacte jusqu'à Mettre à jour la vue. L'écran
signale les modifications non enregistrées. Supprimer une vue supprime seulement
les filtres enregistrés ; moniteurs, contrôles, incidents, paramètres et publication restent intacts.

## Exemple

Les filtres d'étiquettes distinguent la casse. Une étiquette sélectionnée correspond
à une union ; Toutes les étiquettes sélectionnées exige chaque étiquette. La
recherche reste une sous-chaîne insensible à la casse des noms, URL et étiquettes.
Les nouveaux liens encodent des tableaux, conservant virgules et texte arabe ;
les anciens liens séparés par virgules restent lisibles. C'est une configuration
de l'interface, pas un endpoint d'export programmatique.

Regroupez par toutes les étiquettes existantes ou par celles ayant le préfixe
exact `env:` et une valeur non vide, par exemple `env:production`. Aucun dossier
ni environnement imbriqué n'est créé. Chaque groupe compte les moniteurs uniques
correspondants ; un moniteur multi-étiquettes peut figurer dans plusieurs groupes.
La somme des comptes peut donc dépasser le nombre de moniteurs filtrés. Ceux sans
groupe apparaissent dans Sans groupe correspondant. Regroupement, tri et densité
conservent la sélection ; changer recherche, état ou étiquettes efface sélection
et dialogues groupés. Une actualisation retire immédiatement de la sélection
actionnable les identifiants masqués ou supprimés. Tout sélectionner et les actions
groupées utilisent toujours des identifiants uniques explicites. Les étiquettes
sont des commandes natives utilisables au clavier.

## Dupliquer et modèles de création

Dupliquer ouvre un nouveau formulaire avec nom dérivé, méthode, statut attendu,
intervalle, timeout, seuil d'échec, règles d'assertion/redirection/latence et
étiquettes. Saisissez de nouveau la destination. En-têtes privés, authentification
et corps ne sont jamais copiés, même s'ils existaient dans la source. Historique,
incidents, jetons, appartenance aux pages et abonnés ne sont pas copiés. Enregistrer
crée explicitement un moniteur indépendant avec l’intervalle configuré.

Enregistrer comme modèle ouvre une configuration non secrète modifiable. Un modèle
ne contient ni URL ni valeurs de requête privées. Un avertissement conserve le
besoin éventuel de valeurs privées de la source. Il peut référencer jusqu'à 20
canaux d'alerte existants du compte, réutilisant leurs paramètres sans copier
destinataires ni secrets. Les valeurs par défaut du compte s'appliquent toujours ;
les identifiants et destinations dupliqués sont dédupliqués lors de l'envoi.
Modifier un canal affecte les moniteurs liés ; le supprimer retire les liens.
Un modèle référençant un canal supprimé ne peut créer un moniteur avant retrait
ou remplacement explicite de la référence. Le sélecteur liste 200 canaux au plus
par type et identifiant, sans destination ni destinataire.

Les modèles sont personnels et limités
techniquement à 200 par compte. Enregistrer un modèle ne crée pas de moniteur. Modifier
ou supprimer un modèle laisse les moniteurs existants intacts. L'utiliser ouvre
le formulaire normal ; le serveur revalide cadence et références
possédées à chaque création. Aucun effet automatique de publication ou mise à
jour groupée n'est déclenché.

## Ajouter une sélection à une page existante

Sélectionnez les identifiants exacts, choisissez une page et Prévisualiser la
sélection. L'aperçu n'écrit rien. Il montre identité et publication de la page,
nom public exact de chaque ajout, comptes et champs divulgués. Appliquer cette
sélection ajoute seulement ces identifiants en conservant membres et ordre
existants. Aucun futur résultat d'étiquette n'est ajouté ; aucun brouillon n'est
publié et le drapeau public historique du moniteur n'est pas changé.

Sur une page publiée, appliquer modifie immédiatement la sélection publique.
Noms, santé mesurée, disponibilité, temps de réponse, dernier contrôle et dates
d'incidents récents sont publics selon la projection existante ; URL et secrets
restent privés. Vérifiez les noms avant application. La gestion de communication
permet des noms publics distincts. Le plafond existant de 100 composants s'applique.
Toute modification concurrente de membres, publication ou nom divulgué invalide
l'aperçu ; prévisualisez de nouveau.

Remplacer toute la sélection se fait désormais dans une transaction. Un échec
de validation ou d'insertion conserve la sélection précédente. Ajouts et
remplacements sont sérialisés sur la page possédée.

Notifications affiche les identifiants et types des canaux réutilisés. Détacher
une référence enlève seulement le lien de ce moniteur ; valeurs par défaut et
canaux directs restent actifs. Le canal original n'est ni supprimé ni modifié.
Les canaux pris en charge sont e-mail, webhook, Slack, Discord et Telegram.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)

## Navigation et actions des moniteurs

À partir de 1024 px, la barre latérale reste visible et les moniteurs sont présentés en tableau. En dessous, ouvrez le menu de navigation et utilisez les cartes des moniteurs. La densité compacte et le regroupement restent accessibles dans le panneau Filtres du tableau de bord sur les petits écrans ; la densité compacte concerne les lignes du tableau. Sur une page de détail étroite, Plus d’actions à côté des onglets visibles donne accès aux autres onglets.

Utilisez Mettre en pause pour suspendre contrôles planifiés et alertes, puis Reprendre pour continuer. En pause décrit l’activité de surveillance, indépendamment du dernier état mesuré. Les heartbeats peuvent encore enregistrer les résultats reçus pendant la pause ; Reprendre démarre un nouveau délai.
