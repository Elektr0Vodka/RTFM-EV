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

- **De app beheert je radio.** Zodra een radio verbonden is, worden de contacten en kanalen in de app geïmporteerd en bepaalt de app welke contacten op de radio geladen blijven. Daardoor past de app minder goed als je vaak van radio wisselt en elke radio zijn eigen toestand wilt laten houden. Alleen de geschiedenis van batterij, ruisvloer en zendtijd wordt per radio bewaard (zie Van radio wisselen).
- **Gebruik de app alleen op een vertrouwd netwerk.** Er zijn geen gebruikersaccounts. Iedereen die de pagina kan bereiken, kan hem gebruiken. De optionele HTTP Basic-authenticatie is slechts een grove drempel en hoort altijd samen te gaan met HTTPS.

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

### Van radio wisselen

De app onthoudt elke radio die ermee verbonden is geweest. De geschiedenis van batterij, ruisvloer en zendtijd wordt per radio opgeslagen, zodat twee radio's nooit in één grafiek door elkaar lopen. Contacten, kanalen, pakketten en berichten zijn van alle radio's samen.

Verbindt er een radio die deze installatie nog niet kent, dan vraagt een venster **Er is een andere radio verbonden**. Kies **Dit is een nieuwe radio**, of **Deze vervangt een eerdere radio** en kies de oude onder **Vervangt**. Een vervanging kan de **Geschiedenis van batterij, ruisvloer en zendtijd**, de **Eigen nodes** en de **Notitie** van de eerdere radio overnemen. Er wordt niets verplaatst of verwijderd, en je kunt het later wijzigen of ongedaan maken onder Instellingen > Radio > Radio’s. **Later beslissen** verbergt het venster voor deze browsersessie. De radio blijft werken terwijl je beslist.

Geschiedenis van voordat radio's werden bijgehouden, wordt automatisch aan de verbonden radio toegewezen als de app kan zien dat die van deze radio is. Anders vraagt hij het één keer, **Van wie is deze geschiedenis?**: **Ja, die hoort bij deze radio**, of **Nee, apart houden**. Aparte geschiedenis blijft op Mijn node beschikbaar als **Voor radio-registratie**.

### Meerdere radio's tegelijk

Als de server in multi-radiomodus draait, heeft elke radio een eigen werkruimte met eigen contacten, berichten, pakketten en instellingen. De kanalenlijst is gedeeld: een kanaal dat je in de ene werkruimte toevoegt of verwijdert, wordt in alle werkruimtes toegevoegd of verwijderd. De radionaam in de bovenbalk opent een lijst met de andere radio's; kies er een om te wisselen. **Radio's beheren** opent de pagina waar je radio's toevoegt, bewerkt, start, stopt en verwijdert en hun log leest. Een radio krijgt een werkruimte nadat hij één keer verbonden is geweest. Een getal naast de radionaam laat zien hoeveel ongelezen berichten er op de andere radio's wachten; het is gemarkeerd als er een direct bericht of een vermelding bij zit. Het geluid voor vermeldingen en directe berichten klinkt ook voor een andere radio, als het geluid in de instellingen van die radio aan staat. Thema, taal en kaartweergave worden door alle radio's gedeeld. Deze modus staat uit, tenzij de beheerder van de server hem aanzet.

### Taal en thema

De interface is beschikbaar in het Engels, Nederlands en Duits. Wissel van taal met het taalmenu in de bovenbalk (vlag en taalcode) of onder **Instellingen > Lokale configuratie**. De keuze wordt per browser bewaard. Het zon- of maanpictogram in de bovenbalk opent de themakiezer.

Het thema **Windows 95** heeft een **Bureaubladmaatje**: Clippy verschijnt zodra je dat thema kiest, tot je onder **Instellingen > Lokale configuratie** (onder de themakiezer) of in het themavenster achter het zon- of maanpictogram een ander maatje (Merlin, Bonzi, F1, Genie, Genius, Links, Peedy, Rocky, Rover of een van 26 andere, zoals Mother Nature, Courtney, Earl of Santa) of **Uit** kiest. Heb je Windows 95 eenmaal gebruikt, dan is dezelfde instelling bij elk thema beschikbaar; andere thema's beginnen met **Uit**, en een maatje dat je daar kiest verschijnt bij alle thema's. Het maatje blijft in beeld terwijl je navigeert en vertelt je over nieuwe nodes, bijna lege batterijen (je radio en nodes met telemetrie van de afgelopen 24 uur, onder de drempel die je instelt; nodes op netstroom worden overgeslagen), privéberichten en @vermeldingen, een verbroken radioverbinding en beschikbare updates. Het vertelt je ook wanneer een privébericht van jou niet is bevestigd (alleen als die chat niet in beeld is), wanneer een integratie onder **MQTT en automatisering** een minuut lang geen verbinding heeft, en wanneer een node die je via SNMP uitleest niet meer reageert. De eerste keer dat je een pagina opent, geeft het ook een korte tip. Voordat het iets zegt, speelt het een passende animatie af (een waarschuwing bij een verbroken radio, een juichje bij een nieuwe node), en als datgene waar het over gaat in beeld is (de rij van de afzender in de zijbalk, de radiostatus, de batterij-indicator of de knop Instellingen) wijst het ernaar terwijl het praat. Niet elk maatje heeft dezelfde animaties; een maatje zonder passende animatie zegt het gewoon. Klik op het tekstballonnetje om te openen waar het over gaat. Sleep het maatje om het te verplaatsen (de plek wordt per browser onthouden), dubbelklik voor een kunstje en rechtsklik om het weg te sturen tot je de pagina herlaadt. Eén klik op het maatje opent een klein menu: **Wat heb ik gemist?** toont de laatste 20 regels die het zei of achterhield terwijl het stil was (klik op een regel om te openen waar die over ging), **Hulp bij deze pagina** opent deze handleiding bij het hoofdstuk voor de pagina die in beeld is, en de rest dempt het, opent de instellingen om een ander maatje te kiezen, of verbergt het tot je herlaadt. De samenvatting na een stille periode opent dezelfde lijst als je erop klikt. Escape of een klik ergens anders sluit het menu. Onder **Instellingen > Lokale configuratie** kun je ook soorten meldingen uitzetten onder **Vertel me over** (privéberichten en vermeldingen, nieuwe nodes, radioverbinding, lege batterijen, integraties en SNMP, updates, paginatips), het maatje **Dempen** voor 15 minuten, 1 uur of tot je herlaadt, en dagelijkse **Stille uren** instellen. Zolang het stil is, komt er niets door; daarna vertelt het in één regel wat het heeft achtergehouden (paginatips worden niet bewaard, die komen bij een later bezoek terug). Een waarschuwing voor een bijna lege batterij wordt na herladen niet herhaald. Met een CRT-thema krijgt het maatje de fosforkleur en volgt het de CRT-schermeffecten (scanlijnen, fosforgloed, schermkromming en flikkering). De afbeeldingen van een maatje worden pas gedownload als je het kiest, en het speelt geen geluid af.

### Rondleiding

Nieuw in de app? Open de **Gebruikershandleiding** en klik op **Rondleiding starten**. Een maatje laat je dan in 12 stappen de belangrijkste onderdelen zien: het gaat naast het onderdeel staan waar het over praat en wijst ernaar, een kader markeert dat onderdeel, en in een klein venster naast het maatje staat de tekst met **Terug** en **Volgende**. Elke stap opent de pagina waar hij over gaat. De rondleiding navigeert alleen: er wordt nooit iets getypt of verstuurd.

- **Pauzeren** stopt de rondleiding en onthoudt de stap. Met **Rondleiding hervatten** in de Gebruikershandleiding, of in het menu dat opent als je op je maatje klikt, ga je daar verder. **Beëindigen** stopt de rondleiding; je kunt hem altijd opnieuw starten.
- Er wordt niets geblokkeerd. Je kunt de app gewoon blijven gebruiken terwijl de rondleiding loopt, en je kunt het maatje opzij slepen.
- Heb je geen maatje aanstaan, dan komt Clippy alleen voor de rondleiding langs en vertrekt weer zodra die pauzeert of eindigt. Je maatje-instelling verandert niet. Heb je zelf een maatje, dan wordt wat het tijdens de rondleiding had willen zeggen achtergehouden en daarna samengevat.
- In een browser die de app nog niet eerder heeft gebruikt, biedt een kaartje de rondleiding één keer aan: **Rondleiding starten**, **Nu niet** (bij het volgende bezoek vraagt hij het opnieuw) of **Niet meer vragen**.
- Zolang je geen kanaal hebt, worden de twee chatstappen overgeslagen.

Twee kortere rondleidingen laten zien wat de firmware van je radio toevoegt. Hun knoppen verschijnen in de Gebruikershandleiding en in het maatjesmenu zodra er een radio met die firmware verbonden is geweest:

- **Rondleiding MeshCore 1.18** (companion-firmware 1.18 of nieuwer): de opdrachtregel in **Instellingen > Radio** en op **Mijn node**, de opdrachtregel van een andere companion in een chat en in zijn contactinfo, de **Remote CLI**-toestemming en het sensordashboard. Een stap voor een contact of sensor wordt overgeslagen als je er geen hebt; de rondleiding opent de companion die je het laatst hebt gehoord, nooit het Meshcomod-contact.
- **Rondleiding meshcomod** (meshcomod-firmware): het paneel **Meshcomod (DMC-EV)**, de CAD-knop in de chatkop, het ingebouwde contact **Meshcomod** (wat je het stuurt, draait op de radio en gaat nooit via LoRa de lucht in), de opdrachtregel, en het **Companion-ontvangstfilter** met tellers en back-up. Stappen voor functies die jouw build niet heeft, worden overgeslagen.
- De eerste keer dat een browser zo'n radio ziet, biedt een kaartje die rondleiding één keer aan, ook als je de app al eerder gebruikte. Er staat steeds één kaartje in beeld, en na **Nu niet** of **Niet meer vragen** volgt er tot het volgende bezoek geen ander kaartje.

<!-- id: layout -->

## De indeling

### Bovenbalk

Van links naar rechts toont de bovenbalk de appnaam, het statuslampje van de verbinding, een badge **Herhaalt** zolang de host-repeater gewapend is, en de batterij van de radio als je die inschakelt in **Instellingen > Lokale configuratie**. Op brede schermen zie je ook een grafiekje met het live pakkettempo, de verbindingsstatus in tekst, en de radionaam met de korte publieke sleutel (klik op de sleutel om de volledige sleutel te kopiëren). Als de radio niet verbonden of gepauzeerd is, verschijnt een knop **Opnieuw verbinden** of **Verbinden**. Daarna volgen de knop **Chatvenster** (opent het venster met alleen chat, zie hieronder), de knop **Instellingen** (een stip erop betekent dat er een nieuwere versie is), het taalmenu en de themaknop. De themaknop opent een venster met inklapbare onderdelen voor het kleurthema, de CRT-schermeffecten, **Toegankelijkheid** (kleurenblindmodus en leeslettertype) en het bureaubladmaatje; de onderdelen die je openklapt blijven de volgende keer open.

Op smalle schermen opent een menuknop helemaal links de zijbalk.

### Zijbalk

De zijbalk is de hoofdnavigatie. De secties, in de standaardvolgorde:

- **Hulpmiddelen:** de analyse- en hulpweergaven (zie Hulpmiddelen).
- **Favorieten:** favoriete kanalen en contacten, verdeeld over Favoriete kanalen, Favoriete companions, Favoriete repeaters, Favoriete roomservers en Favoriete sensoren.
- **Eigen nodes:** contacten waarvan je eigen radio de eigenaar is, of een radio die hij vervangen heeft als die koppeling **Eigen nodes** overneemt. Alleen zichtbaar als er minstens één is.
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

### Uitleg op aanraakschermen

Veel badges, pictogrammen en ingekorte waarden hebben een toelichting die een muis toont als je erboven zweeft. Tik op een aanraakscherm op zo'n onderdeel om de toelichting in een klein tekstballonnetje te zien. Tik er opnieuw op, tik ergens anders of scrol om het te sluiten. Knoppen en links veranderen niet: een tik daarop doet waar ze voor zijn.

### Gespreksvenster

Het grote vlak rechts toont wat je gekozen hebt: een chat, een contactpagina, een repeaterdashboard of een hulpmiddel. Het adres in de browser volgt de weergave (bijvoorbeeld `#map` of `#settings/radio`), zodat je weergaven als bladwijzer kunt opslaan. Met **Laatste gesprek opnieuw openen** aan (Instellingen > Lokale configuratie) opent het kale adres je laatste chat weer.

### Chatvenster

De knop **Chatvenster** in de bovenbalk opent een apart, lichter venster dat alleen berichten doet, ingedeeld als een klassieke IRC-client: gesprekken links, de chat in het midden en de recente afzenders van die chat rechts. Het werkt zelfstandig, dus je kunt het hoofdtabblad sluiten en alleen dit venster open houden. Het laadt de kaart, de pakketfeed en de andere hulpmiddelen niet, en vraagt de server om de ruwe pakketstroom weg te laten.

Alles in een chat werkt zoals in de hoofdapp: de knoppen in de chatkop, berichtacties, het invoerveld, inloggen op rooms, contact- en kanaalinfo, **Nieuw** (een gesprek starten of een kanaal toevoegen) en **Zoeken**. Alles wat geen chat is (de kaart, het kanaalregister, een repeaterdashboard, Instellingen) opent in de hoofdapp.

De knoppenbalk heeft deze extra's:

- **Regels / Ballonnen:** klassieke regels (`[tijd] <Naam> tekst`) of de gewone berichtballonnen. Bij regels klik je op een naam om die afzender te noemen en op het stipje ervoor om de contactinfo te openen.
- **Skin:** **mIRC**, **mIRC donker**, of **App-thema** om het thema uit de hoofdapp te volgen.
- **Losmaken:** opent de huidige chat in een eigen klein venster.
- **Hoofdapp:** opent de volledige app op hetzelfde gesprek.

Skin en weergave worden per browser bewaard. Zolang er een hoofdtabblad open is, laat het chatvenster het vermeldingsgeluid en de browsermeldingen aan dat tabblad over, zodat niets dubbel klinkt. De lijst rechts toont wie er in de geladen berichten heeft gesproken; MeshCore-kanalen hebben geen ledenlijst.

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
- **Deel hoe dit bericht reisde** (bij berichten met een pad, en als **Delen** in de padweergave) maakt een afbeelding van de routes waarlangs het bericht je radio bereikte: een kaart met de afzender, de hops en je radio, de berichttekst en tot vier cijfers (routes, hops, hemelsbrede afstand, beste SNR bij je radio). Daarna volgt een animatie (GIF) die de routes hop voor hop tekent. **Delen** opent het deelmenu van je apparaat, **Afbeelding kopiëren** kopieert de afbeelding; beide werken alleen via HTTPS of localhost. **Afbeelding downloaden** en **Animatie downloaden** werken altijd. **Mijn positie verbergen** tekent de routes als schema in plaats van op een kaart, zonder nodenamen of echte richtingen, en wordt in deze browser onthouden; de titel, de tekst en de cijfers (ook de hemelsbrede afstand) blijven op de afbeelding. Er wordt niets via de radio verstuurd.
- Hetzelfde soort afbeelding zit achter **Delen** bij een traceresultaat (elke hop met de SNR die daar gehoord is, de route heen en terug), bij de **Radar direct gehoord** in Mijn node (de nodes die je radio direct hoort), in de kop van Mesh Health op tabbladen met een tijdvenster (de gehoorde nodes en de pakketten per uur), in de filtersecties van een SNMP-nodepagina, in de geschiedenis van het ontvangstfilter van de companion, als **Delen als afbeelding** op het tabblad Spam & bots (met **Grootste bronnen tonen**, standaard uit) en naast de totalen van de hostrepeater (alleen een afbeelding). **Mijn positie verbergen** is er bij de afbeeldingen van berichten, traces en de radar.

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
- Notities, eigenaarsinformatie, een handmatige reservelocatie, een afwijkende batterijchemie en een afwijkende stroombron (Automatisch leidt die af uit de naam), allemaal opgeslagen op de server.
- **Radioplaatsing:** Auto, Vastzetten (altijd op de radio houden) of Alleen app (nooit op de radio zetten).
- **Telemetrie delen:** wat je radio deelt als dit contact om telemetrie vraagt.
- **Contactlink:** een `meshcore://`-link tonen of kopiëren.
- **Naam opzoeken via analyzer** voor contacten die alleen bij publieke sleutel bekend zijn. Alleen die sleutel wordt naar de site gestuurd.
- Opzoeklinks voor ingestelde analyzers, **Trianguleren**, en het blokkeren van de sleutel of naam. De chatkop van een contact heeft dezelfde opzoekactie als pictogram, en de pakketdetails hebben **Afzender opzoeken op** een site wanneer het pakket een volledige afzendersleutel opleverde.

Favoriete contacten blijven op de radio geladen, zodat de radio hun directe berichten kan bevestigen.

### Routing-override

Klik op het routelabel naast de naam van een contact (bijvoorbeeld het aantal hops of "flood") om **Routing-override** te openen. Je kunt flood forceren, direct forceren, of een expliciet pad invullen met door komma's gescheiden hop-ID's van 1, 2 of 3 bytes. Wis de override om terug te gaan naar de geleerde route. De laatste poging van een onbevestigd direct bericht gaat altijd als flood.

### Repeaters

Als je een repeater opent, zie je een inlogformulier: log in met het wachtwoord of als gast. Het dashboard heeft daarna panelen voor Node-info, Telemetrie, Radio-instellingen (met advertintervallen), LPP-sensoren, Buren, ACL, Regio's en Eigenaarsinfo, plus Acties (Zero-hop-advertentie, Flood-advertentie, Klok synchroniseren, Herstarten), een Console met CLI-toegang, telemetriegeschiedenis en een paneel Geschiedenis dat laat zien wat er tussen opgeslagen momentopnamen veranderd is. Terwijl je in de Console typt, verschijnen passende standaard MeshCore-commando's met hun parameters en een korte beschrijving (in het Engels): Tab vult het eerste in, met de pijltjestoetsen en Enter kies je een ander, Escape verbergt de lijst. Een suggestie vult alleen het invoerveld; er wordt niets verzonden tot je op Verzenden drukt. Commando's met "serial only" werken niet via de radio. De Console verstuurt een regel precies zoals getypt, ook spaties vooraan en een lege regel; dat heeft `region load` van de firmware nodig. Bij een regel die met een spatie begint, verschijnen geen suggesties. **Alles laden** haalt alle panelen na elkaar op.

Met Instellingen bewerken wijzig je één repeaterinstelling tegelijk: je past aan, bevestigt het exacte CLI-commando, het wordt via RF verstuurd en de waarde wordt teruggelezen ter controle. Voor het wijzigen van frequentie, bandbreedte, spreading factor of coding rate moet je eerst de naam van de repeater typen, omdat een verkeerde waarde hem uit de lucht kan halen. De groep Observer-firmware (SNMP-agent aan/uit) werkt alleen op DMC observer- en agessaman observer-firmware: gebruik eerst de eigen knop Lezen en herstart de repeater na een wijziging.

Repeaters en roomservers met observer-firmware kun je ook via je netwerk uitlezen. Op de contactpagina vraagt de kaart **SNMP (LAN)** om het IP-adres, de poort en de community van de node; met **Nu uitlezen** zie je daarna radio-, MQTT-, geheugen- en wifi-waarden zonder RF te gebruiken. SNMP moet op de node aan staan (groep Observer-firmware in Instellingen bewerken, daarna herstarten) en de server moet de node via UDP kunnen bereiken. Zet **Volgens schema uitlezen** aan om de server de node om de paar minuten te laten uitlezen en de resultaten te bewaren; de kaart toont dan een historiegrafiek voor de gekozen waarde en periode. Als de Home Assistant-integratie de repeater volgt, verschijnen de waarden daar ook als SNMP-sensoren. **Adres aan node vragen** stuurt één commando via RF om het IP op te vragen en vereist een admin-login. De pagina **SNMP** onder Hulpmiddelen toont alle nodes met SNMP naast elkaar.

Companions met meshcomod-firmware hebben dezelfde kaart. Zet de agent aan met `set snmp on` op de opdrachtregel van de companion, zoek het adres op met `get wifi.ip` en vul dat IP-adres of die hostnaam in op de kaart: een companion kan er niet via RF om gevraagd worden. Zijn pagina toont ook de verbonden clients, contacten en kanalen en wat zijn ontvangstfilter voor je verborg. Je eigen verbonden radio is ook een companion-contact en kan dus op dezelfde manier worden toegevoegd.

### Roomservers

Ook roomservers hebben een login met wachtwoord of als gast, met telemetrie, ACL, sensordata, een CLI-console en een geschiedenis van ACL-wijzigingen.

Een roomserver stuurt je de berichten die nieuwer zijn dan wat je radio al heeft ontvangen. **Nu synchroniseren** logt opnieuw in om daarom te vragen. Ontbreken er daarna nog berichten (bijvoorbeeld na een herstart van de radio, of nadat er veel berichten tegelijk binnenkwamen), open dan **Tools tonen** en gebruik **Geschiedenis opnieuw ophalen**. Daarmee stuurt de roomserver elk bericht dat hij nog bewaart opnieuw, maximaal 32. Berichten die je al hebt komen niet dubbel, en je eigen berichten worden niet teruggestuurd. Je moet een tweede keer klikken om te bevestigen, omdat het de zendtijd van al die berichten kost; de berichten komen de komende minuten binnen.

### Telemetrie

- Bij een contact dat geen repeater is, haalt **Aanvragen** op verzoek de sensorwaarden op, met grafieken van de geschiedenis.
- Onder **Instellingen > Radio-app-beheer** kun je repeaters en maximaal 8 andere contacten volgen voor geplande verzameling. Om het meshverkeer te beperken, delen alle gevolgde nodes een maximum van 24 controles per dag. Meer gevolgde nodes betekent dus een langer interval.

### Klokken van nodes

Elk advert bevat de tijd van de node die het verstuurde. De contactinfo toont dat als **Klok**: **Loopt gelijk** (binnen 2 minuten van deze server), of hoeveel de node voor- of achterloopt. Een node waarvan de klok nooit is gezet, loopt jaren achter. Er wordt niets verstuurd om dit te meten; de waarde is zo oud als het laatst gehoorde advert, en alleen adverts die sinds de installatie van deze versie zijn gehoord tellen mee.

Bij een gevolgde repeater staat in het paneel met de telemetriegeschiedenis **Zet de klok van deze repeater gelijk als die achterloopt**. Staat dat aan, dan controleert elke telemetrieronde die de repeater bereikt zijn nieuwste advert, en gaat er één tijdcommando over de radio als de klok meer dan 2 minuten achterloopt. Er gelden twee beveiligingen. Het commando gaat hooguit één keer per nieuw advert, en alleen als de meeste nodes die de afgelopen dag zijn gehoord (minstens 5) het eens zijn met de klok van deze server, zodat een verkeerde serverklok niet in repeaters terechtkomt. De repeaterfirmware zet een klok nooit terug: een repeater die voorloopt wordt met rust gelaten en alleen in het serverlog vermeld. Je radio heeft beheerrechten op de repeater nodig (log één keer in met het beheerwachtwoord).

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
- **Filters:** **Sinds** (een vaste of eigen tijdsperiode), **Gehoord door server** (alle, nooit-gehoord verbergen, of alleen nooit-gehoord), **Node-rollen**, **Stroombron** (de instelling op het contact, anders het stroomicoon in de nodenaam: ⚡/🔌 net, 🔋 accu, ☀️/🌞/🔆 of het woord "solar" voor zon, beide voor zon + accu, geen icoon is Onbekend; nodes met de naam "DTIS | ..." zijn zon + accu), **Analyzer-nodes** en **Nodes met foutieve locatie verbergen** (op 0,0 of meer dan 300 km van de dichtstbijzijnde node die ze hoorde).

**Overlays** staan uit tot je ze aanzet, en worden per browser onthouden:

- **Pakketten visualiseren** (zie hieronder).
- **Verbindingen** tussen nodes, op basis van liveness, advertpaden of al het verkeer, met een betrouwbaarheidsniveau, een maximale afstand en een leeftijdsvenster. Klik op een verbinding en daarna op **Details** voor de geschiedenis van verkeer en signaal.
- **Telemetrie (accu/temp)**.
- **Gedeelde locaties:** spelden voor locaties die in chats gedeeld zijn. Klik erop om te zien wie hem deelde, en op **Openen in chat**.
- **Bakens:** posities, waypoints en routes van MeshCore TEAM en signalk-meshcore in kanalen die je volgt. De nieuwste positie van elke afzender is een speld met een icoon voor het soort afzender (boot, autonome radio of persoon), en waypoints dragen hun TEAM-type-icoon; zet **Sporen** aan om het spoor over het tijdvenster te tekenen. Klik op een speld voor batterijen, status en **Openen in chat**. Een contact dat zulke bakens stuurde krijgt ook een sectie **Bakengeschiedenis** in de contactinfo.
- **Verzenden in TEAM-formaat:** in een privékanaal kan **Share location > Kies op kaart** een MeshCore TEAM-waypoint invoegen in plaats van een locatiemarkering. **Instellingen > Radio-app-beheer > MeshCore TEAM-baken** kan de positie van deze radio als TEAM-baken op één privékanaal verzenden met een vast interval. Dit staat standaard uit en zendt elke keer via de radio. Stel **Vaartuigtype** in bij de contactinfo om een boot een eigen kaarticoon te geven.
- **Geraden locaties:** geschatte posities voor nodes zonder locatie, als holle markeringen op elk zoomniveau, met labels volgens de kaartinstelling Labels. Worden nooit opgeslagen of verstuurd.
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

Statistieken over je eigen radio: radiogegevens (frequentie, bandbreedte, model, firmware) en grafieken over een tijdsperiode naar keuze, van 20 minuten tot een jaar of een eigen periode. Er zijn grafieken voor pakketten en bytes, RSSI en SNR met de ruisvloer, **Zendtijdgebruik**, **Ontvangstfouten**, gehoorde nodes, buren, padhashbreedte, drukste kanalen, en de **Radar direct gehoord**, die nodes die op 0 hops gehoord zijn uitzet op richting en afstand. Grafieken zoom je in met het scrollwiel, verschuif je door te slepen en zet je terug met dubbelklikken. De kaart **Live signaal** zet de RSSI uit van elk pakket dat in de laatste 2, 5 of 15 minuten is gehoord, gekleurd per pakkettype, tegen de ruisvloer (stippellijn). De meters tonen het laatste pakket (met zijn SNR), de ruisvloer, het sterkste pakket in dat venster en de **Marge**: hoeveel het laatste pakket boven de ruisvloer lag. LoRa kan pakketten onder de ruisvloer nog decoderen, dus een negatieve marge betekent niet dat een pakket verloren ging.

De grafieken voor batterij, ruisvloer en zendtijd tonen de huidige radio plus de geschiedenis die hij heeft overgenomen van een radio die hij vervangen heeft. Is er meer dan één radio, of geschiedenis van voor de radio-registratie, dan verschijnt naast de tijdsperiode een keuzelijst **Radio**: **Huidige radio**, één bepaalde radio (met wat die radio overnam), of **Voor radio-registratie**.

### Meshgezondheid

- **Adverts:** aantallen directe en flood-adverts per contact, een doorzoekbare contactentabel, grafieken van hops en hashmodus, een activiteitenheatmap, en waarschuwingen voor nodes die te vaak adverteren (alleen flood-adverts).
- **Verzoeken:** verzoek- en antwoordverkeer dat deze node gehoord heeft.
- **Prefix-botsingen:** contacten die een publieke-sleutelprefix van 1, 2 of 3 bytes delen. Gedeelde prefixen maken hops dubbelzinnig.
- **Ontvangst per relay:** voor flood-pakketten die vaker dan eens gehoord zijn, welke relay elke kopie bracht en met welk signaal. De totalen en de tabel per relay beslaan het hele venster, zonder rijlimiet. De tabel per relay toont ook hoe vaak de kopie van een relay als eerste aankwam en hoeveel pakketten je alleen via die relay hoorde. Klap een relay open (het pijltje voor de naam) voor zijn activiteit en signaal door de tijd, pakkettypen, aantal hops en recente kopieën. De tabel per pakket bladert door opgeslagen kopieën; kies het aantal rijen per pagina eronder. Opgeslagen kopieën blijven standaard 2 dagen bewaard; daarvoor worden ze samengevat in een uurgeschiedenis per relay (standaard 365 dagen bewaard, **Relay-geschiedenis per uur** onder Databewaring), zodat vensters langer dan de opgeslagen kopieën nog totalen en grafieken per relay tonen.
- **Stroomuitval:** welke nodes online blijven als het stroomnet uitvalt, op basis van de stroombron van elke node (de instelling op het contact, anders het stroomicoon in de naam; DTIS-nodes zijn zon + accu). Accu- en zonnenodes blijven online; netgevoede en onbekende nodes vallen uit (onbekend telt als net). Toont het aandeel dat overleeft, de mix van stroombronnen, en de eilanden die de overlevende nodes vormen via gehoorde advert-padlinks (alleen tussen nodes met locatie), zodat je ziet waar de mesh zou opsplitsen. Kies repeaters + rooms of alle nodes, en hoe recent ze gehoord zijn. Klik op een kolomkop om de nodetabel te sorteren; de tabel wordt gepagineerd met dezelfde instelling **Max rijen tonen** als de Adverts-tabel, en na omlaag scrollen verschijnt een knop om naar boven te gaan.
- **Spam en bots:** statistieken over kanaalberichten die als spam, misvormd of duplicaat zijn gemarkeerd, en berichten van afzenders op een botlijst, voor de gekozen periode en eventueel één kanaal. De tegels tonen elk aantal en het aandeel in het kanaalverkeer. **Bots** telt berichten van afzenders die vandaag op een ingeschakelde botlijst staan; het aantal dat bij aankomst is gemarkeerd, ernaast, verandert niet als de lijsten veranderen. De grafiek toont het verloop als aantallen of als aandeel. **Veroorzakers** heeft drie tabellen (afzenders, kanalen, bronrepeaters) die sorteren met een klik op een kolomkop en als CSV te downloaden zijn. **Filters** laat zien wat Spam Guard deed met de berichten die het heeft beoordeeld (gestopt, zou gestopt zijn terwijl er niets werd tegengehouden, zoals in de modus Meekijken, doorgelaten, tegengehouden, schoon), welk soort blokkade ze ving, je eigen antwoorden Dit is spam en Geen spam, de oorzaak van misvormde berichten, en het aantal pakketten per OpenHop-regel. Uitkomsten worden vastgelegd vanaf de versie die dit tabblad toevoegde; oudere berichten tellen als zonder vastgelegde uitkomst. **Samenvatting kopiëren** zet een kort tekstrapport op het klembord en **JSON** downloadt het hele rapport. **Namen anonimiseren** vervangt afzendernamen, namen van privékanalen en zelfgeschreven OpenHop-regelnamen door codes, op de pagina en in elke export, zodat de cijfers gedeeld kunnen worden. Op dit tabblad wordt niets via de radio verzonden.

### Mesh-trends

**Historisch** toont opgeslagen overzichten: Netwerk, Berichten, Activiteit, drukste kanalen, pakketten per uur, padhashbreedte, regioscope, ruisvloer en MQTT-brokerstatistieken. **Live · deze sessie** toont pakketstatistieken. De korte vensters (1, 5 en 10 minuten, en deze sessie) komen uit je browser; langere vensters worden uit de database berekend.

### Mesh-detectie

**Repeaters Ontdekken**, **Sensoren Ontdekken** of **Beide Ontdekken** verstuurt een kort detectieverzoek via RF en toont de nodes die antwoorden. **Regio's Ontdekken** vraagt repeaters in de buurt welke regio's ze floodden, zodat je die aan je bekende regio's kunt toevoegen.

### Spam Guard

Spam Guard stopt kanaalspam bij je repeater. Het kijkt naar gedrag, nooit naar mensen of meningen: dezelfde tekst onder meerdere verzonnen namen, stortvloeden van kopieën en repeaters waarlangs spam het mesh binnenkomt. Zet het aan in **Instellingen > Lokale configuratie > Spambescherming**; de pagina verschijnt dan onder Tools.

Het start in **Meekijken**: spam wordt herkend en getoond, maar er wordt niets geblokkeerd. Laat het een dag zo staan en bekijk wat het zou tegenhouden. Met **Beschermen** stuurt je host-repeater niet meer door wat een blokkade vangt. Dat verandert alleen iets in de ether zolang de host-repeater actief is.

Een **OpenHop**-radio stuurt zelf door. Daar schrijft Beschermen de blokkades in het beleid van de node, als regels waarvan de naam begint met `rtfm-spam:`, rondom je eigen regels. Je eigen regels blijven zoals ze zijn. Het einde van elke regelnaam zegt waar de blokkade vandaan komt: `(yours)` voor een blokkade die je zelf maakte of bewaarde, `(duplicate)` voor gewone duplicaatonderdrukking, `(auto)` voor de rest. Berichten die de eigen companions van de node versturen, die van jou ook, worden nooit door deze regels tegengehouden. Hiervoor zijn de API-URL en de token onder **OpenHop-beheer** in Instellingen nodig, en de beleidsmotor van de node wordt ingeschakeld. De regels gaan weer van de node af als je teruggaat naar Meekijken, pauzeert, Spam Guard uitzet of RTFM-EV afsluit. Een privékanaal wordt pas op de node afgedwongen nadat je er op de Spam Guard-pagina bij Instellingen **Ook afdwingen op de OpenHop-node** voor aanvinkt, omdat de kanaalsleutel dan naar de node wordt gekopieerd. Naar een node waarop al SpamGuard draait wordt niets geschreven.

- **Overzicht** toont de modus, of alles werkt en hoeveel spam is gestopt of doorgelaten. Met meer dan één beschermd kanaal toont **Grafieken tonen voor** de grafieken van één kanaal (de getallen erboven blijven voor alle kanalen). Als je **Na het meekijken vanzelf naar Beschermen** aanzette (Instellingen, Tijden en limieten; standaard uit), zegt het Overzicht wanneer dat gebeurt of waarop het wacht, met **In Meekijken blijven** en **Opnieuw meekijken**.
- **Bescherming** toont de actieve blokkades, elk met de reden en wanneer ze eindigt. Elke automatische blokkade eindigt vanzelf. **Lockdown** is voor een zware aanval: een tijdlang komen alleen namen door die al bekend zijn. Onder **Mogelijk echt, tegengehouden** staan berichten van normaal ogende namen die zijn tegengehouden; **Doorlaten** vertrouwt die naam. **Lijst legen** maakt die lijst leeg. Met **Zelf iets blokkeren** voeg je een blokkade toe voor een tekst of een repeater; een repeaterblokkade kan voor één kanaal gelden, dat geeft minder regels. **Automatische blokkades wissen** verwijdert ze en houdt ze hooguit 24 uur tegen, net als een blokkade die je zelf verwijdert. Een tekst die je zelf blokkeert moet minstens 12 tekens hebben en houdt alleen namen tegen die Spam Guard niet kent: het blokkeert nooit wat bekende mensen zeggen. Tekstblokkades, en repeaterblokkades die ook bekende mensen tegenhouden, duren hooguit een week. Bij een grote golf (veel verzonnen namen via veel repeaters tegelijk) start Spam Guard zelf een lockdown van 15 minuten. **Bekende mensen** onderaan toont wie Spam Guard kent of nog leert: zoek een naam, **Vertrouwen** houdt die voorgoed, **Vergeten** laat iemand weer als nieuw tellen.
- **Berichten** toont wat het heeft gelezen en waarom het wel of niet ingreep. Corrigeer het met **Dit is spam** en **Geen spam**. Dezelfde twee knoppen staan bij elk kanaalbericht in de chat. Bij een gevangen bericht staat door welke blokkade en in welk kanaal. **Lijst legen** maakt alleen de lijst op het scherm leeg: Spam Guard blijft die berichten als bewijs gebruiken.
- **Spambronnen** toont via welke repeaters spam binnenkomt. **Verwijderen** haalt een repeater van de lijst tot er nieuwe spam langs komt.
- **Instellingen** bevat de kanalen die het leest (zoek een kanaal om het toe te voegen), elke instelling met een opmerking over de bijwerkingen, en de uitzonderingen (vertrouwde namen, repeaters die nooit worden geblokkeerd, toegestane teksten). Met **Een bewijslog bijhouden** aan bewaart het wat het las en je antwoorden Dit is spam / Geen spam, zoveel dagen als je instelt. Je kunt dat log downloaden, ook geanonimiseerd (namen vervangen door codes, om te delen), en het **herhalen** met de instellingen in het formulier om te zien wat die hadden tegengehouden. Een herhaling verandert niets. Onderaan staan bij **Opnieuw beginnen** twee losse resets: **Vergeet wat geleerd is** verwijdert elke blokkade (ook die van jou), de bekende namen en routes, de spambronnen, de lijsten en de cijfers; **Instellingen terug naar standaard** zet de instellingen en uitzonderingen terug naar die van een nieuwe installatie.
- Twee instellingen om te kennen. **Herhalingen blokkeren van** bepaalt wiens herhalingen de duplicaatonderdrukking tegenhoudt: andere namen die dezelfde tekst sturen (de eerste afzender mag het opnieuw sturen), alleen dezelfde naam, of iedereen. **Misvormde berichten als spam behandelen** markeert berichten met willekeurige tekens, of van een afzender met een nooit ingestelde klok, en telt ze als verzonnen naam.
- De **herhalingsbeveiliging** (bij Duplicaatonderdrukking) houdt één naam tegen die hetzelfde bericht steeds opnieuw stuurt: na 3 kopieën in 10 minuten wachten verdere kopieën van die naam een uur. De eerste kopieën en alles wat ze verder zeggen gaan gewoon door. **Onleesbare willekeurige tekst als spam behandelen** telt korte betekenisloze tekst van een naam die Spam Guard niet kent als verzonnen naam. Een voornaam met een willekeurig label erachter (zoals `Marco-7fq2k`) telt ook als verzonnen, een roepnaam achter een naam niet.
- Een naam is **bekend** na drie echte berichten. Een nieuwe Spam Guard leert zijn eerste bekende mensen uit de chat die het afgelopen etmaal is opgeslagen. Vaste gebruikers die door een blokkade worden geraakt terwijl ze via hun gewone repeater binnenkomen, blijven meetellen richting bekend, en vaste gebruikers die dezelfde groet sturen zijn nooit een spamcampagne.
- **Beleid** is er alleen met een OpenHop-radio. Het is de beleidseditor van de node zelf: de schakelaar van de engine, de groepen en de regels. De node doet het filteren. Zolang Spam Guard is ingeschakeld staat de editor hier en niet onder Instellingen > OpenHop; met Spam Guard uit staat hij daar weer.

Een repeater is gedeeld. Wat de jouwe niet doorstuurt verdwijnt voor iedereen erachter, en zij kunnen niet zien waarom. Er is bewust geen knop om iemand op naam te blokkeren. Een botlijst met **Doorsturen blokkeren** aan is de enige uitzondering: die houdt de namen tegen die je erop zet, zie **Botlijsten** onder Instellingen.

In de chat verbergt **Spam verbergen** in het filtermenu gemarkeerde berichten en houdt ze buiten ongelezen-tellers en meldingen. Een bericht dat de duplicaatonderdrukking als herhaling heeft gevangen krijgt de markering **Duplicaat**. Dat is geen spammarkering, dus het wordt niet verborgen.

**Profielen.** Op het tabblad **Instellingen** bewaart **Profielen** sets detectie-instellingen onder een naam, samen met de modus. Gebruik ze als de situatie verandert: een voor een spamgolf, een voor een evenement, een voor gewone dagen.

- **Huidige opslaan als profiel** bewaart de instellingen die nu gelden.
- **Toepassen** laat eerst elke instelling zien die verandert, met de oude en de nieuwe waarde. Een profiel dat naar **Beschermen** schakelt zegt dat en vraagt om je bevestiging, want vanaf dan stuurt je repeater niet meer door wat Spam Guard blokkeert.
- **In gebruik** noemt het profiel dat je het laatst hebt toegepast. Verander je daarna een instelling, dan staat er **gewijzigd** en kun je **Opslaan in profiel** of **Terugzetten** kiezen.
- **Exporteren** downloadt een profiel als bestand dat je aan iemand anders kunt geven. **Bestand importeren** voegt een profiel uit zo'n bestand toe. Importeren past het nooit toe: bekijk eerst wat het verandert.

Een profiel bevat nooit je beschermde kanalen, kanaalsleutels, uitzonderingen, de pauze of de instellingen van het bewijslog, en toepassen laat die ongemoeid. Niets schakelt vanzelf. Heeft het formulier eronder niet-opgeslagen wijzigingen, sla die dan eerst op of verwerp ze.

### SNMP

Alle nodes waarvoor op de contactpagina SNMP is ingesteld, in één tabel. Elke rij toont de status, de naam, het adres, het schema, de laatste geslaagde uitlezing en de laatste fout, met de belangrijkste waarden naast elkaar: firmwareversie, uptime, vrije heap, grootste vrije blok, verbonden MQTT-slots, diepte van de pakketwachtrij, wifi-RSSI, ruisvloer, ontvangstfouten, laatste RSSI en laatste SNR. Een node waarvan de laatste uitlezing mislukte, is rood gemarkeerd met **Mislukt** en staat bovenaan; de waarden zijn dan die van de laatste geslaagde uitlezing. Klik op een kolomkop om te sorteren.

Klik op een rij, of op de pijl ervoor, om de eigen pagina van die node te openen (zie hieronder). **Nu uitlezen** leest één node uit en **Alles nu uitlezen** leest ze na elkaar uit. Uitlezen gaat via je netwerk (UDP) en gebruikt nooit RF. **Automatisch verversen** leest alleen opnieuw wat de server heeft bewaard, elke 10, 30 of 60 seconden, of niet. Hoe vaak een node wordt uitgelezen stel je in met **Volgens schema uitlezen** op de contactpagina. Klik op de naam van een node om die pagina te openen.

De nodepagina toont één node volledig. Bovenaan staan de status, het adres, de laatste geslaagde uitlezing en het schema, met **Nu uitlezen** en **Contactpagina openen**. Kies een periode, van 20 minuten tot 30 dagen, of **Aangepast** met een begin en een einde. Tegels tonen de nieuwste waarden en hoe vaak de node in die periode is herstart. Daaronder staan grafieken van de bewaarde uitlezingen: uptime, pakketten, ontvangstfouten, zendtijd, ruisvloer, RSSI en SNR, MQTT-slots en wachtrijdiepte, geheugen en wifi-RSSI. Ze zoomen met het scrollwiel, verschuiven door te slepen en tonen waarden als je erboven hangt. Alle waarden van de nieuwste uitlezing staan onderaan. Nieuwere DMC observer-firmware meldt ook batterij, MCU-temperatuur, resetoorzaak, dubbele pakketten, duty cycle, foutvlaggen, de duty-gate, pakketfilter-drops en buren; een waarde die de node niet meldt wordt weggelaten, en een batterij of temperatuur die het bord niet kan meten toont **n.v.t.**. Elke herstart in de periode staat in een lijst met de oorzaak die de node ervoor gaf.

Pakketten, fouten, zendtijd en overgeslagen publicaties zijn tellers die alleen oplopen sinds de node is gestart. Met **Tellers** op **Per tijd** tonen de grafieken de toename tussen twee uitlezingen, per minuut, en zendtijd als percentage van de tijd; een herstart wordt weggelaten in plaats van als daling getekend. **Totalen** toont de tellers zelf. De grafieken hebben minstens twee bewaarde uitlezingen in de periode nodig, dus zet **Volgens schema uitlezen** aan voor een node die je wilt volgen.

### Netwerkscan

Zoekt MeshCore-apparaten op je lokale netwerk (wifi of bekabeld), gecontroleerd door de server, nooit via de radio. Vul een of meer adressen of netwerken in, zoals `192.168.1.0/24`; netwerken die de app al kent (het adres van je radio en van nodes met SNMP) staan onder het veld. Alleen lokale netwerkadressen kunnen gescand worden, maximaal 1024 per scan.

**SNMP opvragen** (standaard aan) vraagt elk adres om de MeshCore SNMP-waarden. Observer-repeaters, roomservers en meshcomod-companions met SNMP aan antwoorden met hun naam en firmware. Een apparaat met een andere community antwoordt helemaal niet, dus vul de community in die je gebruikt. Uitlezen via SNMP verandert niets op een apparaat.

**App-poort opvragen** (standaard uit) maakt verbinding met de poort van het companion-protocol (TCP 5000) en vraagt elk apparaat wat het is: companion, repeater, roomserver of sensor, met naam, model en firmware. Elk MeshCore-apparaat met app-toegang via wifi antwoordt, welke firmware het ook draait. Een standaard MeshCore wifi-companion bedient één app tegelijk, dus deze controle verbreekt de verbinding van de telefoon-app of een ander programma dat hem gebruikt. De radio die deze RTFM-EV gebruikt, wordt altijd overgeslagen.

**Webconfig-pagina opvragen** (standaard uit) vraagt elk adres om de statuspagina van een DMC observer-repeater of roomserver (HTTP-poort 80). Die antwoordt alleen zolang de webconfig-pagina op de node draait (gestart met `start webconfig`), ook als SNMP uit staat. De statuspagina heeft geen inlog nodig en er wordt niets veranderd; andere webservers op je netwerk komen niet in de lijst. Een node die zo gevonden is, wordt aan zijn contact gekoppeld op het begin van zijn publieke sleutel, en **Webconfig openen** opent zijn pagina in een nieuw tabblad.

Elk gevonden apparaat staat in de lijst met zijn adres, waarop het antwoordde en zijn firmware. Een apparaat dat bij een van je contacten hoort (op de publieke sleutel, of op een naam die maar één contact heeft) linkt naar dat contact, en **SNMP instellen** slaat het gevonden adres op bij het contact, met uitlezen op schema uit; de community die je invulde gaat mee. Andere SNMP-apparaten, zoals printers of routers, zijn verborgen tot je **Andere apparaten tonen** aanvinkt. De laatste resultaten blijven staan tot de volgende scan of een herstart van de server.

### Vloot

Het apparatenregister: één rij per apparaat dat je bijhoudt, met wat alleen jij ervan weet. Dat is je eigen label, het serienummer van de organisatie, het serienummer van de hardware, model, rol, wifi- en bluetooth-MAC-adres, aan wie het is toegewezen, de locatie, een status en notities. De status is **Op voorraad**, **Geplaatst**, **Onderhoud**, **Kwijt**, **Gestolen** of **Buiten gebruik**. Niets op deze pagina gebruikt de radio.

Een apparaat kan de publieke sleutel van een node hebben. Als een contact die sleutel heeft, toont de rij de naam van de node en wanneer die het laatst is gezien, en toont de pagina van het apparaat het type en de positie onder **Op de mesh**. Die waarden komen van het contact en worden niet gekopieerd, dus ze zijn altijd actueel. De sleutel is optioneel: je kunt een apparaat registreren dat nog in de doos zit, of de sleutel invullen van een node die nog niet is gehoord.

**Apparaat toevoegen** opent een leeg formulier. Een apparaat heeft minstens een label, een serienummer van de organisatie of een publieke sleutel nodig. **Mijn eigen nodes toevoegen** verschijnt als nodes waarvan deze radio de eigenaar is nog niet in het register staan, en voegt ze toe als **Geplaatst**. Op een contactpagina doet **Aan vloot toevoegen** hetzelfde voor die ene node en opent **Vlootgegevens openen** het bijbehorende apparaat. Zoeken kijkt in elk veld, de statuslijst beperkt de tabel, en een kolomkop sorteert die. **CSV exporteren** en **JSON exporteren** bewaren de rijen die worden getoond.

Op de pagina van een apparaat slaat **Opslaan** alleen op wat je hebt gewijzigd. **Apparaat verwijderen** vraagt om een tweede klik; het verwijdert het apparaat en laat het contact met rust. Een contact verwijderen verwijdert het apparaat ook niet. Met meer dan één radio heeft elke radio zijn eigen register.

**Logboek.** Elk apparaat heeft een logboek. Kies de soort regel (onderhoud, storing, plaatsing, houder, firmware of notitie), het tijdstip, wat er is gebeurd, en eventueel wie het deed en details, en kies **Regel toevoegen**. Als je een nieuwe status of een nieuwe naam onder **Toegewezen aan** opslaat, schrijft de app die wijziging zelf in het logboek, met de oude en de nieuwe waarde. De lijst toont de datum van het laatste onderhoud.

**Wat de node heeft gemeld.** Voor een apparaat met een publieke sleutel toont **Op de mesh** ook de accuspanning en temperatuur van de nieuwste opgeslagen telemetrie en de firmwareversie die de node het laatst heeft gemeld, met de herkomst: het eigenaarspaneel van de repeater, een SNMP-uitlezing of de verbonden radio zelf. De pagina vraagt dit nooit aan een node. Een node toont geen accu zolang hij niet op een van de lijsten met gevolgde telemetrie staat, en geen firmware zolang het eigenaarspaneel niet is opgehaald en SNMP niet is ingesteld.

**Aandacht nodig.** Een waarschuwingsteken in de lijst markeert een apparaat dat kwijt of gestolen is, en een geplaatst apparaat waarvan de node langer dan de limiet niet is gezien, waarvan de accu onder de limiet zit, of dat een andere firmware meldt dan de **Gewenste firmware**. Vink **Aandacht nodig** aan om alleen die te zien. De twee limieten staan onder **Aandachtsregels** (om te beginnen 48 uur en 3,5 volt). Voor een apparaat dat kwijt of gestolen is toont de apparaatpagina de laatst bekende posities van de node.

**Sleutelkluis.** Dit onderdeel bestaat alleen als de server is gestart met de kluis ingeschakeld (zie de geavanceerde README); anders zie je het niet. De kluis bewaart privésleutels en wachtwoorden van je apparaten, versleuteld. De eerste keer stel je een wachtwoordzin in: die is niet te herstellen, dus zonder die zin zijn de opgeslagen geheimen verloren. Daarna ontgrendel je ermee, en de kluis vergrendelt weer na 15 minuten zonder gebruik en als de server herstart. Op de pagina van een apparaat sla je een geheim op met een soort, een label en de waarde. De lijst toont alleen soort, label en datum. **Tonen** laat één waarde zien en **Verbergen** haalt hem weer van het scherm; elke keer tonen wordt in de auditlog vastgelegd. Een apparaat dat nog geheimen heeft kan niet worden verwijderd. Onder **Sleutelkluis** op de vlootpagina kun je de kluis vergrendelen, de wachtwoordzin wijzigen, alle geheimen **Exporteren** naar een bestand dat met een eigen wachtwoordzin is versleuteld, zo'n bestand **Importeren** en de auditlog lezen. Gebruik de kluis alleen via HTTPS: de pagina waarschuwt als dat niet zo is.

**Sleutel genereren.** Voor een apparaat zonder publieke sleutel biedt het kluisgedeelte een nieuw sleutelpaar aan. Je kunt de eerste hex-tekens opgeven die je wilt (hooguit vier) en kiezen dat de eerste twee bytes, of de eerste byte, bij geen enkele bekende node in gebruik zijn. De privésleutel gaat de kluis in en de publieke sleutel komt op het apparaat te staan. Er wordt niets naar een radio gestuurd: om de sleutel op een toestel te zetten toon je hem en voer je hem daar zelf in.

**Configuraties.** De pagina van een apparaat bewaart de configuratiebestanden van dat apparaat. **Importeren** neemt het bestand dat de Dutch MeshCore toolbox op de pagina USB config opslaat voor een repeater of roomserver, of het configuratiebestand van **Instellingen > Radio** voor een companion. Kies of het is wat het apparaat had (**Uitgelezen uit het apparaat**) of wat het moet hebben (**Gewenst**), en vul als je wilt de rol, de firmwareversie en een label in. De app kiest een profiel aan de hand van het bestand (standaard firmware, DMC-repeater, DMC-observer of companion); je kunt dat aanpassen. Elke import is een nieuwe regel, dus de lijst is ook de geschiedenis. Een repeater of room server aan een USB-kabel kan hier ook gelezen en ingesteld worden: zie **USB-kabel** hieronder.

Een opgeslagen configuratie bevat nooit een geheim. De privésleutel, wachtwoorden, tokens en sleutels in een bestand worden eruit gehaald bij het importeren. Is de sleutelkluis ontgrendeld, dan gaan ze de kluis in en toont de configuratie op hun plek **Geheim, in de kluis**. Staat de kluis uit of is hij vergrendeld, dan worden ze niet bewaard en vertelt de pagina hoeveel er zijn weggelaten: ontgrendel de kluis en importeer het bestand opnieuw om ze te bewaren. Heeft het apparaat een publieke sleutel en hoort de privésleutel in het bestand bij een andere, dan wordt het bestand geweigerd.

**Bekijken** toont een configuratie per onderdeel. **Vergelijken** laat zien wat afwijkt van een andere configuratie van hetzelfde apparaat; geheimen worden vergeleken op hun kluisregel en nooit getoond. **Exporteren** slaat het bestand weer op zonder de geheimen, onder de naam die de toolbox gebruikt. **Exporteren met geheimen** is er zolang de kluis ontgrendeld is, vraagt een tweede klik en wordt vastgelegd in het logboek; dat bestand bevat de geheimen als leesbare tekst. Een configuratie verwijderen laat de geheimen in de kluis staan. Een apparaat verwijderen verwijdert ook zijn configuraties.

**Wat de node meldde.** Een geopende configuratie laat ook zien waar hij afwijkt van wat de node het laatst meldde. De app kijkt naar wat hij al heeft opgeslagen voor de node met de publieke sleutel van het apparaat: de repeaterpanelen die je ervoor hebt geopend (**Node-info**, **Radio-instellingen**, **Advertentie-intervallen**, **Eigenaarsinfo**, **Regio's**) en zijn SNMP-polls. Vergeleken worden de naam, de positie, de radiowaarden, het zendvermogen, de airtime-factor, repeat, flood max, de advert-intervallen, de eigenaarsinfo en de thuisregio. Elk verschil staat er met het paneel waar het uit komt en wanneer dat is opgeslagen. Instellingen zonder opgeslagen waarde worden genoemd, zodat je ziet welk paneel je moet openen. Er wordt hier niets aan de node gevraagd, dus een opgeslagen waarde kan ouder zijn dan de huidige instelling van de node. Het bestand van een companion en een apparaat zonder publieke sleutel hebben niets om mee te vergelijken.

**Configuratiesjablonen.** **Opslaan als sjabloon** bij een geopende configuratie maakt er een sjabloon van zonder de naam, de positie en de geheimen. **Configuratiesjablonen** op de pagina Vloot toont ze. Een sjabloon heeft een document (JSON) en variabelen. Schrijf `{{name}}` in het document waar een variabele moet komen; `{{asset.label}}`, `{{asset.org_serial}}` en `{{asset.site_name}}` zijn er altijd. Een variabele is tekst, een getal, of ja of nee, en kan een standaardwaarde hebben. Een sjabloon bevat nooit een geheim: laat zo'n sleutel leeg of schrijf `{"$secret": null}`. Terug op de pagina van een apparaat vraagt **Maken uit een sjabloon** om de variabelen en slaat het resultaat op als een configuratie **Gewenst**.

**USB-kabel.** Onderaan het blok Configuraties opent **Apparaat verbinden** een repeater of room server die met USB op deze pc is aangesloten. Dat vraagt om Chrome of Edge, en de app geopend als `http://localhost:8000` op die pc (of via HTTPS); sluit de toolbox of een ander programma dat de poort gebruikt. **Apparaat lezen** toont de naam, rol, firmware, het board en de publieke sleutel, en of het dit apparaat uit het register is. **Opslaan als momentopname** bewaart de instellingen als configuratie, met de geheimen in de kluis zoals bij een geïmporteerd bestand. Een apparaat zonder publieke sleutel kan die van het aangesloten apparaat krijgen als je dat aanvinkt. Om een configuratie toe te passen kies je die en druk je op **Apparaat lezen en de wijzigingen tonen**: de app leest het apparaat opnieuw en toont elk verschil, elke opdracht op volgorde, en wat hij overslaat en waarom. De privésleutel schrijven en de radio wijzigen (frequentie, bandbreedte, SF, CR) hebben elk hun eigen vinkje, dat elke keer uit staat. Er wordt niets verstuurd voordat je aanvinkt dat je de opdrachten hebt nagekeken en op **Versturen** drukt. De opdrachten gaan een voor een, elke instelling wordt teruggelezen, en het toepassen stopt bij het eerste antwoord dat niet klopt. Het resultaat komt in het logboek van het apparaat. De app stuurt nooit `erase` of `reboot` en wijzigt de regioboom niet; herstart het apparaat zelf als een instelling dat nodig heeft. Niets hiervan gaat via de radio van deze app. Probeer het eerst op een reserve-apparaat, niet op de radio waar de app op draait.

**Apparaat in gebruik nemen.** Op de pagina Vloot neemt **Apparaat in gebruik nemen** een repeater of room server aan de USB-kabel in een keer door dit alles. Na **Apparaat lezen** zoekt het het apparaat in het register met dezelfde publieke sleutel, of biedt het aan er een te maken met de naam, rol en het board van het aangesloten apparaat. Een nieuw apparaat kan zijn eigen sleutel houden, of een nieuwe sleutel krijgen die in de sleutelkluis gemaakt wordt (de kluis moet ontgrendeld zijn). Daarna: de huidige instellingen opslaan als momentopname "voor" (niet bij een nieuwe sleutel, want die horen bij de oude sleutel), een sjabloon kiezen en de variabelen invullen, de gewenste configuratie toepassen met hetzelfde overzicht, dezelfde vinkjes en bevestiging als hierboven, **Apparaat opnieuw lezen en vergelijken**, het resultaat opslaan, en **Afronden** zet de status (geplaatst of op voorraad) en schrijft een regel in het logboek. Vink bij een nieuwe sleutel tijdens het toepassen **Ook de privésleutel schrijven** aan; het aangesloten apparaat is pas na een herstart het nieuwe apparaat, dus vergelijk na de herstart opnieuw.

### Pakketfeed

Een live lijst van elk pakket dat de radio hoort. Met **Filters** (pakkettype en padbreedte), pauzeren en hervatten, automatisch scrollen, oudste of nieuwste eerst, **Herhalingen groeperen op inhoud**, een hexfilter, **Statistieken tonen**, en een optioneel geluid per pakket (Geiger, Sonar of Waterdruppel). Klik op een pakket voor een uitsplitsing per byte. Elk pakket toont datum en tijd. Onder **Filters** verbergt **Misvormde verbergen** kanaalberichten met willekeurige tekens of van een afzender met een nooit ingestelde klok; je keuze wordt in deze browser onthouden.

Met een OpenHop-radio toont een pakket ook de beleidsregel die erover beslist, bijvoorbeeld **Drop-regel** gevolgd door de naam van de regel, in rood bij een drop. RTFM-EV bepaalt dat aan de hand van een kopie van het beleid van de node, dus het is een indicatie: de node zelf beslist, en een op de node gewijzigde regel kan een minuut op zich laten wachten. De regel wordt bij het pakket opgeslagen, dus de vermelding staat er ook nog na opnieuw laden en in de Pakketgeschiedenis. Onder **Filters** laat **Alleen pakketten waarover een beleidsregel besliste** al het andere weg.

### Pakketgeschiedenis

Hetzelfde soort lijst over alles wat in de database is opgeslagen. Kies 1, 3, 6, 12 of 24 uur of een datumbereik, en blader terug met **Ouder laden**. Filter op payloadtype, hopbreedte of hex, en zoek op berichttekst, afzender of kanaal. Selecteer rijen en kies **CSV exporteren**.

Met een OpenHop-radio tonen pakketten die zijn ontvangen sinds de update waarmee dit kwam ook de beleidsregel die erover besliste, net als in de Pakketfeed. Zoeken vindt een pakket op de naam van die regel, onder **Filters** staat **Alleen pakketten waarover een beleidsregel besliste**, en de CSV heeft een kolom voor de actie en een voor de regel. Een pakket dat meerdere keren is gehoord wordt één keer opgeslagen, met de regel van de eerste ontvangst. Hoe ver je terug kunt, hangt af van je instellingen voor databewaring.

### Pakket analyseren

Plak een ruw pakket als hex om het byte voor byte gedecodeerd te zien.

### Wie hoorde dit

Elke pakketuitsplitsing (vanuit de Pakketfeed, de Pakketgeschiedenis, een bericht of Pakket analyseren) heeft een onderdeel **Wie hoorde dit**. Het toont de pakkethash, die voor elke doorgestuurde kopie van één pakket gelijk is, en een link naar de pagina van het pakket op elke analyzersite die je met een pakketadres hebt ingesteld (Instellingen > Database).

**Vraag** stuurt die hash naar de analyzer die als externe kaartbron is ingesteld (standaard meshcore-analyzer.eu) en toont de observers daar die het pakket ontvingen, met regio, tijd, RSSI en SNR. Zo vergelijk je je eigen ontvangst met de rest van het netwerk. Er wordt niets verstuurd tot je op de knop drukt, en de analyzer krijgt de hash, niet het pakket. De analyzer kent alleen wat zijn eigen observers hoorden; een leeg antwoord betekent dus niet dat niemand het pakket hoorde.

### Mesh-visualisatie

Een 3D-grafiek van de mesh, opgebouwd uit live pakketten. Nodes zijn bollen en pakketten zijn geanimeerde bogen. Met de bediening stel je in welke nodes je ziet en hoe de grafiek beweegt, en **Wissen & resetten** begint opnieuw.

### Trace

Bouw een lus van repeaters en trace die terug naar je radio. Zoek repeaters op naam of sleutel en voeg ze toe in de volgorde waarin ze doorlopen moeten worden, of voeg een eigen hop toe als prefix van 1, 2 of 4 bytes. Kies daarna **Trace versturen**. De resultaten tonen de SNR per hop en een kleine kaart. Dit verstuurt iets via RF.

### Berichten zoeken

Zoeken in de volledige tekst van directe berichten en kanaalberichten. Gebruik `user:` of `channel:` om te verfijnen (zet namen met spaties tussen aanhalingstekens). `region:` filtert op de regio waarmee een bericht is verzonden: een regionaam, `region:none` voor berichten zonder regio, of `region:unknown` voor een regio die deze app niet kan benoemen. Klik op een resultaat om naar dat bericht te springen.

### Channel Registry (Kanaalregister)

Een lokale catalogus van bekende kanalen. Het is een naslaglijst, niet de lijst met kanalen die de app volgt. Je kunt items toevoegen, bewerken, filteren, importeren en exporteren, synchroniseren vanaf een externe lijst, en met **Aan kanalen toevoegen** een kanaal gaan volgen. Privé-items worden nooit geëxporteerd. In een kanaal opent het registerpictogram in de kop (of **Bewerken in Kanaalregister** in het kanaalinfopaneel) het item van dat kanaal direct in bewerkmodus; ontbreekt het, dan wordt het eerst toegevoegd.

### Kanaalzoeker

**Kanaalzoeker tonen** opent een paneel dat probeert de namen te vinden van kanalen waarvan je geen sleutel hebt, met woordenlijsten en brute force op je GPU. Met **Woordenlijsten** kies je welke lijsten meedoen, in elke combinatie: Engels, Nederlands, **Bekende kanalen (MCCL)** (een korte lijst met kanaalnamen die op het netwerk zijn gezien, standaard aan) en lijsten die je zelf uploadt. Dat vereist een browser met WebGPU (bijvoorbeeld Chrome of Edge 113 of nieuwer) en HTTPS wanneer je niet op `localhost` werkt. Gevonden kanalen kunnen opgeslagen pakketten ontsleutelen.

### Kennisbank

Je eigen lijst met handige links, gegroepeerd per categorie. **Link toevoegen** maakt een nieuwe aan; het kruisje haalt een link uit de Kennisbank maar laat hem staan in Instellingen > Handige Info > Links. Daar zet het boekpictogram bij elke link (ingebouwd of eigen) hem in of uit de Kennisbank.

### Gebruikershandleiding

Deze pagina. Open hem via Hulpmiddelen of met het adres `#manual`. Hij volgt de taal van de interface. Klik op een kop in de inhoudsopgave om naar dat hoofdstuk te springen.

<!-- id: settings -->

## Instellingen

Open Instellingen met de knop in de bovenbalk. Op een telefoon klapt elke sectie ter plekke uit.

### Radio

- **Verbinding:** Opnieuw verbinden, en **Verbinding verbreken**, dat automatisch opnieuw verbinden pauzeert zodat een ander apparaat de radio kan gebruiken. Heb je loadouts, dan biedt Verbinding verbreken aan er eerst een te laden.
- **Identiteit:** radionaam, privésleutel (alleen schrijven) en je `meshcore://`-contactlink.
- **Radio’s:** elke radio die met deze installatie verbonden is geweest, met de eerste en laatste verbindingstijd, ook als er geen radio verbonden is. De laatst verbonden radio heeft het label **Huidig**. Een radio met **Wacht op antwoord** kun je hier beantwoorden (zie Van radio wisselen). Bij een vervangen radio kun je wijzigen wat de nieuwere radio overneemt, of **Vervangingskoppeling verwijderen**. Elke radio heeft een eigen notitie (**Notitie opslaan**). Elke radio behalve de huidige kun je verwijderen met **Radio verwijderen**. Je moet dit bevestigen en kunt aanvinken dat ook de geschiedenis van batterij, ruisvloer en zendtijd van die radio wordt verwijderd. Niet aangevinkt blijft die geschiedenis bewaard zonder radio en staat ze op Mijn node onder "Voor radio-registratie". Contacten, berichten en pakketten blijven ongewijzigd.
- **Radioparameters:** voorinstelling, frequentie, bandbreedte, spreading factor, coding rate, zendvermogen en padhashmodus (1, 2 of 3 bytes per hop, als de firmware het ondersteunt).
- **Locatie**, telemetrie delen, en **Adverteren & Ontdekken** (advertinterval en knoppen om een advert te versturen).
- **Berichten:** extra ACK's, **Onbeantwoorde Kanaalberichten Automatisch Opnieuw Verzenden** en de standaard floodscope.
- Bekende regio's voor het decoderen van pakketten met een regioscope, inclusief **Nederlandse scopes laden**.
- **Max Contacten op Radio**, **Configuratie Exporteren** en **Importeren en Herstarten**.
- **Vermeldingsticker Tonen**, **Vermelde kanalen automatisch aan register toevoegen** en de **Externe analyzer-node-laag**.
- Op meshcomod-firmware (DMC-EV) een paneel **Meshcomod (DMC-EV)** met CAD- en GPS-instellingen. Builds met het ontvangstfilter krijgen een kaart **Companion-ontvangstfilter**: filterinstellingen, afzender- en tekstregels, geblokkeerde padprefixen, tellers van verborgen berichten met een grafiek, en een back-up per radio die je na het flashen kunt terugzetten. Het draait op de radio en zendt nooit uit.
- meshcomod toont ook een contact **Meshcomod**. De chat daarmee is de eigen opdrachtregel van je radio: wat je daar stuurt (`help`, `status`, `wifi scan`, `wifi status`, `tcp on`/`off`, `ble on`/`off`, `ota check` en meer) draait op de radio en gaat nooit via LoRa de lucht in, en de radio antwoordt in dezelfde chat. Knoppen boven de chat zetten een veelgebruikte opdracht in het berichtveld. Opdrachten die de radio herstarten of de app van de radio kunnen afsluiten (`reboot`, `bootloader`, `ota update`, `wifi off`, `wifi clear`, `tcp off`, `ble off`) vragen eerst om bevestiging. De opdrachtregel in **Instellingen > Radio** en op **Mijn node** neemt deze opdrachten ook aan: hij stuurt ze naar het Meshcomod-contact en toont het antwoord, dat ook in deze chat verschijnt. De chat gaat niet naar MQTT, Home Assistant of andere koppelingen en geeft geen meldingen; trace, padontdekking, telemetrie en de toestemmingsschakelaars zijn voor dit contact verborgen.

### Host-repeater

RTFM-EV kan elk ontvangen pakket beoordelen zoals een repeater dat zou doen. **Schaduwmodus** telt wat doorgestuurd of weggegooid zou worden en stuurt nooit iets door. Regiofilters, een zendtijdbudget, timing en beleidsregels zijn instelbaar, met live statistieken. Live herhalen (gewapende modus) vereist de serverinstelling `MESHCORE_HOST_REPEATER_ENABLED=true`, ondersteunde firmware, een toegestane frequentieband en een uitdrukkelijke bevestiging. **Ontwapenen (noodstop)** stopt het, en na een herstart is hij altijd ontwapend. Zorg dat je op jouw locatie een repeater mag gebruiken. Het **DMC-pakketfilter** volgt de DMC-observerfirmware: hop- en snelheidslimieten, geblokkeerde kanalen en padprefixen, afzender- en tekstregels, een advertvenster per node, een maximale berichtleeftijd en een **Dry-run**-schakelaar die alleen telt. Het optionele **Buren opvragen** zendt uit: elke 12-336 uur stuurt het één zero-hop discover en vraagt het elke naburige repeater naar zijn regio’s.

### Lokale configuratie

Instellingen voor deze browser of dit apparaat: taal, kleurthema (inclusief vier CRT-fosforthema's) en CRT-schermeffecten, het **Bureaubladmaatje** (nadat je het thema Windows 95 hebt gebruikt), branding (appnaam en pictogram, gedeeld door alle apparaten), een lokaal label, **Afstandseenheden**, **Coördinaatformaat**, **Datum- en tijdnotatie**, relatieve lettergrootte, **Toegankelijkheid** (een kleurenblindmodus en een leeslettertype voor dyslexie, bovenop elk thema), UI-aanpassingen (zoals laatste gesprek opnieuw openen, batterijweergave en **Vervangen tijdens het typen**), het geluid bij vermeldingen en DM's, meldingen voor nieuwe nodes, **Chatverwerking** en **Web Push-meldingen**. **Doorsturen naar aanmelden** is voor een installatie achter een reverse proxy die het aanmelden regelt: als de sessie is verlopen gaat de app naar het adres dat je invult, of wordt de pagina opnieuw geladen als het veld leeg is.

### Botlijsten

Een botlijst noemt bekende bots: een exacte afzendernaam, met optioneel een publieke sleutel en een notitie. De lijsten staan onder **Instellingen > Lokale configuratie > Botlijsten**.

- **Schakel** een lijst **in** en de afzenders erop krijgen in de chat een **Bot**-markering. Een naam moet exact overeenkomen, hoofdletters inbegrepen, dus iemand die dezelfde naam gebruikt wordt ook gemarkeerd. **Nooit een bot** haalt een naam eruit, op welke lijst hij ook staat.
- **Bots verbergen** (daar, of in het filtermenu van de chat) verbergt afzenders van de lijsten in de chat en houdt ze buiten ongelezen-tellers, vermeldingen en meldingen. Zoeken toont ze nog wel.
- **Nieuwe lijst** maakt een eigen lijst en **Namen** opent hem om te bewerken. In de chat bieden de acties van een bericht **Toevoegen aan botlijst** en, voor een naam die op een lijst staat, **Geen bot**.
- **Exporteren** schrijft een lijst naar een bestand. **Bestand importeren** bewaart zo'n bestand als een nieuwe eigen lijst, uitgeschakeld, zodat je hem kunt lezen voordat je hem inschakelt.
- **Abonneren op URL** vraagt het `https`-adres van een lijstbestand. De lijst wordt eerst getoond, daarna alleen-lezen en uitgeschakeld bewaard, en één keer per dag ververst; **Nu verversen** doet dat meteen. De host van de lijst ziet bij elke verversing je internetadres. Een verversing die mislukt laat de namen staan die je had en toont waarom.
- Eén lijst wordt met RTFM-EV meegeleverd. Die is alleen-lezen en staat uit tot je hem inschakelt.
- **Doorsturen blokkeren** (per lijst, standaard uit) zorgt dat je repeater kanaalberichten van de namen op die lijst niet meer doorstuurt. Het werkt via Spam Guard: alleen in **Beschermen**, op de beschermde kanalen, en in de ether alleen zolang de host-repeater gewapend is of de regels op de OpenHop-node staan. De regel onder de schakelaar zegt **Actief op N kanalen**, of waarop gewacht wordt.
- Namen die een verversing aan een abonnement toevoegt worden meteen gemarkeerd in de chat, maar je repeater stopt pas met doorsturen nadat je ze hebt bevestigd. De lijst toont dan **N nieuwe namen om te beoordelen**, met **Bevestigen**, **Alles bevestigen** en **Geen bot**. Wie Doorsturen blokkeren inschakelt voor een abonnement krijgt eerst de namen te zien.

Doorsturen blokkeren houdt alleen je eigen repeater tegen: andere repeaters sturen het bericht nog door, en het komt nog steeds bij jouw node aan. Het geldt alleen voor kanaalberichten, want een repeater kan niet zien wie een direct bericht stuurde. Wie onder een naam van de lijst schrijft, wordt ook tegengehouden.

### MQTT en automatisering

Integraties (zie Integraties).

### OpenHop

Alleen zichtbaar als de verbonden node een OpenHop-node is. Stel het adres en de token van de OpenHop-API in en beheer daarna configuratie, systeem, updates, beleid en plugins. Acties met echte gevolgen vragen om bevestiging.

### Radio-app-beheer

**Gevolgde Repeatertelemetrie** en **Gevolgde Contacttelemetrie**, namen opzoeken voor naamloze contacten, **Contactbeheer** (nieuwe nodetypen blokkeren, geblokkeerde sleutels en namen, verwijderen in bulk), **Loadouts**, en **Synchronisatie deels bekende nodes**, dat nodes die je alleen van een prefix kent vergelijkt met de nodelijst van de analyzer. Je beoordeelt elke match voordat hij als omkeerbare zachte koppeling wordt opgeslagen. Telemetrie wordt één keer per uur verzameld, op de **Minuut van het uur** die je bij Gevolgde Repeatertelemetrie instelt. **Automatisch** leidt een minuut af van de sleutel van je radio; geef nodes die dicht bij elkaar staan verschillende minuten, zodat hun verzoeken niet tegelijk de lucht in gaan.

**SNMP-agent** (standaard uit) laat een monitoringsysteem zoals LibreNMS of Zabbix deze node via SNMP uitlezen, met de 22 waarden van de eerste observer-firmwareversie. Stel de UDP-poort en een eigen community in; publiceer in Docker ook de poort. De agent is alleen-lezen en gebruikt de radio nooit.

### Kaart

De startweergave van de kaart en de **Kaarttegelcache** (zie Back-up, herstel en databewaring).

### Database

Databaseoverzicht, opslag opruimen, **Databewaring**, back-up en herstel, en synchronisatieadressen voor het kanaalregister, de woordenlijst van de kanaalzoeker en externe analyzers.

### Handige Info

**Instellen** toont externe node-analyzers en synchronisatiebronnen. Namen opzoeken via een analyzer stuurt per opzoeking maar één publieke sleutel, en alleen als je op een knop drukt. **Links** bevat handige naslagsites; met het boekpictogram bij een link verschijnt hij in Hulpmiddelen > Kennisbank.

### Over

Versie, links naar de changelog en het melden van bugs, een updatecontrole, en **Debug-ondersteuningssnapshot openen**.

<!-- id: integrations -->

## Integraties

Open **Instellingen > MQTT en automatisering** en kies **Integratie toevoegen**. Soorten:

- **Privé-MQTT:** berichten doorsturen naar je eigen broker, ruw en/of ontsleuteld. Ontsleutelde berichten gaan als platte tekst, dus gebruik een broker die je vertrouwt.
- **Community MQTT/meshcoretomqtt:** een feed van ruwe pakketten voor community-aggregators, zodat je radio als observer kan dienen. Regionale voorinstellingen zijn ingebouwd.
- **Home Assistant MQTT Discovery:** apparaten en entiteiten verschijnen automatisch in Home Assistant: een apparaat voor de lokale radio, een berichtgebeurtenis, telemetriesensoren voor gevolgde repeaters en GPS-trackers voor gekozen contacten. Repeaters moeten eerst gevolgd worden voor telemetrie voordat ze in de keuzelijst verschijnen.
- **Webhook:** ontsleutelde berichten naar een URL, optioneel ondertekend.
- **Apprise:** stuurt berichten door naar Discord, Telegram, e-mail en vele andere diensten.
- **Amazon SQS:** ruwe of ontsleutelde pakketten naar een wachtrij.
- **Kaartupload:** uploadt gehoorde repeaters en roomservers naar map.meshcore.io of een vergelijkbaar eindpunt, met een proefmodus en een optionele geofence.

Elke integratie heeft een **Berichtbereik**: alle berichten, geen, alleen de opgegeven kanalen en contacten, of alles behalve de opgegeven.

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
