# DNS- und TCP-Monitoring

DNS- und TCP-Überwachung steht jedem Konto neben HTTP und Heartbeat zur Verfügung. Der Prüfverlauf folgt der Betreibereinstellung `CHECK_LOG_RETENTION_DAYS`.

## Schritte

Wählen Sie im Menü „Monitor hinzufügen“ den Eintrag „DNS-/TCP-Monitor“ und geben Sie Name, Hostname, Intervall, Zeitlimit und aufeinanderfolgende Fehler bis zum Ausfall ein. Die Erstellung ist ausdrücklich; aktive Monitore starten geplante Prüfungen. Deaktivierung beendet automatische Prüfungen, macht einen Dienst aber nicht gesund. Wartung und Stummschaltung unterdrücken Meldungen bei weiterlaufenden Prüfungen und Messhistorie. Bestätigung, Notizen und öffentliche Kommunikation bleiben vom Zustand getrennt.

## Beispiel

DNS unterstützt A, AAAA, CNAME, MX und TXT über den vom Betreiber eingerichteten Systemresolver. ASCII-/Punycode-Namen haben maximal 253 Zeichen; Unterstrichpräfixe wie `_acme-challenge.example.invalid` bleiben erhalten. Geben Sie einen Namen ohne URL oder Port an. Wählen Sie vorhandene Einträge oder eine exakt erwartete Menge. Erwartungen werden als JSON-Array eingegeben:

- A: `["1.1.1.1"]`; AAAA: `["2001:4860:4860::8888"]`.
- CNAME: `["api.example.invalid"]`.
- MX: `[{"priority":10,"exchange":"mail.example.invalid"}]`.
- TXT: `["Case Sensitive", ""]`. Jede Zeichenfolge ist ein vollständiger Eintrag; Teile desselben Eintrags werden verbunden. Eine leere Zeichenfolge ist keine fehlende Antwort.

Reihenfolge und wiederholte Einträge ändern den Mengenvergleich nicht. Adressdarstellungen werden normalisiert; CNAME-/MX-Hostnamen ignorieren Großschreibung und einen abschließenden Punkt. MX-Priorität bleibt wesentlich. TXT-Inhalt, Leerzeichen und Großschreibung bleiben exakt. Geänderte oder entfernte Antworten verletzen die Erwartung; kein automatisches Lernen einer neuen Grundlage. Eine Änderung des Eintragstyps ersetzt die vorhandenen Erwartungen nicht: Korrigieren Sie das JSON vor dem Speichern.

Fehler unterscheiden fehlenden Namen, leere Antwort, vorübergehenden Auflösungsfehler, Zeitüberschreitung, abweichende Menge, verbotene Adresse und überschrittene Grenzen. Maximal 50 Antworten, 4 KiB je TXT und 64 KiB normalisierte Erwartungen/Antworten; höchstens 60.000 ms. Native Abfragen werden an der Frist abgebrochen. Der Resolver bleibt vertrauenswürdige Betreiberkonfiguration; Kunden wählen hier keine beliebigen DNS-Server. Rohantworten werden nicht als Beobachtungsdaten gespeichert.

## Verhalten

TCP baut eine native Verbindung zu Host und Port 1–65535 auf. Das Zeitlimit umfasst Namensauflösung und Aufbau, maximal 60.000 ms. Eine erfolgreiche Verbindung ist gesund; Ablehnung, Zeitüberschreitung, Auflösungsfehler oder verbotene Ziele zählen nach der Fehlerschwelle als Ausfall. Der Socket wird nach jedem Versuch geschlossen. Ein offener Port garantiert weder Anmeldung, Anwendungszustand noch TLS-Zertifikat. TCP-TLS-Prüfung wird nicht aktiviert.

Listen, Details, Historie, Vorfälle und Kanäle verwenden denselben Zustandsablauf. DNS misst die Abfragezeit; TCP umfasst Auflösung und Verbindungsaufbau. Werte sind Millisekunden, keine Browserladezeiten. Optionale Latenzregeln nutzen diese Zeiten mit bestehender Erholungshysterese. Unbekannte Daten bleiben neutral; die Messhistorie bleibt unverändert. Bestätigung oder Ankündigung erzeugen keine erfundene Erholung.

## Private Werte und Grenzen

Tags behalten Großschreibung und Elementgrenzen. Duplizierung und Vorlagen kopieren nicht geheime Netzwerkeinstellungen mit ausdrücklicher Erstellung, keine IDs, Historien, Vorfälle, Veröffentlichung oder Empfänger. Vorlagenänderungen betreffen zukünftige Erstellung. Das native Manifest Version 1 enthält typisierte DNS-/TCP-Konfiguration, begrenzte Erwartungen, Zeitregeln und eigene Kanalverweise. Vorschau schreibt nichts; Anwendung bleibt additiv, atomar und idempotent, ohne implizites Löschen oder Veröffentlichen. API-Schlüssel verwenden `read` zum Lesen und `full` zum Schreiben; beides steht jedem Konto zur Verfügung.

CNAME-Ziele behalten Unterstriche in ihren DNS-Namen. Die erwartete Null-MX-Menge lautet `[{"priority":0,"exchange":"."}]` und darf keine weiteren MX-Einträge enthalten. Sie besagt, dass die Domain absichtlich keine E-Mail annimmt, und belegt keinen erreichbaren SMTP-Dienst ([RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html)). Der leere Root-Name des nativen Resolvers wird mit diesem ausdrücklichen Punkt verglichen. Eine gemischte Null-MX-Antwort oder eine Priorität ungleich null schlägt fehl.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)
