/**
 * Projektenkénti munkabejegyzés-kategóriák.
 *
 * Minden projektnek saját kategórialistája van (work_entry_categories.project_id).
 * A project_id = NULL sorok a régi, közös lista: ezek már nem választhatók
 * bejegyzéshez, csak mintaként másolhatók át egy projektbe (029-es migráció).
 *
 * Amíg egy projektnek nincs aktív kategóriája, a bejegyzésnél nem kötelező
 * kategóriát választani.
 *
 * A projekt kezelője tagonként alapértelmezett kategóriát állíthat be
 * (project_members.default_category_id): rögzítéskor ez van előre kiválasztva.
 *
 * Capability minták:
 *   - work.log / work.view.all → a projekt aktív kategóriáit lekérheti
 *   - project.manage           → a projekt kategóriáit és a tagok alapértelmezését
 *                                kezelheti (a projektvezető is)
 *
 * Lezárt projekt kategóriái nem módosíthatók.
 */

import type { RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import { hasCapability, requireAnyCapability, requireCapability } from './permissions.js';
import { ensureProjectOpen } from './projects.js';

export interface WorkEntryCategory {
	id: number;
	projectId: number | null;
	name: string;
	sortOrder: number;
	isActive: boolean;
	/** Hány bejegyzés használja (törölni csak a használatlant lehet). */
	entryCount: number;
	/** A lekérdezett dolgozó alapértelmezett kategóriája ezen a projekten. */
	isDefault: boolean;
}

/** Ahonnan kategóriák másolhatók: egy másik projekt, vagy (projectId = null) a régi közös lista. */
export interface WorkEntryCategorySource {
	projectId: number | null;
	name: string | null;
	categoryCount: number;
}

const MAX_NAME_LENGTH = 200;

// --- Helperek ---------------------------------------------------------------

async function loadProject(
	context: RemoteContext,
	projectId: number
): Promise<{ id: number; organization_id: number; closed_at: string | null }> {
	if (!projectId || projectId <= 0) throw new Error('Érvénytelen projekt azonosító');
	const r = await context.db.query(
		`SELECT id, organization_id, closed_at FROM app__racona_work.projects WHERE id = $1`,
		[projectId]
	);
	if (r.rows.length === 0) throw new Error('Projekt nem található');
	return r.rows[0];
}

/** A projekt kategóriáinak kezelése: project.manage kell, és a projekt nem lehet lezárva. */
async function requireManageableProject(context: RemoteContext, projectId: number) {
	const project = await loadProject(context, projectId);
	await requireCapability(context, project.organization_id, 'project.manage', project.id);
	ensureProjectOpen(project.closed_at, 'A projekt le van zárva, a kategóriái nem módosíthatók');
	return project;
}

async function loadCategory(
	context: RemoteContext,
	id: number
): Promise<{ id: number; project_id: number | null; name: string; is_active: boolean }> {
	if (!id || id <= 0) throw new Error('Érvénytelen kategória azonosító');
	const r = await context.db.query(
		`SELECT id, project_id, name, is_active FROM app__racona_work.work_entry_categories WHERE id = $1`,
		[id]
	);
	if (r.rows.length === 0) throw new Error('Kategória nem található');
	const row = r.rows[0];
	if (row.project_id === null) throw new Error('A régi közös lista nem szerkeszthető, csak átvehető egy projektbe');
	return row;
}

function normalizeName(name: unknown): string {
	const trimmed = typeof name === 'string' ? name.trim() : '';
	if (!trimmed) throw new Error('A kategória neve kötelező');
	if (trimmed.length > MAX_NAME_LENGTH) {
		throw new Error(`A kategória neve legfeljebb ${MAX_NAME_LENGTH} karakter lehet`);
	}
	return trimmed;
}

async function ensureUniqueName(
	context: RemoteContext,
	projectId: number,
	name: string,
	excludeId?: number
): Promise<void> {
	const r = await context.db.query(
		`SELECT 1 FROM app__racona_work.work_entry_categories
		  WHERE project_id = $1 AND lower(name) = lower($2) AND id <> $3
		  LIMIT 1`,
		[projectId, name, excludeId ?? 0]
	);
	if (r.rows.length > 0) throw new Error('Ebben a projektben már van ilyen nevű kategória');
}

function mapCategory(r: any): WorkEntryCategory {
	return {
		id: r.id,
		projectId: r.project_id ?? null,
		name: r.name,
		sortOrder: r.sort_order,
		isActive: r.is_active,
		entryCount: Number(r.entry_count ?? 0),
		isDefault: r.is_default === true
	};
}

const CATEGORY_SELECT = `SELECT c.id, c.project_id, c.name, c.sort_order, c.is_active,
	        (SELECT COUNT(*) FROM app__racona_work.work_entries we WHERE we.category_id = c.id)::int AS entry_count
	   FROM app__racona_work.work_entry_categories c`;

/**
 * Belső segéd (nem remote függvény) a bejegyzés rögzítéséhez és módosításához:
 * ellenőrzi a választott kategóriát, és visszaadja a mentendő category_id-t.
 *
 * - Kategória nélkül csak akkor menthető, ha a projektnek nincs aktív kategóriája.
 * - A kategóriának a bejegyzés projektjéhez kell tartoznia.
 * - Inaktív kategória nem választható, kivéve ha a bejegyzés eddig is azon volt
 *   (`currentCategoryId`), így a régi bejegyzés más mezője szabadon szerkeszthető.
 */
export async function resolveEntryCategory(
	context: RemoteContext,
	projectId: number,
	categoryId: number | null | undefined,
	currentCategoryId: number | null = null
): Promise<number | null> {
	if (!categoryId) {
		const active = await context.db.query(
			`SELECT 1 FROM app__racona_work.work_entry_categories
			  WHERE project_id = $1 AND is_active = TRUE LIMIT 1`,
			[projectId]
		);
		if (active.rows.length > 0) throw new Error('A kategória megadása kötelező');
		return null;
	}

	const r = await context.db.query(
		`SELECT id, is_active FROM app__racona_work.work_entry_categories WHERE id = $1 AND project_id = $2`,
		[categoryId, projectId]
	);
	if (r.rows.length === 0) throw new Error('A megadott kategória nem tartozik ehhez a projekthez');
	if (!r.rows[0].is_active && categoryId !== currentCategoryId) {
		throw new Error('A megadott kategória inaktív');
	}
	return categoryId;
}

// --- Lekérdezés -------------------------------------------------------------

/** Belső segéd (nem remote függvény): a hívó dolgozói rekordja a szervezetben, vagy null. */
export async function callerEmployeeId(context: RemoteContext, organizationId: number): Promise<number | null> {
	const userId = await resolveUserId(context);
	const r = await context.db.query(
		`SELECT id FROM app__racona_work.employees WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
		[userId, organizationId]
	);
	return r.rows[0]?.id ?? null;
}

/**
 * A projekt kategóriái sorrendben. Alapból csak az aktívak; az inaktívakat
 * (`includeInactive`) csak a projekt kezelője kérheti le.
 *
 * Az `isDefault` a hívó (vagy `employeeId` esetén a megadott dolgozó)
 * alapértelmezett kategóriáját jelöli. Más dolgozóét csak az kérheti, aki
 * helyette rögzíthet is (work.view.all vagy project.manage); egyébként nincs jelölés.
 */
export async function getWorkEntryCategories(
	params: { projectId: number; includeInactive?: boolean; employeeId?: number | null },
	context: RemoteContext
): Promise<WorkEntryCategory[]> {
	const project = await loadProject(context, params?.projectId);
	const canManage = await hasCapability(context, project.organization_id, 'project.manage', project.id);
	if (!canManage) {
		await requireAnyCapability(context, project.organization_id, ['work.log', 'work.view.all']);
	}

	const ownEmployeeId = await callerEmployeeId(context, project.organization_id);
	let employeeId = ownEmployeeId;
	if (params.employeeId && params.employeeId !== ownEmployeeId) {
		const canActForOthers =
			canManage || (await hasCapability(context, project.organization_id, 'work.view.all'));
		employeeId = canActForOthers ? params.employeeId : null;
	}

	const onlyActive = !(params.includeInactive && canManage);
	const result = await context.db.query(
		`SELECT c.id, c.project_id, c.name, c.sort_order, c.is_active,
		        (SELECT COUNT(*) FROM app__racona_work.work_entries we WHERE we.category_id = c.id)::int AS entry_count,
		        COALESCE(c.id = (
		          SELECT pm.default_category_id FROM app__racona_work.project_members pm
		           WHERE pm.project_id = c.project_id AND pm.employee_id = $2
		        ), FALSE) AS is_default
		   FROM app__racona_work.work_entry_categories c
		  WHERE c.project_id = $1${onlyActive ? ' AND c.is_active = TRUE' : ''}
		  ORDER BY c.sort_order ASC, c.id ASC`,
		[project.id, employeeId]
	);
	return result.rows.map(mapCategory);
}

/**
 * Egy projekttag alapértelmezett kategóriájának beállítása (null: nincs).
 * A kategória a projekt saját, aktív kategóriája lehet.
 */
export async function setProjectMemberDefaultCategory(
	params: { projectId: number; employeeId: number; categoryId: number | null },
	context: RemoteContext
): Promise<{ ok: true }> {
	const project = await requireManageableProject(context, params?.projectId);
	if (!params.employeeId) throw new Error('Érvénytelen dolgozó azonosító');

	const categoryId = params.categoryId || null;
	if (categoryId !== null) {
		const cat = await context.db.query(
			`SELECT id FROM app__racona_work.work_entry_categories
			  WHERE id = $1 AND project_id = $2 AND is_active = TRUE`,
			[categoryId, project.id]
		);
		if (cat.rows.length === 0) throw new Error('A kategória nem ennek a projektnek az aktív kategóriája');
	}

	const updated = await context.db.query(
		`UPDATE app__racona_work.project_members
		    SET default_category_id = $3
		  WHERE project_id = $1 AND employee_id = $2
		  RETURNING employee_id`,
		[project.id, params.employeeId, categoryId]
	);
	if (updated.rows.length === 0) throw new Error('A dolgozó nem tagja ennek a projektnek');
	return { ok: true };
}

/**
 * Honnan vehet át kategóriákat a projekt: a régi közös lista (ha van még) és
 * a szervezet többi projektje, amelynek van aktív kategóriája.
 */
export async function getWorkEntryCategorySources(
	params: { projectId: number },
	context: RemoteContext
): Promise<WorkEntryCategorySource[]> {
	const project = await loadProject(context, params?.projectId);
	await requireCapability(context, project.organization_id, 'project.manage', project.id);

	const legacy = await context.db.query(
		`SELECT COUNT(*)::int AS count FROM app__racona_work.work_entry_categories
		  WHERE project_id IS NULL AND is_active = TRUE`
	);
	const projects = await context.db.query(
		`SELECT p.id, p.name, COUNT(c.id)::int AS count
		   FROM app__racona_work.projects p
		   JOIN app__racona_work.work_entry_categories c ON c.project_id = p.id AND c.is_active = TRUE
		  WHERE p.organization_id = $1 AND p.id <> $2
		  GROUP BY p.id, p.name
		  ORDER BY p.name ASC`,
		[project.organization_id, project.id]
	);

	const sources: WorkEntryCategorySource[] = [];
	const legacyCount = Number(legacy.rows[0]?.count ?? 0);
	if (legacyCount > 0) sources.push({ projectId: null, name: null, categoryCount: legacyCount });
	for (const r of projects.rows) {
		sources.push({ projectId: r.id, name: r.name, categoryCount: Number(r.count) });
	}
	return sources;
}

// --- Kezelés ----------------------------------------------------------------

export async function createWorkEntryCategory(
	params: { projectId: number; name: string },
	context: RemoteContext
): Promise<WorkEntryCategory> {
	const project = await requireManageableProject(context, params?.projectId);
	const name = normalizeName(params.name);
	await ensureUniqueName(context, project.id, name);

	const result = await context.db.query(
		`INSERT INTO app__racona_work.work_entry_categories (project_id, name, sort_order, is_active, created_at, updated_at)
		 SELECT $1, $2, COALESCE(MAX(sort_order), 0) + 10, TRUE, NOW(), NOW()
		   FROM app__racona_work.work_entry_categories WHERE project_id = $1
		 RETURNING id, project_id, name, sort_order, is_active`,
		[project.id, name]
	);
	return mapCategory(result.rows[0]);
}

/** Átnevezés és aktiválás/inaktiválás. Az inaktív kategória új bejegyzéshez nem választható. */
export async function updateWorkEntryCategory(
	params: { id: number; name?: string; isActive?: boolean },
	context: RemoteContext
): Promise<WorkEntryCategory> {
	const category = await loadCategory(context, params?.id);
	await requireManageableProject(context, category.project_id!);

	const name = params.name !== undefined ? normalizeName(params.name) : category.name;
	if (params.name !== undefined) await ensureUniqueName(context, category.project_id!, name, category.id);
	const isActive = typeof params.isActive === 'boolean' ? params.isActive : category.is_active;

	await context.db.query(
		`UPDATE app__racona_work.work_entry_categories
		    SET name = $2, is_active = $3, updated_at = NOW()
		  WHERE id = $1`,
		[category.id, name, isActive]
	);
	const saved = await context.db.query(`${CATEGORY_SELECT} WHERE c.id = $1`, [category.id]);
	return mapCategory(saved.rows[0]);
}

/** Csak használatlan kategória törölhető; a használtat inaktiválni lehet. */
export async function deleteWorkEntryCategory(
	params: { id: number },
	context: RemoteContext
): Promise<{ ok: true }> {
	const category = await loadCategory(context, params?.id);
	await requireManageableProject(context, category.project_id!);

	const usage = await context.db.query(
		`SELECT COUNT(*)::int AS count FROM app__racona_work.work_entries WHERE category_id = $1`,
		[category.id]
	);
	const count = Number(usage.rows[0]?.count ?? 0);
	if (count > 0) {
		throw new Error(
			`A kategóriát ${count} bejegyzés használja, ezért nem törölhető. Inaktiváld, akkor új bejegyzéshez már nem választható.`
		);
	}

	await context.db.query(`DELETE FROM app__racona_work.work_entry_categories WHERE id = $1`, [category.id]);
	return { ok: true };
}

/** Új sorrend: az `ids` a projekt összes kategóriája, a kívánt sorrendben. */
export async function reorderWorkEntryCategories(
	params: { projectId: number; ids: number[] },
	context: RemoteContext
): Promise<{ ok: true }> {
	const project = await requireManageableProject(context, params?.projectId);
	const ids = Array.isArray(params.ids) ? params.ids.map(Number) : [];

	const existing = await context.db.query(
		`SELECT id FROM app__racona_work.work_entry_categories WHERE project_id = $1`,
		[project.id]
	);
	const own = new Set(existing.rows.map((r: any) => Number(r.id)));
	if (ids.length !== own.size || new Set(ids).size !== ids.length || ids.some((id) => !own.has(id))) {
		throw new Error('A sorrendben a projekt összes kategóriájának pontosan egyszer kell szerepelnie');
	}

	await context.db.query(
		`UPDATE app__racona_work.work_entry_categories c
		    SET sort_order = (v.ord * 10)::smallint, updated_at = NOW()
		   FROM unnest($2::int[]) WITH ORDINALITY AS v(id, ord)
		  WHERE c.id = v.id AND c.project_id = $1`,
		[project.id, ids]
	);
	return { ok: true };
}

/**
 * Kategóriák átvétele egy másik projektből vagy (sourceProjectId = null) a régi
 * közös listából. Csak az aktívak jönnek át, a projektben már meglévő nevek
 * (kis- és nagybetűtől függetlenül) kimaradnak; az átvettek a lista végére kerülnek.
 */
export async function copyWorkEntryCategories(
	params: { projectId: number; sourceProjectId: number | null },
	context: RemoteContext
): Promise<{ added: number; skipped: number }> {
	const project = await requireManageableProject(context, params?.projectId);
	const sourceProjectId = params.sourceProjectId ?? null;
	if (sourceProjectId !== null) {
		if (sourceProjectId === project.id) throw new Error('A projekt önmagából nem vehet át kategóriát');
		const source = await loadProject(context, sourceProjectId);
		if (source.organization_id !== project.organization_id) {
			throw new Error('Csak a szervezet saját projektjeiből lehet kategóriát átvenni');
		}
	}

	const total = await context.db.query(
		`SELECT COUNT(DISTINCT lower(name))::int AS count FROM app__racona_work.work_entry_categories
		  WHERE project_id IS NOT DISTINCT FROM $1::int AND is_active = TRUE`,
		[sourceProjectId]
	);
	const inserted = await context.db.query(
		`WITH src AS (
		   SELECT DISTINCT ON (lower(s.name)) s.id, s.name, s.sort_order
		     FROM app__racona_work.work_entry_categories s
		    WHERE s.project_id IS NOT DISTINCT FROM $2::int
		      AND s.is_active = TRUE
		      AND NOT EXISTS (
		        SELECT 1 FROM app__racona_work.work_entry_categories t
		         WHERE t.project_id = $1 AND lower(t.name) = lower(s.name)
		      )
		    ORDER BY lower(s.name), s.sort_order, s.id
		 ), base AS (
		   SELECT COALESCE(MAX(sort_order), 0) AS top
		     FROM app__racona_work.work_entry_categories WHERE project_id = $1
		 )
		 INSERT INTO app__racona_work.work_entry_categories (project_id, name, sort_order, is_active, created_at, updated_at)
		 SELECT $1, src.name, (base.top + ROW_NUMBER() OVER (ORDER BY src.sort_order, src.id) * 10)::smallint, TRUE, NOW(), NOW()
		   FROM src, base
		 RETURNING id`,
		[project.id, sourceProjectId]
	);

	const added = inserted.rows.length;
	return { added, skipped: Math.max(0, Number(total.rows[0]?.count ?? 0) - added) };
}
