/**
 * Projektenkénti munkabejegyzés-kategóriák tesztjei: a bejegyzés kategóriája a
 * projekt saját listájából való, kategória nélküli projektnél nem kötelező, a
 * kezelés project.manage-hez és nyitott projekthez kötött.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import {
	copyWorkEntryCategories,
	createWorkEntryCategory,
	deleteWorkEntryCategory,
	getWorkEntryCategories,
	reorderWorkEntryCategories,
	resolveEntryCategory,
	setProjectMemberDefaultCategory,
	updateWorkEntryCategory
} from '../server/work-categories.ts';
import type { RemoteContext } from '../server/context.ts';

interface Category {
	id: number;
	project_id: number | null;
	name: string;
	is_active: boolean;
	entries?: number;
}

/**
 * Ál-kontextus: az 5-ös és 6-os projekt a 3-as szervezetben, a 9-es a 4-esben.
 * A hívó (user 7) szervezeti képességei `caps`; `closed` esetén az 5-ös projekt lezárt.
 */
function fakeContext(opts: { caps: string[]; categories: Category[]; closed?: boolean; members?: number[] }) {
	const queries: { sql: string; params: unknown[] }[] = [];
	const projects: Record<number, { id: number; organization_id: number; closed_at: string | null }> = {
		5: { id: 5, organization_id: 3, closed_at: opts.closed ? '2026-09-01T10:00:00Z' : null },
		6: { id: 6, organization_id: 3, closed_at: null },
		9: { id: 9, organization_id: 4, closed_at: null }
	};
	const query = async (sql: string, params: unknown[] = []) => {
		queries.push({ sql, params });
		if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: false }] };
		if (sql.includes('rc.capability = $3')) {
			return { rows: opts.caps.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('pm.role = $3')) return { rows: [] };
		if (sql.includes('FROM app__racona_work.projects WHERE id = $1')) {
			const p = projects[Number(params[0])];
			return { rows: p ? [p] : [] };
		}
		if (sql.includes('SELECT id FROM app__racona_work.employees WHERE user_id = $1 AND organization_id = $2')) {
			return { rows: [{ id: 70 }] };
		}
		if (sql.includes('UPDATE app__racona_work.project_members')) {
			return { rows: (opts.members ?? [70, 71]).includes(Number(params[1])) ? [{ employee_id: params[1] }] : [] };
		}
		if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) return { rows: [{ id: 99, project_id: params[0], name: params[1], sort_order: 10, is_active: true }] };
		if (sql.includes('WHERE project_id = $1 AND is_active = TRUE LIMIT 1')) {
			return { rows: opts.categories.filter((c) => c.project_id === params[0] && c.is_active).slice(0, 1) };
		}
		if (sql.includes('WHERE id = $1 AND project_id = $2')) {
			const activeOnly = sql.includes('AND is_active = TRUE');
			return {
				rows: opts.categories.filter(
					(c) => c.id === params[0] && c.project_id === params[1] && (!activeOnly || c.is_active)
				)
			};
		}
		if (sql.includes('SELECT id, project_id, name, is_active FROM')) {
			return { rows: opts.categories.filter((c) => c.id === params[0]) };
		}
		if (sql.includes('lower(name) = lower($2)')) {
			return {
				rows: opts.categories.filter(
					(c) => c.project_id === params[0] && c.name.toLowerCase() === String(params[1]).toLowerCase() && c.id !== params[2]
				)
			};
		}
		if (sql.includes('SELECT COUNT(*)::int AS count FROM app__racona_work.work_entries WHERE category_id')) {
			return { rows: [{ count: opts.categories.find((c) => c.id === params[0])?.entries ?? 0 }] };
		}
		if (sql.includes('SELECT id FROM app__racona_work.work_entry_categories WHERE project_id = $1')) {
			return { rows: opts.categories.filter((c) => c.project_id === params[0]).map((c) => ({ id: c.id })) };
		}
		if (sql.includes('AS entry_count')) {
			return {
				rows: opts.categories
					.filter((c) => c.project_id === params[0] && (!sql.includes('c.is_active = TRUE') || c.is_active))
					.map((c) => ({ ...c, sort_order: 10, entry_count: c.entries ?? 0 }))
			};
		}
		return { rows: [] };
	};
	const context = {
		pluginId: 'racona-work',
		userId: 7,
		permissions: [],
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	const writes = () => queries.filter((q) => /^\s*(INSERT|UPDATE|DELETE)/i.test(q.sql));
	return { context, queries, writes };
}

const CATEGORIES: Category[] = [
	{ id: 1, project_id: 5, name: 'Fejlesztés', is_active: true, entries: 3 },
	{ id: 2, project_id: 5, name: 'Tesztelés', is_active: false },
	{ id: 3, project_id: 6, name: 'Másik projekt', is_active: true },
	{ id: 4, project_id: null, name: 'Régi közös', is_active: true }
];

describe('a bejegyzés kategóriája', () => {
	test('a projekt saját aktív kategóriája választható', async () => {
		const { context } = fakeContext({ caps: [], categories: CATEGORIES });
		expect(await resolveEntryCategory(context, 5, 1)).toBe(1);
	});

	test('másik projekt vagy a régi közös lista kategóriája nem választható', async () => {
		const { context } = fakeContext({ caps: [], categories: CATEGORIES });
		await expect(resolveEntryCategory(context, 5, 3)).rejects.toThrow('nem tartozik ehhez a projekthez');
		await expect(resolveEntryCategory(context, 5, 4)).rejects.toThrow('nem tartozik ehhez a projekthez');
	});

	test('inaktív kategória csak akkor maradhat, ha a bejegyzés eddig is azon volt', async () => {
		const { context } = fakeContext({ caps: [], categories: CATEGORIES });
		await expect(resolveEntryCategory(context, 5, 2)).rejects.toThrow('inaktív');
		expect(await resolveEntryCategory(context, 5, 2, 2)).toBe(2);
	});

	test('kategória nélkül csak akkor menthető, ha a projektnek nincs aktív kategóriája', async () => {
		const { context } = fakeContext({ caps: [], categories: CATEGORIES });
		await expect(resolveEntryCategory(context, 5, null)).rejects.toThrow('kötelező');
		expect(await resolveEntryCategory(context, 7, null)).toBeNull();
	});
});

describe('a kategóriák lekérése', () => {
	test('a dolgozó csak az aktívakat kapja, akkor is, ha az inaktívakat kéri', async () => {
		const { context } = fakeContext({ caps: ['work.log'], categories: CATEGORIES });
		const list = await getWorkEntryCategories({ projectId: 5, includeInactive: true }, context);
		expect(list.map((c) => c.id)).toEqual([1]);
	});

	test('a projekt kezelője az inaktívakat is látja', async () => {
		const { context } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		const list = await getWorkEntryCategories({ projectId: 5, includeInactive: true }, context);
		expect(list.map((c) => c.id)).toEqual([1, 2]);
	});

	test('munkanapló-jog nélkül nem kérhető le', async () => {
		const { context } = fakeContext({ caps: ['leave.request'], categories: CATEGORIES });
		await expect(getWorkEntryCategories({ projectId: 5 }, context)).rejects.toThrow('Nincs jogosultságod');
	});
});

describe('a kategóriák kezelése', () => {
	test('project.manage nélkül nem hozható létre kategória', async () => {
		const { context, writes } = fakeContext({ caps: ['work.log'], categories: CATEGORIES });
		await expect(createWorkEntryCategory({ projectId: 5, name: 'Új' }, context)).rejects.toThrow('Nincs jogosultságod');
		expect(writes()).toEqual([]);
	});

	test('lezárt projekt kategóriái nem módosíthatók', async () => {
		const { context, writes } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES, closed: true });
		await expect(createWorkEntryCategory({ projectId: 5, name: 'Új' }, context)).rejects.toThrow('le van zárva');
		await expect(updateWorkEntryCategory({ id: 1, name: 'X' }, context)).rejects.toThrow('le van zárva');
		expect(writes()).toEqual([]);
	});

	test('egy projekten belül nem lehet két azonos nevű kategória', async () => {
		const { context } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await expect(createWorkEntryCategory({ projectId: 5, name: ' fejlesztés ' }, context)).rejects.toThrow('már van ilyen');
		await expect(createWorkEntryCategory({ projectId: 5, name: 'Másik projekt' }, context)).resolves.toMatchObject({
			name: 'Másik projekt'
		});
	});

	test('a régi közös lista nem szerkeszthető', async () => {
		const { context } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await expect(updateWorkEntryCategory({ id: 4, name: 'X' }, context)).rejects.toThrow('régi közös lista');
		await expect(deleteWorkEntryCategory({ id: 4 }, context)).rejects.toThrow('régi közös lista');
	});

	test('használt kategória nem törölhető, használatlan igen', async () => {
		const { context, writes } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await expect(deleteWorkEntryCategory({ id: 1 }, context)).rejects.toThrow('3 bejegyzés használja');
		expect(writes()).toEqual([]);
		await expect(deleteWorkEntryCategory({ id: 2 }, context)).resolves.toEqual({ ok: true });
	});

	test('a sorrendben a projekt összes kategóriájának pontosan egyszer kell szerepelnie', async () => {
		const { context, writes } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await expect(reorderWorkEntryCategories({ projectId: 5, ids: [1] }, context)).rejects.toThrow('pontosan egyszer');
		await expect(reorderWorkEntryCategories({ projectId: 5, ids: [1, 3] }, context)).rejects.toThrow('pontosan egyszer');
		await expect(reorderWorkEntryCategories({ projectId: 5, ids: [2, 2] }, context)).rejects.toThrow('pontosan egyszer');
		expect(writes()).toEqual([]);
		await expect(reorderWorkEntryCategories({ projectId: 5, ids: [2, 1] }, context)).resolves.toEqual({ ok: true });
	});
});

describe('a kategóriák átvétele', () => {
	test('más szervezet projektjéből és önmagából nem vehető át', async () => {
		const { context, writes } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await expect(copyWorkEntryCategories({ projectId: 5, sourceProjectId: 9 }, context)).rejects.toThrow('szervezet saját');
		await expect(copyWorkEntryCategories({ projectId: 5, sourceProjectId: 5 }, context)).rejects.toThrow('önmagából');
		expect(writes()).toEqual([]);
	});

	test('a régi közös listából (null forrás) átvehető', async () => {
		const { context, queries } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await copyWorkEntryCategories({ projectId: 5, sourceProjectId: null }, context);
		const insert = queries.find((q) => q.sql.includes('INSERT INTO app__racona_work.work_entry_categories'))!;
		expect(insert.params).toEqual([5, null]);
	});
});

describe('alapértelmezett kategória tagonként', () => {
	test('a kezelő a projekt aktív kategóriáját állíthatja be, vagy törölheti', async () => {
		const { context, queries } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await expect(setProjectMemberDefaultCategory({ projectId: 5, employeeId: 71, categoryId: 1 }, context)).resolves.toEqual({ ok: true });
		await expect(setProjectMemberDefaultCategory({ projectId: 5, employeeId: 71, categoryId: null }, context)).resolves.toEqual({ ok: true });
		const updates = queries.filter((q) => q.sql.includes('UPDATE app__racona_work.project_members'));
		expect(updates.map((q) => q.params)).toEqual([[5, 71, 1], [5, 71, null]]);
	});

	test('inaktív, másik projekthez tartozó kategória vagy nem tag nem állítható be', async () => {
		const { context } = fakeContext({ caps: ['project.manage'], categories: CATEGORIES });
		await expect(setProjectMemberDefaultCategory({ projectId: 5, employeeId: 71, categoryId: 2 }, context)).rejects.toThrow('aktív kategóriája');
		await expect(setProjectMemberDefaultCategory({ projectId: 5, employeeId: 71, categoryId: 3 }, context)).rejects.toThrow('aktív kategóriája');
		await expect(setProjectMemberDefaultCategory({ projectId: 5, employeeId: 99, categoryId: 1 }, context)).rejects.toThrow('nem tagja');
	});

	test('project.manage nélkül nem állítható', async () => {
		const { context, writes } = fakeContext({ caps: ['work.log'], categories: CATEGORIES });
		await expect(setProjectMemberDefaultCategory({ projectId: 5, employeeId: 70, categoryId: 1 }, context)).rejects.toThrow('Nincs jogosultságod');
		expect(writes()).toEqual([]);
	});

	test('a lekérdezés a hívó alapértelmezettjét jelöli; másét csak az kérheti, aki helyette rögzíthet', async () => {
		const listParams = async (caps: string[], employeeId?: number) => {
			const { context, queries } = fakeContext({ caps, categories: CATEGORIES });
			await getWorkEntryCategories({ projectId: 5, employeeId }, context);
			return queries.find((q) => q.sql.includes('AS is_default'))!.params;
		};
		expect(await listParams(['work.log'])).toEqual([5, 70]);
		expect(await listParams(['work.log'], 71)).toEqual([5, null]);
		expect(await listParams(['work.log', 'work.view.all'], 71)).toEqual([5, 71]);
	});
});
