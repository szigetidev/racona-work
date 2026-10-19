---
title: Szabadság egyenleg
category: racona-work
tags: [szabadság egyenleg, egyenleg, fennmaradó szabadság, maradék szabadság, felhasználási terv, szabadságfelhasználási terv, burn-down, grafikon, kivett, lefoglalt, függő, tűrés, kritikus küszöb, státusz, felhasználási arány, projekt szűrő]
aliases: [mennyi szabadság maradt, ki nem vette ki a szabadságát, szabadság ütemezés, szabadság áttekintés, szabi egyenleg, ki gyűjti a szabadságot, szabadság kimutatás, enyhén magas, túl magas, gyorsan fogy, szabadság terv]
last_updated: 2026-10-07
---

# Szabadság egyenleg

## Rövid összefoglaló
A Szabadság egyenleg oldal megmutatja, hogyan használja a szervezet a szabadságkeretét az év során: mennyi szabadság maradt összesen és dolgozónként, és ki gyűjti a szabadságát év végére, illetve kinél fogy túl gyorsan. A számokat egy évenkénti felhasználási tervhez méri, amit a Beállításokban lehet megadni. A terv tájékoztató, semmit nem tilt és nem ír elő.

## Elérés
**Elérési út:** Work → Idő és szabadság → Szabadság egyenleg
**Ki használhatja:** a „Szabadságkérelmek jóváhagyása” vagy a „Szabadságkeret kezelése” joggal rendelkezők, alapból a HR felelős és a Szervezet adminisztrátor. Ők a szervezet minden dolgozóját látják. A Dolgozó és a Projektkezelő szerep alapból nem éri el az oldalt. A saját keretét minden dolgozó az Irányítópulton látja.

## Év és szűrő a Szabadság egyenleg oldalon
Az oldal tetején, jobbra:
- **Év:** azok az évek, amelyekre van szabadságkeret, és az idei év. Alapból az idei év látszik.
- **Projekt** szűrő: „Mindenki” (alapértelmezett), „Projekt nélkül” (akinek nincs futó projektje), vagy egy projekt a „Projektek” csoportból. A „Lezárt projektek is” kapcsolóval a lezárt projektek is választhatók.

A projektszűrő a projekt mostani tagjait mutatja, az egész évre. A választott szűrőt a böngésző szervezetenként megjegyzi.

Az oldal tetején egy sor jelzi, melyik felhasználási terv érvényes, és mekkora a tűrés és a kritikus küszöb.

## Mutatók a Szabadság egyenleg oldal tetején
Négy kártya a szűrt dolgozókra:
- **Összesen fennmaradó:** a még ki nem vett napok összege, alatta a változás az előző hónap végéhez képest.
- **Munkatársak száma:** hány dolgozó szerepel, és ebből hány „rendben”, hány „figyelmet igényel”.
- **Felhasználási arány:** a kivett napok aránya a keretek összegéhez („{kivett} / {összes} nap felhasználva”).
- **Átlagos fennmaradó:** egy dolgozóra jutó fennmaradó nap, alatta a terv szerinti cél.

## Szabadság burn-down grafikon
A „Szabadság burn-down” grafikon hónapról hónapra mutatja a fennmaradó szabadságnapokat:
- **Tényleges fennmaradó napok** (folytonos vonal) a mai napig.
- **Tervezett fennmaradó napok** (szaggatott vonal) a felhasználási terv szerint.
- **Tűréssáv** (halvány sáv) a terv körül.
- **A lefoglalt napok után** (halvány pontozott vonal): a már jóváhagyott, jövőbeli szabadságok levonása után.

Egy hónapra mutatva megjelenik a tényleges és a tervezett érték és az eltérés. A grafikon jobb felső sarkában az „Összesítve” helyett egy dolgozó is választható; ugyanezt teszi, ha a táblázatban a dolgozó sorára kattintasz (újrakattintásra vissza az összesítésre). Jövőbeli évnél csak a terv és a lefoglalt napok látszanak.

## Munkatársak szabadság státusza táblázat
A táblázat oszlopai: Munkatárs, Projektek, Éves keret, Kivett, Lefoglalt, Fennmaradó, Tervezett (mai dátummal), Eltérés, Státusz, Trend, Műveletek.
- **Kivett:** a már elmúlt szabadságnapok.
- **Lefoglalt:** a jóváhagyott, de még jövőbeli szabadságnapok. Ha függő kérelem is van, a tooltip mutatja: „Függő kérelmekben még {n} nap”.
- **Eltérés:** a fennmaradó napok mínusz a terv szerint ma fennmaradó napok.
- **Trend:** az eltérés alakulása az utolsó hónapokban.
- Év közben belépett vagy kilépő dolgozónál címke látszik: „belépett: …”, „kilép: …” vagy „kilépett: …”.

Keresés a „Munkatárs keresése…” mezővel. A „Rendezés” választóval rendezhetsz státusz, név, fennmaradó napok, kivett napok vagy eltérés szerint. A **Műveletek** menüben: „Adatlap” (a dolgozó adatlapja) és „Szabadságnaptár” (a Szabadság nyilvántartó naptára erre a dolgozóra szűrve). A névre kattintva is az adatlap nyílik.

## Mit jelentenek a státuszok a Szabadság egyenleg oldalon?
- **Rendben:** a dolgozó a terv szerint halad (a tűrésen belül).
- **Enyhén magas:** a szabad napjai a tűrésnél többel haladják meg a tervet, vagyis gyűjti a szabadságát.
- **Túl magas:** a kritikus küszöbnél is többel van a terv felett.
- **Gyorsan fogy:** a tűrésnél többel kevesebb szabadsága maradt, mint a terv szerint kellene.
- **Nincs keret:** a dolgozó éves kerete 0 nap.

A „magas” státuszoknál a jóváhagyott jövőbeli (lefoglalt) napok is levonódnak, mert aki előre lefoglalta a szabadságát, az nem gyűjtöget. A „Gyorsan fogy” csak a már kivett napokat nézi, így egy előre lefoglalt nyári szabadság tavasszal nem riaszt. A függő kérelmek egyik státuszba sem számítanak bele. A státuszra mutatva a tooltip a számokat is megmutatja.

## Szabadságfelhasználási terv beállítása
**Elérési út:** Work → Beállítások → Szabadság → „Szabadságfelhasználási terv” szakasz
**Ki használhatja:** a „Szabadságkeret kezelése” joggal rendelkezők.

1. Válaszd ki az **Év**et.
2. Hónaponként add meg, hogy az éves keret hány százalékát célszerű a hónap végéig kivenni („Kivéve a hónap végéig”). Az érték 0 és 100 közötti egész, és nem lehet kevesebb az előző hónapnál. A táblázat mutatja a havi növekményt és egy példakeret tervezett maradékát.
3. Gyors kitöltés: „Egyenletes eloszlás” vagy „A(z) {év}. évi terv átvétele”.
4. Add meg a **Tűrés**t és a **Kritikus küszöb**öt, mindkettőt az éves keret százalékában (25 napos keretnél a 10% 2,5 nap). Alapérték: 10% és 20%; a kritikus küszöb legyen nagyobb a tűrésnél.
5. Kattints a „Terv mentése” gombra.

Ha egy évnek nincs saját terve, a legutóbbi korábbi év terve érvényes, ha az sincs, az egyenletes eloszlás. Évnyitáskor az érvényes terv az új év saját tervévé válik. Lezárt év terve nem módosítható. Ha decemberre 100%-nál kisebb a cél, a Work figyelmeztet, hogy év végére a keret egy része megmarad.

## Hiányzó szabadságkeret a Szabadság egyenleg oldalon
Az oldalon csak azok a dolgozók szerepelnek, akiknek van kerete a kiválasztott évre. Ha valakinek nincs, a táblázat alatt ez látszik: „{n} dolgozónak nincs kerete a(z) {év}. évre, ők nem szerepelnek az összesítésben.” Az „Éves szabadságkeretek” linkre kattintva létrehozhatod a hiányzó kereteket.

## Exportálható-e a Szabadság egyenleg?
A Szabadság egyenleg oldalon nincs export. Táblázatos kimutatás a jóváhagyóknak a Szabadság nyilvántartó oldalon érhető el: a naptár alatti összesítő az „Export (XLSX)” gombbal letölthető, éves nézetben az éves kerettel és a maradékkal együtt.

## Gyakori kérdések
**Miért nem látom a Szabadság egyenleg menüpontot?** A „Szabadságkérelmek jóváhagyása” jog kell hozzá. Kérd a szervezet adminisztrátorától.

**Miért „Enyhén magas” egy dolgozó, aki már bead egy kérelmet?** A függő kérelmek nem számítanak bele a státuszba, csak a jóváhagyott napok. Jóváhagyás után a státusz frissül.

**Mi a különbség a kivett és a lefoglalt nap között?** A kivett nap már elmúlt, a lefoglalt jóváhagyott, de még jövőbeli. A függő nap még el nem bírált kérelemhez tartozik.

**Látja-e a jóváhagyó, miből jön ki a dolgozó kerete?** Az oldalon csak a keret összege látszik. A bontást (életkor, gyerekek) csak a „Szabadságkeret kezelése” joggal lehet megnézni a dolgozó adatlapján.

**Projektenként eltérő terv adható meg?** Nem, a felhasználási terv céges szintű, évente egy.
