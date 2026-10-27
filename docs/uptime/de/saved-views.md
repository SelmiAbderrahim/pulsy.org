# Persönliche gespeicherte Ansichten und Gruppen

## Schritte

Wählen Sie Suche, Zustand, Tagabgleich, Sortierung, Zeilendichte und Gruppierung im
Dashboard und dann Neue Ansicht speichern. Die Ansicht speichert Kontofilter und
erzeugt weder Monitore noch Arbeitsbereiche, öffentliche Komponenten oder weiteren
Verbrauch. Ansichten sind persönlich und auf das Eigentümerkonto beschränkt. Geteilte Ansichten
brauchen passende Berechtigungen und werden nicht als geliefert beworben.

## Verhalten

Speichern Sie bis zu 200 Ansichten mit Namen bis 80 Zeichen, Suche bis 100 Zeichen
und bis zu 50 Tags. Dies sind technische Schutzgrenzen für jedes Konto. Entfernen Sie ungenutzte Ansichten bei Erreichen der Grenze.
Angeheftete erscheinen zuerst. Pro Konto gibt es genau eine Standardansicht;
gleichzeitige Änderungen werden serialisiert. Sie gilt nur für Dashboards ohne
Filterparameter. Ein ausdrücklicher Link hat Vorrang. Filter löschen speichert
einen ausdrücklich leeren Zustand, damit Neuladen den Standard nicht sofort
wieder anwendet.

Anwenden einer Ansicht erzeugt einen Browsereintrag. Zurück/Vorwärts und Neuladen
stellen die genauen URL-Filter wieder her. Filteränderungen ändern die URL, aber
nicht die gespeicherte Ansicht, bis Ansicht aktualisieren gewählt wird. Ungespeicherte
Änderungen werden angezeigt. Löschen entfernt nur gespeicherte Filter; Monitore,
Prüfungen, Vorfälle, Einstellungen und Veröffentlichung bleiben erhalten.

## Beispiel

Tags unterscheiden Groß- und Kleinschreibung. Beliebiges ausgewähltes Tag bildet
eine Vereinigungsmenge; Alle ausgewählten Tags verlangt jedes Tag. Die Suche
bleibt eine großschreibungsunabhängige Teiltextsuche in Name, URL und Tags.
Neue Links kodieren Taglisten und erhalten Kommas sowie arabischen Text; alte
kommagetrennte Links bleiben lesbar. Dies ist eine Oberflächenkonfiguration,
kein programmgesteuerter Exportendpunkt.

Gruppieren Sie nach jedem vorhandenen Tag oder Umgebungstags mit dem genauen
Präfix `env:` und nicht leerem Wert, etwa `env:production`. Es entstehen weder
Ordner noch verschachtelte Umgebungen. Jede Gruppe zählt eindeutige passende
Monitore; ein Monitor mit mehreren Tags kann in mehreren Gruppen erscheinen.
Gruppensummen können deshalb größer als die gefilterte Monitoranzahl sein.
Monitore ohne passende Gruppe erscheinen unter Ohne passende Gruppe. Gruppierung,
Sortierung und Dichte behalten die Auswahl; Suche, Zustand oder Tags ändern
löscht Auswahl und offene Sammeldialoge. Aktualisierte Daten entfernen verborgene
oder gelöschte IDs sofort aus der ausführbaren Auswahl. Alle auswählen und
Sammelaktionen verwenden stets ausdrückliche eindeutige IDs, auch bei mehreren
Gruppenzugehörigkeiten. Tagflächen sind native Tastatursteuerungen.

## Duplizieren und Erstellungsvorlagen

Duplizieren öffnet ein neues Formular mit abgeleitetem Namen, Methode, erwartetem
Status, Intervall, Timeout, Fehlerschwelle, Assertions-, Weiterleitungs- und
Latenzregeln sowie Tags. Geben Sie das Ziel erneut ein. Private Header,
Authentifizierung und Bodywerte werden nie kopiert, auch wenn die Quelle sie
verwendet. Historie, Vorfälle, Tokens, Veröffentlichungszugehörigkeit und
Abonnenten werden nicht kopiert. Ausdrückliches Speichern erzeugt einen unabhängigen
Monitor mit dem konfigurierten Prüfintervall.

Als Vorlage speichern öffnet eine bearbeitbare Konfiguration ohne Geheimnisse.
Vorlagen enthalten weder URL noch private Anfragewerte. Eine Warnung merkt sich,
ob die Quelle private Werte benötigte. Bis zu 20 vorhandene eigene Alarmkanäle
können referenziert werden, ohne Empfänger oder Zugangsdaten zu kopieren.
Kontostandards gelten weiter; doppelte Kanal-IDs und Ziele werden beim Versand
zusammengefasst. Kanaländerungen wirken auf verknüpfte Monitore, Löschen entfernt
Verknüpfungen. Referenziert eine Vorlage einen gelöschten Kanal, muss die Referenz
ausdrücklich entfernt oder ersetzt werden, bevor sie einen Monitor erstellen kann.
Die Auswahl zeigt bis zu 200 vorhandene Kanäle mit Typ und ID, ohne Ziele oder Empfänger.

Vorlagen sind persönlich und technisch auf 200 pro
Konto begrenzt. Eine Vorlage zu speichern erstellt keinen Monitor. Bearbeiten oder Löschen ändert
keinen bestehenden Monitor. Verwenden öffnet das normale Formular; jede Erstellung
prüft Intervall und eigene Referenzen erneut auf dem Server. Keine
automatischen Sammeländerungen oder Veröffentlichungen werden ausgelöst.

## Ausgewählte Monitore zu vorhandener Statusseite ergänzen

Wählen Sie genaue IDs, eine Seite und Auswahl prüfen. Die Vorschau schreibt
nichts. Sie zeigt Seitenidentität, Veröffentlichung, genaue öffentliche Namen
hinzukommender Komponenten, Anzahlen und öffentliche Felder. Diese Auswahl
anwenden ergänzt nur diese IDs und bewahrt bestehende Mitgliedschaft und Reihenfolge.
Zukünftige Tagtreffer werden nicht aufgenommen, Entwürfe nicht veröffentlicht und
das historische Öffentlichkeitsflag des Monitors nicht geändert.

Auf einer veröffentlichten Seite ändert Anwenden sofort die öffentliche Auswahl.
Namen, gemessene Gesundheit, Verfügbarkeit, Antwortzeit, letzte Prüfung und jüngste
Vorfallsdaten sind nach bestehender Projektion öffentlich; URL und Anfragegeheimnisse
bleiben privat. Prüfen Sie Namen vorher. Die Kommunikationsverwaltung bietet
getrennte öffentliche Namen. Die vorhandene Grenze von 100 Komponenten gilt.
Gleichzeitige Änderungen an Mitgliedschaft, Veröffentlichung oder öffentlichem
Namen verwerfen die Vorschau; prüfen Sie erneut.

Kompletter Auswahlersatz wird in einer Transaktion gespeichert. Bei Validierungs-
oder Einfügefehler bleibt die vorherige Auswahl erhalten. Ergänzungen und Ersatz
werden auf der eigenen Seite serialisiert.

Benachrichtigungen zeigt Typen und IDs wiederverwendeter Kanäle. Referenz trennen
entfernt nur die Verknüpfung dieses Monitors; Kontostandards und direkte Kanäle
gelten weiter. Der ursprüngliche Kanal wird weder geändert noch gelöscht.
Unterstützte Kanäle sind E-Mail, Webhook, Slack, Discord und Telegram.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)

## Navigation und Monitoraktionen

Ab 1024 px bleibt die Seitenleiste sichtbar und Monitore erscheinen als Tabelle. Darunter verwenden Sie das Navigationsmenü und Monitorkarten. Kompakte Dichte und Gruppierung bleiben im Filterbereich des Dashboards auf kleineren Bildschirmen verfügbar; die kompakte Dichte wirkt auf Tabellenzeilen. Auf schmalen Detailseiten erreichen Sie die übrigen Tabs über Weitere Aktionen neben den sichtbaren Tabs.

Pausieren unterbricht geplante Prüfungen und Alarme, Fortsetzen setzt die Überwachung fort. Pausiert beschreibt die Überwachungsaktivität getrennt vom zuletzt gemessenen Zustand. Heartbeats können während einer Pause weiterhin empfangene Ergebnisse erfassen; Fortsetzen startet ein neues Fristfenster.
