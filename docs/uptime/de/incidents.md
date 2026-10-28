# Persönliche Reaktion auf Vorfälle

## Schritte

Öffnen Sie Vorfälle im Dashboard. Suchen Sie Monitorname oder Ursache und filtern
Sie Ungelöst (Offen und Bestätigt), Offen (unbestätigt und weiterhin gemessen fehlerhaft), Bestätigt, Gelöst oder
Alle. Schweregrad ist die beim Start eines neuen Vorfalls gespeicherte Bedeutung.
Alte Einträge bleiben Unbekannt statt einer erfundenen historischen Einstufung.
Zeilen zeigen Besitzerkonto, Beginn, Dauer in Sekunden und letzte Aktualisierung.
Cursorseiten verwenden stabile Beginn-/ID-Reihenfolge. Filter, Seiten und Auswahl
stehen in der URL; Neuladen und Zurück/Vorwärts behalten Kontext. Monitor-/Gruppenlinks
filtern nur eigene Daten. Eine fremde ID gewährt keine Berechtigung.

## Einstellungen zur Zeitanzeige

Öffnen Sie unten in der Seitenleiste das Kontomenü und dann **Einstellungen**. Wählen Sie **Sprache** und **Zeitzone des Kontos**, dann **Speichern**. Die Sprache wird in diesem Browser gespeichert; eine ausdrücklich gewählte IANA-Zeitzone wird geräteübergreifend im Konto gespeichert. Mit **Zeitzone des Browsers verwenden** folgen Sie stattdessen dem jeweiligen Browser. Diese Einstellungen ändern die Zeitanzeige, nicht den Beginn eines Vorfalls oder die Berichtszeiträume.

## Verhalten

Bei einem ungelösten Vorfall können Sie die Bestätigung zurücknehmen und ihn wieder auf Offen setzen. Beide Aktionen ändern nur den Bearbeitungsstatus; die Lösung erfolgt weiterhin durch gemessene Erholung. Beide Aktionen werden in der privaten Zeitleiste erfasst.

Bestätigen speichert Ihre Reaktion mit Akteur und Zeit. Es pausiert keine Prüfung,
ändert keine Verfügbarkeit, schließt keinen gemessenen Vorfall und veröffentlicht
nichts. Nur echte Erholung schließt ihn. Private Notizen und Runbookbeschreibungen
sind Klartext bis 2.000 Zeichen. Bekannte Anfrage-/Auth-/Header-/Bodywerte werden
vor Speicherung maskiert; fügen Sie keine Geheimnisse ein. Runbooklinks erlauben
HTTP(S) ohne Zugangsdaten, Abfrageparameter oder Fragmente. Fehlender/leerer Link
beim Speichern entfernt den bisherigen ausdrücklich. Links öffnen einen separaten
Browserkontext. Notizen und Runbooks bleiben privat, keine Kundenmitteilungen.

## Beispiel

Wählen Sie genaue Vorfälle auf der aktuellen Cursorseite für eine Reaktionsgruppe.
Sie organisiert Ihre Antwort ohne gemessene Vorfälle zu vereinen oder eine
gemeinsame Ursache zu vermuten. Filter-/Seitenwechsel löscht Auswahl. Alle IDs
werden serverseitig in einer Transaktion geprüft; fremde oder fehlende IDs
verwerfen den ganzen Vorgang. Bis zu 100 Vorfälle pro Auswahl und derzeit
200 Gruppen pro Konto sind technische Grenzen.

Die Zeitleiste enthält Bestätigung, Notizen, Runbookänderung und Gruppierung.
Neue Prüfungsübergänge und Alarmresultate werden getrennt von Rohprüfungen
gespeichert; Rohdatenbereinigung löscht diese Reaktionsspur nicht. Historische
Übergänge/Resultate werden angezeigt, solange ihre Quelldaten erhalten sind.
Antwortkörper, Empfänger, Anbieterfehler, Geheimnisse und private Anfragekonfiguration
werden nicht ausgegeben. Das Panel zeigt die letzten 100 Ereignisse und kennzeichnet
Kürzung. Bis zu 1.000 private menschliche Aktionen pro Vorfall. Ereignisse folgen
Vorfallsaufbewahrung/-löschung, kein unabhängiges dauerhaftes Auditarchiv.

Dieser Ablauf ist auf das Eigentümerkonto beschränkt. Das aktuelle Berechtigungsmodell unterstützt weder die Zuweisung an Teammitglieder noch gemeinsame Vorfallbearbeiter.

## Verzögerte Eskalation

Optionale verzögerte Eskalation nutzt einen unveränderlichen Plan je gemessenem
Vorfall mit einem primären und optional einem anderen zweiten eigenen Kanal.
Absolute Verzögerungen laufen ab Vorfallsbeginn, 60–86.400 Sekunden; verstrichene
werden im nächsten Scan fällig. Der zweite wartet, bis der erste Versuch beendet
ist, und kann danach senden, solange der Vorfall ungelöst/unbestätigt ist.
Zieländerungen am Kanal wirken auf spätere Versuche; genaue Zielbelege verhindern
Wiederholung/Erholung an neu geänderte Ziele. Brechen Sie ausdrücklich ab, um
verbleibende Erinnerungen zu stoppen. Bestätigung stoppt nur Erinnerungen dieses
Vorfalls, keine gewöhnlichen Übergänge, fremden Erinnerungen oder echte Erholung.
Pause, informative Bedeutung oder Erholung stoppen Erinnerungen. Wartung verschiebt
sie ohne Änderung der Messdaten.

## Wiederherstellungsmeldungen

Erholung erreicht auch unveränderte dafür aktivierte Ziele, die wirklich eine
Eskalation erhielten, selbst bei nicht zugestelltem Erstalarm. Ungelieferte Ziele
bekommen keine erfundene Erholung. Bestehende gewöhnliche Erholungspolitik bleibt.
Kundenmitteilungen/Abonnements sind getrennt von privaten Aktionen. API-Zugriff, SLA-Berichte und Monatsberichte stehen jedem Konto zur Verfügung.

## Fehlerbehebung

Prüfen Sie zuerst Monitor, Zeitraum und gespeicherte Einstellungen. Fehlende Beobachtungen bedeuten keinen gesunden Zustand. Behalten Sie bei Fehlern den Entwurf, korrigieren Sie das angegebene Feld oder die Voraussetzung und versuchen Sie es erneut. Veraltete Vorschauen vor dem Anwenden neu erstellen und prüfen.

## Verwandte Themen

- [Persönliche gespeicherte Ansichten und Gruppen](/dashboard/help/saved-views)
- [Erweiterte HTTP-Prüfungen](/dashboard/help/http-checks)
- [Zuverlässigkeitsziele und Ereigniskontext](/dashboard/help/reliability)
- [Mitteilungen auf der öffentlichen Statusseite](/dashboard/help/status-communication)

Wählen Sie mindestens zwei Vorfälle für eine Reaktionsgruppe. Die Auswahlaktionen bleiben unter der Liste, ohne Zeilen zu verschieben. Das Panel hat eine feste Schließen-Schaltfläche und einen scrollbaren Inhalt; Esc schließt es und setzt den Fokus auf die gewählte Zeile zurück.
