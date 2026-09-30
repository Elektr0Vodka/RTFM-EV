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
- **Nutze die App nur in einem vertrauenswürdigen Netzwerk.** Es gibt keine Benutzerkonten. Wer die Seite erreicht, kann sie benutzen. Die optionale HTTP-Basic-Authentifizierung ist nur eine grobe Hürde und gehört immer zusammen mit HTTPS. Bots führen beliebigen Python-Code aus, deshalb ist das Botsystem standardmäßig aus.

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

### Sprache und Design

Die Oberfläche gibt es auf Englisch, Niederländisch und Deutsch. Die Sprache wechselst du über das Sprachmenü in der oberen Leiste (Flagge und Sprachkürzel) oder unter **Einstellungen > Lokale Konfiguration**. Die Wahl wird pro Browser gespeichert. Das Sonnen- oder Mondsymbol in der oberen Leiste öffnet die Designauswahl.

<!-- id: layout -->

## Der Aufbau

### Obere Leiste

Von links nach rechts zeigt die obere Leiste den App-Namen, den Verbindungsstatus als Punkt, ein Abzeichen **Wiederholt**, solange der Host-Repeater scharf ist, und den Akku des Funkgeräts, wenn du ihn in **Einstellungen > Lokale Konfiguration** einschaltest. Auf breiten Bildschirmen siehst du außerdem ein kleines Diagramm der aktuellen Paketrate, den Verbindungsstatus als Text sowie den Funkgerätenamen mit dem kurzen öffentlichen Schlüssel (klicke auf den Schlüssel, um den vollständigen Schlüssel zu kopieren). Ist das Funkgerät getrennt oder pausiert, erscheint eine Schaltfläche **Erneut verbinden** oder **Verbinden**. Danach folgen die Schaltfläche **Einstellungen** (ein Punkt darauf bedeutet, dass eine neuere Version verfügbar ist), das Sprachmenü und die Design-Schaltfläche.

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

### Unterhaltungsbereich

Die große Fläche rechts zeigt, was du ausgewählt hast: einen Chat, eine Kontaktseite, ein Repeater-Dashboard oder ein Werkzeug. Die Adresse im Browser folgt der Ansicht (zum Beispiel `#map` oder `#settings/radio`), sodass du Ansichten als Lesezeichen speichern kannst. Mit **Letzte Unterhaltung erneut öffnen** (Einstellungen > Lokale Konfiguration) öffnet die reine Adresse deinen letzten Chat wieder.

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
- Links zu eingerichteten Analyzern, **Triangulieren** und das Blockieren von Schlüssel oder Namen.

Favorisierte Kontakte bleiben auf dem Funkgerät geladen, damit es ihre Direktnachrichten bestätigen kann.

### Routing-Override

Klicke auf die Routenangabe neben dem Namen eines Kontakts (zum Beispiel die Hop-Anzahl oder "flood"), um **Routing-Override** zu öffnen. Du kannst Flood erzwingen, Direkt erzwingen oder einen festen Pfad aus kommagetrennten Hop-IDs mit 1, 2 oder 3 Bytes eingeben. Lösche den Override, um zur gelernten Route zurückzukehren. Der letzte Versuch einer unbestätigten Direktnachricht wird immer als Flood gesendet.

### Repeater

Beim Öffnen eines Repeaters erscheint ein Anmeldeformular: melde dich mit dem Passwort oder als Gast an. Das Dashboard hat dann Bereiche für Node-Info, Telemetrie, Radioeinstellungen (mit Advert-Intervallen), LPP-Sensoren, Nachbarn, ACL, Regionen und Besitzerinfo, dazu Aktionen (Zero-Hop-Advert, Flood-Advert, Uhr synchronisieren, Neustart), eine Konsole mit CLI-Zugang, den Telemetrieverlauf und einen Bereich Verlauf, der zeigt, was sich zwischen gespeicherten Momentaufnahmen geändert hat. **Alles laden** ruft alle Bereiche nacheinander ab.

Mit Einstellungen bearbeiten änderst du jeweils eine Repeater-Einstellung: du bearbeitest, bestätigst den genauen CLI-Befehl, er wird über Funk gesendet, und der Wert wird zur Kontrolle zurückgelesen. Für Änderungen an Frequenz, Bandbreite, Spreading Factor oder Coding Rate musst du zuerst den Namen des Repeaters eintippen, weil ein falscher Wert ihn vom Netz nehmen kann.

### Room-Server

Auch Room-Server haben eine Anmeldung mit Passwort oder als Gast, mit Telemetrie, ACL, Sensordaten, einer CLI-Konsole und einem Verlauf der ACL-Änderungen.

### Telemetrie

- Bei einem Kontakt, der kein Repeater ist, ruft **Anfordern** die Sensorwerte bei Bedarf ab, mit Verlaufsdiagrammen.
- Unter **Einstellungen > Radio-App-Verwaltung** kannst du Repeater und bis zu 8 weitere Kontakte für die planmäßige Abfrage verfolgen. Um den Mesh-Verkehr zu begrenzen, teilen sich alle verfolgten Knoten eine Obergrenze von 24 Abfragen pro Tag. Mehr verfolgte Knoten bedeuten also ein längeres Intervall.

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

### Mesh-Trends

**Historisch** zeigt gespeicherte Auswertungen: Netzwerk, Nachrichten, Aktivität, die aktivsten Kanäle, Pakete pro Stunde, Pfad-Hash-Breite, Regions-Scope, Rauschpegel und MQTT-Broker-Statistiken. **Live · diese Sitzung** zeigt Paketstatistiken. Die kurzen Zeitfenster (1, 5 und 10 Minuten sowie diese Sitzung) stammen aus deinem Browser; längere Zeitfenster werden aus der Datenbank berechnet.

### Mesh-Erkennung

**Repeater ermitteln**, **Sensoren ermitteln** oder **Beide ermitteln** sendet eine kurze Erkennungsanfrage über Funk und listet die Knoten auf, die antworten. **Regionen ermitteln** fragt Repeater in der Nähe, welche Regionen sie fluten, damit du sie zu deinen bekannten Regionen hinzufügen kannst.

### Paket-Feed

Eine Live-Liste aller Pakete, die das Funkgerät empfängt. Mit **Filter** (Pakettyp und Pfadbreite), Pause und Fortsetzen, automatischem Scrollen, älteste oder neueste zuerst, **Wiederholungen nach Inhalt gruppieren**, einem Hex-Filter, **Statistiken anzeigen** und einem optionalen Ton pro Paket (Geiger, Sonar oder Wassertropfen). Klicke auf ein Paket für eine Aufschlüsselung Byte für Byte.

### Paketverlauf

Dieselbe Art Liste über alles, was in der Datenbank gespeichert ist. Wähle 1, 3, 6, 12 oder 24 Stunden oder einen Datumsbereich und blättere mit **Ältere laden** zurück. Filtere nach Payload-Typ, Hop-Breite oder Hex und suche nach Nachrichtentext, Absender oder Kanal. Wähle Zeilen aus und nutze **CSV exportieren**. Wie weit der Verlauf zurückreicht, hängt von deinen Einstellungen zur Datenaufbewahrung ab.

### Paket analysieren

Füge ein Rohpaket als Hex ein, um es Byte für Byte entschlüsselt zu sehen.

### Mesh-Visualisierung

Ein 3D-Graph des Mesh, aufgebaut aus Live-Paketen. Knoten sind Kugeln, Pakete sind animierte Bögen. Mit den Bedienelementen legst du fest, welche Knoten angezeigt werden und wie sich der Graph bewegt, und **Löschen & zurücksetzen** beginnt von vorn.

### Trace

Baue eine Schleife aus Repeatern und verfolge sie zurück zu deinem Funkgerät. Suche Repeater nach Name oder Schlüssel und füge sie in der Reihenfolge hinzu, in der sie durchlaufen werden sollen, oder füge einen eigenen Hop als Präfix mit 1, 2 oder 4 Bytes hinzu. Wähle dann **Trace senden**. Die Ergebnisse zeigen das SNR pro Hop und eine kleine Karte. Dabei wird über Funk gesendet.

### Nachrichtensuche

Volltextsuche in Direkt- und Kanalnachrichten. Mit `user:` oder `channel:` grenzt du die Ergebnisse ein (Namen mit Leerzeichen in Anführungszeichen setzen). Klicke auf ein Ergebnis, um zu dieser Nachricht zu springen.

### Channel Registry (Kanalregister)

Ein lokaler Katalog bekannter Kanäle. Es ist eine Nachschlageliste, nicht die Liste der Kanäle, die die App beobachtet. Du kannst Einträge hinzufügen, bearbeiten, filtern, importieren und exportieren, von einer externen Liste synchronisieren und mit **Zu Kanälen hinzufügen** einen Kanal beobachten. Private Einträge werden nie exportiert. In einem Kanal öffnet das Register-Symbol in der Kopfzeile (oder **Im Kanalregister bearbeiten** im Kanal-Infobereich) den Eintrag dieses Kanals direkt im Bearbeitungsmodus; fehlt er, wird er zuerst hinzugefügt.

### Kanalfinder

**Kanalfinder anzeigen** öffnet einen Bereich, der versucht, die Namen von Kanälen zu finden, für die du keinen Schlüssel hast, mit Wortlisten und Brute Force auf deiner GPU. Das braucht einen Browser mit WebGPU (zum Beispiel Chrome oder Edge ab Version 113) und HTTPS, wenn du nicht auf `localhost` arbeitest. Gefundene Kanäle können gespeicherte Pakete entschlüsseln.

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
- **Funkgeräte:** jedes Funkgerät, das mit dieser Installation verbunden war, mit erster und letzter Verbindungszeit, auch wenn kein Funkgerät verbunden ist. Das zuletzt verbundene ist mit **Aktuell** markiert. Ein Funkgerät mit **Antwort nötig** kannst du hier beantworten (siehe Funkgerät wechseln). Bei einem ersetzten Funkgerät kannst du ändern, was das neuere übernimmt, oder **Ersetzungsverknüpfung entfernen**. Jedes Funkgerät hat eine eigene Notiz (**Notiz speichern**).
- **Funkparameter:** Voreinstellung, Frequenz, Bandbreite, Spreading Factor, Coding Rate, Sendeleistung und Pfad-Hash-Modus (1, 2 oder 3 Bytes pro Hop, wenn die Firmware es unterstützt).
- **Standort**, Telemetrie-Freigabe und **Werbung & Erkennung** (Advert-Intervall und Schaltflächen zum Senden eines Adverts).
- **Nachrichten:** zusätzliche ACKs, **Unbeantwortete Kanalnachrichten automatisch erneut senden** und der Standard-Flood-Scope.
- Bekannte Regionen zum Dekodieren von Paketen mit Regions-Scope, einschließlich **Niederländische Bereiche laden**.
- **Max. Kontakte auf dem Funkgerät**, **Konfiguration exportieren** und **Importieren und neu starten**.
- **Erwähnungsticker anzeigen**, **Erwaehnte Kanaele automatisch zum Register hinzufuegen** und die **Externe Analyzer-Knotenebene**.
- Auf Meshcomod-Firmware (DMC-EV) ein Bereich **Meshcomod (DMC-EV)** mit CAD- und GPS-Einstellungen.

### Host-Repeater

RTFM-EV kann jedes empfangene Paket so beurteilen, wie ein Repeater es tun würde. Der **Schattenmodus** zählt, was weitergeleitet oder verworfen würde, und leitet nie etwas weiter. Regionsfilter, ein Sendezeitbudget, Timing und Richtlinienregeln sind einstellbar, mit Live-Statistiken. Live-Wiederholen (scharfer Modus) braucht die Servereinstellung `MESHCORE_HOST_REPEATER_ENABLED=true`, unterstützte Firmware, ein zulässiges Frequenzband und eine ausdrückliche Bestätigung. **Entschärfen (Notaus)** stoppt es, und nach einem Neustart ist er immer entschärft. Stelle sicher, dass du an deinem Standort einen Repeater betreiben darfst. Der **DMC-Paketfilter** folgt der DMC-Observer-Firmware: Hop- und Ratenlimits, blockierte Kanäle und Pfad-Präfixe, Absender- und Textregeln, ein Advert-Fenster pro Node, ein maximales Nachrichtenalter und ein **Probelauf**-Schalter, der nur zählt. Die optionale **Nachbarabfrage** sendet: alle 12-336 Stunden ein Zero-Hop-Discover und eine Regionsanfrage an jeden benachbarten Repeater.

### Lokale Konfiguration

Einstellungen für diesen Browser oder dieses Gerät: Sprache, Farbthema (einschließlich vier CRT-Phosphor-Themen) und CRT-Bildschirmeffekte, Branding (App-Name und Symbol, von allen Geräten geteilt), ein lokales Label, **Entfernungseinheiten**, **Koordinatenformat**, **Datums- und Zeitformat**, relative Schriftgröße, UI-Anpassungen (etwa letzte Unterhaltung erneut öffnen, Akkuanzeige und **Beim Tippen ersetzen**), der Ton bei Erwähnungen und DMs, Benachrichtigungen für neue Knoten, **Chat-Erkennung** und **Web-Push-Benachrichtigungen**.

### MQTT & Automatisierung

Integrationen (siehe Integrationen).

### OpenHop

Nur sichtbar, wenn der verbundene Knoten ein OpenHop-Knoten ist. Lege Adresse und Token der OpenHop-API fest und verwalte dann Konfiguration, System, Updates, Richtlinien und Plugins. Aktionen mit echten Auswirkungen fragen nach einer Bestätigung.

### Radio-App-Verwaltung

**Verfolgte Repeater-Telemetrie** und **Verfolgte Kontakt-Telemetrie**, Namensauflösung für unbenannte Kontakte, **Kontaktverwaltung** (neue Knotentypen blockieren, blockierte Schlüssel und Namen, Massenlöschen), **Loadouts** und **Teilbekannte Knoten synchronisieren**, das Knoten, die du nur über ein Präfix kennst, mit dem Knotenverzeichnis des Analyzers abgleicht. Du prüfst jeden Treffer, bevor er als umkehrbare weiche Verknüpfung gespeichert wird.

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
- **Python-Bot:** kleine Python-Funktionen, die auf Nachrichten antworten.
- **Webhook:** entschlüsselte Nachrichten an eine URL, optional signiert.
- **Apprise:** leitet Nachrichten an Discord, Telegram, E-Mail und viele weitere Dienste weiter.
- **Amazon SQS:** rohe oder entschlüsselte Pakete an eine Warteschlange.
- **Karten-Upload:** lädt gehörte Repeater und Room-Server zu map.meshcore.io oder einem kompatiblen Endpunkt hoch, mit Probelauf und optionalem Geofence.

Jede Integration hat einen **Nachrichtenumfang**: alle Nachrichten, keine, nur die aufgeführten Kanäle und Kontakte oder alle außer den aufgeführten.

Bots sind standardmäßig deaktiviert. Um sie einzuschalten, starte den Server mit `MESHCORE_DISABLE_BOTS=false`. Ein Bot führt beliebigen Python-Code auf dem Server aus und sieht alle Nachrichten, auch deine eigenen, achte also auf Antwortschleifen.

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
