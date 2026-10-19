/**
 * Heti gyors rögzítés választólistái: a dolgozó a saját nyitott projektjeit
 * kapja a projektek aktív kategóriáival és az alapértelmezett kategóriájával;
 * más dolgozót csak work.view.all joggal lehet választani.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { getQuickEntryOptions } from '../server/quick-entry.ts';
import type { RemoteContext } from '../server/context.ts';

/** Ál-kontextus: a 3-as szervezet, a hívó (user 7) a 70-es dolgozó; a 71-es is a szervezeté. */
function fakeContext(opts: { caps: string[] }) {
	const queries: { sql: string; params: unknown[] }[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		queries.push({ sql, params });
		if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: false }] };
		if (sql.includes('rc.capability = $3')) {
			return { rows: opts.caps.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('WHERE user_id = $1 AND organization_id = $2')) return { rows: [{ id: 70 }] };
		if (sql.includes("e.status = 'active'")) {
			return { rows: [{ id: 70, name: 'Én', email: 'en@example.com' }, { id: 71, name: 'Más', email: 'mas@example.com' }] };
		}
		if (sql.includes('WHERE id = $1 AND organization_id = $2')) {
			return { rows: [70, 71].includes(Number(params[0])) ? [{ id: params[0] }] : [] };
		}
		if (sql.includes('FROM app__racona_work.project_members pm')) {
			// 5: két kategória, alapértelmezett a 2-es; 6: kategória nélkül, az alapértelmezett (9) már nem aktív
			return {
				rows: [
					{ id: 5, name: 'Alfa', start_date: '2026-01-01', default_category_id: 2 },
					{ id: 6, name: 'Béta', start_date: null, default_category_id: 9 }
				]
			};
		}
		if (sql.includes('FROM app__racona_work.work_entry_categories')) {
			return { rows: [{ id: 1, project_id: 5, name: 'Fejlesztés' }, { id: 2, project_id: 5, name: 'Tesztelés' }] };
		}
		return { rows: [] };
	};
	const context = {
		pluginId: 'racona-work',
		userId: 7,
		permissions: [],
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	return { context, queries };
}

describe('heti gyors rögzítés', () => {
	test('a dolgozó a saját projektjeit kapja kategóriákkal és alapértelmezéssel', async () => {
		const { context, queries } = fakeContext({ caps: ['work.log'] });
		const options = await getQuickEntryOptions({ organizationId: 3 }, context);
		expect(options.employeeId).toBe(70);
		expect(options.canChooseEmployee).toBe(false);
		expect(options.employees).toEqual([]);
		expect(options.projects).toEqual([
			{
				id: 5,
				name: 'Alfa',
				startDate: '2026-01-01',
				categories: [{ id: 1, name: 'Fejlesztés' }, { id: 2, name: 'Tesztelés' }],
				defaultCategoryId: 2
			},
			{ id: 6, name: 'Béta', startDate: null, categories: [], defaultCategoryId: null }
		]);
		const projectsQuery = queries.find((q) => q.sql.includes('FROM app__racona_work.project_members pm'))!;
		expect(projectsQuery.sql).toContain('p.closed_at IS NULL');
		expect(projectsQuery.params).toEqual([70, 3]);
	});

	test('más dolgozót csak work.view.all joggal lehet választani', async () => {
		await expect(
			getQuickEntryOptions({ organizationId: 3, employeeId: 71 }, fakeContext({ caps: ['work.log'] }).context)
		).rejects.toThrow('Nincs jogosultságod');

		const { context, queries } = fakeContext({ caps: ['work.log', 'work.view.all'] });
		const options = await getQuickEntryOptions({ organizationId: 3, employeeId: 71 }, context);
		expect(options.employeeId).toBe(71);
		expect(options.ownEmployeeId).toBe(70);
		expect(options.canChooseEmployee).toBe(true);
		expect(options.employees.map((e) => e.id)).toEqual([70, 71]);
		expect(queries.find((q) => q.sql.includes('FROM app__racona_work.project_members pm'))!.params).toEqual([71, 3]);
	});

	test('más szervezet dolgozója nem választható', async () => {
		const { context } = fakeContext({ caps: ['work.view.all'] });
		await expect(getQuickEntryOptions({ organizationId: 3, employeeId: 99 }, context)).rejects.toThrow('nem tartozik');
	});

	test('munkanapló-jog nélkül nem kérhető le', async () => {
		const { context } = fakeContext({ caps: ['leave.request'] });
		await expect(getQuickEntryOptions({ organizationId: 3 }, context)).rejects.toThrow('Nincs jogosultságod');
	});
});
