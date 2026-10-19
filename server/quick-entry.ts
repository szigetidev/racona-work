/**
 * Heti gyors rögzítés: a dolgozó a projektbe lépés nélkül, egy heti nézetből
 * rögzíti a napi munkáit. Ez a modul a rögzítő ablak választólistáit adja; a
 * hét bejegyzései a listWorkEntries-szel, a mentés a createWorkEntry /
 * updateWorkEntry / deleteWorkEntry függvényekkel megy, azok ellenőrzéseivel.
 *
 * Capability minták:
 *   - work.log      → a saját nyitott projektjeire rögzíthet
 *   - work.view.all → más dolgozót is választhat, és helyette rögzíthet
 */

import type { RemoteContext } from './context.js';
import { hasCapability, requireAnyCapability } from './permissions.js';
import { callerEmployeeId } from './work-categories.js';

export interface QuickEntryCategory {
	id: number;
	name: string;
}

export interface QuickEntryProject {
	id: number;
	name: string;
	/** Kezdő dátum (YYYY-MM-DD): ennél korábbi nap nem rögzíthető. */
	startDate: string | null;
	/** A projekt aktív kategóriái; üres lista esetén a kategória nem kötelező. */
	categories: QuickEntryCategory[];
	/** A dolgozó alapértelmezett kategóriája ezen a projekten (csak aktív). */
	defaultCategoryId: number | null;
}

export interface QuickEntryEmployee {
	id: number;
	name: string;
	email: string;
}

export interface QuickEntryOptions {
	/** Akinek a hetét nézzük és akinek rögzítünk; null, ha a hívó nem dolgozó a szervezetben. */
	employeeId: number | null;
	/** A hívó saját dolgozói rekordja. */
	ownEmployeeId: number | null;
	/** Választhat-e más dolgozót (work.view.all). */
	canChooseEmployee: boolean;
	/** A választható dolgozók (csak canChooseEmployee esetén). */
	employees: QuickEntryEmployee[];
	/** A dolgozó nyitott projektjei, amelyeknek tagja. */
	projects: QuickEntryProject[];
}

export async function getQuickEntryOptions(
	params: { organizationId: number; employeeId?: number | null },
	context: RemoteContext
): Promise<QuickEntryOptions> {
	const organizationId = params?.organizationId;
	if (!organizationId || organizationId <= 0) throw new Error('Érvénytelen szervezet azonosító');
	await requireAnyCapability(context, organizationId, ['work.log', 'work.view.all']);

	const canChooseEmployee = await hasCapability(context, organizationId, 'work.view.all');
	const ownEmployeeId = await callerEmployeeId(context, organizationId);

	let employees: QuickEntryEmployee[] = [];
	if (canChooseEmployee) {
		const r = await context.db.query(
			`SELECT e.id, u.full_name AS name, u.email
			   FROM app__racona_work.employees e
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE e.organization_id = $1 AND e.status = 'active'
			  ORDER BY u.full_name ASC`,
			[organizationId]
		);
		employees = r.rows.map((row: any) => ({ id: row.id, name: row.name ?? '', email: row.email ?? '' }));
	}

	let employeeId = ownEmployeeId;
	if (params.employeeId && params.employeeId !== ownEmployeeId) {
		if (!canChooseEmployee) throw new Error('Nincs jogosultságod más dolgozó munkáját rögzíteni');
		const r = await context.db.query(
			`SELECT id FROM app__racona_work.employees WHERE id = $1 AND organization_id = $2`,
			[params.employeeId, organizationId]
		);
		if (r.rows.length === 0) throw new Error('A dolgozó nem tartozik a szervezethez');
		employeeId = params.employeeId;
	}

	if (employeeId === null) {
		return { employeeId, ownEmployeeId, canChooseEmployee, employees, projects: [] };
	}

	const projectsR = await context.db.query(
		`SELECT p.id, p.name, to_char(p.start_date, 'YYYY-MM-DD') AS start_date, pm.default_category_id
		   FROM app__racona_work.project_members pm
		   JOIN app__racona_work.projects p ON p.id = pm.project_id
		  WHERE pm.employee_id = $1 AND p.organization_id = $2 AND p.closed_at IS NULL
		  ORDER BY p.name ASC`,
		[employeeId, organizationId]
	);
	const projectIds = projectsR.rows.map((row: any) => row.id);

	const categoriesByProject = new Map<number, QuickEntryCategory[]>();
	if (projectIds.length > 0) {
		const catR = await context.db.query(
			`SELECT id, project_id, name FROM app__racona_work.work_entry_categories
			  WHERE project_id = ANY($1::int[]) AND is_active = TRUE
			  ORDER BY sort_order ASC, id ASC`,
			[projectIds]
		);
		for (const row of catR.rows) {
			const list = categoriesByProject.get(row.project_id) ?? [];
			list.push({ id: row.id, name: row.name });
			categoriesByProject.set(row.project_id, list);
		}
	}

	const projects: QuickEntryProject[] = projectsR.rows.map((row: any) => {
		const categories = categoriesByProject.get(row.id) ?? [];
		const defaultCategoryId = categories.some((c) => c.id === row.default_category_id)
			? row.default_category_id
			: null;
		return { id: row.id, name: row.name, startDate: row.start_date ?? null, categories, defaultCategoryId };
	});

	return { employeeId, ownEmployeeId, canChooseEmployee, employees, projects };
}
