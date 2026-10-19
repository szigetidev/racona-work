---
title: Projektek és munkanapló
category: racona-work
tags: [projekt, projektek, új projekt, projektvezető, projekttag, tag, munkanapló, munkaidő, rögzítés, bejegyzés, óra, hiányzó bejegyzés, emlékeztető, eszkaláció, lezárás, visszanyitás, riport, csv export]
aliases: [timesheet, óranyilvántartás, munkaidő-nyilvántartás, logolás, órák beírása, feladat rögzítése, projektriport, kimutatás, projekt lezárása, project lead]
last_updated: 2026-10-07
---

# Projektek és munkanapló

## Rövid összefoglaló
A Projektek menüben hozhatók létre a szervezet projektjei, itt kezelhetők a tagjaik, és itt rögzítik a dolgozók a munkájukat (munkanapló). Minden projektnek lehet projektvezetője, aki a saját projektjét kezelheti és lezárhatja. A Riport fül összesíti a ledolgozott órákat, a lezárt projekt munkanaplója pedig nem módosítható. Bekapcsolható egy esti emlékeztető is, ha valaki egy munkanapra nem rögzített munkát.

## Elérés
**Elérési út:** Work → Projektek → Projekt lista; Work → Projektek → Új projekt; Work → Beállítások → Munkanapló
**Ki használhatja:**
- Projektek megtekintése: „Összes projekt megtekintése” (mindegyik projekt) vagy „Saját projektek megtekintése” (azok, amelyeknek tagja vagy).
- Új projekt: „Projekt létrehozása” jog (alapból Szervezet adminisztrátor, Projektkezelő).
- Projekt szerkesztése, tagok, törlés: „Projektek kezelése” jog vagy az adott projekt projektvezetője.
- Lezárás és visszanyitás: „Projekt lezárása és visszanyitása” jog vagy az adott projekt projektvezetője.
- Munka rögzítése: „Munkanapló rögzítése” jog (alapból Dolgozó, Projektkezelő, Szervezet adminisztrátor), a projekt tagjaként.
- Mások bejegyzéseinek megtekintése, módosítása és törlése, rögzítés más nevében, Riport: „Összes munkanapló megtekintése” jog (alapból Szervezet adminisztrátor, Projektkezelő, HR felelős), „Projektek kezelése” jog vagy az adott projekt projektvezetője.
- Munkanapló-figyelés beállítása: „Projektek kezelése” jog szervezeti szinten.

## Projekt lista
A Work → Projektek → Projekt lista kártyákon mutatja a projekteket: név, leírás, státusz (Aktív, Szünetel, Befejezett, Archivált), kezdés és befejezés, tagok száma, létrehozó. A lezárt projekt kártyáján „Lezárva” jelvény van. Kereshetsz név vagy leírás alapján, és szűrhetsz státuszra (Összes, Aktív, Szünetel, Befejezett, Archivált). A kártyára kattintva nyílik a projekt adatlapja.

## Új projekt létrehozása
1. Work → Projektek → **Új projekt** (vagy a Projekt lista **+ Új projekt** gombja).
2. Töltsd ki: Projekt neve (kötelező), Leírás, Státusz, Kezdő dátum, Záró dátum. A záró dátum nem lehet korábbi a kezdő dátumnál.
3. **Projekt létrehozása**.

A projekt adatlapja nyílik meg. A létrehozó „Tulajdonos” szereppel a projekt tagja lesz; ez csak címke, külön jogot nem ad.

## Projekt adatlap fülei
- **Áttekintés**: a projekt adatai; jogosultsággal a fejlécben **Szerkesztés** gomb.
- **Tagok**: a projekt tagjai és szerepük.
- **Munkanapló**: a rögzített munkabejegyzések (akinek van joga munkát rögzíteni).
- **Riport**: összesítések (a riporthoz jogosultaknak).
- **Kategóriák**: a projekt saját munkakategóriái (kezelési joggal vagy projektvezetőként).
- **Beállítások**: lezárás, visszanyitás, törlés (kezelési vagy lezárási joggal).

## Projekttagok kezelése
1. Projekt adatlap → **Tagok** fül → **+ Tag hozzáadása**.
2. Válassz dolgozót, és add meg a **Szerep a projektben** értékét (pl. Tag — Általános résztvevő, Tag — Fejlesztő, Tag — Tesztelő, Tag — Külsős, Projektvezető).
3. Mentés.

A tag szerepe a listában közvetlenül módosítható, és a tag eltávolítható. Külsős dolgozó is felvehető tagnak. Munkát csak a projekt tagja rögzíthet.

Ha a projektnek több aktív kategóriája van, a tagok mellett **Alapértelmezett kategória** is választható. A munka rögzítésekor ez van előre kiválasztva az adott dolgozónak (a munkanaplóban, telefonon és a Heti rögzítésben is). Ha a projektnek csak egy kategóriája van, az magától ki van választva.

## Projektvezető kijelölése
A projektvezető a saját projektjét akkor is kezelheti (adatok, tagok, munkanapló, riport) és lezárhatja, ha a szervezetben nincs ilyen szerepe. Más projektekhez ettől nem kap jogot.

Kijelölés: Tagok fül → a tag szerepét állítsd **Projektvezető**-re (vagy új tagnál ezt válaszd). Projektvezetőt csak az jelölhet ki vagy vehet el, aki a projektet le is zárhatja (pl. Projektkezelő, Szervezet adminisztrátor vagy egy másik projektvezető). A 0.15.0 verziótól a projektszintű Jogosultságok fül megszűnt, helyette a projektvezető szerep használható.

## Munka rögzítése a munkanaplóban
1. Projekt adatlap → **Munkanapló** fül → **+ Új bejegyzés**.
2. Töltsd ki: Feladat címe (kötelező), Kategória (a projekt saját listájából; kötelező, ha a projektnek van aktív kategóriája), Leírás, Dátum, Óra.
3. Mentés.

Az óraszám 0,25 és 24 között lehet. A dátum nem lehet korábbi a projekt kezdő dátumánál. Aki mások munkáját is kezeli (pl. Projektkezelő, projektvezető), a **Kinek a nevében** mezőben más tag nevére is rögzíthet.

A listában a Saját és az Összes nézet között válthatsz (ha mások bejegyzéseit is láthatod), szűrhetsz dátumra (-tól, -ig) és dolgozóra. Felül az „Összesen: … óra” összeg látszik. A saját bejegyzésedet szerkesztheted és törölheted; másokét a projektvezető és a Projektkezelő.

## Heti rögzítés

A **Projektek → Heti rögzítés** menüpontban projektbe lépés nélkül rögzítheted a napi munkáidat.

1. A hét napjai kártyákon látszanak a már rögzített munkákkal és a napi összeggel; a hetek között a nyilakkal, vissza az **Ez a hét** gombbal lépsz.
2. A nap **+ Munka** gombjával válaszd ki a projektet (csak a nyitott projektek, amelyeknek tagja vagy), a kategóriát (ha a projektnek van; az alapértelmezett előre ki van választva), és add meg az órát.
3. A **Feladat** nem kötelező: üresen a kategória (kategória nélküli projektnél a projekt) neve lesz.

Egy bejegyzésre kattintva szerkesztheted, a ✕ gombbal törölheted. Akinek „Összes munkanapló megtekintése” joga van (pl. Szervezet adminisztrátor), a **Dolgozó** választóval más dolgozó hetét is megnyithatja, és a nevében rögzíthet.

## Munka rögzítése telefonon
Telefonon a Work **Munka rögzítése** gyorsművelete egy nap összes saját bejegyzését mutatja minden projektből. Az Előző nap és Következő nap gombokkal lapozhatsz, a **Munka rögzítése** gombbal új bejegyzést veszel fel, egy bejegyzésre koppintva szerkesztheted vagy törölheted. A Projekt listában csak a nyitott (nem lezárt) projektek szerepelnek, a legutóbb használt előre ki van választva. Külsős dolgozó is használhatja. Részletek: az Értesítések és mobil használat leírásban.

## Hiányzó munkanapló-bejegyzések figyelése
A munkanapló-figyelés este emlékezteti a dolgozót, ha egy munkanapjára egyik projektbe sem rögzített munkát. Beállítás: Work → Beállítások → **Munkanapló**.
1. Kapcsold be: **Figyelés bekapcsolva**. Minden nap 23:55-kor fut.
2. **Figyelt napok** (0–30, alapból 5): a mai nap és az előtte lévő ennyi nap hiányzó munkanapjairól megy emlékeztető. 0 esetén csak a mai napról.
3. **Eszkaláció címzettjei**: legfeljebb 10 email cím (jellemzően a projektvezetőé), soronként vagy vesszővel. Üresen nincs eszkaláció.
4. **Kihagyott dolgozók**: akiket a figyelés ne vizsgáljon.
5. Mentés.

Az oldal kiírja, mely napokról megy ma este emlékeztető, és mutatja az utolsó futás eredményét.

## Kit és mely napokat figyel a munkanapló-figyelés
Az aktív, nem külsős dolgozókat figyeli (a külsősök a kihagyási listában sem szerepelnek). Csak a munkanaptár szerinti munkanapok számítanak; kimarad a hétvége, a munkaszüneti nap, a jóváhagyott szabadság, valamint a belépés előtti és a kilépés utáni nap. Bármely projektbe rögzített, bármekkora bejegyzés elég.

A dolgozó minden este egy emailt és rendszeren belüli értesítést kap a még hiányzó napjairól, amíg pótolja őket. **Eszkaláció**: ha egy nap úgy esik ki a figyelt napok közül, hogy még mindig hiányzik, a beállított címzettek egyszer jelzést kapnak róla. Az emailek az Értesítések oldalon a Munkanapló csoportban kapcsolhatók ki.

## Projekt lezárása és visszanyitása
Lezárt projektnél a munkanapló zárolt: új bejegyzés nem rögzíthető, a meglévők nem módosíthatók és nem törölhetők. A projekt adatai és tagjai sem módosíthatók.

1. Projekt adatlap → **Beállítások** fül → **Projekt lezárása** → megerősítés.
2. A fejlécben és a listán „Lezárva” jelvény jelenik meg (a jelvény fölé állva látszik, ki és mikor zárta le).

Visszanyitás: ugyanitt **Projekt visszanyitása**; ezután a feladatok újra rögzíthetők és módosíthatók. A lezárt projekt nem törölhető, előbb vissza kell nyitni. A státusz (Aktív, Befejezett stb.) a lezárástól független.

## Munkakategóriák projektenként

Minden projektnek saját kategórialistája van. A **Kategóriák** fület az látja, akinek „Projektek kezelése” joga van, valamint a projekt projektvezetője.

- **Új kategória:** név megadásával; egy projekten belül két azonos nevű nem lehet.
- **Átvétel…:** kategóriák másolása a szervezet egy másik projektjéből vagy a **Régi közös listából** (a korábban minden projektre érvényes lista). Csak az aktívak jönnek át, a már meglévő nevek kimaradnak.
- **Átnevezés**, sorrend (nyilak), **Inaktiválás / Aktiválás:** az inaktív kategória új bejegyzéshez nem választható, a régi bejegyzéseken megmarad.
- **Törlés (✕):** csak olyan kategóriánál, amelyet egy bejegyzés sem használ.

Amíg a projektnek nincs aktív kategóriája, a munkanaplóban nem kötelező kategóriát választani. Lezárt projekt kategóriái nem módosíthatók.

## Projekt riport
A **Riport** fül a projekt munkáját összesíti. Látja, akinek „Összes munkanapló megtekintése” vagy „Projektek kezelése” joga van (alapból Szervezet adminisztrátor, Projektkezelő, HR felelős), valamint a projekt projektvezetője.
- **Áttekintés**: Összes logolt óra, Bejegyzések száma, Aktív tagok, Átlag óra / aktív nap, Első és Utolsó bejegyzés.
- **Idővonal**: eltelt és hátralévő napok (lezárt projektnél rejtett).
- **Dolgozónkénti bontás** és **Kategóriánkénti bontás**.
- **Utolsó 30 nap** grafikon; dátumszűrővel **Napi bontás (szűrt időszak)**.
- **Teljes időszak (első és utolsó bejegyzés között)** grafikon; hosszú projektnél egy oszlop több napot összegez.
- **Inaktív tagok** (14 napja nem logoltak) és **Legutóbbi bejegyzések**.

A dátumszűrővel (-tól, -ig) szűkíthető az időszak. A „Feladatok exportálása CSV-be” gomb a bejegyzéseket CSV fájlba menti (a szűrt időszakra).

## Gyakori kérdések
**Miért nem tudok munkát rögzíteni a projektre?** Munkát csak a projekt tagja rögzíthet. Kérd a projektvezetőt vagy a Projektkezelőt, hogy vegyen fel a Tagok fülön.

**Miért nem jelenik meg az Új bejegyzés gomb?** A projekt le van zárva. Csak a visszanyitás után lehet rögzíteni.

**Miért nem választhatok korábbi dátumot?** A bejegyzés napja nem lehet korábbi a projekt kezdő dátumánál.

**Hogyan lesz valaki projektvezető?** A Tagok fülön a szerepét Projektvezetőre kell állítani. Ezt az teheti meg, aki a projektet le is zárhatja.

**Miért kapok minden este emailt a munkanaplóról?** Mert valamelyik munkanapodra nincs bejegyzésed. Rögzíts munkát arra a napra, és az emlékeztető megszűnik.

**Miért nem látom a Riport fület?** A riporthoz „Összes munkanapló megtekintése” vagy „Projektek kezelése” jog kell, vagy hogy a projekt projektvezetője legyél. A jogot a Beállítások → Jogosultságok oldalon lehet egy szerephez megadni.
