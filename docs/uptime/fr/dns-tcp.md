# Surveillance DNS et TCP

Chaque compte peut surveiller DNS et TCP, en plus de HTTP et heartbeat. L’historique suit le réglage de l’opérateur `CHECK_LOG_RETENTION_DAYS`.

## Étapes

Dans le menu « Ajouter un moniteur », choisissez « Moniteur DNS / TCP », puis nom, hôte, intervalle, délai et nombre d’échecs consécutifs avant panne. La création est explicite ; un moniteur activé commence les contrôles planifiés. La désactivation arrête les sondes sans rendre le service sain. Maintenance et suspension bloquent les notifications, tandis que contrôles et historique mesuré continuent. Acquittement, notes et communication publique restent distincts de la santé.

## Exemple

DNS prend en charge A, AAAA, CNAME, MX et TXT via le résolveur système configuré par l’opérateur. Les noms ASCII/punycode sont limités à253 caractères ; les préfixes soulignés tels que `_acme-challenge.example.invalid` restent intacts. Entrez un nom, sans URL ni port. Choisissez l’existence d’un enregistrement ou un ensemble attendu exact, saisi comme tableau JSON :

- A : `["1.1.1.1"]` ; AAAA : `["2001:4860:4860::8888"]`.
- CNAME : `["api.example.invalid"]`.
- MX : `[{"priority":10,"exchange":"mail.example.invalid"}]`.
- TXT : `["Case Sensitive", ""]`. Chaque chaîne est un enregistrement complet, fragments réunis. Une chaîne vide diffère d’une absence de réponse.

L’ordre et les occurrences répétées n’affectent pas la comparaison. Les adresses sont normalisées ; CNAME et hôtes MX ignorent casse et point final, mais la priorité MX reste significative. TXT conserve contenu, espaces et casse exacts. Des réponses modifiées ou supprimées échouent ; aucun nouveau résultat n’est appris automatiquement comme référence. Changer le type ne remplace pas vos attentes : corrigez le JSON avant d’enregistrer.

Les causes distinguent nom inexistant, réponse vide, résolution temporairement défaillante, délai, ensemble différent, adresse interdite et dépassement. Maximum50 réponses,4KiB par TXT et64KiB d’attentes/réponses normalisées ; délai maximal60 000ms. Les requêtes natives sont annulées à l’échéance. Le résolveur reste une infrastructure de confiance de l’opérateur ; cette interface ne permet pas de choisir un serveur DNS arbitraire. Les réponses brutes ne sont pas conservées comme observations.

## Comportement

TCP établit une connexion native à un hôte et un port1–65535. Le délai comprend résolution et connexion, jusqu’à60 000ms. Une connexion réussie est saine ; refus, délai, résolution ou destination interdite échouent selon le seuil consécutif. Le socket est fermé après chaque tentative. Un port ouvert ne garantit ni authentification, ni application, ni certificat TLS. Ce contrôle n’active pas TCP TLS.

Listes, détails, historique, incidents et canaux partagent le pipeline de santé. DNS mesure la requête ; TCP inclut résolution et établissement. Les unités sont des millisecondes, sans mesure du chargement navigateur. Les règles de latence facultatives utilisent ces durées et l’hystérésis existante. Les données inconnues restent neutres, l’historique mesuré reste intact ; acquittement ou annonce ne fabriquent pas de rétablissement.

## Valeurs privées et limites

Les étiquettes gardent leur casse et leurs limites. Duplication et modèles copient la configuration réseau non secrète, avec création explicite, sans identifiants, historique, incidents, publication ni destinataires. Les modifications d’un modèle concernent les créations futures. Le manifeste natifversion1 comprend DNS/TCP typé, attentes bornées, politique de durée et références de canaux appartenant au compte. Aperçu sans écriture ; application additive, atomique et idempotente, sans suppression ni publication implicite. Les clés API utilisent `read` pour lire et `full` pour écrire ; ces deux portées sont disponibles pour chaque compte.

Les cibles CNAME conservent les caractères de soulignement. Un ensemble MX nul attendu est `[{"priority":0,"exchange":"."}]` et ne doit contenir aucun autre enregistrement MX. Il indique que le domaine refuse volontairement le courrier, sans prouver qu’un service SMTP est accessible ([RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html)). Le nom racine vide du résolveur natif est comparé à ce point explicite. Une réponse MX nulle mélangée ou de priorité non nulle échoue.

## Dépannage

Vérifiez d’abord le moniteur, la période et les réglages enregistrés. L’absence d’observations ne signifie pas un service sain. Après une erreur, gardez le brouillon, corrigez le champ ou prérequis indiqué, puis réessayez explicitement. Renouvelez et vérifiez un aperçu périmé avant application.

## Rubriques associées

- [Vues personnelles enregistrées et groupes](/dashboard/help/saved-views)
- [Contrôles HTTP avancés](/dashboard/help/http-checks)
- [Objectifs de fiabilité et contexte des événements](/dashboard/help/reliability)
- [Communication sur la page de statut publique](/dashboard/help/status-communication)
