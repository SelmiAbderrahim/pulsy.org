# Zuverlässigkeitsziele und Ereigniskontext

## Schritte

Wählen Sie im Monitor-Verlauf 24 Stunden, 7 Tage, 30 Tage oder einen eigenen Zeitraum in Ortszeit innerhalb der Aufbewahrung. Aktualisieren erneuert gleitende Zeiträume. UTC-Tageszeilen zeigen Verfügbarkeit, beobachtete Abdeckung und Anfrage-, Auflösungs- oder Verbindungsdauer. Die Laufzeit eines Heartbeat-Auftrags ist keine Anfragelatenz.

## Zeitzonen

Zeitangaben für Monitore und Vorfälle folgen Einstellungen → Zeitzone des Kontos oder der gewählten Browserzeitzone. Verwenden Sie für eigene Zeiträume und Anmerkungszeiten die neben den Eingaben angegebene Zeitzone. SLA-Berichtszeiträume und Tagestrends bleiben ausdrücklich in UTC; eine andere Anzeigezeitzone verschiebt diese Berichtsgrenzen nicht.

## Verhalten

Zeitgewichtete Verfügbarkeit teilt die Up-Zeit durch die beobachtete Zeit. Down und Degraded verbrauchen Ausfallbudget. Dies ist von der Erfolgsquote der Prüfungen getrennt. Jede neue Beobachtung deckt höchstens ein konfiguriertes Intervall ab, maximal sieben Tage, und endet früher bei der nächsten Beobachtung. Ältere Verläufe ohne erfasste Beobachtung und Lücken nach diesem Horizont bleiben unbekannt. Ein nie empfangener Heartbeat bleibt unbekannt. Heartbeat-Fristen bestimmen weiterhin den tatsächlichen Zustand; aus einer veralteten Stichprobe wird keine durchgehende historische Gesundheit abgeleitet.

Abdeckung zeigt den beobachteten Anteil des Zeitraums. Unbekannte Zeit liefert kein Ausfallbudget. Ein vollständig beobachteter Zeitraum von 30 Tagen bei 99,9 % erlaubt genau 2.592 Sekunden (43 Minuten 12 Sekunden) Ausfall. Teilabdeckung reduziert die erlaubte Zeit auf geeignete beobachtete Zeit. Ohne beobachtete Zeit sind Prozentsatz und Budget unbekannt. Das verbleibende Budget wird nicht negativ; Überschreitungen werden separat erfasst.

## Ziele und Anmerkungen

Optionale Ziele ändern weder Prüfungen, Alarme und gemessenen Zustand noch bestehende SLA-PDFs oder Monatsberichte. Verfügbarkeitsbudgets verwenden das aktuelle Ziel als ausdrücklichen Vergleich. Latenzeinhaltung nutzt die mit jeder Beobachtung erfasste Richtlinie, zählt nur gültige Up-/Degraded-Beobachtungen und schließt genaue Gleichheit ein. Änderungen erzeugen eine Version; identische Einstellungen duplizieren sie nicht. Frühere Versionen bleiben innerhalb der Aufbewahrung sichtbar.

Wartungsbereinigung ist optional und bleibt getrennt von Rohwerten. Nur mit aktivierter Ausschlussrichtlinie erfasste Wartungsintervalle werden entfernt; Überschneidungen zählen einmal. Stumme Alarme entfernen niemals gemessene Zeit. Spätere Planänderungen schreiben erfasste Zeiträume nicht um. Ohne geeignete bereinigte Zeit bleiben der bereinigte Prozentsatz und das Budget unbekannt. Diese betriebliche Sicht definiert keinen SLA-Vertrag neu.

## Private Werte und Grenzen

Private Markierungen enthalten Zeitpunkt, Umgebung, Version, kurze Beschreibung und optional einen öffentlichen HTTP(S)-Link ohne Zugangsdaten, Abfrage oder Fragment. Sie gehören ausschließlich dem Eigentümer und erscheinen niemals auf öffentlichen Statusseiten. Bekannte Anfragegeheimnisse werden verborgen; geben Sie dennoch keine Geheimnisse ein. Markierungen zeigen einen Zusammenhang, keine bewiesene Ursache. Zeitpunkte müssen innerhalb des aufbewahrten Verlaufs bis zur Gegenwart liegen. Ältere Einträge werden stabil nach Zeitpunkt und ID paginiert.

Sichtbaren Zeitraum exportieren lädt genau den angezeigten betrieblichen Messstand herunter: Zeitraum, Berechnungszeit, Abdeckung und Richtlinie. Dies ist kein SLA-PDF, Monatsversand oder Wiederherstellungsbackup. SLA-PDFs und Monatsberichte stehen ebenfalls jedem Konto zur Verfügung.

Jedes Konto kann API-Schlüssel mit dem Geltungsbereich `read` zum Lesen und `full` zum Schreiben verwenden. Senden Sie den Kontoschlüssel mit `Authorization: Bearer`, niemals in einer URL.

## Beispiel

Lesen: GET /api/v1/monitors/ID/reliability?from=2026-10-09T00%3A00%3A00.000Z&to=2026-10-10T00%3A00%3A00.000Z

Einfügen: POST /api/v1/monitors/ID/annotations mit JSON {"at":"2026-10-10T00:00:00.000Z","environment":"staging","version":"v2","text":"Deployment beobachtet","link":null}. Erstellung liefert 201. GET auf denselben Markierungspfad mit from/to und optional limit/cursor bietet private Pagination. Niemals einen API-Schlüssel in eine URL setzen.

Öffentlicher Verlauf erfordert ausdrückliche Aktivierung durch den Eigentümer einer veröffentlichten Seite. Er zeigt sieben abgeschlossene UTC-Tage mit Rohverfügbarkeit, Abdeckung, separater Wartungsbereinigung und passenden Messdauern. Erst beim Öffnen lädt eine Anfrage alle ausgewählten Komponenten; einzelne Panels werden erst bei ihrer eigenen Öffnung eingebunden. Lücken bleiben unbekannt. Private Namen, URLs, Notizen, Ziele, Monitor-IDs und Geheimnisse werden nicht veröffentlicht. Die Anfragedauer ist keine Browser-Ladezeit. Diese optionale Veröffentlichung macht Verfügbarkeit und Leistungswerte sichtbar: Prüfen Sie diese Entscheidung vor der Aktivierung.

Der Vorfallkontext paginiert alle gemessenen Vorfälle, die den sichtbaren Zeitraum überschneiden. Dauern werden an beiden Grenzen abgeschnitten, einschließlich bereits offener und später behobener Vorfälle. Ursachen ordnen die neuesten 1.000 passenden Vorfälle nach summierter Dauer; oberhalb der Grenze erscheint ein Teilhinweis, während die Pagination vollständig bleibt. Gleichzeitige Vorfälle können sich überschneiden: Diese Summen berechnen keine Verfügbarkeit. Private Ursachen werden anhand der aktuellen Anfragekonfiguration verborgen. Allein der Zeitpunkt einer Markierung belegt keine Ursache.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)
