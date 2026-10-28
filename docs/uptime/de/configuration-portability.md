# Importieren und exportieren

Öffnen Sie [Importieren und exportieren](/dashboard/import-export), um Einstellungen ausgewählter Monitore zu exportieren oder eine Konfiguration vor dem Import zu prüfen.

## Schritte

Öffnen Sie **Entwickeln → Import und Export** in der Navigation. Wählen Sie einzelne Monitore und Gewählte Konfiguration exportieren. JSON herunterladen ist nur nach Export oder erfolgreicher bereinigter Vorschau verfügbar. Datei laden oder Text ändern verwirft Vorschau und Downloadfreigabe. Grenzen: 200 Einträge, 256 KiB UTF-8-JSON, Tiefe 16 und 20.000 Werte. Übertragen werden Einstellungen, keine Prüfhistorie, Vorfälle, Veröffentlichungen, Abonnenten, Empfänger, API-Schlüssel oder Notfallsicherung. Die Oberfläche steht jedem Konto zur Verfügung.

## Dateiformat

Version 1 enthält `format: "pulsy-monitor-configuration"`, `version: 1` und `monitors`. Jeder Eintrag hat einen dauerhaften kontolokalen `key`, `type`, `name`, `interval` in Sekunden, `active` und `tags`. Schlüssel: ASCII-Buchstaben/Zahlen, Unterstrich, Punkt, Doppelpunkt und Bindestrich, Beginn mit Buchstabe/Zahl, höchstens 100 Zeichen. Tag-Großschreibung und vorhandene typabhängige Grenzen gelten weiter. HTTP verlangt zusätzlich `url`, `method`, `expectedStatus`, `timeout` in Millisekunden, `failureThreshold` und `redirectPolicy`. `httpAssertions` und `latencyPolicy` sind optional: Auslassen behält bestehende Werte, null deaktiviert die Latenzrichtlinie. Heartbeat verlangt `graceSeconds`. HTTP, DNS, TCP und Intervall-Heartbeats werden unterstützt. Cron-Zeitpläne und Drittanbieteradapter werden nicht unterstützt.

## Beispiel

```json
{
  "format": "pulsy-monitor-configuration",
  "version": 1,
  "monitors": [{
    "key": "api-production", "type": "http", "name": "API Produktion",
    "url": "https://example.invalid/health", "method": "GET",
    "expectedStatus": 200, "timeout": 10000, "interval": 300,
    "failureThreshold": 3, "redirectPolicy": "follow", "active": false,
    "tags": ["production"],
    "httpAssertions": [{ "type": "json", "path": "$.status", "op": "equals", "value": "ok" }]
  }]
}
```

## Schlüssel und Umbenennungen

Export verwendet den bestehenden externen Schlüssel oder `pulsy:<monitorId>` ohne Bindung. Erneutes Anwenden im selben Konto bindet den Schlüssel ohne Ersatz des Monitors. Ein neuer Schlüssel erstellt einen neuen Monitor. Zum bewussten Umbenennen `previousKey` mit altem eigenen Schlüssel ergänzen und neuen `key` wählen; die Vorschau zeigt die Bindungsänderung. Fremde Kontomonitore sind nicht auswählbar. Fehlender alter Schlüssel, zwei Einträge für denselben Monitor, widersprüchliche alte/neue Schlüssel oder Typwechsel eines gebundenen Monitors werden abgelehnt. Wiederholtes Umbenennen bleibt idempotent. Vor Übertragung an ein anderes Konto `previousKey` entfernen. Schlüssel unterscheiden Großschreibung. Keine Zugangsdaten in Namen, Tags, Schlüsseln oder Regeln.

## Private Werte und Grenzen

Private Anfragewerte fehlen und werden nie zurückgegeben. `needsReentry` nennt fehlende Kategorien request, url, assertions oder heartbeatToken. URLs mit Abfrage oder Fragment fehlen vorsorglich vollständig; ebenso URLs mit Zugangsdaten oder bekannten Geheimnissen. Importiertes url gleich null behält eine bestehende URL; neue Monitore verlangen eine sichere URL. Sensible Headerregeln und Regeln mit bekannten Anfragewerten fehlen. Ausgelassene bestehende Regeln bleiben erhalten. Importierte Anfrage-, Authentifizierungs-, Inhalt-, Token-, Empfänger- und Abonnentenfelder werden vor Prüfung entfernt; bekannte Wiederholungen in Namen, Tags, URLs und Regeln ebenfalls. Die Vorschau ersetzt den Editor durch bereinigtes JSON. Gefährliche Objektschlüssel, unbekannte Felder, doppelte Konfigurationsschlüssel und nicht unterstützte Versionen werden abgelehnt. Höchstens 500 importierte private Einzelwerte je Monitor. Dies kennzeichnet fehlende Felder, keine Verbindung zu einem Secretspeicher.

Kein Import ersetzt oder löscht gespeicherte Anfragegeheimnisse. Behaltener POST-Inhalt verhindert einen Wechsel zu GET/HEAD; zuerst in den Monitoreinstellungen bewusst löschen oder ersetzen. Neue HTTP-Monitore mit fehlenden Anfrage-/Regelwerten bleiben inaktiv. Heartbeat enthält weder Token noch URL: neue Jobs bleiben inaktiv bis bewusster Tokenerzeugung/Kopie und Aktivierung in Einstellungen. Bestehende Heartbeat-Aktivierung bleibt unabhängig vom active-Wert im Manifest erhalten; ihre vorhandenen Bedienelemente nutzen. Intervall/Toleranz können geändert werden ohne erfundene Empfangsmeldung, Erholung oder Gesundheit. Tokenhashes und Laufhistorie bleiben erhalten.

Optionale `channelIds` verweisen ausschließlich auf vorhandene eigene Alarmkanäle, ohne Empfänger, Anbieterzugang oder Zustellziele. Auslassen behält Bindungen; ein leeres Array entfernt ausdrücklich Referenzen ohne Kanallöschung. Auf anderer Installation Referenzen entfernen oder durch dort eigene IDs ersetzen. Fehlende, fremde, entfernte oder unzulässige Kanäle führen zur Ablehnung. Vorlagen, Ansichten, Wartungspläne, Anbieter und öffentliche Seitenmitgliedschaft sind nicht Teil dieses Manifests.

## Vorschau und Anwenden

Prüfen und Vorschau schreibt nichts und prüft kein Ziel. Sichtbar sind genaue Feldänderungen und Anzahlen für Erstellen/Ändern/Unverändert/Abgelehnt. Anwenden ist ausdrücklich und atomar: abgelehnter Eintrag, Speicherfehler oder veraltete Konfiguration verhindert alle Änderungen. Die Revision prüft Konfiguration und Referenzidentität, keine gewöhnlichen Gesundheitsänderungen. Parallele Erstellung wird wie bei normalen Monitoren und Heartbeats durch eine Transaktionssperre auf der Eigentümerzeile serialisiert, ohne Begrenzung der Monitoranzahl. IDs, Prüfungen, Vorfälle, öffentliche Mitgliedschaft und ausgelassene Geheimnisse bleiben. Kein Löschen, Bereinigen oder stiller Ersatz. Aktives HTTP beginnt geplante Anfragen; POST kann Nebenwirkungen haben. Wiederholte Vorschau zeigt unveränderte Einträge ohne neue Monitore. Bei ausschließlich unveränderten Einträgen gibt es nichts anzuwenden.

## API-Zugriff

Jedes Konto kann API-Schlüssel mit dem Geltungsbereich `read` zum Lesen und `full` zum Schreiben verwenden. Senden Sie den Kontoschlüssel mit `Authorization: Bearer`, niemals in einer URL. Programmatischer Export und Vorschau verwenden Lesezugriff; Anwenden verlangt `full`. Die Oberfläche ist in fünf Sprachen verfügbar. Die ersten beiden POST-Routen verwenden Lesezugriff:

```sh
curl -X POST "$PULSY_URL/api/v1/configuration/export" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data '{"monitorIds":["owned-monitor-id"]}'
curl -X POST "$PULSY_URL/api/v1/configuration/preview" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data-binary @preview-request.json
curl -X POST "$PULSY_URL/api/v1/configuration/apply" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data-binary @apply-request.json
```

preview-request.json enthält `{"text":"<JSON-escaped native manifest>"}`. apply-request.json enthält denselben Text und zurückgegebene Revision, etwa `{"text":"<same escaped JSON>","revision":"<64-character revision>"}`. Standard-JSON-Kodierung Ihres CI verwenden, unmaskierte Dateiinhalte nicht in Shellbefehle einsetzen. Vorschau prüfen, bevor der Anwenden-Schritt erlaubt wird. Veraltet: HTTP 409, ungültig/abgelehnt 422, Parsergrenze 413, fehlerhaftes JSON 400, unzulässige Kompression 415. Erfolg verwendet no-store. Keine neue CLI, kein Paket, Synchronisationsdienst oder Rechteumgehung.

Ein wiederholter Import lässt einen HTTP-Monitor inaktiv, solange erforderliche ausgelassene private Anfragewerte oder Prüfregeln fehlen. Tragen Sie diese zuerst in den Monitoreinstellungen ein, bevor Sie mit einem späteren Import die Aktivierung anfordern. Bereits konfigurierte private Werte bleiben erhalten.

Version1 umfasst auch DNS und TCP: `type` ist `dns` oder `tcp`; `configuration` enthält Hostname und typisierte Eintragserwartungen oder Hostname/Port, dazu Zeitlimit und Fehlerschwelle. Konfiguriertes Prüfintervall, Historie bleibt beim eigenen Schlüssel erhalten, keine Veröffentlichung oder TLS-Zusage.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)

JSON-Fehler erscheinen direkt unter dem Editor mit einer sicheren Erklärung und Zeilen-/Spaltenangabe. Beispielsweise ist `{"bad":` in Zeile 1, Spalte 8 unvollständig. Der Fokus wechselt zur Fehlermeldung, ohne die Eingabe zu löschen. Eingefügte Geheimnisse werden nie in Parsermeldungen wiedergegeben.


## Exportauswahl

Mit **Alle geeigneten Monitore auswählen** wählen Sie bis zu 200 HTTP-, DNS-, TCP- und Job-Heartbeat-Monitore. Linux-Server sind mit einer Erklärung vom Export ausgeschlossen, da ihre Agenten neue Zugangsdaten benötigen. Auch der Server lehnt solche Exportanfragen ab. Vorhandene Server-Manifeste bleiben importierbar und erzeugen inaktive Server mit ausstehender Einrichtung. **Beispiel herunterladen** liefert ein inaktives HTTP-Beispiel unabhängig vom Editor; **JSON herunterladen** speichert nur ein exportiertes oder geprüftes, bereinigtes Manifest.
