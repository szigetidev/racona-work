---
title: Munkanapló
description: Munka rögzítése a projektekben, asztalon és telefonon, és a hiányzó bejegyzések figyelése
sidebar:
  order: 5
---

A munkanaplóban rögzíted, melyik projekten mennyit dolgoztál. A bejegyzéseket a projektvezető és a Projektkezelő is látja, a projekt riportja ezekből összesít. Bekapcsolható egy esti emlékeztető is, ha valaki egy munkanapjára nem rögzített munkát.

> **Hol találod?** A projekt adatlapja → **Munkanapló** fül. Telefonon a **Munka rögzítése** gyorsművelet.
>
> - Munka rögzítése: „Munkanapló rögzítése” jog (alapból Dolgozó, Projektkezelő, Szervezet adminisztrátor), és tagja kell legyél a projektnek.
> - Mások bejegyzéseinek megtekintése, módosítása, rögzítés más nevében: „Összes munkanapló megtekintése” vagy „Projektek kezelése” jog, vagy a projekt projektvezetője.

## Munka rögzítése

1. Nyisd meg a projektet, és válts a **Munkanapló** fülre.
2. Kattints az **+ Új bejegyzés** gombra.
3. Töltsd ki: feladat címe (kötelező), kategória (a projekt saját listájából; kötelező, ha a projektnek van aktív kategóriája, lásd: [Munkakategóriák](./projektek.md#munkakategóriák)), leírás, dátum, óra.
4. Mentsd.

Az óraszám 0,25 és 24 között lehet. A dátum nem lehet korábbi a projekt kezdő dátumánál. Aki mások munkáját is kezeli (pl. Projektkezelő, projektvezető), a **Kinek a nevében** mezőben más tag nevére is rögzíthet.

## Heti rögzítés

A **Projektek → Heti rögzítés** menüpontban projektbe lépés nélkül rögzítheted a napi munkáidat.

1. A hét napjai kártyákon látszanak a már rögzített munkákkal és a napi összeggel; a hetek között a nyilakkal, vissza az **Ez a hét** gombbal lépsz.
2. A nap **+ Munka** gombjával válaszd ki a projektet (csak a nyitott projektek, amelyeknek tagja vagy), a kategóriát (ha a projektnek van; az alapértelmezett előre ki van választva), és add meg az órát.
3. A **Feladat** nem kötelező: üresen a kategória (kategória nélküli projektnél a projekt) neve lesz.

Egy bejegyzésre kattintva szerkesztheted, a ✕ gombbal törölheted. Akinek „Összes munkanapló megtekintése” joga van (pl. Szervezet adminisztrátor), a **Dolgozó** választóval más dolgozó hetét is megnyithatja, és a nevében rögzíthet.

## A bejegyzések listája

Ha mások bejegyzéseit is láthatod, a **Saját** és az **Összes** nézet között válthatsz. Szűrhetsz dátumra (-tól, -ig) és dolgozóra; felül az „Összesen: … óra” összeg látszik.

A saját bejegyzésedet szerkesztheted és törölheted; másokét a projektvezető és a Projektkezelő. Lezárt projektnél a munkanapló nem módosítható, lásd: [Projekt lezárása](./projektek.md#projekt-lezárása-és-visszanyitása).

## Munka rögzítése telefonon

Telefonon a **Munka rögzítése** gyorsművelet egy nap összes saját bejegyzését mutatja minden projektből, a napi óraszámmal.

1. Az **Előző nap** / **Következő nap** gombokkal válaszd ki a napot.
2. Koppints a **Munka rögzítése** gombra: válaszd ki a projektet (csak a nyitott projektek látszanak, a legutóbb használt előre ki van választva) és a kategóriát, add meg a feladat címét, a leírást és az órát.
3. Mentsd.

Egy bejegyzésre koppintva szerkesztheted vagy törölheted. Külsős dolgozóként is használhatod. A többi telefonos lehetőséget lásd: [Mobil használat](./mobil.md).

## Hiányzó bejegyzések figyelése

A munkanapló-figyelés este emlékezteti a dolgozót, ha egy munkanapjára egyik projektbe sem rögzített munkát.

> **Hol találod?** **Beállítások → Munkanapló**. A „Projektek kezelése” jog kell hozzá szervezeti szinten.

1. Kapcsold be: **Figyelés bekapcsolva**. Minden nap 23:55-kor fut.
2. **Figyelt napok** (0–30, alapból 5): a mai nap és az előtte lévő ennyi nap hiányzó munkanapjairól megy emlékeztető. 0 esetén csak a mai napról.
3. **Eszkaláció címzettjei:** legfeljebb 10 email cím (jellemzően a projektvezetőké), soronként vagy vesszővel elválasztva. Üresen nincs eszkaláció.
4. **Kihagyott dolgozók:** akiket a figyelés ne vizsgáljon.
5. Mentsd.

Az oldal kiírja, mely napokról megy ma este emlékeztető, és mutatja az utolsó futás eredményét.

### Kit és mely napokat figyel?

Az aktív, nem külsős dolgozókat figyeli. Csak a [munkanaptár](./munkanaptar.md) szerinti munkanapok számítanak; kimarad a hétvége, a munkaszüneti nap, a jóváhagyott szabadság, valamint a belépés előtti és a kilépés utáni nap. Bármely projektbe rögzített, bármekkora bejegyzés elég.

A dolgozó minden este egy emailt és rendszeren belüli értesítést kap a még hiányzó napjairól, amíg pótolja őket. Ha egy nap úgy esik ki a figyelt napok közül, hogy még mindig hiányzik, a beállított eszkalációs címzettek egyszer jelzést kapnak róla. Az emailek a [Beállítások → Értesítések](./ertesitesek.md) oldalon a Munkanapló csoportban kapcsolhatók ki.

## Gyakori kérdések

**Miért nem tudok munkát rögzíteni a projektre?**
Munkát csak a projekt tagja rögzíthet. Kérd a projektvezetőt vagy a Projektkezelőt, hogy vegyen fel a Tagok fülön.

**Miért nem jelenik meg az Új bejegyzés gomb?**
A projekt le van zárva. Csak a visszanyitás után lehet rögzíteni.

**Miért nem választhatok korábbi dátumot?**
A bejegyzés napja nem lehet korábbi a projekt kezdő dátumánál.

**Miért kapok minden este emailt a munkanaplóról?**
Mert valamelyik munkanapodra nincs bejegyzésed. Rögzíts munkát arra a napra, és az emlékeztető megszűnik.
