# Prometheus-Ausgabe

## Schritte

GET /api/v1/metrics liest ausschließlich gespeicherte Monitorzustände des
authentifizierten Kontos. Erstellen Sie unter [Entwickeln → API-Schlüssel](/dashboard/api-keys)
einen Schlüssel mit Geltungsbereich `read` oder `full`. Diese Schlüssel stehen
jedem Konto zur Verfügung. Ein Abruf startet keine Prüfungen,
DNS-Abfragen, Verbindungen oder Worker.

Ein Ablaufdatum für den API-Schlüssel muss nach dem heutigen UTC-Datum liegen. Der Schlüssel läuft am gewählten Tag um 23:59:59.999 UTC ab. Ohne Datum bleibt er bis zum Widerruf gültig.

## Scrape-Konfiguration

Beispiel mit Ihrer eigenen Domain:

```yaml
scrape_configs:
  - job_name: pulsy
    scheme: https
    metrics_path: /api/v1/metrics
    static_configs:
      - targets: ['pulsy.example.com']
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/pulsy-api-key
    scrape_interval: 60s
```

## Verhalten

Speichern Sie den Schlüssel in dieser Datei mit eingeschränktem Zugriff,
nicht in URLs, Repositorys oder Screenshots. Zum Wechsel einen neuen Schlüssel
erstellen, die Datei aktualisieren und den alten Schlüssel widerrufen.
Bestehende Ablauf- und Widerrufsregeln gelten weiterhin.

Alle sieben Metriken sind Gauges mit dem Präfix pulsy_monitor_:

## Beispielabfragen

- status: -1 unbekannt, 0 ausgefallen, 1 erreichbar, 2 eingeschränkt. Ohne
  gültige letzte Prüfung oder bei pending bleibt der Zustand unbekannt.
- fresh: 1 nur bei aktivem Monitor, bekanntem Zustand und einem Prüfungsalter
  von null bis zweimal Intervall plus Timeout, einschließlich beider Grenzen.
  Heartbeats benötigen außerdem einen gespeicherten Fristeintrag; eine
  vorhandene nächste Frist darf höchstens zehn Sekunden überschritten sein.
- active: 1 aktiviert, 0 pausiert.
- last_check_timestamp_seconds: letzte Prüfung in Unix-Sekunden, sonst NaN.
- duration_seconds: HTTP-Anfrage, DNS-Auflösung oder TCP-Verbindungsaufbau in
  Sekunden. Null Millisekunden bleiben null; fehlende Werte und Heartbeats NaN.
- open_incident: 1 bei offenem gemessenem Vorfall, sonst 0.
- tls_expiry_timestamp_seconds: zuletzt beobachteter TLS-Ablauf für HTTP in
  Unix-Sekunden; bei anderen Typen oder fehlender Beobachtung NaN.

Pausierte, veraltete oder zukünftige Beobachtungen haben fresh=0. Der gespeicherte
Zustand bleibt erhalten. Ein ausgefallener Heartbeat ohne nächste Frist bleibt
ausgefallen. Eine TCP-Verbindung beweist keine Anwendungsgesundheit. Jobdauer
ist keine Netzwerklatenz; der TLS-Wert löst keine neue Zertifikatsprüfung aus.

## Private Werte und Grenzen

Nur bekannte und aktuelle Zustände auswählen:

```promql
pulsy_monitor_status{job="pulsy"} >= 0
  and on (job, instance, monitor_id) pulsy_monitor_fresh{job="pulsy"} == 1
```

Labels enthalten ausschließlich monitor_id, keine Namen, URLs, Tags, Adressen,
Geheimnisse oder Antwortinhalte. Eine begrenzte Abfrage liest Monitore und offene
Vorfälle; Heartbeat-Fristen werden bei Bedarf gemeinsam gelesen. Keine Historie
wird durchsucht. Höchstens 1.000 Monitore pro Antwort, darüber 422. Größere
Installationen können mit monitorIds jeweils 1–200 kommagetrennte IDs auswählen.
Fremde und nicht vorhandene IDs ergeben keine Serien.

Das bestehende API-Limit gilt: standardmäßig 60 Anfragen pro Minute und Schlüssel,
429 mit Retry-After. Ungültiger Schlüssel: 401; fehlender Zugriff: 403;
ungültige Anfrage: 422. Antworten verwenden private, no-store, keinen öffentlichen
gemeinsamen Cache. Nach Neustart liest der Exporter erneut die dauerhaften
Daten.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)
