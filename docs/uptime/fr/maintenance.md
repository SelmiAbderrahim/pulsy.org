# Maintenance et suspension des alertes

## Étapes

Sélectionnez des moniteurs puis Maintenance et suspension des alertes, ou ouvrez les paramètres d’un moniteur. Ces commandes sont disponibles pour chaque compte. Elles changent uniquement les notifications : contrôles, santé mesurée, disponibilité brute et incidents mesurés continuent. Un moniteur indisponible peut aussi afficher Maintenance. Suspendre les alertes ne suspend pas les contrôles.

Choisissez 15 minutes, une heure, quatre heures ou une fin personnalisée dans les 30 jours. Le motif privé et l’heure de reprise restent visibles dans vos commandes. Reprendre les alertes retire uniquement les moniteurs choisis des suspensions ; les calendriers de maintenance restent actifs. Terminer un calendrier concerne toute sa sélection explicite et demande confirmation. Les moniteurs ajoutés plus tard ne sont jamais inclus automatiquement.

Les calendriers avancés comprennent nom, motif privé, début, fin, fuseau IANA et récurrence unique, quotidienne ou hebdomadaire. Les champs de date utilisent le fuseau local du navigateur. Le fuseau IANA choisi détermine les heures locales des récurrences suivantes. Vérifiez les occurrences affichées avant d’enregistrer ; toute modification demande une nouvelle prévisualisation. La durée écoulée maximale est de 24 heures pour les récurrences et 30 jours pour une occurrence unique. Les débuts locaux inexistants au passage à l’heure d’été sont ignorés. Les horaires quotidiens et hebdomadaires suivent le décalage local. Enregistrer ou prévisualiser ne sonde aucun endpoint client.

La suppression inclut le début et exclut la fin. Tous les calendriers et suspensions applicables se combinent ; terminer l’un ne termine pas les autres. Un worker durable vérifie les fenêtres actives juste avant l’envoi. Après la dernière fenêtre, un moniteur actif encore dans la même panne reçoit une alerte différée par destination admissible. Les épisodes rétablis, suspendus, supprimés ou remplacés ne déclenchent pas cette alerte. Le rétablissement d’une panne supprimée est envoyé seulement aux destinations exactes ayant un reçu de livraison réussie de la panne. Ajouter ou changer une destination n’autorise pas son message de rétablissement.

L’historique distingue les tentatives, acceptations, échecs et suppressions selon les preuves disponibles. L’acceptation du fournisseur ne prouve pas la réception dans la boîte de messagerie. Examinez un échec avant de réessayer ; un résultat incertain peut entraîner un doublon.

La limite technique est de 200 calendriers actifs par compte. Les occurrences uniques expirées quittent immédiatement la liste active. Un nettoyage quotidien supprime par lots bornés les historiques expirés ou annulés et les livraisons terminées après 30 jours. Un reçu minimal de panne actuelle par moniteur survit à la rétention des contrôles pour conserver un rétablissement correct ; anciens timings, états et motifs en sont retirés.

Les motifs restent privés. Pour publier un avis, ouvrez les commandes de communication de la page voulue, sélectionnez explicitement une occurrence et ses composants publics, rédigez un texte public séparé, prévisualisez puis publiez. Les récurrences suivantes exigent une nouvelle publication. Consultez le guide de communication de statut. La maintenance ne modifie ni disponibilité brute ni exclusions SLA.
