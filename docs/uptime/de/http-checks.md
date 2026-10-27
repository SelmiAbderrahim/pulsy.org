# Erweiterte HTTP-Prüfungen

## Schritte

Schnell hinzufügen behält GET als Standard. Erweitern Sie bei Neuer Monitor oder in den Einstellungen Erweiterte HTTP-Prüfungen für Regeln und private Anfragewerte. Alle aktiven Regeln müssen dieselbe Antwort bestehen; ein Regelsatz erzeugt keine zusätzlichen Prüfungen. Weiterleitungen können einschließlich der ersten Anfrage bis zu sechs Anfragen erzeugen.

## Verhalten

Regeln: Antworttext enthält/enthält nicht, Header gleich/enthält, JSON vorhanden/gleich/ungleich/kleiner/höchstens/größer/mindestens. JSON-Pfade beginnen mit `$`, dann ASCII-Schlüssel mit Punkten oder numerische Arrayindizes, etwa `$.status` und `$.jobs[0].depth`. Schlüssel in Anführungszeichen, Platzhalter, Skripte, Prototypschlüssel und Ausdrücke sind unzulässig. Erwartete JSON-Werte sind etwa `"ok"`, `0`, `false`, `null` oder ein flaches Array solcher Werte. Fehlend unterscheidet sich von null, false, der Zahl 0, leerem Text und leerem Array. Fehlende Felder scheitern an jedem Vergleich, auch ungleich. Zahlenvergleiche wandeln keine Zeichenketten um. Ungültiges JSON lässt aktive JSON-Regeln scheitern.

## Beispiel

HTTP 200 UND `$.status` gleich `"ok"` UND `$.queueDepth` kleiner `100` verlangt alle drei Bedingungen. HTTP 200 mit `{"status":"error"}` gilt bei aktiver Statusregel als ausgefallen. Erweiterte Einstellungen bewerten einen unzulässigen HTTP-Status als ausgefallen. Alte Monitore ohne erweiterte Einstellungen behalten das bestehende Verhalten, einschließlich eingeschränkt bei unerwarteten Antworten unter 400. Dauer misst diese Anfrage, keine Browserladezeit.

## Private Werte und Grenzen

Private Header, Basic/Bearer-Zugang und POST-Inhalt werden zusammen mit dem vorhandenen ENCRYPTION_KEY verschlüsselt. Der Editor kann sie nicht zurücklesen. Behalten lässt die Daten unverändert, Ersetzen verlangt neue Eingabe und entfernt ausgelassene Werte, Löschen entfernt alle Daten. Ein ausgelassenes API-requestConfig behält sie, null löscht sie, ein Objekt ersetzt sie. Keine Zugangsdaten in URLs oder Regelwerte eintragen. Neue oder bearbeitete URL-Zugangsdaten werden abgelehnt. Inhalte verlangen POST; der Wechsel zu einer anderen Methode verlangt bewusstes Löschen oder Ersetzen des gespeicherten Inhalts.

Headernamen sind ohne Beachtung der Großschreibung eindeutig. Transportheader wie Host, Content-Length, Connection oder Transfer-Encoding sind nicht überschreibbar. Grenzen: 20 Header, 16 KiB kodierte Headerkonfiguration, 4.096 Zeichen je Wert, 64 KiB UTF-8-Inhalt. Basic-Benutzernamen enthalten keinen Doppelpunkt. Anfragewerte fehlen in Statusseiten, Freigaben und REST-/Eigentümerprojektionen. Freigabelinks lassen erweiterte Einstellungen aus. Vorlagen und native Manifeste übertragen unterstützte Regeln und Latenzrichtlinien ohne private Anfragewerte.

Bei privaten Anfragewerten, Regeln oder abweichender Weiterleitungsrichtlinie prüft Folgen jedes Ziel nach der vorhandenen Netzwerkrichtlinie, endet nach fünf Sprüngen und entfernt konfigurierte Header und Zugang beim Ursprungwechsel. Ursprungwechsel mit Inhalt und 307/308 wird abgelehnt. 301/302 bei POST sowie 303 außer HEAD wechseln zu GET ohne Inhalt. Prüfen liefert die erste Antwort; Ablehnen lässt Weiterleitungen scheitern. Auch ältere HTTP-Prüfungen validieren jedes Weiterleitungsziel. HTTP(S)-Ziele lehnen unspezifizierte, Metadaten- und Link-Local-Adressen in allen Installationen ab. Private und interne Ziele (Loopback, RFC1918, CGNAT, Unique-Local, `localhost`, `*.internal`, einteilige Dienstnamen) sind mit `MONITOR_ALLOW_PRIVATE_NETWORKS=true` standardmäßig erlaubt. Mit `false` werden diese Ziele beim Speichern oder Importieren und erneut beim Verbindungsaufbau abgelehnt. HTTP-Verbindungen nutzen immer beim Verbindungsaufbau validierte DNS-Antworten.

Text-/JSON-Regeln lesen höchstens 512 KiB dekomprimierte Antwort. JSON: Tiefe 16, 10.000 Knoten. Reine Headerregeln lesen keinen Inhalt. HEAD-Inhaltsregeln gelten als ungelesen, nicht als beobachteter leerer Inhalt. Die Frist gilt bis zum Ende des Lesens. Zu groß und ungelesen sind getrennte Ergebnisse. Vollständige Inhalte und tatsächliche Regelantwortwerte werden nicht gespeichert; Protokolle speichern Regelindex, Erfolg und begrenzten Grundcode.

## Testen ohne Speichern

Konfiguration ohne Speichern testen führt eine bewusste einzelne Prüfung ohne Planung, Historie oder Änderung der Gesundheit aus. Sie verwendet denselben Prüfer und dieselbe effektive Konfiguration wie Speichern. POST kann Nebenwirkungen haben und verlangt Bestätigung. Speichern prüft nie automatisch.

Jedes Konto kann API-Schlüssel mit dem Geltungsbereich `read` zum Lesen und `full` zum Schreiben verwenden. Senden Sie den Kontoschlüssel mit `Authorization: Bearer`, niemals in einer URL.

Eine gescheiterte Regel erzeugt einen sicheren Grund wie Assertion 1: mismatch, öffnet nach der bestehenden Fehleranzahl einen gemessenen Vorfall und nutzt vorhandene Benachrichtigungen und Wartungsunterdrückung. Sie veröffentlicht keine Mitteilung und ändert keine Verfügbarkeitsdefinition. Beschädigte verschlüsselte Daten verlangen neue Eingabe mit dem konfigurierten Schlüssel. Den Schlüssel nie ohne Erhalt bestehender Geheimnisse ersetzen oder rotieren.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)

## Monitoradressen

Monitor erstellen, Schnell hinzufügen und Mehrere hinzufügen akzeptieren einen Hostnamen wie `example.com` und zeigen die normalisierte Adresse `https://example.com/`. Ein fehlender Name wird aus dem Hostnamen abgeleitet. Die Duplikaterkennung vergleicht kanonische Adressen mit Ihren bestehenden Monitoren und dem aktuellen Stapel, einschließlich Varianten mit abschließendem Schrägstrich, und nennt den vorhandenen Monitor. Abfrageparameter bleiben relevant. Neue Monitore verwenden standardmäßig drei aufeinanderfolgende Fehler; gespeicherte Schwellen bleiben unverändert.

## Akzeptierte Statuscodes und TLS

Der erwartete Status akzeptiert `200,204`, `2xx` und `200–299` sowie Kombinationen. Codes müssen zwischen 100 und 599 liegen; Bereiche müssen aufsteigend sein. Normale und erweiterte Prüfungen verwenden dieselbe Regel. Ein einzelner Code behält das bisherige Verhalten. Der Schalter zur TLS-Zertifikatsüberwachung in den Einstellungen deaktiviert Ablaufprüfungen und Warnungen und löscht das gespeicherte Zertifikatsergebnis. Die HTTPS-Transportprüfung bleibt aktiv. Vorlagen und Konfigurationsexporte behalten diese Einstellungen.

Geteilte Konfigurationen behalten auch die Regeln für akzeptierte Statuscodes und die TLS-Überwachungseinstellung bei, ohne Zertifikatsmessungen oder Zugangsdaten. Beim Klonen werden kanonische URLs mit vorhandenen Monitoren und der ausgewählten Gruppe verglichen, auch bei eigenen Freigaben.

## Namen und Speichern

Beim Erstellen eines HTTP-Monitors ist der Name optional: Ohne Eingabe wird der Hostname der URL verwendet. DNS-, TCP-, Server- und Heartbeat-Monitore sowie gespeicherte Vorlagen benötigen einen Namen. Beim Bearbeiten bleibt Speichern deaktiviert, solange die Werte dem gespeicherten Stand entsprechen. Das Wiederherstellen der ursprünglichen Werte entfernt die Warnung vor ungespeicherten Änderungen. Ungültige Felder zeigen eine Meldung und eine Fehlerübersicht; beim Absenden erhält das erste ungültige Feld den Fokus. Fehlgeschlagenes Speichern erhält Ihren Entwurf.
