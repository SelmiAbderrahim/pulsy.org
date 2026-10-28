# Linux-Server

Überwachen Sie Host-Ressourcen und Agent-Verbindung gemeinsam mit Ihren Websites.

## Installation

Wählen Sie **Server hinzufügen** und sichern Sie den einmalig angezeigten Schlüssel. Serverüberwachung steht jedem Konto zur Verfügung. Das Meldeintervall beträgt standardmäßig 60 Sekunden; zulässig sind ganze Sekunden von 60 bis 3.600.

Führen Sie den angezeigten Befehl auf dem Linux-Host mit amd64 oder arm64 aus. Der Installer lädt versionierte Dateien von Ihrer Pulsy-HTTPS-Adresse und prüft deren Prüfsummen, konfiguriert und startet dann den Agenten. Direkt nach dem Erstellen oder Rotieren des Schlüssels kopiert, enthält der Befehl ihn und braucht keine Eingabe; er landet im Shell-Verlauf des Hosts, behandeln Sie ihn wie ein Passwort. Später wird der Schlüssel nicht mehr angezeigt und der Installer fragt ihn verdeckt ab. Niemals in URLs oder Tickets. Ausgehendes HTTPS, ein vertrauenswürdiges Zertifikat und eine genaue Uhr sind erforderlich. Kein eingehender Agent-Port wird benötigt.

Die systemd-Installation benötigt root. Danach läuft der Dienst als eigener Benutzer `pulsy-agent`. Geschützte Konfiguration: `/etc/pulsy-agent/config.json`. Diagnose: `sudo systemctl status pulsy-agent` und `sudo journalctl -u pulsy-agent`. Eine Neuinstallation behält die vorhandene Konfiguration.

## Docker Compose

Verwenden Sie den Compose-Befehl. Er benötigt Docker mit dem Compose-Plugin, startet den Container selbst und bricht mit dessen Logs ab, wenn er nicht läuft. Dateien liegen unter `/opt/pulsy-agent`; nur root und der Containerbenutzer können die Konfiguration lesen. Schreibgeschützte Mounts von Host-`/proc` und `/` liefern Host-Metriken statt Containerlimits. Kein privilegierter Modus, keine Capabilities und kein Docker-Socket sind erforderlich. Der Administrator muss die Mounts erlauben. Unzugängliche Messungen bleiben nicht verfügbar. Der Zertifikatsspeicher des Hosts wird schreibgeschützt eingebunden.

## Metriken und Alarme

CPU wird aus Linux-Zählerdifferenzen berechnet. Der erste Messwert, Neustarts und Zählerrücksetzungen liefern zunächst keinen CPU-Wert. RAM basiert auf `MemAvailable`. Ohne Swap bleibt dessen Wert nicht verfügbar. Dateisysteme verwenden den für unprivilegierte Benutzer verfügbaren Speicher; virtuelle und Container-Mounts werden ausgeschlossen. Pfadausschlüsse gelten auch für Unterpfade. Die Last umfasst 1, 5 und 15 Minuten, die Laufzeit beginnt beim Host-Start.

Standardschwellen: jeweils 90 % für CPU, RAM und Dateisysteme. Drei aufeinanderfolgende Überschreitungen aktivieren eine Bedingung, zwei Berichte darunter lösen sie auf. Bedingungen werden unabhängig ausgewertet. Ressourcendruck bedeutet beeinträchtigt. Drei Intervalle ohne akzeptierten Bericht bedeuten Ausfall. Zwei Berichte bestätigen die Rückkehr; andere aktive Bedingungen können bestehen bleiben. Fristen werden alle fünf Sekunden geprüft. Benachrichtigungen beachten Kanäle, Wartung und Zustellversuche. Pausierte Monitore alarmieren nicht; beim Fortsetzen beginnt ein neues Verbindungsfenster.

Neue Monitore warten bis zum ersten Bericht. Nach drei Intervallen erscheinen Diagnosehinweise. RAM-Alarme bestätigen keine OOM-Kills. Fehlende Werte lösen aktive Alarme nicht auf; verschwundene Mounts müssen wiederhergestellt oder ausdrücklich ausgeschlossen werden.

## Verlauf und Datenschutz

Die Empfangszeit bestimmt die Verbindung. Doppelte oder ältere Messungen verlängern sie nicht. Die Aufbewahrung folgt der Betreibereinstellung `CHECK_LOG_RETENTION_DAYS`, standardmäßig 30 Tage. Das Diagramm zeigt höchstens 1.000 Berichte, die Tabelle die letzten 50 dargestellten Werte. Alte Daten werden stapelweise gelöscht. Monitorlöschung entfernt Metriken und Schlüssel. Öffentliche Statusseiten enthalten keine Host-Metadaten, Dateipfade oder privaten Messwerte.

## Rotation, Upgrade und Entfernen

Rotieren Sie den Schlüssel in den Einstellungen und starten Sie den heruntergeladenen Installer mit `--rotate` vor dem Ursprungsargument. Er fragt verdeckt nach dem neuen Schlüssel und startet systemd neu. Der alte Schlüssel wird sofort ungültig. Für Upgrades den Installer der gewünschten Version herunterladen und `--upgrade` verwenden. Neustart: `sudo systemctl restart pulsy-agent`. Entfernen: Installer mit `--uninstall`.

Bei Compose für Upgrade oder Rotation erneut `--compose` ausführen; der Container wird automatisch neu erstellt. Entfernen: `sudo docker compose -f /opt/pulsy-agent/compose.yaml down`, anschließend `/opt/pulsy-agent` löschen. Den Monitor separat in Pulsy löschen.

## Fehlerbehebung und Grenzen

Prüfen Sie Protokolle, ausgehendes DNS/HTTPS, Zertifikate, Schlüssel, Uhr und Berechtigungen. Warten Sie für CPU auf zwei Messungen. Verwenden Sie das von Pulsy zurückgegebene effektive Intervall. Version 1 erkennt keine OOM-Kills, überwacht keine Prozesse, führt keine Fernbefehle aus und unterstützt weder Windows noch macOS.

Aktivieren Sie im Kanal Benachrichtigungen zum beeinträchtigten Zustand für CPU-, RAM- und Dateisystemwarnungen sowie Ausfallmeldungen für fehlende Berichte.

## Ausgeschlossene Dateisysteme

Geben Sie in den Servereinstellungen einen absoluten Dateisystempfad pro Zeile ein, etwa `/var/lib/docker`. Jeder Eintrag beginnt mit `/`; kommagetrennte Listen und relative Pfade werden nicht unterstützt. Zulässig sind bis zu 32 Pfade mit jeweils höchstens 512 UTF-8-Bytes ohne Steuerzeichen. Ein Ausschluss umfasst auch untergeordnete Pfade.
