/**
 * Szervezetek — szerver oldali függvények.
 *
 * Szervezetek (organizations) CRUD-ja és a szervezeti tagság kezelése.
 * A tagság az employees.organization_id oszlopon alapul: egy dolgozó
 * pontosan egy szervezethez tartozik.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import { isExternalMember, requireCapability, seedDefaultRoles } from './permissions.js';
import { seedDocumentTypes } from './document-types.js';
import { collectOrganizationDocumentFileIds, deleteStoredFiles } from './employee-documents.js';
import type { PaginatedResult } from './types.js';
import { geocodeAddress } from './geo.js';
import { loadOrganizationName } from './notification-email.js';
import { normalizeTaxNumber } from './trip-calc.js';

export interface Organization {
	id: number;
	name: string;
	slug: string;
	address: string | null;
	/** Adószám (`12345678-1-12`), a kiküldetési rendelvény fejlécéhez. */
	taxNumber: string | null;
	/** A cím koordinátái (mentéskor geokódolva) — a „munkahely” kiindulópont. */
	addressLocation: { lat: number; lng: number } | null;
	phone: string | null;
	email: string | null;
	website: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Mentés után: ha a címet nem találtuk a térképen, a felület figyelmeztet. */
export interface SavedOrganization extends Organization {
	addressGeocodeFailed: boolean;
}

const ORG_COLUMNS =
	'id, name, slug, address, tax_number, address_lat, address_lng, phone, email, website, notes, created_at, updated_at';

function mapOrganization(row: any): Organization {
	const lat = row.address_lat === null || row.address_lat === undefined ? null : Number(row.address_lat);
	const lng = row.address_lng === null || row.address_lng === undefined ? null : Number(row.address_lng);
	return {
		id: row.id,
		name: row.name,
		slug: row.slug,
		address: row.address ?? null,
		taxNumber: row.tax_number ?? null,
		addressLocation: lat !== null && lng !== null ? { lat, lng } : null,
		phone: row.phone ?? null,
		email: row.email ?? null,
		website: row.website ?? null,
		notes: row.notes ?? null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

/**
 * A szervezet címének geokódolása (best effort). Üres címnél törli a koordinátát.
 * @returns true, ha volt cím, de nem találtuk
 */
async function geocodeOrganizationAddress(
	context: RemoteContext,
	organizationId: number,
	address: string | null
): Promise<boolean> {
	const found = address ? await geocodeAddress(context, organizationId, address) : null;
	await context.db.query(
		`UPDATE app__racona_work.organizations SET address_lat = $2, address_lng = $3 WHERE id = $1`,
		[organizationId, found?.lat ?? null, found?.lng ?? null]
	);
	return address !== null && found === null;
}

export interface OrganizationMember {
	id: number;
	organizationId: number;
	employeeId: number;
	role: string;
	joinedAt: string;
}

export interface OrganizationMemberRow extends OrganizationMember {
	employeeName: string;
	employeeEmail: string;
	employeeImage: string | null;
	employeePosition: string | null;
}

/**
 * Slug generálás szervezet névből.
 * Követelmény: 2.2
 */
export function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFD') // Ékezetek eltávolítása
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-') // Speciális karakterek cseréje kötőjelre
		.replace(/^-+|-+$/g, ''); // Kezdő és záró kötőjelek eltávolítása
}

/**
 * Ellenőrzi, hogy a felhasználó admin jogosultsággal rendelkezik-e.
 * Követelmény: 2.1
 */
function requireAdmin(context: RemoteContext): void {
	// Dev módban ne ellenőrizzük a jogosultságot
	if (!isDevMode(context) && !isCoreAdmin(context)) {
		throw new Error('Ez a művelet adminisztrátori jogosultságot igényel');
	}
}

/**
 * Új szervezet létrehozása.
 * Követelmények: 2.1, 2.2, 2.3
 */
export async function createOrganization(
	params: {
		name: string;
		address?: string;
		taxNumber?: string;
		phone?: string;
		email?: string;
		website?: string;
		notes?: string;
	},
	context: RemoteContext
): Promise<SavedOrganization> {
	requireAdmin(context);

	const slug = generateSlug(params.name);
	const taxNumber = normalizeTaxNumber(params.taxNumber);

	// Ellenőrizzük, hogy a slug egyedi-e
	const existingResult = await context.db.query(
		`SELECT id FROM app__racona_work.organizations WHERE slug = $1`,
		[slug]
	);

	if (existingResult.rows.length > 0) {
		throw new Error('Már létezik szervezet ezzel a névvel');
	}

	const result = await context.db.query(
		`INSERT INTO app__racona_work.organizations (name, slug, address, tax_number, phone, email, website, notes, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
		 RETURNING ${ORG_COLUMNS}`,
		[
			params.name,
			slug,
			params.address ?? null,
			taxNumber,
			params.phone ?? null,
			params.email ?? null,
			params.website ?? null,
			params.notes ?? null
		]
	);

	const row = result.rows[0];

	// Rendszer szerepek seedelése + a létrehozó user org_admin szerephez rendelése.
	// Best-effort: ha hiba van, ne bontsuk vissza a szervezetet, csak logoljunk.
	try {
		// Dev módban nincs valódi hívó, ilyenkor nem rendelünk org_admin-t.
		const creatorUserId = isDevMode(context) ? undefined : await resolveUserId(context);
		await seedDefaultRoles({ organizationId: row.id, creatorUserId }, context);
	} catch (err) {
		console.error('[createOrganization] Szerepek seedelése sikertelen:', err);
	}

	// Alapértelmezett dokumentumtípusok (specs/employee-documents.md, K2), szintén best-effort
	try {
		await seedDocumentTypes(context, row.id);
	} catch (err) {
		console.error('[createOrganization] Dokumentumtípusok seedelése sikertelen:', err);
	}

	const addressGeocodeFailed = await geocodeOrganizationAddress(context, row.id, row.address ?? null);
	const saved = await context.db.query(`SELECT ${ORG_COLUMNS} FROM app__racona_work.organizations WHERE id = $1`, [
		row.id
	]);
	return { ...mapOrganization(saved.rows[0]), addressGeocodeFailed };
}

/**
 * Ellenőrzi, hogy a felhasználó admin jogosultsággal rendelkezik-e.
 * Követelmény: Admin hozzáférés ellenőrzése
 */
export async function isUserAdmin(params: {}, context: RemoteContext): Promise<boolean> {
	// Dev módban nincs core admin
	if (isDevMode(context)) return false;
	return isCoreAdmin(context);
}

/**
 * Felhasználó szervezeteinek lekérdezése.
 * Admin userek esetén az összes szervezetet visszaadja.
 * Nem-admin userek esetén csak azokat, amelyeknek tagja.
 * ÚJ: Az employees táblából közvetlenül lekérdezi a szervezeteket organization_id alapján.
 * Követelmények: 2.1, 2.2
 */
export async function getUserOrganizations(
	params: {},
	context: RemoteContext
): Promise<Organization[]> {
	// Admin userek az összes szervezetet látják
	if (!isDevMode(context) && isCoreAdmin(context)) {
		const result = await context.db.query(
			`SELECT ${ORG_COLUMNS}
			 FROM app__racona_work.organizations
			 ORDER BY name ASC`
		);

		// Ha nincs szervezet, hozz létre egy default-ot
		if (result.rows.length === 0) {
			const defaultOrg = await context.db.query(
				`INSERT INTO app__racona_work.organizations (name, slug, created_at, updated_at)
				 VALUES ('Default Organization', 'default-organization', NOW(), NOW())
				 ON CONFLICT (slug) DO NOTHING
				 RETURNING ${ORG_COLUMNS}`
			);
			if (defaultOrg.rows.length > 0) {
				return [defaultOrg.rows[0]].map(mapOrganization);
			}
		}

		return result.rows.map(mapOrganization);
	}

	// Nem-admin userek: csak a saját szervezeteik
	const userId = await resolveUserId(context);

	// Közvetlenül az employees táblából lekérdezzük a szervezeteket
	const result = await context.db.query(
		`SELECT DISTINCT o.id, o.name, o.slug, o.address, o.tax_number, o.address_lat, o.address_lng,
		        o.phone, o.email, o.website, o.notes, o.created_at, o.updated_at
		 FROM app__racona_work.organizations o
		 JOIN app__racona_work.employees e ON e.organization_id = o.id
		 WHERE e.user_id = $1
		 ORDER BY o.name ASC`,
		[userId]
	);

	return result.rows.map(mapOrganization);
}

/**
 * A Szervezetek menü listája.
 * Rendszergazda az összes szervezetet látja, a szervezet adminisztrátor
 * (`org.manage` képesség) csak azokat, amelyekben ez a képessége megvan.
 * Követelmény: 2.4
 */
export async function getOrganizations(
	params: {},
	context: RemoteContext
): Promise<Organization[]> {
	if (isDevMode(context) || isCoreAdmin(context)) {
		const result = await context.db.query(
			`SELECT ${ORG_COLUMNS}
			 FROM app__racona_work.organizations
			 ORDER BY created_at DESC`
		);
		return result.rows.map(mapOrganization);
	}

	const userId = await resolveUserId(context);
	const result = await context.db.query(
		`SELECT ${ORG_COLUMNS}
		 FROM app__racona_work.organizations
		 WHERE id IN (
		   SELECT mr.organization_id
		     FROM app__racona_work.wp_member_roles mr
		     JOIN app__racona_work.wp_role_capabilities rc ON rc.role_id = mr.role_id
		    WHERE mr.user_id = $1 AND rc.capability = 'org.manage'
		 )
		 ORDER BY created_at DESC`,
		[userId]
	);

	// Külsős dolgozónál a szervezeti képességek nem érvényesek (lásd hasCapability)
	const organizations: Organization[] = [];
	for (const row of result.rows) {
		if (!(await isExternalMember(context, row.id, userId))) organizations.push(mapOrganization(row));
	}
	return organizations;
}

/**
 * Szervezet adatainak frissítése (rendszergazda vagy a szervezet `org.manage` képességű tagja).
 * Követelmények: 2.5
 */
export async function updateOrganization(
	params: {
		id: number;
		name: string;
		address?: string | null;
		taxNumber?: string | null;
		phone?: string | null;
		email?: string | null;
		website?: string | null;
		notes?: string | null;
	},
	context: RemoteContext
): Promise<SavedOrganization> {
	await requireCapability(context, params.id, 'org.manage');

	const slug = generateSlug(params.name);
	const taxNumber = normalizeTaxNumber(params.taxNumber);
	const previous = await context.db.query(
		`SELECT address, address_lat FROM app__racona_work.organizations WHERE id = $1`,
		[params.id]
	);

	// Ellenőrizzük, hogy a slug egyedi-e (kivéve az aktuális szervezetet)
	const existingResult = await context.db.query(
		`SELECT id FROM app__racona_work.organizations WHERE slug = $1 AND id != $2`,
		[slug, params.id]
	);

	if (existingResult.rows.length > 0) {
		throw new Error('Már létezik szervezet ezzel a névvel');
	}

	const result = await context.db.query(
		`UPDATE app__racona_work.organizations
		 SET name = $1, slug = $2, address = $3, tax_number = $4, phone = $5, email = $6, website = $7, notes = $8, updated_at = NOW()
		 WHERE id = $9
		 RETURNING ${ORG_COLUMNS}`,
		[
			params.name,
			slug,
			params.address ?? null,
			taxNumber,
			params.phone ?? null,
			params.email ?? null,
			params.website ?? null,
			params.notes ?? null,
			params.id
		]
	);

	if (result.rows.length === 0) {
		throw new Error(`Nem található szervezet a megadott azonosítóval: ${params.id}`);
	}

	// A címet csak akkor geokódoljuk újra, ha változott (vagy eddig nem találtuk)
	const row = result.rows[0];
	const before = previous.rows[0];
	const address: string | null = row.address ?? null;
	if (address === (before?.address ?? null) && (address === null || before?.address_lat !== null)) {
		return { ...mapOrganization(row), addressGeocodeFailed: false };
	}
	const addressGeocodeFailed = await geocodeOrganizationAddress(context, row.id, address);
	const saved = await context.db.query(`SELECT ${ORG_COLUMNS} FROM app__racona_work.organizations WHERE id = $1`, [
		row.id
	]);
	return { ...mapOrganization(saved.rows[0]), addressGeocodeFailed };
}

/**
 * Szervezet törlése.
 * Követelmények: 2.6, 2.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6
 */
export async function deleteOrganization(
	params: { id: number },
	context: RemoteContext
): Promise<{ memberCount: number; projectCount: number }> {
	requireAdmin(context);

	const client = await context.db.connect();
	let documentFileIds: string[] = [];

	try {
		await client.query('BEGIN');

		// Ellenőrizzük, hogy vannak-e projektek a szervezetben
		const projectResult = await client.query(
			`SELECT COUNT(*) AS count FROM app__racona_work.projects WHERE organization_id = $1`,
			[params.id]
		);

		const projectCount = parseInt(projectResult.rows[0].count, 10);
		if (projectCount > 0) {
			throw new Error(
				`A szervezet nem törölhető, mert ${projectCount} projekt tartozik hozzá. Először töröld a projekteket.`
			);
		}

		// Lekérdezzük a dolgozók számát a törlés előtt (információs célból)
		const memberResult = await client.query(
			`SELECT COUNT(*) AS count FROM app__racona_work.employees WHERE organization_id = $1`,
			[params.id]
		);

		const memberCount = parseInt(memberResult.rows[0].count, 10);

		// A dokumentumok fájljai a core tárolójában vannak: a sorokkal együtt azokat is törölni kell
		documentFileIds = await collectOrganizationDocumentFileIds(client, params.id);

		// 1. Dolgozók törlése (employees rekordok) - CASCADE törli a kapcsolódó adatokat
		await client.query(`DELETE FROM app__racona_work.employees WHERE organization_id = $1`, [
			params.id
		]);

		// 2. Szervezet törlése
		await client.query(`DELETE FROM app__racona_work.organizations WHERE id = $1`, [params.id]);

		await client.query('COMMIT');

		await deleteStoredFiles(context, documentFileIds);

		// Visszaadjuk a törölt tagok és projektek számát
		return { memberCount, projectCount };
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

// --- Szervezet tagok kezelése ---

/**
 * Szervezet tagjainak lekérdezése (dolgozók, akik a szervezethez tartoznak).
 * Követelmény: 4.8
 */
export async function getOrganizationMembers(
	params: { organizationId: number; page?: number; pageSize?: number; search?: string },
	context: RemoteContext
): Promise<PaginatedResult<OrganizationMemberRow>> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'members.view');

	const page = params.page ?? 1;
	const pageSize = params.pageSize ?? 20;
	const offset = (page - 1) * pageSize;

	// WHERE feltételek
	const conditions: string[] = ['e.organization_id = $1'];
	const queryParams: unknown[] = [params.organizationId];
	let paramIndex = 2;

	if (params.search) {
		conditions.push(`(u.full_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`);
		queryParams.push(`%${params.search}%`);
		paramIndex++;
	}

	const whereClause = `WHERE ${conditions.join(' AND ')}`;

	// Összes találat száma
	const countResult = await context.db.query(
		`SELECT COUNT(*) AS total
		 FROM app__racona_work.employees e
		 JOIN auth.users u ON e.user_id = u.id
		 ${whereClause}`,
		queryParams
	);

	const totalCount = parseInt(countResult.rows[0].total, 10);
	const totalPages = Math.ceil(totalCount / pageSize);

	// Adatok lekérdezése
	const dataResult = await context.db.query(
		`SELECT
			e.id,
			e.organization_id,
			e.id AS employee_id,
			'member' AS role,
			e.created_at AS joined_at,
			u.full_name AS employee_name,
			u.email AS employee_email,
			u.image AS employee_image,
			e.position AS employee_position
		 FROM app__racona_work.employees e JOIN auth.users u ON e.user_id = u.id
		 ${whereClause}
		 ORDER BY u.full_name ASC
		 LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
		[...queryParams, pageSize, offset]
	);

	const data: OrganizationMemberRow[] = dataResult.rows.map((row: any) => ({
		id: row.id,
		organizationId: row.organization_id,
		employeeId: row.employee_id,
		role: row.role,
		joinedAt: row.joined_at,
		employeeName: row.employee_name,
		employeeEmail: row.employee_email,
		employeeImage: row.employee_image ?? null,
		employeePosition: row.employee_position ?? null
	}));

	return {
		data,
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages
		}
	};
}

/**
 * Dolgozó eltávolítása szervezetből.
 * Követelmény: 4.10
 */
export async function removeEmployeeFromOrganization(
	params: { organizationId: number; employeeId: number },
	context: RemoteContext
): Promise<{ userId: number }> {
	// Paraméter validáció
	if (!params.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	await requireCapability(context, params.organizationId, 'members.manage');

	// Ellenőrizzük, hogy a dolgozó tagja-e ennek a szervezetnek
	const employeeCheck = await context.db.query(
		`SELECT id, user_id FROM app__racona_work.employees
		 WHERE organization_id = $1 AND id = $2`,
		[params.organizationId, params.employeeId]
	);

	if (employeeCheck.rows.length === 0) {
		throw new Error('A dolgozó nem tagja ennek a szervezetnek');
	}

	const userId = employeeCheck.rows[0].user_id;

	// A nyilvántartási adatokat (szabadság, munkaidő, kiküldetés) meg kell
	// őrizni, ezért akinek ilyen van, azt nem töröljük: kilépettre kell állítani.
	// Az adatbázis is tiltaná (a kérelmek és keretek hivatkozása nem CASCADE),
	// de így érthető üzenetet kap a felület.
	const records = await context.db.query(
		`SELECT
		    EXISTS (SELECT 1 FROM app__racona_work.leave_requests WHERE employee_id = $1) AS leave_requests,
		    EXISTS (SELECT 1 FROM app__racona_work.leave_requests WHERE approved_by = $1) AS approved_requests,
		    EXISTS (SELECT 1 FROM app__racona_work.leave_balances WHERE employee_id = $1) AS leave_balances,
		    EXISTS (SELECT 1 FROM app__racona_work.work_entries WHERE employee_id = $1) AS work_entries,
		    EXISTS (SELECT 1 FROM app__racona_work.trips WHERE employee_id = $1) AS trips,
		    EXISTS (SELECT 1 FROM app__racona_work.trip_settlements WHERE employee_id = $1) AS trip_settlements,
		    EXISTS (SELECT 1 FROM app__racona_work.employee_documents WHERE employee_id = $1) AS documents`,
		[params.employeeId]
	);
	const found = records.rows[0] ?? {};
	const kept = [
		found.leave_requests && 'szabadságkérelmek',
		found.approved_requests && 'általa jóváhagyott kérelmek',
		found.leave_balances && 'szabadságkeretek',
		found.work_entries && 'munkaidő-bejegyzések',
		(found.trips || found.trip_settlements) && 'kiküldetések',
		found.documents && 'dokumentumok'
	].filter(Boolean);
	if (kept.length > 0) {
		throw new Error(
			`A dolgozó nem távolítható el, mert megőrzendő adatai vannak (${kept.join(', ')}). ` +
				'Helyette a dolgozó adatlapján, az Alapadatoknál állítsd a státuszát Inaktívra, és add meg a kilépés dátumát.'
		);
	}

	// Adat nélküli (pl. tévedésből felvett) dolgozó: a sora és a kapcsolódó,
	// nem megőrzendő adatai (adatlap, projekttagság, autók, helyek) törlődnek (CASCADE)
	await context.db.query(
		`DELETE FROM app__racona_work.employees
		 WHERE organization_id = $1 AND id = $2`,
		[params.organizationId, params.employeeId]
	);

	await notifyRemovedEmployee(context, params.organizationId, Number(userId));

	return { userId };
}

/**
 * Rendszerértesítés az eltávolított dolgozónak (best-effort, mint a többi
 * értesítés). Szerveren küldjük, mert a kliens csak saját magának küldhet
 * értesítést külön core jog nélkül, és csak itt adható meg kétnyelvű szöveg.
 */
async function notifyRemovedEmployee(
	context: RemoteContext,
	organizationId: number,
	userId: number
): Promise<void> {
	if (!context.notifications) return;
	try {
		if (userId === (await resolveUserId(context))) return;
		const name = await loadOrganizationName(context, organizationId);
		const result = await context.notifications.send({
			userId,
			title: { hu: 'Szervezetből eltávolítottak', en: 'Removed from organization' },
			message: {
				hu: `Eltávolítottak a(z) „${name}” szervezetből.`,
				en: `You have been removed from the organization "${name}".`
			},
			type: 'warning'
		});
		if (!result.success) console.error('[Work] Eltávolítás értesítés sikertelen:', result.error);
	} catch (err) {
		console.error('[Work] Eltávolítás értesítés sikertelen:', err);
	}
}
