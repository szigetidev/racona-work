/**
 * Munkabejegyzés (work entries) szerver funkciók.
 *
 * Egy munkabejegyzés = egy feladat/tevékenység egy adott projekten, egy adott
 * napon, adott dolgozó által. A dolgozó maga rögzíti (`work.log`), a
 * menedzser mindenkiét látja (`work.view.all`).
 *
 * Capability minták:
 *   - work.log        → saját bejegyzést rögzíthet/szerkeszthet/törölhet
 *   - work.view.all   → a projekt minden bejegyzését látja és törölheti
 *   - project.manage  → a projekt minden bejegyzését láthatja/törölheti
 *
 * Lezárt projektnél (projects.closed_at) a bejegyzések nem rögzíthetők, nem
 * módosíthatók és nem törölhetők — a core adminnak és dev módban sem.
 * Ha a projektnek van kezdő dátuma, a bejegyzés napja nem lehet korábbi nála.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import { hasCapability, requireCapability } from './permissions.js';
import { ensureProjectOpen } from './projects.js';
import { resolveEntryCategory } from './work-categories.js';

export interface WorkEntry {
	id: number;
	projectId: number;
	employeeId: number;
	categoryId: number | null;
	title: string;
	description: string | null;
	hours: number;
	workDate: string;
	status: string;
	createdAt: string;
	updatedAt: string;
}

export interface WorkEntryRow extends WorkEntry {
	employeeName: string;
	employeeEmail: string;
	projectName: string;
	categoryName: string | null;
}

export interface WorkEntryListParams {
	projectId?: number;
	employeeId?: number;
	from?: string; // YYYY-MM-DD
	to?: string; // YYYY-MM-DD
	scope?: 'mine' | 'all'; // mine: csak a hívó saját bejegyzései
	organizationId?: number; // all-scope esetén a szervezet szűrő
	page?: number;
	pageSize?: number;
	sortBy?: 'work_date' | 'hours' | 'created_at' | 'employee' | 'project';
	sortOrder?: 'asc' | 'desc';
}

export interface WorkEntryListResult {
	data: WorkEntryRow[];
	pagination: { page: number; pageSize: number; totalCount: number; totalPages: number };
	totalHours: number;
}

// --- Helperek ---------------------------------------------------------------

/**
 * A hívó saját employee rekordja egy adott szervezetben, vagy null.
 */
async function getCallerEmployee(
	context: RemoteContext,
	organizationId: number
): Promise<{ id: number; organizationId: number } | null> {
	const userId = await resolveUserId(context);
	const r = await context.db.query(
		`SELECT id, organization_id
		   FROM app__racona_work.employees
		  WHERE user_id = $1 AND organization_id = $2
		  LIMIT 1`,
		[userId, organizationId]
	);
	if (r.rows.length === 0) return null;
	const row = r.rows[0] as { id: number; organization_id: number };
	return { id: row.id, organizationId: row.organization_id };
}

/** Belső segéd (nem remote függvény) — a project-report.ts is használja. */
export function validateWorkDate(d: string): void {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
		throw new Error('Érvénytelen dátumformátum. Elvárt formátum: YYYY-MM-DD');
	}
}

function validateHours(h: number): void {
	if (typeof h !== 'number' || isNaN(h) || h < 0.25 || h > 24) {
		throw new Error('Az órák száma 0,25 és 24 között kell legyen');
	}
}

/**
 * Belső segéd (nem remote függvény): ha a projektnek van kezdő dátuma, a
 * bejegyzés napja nem lehet korábbi nála. Mindkét dátum YYYY-MM-DD.
 */
export function ensureNotBeforeProjectStart(workDate: string, startDate: string | null): void {
	if (startDate && workDate < startDate) {
		throw new Error(
			`A nap nem lehet korábbi a projekt kezdő dátumánál (${startDate.replace(/-/g, '. ')}.)`
		);
	}
}

/** Belső segéd (nem remote függvény) — a project-report.ts is használja. */
export function mapRow(row: any): WorkEntryRow {
	return {
		id: row.id,
		projectId: row.project_id,
		employeeId: row.employee_id,
		categoryId: row.category_id ?? null,
		categoryName: row.category_name ?? null,
		title: row.title,
		description: row.description ?? null,
		hours: typeof row.hours === 'string' ? parseFloat(row.hours) : Number(row.hours),
		workDate: row.work_date,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		employeeName: row.employee_name ?? '',
		employeeEmail: row.employee_email ?? '',
		projectName: row.project_name ?? ''
	};
}

// --- Lista ------------------------------------------------------------------

export async function listWorkEntries(
	params: WorkEntryListParams,
	context: RemoteContext
): Promise<WorkEntryListResult> {
	const page = Math.max(1, params.page ?? 1);
	const pageSize = Math.min(500, Math.max(1, params.pageSize ?? 50));
	const scope = params.scope ?? 'mine';

	// Szervezet feloldás és jog-ellenőrzés.
	let organizationId = params.organizationId;
	if (params.projectId) {
		const proj = await context.db.query(
			`SELECT organization_id FROM app__racona_work.projects WHERE id = $1`,
			[params.projectId]
		);
		if (proj.rows.length === 0) throw new Error('Projekt nem található');
		organizationId = (proj.rows[0] as { organization_id: number }).organization_id;
	}

	if (!organizationId) {
		throw new Error('A lekérdezéshez szükséges a projekt vagy a szervezet megadása');
	}

	const dev = isDevMode(context);
	const coreAdmin = isCoreAdmin(context);

	if (!dev && !coreAdmin) {
		// mine scope → minimum work.log
		// all scope vagy más employee → work.view.all vagy project.manage
		if (scope === 'mine') {
			await requireCapability(context, organizationId, 'work.log');
		} else {
			const canViewAll = await hasCapability(context, organizationId, 'work.view.all');
			const canManage = canViewAll
				? true
				: await hasCapability(context, organizationId, 'project.manage', params.projectId);
			if (!canViewAll && !canManage) {
				throw new Error('Nincs jogosultságod a munkabejegyzések megtekintéséhez');
			}
		}
	}

	const conditions: string[] = [];
	const qParams: unknown[] = [];

	if (params.projectId) {
		qParams.push(params.projectId);
		conditions.push(`we.project_id = $${qParams.length}`);
	} else {
		// Ha nincs konkrét projekt, szervezetre szűkítjük
		qParams.push(organizationId);
		conditions.push(`p.organization_id = $${qParams.length}`);
	}

	if (params.employeeId && scope !== 'mine') {
		qParams.push(params.employeeId);
		conditions.push(`we.employee_id = $${qParams.length}`);
	}

	if (scope === 'mine') {
		const me = await getCallerEmployee(context, organizationId);
		if (!me) {
			// Nincs employee rekord a szervezetben → nincs mit mutassunk "saját" nézetben.
			return {
				data: [],
				pagination: { page, pageSize, totalCount: 0, totalPages: 0 },
				totalHours: 0
			};
		}
		qParams.push(me.id);
		conditions.push(`we.employee_id = $${qParams.length}`);
	}

	if (params.from) {
		validateWorkDate(params.from);
		qParams.push(params.from);
		conditions.push(`we.work_date >= $${qParams.length}`);
	}
	if (params.to) {
		validateWorkDate(params.to);
		qParams.push(params.to);
		conditions.push(`we.work_date <= $${qParams.length}`);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	const countR = await context.db.query(
		`SELECT COUNT(*)::int AS total, COALESCE(SUM(we.hours), 0) AS total_hours
		   FROM app__racona_work.work_entries we
		   JOIN app__racona_work.projects p ON p.id = we.project_id
		  ${where}`,
		qParams
	);
	const totalCount = (countR.rows[0] as { total: number }).total;
	const totalHoursRaw = (countR.rows[0] as { total_hours: string | number }).total_hours;
	const totalHours =
		typeof totalHoursRaw === 'string' ? parseFloat(totalHoursRaw) : Number(totalHoursRaw);

	const sortMap: Record<string, string> = {
		work_date: 'we.work_date',
		hours: 'we.hours',
		created_at: 'we.created_at',
		employee: 'u.full_name',
		project: 'p.name'
	};
	const sortCol = sortMap[params.sortBy ?? 'work_date'] ?? 'we.work_date';
	const sortOrder = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

	const offset = (page - 1) * pageSize;
	qParams.push(pageSize, offset);

	const dataR = await context.db.query(
		`SELECT we.id, we.project_id, we.employee_id, we.title, we.description,
		        we.hours, to_char(we.work_date, 'YYYY-MM-DD') AS work_date, we.status, we.created_at, we.updated_at,
		        we.category_id, wec.name AS category_name,
		        u.full_name AS employee_name, u.email AS employee_email,
		        p.name AS project_name
		   FROM app__racona_work.work_entries we
		   JOIN app__racona_work.projects p ON p.id = we.project_id
		   JOIN app__racona_work.employees e ON e.id = we.employee_id
		   JOIN auth.users u ON u.id = e.user_id
		   LEFT JOIN app__racona_work.work_entry_categories wec ON wec.id = we.category_id
		  ${where}
		  ORDER BY ${sortCol} ${sortOrder}, we.id DESC
		  LIMIT $${qParams.length - 1} OFFSET $${qParams.length}`,
		qParams
	);

	return {
		data: dataR.rows.map(mapRow),
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
		},
		totalHours
	};
}

// --- Létrehozás -------------------------------------------------------------

export async function createWorkEntry(
	params: {
		projectId: number;
		employeeId?: number; // ha megadva, más nevében rögzít (csak work.view.all + project.manage-nek enged)
		categoryId?: number | null;
		title: string;
		description?: string;
		hours: number;
		workDate: string;
	},
	context: RemoteContext
): Promise<WorkEntry> {
	if (!params?.projectId) throw new Error('Érvénytelen projekt azonosító');
	if (!params.title || !params.title.trim()) throw new Error('A bejegyzés címe kötelező');
	validateHours(params.hours);
	validateWorkDate(params.workDate);

	const proj = await context.db.query(
		`SELECT organization_id, closed_at, to_char(start_date, 'YYYY-MM-DD') AS start_date
		   FROM app__racona_work.projects WHERE id = $1`,
		[params.projectId]
	);
	if (proj.rows.length === 0) throw new Error('Projekt nem található');
	const projRow = proj.rows[0] as {
		organization_id: number;
		closed_at: string | null;
		start_date: string | null;
	};
	const organizationId = projRow.organization_id;

	// Minden hívónak legalább work.log kell.
	await requireCapability(context, organizationId, 'work.log');
	ensureProjectOpen(projRow.closed_at, 'A projekt le van zárva, nem rögzíthető hozzá feladat');
	ensureNotBeforeProjectStart(params.workDate, projRow.start_date);

	// Saját vs. más employee eldöntése
	let targetEmployeeId = params.employeeId;
	if (!targetEmployeeId) {
		const me = await getCallerEmployee(context, organizationId);
		if (!me) {
			throw new Error('Nem vagy dolgozó ebben a szervezetben, nem rögzíthetsz bejegyzést');
		}
		targetEmployeeId = me.id;
	} else {
		// Más nevében csak project.manage + work.view.all engedi
		const me = await getCallerEmployee(context, organizationId);
		if (!me || me.id !== targetEmployeeId) {
			const canAll = await hasCapability(context, organizationId, 'work.view.all');
			const canManage = canAll
				? true
				: await hasCapability(context, organizationId, 'project.manage', params.projectId);
			if (!canAll && !canManage) {
				throw new Error('Nincs jogosultságod más nevében rögzíteni');
			}
		}
	}

	// A bejegyzett employee a projekt szervezetéhez tartozik?
	const empOrg = await context.db.query(
		`SELECT organization_id FROM app__racona_work.employees WHERE id = $1`,
		[targetEmployeeId]
	);
	if (empOrg.rows.length === 0) throw new Error('Dolgozó nem található');
	if ((empOrg.rows[0] as { organization_id: number }).organization_id !== organizationId) {
		throw new Error('A dolgozó nem tartozik a projekt szervezetéhez');
	}

	// A bejegyzett employee tagja-e a projektnek?
	const memberCheck = await context.db.query(
		`SELECT 1 FROM app__racona_work.project_members
		  WHERE project_id = $1 AND employee_id = $2 LIMIT 1`,
		[params.projectId, targetEmployeeId]
	);
	if (memberCheck.rows.length === 0) {
		throw new Error('A dolgozó nem tagja ennek a projektnek');
	}

	// A kategória a projekt saját listájából való; ha a projektnek van aktív kategóriája, kötelező
	const categoryId = await resolveEntryCategory(context, params.projectId, params.categoryId);

	const insert = await context.db.query(
		`INSERT INTO app__racona_work.work_entries
		    (project_id, employee_id, category_id, title, description, hours, work_date, status, created_at, updated_at)
		  VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', NOW(), NOW())
		  RETURNING id, project_id, employee_id, category_id, title, description, hours, work_date,
		            status, created_at, updated_at`,
		[
			params.projectId,
			targetEmployeeId,
			categoryId,
			params.title.trim(),
			params.description?.trim() || null,
			params.hours,
			params.workDate
		]
	);
	const row = insert.rows[0] as any;
	return {
		id: row.id,
		projectId: row.project_id,
		employeeId: row.employee_id,
		categoryId: row.category_id ?? null,
		title: row.title,
		description: row.description ?? null,
		hours: typeof row.hours === 'string' ? parseFloat(row.hours) : Number(row.hours),
		workDate: row.work_date,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

// --- Szerkesztés ------------------------------------------------------------

export async function updateWorkEntry(
	params: {
		id: number;
		categoryId?: number | null;
		title?: string;
		description?: string | null;
		hours?: number;
		workDate?: string;
	},
	context: RemoteContext
): Promise<WorkEntry> {
	if (!params?.id) throw new Error('Érvénytelen bejegyzés azonosító');

	const existing = await context.db.query(
		`SELECT we.id, we.project_id, we.employee_id, we.category_id, p.organization_id, p.closed_at, e.user_id,
		        to_char(we.work_date, 'YYYY-MM-DD') AS work_date,
		        to_char(p.start_date, 'YYYY-MM-DD') AS start_date
		   FROM app__racona_work.work_entries we
		   JOIN app__racona_work.projects p ON p.id = we.project_id
		   JOIN app__racona_work.employees e ON e.id = we.employee_id
		  WHERE we.id = $1`,
		[params.id]
	);
	if (existing.rows.length === 0) throw new Error('Bejegyzés nem található');
	const row = existing.rows[0] as {
		id: number;
		project_id: number;
		employee_id: number;
		category_id: number | null;
		organization_id: number;
		closed_at: string | null;
		user_id: number;
		work_date: string;
		start_date: string | null;
	};

	// Saját bejegyzését a hívó work.log-gal írhatja. Idegen bejegyzést
	// work.view.all vagy project.manage kell.
	const dev = isDevMode(context);
	const coreAdmin = isCoreAdmin(context);
	if (!dev && !coreAdmin) {
		const callerId = await resolveUserId(context);
		if (callerId === row.user_id) {
			await requireCapability(context, row.organization_id, 'work.log');
		} else {
			const canAll = await hasCapability(context, row.organization_id, 'work.view.all');
			const canManage = canAll
				? true
				: await hasCapability(context, row.organization_id, 'project.manage', row.project_id);
			if (!canAll && !canManage) {
				throw new Error('Nincs jogosultságod módosítani ezt a bejegyzést');
			}
		}
	}

	ensureProjectOpen(row.closed_at, 'A projekt le van zárva, a feladatai nem módosíthatók');

	if (params.title !== undefined && (!params.title || !params.title.trim())) {
		throw new Error('A bejegyzés címe nem lehet üres');
	}
	if (params.hours !== undefined) validateHours(params.hours);
	if (params.workDate !== undefined) validateWorkDate(params.workDate);
	// A módosítás utáni nap számít: régi, kezdő dátum előtti bejegyzés csak jó napra tehető át.
	ensureNotBeforeProjectStart(params.workDate ?? row.work_date, row.start_date);

	// Kategória validáció (ha meg van adva): a projekt saját listájából; a bejegyzés
	// eddigi, azóta inaktivált kategóriája megtartható
	const categoryId =
		params.categoryId !== undefined
			? await resolveEntryCategory(context, row.project_id, params.categoryId, row.category_id ?? null)
			: undefined;

	const update = await context.db.query(
		`UPDATE app__racona_work.work_entries SET
		    title = COALESCE($2, title),
		    description = CASE WHEN $3::boolean THEN $4 ELSE description END,
		    hours = COALESCE($5, hours),
		    work_date = COALESCE($6, work_date),
		    category_id = CASE WHEN $7::boolean THEN $8 ELSE category_id END,
		    updated_at = NOW()
		 WHERE id = $1
		 RETURNING id, project_id, employee_id, category_id, title, description, hours, work_date,
		           status, created_at, updated_at`,
		[
			row.id,
			params.title?.trim() ?? null,
			params.description !== undefined,
			params.description === undefined
				? null
				: params.description === null
					? null
					: String(params.description).trim() || null,
			params.hours ?? null,
			params.workDate ?? null,
			categoryId !== undefined,
			categoryId ?? null
		]
	);
	const r = update.rows[0] as any;
	return {
		id: r.id,
		projectId: r.project_id,
		employeeId: r.employee_id,
		categoryId: r.category_id ?? null,
		title: r.title,
		description: r.description ?? null,
		hours: typeof r.hours === 'string' ? parseFloat(r.hours) : Number(r.hours),
		workDate: r.work_date,
		status: r.status,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};
}

// --- Törlés -----------------------------------------------------------------

export async function deleteWorkEntry(
	params: { id: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.id) throw new Error('Érvénytelen bejegyzés azonosító');

	const existing = await context.db.query(
		`SELECT we.id, we.project_id, we.employee_id, p.organization_id, p.closed_at, e.user_id,
		        to_char(we.work_date, 'YYYY-MM-DD') AS work_date,
		        to_char(p.start_date, 'YYYY-MM-DD') AS start_date
		   FROM app__racona_work.work_entries we
		   JOIN app__racona_work.projects p ON p.id = we.project_id
		   JOIN app__racona_work.employees e ON e.id = we.employee_id
		  WHERE we.id = $1`,
		[params.id]
	);
	if (existing.rows.length === 0) throw new Error('Bejegyzés nem található');
	const row = existing.rows[0] as {
		id: number;
		project_id: number;
		employee_id: number;
		organization_id: number;
		closed_at: string | null;
		user_id: number;
		work_date: string;
		start_date: string | null;
	};

	const dev = isDevMode(context);
	const coreAdmin = isCoreAdmin(context);
	if (!dev && !coreAdmin) {
		const callerId = await resolveUserId(context);
		if (callerId === row.user_id) {
			await requireCapability(context, row.organization_id, 'work.log');
		} else {
			const canAll = await hasCapability(context, row.organization_id, 'work.view.all');
			const canManage = canAll
				? true
				: await hasCapability(context, row.organization_id, 'project.manage', row.project_id);
			if (!canAll && !canManage) {
				throw new Error('Nincs jogosultságod törölni ezt a bejegyzést');
			}
		}
	}

	ensureProjectOpen(row.closed_at, 'A projekt le van zárva, a feladatai nem törölhetők');

	await context.db.query(`DELETE FROM app__racona_work.work_entries WHERE id = $1`, [params.id]);
	return { ok: true };
}
