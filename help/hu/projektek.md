---
title: Projektek
description: Projektek létrehozása, tagok, projektvezető, lezárás és riport
sidebar:
  order: 4
---

A **Projektek** menüben hozhatók létre a szervezet projektjei, itt kezelhetők a tagjaik, és a projektekben rögzítik a dolgozók a munkájukat (lásd: [Munkanapló](./munkanaplo.md)). Minden projektnek lehet projektvezetője, aki a saját projektjét kezelheti és lezárhatja.

> **Hol találod?** **Projektek → Projekt lista**, illetve **Projektek → Új projekt**
>
> - Megtekintés: „Összes projekt megtekintése” (minden projekt) vagy „Saját projektek megtekintése” (amelyeknek tagja vagy).
> - Új projekt: „Projekt létrehozása” jog (alapból Szervezet adminisztrátor, Projektkezelő).
> - Szerkesztés, tagok, törlés: „Projektek kezelése” jog, vagy ha te vagy a projekt projektvezetője.
> - Lezárás és visszanyitás: „Projekt lezárása és visszanyitása” jog, vagy ha te vagy a projekt projektvezetője.

## Projekt lista

A **Projekt lista** kártyákon mutatja a projekteket: név, leírás, státusz (Aktív, Szünetel, Befejezett, Archivált), kezdés és befejezés, a tagok száma, létrehozó. A lezárt projekt kártyáján „Lezárva” jelvény van. Kereshetsz név vagy leírás alapján, és szűrhetsz státuszra. A kártyára kattintva nyílik a projekt adatlapja.

## Új projekt létrehozása

1. Válaszd a **Projektek → Új projekt** menüpontot (vagy a Projekt lista **+ Új projekt** gombját).
2. Töltsd ki: projekt neve (kötelező), leírás, státusz, kezdő és záró dátum. A záró dátum nem lehet korábbi a kezdő dátumnál.
3. Kattints a **Projekt létrehozása** gombra.

Megnyílik a projekt adatlapja. A létrehozó „Tulajdonos” szereppel a projekt tagja lesz; ez csak címke, külön jogot nem ad.

## A projekt adatlapjának fülei

- **Áttekintés:** a projekt adatai; jogosultsággal a fejlécben **Szerkesztés** gomb.
- **Tagok:** a projekt tagjai és szerepük.
- **Munkanapló:** a rögzített munkabejegyzések, lásd: [Munkanapló](./munkanaplo.md).
- **Riport:** összesítések, lásd lejjebb.
- **Kategóriák:** a projekt saját munkakategóriái, lásd lejjebb.
- **Beállítások:** lezárás, visszanyitás, törlés.

## Projekttagok kezelése

1. A projekt adatlapján nyisd meg a **Tagok** fület, és kattints a **+ Tag hozzáadása** gombra.
2. Válassz dolgozót, és add meg a **Szerep a projektben** értékét (pl. Tag — Általános résztvevő, Tag — Fejlesztő, Tag — Tesztelő, Tag — Külsős, Projektvezető).
3. Mentsd.

A tag szerepe a listában közvetlenül módosítható, és a tag eltávolítható. Külsős dolgozó is felvehető tagnak. Munkát csak a projekt tagja rögzíthet.

Ha a projektnek több aktív kategóriája van, a tagok mellett **Alapértelmezett kategória** is választható. A munka rögzítésekor ez van előre kiválasztva az adott dolgozónak (a munkanaplóban, telefonon és a Heti rögzítésben is). Ha a projektnek csak egy kategóriája van, az magától ki van választva.

## Projektvezető kijelölése

A projektvezető a saját projektjét akkor is kezelheti (adatok, tagok, munkanapló, riport) és lezárhatja, ha a szervezetben nincs ilyen szerepe. Más projektekhez ettől nem kap jogot.

A **Tagok** fülön állítsd a tag szerepét **Projektvezető**-re (vagy új tagnál ezt válaszd). Projektvezetőt csak az jelölhet ki vagy vehet el, aki a projektet le is zárhatja (pl. Projektkezelő, Szervezet adminisztrátor vagy egy másik projektvezető).

## Projekt lezárása és visszanyitása

Lezárt projektnél a munkanapló zárolt: új bejegyzés nem rögzíthető, a meglévők nem módosíthatók és nem törölhetők. A projekt adatai és tagjai sem módosíthatók.

1. A projekt adatlapján nyisd meg a **Beállítások** fület, és kattints a **Projekt lezárása** gombra.
2. Erősítsd meg. A fejlécben és a listán „Lezárva” jelvény jelenik meg; fölé állva látszik, ki és mikor zárta le.

Visszanyitás ugyanitt, a **Projekt visszanyitása** gombbal; ezután a munka újra rögzíthető és módosítható. A lezárt projekt nem törölhető, előbb vissza kell nyitni. A státusz (Aktív, Befejezett stb.) a lezárástól független.

## Munkakategóriák

Minden projektnek saját kategórialistája van. A **Kategóriák** fület az látja, akinek „Projektek kezelése” joga van, valamint a projekt projektvezetője.

- **Új kategória:** név megadásával; egy projekten belül két azonos nevű nem lehet.
- **Átvétel…:** kategóriák másolása a szervezet egy másik projektjéből vagy a **Régi közös listából** (a korábban minden projektre érvényes lista). Csak az aktívak jönnek át, a már meglévő nevek kimaradnak.
- **Átnevezés**, sorrend (nyilak), **Inaktiválás / Aktiválás:** az inaktív kategória új bejegyzéshez nem választható, a régi bejegyzéseken megmarad.
- **Törlés (✕):** csak olyan kategóriánál, amelyet egy bejegyzés sem használ.

Amíg a projektnek nincs aktív kategóriája, a munkanaplóban nem kötelező kategóriát választani. Lezárt projekt kategóriái nem módosíthatók.

## Projekt riport

A **Riport** fül a projekt munkáját összesíti. Látja, akinek „Összes munkanapló megtekintése” vagy „Projektek kezelése” joga van (alapból Szervezet adminisztrátor, Projektkezelő, HR felelős), valamint a projekt projektvezetője.

- **Áttekintés:** összes logolt óra, bejegyzések száma, aktív tagok, átlag óra / aktív nap, első és utolsó bejegyzés.
- **Idővonal:** eltelt és hátralévő napok (lezárt projektnél rejtett).
- **Dolgozónkénti** és **Kategóriánkénti bontás**.
- **Utolsó 30 nap** grafikon; dátumszűrővel **Napi bontás (szűrt időszak)**.
- **Teljes időszak** grafikon; hosszú projektnél egy oszlop több napot összegez.
- **Inaktív tagok** (14 napja nem logoltak) és **Legutóbbi bejegyzések**.

A dátumszűrővel (-tól, -ig) szűkíthető az időszak. A **Feladatok exportálása CSV-be** gomb a bejegyzéseket CSV fájlba menti (a szűrt időszakra).

## Gyakori kérdések

**Hogyan lesz valaki projektvezető?**
A Tagok fülön a szerepét Projektvezetőre kell állítani. Ezt az teheti meg, aki a projektet le is zárhatja.

**Miért nem látom a Riport fület?**
A riporthoz „Összes munkanapló megtekintése” vagy „Projektek kezelése” jog kell, vagy hogy a projekt projektvezetője legyél. A jogot a [Beállítások → Jogosultságok](./szervezetek-es-jogosultsagok.md#szerepek-és-jogok-kezelése) oldalon lehet egy szerephez megadni.

**Miért nem tudom törölni a projektet?**
Lezárt projekt nem törölhető. Előbb nyisd vissza a Beállítások fülön.
