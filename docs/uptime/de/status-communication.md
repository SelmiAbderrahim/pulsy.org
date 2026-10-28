# Mitteilungen auf der öffentlichen Statusseite

## Schritte

Öffnen Sie Statusseiten in der Anwendungsnavigation und dann Kommunikation verwalten für die
gewünschte Seite. Veröffentlichung und eigene Domains stehen jedem Konto zur Verfügung.
Öffentliche Komponenten verweisen ausschließlich auf ausdrücklich ausgewählte
Monitore Ihres Kontos. Bestehende Seiten verwenden zunächst die bereits gezeigten
Monitornamen. Legen Sie getrennte öffentliche Namen und Beschreibungen fest, wenn
private Deploymentnamen verborgen bleiben sollen. Einfache Gruppenbezeichnungen
unterscheiden Groß- und Kleinschreibung. Gruppen erscheinen an der Position ihrer
ersten Komponente; innerhalb der Gruppe gilt die bearbeitete Reihenfolge.
Verschieben Sie Komponenten bewusst, prüfen Sie alle öffentlichen Namen,
Beschreibungen und Gruppen in der Vorschau und wenden Sie sie an. Künftige
Tagtreffer und private URLs oder Anfragekonfigurationen werden nicht ergänzt.
Unveränderte Auswahl behält Komponentenschlüssel; Entfernen und erneutes Hinzufügen
erzeugt eine neue Identität. Änderungen öffentlicher Namen auf einer veröffentlichten
Seite werden sofort sichtbar. Die Vorschau zeigt den Veröffentlichungszustand.
Änderungen an Seite, Mitgliedschaft oder Namen machen die Vorschau ungültig.

## Beispiel

Verfassen Sie eine getrennte Mitteilung mit Titel, mehrzeiligem Klartext,
Wird untersucht/Identifiziert/Wird beobachtet/Behoben, genauen betroffenen
Komponenten und IANA-Zeitzone. Speichern Sie zunächst einen privaten Entwurf.
Die Vorschau zeigt Seite, betroffene öffentliche Namen, Text, Stand und Zeitzone.
Veröffentlichen Sie ausdrücklich; eine unveröffentlichte Seite muss zuerst über
ihre bestehende Steuerung veröffentlicht werden. Eine Mitteilung bestätigt keinen
privaten Vorfall, ändert keine gemessene Gesundheit, schließt keinen gemessenen
Vorfall und pausiert keine Prüfung. Private Notizen und Handlungsanleitungen werden
nie in Kundenmitteilungen kopiert. Konfigurierte Anfragewerte und URLs mit
Zugangsdaten werden vor dem Speichern maskiert. Fügen Sie keine Geheimnisse ein.
Der Text wird mit Zeilenumbrüchen sicher als Klartext dargestellt, ohne aktives
HTML oder beliebige Skripte.

## Verhalten

Veröffentlichte Updates sind unveränderlich. Weiteres Update verfassen erzeugt
einen neuen referenzierenden Entwurf, der erneut Speichern, Vorschau und
Veröffentlichung verlangt. Private Entwurfsänderungen ändern keine veröffentlichten
Einträge. Gleichzeitige Bearbeitung verwirft veraltete Vorschauen, auch wenn ein
Entwurf während des Wartens auf die Seitensperre geändert wurde. Die Verwaltung
zeigt die neuesten 100 Einträge und unterstützt derzeit 1.000 Einträge pro Seite.
Archivierung und Seitennavigation müssen vor Erreichen dieser technischen Grenze
ergänzt werden. Dies sind technische Betriebsgrenzen.

Ein Wartungshinweis wählt einen aktivierten eigenen Wartungsplan, eine seiner
fünf nächsten geprüften Ausführungen und genaue Komponenten aus, die sowohl dem
Plan als auch der Seite angehören. Eine Alarmunterbrechung ist kein öffentlicher
Wartungshinweis. Verfassen Sie öffentlichen Text getrennt; interne Gründe bleiben
privat. Die Vorschau zeigt Anfang und Ende in der IANA-Zeitzone des Plans.
Veröffentlichung gilt ausschließlich für die gewählte Ausführung. Wiederholung
läuft unabhängig weiter; spätere Hinweise verlangen neue ausdrückliche
Veröffentlichung. Abbrechen oder Ändern des Plans vor Veröffentlichung verwirft
den Hinweis. Veröffentlichung ändert weder rohe Verfügbarkeit noch Alarmunterdrückung.

RSS und Atom verwenden dieselben sicheren öffentlichen Daten. Die Adressen lauten
`/api/status/pages/<publicKey>/feed.rss` und `feed.atom`; `status.json` hat Version 1,
`badge.svg` zeigt den gespeicherten Gesamtzustand. publicKey ist eine öffentliche,
nicht geheime Kennung ohne Zugriff auf Konto oder Konfiguration. Fehlende Seiten
und Entwürfe sind nicht verfügbar. Leere oder teilweise beobachtete Zustände bleiben
unbekannt; Ausgefallen und Eingeschränkt haben weiter Vorrang. Abrufe und Feeds
führen keine Prüfungen aus. URLs, Header, Zugangsdaten, Abonnenten, interne Notizen,
Anbieter- oder Domainprüfdaten und E-Mail-Adressen bleiben ausgeschlossen. asOf
ist die Antworterzeugungszeit, die letzte Prüfung bleibt ein gespeicherter Fakt.
Accept-Language wählt eine von fünf Sprachen für Badgebeschriftungen. Feeds
bewahren den vom Autor veröffentlichten Text.

## E-Mail-Abonnements

Aktivieren Sie E-Mail-Abonnements nur mit einem bestätigten, nutzbaren Anbieter
Ihres Kontos. Pulsy stellt keinen finanzierten Maildienst bereit; Alarmempfänger
werden nie importiert. Speichern verlangt ausdrückliche Bestätigung. Anbieterwechsel,
Deaktivierung oder Budgetänderung stornieren ungesendete Aufgaben der bisherigen
Konfiguration; bereits gestartete Sendungen können enden. Bestätigte Abonnenten
bleiben für zukünftige Updates angemeldet, abgemeldete bleiben abgemeldet.
Die Verwaltung zeigt private Zähler und sichere Fehlerkategorien, keine Adressen
oder Tokens. Annahme durch den Anbieter beweist keine Zustellung im Posteingang.

## Private Werte und Grenzen

Besucher wählen die ganze Seite einschließlich künftiger ausdrücklich
veröffentlichter Komponenten oder bestimmte Komponenten, geben eine Adresse ein
und fordern Bestätigung an. Äußere Leerzeichen werden entfernt, Großschreibung
wird für die Dublettenerkennung je Seite vereinheitlicht. Bestätigung muss binnen
24 Stunden erfolgen; nach 15 Minuten ist eine erneute Anfrage möglich. Eine
Bereichsänderung verlangt neue Bestätigung; bis dahin gilt die bisher bestätigte
Auswahl. Neue Abonnenten erhalten zukünftige passende Updates, keine alte Historie.
Entfernte und erneut ergänzte Komponenten erhalten neue Schlüssel und ersetzen
keine bestehende Auswahl stillschweigend. Bestätigungs- und Abmeldelinks nutzen
ein Fragment, das vor Router- und Analyseinitialisierung entfernt und nur im
Seitenspeicher gehalten wird. Die Aktion erfordert einen Klick; Aufrufen allein
bewirkt nichts. Abmeldung funktioniert auch nach Zurückziehen der Veröffentlichung;
Löschen entfernt die Datensätze. Alte Tokens können eine spätere bestätigte
Anmeldung nicht ändern. Neutrale Antworten verraten keine registrierte Adresse;
abgelaufene Links können wirkungslos bleiben. Empfängerimport und automatische
Wiederanmeldung werden nicht unterstützt.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)

Die Abonnenteneinstellungen zeigen nur unerfüllte Voraussetzungen für Veröffentlichung und E-Mail-Anbieter, mit Links zu Allgemein, zur Anbieterauswahl oder zu Benachrichtigungen. Der Anbieter muss dem Konto gehören, verifiziert sein und vollständige, entschlüsselbare Zugangsdaten besitzen. Eine Verifizierungsmarkierung allein reicht nicht. Die Bereitschaftsantwort enthält keine Anbieter-Geheimnisse.
