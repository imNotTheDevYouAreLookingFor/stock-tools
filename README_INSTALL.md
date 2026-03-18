# Avanza Utility Tools - Installation

Hej! Här är guiden för att installera tillägget i Google Chrome.

Eftersom detta tillägg inte ligger på Chrome Web Store måste det installeras manuellt via "Utvecklarläge". Det är säkert och enkelt.

## Instruktioner

1.  **Ladda ner och Packa upp**
    - Spara mappen `courtage` på din dator (t.ex. på Skrivbordet). Se till att den är uppackad (inte en .zip-fil).

2.  **Öppna Chrome Tillägg**
    - Öppna Chrome.
    - Skriv in `chrome://extensions` i adressfältet och tryck Enter.

3.  **Aktivera Utvecklarläge**
    - Uppe i högra hörnet finns en spak som heter **"Utvecklarläge"** (Developer mode). Slå PÅ den.

4.  **Ladda tillägget**
    - En ny meny dyker upp högst upp till vänster. Klicka på knappen **"Läs in okomprimerat..."** (Load unpacked).
    - Välj mappen `courtage` som du packade upp i steg 1.

5.  **Klart!**
    - Tillägget är nu aktivt! Klicka på ikonen i Chrome för att öppna inställningarna.

---

## Funktioner

### Courtage Optimizer
Tillägget kollar beloppet du skriver in i köprutan och räknar ut vilken courtageklass som är billigast (Mini, Small, Medium, Fast Pris – eller PB-klasserna för Private Banking-kunder). Om det lönar sig byter den automatiskt klass åt dig i bakgrunden, och en grön notis visas i hörnet.

- **Automatiskt läge** – byter klass automatiskt vid varje order
- **Manuellt läge** – visar knappar så du väljer själv
- **Återställ efter order** – byter tillbaka till din standardklass efter genomförd order
- **Standard- och Private Banking-tier** – stöd för båda klassuppsättningarna

### Privacy Mode
Döljer känsliga ekonomiska värden på Avanza – totalt kontovärde, innehav, inköpsvärde, marknadsvärde m.m. Hover-to-peek: håll musen över ett dolt värde för att tillfälligt se det.

- Täcker toppbaren (Totalt värde, Tillgängligt för köp, Utveckling)
- Täcker innehavskortet på aktiesidor
- Täcker portföljtabellen och summering
- **Toggle:** Popup-knappen eller `Alt+P`

### Dölj loggor
Tar bort bolagsloggor från börsskärmen (vinnare/förlorare, bevakningslistor m.m.) för ett renare gränssnitt.

- **Toggle:** Popup-knappen eller `Alt+L`

---

## Inställningar

Klicka på tilläggets ikon i Chrome för att öppna inställningspanelen:

| Inställning | Beskrivning |
|---|---|
| Automatiskt läge | Slår på/av automatisk courtagebyte |
| Default-klass (efter order) | Vilken klass som återställs till efter order |
| Återställ efter order | Om klassen ska återställas efter genomförd order |
| Privacy mode | Döljer ekonomiska värden på sidan |
| Dölj loggor | Tar bort bolagsloggor från börsskärmen |
