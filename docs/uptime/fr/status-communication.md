# Communication sur la page de statut publique

## Étapes

Ouvrez Pages de statut dans la navigation de l’application, puis Gérer la communication pour
la page voulue. La publication et les domaines personnalisés sont disponibles pour chaque compte. Les composants publics référencent uniquement des moniteurs de votre
compte sélectionnés explicitement. Une page existante utilise initialement les
noms de moniteurs déjà divulgués : définissez des noms et descriptions publics
distincts pour protéger les noms de déploiement privés. Les groupes sont des
libellés simples, sensibles à la casse, affichés dans l'ordre de leur premier
composant ; l'ordre modifié des composants est conservé dans chaque groupe.
Déplacez les composants volontairement, prévisualisez tous les noms, descriptions
et groupes divulgués, puis appliquez. Aucun futur résultat de filtre par étiquette
ni URL ou configuration de requête privée n'est ajouté. Une sélection inchangée
conserve ses clés de composant ; retirer puis réajouter crée une nouvelle identité.
Appliquer des noms à une page publiée la modifie immédiatement. L'aperçu indique
son état de publication. Toute modification de page, de membre ou de nom invalide
l'aperçu et exige une nouvelle prévisualisation.

## Exemple

Rédigez une annonce distincte : titre, texte brut sur plusieurs lignes, étape
En cours d'investigation/Identifié/Sous surveillance/Résolu, composants concernés
exacts et fuseau IANA. Enregistrez d'abord un brouillon privé. L'aperçu montre la
page, les noms publics concernés, le texte, l'étape et le fuseau. Publiez
explicitement ; une page non publiée doit d'abord être publiée avec sa commande
existante. Une publication n'acquitte pas un incident privé, ne modifie pas la
santé mesurée, ne résout pas un incident mesuré et ne suspend pas les contrôles.
Les notes et procédures privées ne sont jamais copiées dans une annonce client.
Les valeurs de requête configurées et URL contenant des identifiants sont masquées
avant stockage du brouillon ; ne collez pas de secrets. Le texte est échappé,
avec ses sauts de ligne : aucun HTML actif ni script arbitraire n'est exécuté.

## Comportement

Un message publié est immuable. Ajouter un suivi crée un nouveau brouillon qui
le référence et exige à nouveau enregistrement, aperçu et publication. Modifier
un brouillon privé ne modifie pas un message publié. Les actions concurrentes
invalident les aperçus périmés, y compris si le brouillon change pendant l'attente
du verrou de page. La vue de gestion présente les 100 derniers messages et accepte
actuellement 1 000 messages par page. Archivage et pagination doivent être ajoutés
avant d'atteindre cette limite technique. Il s’agit de limites techniques de fonctionnement.

Un avis de maintenance sélectionne un calendrier de maintenance actif de votre
compte, l'une de ses cinq prochaines occurrences vérifiées et les composants
exacts présents à la fois dans ce calendrier et sur la page. Une suspension
temporaire d'alertes n'est pas un avis public. Rédigez le texte public séparément :
les motifs internes restent privés. L'aperçu montre début et fin dans le fuseau
IANA du calendrier. La publication couvre uniquement l'occurrence choisie ; la
récurrence continue indépendamment et chaque avis suivant exige une publication
explicite. Annuler ou modifier le calendrier avant publication invalide l'avis.
Publier ne modifie ni disponibilité brute ni politique de suppression d'alertes.

RSS et Atom utilisent la projection publique sûre. Les adresses dédiées sont
`/api/status/pages/<publicKey>/feed.rss` et `feed.atom`. `status.json` est en
version 1 et `badge.svg` affiche l'état global stocké. publicKey est un identifiant
public non secret, sans accès au compte ni à la configuration. Les pages absentes
ou en brouillon sont indisponibles. Les états vides ou partiels restent inconnus ;
un composant En panne ou Dégradé garde la priorité. Les lectures et flux ne lancent
aucun contrôle. Ils excluent URL, en-têtes, secrets, abonnés, notes internes,
informations de vérification de fournisseur/domaine et adresses e-mail. asOf
correspond à l'heure de génération de la réponse ; la date du dernier contrôle
reste une observation stockée. Accept-Language choisit parmi cinq langues pour
le badge. Les flux conservent le texte public rédigé par l'auteur.

## Abonnements par e-mail

Activez les abonnements e-mail uniquement avec un fournisseur vérifié et utilisable
de votre compte. Aucun service e-mail financé par Pulsy n'est fourni ; les
destinataires d'alertes ne sont jamais importés. Enregistrez avec confirmation
explicite. Changer de fournisseur, désactiver ou changer le budget annule les
tâches non envoyées de la configuration précédente ; un envoi déjà commencé peut
se terminer. Les abonnés confirmés restent inscrits aux futurs messages ; les
personnes désabonnées le restent. La gestion affiche des compteurs et catégories
d'échec privés, jamais adresses ni jetons. L'acceptation par le fournisseur ne
prouve pas une livraison dans la boîte de réception.

## Valeurs privées et limites

Le visiteur choisit toute la page, y compris ses futurs composants publiés
explicitement, ou certains composants exacts, saisit son adresse et demande une
confirmation. Les espaces externes sont retirés et la casse normalisée pour la
déduplication par page. La confirmation expire après 24 heures ; une nouvelle
demande est possible après 15 minutes. Un changement de périmètre exige une
nouvelle confirmation ; l'ancien périmètre confirmé reste actif entre-temps.
Les nouveaux abonnés reçoivent les futurs messages correspondants, pas l'historique.
Retirer puis réajouter un composant crée une nouvelle clé qui ne remplace pas
silencieusement une sélection. Les liens de confirmation et désabonnement
utilisent un fragment retiré avant initialisation du routeur et des analyses,
gardé uniquement en mémoire pour cette page. L'action exige un clic ; ouvrir le
lien seul ne fait rien. Le désabonnement fonctionne après dépublication ; supprimer
la page supprime les enregistrements. Les anciens jetons ne peuvent pas modifier
une inscription confirmée ultérieure. Les réponses neutres ne révèlent pas si
l'adresse est inscrite ; un lien expiré peut rester sans effet. Aucune importation
de destinataires ni réinscription automatique n'est proposée.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)

Les réglages des abonnés affichent uniquement les prérequis non satisfaits de publication et de fournisseur, avec des liens vers Général, la sélection du fournisseur ou Notifications. Le fournisseur doit appartenir au compte, être vérifié et disposer d’identifiants complets et déchiffrables. La vérification seule ne suffit pas. La réponse de disponibilité ne contient aucun secret du fournisseur.
