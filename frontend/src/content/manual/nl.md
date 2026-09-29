<!-- id: overview -->

## Overzicht

RTFM-EV is een webinterface voor MeshCore-meshradio's. Een kleine server maakt verbinding met je companion-radio (via Serial, TCP of BLE) en je gebruikt hem vanuit elke browser in je netwerk. Het is een fork van RemoteTerm: alles wat RemoteTerm als live terminal voor een radio doet blijft behouden, en er komt een langer geheugen bij. De serverdatabase is de bron van waarheid, dus een radio die verbonden blijft bouwt een lokale geschiedenis van de mesh op die je kunt doorbladeren en analyseren.

Wat je ermee kunt:

- Directe berichten en kanaalberichten versturen en ontvangen, met reacties, antwoorden, emoji en het delen van locaties.
- Meer contacten en kanalen bijhouden dan de radio kan opslaan. Pakketten worden op de server ontsleuteld, dus de limieten van de radio gelden niet voor wat je kunt volgen.
- Repeaters en roomservers beheren vanuit een dashboard.
- De mesh verkennen met een kaart, een pakketvisualisatie, gezondheids- en trendoverzichten en een doorzoekbare pakketgeschiedenis.
- Gegevens doorsturen naar MQTT, Home Assistant, webhooks en meer.

Twee dingen om vooraf te weten:

- **De app beheert je radio.** Zodra een radio verbonden is, worden de contacten en kanalen in de app geïmporteerd en bepaalt de app welke contacten op de radio geladen blijven. Daardoor past de app minder goed als je vaak van radio wisselt en elke radio zijn eigen toestand wilt laten houden.
- **Gebruik de app alleen op een vertrouwd netwerk.** Er zijn geen gebruikersaccounts. Iedereen die de pagina kan bereiken, kan hem gebruiken. De optionele HTTP Basic-authenticatie is slechts een grove drempel en hoort altijd samen te gaan met HTTPS. Bots voeren willekeurige Python-code uit, daarom staat het botsysteem standaard uit.

<!-- id: getting-started -->

## Aan de slag

### Je radio verbinden

De server maakt verbinding met één radio via precies één verbindingstype. Dat kies je met omgevingsvariabelen bij het starten van de server:

- **Serieel (USB):** `MESHCORE_SERIAL_PORT`. `MESHCORE_SERIAL_BAUDRATE` is standaard 115200.
- **TCP:** `MESHCORE_TCP_HOST` en `MESHCORE_TCP_PORT` (standaard 5000).
- **BLE:** `MESHCORE_BLE_ADDRESS` en `MESHCORE_BLE_PIN` (de pincode is verplicht bij BLE).

Stel je geen van deze in, dan zoekt de server zelf naar een radio op de seriële poorten. Stel je meer dan één verbindingstype in, dan weigert de server te starten.

Open de app op `http://localhost:8000` (of het adres en de poort waarop de server draait). De bovenbalk laat zien of de radio verbonden is.

Let op:

- Gebruik je een MQTT-integratie op Windows, start de server dan met `--loop none`, anders mislukken MQTT-verbindingen.
- Web Push en de kanaalzoeker hebben HTTPS nodig wanneer je niet op `localhost` werkt.
- Docker wordt ondersteund, maar native draaien wordt aangeraden omdat er problemen met seriële verbindingen in containers gemeld zijn.

### De eerste keer

Bij de eerste verbinding importeert de app de contacten en kanalen van de radio en begint hij elk gehoord pakket op te slaan. Berichten komen direct binnen. Contacten verschijnen zodra hun adverts gehoord worden, dus geef het op een drukke mesh een paar minuten.

Goede eerste stappen:

1. Open **Instellingen > Radio** en controleer de naam, de radioparameters en de locatie.
2. Voeg de kanalen toe die je gebruikt (zie Berichten).
3. Open **Nodekaart** en **Meshgezondheid** zodra er wat verkeer gehoord is.

### Taal en thema

De interface is beschikbaar in het Engels, Nederlands en Duits. Wissel van taal met het taalmenu in de bovenbalk (vlag en taalcode) of onder **Instellingen > Lokale configuratie**. De keuze wordt per browser bewaard. Het zon- of maanpictogram in de bovenbalk opent de themakiezer.

<!-- id: layout -->

## De indeling

### Bovenbalk

Van links naar rechts toont de bovenbalk de appnaam, het statuslampje van de verbinding, een badge **Herhaalt** zolang de host-repeater gewapend is, en de batterij van de radio als je die inschakelt in **Instellingen > Lokale configuratie**. Op brede schermen zie je ook een grafiekje met het live pakkettempo, de verbindingsstatus in tekst, en de radionaam met de korte publieke sleutel (klik op de sleutel om de volledige sleutel te kopiëren). Als de radio niet verbonden of gepauzeerd is, verschijnt een knop **Opnieuw verbinden** of **Verbinden**. Daarna volgen de knop **Instellingen** (een stip erop betekent dat er een nieuwere versie is), het taalmenu en de themaknop.

Op smalle schermen opent een menuknop helemaal links de zijbalk.

### Zijbalk

De zijbalk is de hoofdnavigatie. De secties, in de standaardvolgorde:

- **Hulpmiddelen:** de analyse- en hulpweergaven (zie Hulpmiddelen).
- **Favorieten:** favoriete kanalen en contacten, verdeeld over Favoriete kanalen, Favoriete companions, Favoriete repeaters, Favoriete roomservers en Favoriete sensoren.
- **Eigen nodes:** contacten waarvan je eigen radio de eigenaar is. Alleen zichtbaar als er minstens één is.
- **Kanalen:** je kanalen. Een pictogram naast de kop opent het importeren en exporteren van kanalen.
- **Contacten:** alle contacten, met filterknoppen voor Alle, Companions, Sensoren, Repeaters en Roomservers.
- De **Contactgroepen** die je zelf aanmaakt.

Elke sectie kun je in- en uitklappen. Sorteerknoppen in de koppen wisselen tussen recente activiteit en alfabetische volgorde. Aantallen ongelezen berichten en vermeldingen staan bij de rijen, en **Alles als gelezen markeren** wist ze allemaal. Het zoekvak filtert kanalen en contacten op naam. De zijbalk kan inklappen tot een smalle balk met pictogrammen.

**Kanaal/Contact toevoegen** bovenaan opent het venster Nieuw gesprek.

### De zijbalk aanpassen

Met de knop **Zijbalk aanpassen** (naast Kanaal/Contact toevoegen) kun je:

- Secties, hulpmiddelen en favorietengroepen herschikken (Sectievolgorde, Gereedschapsvolgorde, Favorietenvolgorde).
- Een sectie of hulpmiddel verbergen (**Verbergen uit zijbalk** / **Tonen in zijbalk**).
- **Contactgroepen** aanmaken. Een groep wordt een eigen sectie in de zijbalk. Je voegt items aan groepen toe vanuit het infopaneel van een contact of kanaal, en een item kan in meerdere groepen zitten. Als je een groep verwijdert, blijven de contacten en kanalen bestaan.
- **Standaardwaarden herstellen**.

### Opdrachtenpalet

Druk op Ctrl+K (Cmd+K op macOS) om het opdrachtenpalet te openen en typ om naar gesprekken, instellingen en hulpmiddelen te springen.

### Gespreksvenster

Het grote vlak rechts toont wat je gekozen hebt: een chat, een contactpagina, een repeaterdashboard of een hulpmiddel. Het adres in de browser volgt de weergave (bijvoorbeeld `#map` of `#settings/radio`), zodat je weergaven als bladwijzer kunt opslaan. Met **Laatste gesprek opnieuw openen** aan (Instellingen > Lokale configuratie) opent het kale adres je laatste chat weer.

<!-- id: messaging -->

## Berichten

### Een gesprek beginnen

Klik op **Kanaal/Contact toevoegen**. Het venster heeft deze tabbladen:

- **Contact:** vul een naam, de publieke sleutel van 64 hexadecimale tekens en een type in.
- **Contactlink:** plak een `meshcore://`-link uit een andere MeshCore-client. De handtekening van de advert wordt gecontroleerd voordat het contact wordt geïmporteerd. Er wordt niets verzonden.
- **Privékanaal:** vul een naam en een sleutel van 32 hexadecimale tekens in, of genereer een willekeurige sleutel.
- **Hashtagkanaal:** word lid van een openbaar hashtagkanaal. De sleutel wordt afgeleid van de kanaalnaam, dus iedereen die dezelfde naam typt komt in hetzelfde kanaal.
- **Kanalen in bulk toevoegen:** plak meerdere namen van hashtagkanalen (één per regel, of gescheiden door spaties of komma's). Dit tabblad verschijnt alleen als je Alt (Option op macOS) ingedrukt houdt terwijl je op Kanaal/Contact toevoegen klikt.

Kanaalnamen mogen maximaal 32 bytes zijn, inclusief de `#`. Standaard worden namen omgezet naar kleine letters, cijfers en streepjes. Zet **Hoofdletters, spaties en uitgebreide tekens toestaan** aan om de naam precies zoals getypt te hashen, zoals andere MeshCore-clients dat doen. Als er opgeslagen pakketten zijn die nog niet ontsleuteld konden worden, biedt het venster aan de nieuwe sleutel daarop te proberen.

### Community's en importeren/exporteren

Het pictogram naast de kop Kanalen opent **Kanalen importeren / exporteren**. Exporteren slaat je kanalen op als tekstbestand, één per regel, en importeren leest zo'n bestand in. Op het tabblad **Community's** word je lid van een meshcore-open-community door de code te plakken of de QR-code te scannen (camera of afbeelding). Communitykanalen gebruiken sleutels die van het gedeelde geheim worden afgeleid, dus ze werken samen met meshcore-open. Scannen met de camera vereist HTTPS of `localhost`.

### Lezen en versturen

- Typ in het berichtvak en verstuur. Tot 30 seconden na het versturen van een kanaalbericht kun je het opnieuw versturen. Directe berichten die na alle pogingen geen bevestiging krijgen, tonen **Mislukt**.
- De **Emoji-kiezer** heeft zoeken, recente emoji en huidskleuren. Hij toont hoeveel bytes elke emoji kost, want berichten hebben een maximale grootte.
- Berichten die de radio waarschijnlijk zou afkappen, of die het via meerdere repeaters misschien niet redden, worden onder het invoerveld gemarkeerd.
- Berichten tonen het aantal hops en, met **Padhopbreedte tonen** aan, de breedte van elke hop-ID. Klik op het pad van een bericht om de route en eventuele gehoorde echo's te zien.
- SMAZ-gecomprimeerde berichten van andere clients worden gedecodeerd getoond. Afbeeldingen die via meshcore-open zijn verstuurd, verschijnen als plaatshouder "Afbeelding (niet ondersteund)".
- Scopebadges laten zien of een kanaalbericht Direct (0 hops), Zonder scope (gewone flood) of met een regioscope gehoord is.

### Acties op een bericht

Beweeg over een bericht voor **Reageren**, **Antwoorden**, **Markeren als ongelezen vanaf hier** (opgeslagen op de server, dus elke browser ziet het), **Verwijderen**, en **Opnieuw proberen** bij mislukte directe berichten.

- Reacties en antwoorden gebruiken de platte-tekstnotatie die andere MeshCore-clients begrijpen. Een ontvangen reactie laat zien bij welk bericht hij hoort.
- **Verwijderen** haalt het bericht alleen uit je lokale geschiedenis. Er wordt niets verstuurd en andere clients houden hun kopie.

### Vermeldingen

Als iemand je naam noemt in een kanaal dat je niet open hebt, verschijnt dat in de vermeldingsticker (zet die aan met **Vermeldingsticker Tonen** in Instellingen > Radio). Klik op een vermelding om naar het bericht te springen. Hashtagkanalen die in berichten genoemd worden, kunnen automatisch aan het kanaalregister worden toegevoegd met **Vermelde kanalen automatisch aan register toevoegen**.

### Locaties en contacten delen

- De locatieknop (speldpictogram) in de chatkop voegt je radiolocatie in, de locatie van deze node, of een plek die je op een kaart kiest.
- Een contacttag in een bericht verschijnt als label met **Contact toevoegen**. **Deeltag kopiëren** in de info van een contact kopieert een tag die je kunt plakken.
- Onder **Chatverwerking** in Instellingen > Lokale configuratie zet je klikbare links, linkvoorbeelden (de server haalt de gelinkte pagina op), herkenning van publieke sleutels en herkenning van coördinaten aan.

### Opties per gesprek

De bel in de chatkop opent de meldingsinstellingen: meldingen terwijl het tabblad open is, Web Push-meldingen als de browser gesloten is (vereist HTTPS), het vermeldingsgeluid dempen, en **Kanaal dempen**. **Berichten filteren** verbergt berichten op hopgrootte. Andere knoppen in de kop zijn onder meer favoriet maken, een regio-override, Padontdekking en Directe Trace.

<!-- id: contacts-nodes -->

## Contacten en nodes

### Contactinfo

Klik op een avatar of naam om de info van een contact te openen. Op een computer is dat een volledige pagina in drie kolommen (Identiteit & acties, Jouw gegevens & telemetrie, Netwerk & activiteit). Op een telefoon opent het als zijpaneel. Je ziet onder andere:

- Type, publieke sleutel, laatst gehoord, afstand, hops en route.
- **Berichtroutes (gescoord):** de routes die je directe berichten namen, gerangschikt op aflevering en snelheid. Alleen ter informatie.
- **Posities** door de tijd, **Recente Advertentiepaden**, en de dichtstbijzijnde repeaters op hops en op afstand.
- **Ook Bekend Als** wanneer een contact meerdere namen heeft gebruikt.
- Notities, eigenaarsinformatie, een handmatige reservelocatie en een afwijkende batterijchemie, allemaal opgeslagen op de server.
- **Radioplaatsing:** Auto, Vastzetten (altijd op de radio houden) of Alleen app (nooit op de radio zetten).
- **Telemetrie delen:** wat je radio deelt als dit contact om telemetrie vraagt.
- **Contactlink:** een `meshcore://`-link tonen of kopiëren.
- **Naam opzoeken via analyzer** voor contacten die alleen bij publieke sleutel bekend zijn. Alleen die sleutel wordt naar de site gestuurd.
- Opzoeklinks voor ingestelde analyzers, **Trianguleren**, en het blokkeren van de sleutel of naam.

Favoriete contacten blijven op de radio geladen, zodat de radio hun directe berichten kan bevestigen.

### Routing-override

Klik op het routelabel naast de naam van een contact (bijvoorbeeld het aantal hops of "flood") om **Routing-override** te openen. Je kunt flood forceren, direct forceren, of een expliciet pad invullen met door komma's gescheiden hop-ID's van 1, 2 of 3 bytes. Wis de override om terug te gaan naar de geleerde route. De laatste poging van een onbevestigd direct bericht gaat altijd als flood.

### Repeaters

Als je een repeater opent, zie je een inlogformulier: log in met het wachtwoord of als gast. Het dashboard heeft daarna panelen voor Node-info, Telemetrie, Radio-instellingen (met advertintervallen), LPP-sensoren, Buren, ACL, Regio's en Eigenaarsinfo, plus Acties (Zero-hop-advertentie, Flood-advertentie, Klok synchroniseren, Herstarten), een Console met CLI-toegang, telemetriegeschiedenis en een paneel Geschiedenis dat laat zien wat er tussen opgeslagen momentopnamen veranderd is. **Alles laden** haalt alle panelen na elkaar op.

Met Instellingen bewerken wijzig je één repeaterinstelling tegelijk: je past aan, bevestigt het exacte CLI-commando, het wordt via RF verstuurd en de waarde wordt teruggelezen ter controle. Voor het wijzigen van frequentie, bandbreedte, spreading factor of coding rate moet je eerst de naam van de repeater typen, omdat een verkeerde waarde hem uit de lucht kan halen.

### Roomservers

Ook roomservers hebben een login met wachtwoord of als gast, met telemetrie, ACL, sensordata, een CLI-console en een geschiedenis van ACL-wijzigingen.

### Telemetrie

- Bij een contact dat geen repeater is, haalt **Aanvragen** op verzoek de sensorwaarden op, met grafieken van de geschiedenis.
- Onder **Instellingen > Radio-app-beheer** kun je repeaters en maximaal 8 andere contacten volgen voor geplande verzameling. Om het meshverkeer te beperken, delen alle gevolgde nodes een maximum van 24 controles per dag. Meer gevolgde nodes betekent dus een langer interval.

### Paden

- **Padontdekking** (chatkop) verstuurt een gerouteerde test, toont het heen- en terugpad en slaat de geleerde route op.
- **Directe Trace** verstuurt een trace naar een contact en toont de SNR heen en terug.
- Beide versturen iets via RF en hebben de volledige sleutel van het contact nodig.

<!-- id: map -->

## Kaart

Open **Nodekaart** via Hulpmiddelen. De kaart toont nodes met een geadverteerde of handmatige locatie. Open je de kaart vanuit een contact, de kaartknop in Meshgezondheid of een `#map/focus/...`-link, dan centreert hij op die node.

### Bediening

De kaartbediening is verdeeld over **Weergave**, **Grootte & kleuren**, **Filters** en **Overlays**.

- **Weergave:** achtergrondkaart (Nova donker, OpenFreeMap, OpenStreetMap, OpenTopoMap en Esri-lagen), 2D of 3D met kanteling en 3D-gebouwen, labels (uit, naam of ID-tag) en een legenda. Volledig scherm en **GPX exporteren** (de nodes die nu zichtbaar zijn, als waypoints) staan hier ook.
- **Grootte & kleuren:** nodegrootte, gelijke nodegroottes, neon-nodes en een kleur per noderol.
- **Filters:** **Sinds** (een vaste of eigen tijdsperiode), **Gehoord door server** (alle, nooit-gehoord verbergen, of alleen nooit-gehoord), **Node-rollen**, **Analyzer-nodes** en **Nodes met foutieve locatie verbergen** (op 0,0 of meer dan 300 km van de dichtstbijzijnde node die ze hoorde).

**Overlays** staan uit tot je ze aanzet, en worden per browser onthouden:

- **Pakketten visualiseren** (zie hieronder).
- **Verbindingen** tussen nodes, op basis van liveness, advertpaden of al het verkeer, met een betrouwbaarheidsniveau, een maximale afstand en een leeftijdsvenster. Klik op een verbinding en daarna op **Details** voor de geschiedenis van verkeer en signaal.
- **Telemetrie (accu/temp)**.
- **Gedeelde locaties:** spelden voor locaties die in chats gedeeld zijn. Klik erop om te zien wie hem deelde, en op **Openen in chat**.
- **Geraden locaties:** geschatte posities voor nodes zonder locatie, als holle markeringen vanaf zoomniveau 12. Worden nooit opgeslagen of verstuurd.
- **Relay-signaal:** ringen rond relays die flood-pakketten aan je radio doorgaven, gekleurd naar gemiddelde SNR.

**Analyzer-nodes** toont nodes uit de nodelijst van een externe analyzer. Die lijst wordt alleen gevuld als **Externe analyzer-node-laag** is aangezet en gesynchroniseerd in Instellingen > Radio.

### Pakketten visualiseren

Zet **Pakketten visualiseren** aan om pakketten als geanimeerde bogen en pulsen over de kaart te zien gaan. Met een afspeelbalk kun je afspelen, pauzeren, de snelheid wijzigen, zoeken en terugkeren naar live. Je kunt pulsen, gloed, boogbreedte en het vervagen van het spoor instellen, en **Geigergeluid** aanzetten. In hetzelfde paneel staat **Nodes ontdekken**, een passief filter dat alleen nodes toont die sinds het aanzetten in live pakketten gehoord zijn. Het verstuurt niets.

### Startweergave en pop-ups

**Instellingen > Kaart** bepaalt waar de kaart opent: alle nodes in beeld, een vaste thuislocatie met zoomniveau, of je laatste positie. Klik op een node voor details, telemetrie, een link om het gesprek te openen, **Eigenaar berichten**, **Trianguleren** en **Details**.

<!-- id: tools -->

## Hulpmiddelen

De sectie Hulpmiddelen in de zijbalk bevat deze weergaven. Met Zijbalk aanpassen kun je ze herschikken of verbergen.

### Mijn node

Statistieken over je eigen radio: radiogegevens (frequentie, bandbreedte, model, firmware) en grafieken over een tijdsperiode naar keuze, van 20 minuten tot een jaar of een eigen periode. Er zijn grafieken voor pakketten en bytes, RSSI en SNR met de ruisvloer, **Zendtijdgebruik**, **Ontvangstfouten**, gehoorde nodes, buren, padhashbreedte, drukste kanalen, en de **Radar direct gehoord**, die nodes die op 0 hops gehoord zijn uitzet op richting en afstand. Grafieken zoom je in met het scrollwiel, verschuif je door te slepen en zet je terug met dubbelklikken.

### Meshgezondheid

- **Adverts:** aantallen directe en flood-adverts per contact, een doorzoekbare contactentabel, grafieken van hops en hashmodus, een activiteitenheatmap, en waarschuwingen voor nodes die te vaak adverteren (alleen flood-adverts).
- **Verzoeken:** verzoek- en antwoordverkeer dat deze node gehoord heeft.
- **Prefix-botsingen:** contacten die een publieke-sleutelprefix van 1, 2 of 3 bytes delen. Gedeelde prefixen maken hops dubbelzinnig.
- **Ontvangst per relay:** voor flood-pakketten die vaker dan eens gehoord zijn, welke relay elke kopie bracht en met welk signaal.

### Mesh-trends

**Historisch** toont opgeslagen overzichten: Netwerk, Berichten, Activiteit, drukste kanalen, pakketten per uur, padhashbreedte, regioscope, ruisvloer en MQTT-brokerstatistieken. **Live · deze sessie** toont pakketstatistieken. De korte vensters (1, 5 en 10 minuten, en deze sessie) komen uit je browser; langere vensters worden uit de database berekend.

### Mesh-detectie

**Repeaters Ontdekken**, **Sensoren Ontdekken** of **Beide Ontdekken** verstuurt een kort detectieverzoek via RF en toont de nodes die antwoorden. **Regio's Ontdekken** vraagt repeaters in de buurt welke regio's ze floodden, zodat je die aan je bekende regio's kunt toevoegen.

### Pakketfeed

Een live lijst van elk pakket dat de radio hoort. Met **Filters** (pakkettype en padbreedte), pauzeren en hervatten, automatisch scrollen, oudste of nieuwste eerst, **Herhalingen groeperen op inhoud**, een hexfilter, **Statistieken tonen**, en een optioneel geluid per pakket (Geiger, Sonar of Waterdruppel). Klik op een pakket voor een uitsplitsing per byte.

### Pakketgeschiedenis

Hetzelfde soort lijst over alles wat in de database is opgeslagen. Kies 1, 3, 6, 12 of 24 uur of een datumbereik, en blader terug met **Ouder laden**. Filter op payloadtype, hopbreedte of hex, en zoek op berichttekst, afzender of kanaal. Selecteer rijen en kies **CSV exporteren**. Hoe ver je terug kunt, hangt af van je instellingen voor databewaring.

### Pakket analyseren

Plak een ruw pakket als hex om het byte voor byte gedecodeerd te zien.

### Mesh-visualisatie

Een 3D-grafiek van de mesh, opgebouwd uit live pakketten. Nodes zijn bollen en pakketten zijn geanimeerde bogen. Met de bediening stel je in welke nodes je ziet en hoe de grafiek beweegt, en **Wissen & resetten** begint opnieuw.

### Trace

Bouw een lus van repeaters en trace die terug naar je radio. Zoek repeaters op naam of sleutel en voeg ze toe in de volgorde waarin ze doorlopen moeten worden, of voeg een eigen hop toe als prefix van 1, 2 of 4 bytes. Kies daarna **Trace versturen**. De resultaten tonen de SNR per hop en een kleine kaart. Dit verstuurt iets via RF.

### Berichten zoeken

Zoeken in de volledige tekst van directe berichten en kanaalberichten. Gebruik `user:` of `channel:` om te verfijnen (zet namen met spaties tussen aanhalingstekens). Klik op een resultaat om naar dat bericht te springen.

### Channel Registry (Kanaalregister)

Een lokale catalogus van bekende kanalen. Het is een naslaglijst, niet de lijst met kanalen die de app volgt. Je kunt items toevoegen, bewerken, filteren, importeren en exporteren, synchroniseren vanaf een externe lijst, en met **Aan kanalen toevoegen** een kanaal gaan volgen. Privé-items worden nooit geëxporteerd.

### Kanaalzoeker

**Kanaalzoeker tonen** opent een paneel dat probeert de namen te vinden van kanalen waarvan je geen sleutel hebt, met woordenlijsten en brute force op je GPU. Dat vereist een browser met WebGPU (bijvoorbeeld Chrome of Edge 113 of nieuwer) en HTTPS wanneer je niet op `localhost` werkt. Gevonden kanalen kunnen opgeslagen pakketten ontsleutelen.

### Gebruikershandleiding

Deze pagina. Open hem via Hulpmiddelen of met het adres `#manual`. Hij volgt de taal van de interface. Klik op een kop in de inhoudsopgave om naar dat hoofdstuk te springen.

<!-- id: settings -->

## Instellingen

Open Instellingen met de knop in de bovenbalk. Op een telefoon klapt elke sectie ter plekke uit.

### Radio

- **Verbinding:** Opnieuw verbinden, en **Verbinding verbreken**, dat automatisch opnieuw verbinden pauzeert zodat een ander apparaat de radio kan gebruiken. Heb je loadouts, dan biedt Verbinding verbreken aan er eerst een te laden.
- **Identiteit:** radionaam, privésleutel (alleen schrijven) en je `meshcore://`-contactlink.
- **Radioparameters:** voorinstelling, frequentie, bandbreedte, spreading factor, coding rate, zendvermogen en padhashmodus (1, 2 of 3 bytes per hop, als de firmware het ondersteunt).
- **Locatie**, telemetrie delen, en **Adverteren & Ontdekken** (advertinterval en knoppen om een advert te versturen).
- **Berichten:** extra ACK's, **Onbeantwoorde Kanaalberichten Automatisch Opnieuw Verzenden** en de standaard floodscope.
- Bekende regio's voor het decoderen van pakketten met een regioscope, inclusief **Nederlandse scopes laden**.
- **Max Contacten op Radio**, **Configuratie Exporteren** en **Importeren en Herstarten**.
- **Vermeldingsticker Tonen**, **Vermelde kanalen automatisch aan register toevoegen** en de **Externe analyzer-node-laag**.
- Op meshcomod-firmware (DMC-EV) een paneel **Meshcomod (DMC-EV)** met CAD- en GPS-instellingen.

### Host-repeater

RTFM-EV kan elk ontvangen pakket beoordelen zoals een repeater dat zou doen. **Schaduwmodus** telt wat doorgestuurd of weggegooid zou worden en verstuurt nooit iets. Regiofilters, een zendtijdbudget, timing en beleidsregels zijn instelbaar, met live statistieken. Live herhalen (gewapende modus) vereist de serverinstelling `MESHCORE_HOST_REPEATER_ENABLED=true`, ondersteunde firmware, een toegestane frequentieband en een uitdrukkelijke bevestiging. **Ontwapenen (noodstop)** stopt het, en na een herstart is hij altijd ontwapend. Zorg dat je op jouw locatie een repeater mag gebruiken.

### Lokale configuratie

Instellingen voor deze browser of dit apparaat: taal, kleurthema (inclusief vier CRT-fosforthema's) en CRT-schermeffecten, branding (appnaam en pictogram, gedeeld door alle apparaten), een lokaal label, **Afstandseenheden**, **Coördinaatformaat**, **Datum- en tijdnotatie**, relatieve lettergrootte, UI-aanpassingen (zoals laatste gesprek opnieuw openen, batterijweergave en **Vervangen tijdens het typen**), het geluid bij vermeldingen en DM's, meldingen voor nieuwe nodes, **Chatverwerking** en **Web Push-meldingen**.

### MQTT en automatisering

Integraties (zie Integraties).

### OpenHop

Alleen zichtbaar als de verbonden node een OpenHop-node is. Stel het adres en de token van de OpenHop-API in en beheer daarna configuratie, systeem, updates, beleid en plugins. Acties met echte gevolgen vragen om bevestiging.

### Radio-app-beheer

**Gevolgde Repeatertelemetrie** en **Gevolgde Contacttelemetrie**, namen opzoeken voor naamloze contacten, **Contactbeheer** (nieuwe nodetypen blokkeren, geblokkeerde sleutels en namen, verwijderen in bulk), **Loadouts**, en **Synchronisatie deels bekende nodes**, dat nodes die je alleen van een prefix kent vergelijkt met de nodelijst van de analyzer. Je beoordeelt elke match voordat hij als omkeerbare zachte koppeling wordt opgeslagen.

### Kaart

De startweergave van de kaart en de **Kaarttegelcache** (zie Back-up, herstel en databewaring).

### Database

Databaseoverzicht, opslag opruimen, **Databewaring**, back-up en herstel, en synchronisatieadressen voor het kanaalregister, de woordenlijst van de kanaalzoeker en externe analyzers.

### Handige Info

**Instellen** toont externe node-analyzers en synchronisatiebronnen. Namen opzoeken via een analyzer stuurt per opzoeking maar één publieke sleutel, en alleen als je op een knop drukt. **Links** bevat handige naslagsites.

### Over

Versie, links naar de changelog en het melden van bugs, een updatecontrole, en **Debug-ondersteuningssnapshot openen**.

<!-- id: integrations -->

## Integraties

Open **Instellingen > MQTT en automatisering** en kies **Integratie toevoegen**. Soorten:

- **Privé-MQTT:** berichten doorsturen naar je eigen broker, ruw en/of ontsleuteld. Ontsleutelde berichten gaan als platte tekst, dus gebruik een broker die je vertrouwt.
- **Community MQTT/meshcoretomqtt:** een feed van ruwe pakketten voor community-aggregators, zodat je radio als observer kan dienen. Regionale voorinstellingen zijn ingebouwd.
- **Home Assistant MQTT Discovery:** apparaten en entiteiten verschijnen automatisch in Home Assistant: een apparaat voor de lokale radio, een berichtgebeurtenis, telemetriesensoren voor gevolgde repeaters en GPS-trackers voor gekozen contacten. Repeaters moeten eerst gevolgd worden voor telemetrie voordat ze in de keuzelijst verschijnen.
- **Python-bot:** kleine Python-functies die op berichten reageren.
- **Webhook:** ontsleutelde berichten naar een URL, optioneel ondertekend.
- **Apprise:** stuurt berichten door naar Discord, Telegram, e-mail en vele andere diensten.
- **Amazon SQS:** ruwe of ontsleutelde pakketten naar een wachtrij.
- **Kaartupload:** uploadt gehoorde repeaters en roomservers naar map.meshcore.io of een vergelijkbaar eindpunt, met een proefmodus en een optionele geofence.

Elke integratie heeft een **Berichtbereik**: alle berichten, geen, alleen de opgegeven kanalen en contacten, of alles behalve de opgegeven.

Bots staan standaard uit. Om ze aan te zetten, start je de server met `MESHCORE_DISABLE_BOTS=false`. Een bot voert willekeurige Python-code uit op de server en ziet alle berichten, ook je eigen, dus pas op voor antwoordlussen.

<!-- id: backup-retention -->

## Back-up, herstel en databewaring

Alle gegevens staan in één SQLite-database (standaard `data/meshcore.db`). Beheer die onder **Instellingen > Database**.

### Back-up

- **Back-up downloaden** slaat een consistente momentopname op in je browser, ook terwijl de app draait.
- **Back-ups ook opslaan in een serverpad** schrijft dezelfde momentopname naar een map op de server. **Nu back-up naar server maken** doet dat meteen.
- **Automatisch back-uppen naar het serverpad** maakt elke N uur een back-up en bewaart de nieuwste N bestanden. Alleen automatische back-ups worden rondgedraaid.

### Herstel

Kies een bestand, of druk op **Herstellen** naast een bestand onder **Back-ups op de server**. Het bestand wordt gecontroleerd en klaargezet, en er verandert niets tot je de server herstart. Tot die tijd gooit **Herstel annuleren** het weg. Bij de volgende start wordt de huidige database als pre-restore-bestand bewaard en wordt de back-up ingewisseld. Ongedaan maken doe je door het pre-restore-bestand op dezelfde manier te herstellen. Een herstel vervangt alles wat na het maken van de back-up is vastgelegd.

### Databewaring

**Databewaring** bepaalt hoeveel dagen elk soort geschiedenis bewaard blijft; `0` bewaart voor altijd. Het gaat om ruwe pakketten, berichten, adverts, telemetrie, verbindings- en relaygegevens, apparaatgeschiedenis, ruisvloer, batterij, zendtijd en advertpaden.

- Opruimen gebeurt ongeveer een minuut na het starten en daarna volgens schema. **Nu opruimen** doet het meteen.
- Een lagere waarde verwijdert oudere gegevens bij de volgende ronde. Een hogere waarde haalt verwijderde gegevens niet terug.
- Als een bericht wordt opgeruimd, verdwijnt ook het ruwe pakket.
- **Alles bewaren (analyzer)** zet elke limiet op 0. **Standaardwaarden herstellen** zet de standaardlimieten terug.

### Kaarttegelcache en loadouts

- **Kaarttegelcache** (Instellingen > Kaart, standaard uit) laat de server kaarttegels die je bekeken hebt bewaren, zodat die gebieden offline werken. Esri-tegels worden nooit bewaard.
- **Loadouts** (Radio-app-beheer) zijn benoemde groepen kanalen en contacten. **Op radio laden** voegt alleen toe, verwijdert nooit, en meldt het resultaat per item. Er wordt niets verstuurd. De app deelt de radio bij de volgende herverbinding of volledige synchronisatie opnieuw in, dus laad een loadout vlak voordat je de verbinding verbreekt.

<!-- id: troubleshooting -->

## Problemen oplossen

**De pagina is leeg of verouderd na een update.** De server levert de gebouwde frontend. Bouw na het bijwerken de frontend opnieuw en ververs de pagina.

**Berichten blijven op de radio staan en verschijnen nooit.** Start de server met `MESHCORE_ENABLE_MESSAGE_POLL_FALLBACK=true`, dat de radio elke 10 seconden bevraagt.

**Waarschuwing dat automatisch bevestigen van DM's misschien niet voor alle contacten werkt.** De contactentabel van de radio is vol of kon niet gelezen worden. Versturen en ontvangen werken gewoon. Verlaag **Max Contacten op Radio**, of wis de contactentabel van de radio met een andere MeshCore-client en herstart.

**MQTT maakt geen verbinding op Windows.** Start de server met `--loop none`.

**De kanaalzoeker meldt dat WebGPU niet beschikbaar is.** Gebruik Chrome of Edge 113 of nieuwer, via HTTPS tenzij je op `localhost` werkt.

**Web Push werkt niet.** Push vereist HTTPS. Stel voor iOS en Safari `MESHCORE_VAPID_SUBJECT` in op een echt `mailto:`-adres.

**Een bericht toont Mislukt.** Er kwam na alle pogingen geen bevestiging. Gebruik **Opnieuw proberen** om een nieuwe kopie te versturen.

**Een bug melden.** Start de server met `MESHCORE_LOG_LEVEL=DEBUG` en gebruik **Debug-ondersteuningssnapshot openen** onder Instellingen > Over. Logs kunnen kanaalnamen of sleutels bevatten (nooit je privésleutel), dus controleer wat je deelt.
