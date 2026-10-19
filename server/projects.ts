/**
 * Projekt-kezelés szerver funkciók.
 *
 * Minden művelet szervezet-szinten szűr (organizationId), és a megfelelő
 * capability-t ellenőrzi:
 *   - project.view.own / project.view.all  → olvasás
 *   - project.create                        → létrehozás
 *   - project.manage                        → módosítás, törlés, tagok
 *   - project.close                         → lezárás, visszanyitás
 *
 * A projektvezető (tag, role = 'lead') a saját projektjén szervezeti szerep
 * nélkül is kapja a project.manage és project.close jogot (specs/project-lead.md).
 *
 * A publikus (remote hívható) funkciók a functions.ts-ben vannak reexportálva.
 */

import type { RemoteContext } from './context.js';
import { isDevMode, isCoreAdmin, resolveUserId } from './context.js';
import { hasCapability, requireCapability, PROJECT_LEAD_ROLE } from './permissions.js';

// --- Típusok ----------------------------------------------------------------

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface Project {
	id: number;
	organizationId: number;
	name: string;
	description: string | null;
	status: ProjectStatus;
	startDate: string | null;
	endDate: string | null;
	createdBy: number;
	createdAt: string;
	updatedAt: string;
	/** A lezárás ideje; kitöltve a projekt feladatai zárolva vannak. */
	closedAt: string | null;
	closedBy: number | null;
}

export interface ProjectRow extends Project {
	memberCount: number;
	createdByName: string | null;
	closedByName: string | null;
}

/** A hívó jogai egy projekten: szervezeti szerepből vagy projektvezetőként. */
export interface ProjectAccess {
	manage: boolean;
	close: boolean;
}

export interface ProjectDetailRow extends ProjectRow {
	access: ProjectAccess;
}

export interface ProjectListParams {
	organizationId: number;
	status?: ProjectStatus | 'all';
	search?: string;
	page?: number;
	pageSize?: number;
	sortBy?: 'name' | 'status' | 'start_date' | 'end_date' | 'created_at' | 'updated_at';
	sortOrder?: 'asc' | 'desc';
}

export interface ProjectListResult {
	data: ProjectRow[];
	pagination: {
		page: number;
		pageSize: number;
		totalCount: number;
		totalPages: number;
	};
}

export interface ProjectMemberRow {
	projectId: number;
	employeeId: number;
	userId: number;
	userName: string;
	userEmail: string;
	userImage: string | null;
	position: string | null;
	role: string;
	assignedAt: string;
	/** Alapértelmezett munkakategória ezen a projekten (null: nincs). */
	defaultCategoryId: number | null;
}

// --- Segédfüggvények --------------------------------------------------------

const ALLOWED_SORT: Record<string, string> = {
	name: 'name',
	status: 'status',
	start_date: 'start_date',
	end_date: 'end_date',
	created_at: 'created_at',
	updated_at: 'updated_at'
};

const VALID_STATUSES: readonly ProjectStatus[] = ['active', 'paused', 'completed', 'archived'];


function mapProjectRow(row: any): ProjectRow {
	return {
		id: row.id,
		organizationId: row.organization_id,
		name: row.name,
		description: row.description ?? null,
		status: row.status,
		startDate: row.start_date ?? null,
		endDate: row.end_date ?? null,
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		closedAt: row.closed_at ?? null,
		closedBy: row.closed_by ?? null,
		memberCount: Number(row.member_count ?? 0),
		createdByName: row.created_by_name ?? null,
		closedByName: row.closed_by_name ?? null
	};
}

async function fetchUserEmployeeId(
	context: RemoteContext,
	organizationId: number,
	userId: number
): Promise<number | null> {
	const r = await context.db.query(
		`SELECT id FROM app__racona_work.employees
		  WHERE organization_id = $1 AND user_id = $2
		  LIMIT 1`,
		[organizationId, userId]
	);
	if (r.rows.length === 0) return null;
	return (r.rows[0] as { id: number }).id;
}

// --- Listázás ---------------------------------------------------------------

export async function listProjects(
	params: ProjectListParams,
	context: RemoteContext
): Promise<ProjectListResult> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}

	const page = Math.max(1, params.page ?? 1);
	const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 20));
	const sortCol = ALLOWED_SORT[params.sortBy ?? 'updated_at'] ?? 'updated_at';
	const sortOrder = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

	const dev = isDevMode(context);
	const coreAdmin = isCoreAdmin(context);
	const userId = dev || coreAdmin ? null : await resolveUserId(context);

	// Ki látja az összes projektet? Core admin, dev mód, vagy 'project.view.all'.
	let canViewAll = dev || coreAdmin;
	if (!canViewAll) {
		canViewAll = await hasCapability(context, params.organizationId, 'project.view.all');
	}

	// Ha nem láthatja mind, ellenőrizzük, hogy legalább 'project.view.own'-je van-e.
	if (!canViewAll) {
		const canViewOwn = await hasCapability(context, params.organizationId, 'project.view.own');
		if (!canViewOwn) {
			throw new Error('Nincs jogosultságod a projektek megtekintéséhez');
		}
	}

	const conditions: string[] = ['p.organization_id = $1'];
	const queryParams: unknown[] = [params.organizationId];

	if (params.status && params.status !== 'all') {
		queryParams.push(params.status);
		conditions.push(`p.status = $${queryParams.length}`);
	}

	if (params.search && params.search.trim()) {
		queryParams.push(`%${params.search.trim()}%`);
		conditions.push(
			`(p.name ILIKE $${queryParams.length} OR p.description ILIKE $${queryParams.length})`
		);
	}

	// Ha nem láthatja az összeset, csak a saját tagságú projektjeit.
	if (!canViewAll && userId) {
		queryParams.push(userId);
		conditions.push(`EXISTS (
			SELECT 1 FROM app__racona_work.project_members pm
			  JOIN app__racona_work.employees e ON e.id = pm.employee_id
			 WHERE pm.project_id = p.id AND e.user_id = $${queryParams.length}
		)`);
	}

	const whereClause = conditions.join(' AND ');

	const countResult = await context.db.query(
		`SELECT COUNT(*)::int AS total FROM app__racona_work.projects p WHERE ${whereClause}`,
		queryParams
	);
	const totalCount = (countResult.rows[0] as { total: number }).total;

	const offset = (page - 1) * pageSize;
	queryParams.push(pageSize, offset);

	const result = await context.db.query(
		`SELECT p.id, p.organization_id, p.name, p.description, p.status,
		        p.start_date, p.end_date, p.created_by, p.created_at, p.updated_at,
		        p.closed_at, p.closed_by,
		        u.full_name AS created_by_name,
		        cu.full_name AS closed_by_name,
		        COALESCE(mc.member_count, 0) AS member_count
		   FROM app__racona_work.projects p
		   LEFT JOIN auth.users u ON u.id = p.created_by
		   LEFT JOIN auth.users cu ON cu.id = p.closed_by
		   LEFT JOIN (
		     SELECT project_id, COUNT(*)::int AS member_count
		       FROM app__racona_work.project_members
		      GROUP BY project_id
		   ) mc ON mc.project_id = p.id
		  WHERE ${whereClause}
		  ORDER BY p.${sortCol} ${sortOrder}, p.id ${sortOrder}
		  LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
		queryParams
	);

	return {
		data: result.rows.map(mapProjectRow),
		pagination: {
			page,
			pageSize,
			totalCount,
			totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
		}
	};
}

// --- Egy projekt lekérdezése ------------------------------------------------

export async function getProject(
	params: { id: number },
	context: RemoteContext
): Promise<ProjectDetailRow> {
	if (!params?.id) throw new Error('Érvénytelen projekt azonosító');

	const result = await context.db.query(
		`SELECT p.id, p.organization_id, p.name, p.description, p.status,
		        p.start_date, p.end_date, p.created_by, p.created_at, p.updated_at,
		        p.closed_at, p.closed_by,
		        u.full_name AS created_by_name,
		        cu.full_name AS closed_by_name,
		        COALESCE(mc.member_count, 0) AS member_count
		   FROM app__racona_work.projects p
		   LEFT JOIN auth.users u ON u.id = p.created_by
		   LEFT JOIN auth.users cu ON cu.id = p.closed_by
		   LEFT JOIN (
		     SELECT project_id, COUNT(*)::int AS member_count
		       FROM app__racona_work.project_members
		      WHERE project_id = $1
		      GROUP BY project_id
		   ) mc ON mc.project_id = p.id
		  WHERE p.id = $1`,
		[params.id]
	);
	if (result.rows.length === 0) throw new Error('Projekt nem található');
	const row = result.rows[0] as any;

	// Jogosultság: view.all vagy saját tagság
	const orgId = row.organization_id;
	const dev = isDevMode(context);
	const coreAdmin = isCoreAdmin(context);

	if (!dev && !coreAdmin) {
		const canViewAll = await hasCapability(context, orgId, 'project.view.all');
		if (!canViewAll) {
			const userId = await resolveUserId(context);
			const membership = await context.db.query(
				`SELECT 1 FROM app__racona_work.project_members pm
				   JOIN app__racona_work.employees e ON e.id = pm.employee_id
				  WHERE pm.project_id = $1 AND e.user_id = $2
				  LIMIT 1`,
				[params.id, userId]
			);
			if (membership.rows.length === 0) {
				throw new Error('Nincs hozzáférésed ehhez a projekthez');
			}
		}
	}

	const access: ProjectAccess =
		dev || coreAdmin
			? { manage: true, close: true }
			: {
					manage: await hasCapability(context, orgId, 'project.manage', row.id),
					close: await hasCapability(context, orgId, 'project.close', row.id)
				};
	return { ...mapProjectRow(row), access };
}

// --- Létrehozás -------------------------------------------------------------

function validateDates(start: string | null, end: string | null): void {
	if (!start || !end) return;
	if (end < start) throw new Error('A záró dátum nem lehet korábbi a kezdő dátumnál');
}

function normalizeStatus(raw: unknown): ProjectStatus {
	if (typeof raw !== 'string') return 'active';
	return (VALID_STATUSES as readonly string[]).includes(raw)
		? (raw as ProjectStatus)
		: 'active';
}

export async function createProject(
	params: {
		organizationId: number;
		name: string;
		description?: string;
		status?: ProjectStatus;
		startDate?: string | null;
		endDate?: string | null;
	},
	context: RemoteContext
): Promise<ProjectRow> {
	if (!params?.organizationId || params.organizationId <= 0) {
		throw new Error('Érvénytelen szervezet azonosító');
	}
	if (!params.name || !params.name.trim()) {
		throw new Error('A projekt neve kötelező');
	}

	await requireCapability(context, params.organizationId, 'project.create');

	const status = normalizeStatus(params.status ?? 'active');
	const startDate = params.startDate ?? null;
	const endDate = params.endDate ?? null;
	validateDates(startDate, endDate);

	const userId = await resolveUserId(context);

	const client = await context.db.connect();
	try {
		await client.query('BEGIN');

		const insertResult = await client.query(
			`INSERT INTO app__racona_work.projects
			    (organization_id, name, description, status, start_date, end_date, created_by, created_at, updated_at)
			  VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
			  RETURNING id`,
			[
				params.organizationId,
				params.name.trim(),
				params.description?.trim() || null,
				status,
				startDate,
				endDate,
				userId
			]
		);
		const projectId = (insertResult.rows[0] as { id: number }).id;

		// A létrehozót felvesszük tagként (ha van hozzá employee rekord)
		const creatorEmpId = await fetchUserEmployeeId(context, params.organizationId, userId);
		if (creatorEmpId) {
			await client.query(
				`INSERT INTO app__racona_work.project_members (project_id, employee_id, role)
				 VALUES ($1, $2, 'owner')
				 ON CONFLICT DO NOTHING`,
				[projectId, creatorEmpId]
			);
		}

		await client.query('COMMIT');
		return await getProject({ id: projectId }, context);
	} catch (err) {
		await client.query('ROLLBACK');
		throw err;
	} finally {
		client.release();
	}
}

// --- Frissítés --------------------------------------------------------------

export async function updateProject(
	params: {
		id: number;
		name?: string;
		description?: string | null;
		status?: ProjectStatus;
		startDate?: string | null;
		endDate?: string | null;
	},
	context: RemoteContext
): Promise<ProjectRow> {
	if (!params?.id) throw new Error('Érvénytelen projekt azonosító');

	const existing = await context.db.query(
		`SELECT id, organization_id, start_date, end_date, closed_at
		   FROM app__racona_work.projects WHERE id = $1`,
		[params.id]
	);
	if (existing.rows.length === 0) throw new Error('Projekt nem található');
	const current = existing.rows[0] as {
		id: number;
		organization_id: number;
		start_date: string | null;
		end_date: string | null;
		closed_at: string | null;
	};

	await requireCapability(context, current.organization_id, 'project.manage', params.id);
	ensureProjectOpen(current.closed_at, 'A projekt le van zárva, az adatai nem módosíthatók');

	const newStart =
		params.startDate === undefined ? current.start_date : params.startDate;
	const newEnd = params.endDate === undefined ? current.end_date : params.endDate;
	validateDates(newStart, newEnd);

	const name = params.name !== undefined ? params.name?.trim() || null : null;
	if (params.name !== undefined && !name) {
		throw new Error('A projekt neve kötelező');
	}

	await context.db.query(
		`UPDATE app__racona_work.projects SET
		    name = COALESCE($2, name),
		    description = CASE WHEN $3::boolean THEN $4 ELSE description END,
		    status = COALESCE($5, status),
		    start_date = CASE WHEN $6::boolean THEN $7 ELSE start_date END,
		    end_date = CASE WHEN $8::boolean THEN $9 ELSE end_date END,
		    updated_at = NOW()
		 WHERE id = $1`,
		[
			params.id,
			name,
			params.description !== undefined,
			params.description !== undefined
				? params.description === null
					? null
					: String(params.description).trim() || null
				: null,
			params.status ? normalizeStatus(params.status) : null,
			params.startDate !== undefined,
			params.startDate !== undefined ? params.startDate : null,
			params.endDate !== undefined,
			params.endDate !== undefined ? params.endDate : null
		]
	);

	return await getProject({ id: params.id }, context);
}

// --- Törlés -----------------------------------------------------------------

export async function deleteProject(
	params: { id: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.id) throw new Error('Érvénytelen projekt azonosító');

	const existing = await context.db.query(
		`SELECT id, organization_id, closed_at FROM app__racona_work.projects WHERE id = $1`,
		[params.id]
	);
	if (existing.rows.length === 0) throw new Error('Projekt nem található');
	const current = existing.rows[0] as { id: number; organization_id: number; closed_at: string | null };

	await requireCapability(context, current.organization_id, 'project.manage', params.id);
	// A törlés a feladatokat is vinné, ezért lezárt projektnél előbb vissza kell nyitni.
	ensureProjectOpen(current.closed_at, 'Lezárt projekt nem törölhető. A törléshez előbb nyisd vissza.');

	await context.db.query(`DELETE FROM app__racona_work.projects WHERE id = $1`, [params.id]);
	return { ok: true };
}

// --- Lezárás és visszanyitás ------------------------------------------------

/**
 * Belső segéd (nem remote függvény) — a work-entries.ts is használja.
 * Lezárt projektnél (kitöltött `closed_at`) a megadott hibaüzenettel dob.
 */
export function ensureProjectOpen(closedAt: unknown, message: string): void {
	if (closedAt) throw new Error(message);
}

async function loadProjectForClosing(
	context: RemoteContext,
	id: number
): Promise<{ id: number; organization_id: number; closed_at: string | null }> {
	if (!id) throw new Error('Érvénytelen projekt azonosító');
	const r = await context.db.query(
		`SELECT id, organization_id, closed_at FROM app__racona_work.projects WHERE id = $1`,
		[id]
	);
	if (r.rows.length === 0) throw new Error('Projekt nem található');
	const row = r.rows[0] as { id: number; organization_id: number; closed_at: string | null };
	await requireCapability(context, row.organization_id, 'project.close', row.id);
	return row;
}

/** Projekt lezárása: a feladatai nem rögzíthetők, nem módosíthatók, nem törölhetők. */
export async function closeProject(
	params: { id: number },
	context: RemoteContext
): Promise<ProjectRow> {
	const project = await loadProjectForClosing(context, params?.id);
	if (project.closed_at) throw new Error('A projekt már le van zárva');

	const userId = await resolveUserId(context);
	await context.db.query(
		`UPDATE app__racona_work.projects
		    SET closed_at = NOW(), closed_by = $2, updated_at = NOW()
		  WHERE id = $1 AND closed_at IS NULL`,
		[project.id, userId]
	);
	return await getProject({ id: project.id }, context);
}

/** Lezárt projekt visszanyitása. */
export async function reopenProject(
	params: { id: number },
	context: RemoteContext
): Promise<ProjectRow> {
	const project = await loadProjectForClosing(context, params?.id);
	if (!project.closed_at) throw new Error('A projekt nincs lezárva');

	await context.db.query(
		`UPDATE app__racona_work.projects
		    SET closed_at = NULL, closed_by = NULL, updated_at = NOW()
		  WHERE id = $1`,
		[project.id]
	);
	return await getProject({ id: project.id }, context);
}

// --- Tagok ------------------------------------------------------------------

/**
 * Projektvezetőt kijelölni vagy elvenni csak az tud, akinek a projektvezető
 * minden joga megvan ezen a projekten (a project.manage mellett a project.close is),
 * így senki nem adhat bővebb jogot, mint ami neki van.
 */
async function requireLeadChangeAllowed(
	context: RemoteContext,
	project: { id: number; organization_id: number },
	employeeId: number,
	newRole: string | null
): Promise<void> {
	const current = await context.db.query(
		`SELECT role FROM app__racona_work.project_members WHERE project_id = $1 AND employee_id = $2`,
		[project.id, employeeId]
	);
	const wasLead = current.rows[0]?.role === PROJECT_LEAD_ROLE;
	const isLead = newRole === PROJECT_LEAD_ROLE;
	if (wasLead === isLead) return;
	if (!(await hasCapability(context, project.organization_id, 'project.close', project.id))) {
		throw new Error('Projektvezetőt csak az jelölhet ki vagy vehet el, aki a projektet le is zárhatja.');
	}
}

export async function listProjectMembers(
	params: { projectId: number },
	context: RemoteContext
): Promise<ProjectMemberRow[]> {
	if (!params?.projectId) throw new Error('Érvénytelen projekt azonosító');

	// A projekt láthatóságához ugyanaz kell, mint a getProject-hez.
	const project = await getProject({ id: params.projectId }, context);

	const result = await context.db.query(
		`SELECT pm.project_id, pm.employee_id, pm.role, pm.assigned_at, pm.default_category_id,
		        e.user_id, u.full_name AS user_name, u.email AS user_email, u.image AS user_image,
		        e.position
		   FROM app__racona_work.project_members pm
		   JOIN app__racona_work.employees e ON e.id = pm.employee_id
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE pm.project_id = $1
		  ORDER BY u.full_name ASC`,
		[project.id]
	);

	return result.rows.map((r: any) => ({
		projectId: r.project_id,
		employeeId: r.employee_id,
		userId: r.user_id,
		userName: r.user_name,
		userEmail: r.user_email,
		userImage: r.user_image ?? null,
		position: r.position ?? null,
		role: r.role,
		assignedAt: r.assigned_at,
		defaultCategoryId: r.default_category_id ?? null
	}));
}

export async function addProjectMember(
	params: { projectId: number; employeeId: number; role?: string },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.projectId || !params?.employeeId) {
		throw new Error('Érvénytelen paraméter');
	}

	const projectRow = await context.db.query(
		`SELECT id, organization_id, closed_at FROM app__racona_work.projects WHERE id = $1`,
		[params.projectId]
	);
	if (projectRow.rows.length === 0) throw new Error('Projekt nem található');
	const project = projectRow.rows[0] as { id: number; organization_id: number; closed_at: string | null };

	await requireCapability(context, project.organization_id, 'project.manage', project.id);
	ensureProjectOpen(project.closed_at, 'A projekt le van zárva, a tagjai nem módosíthatók');

	// Az employee a szervezethez tartozik-e?
	const empRow = await context.db.query(
		`SELECT id, organization_id FROM app__racona_work.employees WHERE id = $1`,
		[params.employeeId]
	);
	if (empRow.rows.length === 0) throw new Error('Dolgozó nem található');
	const emp = empRow.rows[0] as { id: number; organization_id: number };
	if (emp.organization_id !== project.organization_id) {
		throw new Error('A dolgozó nem ugyanabba a szervezetbe tartozik, mint a projekt');
	}

	const role = params.role?.trim() || 'member';
	await requireLeadChangeAllowed(context, project, emp.id, role);

	await context.db.query(
		`INSERT INTO app__racona_work.project_members (project_id, employee_id, role)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (project_id, employee_id) DO UPDATE SET role = EXCLUDED.role`,
		[project.id, emp.id, role]
	);

	return { ok: true };
}

export async function removeProjectMember(
	params: { projectId: number; employeeId: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	if (!params?.projectId || !params?.employeeId) {
		throw new Error('Érvénytelen paraméter');
	}

	const projectRow = await context.db.query(
		`SELECT id, organization_id, closed_at FROM app__racona_work.projects WHERE id = $1`,
		[params.projectId]
	);
	if (projectRow.rows.length === 0) throw new Error('Projekt nem található');
	const project = projectRow.rows[0] as { id: number; organization_id: number; closed_at: string | null };

	await requireCapability(context, project.organization_id, 'project.manage', project.id);
	ensureProjectOpen(project.closed_at, 'A projekt le van zárva, a tagjai nem módosíthatók');
	await requireLeadChangeAllowed(context, project, params.employeeId, null);

	await context.db.query(
		`DELETE FROM app__racona_work.project_members
		  WHERE project_id = $1 AND employee_id = $2`,
		[project.id, params.employeeId]
	);
	return { ok: true };
}
