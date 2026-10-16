<!-- id: overview -->

## Überblick

RTFM-EV ist eine Weboberfläche für MeshCore-Mesh-Funkgeräte. Ein kleiner Server verbindet sich mit deinem Companion-Funkgerät (über Serial, TCP oder BLE), und du bedienst ihn aus jedem Browser in deinem Netzwerk. Es ist ein Fork von RemoteTerm: Alles, was RemoteTerm als Live-Terminal für ein Funkgerät kann, bleibt erhalten, und dazu kommt ein längeres Gedächtnis. Die Serverdatenbank ist die maßgebliche Datenquelle, sodass ein dauerhaft verbundenes Funkgerät eine lokale Geschichte des Mesh aufbaut, die du durchsuchen und auswerten kannst.

Was du damit tun kannst:

- Direktnachrichten und Kanalnachrichten senden und empfangen, mit Reaktionen, Antworten, Emoji und Standortfreigabe.
- Mehr Kontakte und Kanäle verwalten, als das Funkgerät speichern kann. Pakete werden auf dem Server entschlüsselt, daher gelten die Grenzen des Funkgeräts nicht für das, was du beobachten kannst.
- Repeater und Room-Server über ein Dashboard verwalten.
- Das Mesh mit einer Karte, einer Paketvisualisierung, Zustands- und Trendansichten und einem durchsuchbaren Paketverlauf erkunden.
- Daten an MQTT, Home Assistant, Webhooks und mehr weiterleiten.

Zwei Dinge vorab:

- **Die App verwaltet dein Funkgerät.** Sobald ein Funkgerät verbunden ist, werden seine Kontakte und Kanäle in die App übernommen, und die App entscheidet, welche Kontakte auf dem Funkgerät geladen bleiben. Deshalb passt sie schlecht, wenn du oft Funkgeräte wechselst und jedes seinen eigenen Zustand behalten soll. Nur der Verlauf von Akku, Grundrauschen und Sendezeit wird pro Funkgerät gespeichert (siehe Funkgerät wechseln).
- **Nutze die App nur in einem vertrauenswürdigen Netzwerk.** Es gibt keine Benutzerkonten. Wer die Seite erreicht, kann sie benutzen. Die optionale HTTP-Basic-Authentifizierung ist nur eine grobe Hürde und gehört immer zusammen mit HTTPS.

<!-- id: getting-started -->

## Erste Schritte

### Funkgerät verbinden

Der Server verbindet sich mit genau einem Funkgerät über genau eine Verbindungsart. Die wählst du beim Start des Servers mit Umgebungsvariablen:

- **Seriell (USB):** `MESHCORE_SERIAL_PORT`. `MESHCORE_SERIAL_BAUDRATE` ist standardmäßig 115200.
- **TCP:** `MESHCORE_TCP_HOST` und `MESHCORE_TCP_PORT` (Standard 5000).
- **BLE:** `MESHCORE_BLE_ADDRESS` und `MESHCORE_BLE_PIN` (die PIN ist bei BLE Pflicht).

Setzt du keine davon, sucht der Server selbst an den seriellen Schnittstellen nach einem Funkgerät. Setzt du mehr als eine Verbindungsart, startet der Server nicht.

Öffne die App unter `http://localhost:8000` (oder Adresse und Port, unter denen der Server läuft). Die obere Leiste zeigt, ob das Funkgerät verbunden ist.

Hinweise:

- Wenn du unter Windows eine MQTT-Integration nutzt, starte den Server mit `--loop none`, sonst schlagen MQTT-Verbindungen fehl.
- Web Push und der Kanalfinder brauchen HTTPS, wenn du nicht auf `localhost` arbeitest.
- Docker wird unterstützt, empfohlen ist aber der native Betrieb, weil in Containern Probleme mit seriellen Verbindungen gemeldet wurden.

### Beim ersten Start

Bei der ersten Verbindung übernimmt die App die Kontakte und Kanäle des Funkgeräts und beginnt, jedes empfangene Paket zu speichern. Nachrichten kommen sofort an. Kontakte erscheinen, sobald ihre Adverts empfangen werden, gib ihr in einem belebten Mesh also ein paar Minuten.

Gute erste Schritte:

1. Öffne **Einstellungen > Radio** und prüfe Name, Funkparameter und Standort.
2. Füge die Kanäle hinzu, die du nutzt (siehe Nachrichten).
3. Öffne **Knotenkarte** und **Mesh-Zustand**, sobald etwas Verkehr empfangen wurde.

### Funkgerät wechseln

Die App merkt sich jedes Funkgerät, das mit ihr verbunden war. Der Verlauf von Akku, Grundrauschen und Sendezeit wird pro Funkgerät gespeichert, damit zwei Funkgeräte nie in einem Diagramm vermischt werden. Kontakte, Kanäle, Pakete und Nachrichten teilen sich alle Funkgeräte.

Verbindet sich ein Funkgerät, das diese Installation noch nicht kennt, fragt ein Dialog **Ein anderes Funkgerät ist verbunden**. Wähle **Das ist ein neues Funkgerät**, oder **Es ersetzt ein früheres Funkgerät** und wähle das alte unter **Ersetzt**. Ein Ersatz kann den **Verlauf von Akku, Grundrauschen und Sendezeit**, die **Eigene Knoten** und die **Notiz** des früheren Funkgeräts übernehmen. Nichts wird verschoben oder gelöscht, und du kannst es später unter Einstellungen > Radio > Funkgeräte ändern oder rückgängig machen. **Später entscheiden** blendet den Dialog für diese Browsersitzung aus. Das Funkgerät funktioniert weiter, während du entscheidest.

Verlauf aus der Zeit vor der Funkgeräte-Erfassung wird automatisch dem verbundenen Funkgerät zugeordnet, wenn die App erkennt, dass er zu ihm gehört. Sonst fragt sie einmal, **Wem gehört dieser Verlauf?**: **Ja, er gehört zu diesem Funkgerät**, oder **Nein, getrennt halten**. Getrennter Verlauf bleibt auf Mein Knoten als **Vor der Funkgeräte-Erfassung** verfügbar.

### Mehrere Funkgeräte gleichzeitig

Läuft der Server im Multi-Radio-Modus, hat jedes Funkgerät einen eigenen Arbeitsbereich mit eigenen Kontakten, Nachrichten, Paketen und Einstellungen. Die Kanalliste ist gemeinsam: Ein Kanal, den du in einem Arbeitsbereich hinzufügst oder entfernst, wird in allen hinzugefügt oder entfernt. Der Name des Funkgeräts in der oberen Leiste öffnet eine Liste der anderen Funkgeräte; wähle eines aus, um zu wechseln. **Funkgeräte verwalten** öffnet die Seite, auf der du Funkgeräte hinzufügst, bearbeitest, startest, stoppst und entfernst und ihr Protokoll liest. Ein Funkgerät bekommt seinen Arbeitsbereich, sobald es einmal verbunden war. Eine Zahl neben dem Namen des Funkgeräts zeigt, wie viele ungelesene Nachrichten auf den anderen Funkgeräten warten; sie ist hervorgehoben, wenn eine Direktnachricht oder eine Erwähnung darunter ist. Der Ton für Erwähnungen und Direktnachrichten erklingt auch für ein anderes Funkgerät, wenn der Ton in dessen Einstellungen eingeschaltet ist. Design, Sprache und Kartendarstellung gelten für alle Funkgeräte. Dieser Modus ist aus, solange der Betreiber des Servers ihn nicht einschaltet.

### Sprache und Design

Die Oberfläche gibt es auf Englisch, Niederländisch und Deutsch. Die Sprache wechselst du über das Sprachmenü in der oberen Leiste (Flagge und Sprachkürzel) oder unter **Einstellungen > Lokale Konfiguration**. Die Wahl wird pro Browser gespeichert. Das Sonnen- oder Mondsymbol in der oberen Leiste öffnet die Designauswahl.

Zum Design **Windows 95** gehört ein **Desktop-Assistent**: Clippy erscheint, sobald du dieses Design wählst, bis du unter **Einstellungen > Lokale Konfiguration** (unter der Designauswahl) oder im Designfenster über das Sonnen- oder Mondsymbol einen anderen Assistenten (Merlin, Bonzi, F1, Genie, Genius, Links, Peedy, Rocky, Rover oder einen von 26 weiteren, etwa Mother Nature, Courtney, Earl oder Santa) oder **Aus** wählst. Sobald du Windows 95 einmal benutzt hast, gibt es dieselbe Einstellung in jedem Design; andere Designs starten mit **Aus**, und ein dort gewählter Assistent erscheint in allen Designs. Der Assistent bleibt beim Navigieren sichtbar und informiert dich über neue Knoten, schwache Akkus (dein Funkgerät und Knoten mit Telemetrie aus den letzten 24 Stunden, unter dem eingestellten Schwellenwert; Knoten mit Netzstrom werden übersprungen), Direktnachrichten und @Erwähnungen, eine getrennte Funkverbindung und verfügbare Updates. Er meldet auch, wenn eine Direktnachricht von dir nicht bestätigt wurde (nur wenn dieser Chat nicht sichtbar ist), wenn eine Integration unter **MQTT & Automatisierung** eine Minute lang getrennt ist, und wenn ein per SNMP abgefragter Knoten nicht mehr antwortet. Beim ersten Öffnen einer Seite gibt er außerdem einen kurzen Tipp. Bevor er spricht, spielt er eine passende Animation ab (eine Warnung bei getrennter Funkverbindung, ein Jubel bei einem neuen Knoten), und wenn das, worum es geht, auf dem Bildschirm ist (die Zeile des Absenders in der Seitenleiste, der Funkstatus, die Akkuanzeige oder die Schaltfläche Einstellungen), zeigt er beim Sprechen darauf. Nicht jeder Assistent hat dieselben Animationen; einer ohne passende Animation spricht einfach. Klick auf die Sprechblase, um zu öffnen, worum es geht. Zieh den Assistenten, um ihn zu verschieben (die Stelle wird pro Browser gespeichert), doppelklick für einen Trick und rechtsklick, um ihn bis zum Neuladen der Seite wegzuschicken. Ein einfacher Klick auf den Assistenten öffnet ein kleines Menü: **Was habe ich verpasst?** zeigt die letzten 20 Zeilen, die er gesagt oder in einer stillen Phase zurückgehalten hat (klick auf eine Zeile, um zu öffnen, worum es ging), **Hilfe zu dieser Seite** öffnet dieses Handbuch beim Abschnitt zur aktuellen Seite, und der Rest schaltet ihn stumm, öffnet die Einstellungen zur Wahl eines anderen Assistenten oder blendet ihn bis zum Neuladen aus. Die Zusammenfassung nach einer stillen Phase öffnet dieselbe Liste, wenn du darauf klickst. Escape oder ein Klick an anderer Stelle schließt das Menü. Unter **Einstellungen > Lokale Konfiguration** kannst du außerdem Arten von Meldungen unter **Informiere mich über** abschalten (Direktnachrichten und Erwähnungen, neue Knoten, Funkverbindung, schwache Akkus, Integrationen und SNMP, Updates, Seitentipps), den Assistenten für 15 Minuten, 1 Stunde oder bis zum Neuladen **Stummschalten** und tägliche **Ruhezeiten** festlegen. Solange er still ist, kommt nichts durch; danach fasst er in einer Zeile zusammen, was er zurückgehalten hat (Seitentipps werden nicht aufgehoben, sie kommen bei einem späteren Besuch wieder). Eine Akkuwarnung wird nach dem Neuladen nicht wiederholt. Mit einem CRT-Design nimmt der Assistent die Phosphorfarbe an und folgt den CRT-Bildschirmeffekten (Scanlinien, Phosphorglühen, Bildschirmkrümmung und Flackern). Die Bilder eines Assistenten werden erst heruntergeladen, wenn du ihn wählst, und er spielt keine Töne ab.

### Geführte Tour

Neu in der App? Öffne das **Benutzerhandbuch** und klicke auf **Geführte Tour starten**. Ein Assistent zeigt dir dann in 12 Schritten die wichtigsten Teile: Er stellt sich neben den Teil, über den er spricht, und zeigt darauf, ein Rahmen markiert diesen Teil, und in einem kleinen Fenster neben dem Assistenten steht der Text mit **Zurück** und **Weiter**. Jeder Schritt öffnet die Seite, um die es geht. Die Tour navigiert nur: Sie schreibt oder sendet nie etwas.

- **Pausieren** hält die Tour an und merkt sich den Schritt. Mit **Tour fortsetzen** im Benutzerhandbuch oder im Menü, das sich beim Klick auf deinen Assistenten öffnet, geht es dort weiter. **Beenden** stoppt die Tour; du kannst sie jederzeit neu starten.
- Nichts wird blockiert. Du kannst die App weiter benutzen, während die Tour läuft, und den Assistenten zur Seite ziehen.
- Hast du keinen Assistenten eingeschaltet, kommt Clippy nur für die Tour dazu und geht wieder, sobald sie pausiert oder endet. Deine Assistenten-Einstellung ändert sich nicht. Mit einem eigenen Assistenten wird alles, was er während der Tour gesagt hätte, zurückgehalten und danach zusammengefasst.
- In einem Browser, der die App noch nie benutzt hat, bietet eine Karte die Tour einmal an: **Tour starten**, **Jetzt nicht** (beim nächsten Besuch fragt sie erneut) oder **Nicht mehr fragen**.
- Solange du keinen Kanal hast, entfallen die beiden Chat-Schritte.

<!-- id: layout -->

## Der Aufbau

### Obere Leiste

Von links nach rechts zeigt die obere Leiste den App-Namen, den Verbindungsstatus als Punkt, ein Abzeichen **Wiederholt**, solange der Host-Repeater scharf ist, und den Akku des Funkgeräts, wenn du ihn in **Einstellungen > Lokale Konfiguration** einschaltest. Auf breiten Bildschirmen siehst du außerdem ein kleines Diagramm der aktuellen Paketrate, den Verbindungsstatus als Text sowie den Funkgerätenamen mit dem kurzen öffentlichen Schlüssel (klicke auf den Schlüssel, um den vollständigen Schlüssel zu kopieren). Ist das Funkgerät getrennt oder pausiert, erscheint eine Schaltfläche **Erneut verbinden** oder **Verbinden**. Danach folgen die Schaltfläche **Chatfenster** (öffnet das reine Chatfenster, siehe unten), die Schaltfläche **Einstellungen** (ein Punkt darauf bedeutet, dass eine neuere Version verfügbar ist), das Sprachmenü und die Design-Schaltfläche.

Auf schmalen Bildschirmen öffnet eine Menü-Schaltfläche ganz links die Seitenleiste.

### Seitenleiste

Die Seitenleiste ist die Hauptnavigation. Ihre Abschnitte in der Standardreihenfolge:

- **Werkzeuge:** die Analyse- und Hilfsansichten (siehe Werkzeuge).
- **Favoriten:** favorisierte Kanäle und Kontakte, aufgeteilt in Favorisierte Kanäle, Favorisierte Companions, Favorisierte Repeater, Favorisierte Room-Server und Favorisierte Sensoren.
- **Eigene Nodes:** Kontakte, deren Besitzer dein eigenes Funkgerät ist, oder ein Funkgerät, das es ersetzt hat, wenn diese Verknüpfung **Eigene Knoten** übernimmt. Nur sichtbar, wenn es mindestens einen gibt.
- **Kanäle:** deine Kanäle. Ein Symbol neben der Überschrift öffnet Import und Export von Kanälen.
- **Kontakte:** alle Kontakte, mit Filterschaltern für Alle, Companions, Sensoren, Repeater und Raumserver.
- Die **Kontaktgruppen**, die du selbst anlegst.

Jeder Abschnitt lässt sich ein- und ausklappen. Sortierschaltflächen in den Überschriften wechseln zwischen letzter Aktivität und alphabetischer Reihenfolge. Zahlen ungelesener Nachrichten und Erwähnungen stehen an den Zeilen, und **Alle als gelesen markieren** setzt alle zurück. Das Suchfeld filtert Kanäle und Kontakte nach Namen. Die Seitenleiste lässt sich zu einer schmalen Symbolleiste einklappen.

**Kanal/Kontakt hinzufügen** oben öffnet das Fenster Neue Unterhaltung.

### Seitenleiste anpassen

Mit der Schaltfläche **Seitenleiste anpassen** (neben Kanal/Kontakt hinzufügen) kannst du:

- Abschnitte, Werkzeuge und Favoritengruppen umsortieren (Abschnittsreihenfolge, Werkzeugreihenfolge, Favoriten-Reihenfolge).
- Einen Abschnitt oder ein Werkzeug ausblenden (**Aus Seitenleiste ausblenden** / **In Seitenleiste anzeigen**).
- **Kontaktgruppen** anlegen. Eine Gruppe wird ein eigener Abschnitt der Seitenleiste. Einträge fügst du im Infobereich eines Kontakts oder Kanals zu Gruppen hinzu, und ein Eintrag kann in mehreren Gruppen stehen. Beim Löschen einer Gruppe bleiben ihre Kontakte und Kanäle erhalten.
- **Auf Standard zurücksetzen**.

### Befehlspalette

Drücke Strg+K (Cmd+K unter macOS), um die Befehlspalette zu öffnen, und springe durch Tippen zu Unterhaltungen, Einstellungen und Werkzeugen.

### Erklärungen auf Touchscreens

Viele Badges, Symbole und gekürzte Werte haben eine Erklärung, die eine Maus beim Darüberfahren zeigt. Tippe auf einem Touchscreen auf ein solches Element, um die Erklärung in einer kleinen Sprechblase zu sehen. Tippe erneut darauf, tippe woandershin oder scrolle, um sie zu schließen. Schaltflächen und Links sind nicht betroffen: Ein Tippen darauf tut, wofür sie da sind.

### Unterhaltungsbereich

Die große Fläche rechts zeigt, was du ausgewählt hast: einen Chat, eine Kontaktseite, ein Repeater-Dashboard oder ein Werkzeug. Die Adresse im Browser folgt der Ansicht (zum Beispiel `#map` oder `#settings/radio`), sodass du Ansichten als Lesezeichen speichern kannst. Mit **Letzte Unterhaltung erneut öffnen** (Einstellungen > Lokale Konfiguration) öffnet die reine Adresse deinen letzten Chat wieder.

### Chatfenster

Die Schaltfläche **Chatfenster** in der oberen Leiste öffnet ein eigenes, leichteres Fenster nur für Nachrichten, aufgebaut wie ein klassischer IRC-Client: Unterhaltungen links, der Chat in der Mitte und die letzten Absender dieses Chats rechts. Es läuft eigenständig, du kannst also den Haupt-Tab schließen und nur dieses Fenster offen lassen. Es lädt weder die Karte noch den Paket-Feed oder die anderen Werkzeuge und bittet den Server, den Rohpaket-Datenstrom wegzulassen.

Alles in einem Chat funktioniert wie in der Haupt-App: die Schaltflächen im Chatkopf, Nachrichtenaktionen, das Eingabefeld, die Raum-Anmeldung, Kontakt- und Kanalinfo, **Neu** (eine Unterhaltung beginnen oder einen Kanal hinzufügen) und **Suchen**. Alles, was kein Chat ist (die Karte, das Kanalregister, ein Repeater-Dashboard, die Einstellungen), öffnet sich in der Haupt-App.

Die Werkzeugleiste bietet zusätzlich:

- **Zeilen / Blasen:** klassische Zeilen (`[Zeit] <Name> Text`) oder die gewohnten Nachrichtenblasen. In der Zeilenansicht erwähnt ein Klick auf einen Namen diesen Absender, der kleine Punkt davor öffnet seine Kontaktinfo.
- **Skin:** **mIRC**, **mIRC dunkel** oder **App-Design**, um dem Design der Haupt-App zu folgen.
- **Abdocken:** öffnet den aktuellen Chat in einem eigenen kleinen Fenster.
- **Haupt-App:** öffnet die vollständige App mit derselben Unterhaltung.

Skin und Ansicht werden pro Browser gespeichert. Solange ein Haupt-Tab offen ist, überlässt das Chatfenster ihm den Erwähnungston und die Browser-Benachrichtigungen, damit nichts doppelt ertönt. Die Liste rechts zeigt, wer in den geladenen Nachrichten geschrieben hat; MeshCore-Kanäle haben keine Mitgliederliste.

<!-- id: messaging -->

## Nachrichten

### Eine Unterhaltung beginnen

Klicke auf **Kanal/Kontakt hinzufügen**. Das Fenster hat diese Reiter:

- **Kontakt:** gib einen Namen, den öffentlichen Schlüssel aus 64 Hexadezimalzeichen und einen Typ ein.
- **Kontaktlink:** füge einen `meshcore://`-Link aus einem anderen MeshCore-Client ein. Die Signatur des Adverts wird geprüft, bevor der Kontakt übernommen wird. Es wird nichts gesendet.
- **Privater Kanal:** gib einen Namen und einen Schlüssel aus 32 Hexadezimalzeichen ein, oder erzeuge einen zufälligen Schlüssel.
- **Hashtag-Kanal:** tritt einem öffentlichen Hashtag-Kanal bei. Der Schlüssel wird aus dem Kanalnamen abgeleitet, daher landet jeder, der denselben Namen eingibt, im selben Kanal.
- **Kanäle in Masse hinzufügen:** füge mehrere Hashtag-Kanalnamen ein (einen pro Zeile, oder durch Leerzeichen oder Kommas getrennt). Dieser Reiter erscheint nur, wenn du beim Klick auf Kanal/Kontakt hinzufügen die Alt-Taste (Option unter macOS) gedrückt hältst.

Kanalnamen dürfen einschließlich `#` höchstens 32 Bytes lang sein. Standardmäßig werden Namen auf Kleinbuchstaben, Ziffern und Bindestriche vereinheitlicht. Schalte **Großbuchstaben, Leerzeichen und erweiterte Zeichen zulassen** ein, um den Namen genau wie eingegeben zu hashen, so wie andere MeshCore-Clients. Gibt es gespeicherte Pakete, die noch nicht entschlüsselt werden konnten, bietet das Fenster an, den neuen Schlüssel darauf anzuwenden.

### Communities sowie Import und Export

Das Symbol neben der Überschrift Kanäle öffnet **Kanäle importieren / exportieren**. Der Export speichert deine Kanäle als Textdatei, einen pro Zeile, und der Import liest eine solche Datei ein. Im Reiter **Communities** trittst du einer meshcore-open-Community bei, indem du ihren Code einfügst oder ihren QR-Code scannst (Kamera oder Bild). Community-Kanäle nutzen Schlüssel, die aus dem gemeinsamen Geheimnis abgeleitet werden, und funktionieren daher mit meshcore-open. Das Scannen mit der Kamera braucht HTTPS oder `localhost`.

### Lesen und Senden

- Tippe in das Nachrichtenfeld und sende. Bis 30 Sekunden nach dem Senden einer Kanalnachricht kannst du sie erneut senden. Direktnachrichten, die nach allen Versuchen keine Bestätigung erhalten, zeigen **Fehlgeschlagen**.
- Die **Emoji-Auswahl** bietet Suche, zuletzt genutzte Emoji und Hauttöne. Sie zeigt, wie viele Bytes jedes Emoji kostet, denn Nachrichten sind in der Größe begrenzt.
- Nachrichten, die das Funkgerät wahrscheinlich abschneiden würde oder die mehrere Repeater eventuell nicht überstehen, werden unter dem Eingabefeld markiert.
- Nachrichten zeigen die Anzahl der Hops und mit **Pfad-Hop-Breite anzeigen** die Breite jeder Hop-ID. Klicke auf den Pfad einer Nachricht, um ihre Route und empfangene Echos zu sehen.
- SMAZ-komprimierte Nachrichten anderer Clients werden entschlüsselt angezeigt. Bilder, die über meshcore-open gesendet wurden, erscheinen als Platzhalter "Bild (nicht unterstützt)".
- Scope-Abzeichen zeigen, ob eine Kanalnachricht Direkt (0 Hops), Ohne Region (einfacher Flood) oder mit Regions-Scope empfangen wurde.

### Aktionen an einer Nachricht

Fahre mit der Maus über eine Nachricht für **Reagieren**, **Antworten**, **Ab hier als ungelesen markieren** (auf dem Server gespeichert, daher in jedem Browser sichtbar), **Löschen** und **Erneut versuchen** bei fehlgeschlagenen Direktnachrichten.

- Reaktionen und Antworten nutzen das Klartextformat, das andere MeshCore-Clients verstehen. Eine empfangene Reaktion zeigt, zu welcher Nachricht sie gehört.
- **Löschen** entfernt die Nachricht nur aus deinem lokalen Verlauf. Es wird nichts gesendet, und andere Clients behalten ihre Kopie.

### Erwähnungen

Erwähnt jemand deinen Namen in einem Kanal, den du gerade nicht offen hast, erscheint das im Erwähnungsticker (einschalten mit **Erwähnungsticker anzeigen** in Einstellungen > Radio). Klicke auf einen Eintrag, um zur Nachricht zu springen. In Nachrichten genannte Hashtag-Kanäle können mit **Erwaehnte Kanaele automatisch zum Register hinzufuegen** automatisch ins Kanalregister übernommen werden.

### Standorte und Kontakte teilen

- Die Standort-Schaltfläche (Stecknadelsymbol) in der Chat-Kopfzeile fügt den Standort deines Funkgeräts, den Standort dieses Knotens oder einen auf einer Karte gewählten Punkt ein.
- Ein Kontakt-Tag in einer Nachricht erscheint als Chip mit **Kontakt hinzufügen**. **Teilen-Tag kopieren** in der Info eines Kontakts kopiert ein Tag zum Einfügen.
- Unter **Chat-Erkennung** in Einstellungen > Lokale Konfiguration schaltest du klickbare Links, Link-Vorschauen (der Server ruft die verlinkte Seite ab), die Erkennung öffentlicher Schlüssel und die Erkennung von Koordinaten ein.

### Optionen pro Unterhaltung

Die Glocke in der Chat-Kopfzeile öffnet die Benachrichtigungseinstellungen: Hinweise, solange der Tab offen ist, Web-Push-Benachrichtigungen bei geschlossenem Browser (braucht HTTPS), das Stummschalten des Erwähnungstons und **Kanal stummschalten**. **Nachrichten filtern** blendet Nachrichten nach Hop-Größe aus. Weitere Schaltflächen in der Kopfzeile sind unter anderem Favorit, eine Regions-Überschreibung, Pfaderkennung und Direct Trace.

<!-- id: contacts-nodes -->

## Kontakte und Knoten

### Kontaktinfo

Klicke auf einen Avatar oder Namen, um die Info eines Kontakts zu öffnen. Am Computer ist das eine ganze Seite mit drei Spalten (Identität & Aktionen, Deine Daten & Telemetrie, Netzwerk & Aktivität). Auf dem Telefon öffnet sie sich als Seitenbereich. Du siehst unter anderem:

- Typ, öffentlichen Schlüssel, zuletzt gehört, Entfernung, Hops und Route.
- **Nachrichtenrouten (bewertet):** die Routen, die deine Direktnachrichten genommen haben, sortiert nach Zustellung und Geschwindigkeit. Nur zur Information.
- **Positionen** im Zeitverlauf, **Letzte Ankündigungspfade** und die nächsten Repeater nach Hops und nach Entfernung.
- **Auch bekannt als**, wenn ein Kontakt mehrere Namen verwendet hat.
- Notizen, Besitzerinfo, einen manuellen Ersatzstandort, eine abweichende Akkuchemie und eine abweichende Stromquelle (Automatisch erkennt sie am Namen), alles auf dem Server gespeichert.
- **Funk-Belegung:** Auto, Anheften (immer auf dem Funkgerät halten) oder Nur App (nie aufs Funkgerät laden).
- **Telemetrie-Freigabe:** was dein Funkgerät teilt, wenn dieser Kontakt Telemetrie anfragt.
- **Kontaktlink:** einen `meshcore://`-Link anzeigen oder kopieren.
- **Name über Analyzer auflösen** für Kontakte, die nur über den öffentlichen Schlüssel bekannt sind. Nur dieser Schlüssel wird an die Seite gesendet.
- Links zu eingerichteten Analyzern, **Triangulieren** und das Blockieren von Schlüssel oder Namen. Die Chat-Kopfzeile eines Kontakts hat dieselbe Suche als Symbol, und die Paketdetails haben **Absender auf** einer Website **nachschlagen**, wenn das Paket einen vollständigen Absenderschlüssel ergab.

Favorisierte Kontakte bleiben auf dem Funkgerät geladen, damit es ihre Direktnachrichten bestätigen kann.

### Routing-Override

Klicke auf die Routenangabe neben dem Namen eines Kontakts (zum Beispiel die Hop-Anzahl oder "flood"), um **Routing-Override** zu öffnen. Du kannst Flood erzwingen, Direkt erzwingen oder einen festen Pfad aus kommagetrennten Hop-IDs mit 1, 2 oder 3 Bytes eingeben. Lösche den Override, um zur gelernten Route zurückzukehren. Der letzte Versuch einer unbestätigten Direktnachricht wird immer als Flood gesendet.

### Repeater

Beim Öffnen eines Repeaters erscheint ein Anmeldeformular: melde dich mit dem Passwort oder als Gast an. Das Dashboard hat dann Bereiche für Node-Info, Telemetrie, Radioeinstellungen (mit Advert-Intervallen), LPP-Sensoren, Nachbarn, ACL, Regionen und Besitzerinfo, dazu Aktionen (Zero-Hop-Advert, Flood-Advert, Uhr synchronisieren, Neustart), eine Konsole mit CLI-Zugang, den Telemetrieverlauf und einen Bereich Verlauf, der zeigt, was sich zwischen gespeicherten Momentaufnahmen geändert hat. Während du in der Konsole tippst, werden passende Standardbefehle von MeshCore mit ihren Parametern und einer kurzen Beschreibung (auf Englisch) aufgelistet: Tab ergänzt den ersten, mit den Pfeiltasten und Enter wählst du einen anderen, Escape blendet die Liste aus. Ein Vorschlag füllt nur das Eingabefeld; gesendet wird erst, wenn du auf Senden drückst. Befehle mit "serial only" funktionieren nicht über Funk. Die Konsole sendet eine Zeile genau wie getippt, auch führende Leerzeichen und eine leere Zeile; das braucht `region load` der Firmware. Für eine Zeile, die mit einem Leerzeichen beginnt, gibt es keine Vorschläge. **Alles laden** ruft alle Bereiche nacheinander ab.

Mit Einstellungen bearbeiten änderst du jeweils eine Repeater-Einstellung: du bearbeitest, bestätigst den genauen CLI-Befehl, er wird über Funk gesendet, und der Wert wird zur Kontrolle zurückgelesen. Für Änderungen an Frequenz, Bandbreite, Spreading Factor oder Coding Rate musst du zuerst den Namen des Repeaters eintippen, weil ein falscher Wert ihn vom Netz nehmen kann. Die Gruppe Observer-Firmware (SNMP-Agent ein/aus) funktioniert nur auf DMC-Observer- und agessaman-Observer-Firmware: nutze zuerst die eigene Schaltfläche Lesen und starte den Repeater nach einer Änderung neu.

Repeater und Room-Server mit Observer-Firmware lassen sich auch über dein Netzwerk abfragen. Auf der Kontaktseite nimmt die Karte **SNMP (LAN)** IP-Adresse, Port und Community des Nodes entgegen; **Jetzt abfragen** zeigt dann Funk-, MQTT-, Speicher- und WLAN-Werte, ohne Funk zu nutzen. SNMP muss auf dem Node eingeschaltet sein (Gruppe Observer-Firmware in Einstellungen bearbeiten, danach neu starten) und der Server muss den Node per UDP erreichen können. Schalte **Nach Zeitplan abfragen** ein, damit der Server den Node alle paar Minuten abfragt und die Ergebnisse speichert; die Karte zeigt dann ein Verlaufsdiagramm für den gewählten Wert und Zeitraum. Wenn die Home-Assistant-Integration den Repeater verfolgt, erscheinen die Werte dort auch als SNMP-Sensoren. **Node nach seiner Adresse fragen** sendet einen Befehl über Funk, um die IP abzufragen, und braucht eine Admin-Anmeldung. Die Seite **SNMP** unter Werkzeuge zeigt alle Nodes mit SNMP nebeneinander.

### Room-Server

Auch Room-Server haben eine Anmeldung mit Passwort oder als Gast, mit Telemetrie, ACL, Sensordaten, einer CLI-Konsole und einem Verlauf der ACL-Änderungen.

Ein Room-Server sendet dir die Beiträge, die neuer sind als das, was dein Funkgerät schon empfangen hat. **Jetzt synchronisieren** meldet sich erneut an, um danach zu fragen. Fehlen danach noch Beiträge (zum Beispiel nach einem Neustart des Funkgeräts oder nachdem viele Nachrichten auf einmal ankamen), öffne **Tools anzeigen** und nutze **Verlauf neu abrufen**. Damit sendet der Room-Server jeden Beitrag, den er noch gespeichert hat, erneut, bis zu 32. Beiträge, die du schon hast, werden nicht doppelt gespeichert, und deine eigenen Beiträge werden nicht zurückgesendet. Zur Bestätigung ist ein zweiter Klick nötig, weil es die Sendezeit all dieser Beiträge kostet; die Beiträge kommen in den nächsten Minuten an.

### Telemetrie

- Bei einem Kontakt, der kein Repeater ist, ruft **Anfordern** die Sensorwerte bei Bedarf ab, mit Verlaufsdiagrammen.
- Unter **Einstellungen > Radio-App-Verwaltung** kannst du Repeater und bis zu 8 weitere Kontakte für die planmäßige Abfrage verfolgen. Um den Mesh-Verkehr zu begrenzen, teilen sich alle verfolgten Knoten eine Obergrenze von 24 Abfragen pro Tag. Mehr verfolgte Knoten bedeuten also ein längeres Intervall.

### Uhren der Nodes

Jedes Advert enthält die Zeit des Nodes, der es gesendet hat. Die Kontaktinfo zeigt das als **Uhr**: **Geht richtig** (innerhalb von 2 Minuten zu diesem Server) oder wie weit der Node vor- oder nachgeht. Ein Node, dessen Uhr nie gestellt wurde, geht Jahre nach. Zum Messen wird nichts gesendet; der Wert ist so alt wie das zuletzt gehörte Advert, und es zählen nur Adverts, die seit der Installation dieser Version gehört wurden.

Bei einem verfolgten Repeater gibt es im Bereich Telemetrieverlauf **Uhr dieses Repeaters stellen, wenn sie nachgeht**. Ist das an, prüft jede Telemetrieabfrage, die den Repeater erreicht, sein neuestes Advert und sendet einen Zeitbefehl über Funk, wenn die Uhr mehr als 2 Minuten nachgeht. Zwei Sicherungen gelten. Der Befehl geht höchstens einmal pro neuem Advert raus, und nur, wenn die meisten am letzten Tag gehörten Nodes (mindestens 5) mit der Uhr dieses Servers übereinstimmen, damit eine falsche Serveruhr nicht in Repeater gelangt. Die Repeater-Firmware stellt eine Uhr nie zurück: Ein Repeater, der vorgeht, bleibt unangetastet und wird nur im Serverlog vermerkt. Dein Funkgerät braucht Admin-Rechte auf dem Repeater (einmal mit dem Admin-Passwort anmelden).

### Pfade

- **Pfaderkennung** (Chat-Kopfzeile) sendet eine geroutete Probe, zeigt Hin- und Rückpfad und speichert die gelernte Route.
- **Direct Trace** sendet einen Trace an einen Kontakt und zeigt das SNR auf dem Hin- und Rückweg.
- Beide senden über Funk und brauchen den vollständigen Schlüssel des Kontakts.

<!-- id: map -->

## Karte

Öffne **Knotenkarte** unter Werkzeuge. Die Karte zeigt Knoten mit einem angekündigten oder manuellen Standort. Öffnest du die Karte aus einem Kontakt, über die Karten-Schaltfläche im Mesh-Zustand oder über einen `#map/focus/...`-Link, wird dieser Knoten zentriert.

### Bedienung

Die Kartenbedienung ist in **Anzeige**, **Größe & Farben**, **Filter** und **Overlays** gegliedert.

- **Anzeige:** Grundkarte (Nova dunkel, OpenFreeMap, OpenStreetMap, OpenTopoMap und Esri-Ebenen), 2D oder 3D mit Neigung und 3D-Gebäuden, Beschriftungen (aus, Name oder ID-Tag) und eine Legende. Vollbild und **GPX exportieren** (die aktuell sichtbaren Knoten als Wegpunkte) findest du hier ebenfalls.
- **Größe & Farben:** Knotengröße, gleiche Knotengrößen, Neon-Knoten und eine Farbe pro Knotenrolle.
- **Filter:** **Seit** (ein fester oder eigener Zeitraum), **Vom Server gehört** (alle, nie gehörte ausblenden oder nur nie gehörte), **Knotenrollen**, **Stromquelle** (die Einstellung am Kontakt, sonst das Strom-Symbol im Knotennamen: ⚡/🔌 Netz, 🔋 Akku, ☀️/🌞/🔆 oder das Wort "solar" für Solar, beides für Solar + Akku, kein Symbol ist Unbekannt; Knoten mit dem Namen "DTIS | ..." sind Solar + Akku), **Analyzer-Knoten** und **Knoten mit falschem Standort ausblenden** (bei 0,0 oder mehr als 300 km vom nächsten Knoten entfernt, der sie gehört hat).

**Overlays** sind aus, bis du sie einschaltest, und werden pro Browser gespeichert:

- **Pakete visualisieren** (siehe unten).
- **Verbindungen** zwischen Knoten, aus Liveness, Advert-Pfaden oder dem gesamten Verkehr, mit Zuverlässigkeitsstufe, maximaler Entfernung und Altersfenster. Klicke auf eine Verbindung und dann auf **Details** für ihren Verkehrs- und Signalverlauf.
- **Telemetrie (Akku/Temp)**.
- **Geteilte Standorte:** Stecknadeln für im Chat geteilte Standorte. Klicke darauf, um zu sehen, wer sie geteilt hat, und auf **Im Chat öffnen**.
- **Baken:** Positionen, Wegpunkte und Routen von MeshCore TEAM und signalk-meshcore in Kanälen, denen du folgst. Die neueste Position jedes Absenders ist eine Stecknadel mit einem Symbol für die Art des Absenders (Boot, autonomes Funkgerät oder Person), und Wegpunkte tragen ihr TEAM-Typsymbol; schalte **Spuren** ein, um seine Spur über das Zeitfenster zu zeichnen. Klicke auf eine Stecknadel für Batterien, Status und **Im Chat öffnen**. Ein Kontakt, der solche Baken gesendet hat, bekommt außerdem einen Abschnitt **Baken-Verlauf** in den Kontaktinfos.
- **Senden im TEAM-Format:** in einem privaten Kanal kann **Share location > Auf Karte auswählen** einen MeshCore-TEAM-Wegpunkt statt einer Standortmarkierung einfügen. **Einstellungen > Radio-App-Verwaltung > MeshCore-TEAM-Bake** kann die Position dieses Funkgeräts als TEAM-Bake auf einem privaten Kanal in einem festen Intervall senden. Das ist standardmäßig aus und sendet jedes Mal über das Funkgerät. Setze **Schiffstyp** in den Kontaktinfos, um einem Boot ein eigenes Kartensymbol zu geben.
- **Geschätzte Standorte:** geschätzte Positionen für Knoten ohne Standort, als hohle Markierungen auf jeder Zoomstufe, beschriftet gemäß der Karteneinstellung Beschriftungen. Werden nie gespeichert oder gesendet.
- **Relay-Signal:** Ringe um Relays, die Flood-Pakete an dein Funkgerät weitergegeben haben, eingefärbt nach durchschnittlichem SNR.

**Analyzer-Knoten** zeigt Knoten aus dem Knotenverzeichnis eines externen Analyzers. Dieses Verzeichnis wird nur gefüllt, wenn **Externe Analyzer-Knotenebene** in Einstellungen > Radio eingeschaltet und synchronisiert ist.

### Pakete visualisieren

Schalte **Pakete visualisieren** ein, um Pakete als animierte Bögen und Impulse über die Karte wandern zu sehen. Mit einer Wiedergabeleiste kannst du abspielen, pausieren, die Geschwindigkeit ändern, springen und zu live zurückkehren. Impulse, Leuchten, Bogenbreite und das Ausblenden der Spur sind einstellbar, und du kannst den **Geiger-Ton** einschalten. Im selben Bereich steht **Knoten entdecken**, ein passiver Filter, der nur Knoten zeigt, die seit dem Einschalten in Live-Paketen gehört wurden. Er sendet nichts.

### Startansicht und Pop-ups

**Einstellungen > Karte** legt fest, wo die Karte öffnet: alle Knoten im Bild, ein fester Heimatstandort mit Zoomstufe oder deine letzte Position. Klicke auf einen Knoten für Details, Telemetrie, einen Link zur Unterhaltung, **Besitzer anschreiben**, **Triangulieren** und **Details**.

<!-- id: tools -->

## Werkzeuge

Der Abschnitt Werkzeuge in der Seitenleiste enthält diese Ansichten. Mit Seitenleiste anpassen kannst du sie umsortieren oder ausblenden.

### Mein Knoten

Statistiken zu deinem eigenen Funkgerät: Gerätedaten (Frequenz, Bandbreite, Modell, Firmware) und Diagramme über einen wählbaren Zeitraum, von 20 Minuten bis zu einem Jahr oder einem eigenen Zeitraum. Es gibt Diagramme für Pakete und Bytes, RSSI und SNR mit Rauschpegel, **Sendezeitauslastung**, **Empfangsfehler**, gehörte Knoten, Nachbarn, Pfad-Hash-Breite, die aktivsten Kanäle und das **Radar direkt gehört**, das mit 0 Hops gehörte Knoten nach Richtung und Entfernung darstellt. Diagramme zoomst du mit dem Mausrad, verschiebst sie durch Ziehen und setzt sie per Doppelklick zurück.

Die Diagramme für Akku, Grundrauschen und Sendezeit zeigen das aktuelle Funkgerät plus den Verlauf, den es von einem ersetzten Funkgerät übernommen hat. Gibt es mehr als ein Funkgerät oder Verlauf aus der Zeit vor der Funkgeräte-Erfassung, erscheint neben dem Zeitraum eine Auswahl **Funkgerät**: **Aktuelles Funkgerät**, ein bestimmtes Funkgerät (mit dem, was es übernommen hat) oder **Vor der Funkgeräte-Erfassung**.

### Mesh-Zustand

- **Adverts:** direkte und Flood-Adverts pro Kontakt, eine durchsuchbare Kontakttabelle, Diagramme zu Hops und Hash-Modus, eine Aktivitäts-Heatmap und Warnungen für Knoten, die zu oft adverten (nur Flood-Adverts).
- **Anfragen:** Anfrage- und Antwortverkehr, den dieser Knoten gehört hat.
- **Präfix-Kollisionen:** Kontakte, die ein Präfix des öffentlichen Schlüssels von 1, 2 oder 3 Bytes teilen. Gemeinsame Präfixe machen Hops mehrdeutig.
- **Empfang je Relay:** für mehrfach gehörte Flood-Pakete, welches Relay jede Kopie geliefert hat und mit welchem Signal. Die Summen und die Tabelle je Relay umfassen das ganze Fenster, ohne Zeilenlimit. Die Tabelle je Relay zeigt auch, wie oft die Kopie eines Relays zuerst ankam und wie viele Pakete du nur über dieses Relay gehört hast. Klappe ein Relay auf (der Pfeil vor dem Namen) für seine Aktivität und sein Signal im Zeitverlauf, Pakettypen, Anzahl Hops und letzte Kopien. Die Tabelle je Paket blättert durch gespeicherte Kopien; wähle darunter die Zeilen pro Seite. Gespeicherte Kopien werden standardmäßig 2 Tage behalten; vorher werden sie in einen stündlichen Verlauf je Relay zusammengefasst (standardmäßig 365 Tage behalten, **Relay-Verlauf stündlich** unter Datenaufbewahrung), sodass Fenster, die länger sind als die gespeicherten Kopien, weiterhin Summen und Diagramme je Relay zeigen.
- **Stromausfall:** welche Knoten bei einem Stromausfall online bleiben, basierend auf der Stromquelle jedes Knotens (die Einstellung am Kontakt, sonst das Strom-Symbol im Namen; DTIS-Knoten sind Solar + Akku). Akku- und Solarknoten bleiben online; Netz- und unbekannte Knoten fallen aus (Unbekannt zählt als Netz). Zeigt den überlebenden Anteil, die Verteilung der Stromquellen und die Inseln, die die überlebenden Knoten über gehörte Advert-Pfadlinks bilden (nur zwischen Knoten mit Standort), damit sichtbar wird, wo das Mesh zerfallen würde. Wähle Repeater + Räume oder alle Knoten und wie kürzlich sie gehört wurden. Ein Klick auf einen Spaltenkopf sortiert die Knotentabelle; die Tabelle wird mit derselben Einstellung **Max. Zeilen anzeigen** wie die Adverts-Tabelle seitenweise angezeigt, und nach dem Herunterscrollen erscheint eine Schaltfläche nach oben.
- **Spam und Bots:** Statistiken über Kanalnachrichten, die als Spam, fehlerhaft oder Duplikat markiert sind, und Nachrichten von Absendern auf einer Botliste, für den gewählten Zeitraum und wahlweise einen Kanal. Die Kacheln zeigen jede Anzahl und ihren Anteil am Kanalverkehr. **Bots** zählt Nachrichten von Absendern, die heute auf einer aktiven Botliste stehen; die Zahl der bei Ankunft markierten Nachrichten daneben ändert sich nicht, wenn sich die Listen ändern. Das Diagramm zeigt den Verlauf als Anzahl oder als Anteil. **Verursacher** hat drei Tabellen (Absender, Kanäle, Quell-Repeater), die sich per Klick auf einen Spaltenkopf sortieren und als CSV herunterladen lassen. **Filter** zeigt, was Spam Guard mit den bewerteten Nachrichten gemacht hat (gestoppt, wäre gestoppt worden, während nichts zurückgehalten wurde, wie im Modus Beobachten, durchgelassen, zurückgehalten, sauber), welche Art von Sperre sie erfasst hat, deine eigenen Antworten Das ist Spam und Kein Spam, die Ursache fehlerhafter Nachrichten und die Pakete je OpenHop-Regel. Ergebnisse werden ab der Version festgehalten, die diesen Reiter eingeführt hat; ältere Nachrichten zählen als ohne festgehaltenes Ergebnis. **Zusammenfassung kopieren** legt einen kurzen Textbericht in die Zwischenablage, **JSON** lädt den ganzen Bericht herunter. **Namen anonymisieren** ersetzt Absendernamen, Namen privater Kanäle und selbst geschriebene OpenHop-Regelnamen durch Codes, auf der Seite und in jedem Export, damit die Zahlen geteilt werden können. Auf diesem Reiter wird nichts über das Funkgerät gesendet.

### Mesh-Trends

**Historisch** zeigt gespeicherte Auswertungen: Netzwerk, Nachrichten, Aktivität, die aktivsten Kanäle, Pakete pro Stunde, Pfad-Hash-Breite, Regions-Scope, Rauschpegel und MQTT-Broker-Statistiken. **Live · diese Sitzung** zeigt Paketstatistiken. Die kurzen Zeitfenster (1, 5 und 10 Minuten sowie diese Sitzung) stammen aus deinem Browser; längere Zeitfenster werden aus der Datenbank berechnet.

### Mesh-Erkennung

**Repeater ermitteln**, **Sensoren ermitteln** oder **Beide ermitteln** sendet eine kurze Erkennungsanfrage über Funk und listet die Knoten auf, die antworten. **Regionen ermitteln** fragt Repeater in der Nähe, welche Regionen sie fluten, damit du sie zu deinen bekannten Regionen hinzufügen kannst.

### Spam Guard

Spam Guard stoppt Kanalspam an deinem Repeater. Bewertet wird Verhalten, nie Personen oder Meinungen: derselbe Text unter mehreren erfundenen Namen, Fluten von Kopien und Repeater, über die Spam ins Mesh kommt. Schalte es unter **Einstellungen > Lokale Konfiguration > Spamschutz** ein; die Seite erscheint dann unter Tools.

Es startet im Modus **Beobachten**: Spam wird erkannt und angezeigt, aber nichts wird blockiert. Lass es einen Tag so laufen und prüfe, was es stoppen würde. Mit **Schützen** leitet dein Host-Repeater nicht mehr weiter, was eine Sperre erfasst. Das ändert nur dann etwas auf dem Funkweg, wenn der Host-Repeater scharf ist.

Ein **OpenHop**-Funkgerät leitet selbst weiter. Dort schreibt Schützen die Sperren in die Richtlinie des Knotens, als Regeln, deren Name mit `rtfm-spam:` beginnt, um deine eigenen Regeln herum. Deine eigenen Regeln bleiben, wie sie sind. Das Ende jedes Regelnamens sagt, woher die Sperre kommt: `(yours)` für eine, die du selbst angelegt oder behalten hast, `(duplicate)` für die übliche Duplikatunterdrückung, `(auto)` für den Rest. Dafür werden die API-URL und das Token unter **OpenHop-Verwaltung** in den Einstellungen gebraucht, und die Richtlinien-Engine des Knotens wird eingeschaltet. Die Regeln werden wieder vom Knoten genommen, wenn du zu Beobachten zurückgehst, pausierst, Spam Guard ausschaltest oder RTFM-EV beendest. Ein privater Kanal wird auf dem Knoten erst durchgesetzt, nachdem du auf der Spam-Guard-Seite unter Einstellungen **Auch auf dem OpenHop-Knoten durchsetzen** dafür angehakt hast, weil dabei der Kanalschlüssel auf den Knoten kopiert wird. Auf einen Knoten, auf dem schon SpamGuard läuft, wird nichts geschrieben.

- **Übersicht** zeigt den Modus, ob alles läuft und wie viel Spam gestoppt oder durchgelassen wurde.
- **Schutz** listet die aktiven Sperren, jeweils mit Grund und Ende. Jede automatische Sperre endet von selbst. **Lockdown** ist für einen starken Angriff: Eine Zeit lang kommen nur bereits bekannte Namen durch. Unter **Möglicherweise echt, zurückgehalten** stehen Nachrichten von normal aussehenden Namen, die zurückgehalten wurden; **Durchlassen** vertraut diesem Namen. **Liste leeren** macht diese Liste leer. Mit **Selbst etwas sperren** fügst du eine Sperre für einen Text oder einen Repeater hinzu; eine Repeater-Sperre kann für einen einzelnen Kanal gelten, das ergibt weniger Regeln. **Automatische Sperren löschen** entfernt sie und hält sie höchstens 24 Stunden zurück, wie eine Sperre, die du selbst entfernst.
- **Nachrichten** zeigt, was es gelesen hat und warum es eingegriffen hat oder nicht. Korrigiere es mit **Das ist Spam** und **Kein Spam**. Dieselben zwei Schaltflächen stehen an jeder Kanalnachricht im Chat. Bei einer erfassten Nachricht steht, von welcher Sperre und in welchem Kanal. **Liste leeren** macht nur die Liste auf dem Bildschirm leer: Spam Guard nutzt diese Nachrichten weiter als Beleg.
- **Spamquellen** zeigt, über welche Repeater Spam hereinkommt. **Entfernen** nimmt einen Repeater aus der Liste, bis neuer Spam über ihn hereinkommt.
- **Einstellungen** enthält die Kanäle, die es liest (suche einen Kanal, um ihn hinzuzufügen), jede Einstellung mit einem Hinweis auf ihre Nebenwirkungen und die Ausnahmen (vertrauenswürdige Namen, Repeater, die nie gesperrt werden, erlaubte Texte). Ist **Ein Beweisprotokoll führen** an, speichert es, was es gelesen hat, und deine Antworten Das ist Spam / Kein Spam, so viele Tage wie eingestellt. Du kannst das Protokoll herunterladen, auch anonymisiert (Namen durch Codes ersetzt, zum Teilen), und es mit den Einstellungen im Formular **wiederholen**, um zu sehen, was sie gestoppt hätten. Eine Wiederholung ändert nichts. Ganz unten gibt es unter **Neu anfangen** zwei getrennte Resets: **Gelerntes vergessen** entfernt jede Sperre (auch deine eigenen), die bekannten Namen und Routen, die Spamquellen, die Listen und die Zahlen; **Einstellungen auf Standard zurück** setzt Einstellungen und Ausnahmen auf die einer neuen Installation zurück.
- Zwei Einstellungen, die man kennen sollte. **Wiederholungen sperren von** legt fest, wessen Wiederholungen die Duplikatunterdrückung zurückhält: andere Namen mit demselben Text (der erste Absender darf erneut senden), nur derselbe Name oder alle. **Fehlerhafte Nachrichten als Spam behandeln** markiert Nachrichten aus zufälligen Zeichen oder von einem Absender mit nie gestellter Uhr und zählt sie als erfundenen Namen.
- **Richtlinie** gibt es nur mit einem OpenHop-Funkgerät. Es ist der Richtlinien-Editor des Knotens selbst: der Schalter der Engine, die Gruppen und die Regeln. Der Knoten filtert. Solange Spam Guard eingeschaltet ist, steht der Editor hier und nicht unter Einstellungen > OpenHop; ist Spam Guard aus, steht er wieder dort.

Ein Repeater wird geteilt. Was deiner nicht weiterleitet, verschwindet für alle dahinter, und sie können nicht sehen, warum. Es gibt bewusst keine Schaltfläche, um eine Person nach Namen zu sperren. Eine Botliste mit eingeschaltetem **Weiterleitung blockieren** ist die einzige Ausnahme: Sie hält die Namen auf, die du darauf setzt, siehe **Botlisten** unter Einstellungen.

Im Chat blendet **Spam ausblenden** im Filtermenü markierte Nachrichten aus und hält sie aus Ungelesen-Zählern und Benachrichtigungen heraus. Eine Nachricht, die die Duplikatunterdrückung als Wiederholung erfasst hat, trägt die Markierung **Duplikat**. Das ist keine Spam-Markierung, sie wird also nicht ausgeblendet.

**Profile.** Auf dem Reiter **Einstellungen** bewahrt **Profile** Sätze von Erkennungseinstellungen unter einem Namen auf, zusammen mit dem Modus. Nutze sie, wenn sich die Lage ändert: eines für eine Spamwelle, eines für eine Veranstaltung, eines für normale Tage.

- **Aktuelle als Profil speichern** legt die Einstellungen ab, die jetzt gelten.
- **Anwenden** zeigt zuerst jede Einstellung, die sich ändert, mit altem und neuem Wert. Ein Profil, das auf **Schützen** schaltet, sagt das und bittet um deine Bestätigung, denn ab dann leitet dein Repeater nicht mehr weiter, was Spam Guard blockiert.
- **In Verwendung** nennt das Profil, das du zuletzt angewendet hast. Änderst du danach eine Einstellung, steht dort **geändert**, und du kannst **Im Profil speichern** oder **Zurücksetzen** wählen.
- **Exportieren** lädt ein Profil als Datei herunter, die du weitergeben kannst. **Datei importieren** fügt ein Profil aus einer solchen Datei hinzu. Importieren wendet es nie an: Sieh dir zuerst an, was es ändert.

Ein Profil enthält nie deine geschützten Kanäle, Kanalschlüssel, Ausnahmen, die Pause oder die Einstellungen des Beweisprotokolls, und Anwenden lässt sie unberührt. Nichts schaltet von selbst. Hat das Formular darunter ungespeicherte Änderungen, speichere oder verwirf sie zuerst.

### SNMP

Alle Nodes, für die auf der Kontaktseite SNMP eingerichtet ist, in einer Tabelle. Jede Zeile zeigt Status, Name, Adresse, Zeitplan, die letzte erfolgreiche Abfrage und den letzten Fehler, dazu die wichtigsten Werte nebeneinander: Firmware-Version, Laufzeit, freier Heap, größter freier Block, verbundene MQTT-Slots, Tiefe der Paketwarteschlange, WLAN-RSSI, Grundrauschen, Empfangsfehler, letzter RSSI und letzter SNR. Ein Node, dessen letzte Abfrage fehlgeschlagen ist, ist rot mit **Fehlgeschlagen** markiert und steht oben; seine Werte sind dann die der letzten erfolgreichen Abfrage. Klicke auf eine Spaltenüberschrift, um zu sortieren.

Klicke auf eine Zeile oder den Pfeil davor, um die eigene Seite dieses Nodes zu öffnen (siehe unten). **Jetzt abfragen** fragt einen Node ab, **Alle jetzt abfragen** fragt sie nacheinander ab. Die Abfrage läuft über dein Netzwerk (UDP) und nutzt nie Funk. **Automatisch aktualisieren** liest nur neu ein, was der Server gespeichert hat, alle 10, 30 oder 60 Sekunden oder gar nicht. Wie oft ein Node abgefragt wird, legst du mit **Nach Zeitplan abfragen** auf seiner Kontaktseite fest. Klicke auf den Namen eines Nodes, um diese Seite zu öffnen.

Die Node-Seite zeigt einen Node vollständig. Oben stehen Status, Adresse, letzte erfolgreiche Abfrage und Zeitplan, dazu **Jetzt abfragen** und **Kontaktseite öffnen**. Wähle einen Zeitraum von 20 Minuten bis 30 Tagen oder **Benutzerdef.** mit Beginn und Ende. Kacheln zeigen die neuesten Werte und wie oft der Node in diesem Zeitraum neu gestartet ist. Darunter stehen Diagramme der gespeicherten Abfragen: Laufzeit, Pakete, Empfangsfehler, Sendezeit, Grundrauschen, RSSI und SNR, MQTT-Slots und Warteschlangentiefe, Speicher und WLAN-RSSI. Sie zoomen mit dem Mausrad, lassen sich durch Ziehen verschieben und zeigen Werte beim Überfahren. Alle 22 Werte der neuesten Abfrage stehen unten.

Pakete, Fehler, Sendezeit und übersprungene Publishes sind Zähler, die seit dem Start des Nodes nur steigen. Mit **Zähler** auf **Raten** zeigen die Diagramme den Zuwachs zwischen zwei Abfragen pro Minute und die Sendezeit als Prozent der Zeit; ein Neustart wird ausgelassen statt als Abfall gezeichnet. **Summen** zeigt die Zähler selbst. Die Diagramme brauchen mindestens zwei gespeicherte Abfragen im Zeitraum, schalte also **Nach Zeitplan abfragen** für einen Node ein, den du verfolgen willst.

### Flotte

Das Geräteregister: eine Zeile pro Gerät, das du verwaltest, mit dem, was nur du darüber weißt. Das sind deine eigene Bezeichnung, die Seriennummer der Organisation, die Hardware-Seriennummer, Modell, Rolle, WLAN- und Bluetooth-MAC-Adresse, wem es zugewiesen ist, der Standort, ein Status und Notizen. Der Status ist **Auf Lager**, **Im Einsatz**, **Wartung**, **Verloren**, **Gestohlen** oder **Außer Betrieb**. Nichts auf dieser Seite nutzt das Funkgerät.

Ein Gerät kann den öffentlichen Schlüssel eines Nodes tragen. Hat ein Kontakt diesen Schlüssel, zeigt die Zeile den Namen des Nodes und wann er zuletzt gesehen wurde, und die Seite des Geräts zeigt unter **Im Mesh** seinen Typ und seine Position. Diese Werte kommen vom Kontakt und werden nicht kopiert, sie sind also immer aktuell. Der Schlüssel ist optional: Du kannst ein Gerät erfassen, das noch im Karton liegt, oder den Schlüssel eines Nodes eintragen, der noch nicht gehört wurde.

**Gerät hinzufügen** öffnet ein leeres Formular. Ein Gerät braucht mindestens eine Bezeichnung, eine Seriennummer der Organisation oder einen öffentlichen Schlüssel. **Meine eigenen Nodes hinzufügen** erscheint, wenn Nodes, deren Besitzer dieses Funkgerät ist, noch nicht im Register stehen, und legt sie als **Im Einsatz** an. Auf einer Kontaktseite macht **Zur Flotte hinzufügen** dasselbe für diesen einen Node, und **Flotteneintrag öffnen** öffnet sein Gerät. Die Suche durchsucht jedes Feld, die Statusliste grenzt die Tabelle ein, und eine Spaltenüberschrift sortiert sie. **CSV exportieren** und **JSON exportieren** speichern die angezeigten Zeilen.

Auf der Seite eines Geräts speichert **Speichern** nur, was du geändert hast. **Gerät löschen** verlangt einen zweiten Klick; es entfernt das Gerät und lässt den Kontakt unberührt. Auch das Löschen eines Kontakts entfernt sein Gerät nicht. Mit mehr als einem Funkgerät hat jedes Funkgerät sein eigenes Register.

**Protokoll.** Jedes Gerät hat ein Protokoll. Wähle die Art des Eintrags (Wartung, Ausfall, Platzierung, Inhaber, Firmware oder Notiz), den Zeitpunkt, was passiert ist, und optional wer es getan hat und Details, dann **Eintrag hinzufügen**. Wenn du einen neuen Status oder einen neuen Namen unter **Zugewiesen an** speicherst, schreibt die App diese Änderung selbst ins Protokoll, mit altem und neuem Wert. Die Liste zeigt das Datum der letzten Wartung.

**Was der Node gemeldet hat.** Für ein Gerät mit öffentlichem Schlüssel zeigt **Im Mesh** auch Akkuspannung und Temperatur der neuesten gespeicherten Telemetrie und die Firmware-Version, die der Node zuletzt gemeldet hat, mit der Herkunft: der Besitzer-Bereich des Repeaters, eine SNMP-Abfrage oder das verbundene Funkgerät selbst. Die Seite fragt nie einen Node danach. Ein Node zeigt keinen Akku, solange er nicht auf einer der Listen der verfolgten Telemetrie steht, und keine Firmware, solange sein Besitzer-Bereich nicht abgerufen wurde und SNMP nicht eingerichtet ist.

**Braucht Aufmerksamkeit.** Ein Warnzeichen in der Liste markiert ein Gerät, das verloren oder gestohlen ist, und ein Gerät im Einsatz, dessen Node länger als das Limit nicht gesehen wurde, dessen Akku unter dem Limit liegt oder das eine andere Firmware meldet als die **Soll-Firmware**. Hake **Braucht Aufmerksamkeit** an, um nur diese zu sehen. Die beiden Limits stehen unter **Aufmerksamkeitsregeln** (zu Beginn 48 Stunden und 3,5 Volt). Für ein verlorenes oder gestohlenes Gerät listet die Geräteseite die zuletzt bekannten Positionen des Nodes auf.

**Schlüsseltresor.** Diesen Teil gibt es nur, wenn der Server mit eingeschaltetem Tresor gestartet wurde (siehe das erweiterte README); sonst siehst du ihn nicht. Er speichert private Schlüssel und Passwörter deiner Geräte, verschlüsselt. Beim ersten Mal legst du eine Passphrase fest: Sie lässt sich nicht wiederherstellen, ohne sie sind die gespeicherten Geheimnisse also verloren. Danach entsperrst du damit, und der Tresor sperrt sich nach 15 Minuten ohne Nutzung und bei einem Neustart des Servers wieder. Auf der Seite eines Geräts speicherst du ein Geheimnis mit Art, Bezeichnung und Wert. Die Liste zeigt nur Art, Bezeichnung und Datum. **Anzeigen** zeigt einen Wert und **Verbergen** nimmt ihn wieder vom Bildschirm; jedes Anzeigen wird im Audit-Protokoll festgehalten. Ein Gerät, das noch Geheimnisse hat, kann nicht gelöscht werden. Unter **Schlüsseltresor** auf der Flottenseite kannst du den Tresor sperren, die Passphrase ändern, alle Geheimnisse in eine Datei **Exportieren**, die mit einer eigenen Passphrase verschlüsselt ist, eine solche Datei **Importieren** und das Audit-Protokoll lesen. Nutze den Tresor nur über HTTPS: Die Seite warnt, wenn das nicht der Fall ist.

**Schlüssel erzeugen.** Für ein Gerät ohne öffentlichen Schlüssel bietet der Tresor-Bereich ein neues Schlüsselpaar an. Du kannst die ersten Hex-Zeichen vorgeben, die du möchtest (höchstens vier), und wählen, dass die ersten zwei Bytes oder das erste Byte von keinem bekannten Node genutzt werden. Der private Schlüssel kommt in den Tresor, der öffentliche auf das Gerät im Register. Es wird nichts an ein Funkgerät gesendet: Um den Schlüssel auf ein Gerät zu bringen, zeigst du ihn an und gibst ihn dort selbst ein.

**Konfigurationen.** Die Seite eines Geräts bewahrt die Konfigurationsdateien dieses Geräts auf. **Importieren** nimmt die Datei, die die Dutch MeshCore Toolbox auf der Seite USB config für einen Repeater oder Room-Server speichert, oder die Konfigurationsdatei aus **Einstellungen > Radio** für einen Companion. Wähle, ob sie zeigt, was das Gerät hatte (**Vom Gerät gelesen**) oder was es haben soll (**Gewünscht**), und trage bei Bedarf die Rolle, die Firmware-Version und eine Bezeichnung ein. Die App wählt anhand der Datei ein Profil (Standard-Firmware, DMC-Repeater, DMC-Observer oder Companion); du kannst es korrigieren. Jeder Import ist ein neuer Eintrag, die Liste ist also zugleich der Verlauf. Ein Repeater oder Room Server an einem USB-Kabel kann hier auch gelesen und eingestellt werden: siehe **USB-Kabel** unten.

Eine gespeicherte Konfiguration enthält nie ein Geheimnis. Der private Schlüssel, Passwörter, Tokens und Schlüssel in einer Datei werden beim Import herausgenommen. Ist der Schlüsseltresor entsperrt, kommen sie in den Tresor, und die Konfiguration zeigt an ihrer Stelle **Geheimnis, im Tresor**. Ist der Tresor ausgeschaltet oder gesperrt, werden sie nicht aufbewahrt, und die Seite sagt dir, wie viele weggelassen wurden: entsperre den Tresor und importiere die Datei erneut, um sie aufzubewahren. Hat das Gerät einen öffentlichen Schlüssel und gehört der private Schlüssel in der Datei zu einem anderen, wird die Datei abgelehnt.

**Ansehen** zeigt eine Konfiguration nach Abschnitten. **Vergleichen** listet auf, was von einer anderen Konfiguration desselben Geräts abweicht; Geheimnisse werden anhand ihres Tresoreintrags verglichen und nie angezeigt. **Exportieren** speichert die Datei wieder ohne ihre Geheimnisse, unter dem Namen, den die Toolbox verwendet. **Mit Geheimnissen exportieren** gibt es, solange der Tresor entsperrt ist; es verlangt einen zweiten Klick und wird im Protokoll festgehalten. Diese Datei enthält die Geheimnisse im Klartext. Das Löschen einer Konfiguration lässt ihre Geheimnisse im Tresor. Das Löschen eines Geräts entfernt auch seine Konfigurationen.

**Was der Node gemeldet hat.** Eine geöffnete Konfiguration zeigt auch, wo sie von dem abweicht, was der Node zuletzt gemeldet hat. Die App schaut auf das, was sie für den Node mit dem öffentlichen Schlüssel des Geräts bereits gespeichert hat: die Repeater-Bereiche, die du dafür geöffnet hast (**Node-Info**, **Radioeinstellungen**, **Advert-Intervalle**, **Besitzerinfo**, **Regionen**), und seine SNMP-Abfragen. Verglichen werden der Name, die Position, die Funkwerte, die Sendeleistung, der Airtime-Faktor, Repeat, Flood Max, die Advert-Intervalle, die Besitzerinfo und die Heimatregion. Jeder Unterschied steht dort mit dem Bereich, aus dem er stammt, und wann das gespeichert wurde. Einstellungen ohne gespeicherten Wert werden genannt, damit du siehst, welchen Bereich du öffnen musst. Der Node wird hier nichts gefragt, ein gespeicherter Wert kann also älter sein als die aktuelle Einstellung des Nodes. Die Datei eines Companions und ein Gerät ohne öffentlichen Schlüssel haben nichts zum Vergleichen.

**Konfigurationsvorlagen.** **Als Vorlage speichern** bei einer geöffneten Konfiguration erstellt daraus eine Vorlage ohne den Namen, die Position und die Geheimnisse. **Konfigurationsvorlagen** auf der Seite Flotte listet sie auf. Eine Vorlage hat ein Dokument (JSON) und Variablen. Schreibe `{{name}}` in das Dokument, wo eine Variable stehen soll; `{{asset.label}}`, `{{asset.org_serial}}` und `{{asset.site_name}}` gibt es immer. Eine Variable ist Text, eine Zahl oder Ja oder Nein und kann einen Standardwert haben. Eine Vorlage enthält nie ein Geheimnis: lass einen solchen Schlüssel leer oder schreibe `{"$secret": null}`. Zurück auf der Seite eines Geräts fragt **Aus einer Vorlage erstellen** nach den Variablen und speichert das Ergebnis als Konfiguration **Gewünscht**.

**USB-Kabel.** Am Ende des Blocks Konfigurationen öffnet **Gerät verbinden** einen Repeater oder Room Server, der per USB an diesen PC angeschlossen ist. Dafür braucht es Chrome oder Edge und die App als `http://localhost:8000` auf diesem PC geöffnet (oder über HTTPS); schließe die Toolbox oder jedes andere Programm, das den Port nutzt. **Gerät lesen** zeigt Name, Rolle, Firmware, Board und öffentlichen Schlüssel und ob es dieses Gerät aus dem Register ist. **Als Momentaufnahme speichern** bewahrt die Einstellungen als Konfiguration auf, mit den Geheimnissen im Tresor wie bei einer importierten Datei. Ein Gerät ohne öffentlichen Schlüssel kann den des angeschlossenen Geräts bekommen, wenn du das ankreuzt. Um eine Konfiguration anzuwenden, wähle sie und drücke **Gerät lesen und die Änderungen zeigen**: die App liest das Gerät erneut und listet jede Abweichung, jeden Befehl in Reihenfolge und was sie auslässt und warum. Den privaten Schlüssel schreiben und das Funkmodul ändern (Frequenz, Bandbreite, SF, CR) brauchen jeweils ein eigenes Häkchen, das jedes Mal aus ist. Es wird nichts gesendet, bevor du ankreuzt, dass du die Befehle geprüft hast, und **Senden** drückst. Die Befehle gehen einzeln, jede Einstellung wird zurückgelesen, und das Anwenden stoppt bei der ersten Antwort, die nicht stimmt. Das Ergebnis kommt ins Protokoll des Geräts. Die App sendet nie `erase` oder `reboot` und ändert den Regionsbaum nicht; starte das Gerät selbst neu, wenn eine Einstellung das braucht. Nichts davon geht über das Funkgerät dieser App. Probiere es zuerst an einem Ersatzgerät, nicht an dem Funkgerät, auf dem die App läuft.

**Gerät in Betrieb nehmen.** Auf der Seite Flotte führt **Gerät in Betrieb nehmen** einen Repeater oder Room Server am USB-Kabel in einem Ablauf durch all das. Nach **Gerät lesen** findet es das Gerät im Register mit demselben öffentlichen Schlüssel oder bietet an, eines mit Name, Rolle und Board des angeschlossenen Geräts anzulegen. Ein neues Gerät kann seinen eigenen Schlüssel behalten oder einen neuen Schlüssel bekommen, der im Schlüsseltresor erzeugt wird (der Tresor muss entsperrt sein). Danach: die aktuellen Einstellungen als Momentaufnahme "vorher" speichern (nicht bei einem neuen Schlüssel, denn sie gehören zum alten Schlüssel), eine Vorlage wählen und ihre Variablen ausfüllen, die gewünschte Konfiguration mit derselben Übersicht, denselben Häkchen und derselben Bestätigung wie oben anwenden, **Gerät erneut lesen und vergleichen**, das Ergebnis speichern, und **Abschließen** setzt den Status (im Einsatz oder auf Lager) und schreibt einen Eintrag ins Protokoll. Setze bei einem neuen Schlüssel beim Anwenden **Auch den privaten Schlüssel schreiben**; das angeschlossene Gerät ist erst nach einem Neustart das neue Gerät, vergleiche also nach dem Neustart erneut.

### Paket-Feed

Eine Live-Liste aller Pakete, die das Funkgerät empfängt. Mit **Filter** (Pakettyp und Pfadbreite), Pause und Fortsetzen, automatischem Scrollen, älteste oder neueste zuerst, **Wiederholungen nach Inhalt gruppieren**, einem Hex-Filter, **Statistiken anzeigen** und einem optionalen Ton pro Paket (Geiger, Sonar oder Wassertropfen). Klicke auf ein Paket für eine Aufschlüsselung Byte für Byte. Jedes Paket zeigt Datum und Uhrzeit. Unter **Filter** blendet **Fehlerhafte ausblenden** Kanalnachrichten aus zufälligen Zeichen oder von einem Absender mit nie gestellter Uhr aus; deine Wahl wird in diesem Browser gemerkt.

Mit einem OpenHop-Funkgerät zeigt ein Paket auch die Richtlinienregel, die darüber entscheidet, zum Beispiel **Drop-Regel** gefolgt vom Namen der Regel, in Rot bei einem Drop. RTFM-EV ermittelt das anhand einer Kopie der Richtlinie des Knotens, es ist also ein Hinweis: Der Knoten selbst entscheidet, und eine auf dem Knoten geänderte Regel kann eine Minute auf sich warten lassen. Die Regel wird mit dem Paket gespeichert, die Zeile ist also auch nach dem Neuladen und im Paketverlauf noch da. Unter **Filter** lässt **Nur Pakete, über die eine Richtlinienregel entschied** alles andere weg.

### Paketverlauf

Dieselbe Art Liste über alles, was in der Datenbank gespeichert ist. Wähle 1, 3, 6, 12 oder 24 Stunden oder einen Datumsbereich und blättere mit **Ältere laden** zurück. Filtere nach Payload-Typ, Hop-Breite oder Hex und suche nach Nachrichtentext, Absender oder Kanal. Wähle Zeilen aus und nutze **CSV exportieren**.

Mit einem OpenHop-Funkgerät zeigen Pakete, die seit dem Update empfangen wurden, mit dem dies kam, auch die Richtlinienregel, die darüber entschied, wie im Paket-Feed. Die Suche findet ein Paket über den Namen dieser Regel, unter **Filter** gibt es **Nur Pakete, über die eine Richtlinienregel entschied**, und die CSV hat eine Spalte für die Aktion und eine für die Regel. Ein mehrfach gehörtes Paket wird einmal gespeichert, mit der Regel des ersten Empfangs. Wie weit der Verlauf zurückreicht, hängt von deinen Einstellungen zur Datenaufbewahrung ab.

### Paket analysieren

Füge ein Rohpaket als Hex ein, um es Byte für Byte entschlüsselt zu sehen.

### Wer hat das gehört

Jede Paketaufschlüsselung (aus dem Paket-Feed, dem Paketverlauf, einer Nachricht oder Paket analysieren) hat einen Abschnitt **Wer hat das gehört**. Er zeigt den Paket-Hash, der für jede weitergeleitete Kopie eines Pakets gleich ist, und einen Link zur Seite des Pakets auf jeder Analyzer-Seite, die du mit einer Paketadresse eingerichtet hast (Einstellungen > Datenbank).

**Fragen** sendet diesen Hash an den Analyzer, der als externe Kartenquelle eingestellt ist (standardmäßig meshcore-analyzer.eu), und listet die Observer dort auf, die das Paket empfangen haben, mit Region, Zeit, RSSI und SNR. So vergleichst du deinen eigenen Empfang mit dem Rest des Netzes. Es wird nichts gesendet, bis du die Schaltfläche drückst, und der Analyzer erhält den Hash, nicht das Paket. Er kennt nur, was seine eigenen Observer gehört haben; eine leere Antwort heißt also nicht, dass niemand das Paket gehört hat.

### Mesh-Visualisierung

Ein 3D-Graph des Mesh, aufgebaut aus Live-Paketen. Knoten sind Kugeln, Pakete sind animierte Bögen. Mit den Bedienelementen legst du fest, welche Knoten angezeigt werden und wie sich der Graph bewegt, und **Löschen & zurücksetzen** beginnt von vorn.

### Trace

Baue eine Schleife aus Repeatern und verfolge sie zurück zu deinem Funkgerät. Suche Repeater nach Name oder Schlüssel und füge sie in der Reihenfolge hinzu, in der sie durchlaufen werden sollen, oder füge einen eigenen Hop als Präfix mit 1, 2 oder 4 Bytes hinzu. Wähle dann **Trace senden**. Die Ergebnisse zeigen das SNR pro Hop und eine kleine Karte. Dabei wird über Funk gesendet.

### Nachrichtensuche

Volltextsuche in Direkt- und Kanalnachrichten. Mit `user:` oder `channel:` grenzt du die Ergebnisse ein (Namen mit Leerzeichen in Anführungszeichen setzen). `region:` filtert nach der Region, mit der eine Nachricht gesendet wurde: ein Regionsname, `region:none` für Nachrichten ohne Region oder `region:unknown` für eine Region, die diese App nicht benennen kann. Klicke auf ein Ergebnis, um zu dieser Nachricht zu springen.

### Channel Registry (Kanalregister)

Ein lokaler Katalog bekannter Kanäle. Es ist eine Nachschlageliste, nicht die Liste der Kanäle, die die App beobachtet. Du kannst Einträge hinzufügen, bearbeiten, filtern, importieren und exportieren, von einer externen Liste synchronisieren und mit **Zu Kanälen hinzufügen** einen Kanal beobachten. Private Einträge werden nie exportiert. In einem Kanal öffnet das Register-Symbol in der Kopfzeile (oder **Im Kanalregister bearbeiten** im Kanal-Infobereich) den Eintrag dieses Kanals direkt im Bearbeitungsmodus; fehlt er, wird er zuerst hinzugefügt.

### Kanalfinder

**Kanalfinder anzeigen** öffnet einen Bereich, der versucht, die Namen von Kanälen zu finden, für die du keinen Schlüssel hast, mit Wortlisten und Brute Force auf deiner GPU. Unter **Wortlisten** wählst du, welche Listen verwendet werden, in jeder Kombination: Englisch, Niederländisch, **Bekannte Kanäle (MCCL)** (eine kurze Liste mit Kanalnamen, die im Netz gesehen wurden, standardmäßig an) und selbst hochgeladene Listen. Das braucht einen Browser mit WebGPU (zum Beispiel Chrome oder Edge ab Version 113) und HTTPS, wenn du nicht auf `localhost` arbeitest. Gefundene Kanäle können gespeicherte Pakete entschlüsseln.

### Wissensdatenbank

Deine eigene Liste nützlicher Links, nach Kategorie gruppiert. **Link hinzufügen** legt einen neuen an; das X entfernt einen Link aus der Wissensdatenbank, lässt ihn aber unter Einstellungen > Praktische Infos > Links stehen. Dort nimmt das Buch-Symbol bei jedem Link (eingebaut oder eigen) ihn in die Wissensdatenbank auf oder entfernt ihn.

### Benutzerhandbuch

Diese Seite. Öffne sie unter Werkzeuge oder über die Adresse `#manual`. Sie folgt der Sprache der Oberfläche. Klicke auf eine Überschrift im Inhaltsverzeichnis, um zu diesem Kapitel zu springen.

<!-- id: settings -->

## Einstellungen

Öffne die Einstellungen mit der Schaltfläche in der oberen Leiste. Auf dem Telefon klappt jeder Abschnitt an Ort und Stelle auf.

### Radio

- **Verbindung:** Erneut verbinden und **Trennen**, das die automatische Wiederverbindung pausiert, damit ein anderes Gerät das Funkgerät nutzen kann. Hast du Loadouts, bietet Trennen an, vorher eines zu laden.
- **Identität:** Funkgerätename, privater Schlüssel (nur schreiben) und dein `meshcore://`-Kontaktlink.
- **Funkgeräte:** jedes Funkgerät, das mit dieser Installation verbunden war, mit erster und letzter Verbindungszeit, auch wenn kein Funkgerät verbunden ist. Das zuletzt verbundene ist mit **Aktuell** markiert. Ein Funkgerät mit **Antwort nötig** kannst du hier beantworten (siehe Funkgerät wechseln). Bei einem ersetzten Funkgerät kannst du ändern, was das neuere übernimmt, oder **Ersetzungsverknüpfung entfernen**. Jedes Funkgerät hat eine eigene Notiz (**Notiz speichern**). Jedes Funkgerät außer dem aktuellen lässt sich mit **Funkgerät entfernen** entfernen. Du musst das bestätigen und kannst ankreuzen, dass auch der Verlauf von Akku, Grundrauschen und Sendezeit dieses Funkgeräts gelöscht wird. Ohne Häkchen bleibt der Verlauf ohne Funkgerät erhalten und erscheint auf Mein Knoten unter "Vor der Funkgeräte-Erfassung". Kontakte, Nachrichten und Pakete bleiben unverändert.
- **Funkparameter:** Voreinstellung, Frequenz, Bandbreite, Spreading Factor, Coding Rate, Sendeleistung und Pfad-Hash-Modus (1, 2 oder 3 Bytes pro Hop, wenn die Firmware es unterstützt).
- **Standort**, Telemetrie-Freigabe und **Werbung & Erkennung** (Advert-Intervall und Schaltflächen zum Senden eines Adverts).
- **Nachrichten:** zusätzliche ACKs, **Unbeantwortete Kanalnachrichten automatisch erneut senden** und der Standard-Flood-Scope.
- Bekannte Regionen zum Dekodieren von Paketen mit Regions-Scope, einschließlich **Niederländische Bereiche laden**.
- **Max. Kontakte auf dem Funkgerät**, **Konfiguration exportieren** und **Importieren und neu starten**.
- **Erwähnungsticker anzeigen**, **Erwaehnte Kanaele automatisch zum Register hinzufuegen** und die **Externe Analyzer-Knotenebene**.
- Auf Meshcomod-Firmware (DMC-EV) ein Bereich **Meshcomod (DMC-EV)** mit CAD- und GPS-Einstellungen. Builds mit dem Empfangsfilter erhalten eine Karte **Companion-Empfangsfilter**: Filtereinstellungen, Absender- und Textregeln, blockierte Pfadpräfixe, Zähler ausgeblendeter Nachrichten mit Verlaufsdiagramm und eine Sicherung pro Funkgerät, die sich nach dem Flashen zurückspielen lässt. Es läuft auf dem Funkgerät und sendet nie.

### Host-Repeater

RTFM-EV kann jedes empfangene Paket so beurteilen, wie ein Repeater es tun würde. Der **Schattenmodus** zählt, was weitergeleitet oder verworfen würde, und leitet nie etwas weiter. Regionsfilter, ein Sendezeitbudget, Timing und Richtlinienregeln sind einstellbar, mit Live-Statistiken. Live-Wiederholen (scharfer Modus) braucht die Servereinstellung `MESHCORE_HOST_REPEATER_ENABLED=true`, unterstützte Firmware, ein zulässiges Frequenzband und eine ausdrückliche Bestätigung. **Entschärfen (Notaus)** stoppt es, und nach einem Neustart ist er immer entschärft. Stelle sicher, dass du an deinem Standort einen Repeater betreiben darfst. Der **DMC-Paketfilter** folgt der DMC-Observer-Firmware: Hop- und Ratenlimits, blockierte Kanäle und Pfad-Präfixe, Absender- und Textregeln, ein Advert-Fenster pro Node, ein maximales Nachrichtenalter und ein **Probelauf**-Schalter, der nur zählt. Die optionale **Nachbarabfrage** sendet: alle 12-336 Stunden ein Zero-Hop-Discover und eine Regionsanfrage an jeden benachbarten Repeater.

### Lokale Konfiguration

Einstellungen für diesen Browser oder dieses Gerät: Sprache, Farbthema (einschließlich vier CRT-Phosphor-Themen) und CRT-Bildschirmeffekte, der **Desktop-Assistent** (nachdem du das Design Windows 95 benutzt hast), Branding (App-Name und Symbol, von allen Geräten geteilt), ein lokales Label, **Entfernungseinheiten**, **Koordinatenformat**, **Datums- und Zeitformat**, relative Schriftgröße, UI-Anpassungen (etwa letzte Unterhaltung erneut öffnen, Akkuanzeige und **Beim Tippen ersetzen**), der Ton bei Erwähnungen und DMs, Benachrichtigungen für neue Knoten, **Chat-Erkennung** und **Web-Push-Benachrichtigungen**. **Weiterleitung zur Anmeldung** ist für eine Instanz hinter einem Reverse Proxy, der die Anmeldung übernimmt: Ist die Sitzung abgelaufen, wechselt die App zu der eingetragenen Adresse oder lädt die Seite neu, wenn das Feld leer ist.

### Botlisten

Eine Botliste nennt bekannte Bots: einen exakten Absendernamen, dazu optional einen öffentlichen Schlüssel und eine Notiz. Die Listen stehen unter **Einstellungen > Lokale Konfiguration > Botlisten**.

- **Aktiviere** eine Liste, und ihre Absender bekommen im Chat eine **Bot**-Markierung. Ein Name muss exakt stimmen, Großschreibung eingeschlossen; wer denselben Namen benutzt, wird also ebenfalls markiert. **Nie ein Bot** nimmt einen Namen aus, egal auf welcher Liste er steht.
- **Bots ausblenden** (dort oder im Filtermenü des Chats) blendet gelistete Absender im Chat aus und hält sie aus Ungelesen-Zählern, Erwähnungen und Benachrichtigungen heraus. Die Suche zeigt sie weiterhin.
- **Neue Liste** legt eine eigene Liste an, und **Namen** öffnet sie zum Bearbeiten. Im Chat bieten die Aktionen einer Nachricht **Zur Botliste hinzufügen** und, für einen gelisteten Namen, **Kein Bot**.
- **Exportieren** schreibt eine Liste in eine Datei. **Datei importieren** speichert eine solche Datei als neue eigene Liste, deaktiviert, damit du sie lesen kannst, bevor du sie aktivierst.
- **URL abonnieren** nimmt die `https`-Adresse einer Listendatei. Die Liste wird erst angezeigt, dann schreibgeschützt und deaktiviert gespeichert und einmal am Tag aktualisiert; **Jetzt aktualisieren** macht das sofort. Der Host der Liste sieht bei jeder Aktualisierung deine Internetadresse. Schlägt eine Aktualisierung fehl, bleiben die vorhandenen Namen erhalten, und der Grund wird angezeigt.
- Eine Liste wird mit RTFM-EV ausgeliefert. Sie ist schreibgeschützt und aus, bis du sie aktivierst.
- **Weiterleitung blockieren** (pro Liste, standardmäßig aus) sorgt dafür, dass dein Repeater Kanalnachrichten der Namen dieser Liste nicht mehr weiterleitet. Es läuft über Spam Guard: nur im Modus **Schützen**, auf den geschützten Kanälen, und auf Sendung nur, solange der Host-Repeater scharf ist oder die Regeln auf dem OpenHop-Node liegen. Die Zeile unter dem Schalter sagt **Aktiv auf N Kanälen** oder worauf gewartet wird.
- Namen, die eine Aktualisierung zu einem Abonnement hinzufügt, werden im Chat sofort markiert, aber dein Repeater leitet sie erst dann nicht mehr weiter, wenn du sie bestätigt hast. Die Liste zeigt dann **N neue Namen zu prüfen**, mit **Bestätigen**, **Alle bestätigen** und **Kein Bot**. Wer Weiterleitung blockieren für ein Abonnement einschaltet, sieht zuerst dessen Namen.

Weiterleitung blockieren hält nur deinen eigenen Repeater auf: Andere Repeater leiten die Nachricht weiterhin weiter, und sie kommt weiterhin bei deinem Node an. Es gilt nur für Kanalnachrichten, denn ein Repeater kann nicht sehen, wer eine Direktnachricht geschickt hat. Wer unter einem gelisteten Namen schreibt, wird ebenfalls aufgehalten.

### MQTT & Automatisierung

Integrationen (siehe Integrationen).

### OpenHop

Nur sichtbar, wenn der verbundene Knoten ein OpenHop-Knoten ist. Lege Adresse und Token der OpenHop-API fest und verwalte dann Konfiguration, System, Updates, Richtlinien und Plugins. Aktionen mit echten Auswirkungen fragen nach einer Bestätigung.

### Radio-App-Verwaltung

**Verfolgte Repeater-Telemetrie** und **Verfolgte Kontakt-Telemetrie**, Namensauflösung für unbenannte Kontakte, **Kontaktverwaltung** (neue Knotentypen blockieren, blockierte Schlüssel und Namen, Massenlöschen), **Loadouts** und **Teilbekannte Knoten synchronisieren**, das Knoten, die du nur über ein Präfix kennst, mit dem Knotenverzeichnis des Analyzers abgleicht. Du prüfst jeden Treffer, bevor er als umkehrbare weiche Verknüpfung gespeichert wird. Telemetrie wird einmal pro Stunde erfasst, zur **Minute der Stunde**, die du unter Verfolgte Repeater-Telemetrie einstellst. **Automatisch** leitet eine Minute aus dem Schlüssel deines Funkgeräts ab; gib Knoten, die nah beieinander stehen, unterschiedliche Minuten, damit ihre Anfragen nicht gleichzeitig gesendet werden.

**SNMP-Agent** (standardmäßig aus) lässt ein Monitoring-System wie LibreNMS oder Zabbix diesen Node per SNMP abfragen, mit denselben Werten wie die Observer-Firmware. Stelle den UDP-Port und eine eigene Community ein; veröffentliche in Docker auch den Port. Der Agent ist nur lesend und nutzt das Funkgerät nie.

### Karte

Die Startansicht der Karte und der **Kartenkachel-Cache** (siehe Sicherung, Wiederherstellung und Datenaufbewahrung).

### Datenbank

Datenbankübersicht, Speicherbereinigung, **Datenaufbewahrung**, Sicherung und Wiederherstellung sowie Synchronisationsadressen für das Kanalregister, die Wortliste des Kanalfinders und externe Analyzer.

### Praktische Infos

**Einrichten** listet externe Knoten-Analyzer und Synchronisationsquellen auf. Die Namensauflösung über einen Analyzer sendet pro Abfrage nur einen öffentlichen Schlüssel, und nur, wenn du auf eine Schaltfläche drückst. **Links** enthält nützliche Nachschlageseiten; mit dem Buch-Symbol bei einem Link erscheint er unter Werkzeuge > Wissensdatenbank.

### Über

Version, Links zum Changelog und zum Melden von Fehlern, eine Update-Prüfung und **Debug-Support-Snapshot öffnen**.

<!-- id: integrations -->

## Integrationen

Öffne **Einstellungen > MQTT & Automatisierung** und wähle **Integration hinzufügen**. Arten:

- **Privates MQTT:** Nachrichten an deinen eigenen Broker weiterleiten, roh und/oder entschlüsselt. Entschlüsselte Nachrichten gehen im Klartext hinaus, nutze also einen Broker, dem du vertraust.
- **Community MQTT/meshcoretomqtt:** ein Feed roher Pakete für Community-Aggregatoren, sodass dein Funkgerät als Beobachter dienen kann. Regionale Voreinstellungen sind eingebaut.
- **Home Assistant MQTT Discovery:** Geräte und Entitäten erscheinen automatisch in Home Assistant: ein Gerät für das lokale Funkgerät, ein Nachrichtenereignis, Telemetriesensoren für verfolgte Repeater und GPS-Tracker für ausgewählte Kontakte. Repeater müssen erst für Telemetrie verfolgt werden, bevor sie in der Auswahl erscheinen.
- **Webhook:** entschlüsselte Nachrichten an eine URL, optional signiert.
- **Apprise:** leitet Nachrichten an Discord, Telegram, E-Mail und viele weitere Dienste weiter.
- **Amazon SQS:** rohe oder entschlüsselte Pakete an eine Warteschlange.
- **Karten-Upload:** lädt gehörte Repeater und Room-Server zu map.meshcore.io oder einem kompatiblen Endpunkt hoch, mit Probelauf und optionalem Geofence.

Jede Integration hat einen **Nachrichtenumfang**: alle Nachrichten, keine, nur die aufgeführten Kanäle und Kontakte oder alle außer den aufgeführten.

<!-- id: backup-retention -->

## Sicherung, Wiederherstellung und Datenaufbewahrung

Alle Daten liegen in einer SQLite-Datenbank (standardmäßig `data/meshcore.db`). Verwaltet wird sie unter **Einstellungen > Datenbank**.

### Sicherung

- **Sicherung herunterladen** speichert einen konsistenten Schnappschuss in deinem Browser, auch während die App läuft.
- **Sicherungen auch in einem Serverpfad speichern** schreibt denselben Schnappschuss in einen Ordner auf dem Server. **Jetzt auf Server sichern** tut das sofort.
- **Automatisch in den Serverpfad sichern** erstellt alle N Stunden eine Sicherung und behält die neuesten N Dateien. Nur automatische Sicherungen werden rotiert.

### Wiederherstellung

Wähle eine Datei oder drücke **Wiederherstellen** neben einer Datei unter **Sicherungen auf dem Server**. Die Datei wird geprüft und bereitgestellt, und nichts ändert sich, bis du den Server neu startest. Bis dahin verwirft **Wiederherstellung abbrechen** sie. Beim nächsten Start wird die aktuelle Datenbank als Pre-Restore-Datei gesichert und die Sicherung eingesetzt. Zum Rückgängigmachen stellst du die Pre-Restore-Datei auf dieselbe Weise wieder her. Eine Wiederherstellung ersetzt alles, was nach dem Erstellen der Sicherung aufgezeichnet wurde.

### Datenaufbewahrung

**Datenaufbewahrung** legt fest, wie viele Tage jede Art von Verlauf behalten wird; `0` behält ihn für immer. Das betrifft Rohpakete, Nachrichten, Adverts, Telemetrie, Verbindungs- und Relaydaten, Geräteverlauf, Rauschpegel, Akku, Sendezeit und Advert-Pfade.

- Die Bereinigung läuft etwa eine Minute nach dem Start und danach nach Zeitplan. **Jetzt bereinigen** startet sie sofort.
- Ein niedrigerer Wert löscht ältere Daten beim nächsten Lauf. Ein höherer Wert holt gelöschte Daten nicht zurück.
- Wird eine Nachricht bereinigt, verschwindet auch ihr Rohpaket.
- **Alles behalten (Analyzer)** setzt jede Grenze auf 0. **Standardwerte wiederherstellen** stellt die Standardgrenzen wieder her.

### Kartenkachel-Cache und Loadouts

- **Kartenkachel-Cache** (Einstellungen > Karte, standardmäßig aus) lässt den Server angesehene Kartenkacheln zwischenspeichern, sodass diese Gebiete offline funktionieren. Esri-Kacheln werden nie zwischengespeichert.
- **Loadouts** (Radio-App-Verwaltung) sind benannte Gruppen von Kanälen und Kontakten. **Aufs Funkgerät laden** fügt nur hinzu, entfernt nie etwas und meldet das Ergebnis pro Eintrag. Es wird nichts gesendet. Die App ordnet das Funkgerät bei der nächsten Wiederverbindung oder vollständigen Synchronisierung neu, lade ein Loadout also direkt bevor du trennst.

<!-- id: troubleshooting -->

## Fehlerbehebung

**Die Seite ist leer oder veraltet nach einem Update.** Der Server liefert das gebaute Frontend aus. Baue das Frontend nach dem Update neu und lade die Seite neu.

**Nachrichten bleiben auf dem Funkgerät und erscheinen nie.** Starte den Server mit `MESHCORE_ENABLE_MESSAGE_POLL_FALLBACK=true`, das das Funkgerät alle 10 Sekunden abfragt.

**Warnung, dass die automatische DM-Bestätigung eventuell nicht für alle Kontakte funktioniert.** Die Kontakttabelle des Funkgeräts ist voll oder konnte nicht gelesen werden. Senden und Empfangen funktionieren weiterhin. Senke **Max. Kontakte auf dem Funkgerät**, oder leere die Kontakttabelle des Funkgeräts mit einem anderen MeshCore-Client und starte neu.

**MQTT verbindet sich unter Windows nicht.** Starte den Server mit `--loop none`.

**Der Kanalfinder meldet, dass WebGPU nicht verfügbar ist.** Nutze Chrome oder Edge ab Version 113, über HTTPS, sofern du nicht auf `localhost` arbeitest.

**Web Push funktioniert nicht.** Push braucht HTTPS. Setze für iOS und Safari `MESHCORE_VAPID_SUBJECT` auf eine echte `mailto:`-Adresse.

**Eine Nachricht zeigt Fehlgeschlagen.** Nach allen Versuchen kam keine Bestätigung. Nutze **Erneut versuchen**, um eine neue Kopie zu senden.

**Einen Fehler melden.** Starte den Server mit `MESHCORE_LOG_LEVEL=DEBUG` und nutze **Debug-Support-Snapshot öffnen** unter Einstellungen > Über. Logs können Kanalnamen oder Schlüssel enthalten (nie deinen privaten Schlüssel), prüfe also, was du teilst.
