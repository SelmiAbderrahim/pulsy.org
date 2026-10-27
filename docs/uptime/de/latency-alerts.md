# Latenzverschlechterung und ruhige Erholung

## Schritte

Öffnen Sie beim Erstellen oder in den Einstellungen Latenz und Alarmrichtlinie und aktivieren Sie die Richtlinie. Sie steht jedem Konto zur Verfügung. Schnell hinzufügen und Monitore ohne Richtlinie behalten ihr Verhalten. Deaktivieren mit null stellt das alte Verhalten wieder her. Bearbeiten oder Massenersetzung mit einer anderen Richtlinie setzt Serien zurück; gleiche Richtlinien und andere Änderungen behalten sie. Prüfungen, Vorfälle und Zustellbelege bleiben erhalten.

## Verhalten

Latenzgrenzen sind optional. Aktivieren Sie langsame Antworten, um Obergrenze und aufeinanderfolgende Anzahl festzulegen. Die Dauer misst diese HTTP-Anfrage in Millisekunden einschließlich des Lesens für Regeln, keine Browserladezeit. Alle Regeln müssen dieselbe Antwort bestehen, bevor Latenz zählt. Unerreichbarkeit, unzulässiger Status und gescheiterte Regeln gelten nach bestehender Fehleranzahl als ausgefallen. Mit Richtlinie ist auch eine unerwartete Antwort unter 400 ein Fehler; alte Monitore behalten hierfür eingeschränkt.

Eine gültige Antwort strikt über der Obergrenze ist langsam. Die konfigurierte Folge langsamer Prüfungen ändert verfügbar zu eingeschränkt. Gleichheit ist nicht langsam. Eine gültige Antwort kleiner oder gleich der Erholungsgrenze erhöht die Erholungsserie; Gleichheit zählt, null Millisekunden sind zulässig. Die Erholungsgrenze darf die Obergrenze nicht übersteigen. Zwischenwerte setzen Erholungsfortschritt zurück und halten ausgefallen/eingeschränkt. Ausgefallen hat Vorrang und bleibt bis zur vollständigen gültigen Erholungsserie bestehen, selbst bei gültigen langsamen Antworten. Ohne Latenzgrenzen zählt jede gültige Antwort zur Erholung. Anzahlen 1–10, Grenzen höchstens 60.000ms, Alarmabstand höchstens 3.600 Sekunden.

Der Monitor zeigt gehaltenen Zustand und Fortschritt, Prüfhistorie behält rohe verfügbar/ausgefallen/eingeschränkt-Proben. Ein gemessener Vorfall bleibt bei dauerhaft langsam → ausgefallen offen; gezählte Erholung löst genau ihn. Langsame Ursachen speichern Dauer und damalige Grenze. Der Antwortzeitgraph zeigt die aktuelle Grenze; fehlende Werte bleiben Lücken. Richtlinienänderungen benennen alte Prüfungen nicht um.

Kritisch und Warnung verwenden gewählte oder Standardkanäle. Informativ speichert Fehler und Vorfälle ohne operative Alarme; Fehler zählen weiterhin in roher Verfügbarkeit. Kanäle haben die ausdrückliche Option Bei Verschlechterung benachrichtigen, für alte und neue Kanäle zunächst aus. Bestehende Ausfall- und Erholungsauswahl bleiben erhalten, TLS-Ablauf hat seine eigene Richtlinie.

Konfigurierte Übergänge verwenden die dauerhafte Warteschlange. Ein neuer Ausfallalarm wartet bis zum Abstand seit der letzten tatsächlichen Zustellung; Wartung und Unterbrechung können weiter verzögern. Erholung umgeht den Abstand und erreicht nur genaue Ziele mit erfolgreichem gespeichertem Beleg der aktuellen Episode, einschließlich zugestellter Verschlechterung bei später verzögertem oder deaktiviertem Ausfallalarm. Eskalation bewahrt die Identität. Richtlinie deaktivieren behält passende Belege und dauerhafte Erholung für bestehende konfigurierte Episoden. Eine neue alte Verschlechterung nutzt keine Belege einer erholten Episode.

## Beispiel

Aktivierung während eines früheren gewöhnlichen Ausfalls kann alte Zielbelege nicht rekonstruieren; ohne Herkunft kann Erholung zurückgehalten werden. Vor dem Ausfall aktivieren für vollständige Zuordnung. Erholung vor jedem Beleg erzeugt keine Erholungsmeldung. Geänderte Gesundheit, Episode oder informative Richtlinie storniert ungesendete Aufgaben. Bereits laufende Ziele können noch die ursprüngliche Nachricht erhalten. Erfolgreiche Ziele werden nicht wiederholt; fehlgeschlagene erhalten höchstens vier Versuche mit begrenzten Abständen, 15-Sekunden-Abfrage und fünfminütiger Sperre. Höchstens vier parallele Transporte je Verteilung. Anbieterannahme mit Absturz vor Belegspeicherung bleibt unklar; keine universelle Genau-einmal-Garantie. Fehler und Unterdrückung stehen in Kanal- und Wartungszustellhistorie.

Konfiguration testen ist eine bewusste einzelne Probe: rohe Regel-/Latenzgültigkeit statt gehaltener Zustand mehrerer Proben. Keine Serien, Historie, Vorfälle oder Benachrichtigungen werden verändert. POST verlangt wegen Nebenwirkungen Bestätigung; Speichern testet nie automatisch.

Die Oberfläche unterstützt Englisch, Arabisch, Französisch, Deutsch und Spanisch. REST-Lesen liefert die nicht geheime Richtlinie und ihre Zähler. Jedes Konto kann API-Schlüssel mit dem Geltungsbereich `read` zum Lesen und `full` zum Schreiben verwenden. Senden Sie den Kontoschlüssel mit `Authorization: Bearer`, niemals in einer URL.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)
