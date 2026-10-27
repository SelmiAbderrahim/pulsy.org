# Heartbeats mit Intervall

## Heartbeat einrichten

Wählen Sie **Monitor hinzufügen → Job-Heartbeat**. Geben Sie Name, erwartetes Intervall und Karenzzeit bis zur Ausfallmeldung ein. Das Intervall beträgt 30 Sekunden bis sieben Tage; die Karenzzeit null bis sieben Tage. Unterstützt werden Intervalle, keine Cron-Ausdrücke. Prüfen Sie nächste Fälligkeit, Karenzende und Zeitzone vor dem Speichern.

Übersicht und Einstellungen zeigen eine maskierte Ping-URL. Verwenden Sie Anzeigen oder URL kopieren bei Bedarf; neue und rotierte Tokens sind verschlüsselt gespeichert und nur für den angemeldeten Eigentümer abrufbar. Ältere, ausschließlich als Hash gespeicherte Tokens müssen Sie in den Einstellungen rotieren, bevor die URL kopiert werden kann. Die Rotation macht das alte Token sofort ungültig und erhält den Verlauf. Halten Sie diese geheimen URLs aus Logs, Screenshots und versionierten Dateien fern. Der mitgelieferte nginx-Proxy protokolliert Heartbeat-Pfade unabhängig von Groß-/Kleinschreibung auch bei Fehlern nicht; richten Sie denselben Ausschluss in externen Proxys ein.

## Ergebnis senden

Senden Sie nach Erfolg die folgende Anfrage mit Ihrer Serveradresse und Ihrem Token. Bei Fehlern verwenden Sie `/api/heartbeat/fail`. Für die Laufzeitmessung senden Sie vorher `/api/heartbeat/start` und danach `/api/heartbeat/success` oder `/api/heartbeat/fail`. Verwenden Sie für überlappende oder wiederholte Läufe dieselbe `runId` beim Start und Abschluss.

Die kopierte URL lautet `/api/heartbeat/{token}/success`. Senden Sie POST mit `Content-Type: application/json` und dem Inhalt `{}`, auch ohne weitere Daten. Ersetzen Sie `success` für andere Ereignisse durch `start` oder `fail`. Endpunkte mit dem Header `Authorization: Bearer` bleiben verfügbar; kombinieren Sie keine Token-URL mit einem Authentifizierungsheader.

```sh
curl -fsS -m 10 --retry 3 "$PULSY_SERVER/api/heartbeat/$PULSY_HEARTBEAT_TOKEN/success"
```

```sh
curl -fsS -m 10 --retry 3 -X POST "$PULSY_SERVER/api/heartbeat/success" \
  -H "Authorization: Bearer $PULSY_HEARTBEAT_TOKEN" \
  -H 'Content-Type: application/json' -d '{"runId":"nightly-42"}'
```

## Ergebnis verstehen

Neu bedeutet, dass noch kein Erfolg eingegangen ist; es bedeutet nicht gesund. Der erste Erfolg ist ein Intervall nach Erstellung fällig. Ein fehlender Erfolg wird bei Fälligkeit Verspätet und nach der Karenz Ausgefallen. Ohne Karenz gilt sofort Ausgefallen. Erfolg stellt den Zustand wieder her und beginnt ein neues Intervall; Fehler meldet sofort einen Ausfall. Ein Start verlängert weder die Frist noch stellt er die Gesundheit wieder her.

Verspätung eröffnet keinen Vorfall; erst der Ausfall tut dies. Bei verspäteter Prüfung bleibt der Ausfallbeginn die erwartete Fälligkeit plus Karenzzeit, nicht der spätere Prüfzeitpunkt. Zeitangaben verwenden die Kontozeitzone oder die in den Einstellungen gewählte Browserzeitzone.

Die Laufzeit misst die Zeit zwischen empfangenem Start und Abschluss, keine HTTP-Latenz. Ein einfacher Erfolg behält die vorherige Dauer oder lässt sie unbekannt. Die Erfolgsquote beschreibt gespeicherte Stichproben, keine lückenlose Verfügbarkeit. Wiederholte Meldungen desselben Zustands können einmal je Intervall erfasst werden.

## Private Werte und Grenzen

Senden Sie ein JSON-Objekt bis 10 KiB. Die optionale `runId` erlaubt bis zu 64 ASCII-Buchstaben, Ziffern, Unterstriche, Punkte, Doppelpunkte oder Bindestriche. Optionale Metadaten erlauben nur `environment` und `version`, jeweils bis zu 64 Buchstaben, Ziffern, Unterstrichen, Punkten oder Bindestrichen. Senden Sie keine Logs oder privaten Ausgaben. Wiederholte IDs wiederholen kein Ergebnis; ein benannter Abschluss benötigt einen vorhandenen Start. Nutzen Sie neue IDs für neue Jobs, da nur aktuelle IDs aufbewahrt werden.

Pausieren stoppt Prüfungen auf fehlende Signale und Benachrichtigungen; empfangene Ergebnisse können weiterhin den Zustand ändern. Wartung pausiert Alarme, nicht Messungen. Import und Export übertragen Einstellungen ohne Tokens oder Historie; HTTP-Vorlagen und Freigabelinks kopieren keine Heartbeats.

## Fehlerbehebung

Bei 404 prüfen Sie Pfad und aktuelles Token, bei 400 die JSON-Felder, bei 413 die Größe. Bei 409 senden Sie zuerst einen Start mit derselben ID. Beachten Sie bei 429 oder 503 `Retry-After`; pro Token sind bis zu 120 Anfragen je Minute möglich. Bleibt der Job verspätet oder ausgefallen, vergleichen Sie letzten Erfolg und Frist und prüfen Sie, ob Ihr Job den Erfolg gesendet hat.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)
