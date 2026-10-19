/**
 * Biztonsági javítások tesztjei: escapelés, a szabadságkérelmek láthatósága,
 * a projektvezető jogai és kijelölése, a saját ügyben hozott döntés tiltása és a
 * dolgozói adatlap láthatósága.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { escapeHtml, safeImageUrl } from '../src/utils/html.ts';
import { ensureNotSelfDecision, hasCapability, SELF_DECISION_ERROR } from '../server/permissions.ts';
import { getLeaveRequests } from '../server/leave.ts';
import { getLeaveCalendar } from '../server/leave-days.ts';
import { addProjectMember, removeProjectMember } from '../server/projects.ts';
import { getEmployeeDetails, getMyEmployee } from '../server/employees.ts';
import { createOrganization, deleteOrganization, getOrganizations, updateOrganization } from '../server/organizations.ts';
import type { RemoteContext } from '../server/context.ts';

describe('escapelés', () => {
	test('a HTML-jelentésű karakterek', () => {
		expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
			'&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;'
		);
		expect(escapeHtml(null)).toBe('');
		expect(escapeHtml(5)).toBe('5');
	});

	test('profilkép: csak http(s), relatív útvonal vagy raszteres data URL', () => {
		expect(safeImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
		expect(safeImageUrl('/uploads/a.png')).toBe('/uploads/a.png');
		expect(safeImageUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
		expect(safeImageUrl('javascript:alert(1)')).toBeNull();
		expect(safeImageUrl('//evil.example/a.png')).toBeNull();
		expect(safeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
		expect(safeImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
		expect(safeImageUrl('')).toBeNull();
	});
});

/**
 * Ál-kontextus a 3-as szervezetben, a hívó a 7-es felhasználó (a 70-es dolgozó).
 * `caps`: a hívó szervezeti képességei; `leadOf`: a projektek, amelyeknek a hívó
 * projektvezetője; `memberRole`: a 9-es projekt 80-as tagjának jelenlegi szerepe.
 */
function fakeContext(opts: {
	caps: string[];
	leadOf?: number[];
	memberRole?: string;
	coreAdmin?: boolean;
}) {
	const queries: { sql: string; params: unknown[] }[] = [];
	const query = async (sql: string, params: unknown[] = []) => {
		queries.push({ sql, params });
		if (/^\s*(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
		if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: false }] };
		if (sql.includes('rc.capability = $3')) {
			return { rows: opts.caps.includes(String(params[2])) ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('pm.role = $3')) {
			const lead = params[1] === 7 && params[2] === 'lead' && (opts.leadOf ?? []).includes(Number(params[0]));
			return { rows: lead ? [{ ok: 1 }] : [] };
		}
		if (sql.includes('SELECT DISTINCT rc.capability')) {
			return { rows: opts.caps.map((capability) => ({ capability })) };
		}
		if (sql.includes('SELECT id, organization_id, closed_at FROM app__racona_work.projects')) {
			return { rows: [{ id: 9, organization_id: 3, closed_at: null }] };
		}
		if (sql.includes('SELECT id, organization_id FROM app__racona_work.employees WHERE id = $1')) {
			return { rows: [{ id: Number(params[0]), organization_id: 3 }] };
		}
		if (sql.includes('SELECT role FROM app__racona_work.project_members')) {
			return { rows: opts.memberRole ? [{ role: opts.memberRole }] : [] };
		}
		if (sql.includes('SELECT id FROM') && sql.includes('employees WHERE user_id = $1')) {
			return { rows: Number(params[0]) === 7 ? [{ id: 70 }] : [] };
		}
		if (sql.includes('SELECT user_id FROM app__racona_work.employees WHERE id = $1')) {
			return { rows: [{ user_id: Number(params[0]) === 70 ? 7 : 8 }] };
		}
		if (sql.includes('SELECT organization_id FROM app__racona_work.employees WHERE id = $1')) {
			return { rows: [{ organization_id: 3 }] };
		}
		if (sql.includes('JOIN auth.users u ON e.user_id = u.id') && sql.includes('WHERE e.id = $1')) {
			const id = Number(params[0]);
			return {
				rows: [
					{
						id,
						user_id: id === 70 ? 7 : 8,
						position: 'Fejlesztő',
						status: 'active',
						is_external: false,
						hire_day: '2024-01-01',
						employment_end_day: null,
						birth_day: '1990-05-05',
						tax_id: '8123456789',
						hire_date_confirmed: true,
						user_name: 'Teszt Elek',
						user_email: 'teszt@example.com'
					}
				]
			};
		}
		if (sql.includes('FROM app__racona_work.employee_details')) {
			return {
				rows: [{ id: 1, employee_id: Number(params[0]), category: 'contact', field_key: 'Telefon', field_value: '+36 30 123 4567' }]
			};
		}
		if (sql.includes('COUNT(*) AS total')) return { rows: [{ total: '0' }] };
		return { rows: [] };
	};
	const context = {
		pluginId: 'racona-work',
		userId: 7,
		permissions: opts.coreAdmin ? ['admin'] : [],
		db: { query, connect: async () => ({ query, release: () => {} }) }
	} as unknown as RemoteContext;
	return { context, queries };
}

describe('a szabadságkérelmek láthatósága', () => {
	test('jóváhagyói jog nélkül csak a saját kérelmek jönnek, akármit kér a kliens', async () => {
		const { context, queries } = fakeContext({ caps: ['leave.request'] });
		await getLeaveRequests({ organizationId: 3 }, context);
		const list = queries.find((q) => q.sql.includes('COUNT(*) AS total'))!;
		expect(list.sql).toContain('lr.employee_id = $2');
		expect(list.params).toEqual([3, 70]);
	});

	test('más dolgozó kérelmei jóváhagyói jog nélkül hibát adnak', async () => {
		const { context } = fakeContext({ caps: ['leave.request'] });
		await expect(getLeaveRequests({ organizationId: 3, employeeId: 71 }, context)).rejects.toThrow('saját');
	});

	test('a jóváhagyó a szervezet összes kérelmét látja', async () => {
		const { context, queries } = fakeContext({ caps: ['leave.request', 'leave.approve'] });
		await getLeaveRequests({ organizationId: 3 }, context);
		const list = queries.find((q) => q.sql.includes('COUNT(*) AS total'))!;
		expect(list.params).toEqual([3]);
	});

	test('a HR felelős kérelem-jog nélkül is betölti a nyilvántartót, mindenkiét látja', async () => {
		const { context, queries } = fakeContext({ caps: ['leave.approve', 'leave.balance.manage'] });
		await getLeaveRequests({ organizationId: 3 }, context);
		const list = queries.find((q) => q.sql.includes('COUNT(*) AS total'))!;
		expect(list.params).toEqual([3]);
	});

	test('a jóváhagyó a naptárat és a saját dolgozói rekordját is lekérheti', async () => {
		const { context } = fakeContext({ caps: ['leave.approve'] });
		const calendar = await getLeaveCalendar({ organizationId: 3, from: '2026-10-01', to: '2026-10-31' }, context);
		expect(calendar.canManage).toBe(true);
		await expect(getMyEmployee({ organizationId: 3 }, context)).resolves.toBeDefined();
	});

	test('szabadság-jog nélkül a nyilvántartó nem tölt be', async () => {
		const { context } = fakeContext({ caps: ['project.view.own'] });
		await expect(getLeaveRequests({ organizationId: 3 }, context)).rejects.toThrow('Nincs jogosultságod');
		await expect(
			getLeaveCalendar({ organizationId: 3, from: '2026-10-01', to: '2026-10-31' }, context)
		).rejects.toThrow('Nincs jogosultságod');
	});
});

describe('saját ügyben nincs döntés', () => {
	test('a saját ügy hibát ad, a másé nem', async () => {
		const { context } = fakeContext({ caps: ['leave.approve'] });
		await expect(ensureNotSelfDecision(context, 70)).rejects.toThrow(SELF_DECISION_ERROR);
		await expect(ensureNotSelfDecision(context, 71)).resolves.toBeUndefined();
	});

	test('a rendszergazda a saját ügyében is dönthet', async () => {
		const { context } = fakeContext({ caps: [], coreAdmin: true });
		await expect(ensureNotSelfDecision(context, 70)).resolves.toBeUndefined();
	});
});

describe('projektvezető', () => {
	const written = (queries: { sql: string }[]) =>
		queries.some((q) => /^\s*(INSERT|DELETE)/i.test(q.sql) && q.sql.includes('project_members'));

	test('a saját projektjén kezelheti és lezárhatja, máshol nem', async () => {
		const { context } = fakeContext({ caps: ['work.log'], leadOf: [9] });
		expect(await hasCapability(context, 3, 'project.manage', 9)).toBe(true);
		expect(await hasCapability(context, 3, 'project.close', 9)).toBe(true);
		expect(await hasCapability(context, 3, 'project.manage', 10)).toBe(false);
		expect(await hasCapability(context, 3, 'project.manage')).toBe(false);
	});

	test('a projektvezetés más képességet nem ad', async () => {
		const { context, queries } = fakeContext({ caps: [], leadOf: [9] });
		expect(await hasCapability(context, 3, 'employee.manage', 9)).toBe(false);
		expect(await hasCapability(context, 3, 'project.view.all', 9)).toBe(false);
		expect(queries.some((q) => q.sql.includes('pm.role = $3'))).toBe(false);
	});

	test('lezárási jog nélkül nem jelölhető ki', async () => {
		const { context, queries } = fakeContext({ caps: ['project.manage'] });
		await expect(addProjectMember({ projectId: 9, employeeId: 80, role: 'lead' }, context)).rejects.toThrow(
			'Projektvezetőt csak az'
		);
		expect(written(queries)).toBe(false);
	});

	test('lezárási jog nélkül nem vehető el, eltávolítással sem', async () => {
		const { context, queries } = fakeContext({ caps: ['project.manage'], memberRole: 'lead' });
		await expect(addProjectMember({ projectId: 9, employeeId: 80, role: 'member' }, context)).rejects.toThrow(
			'Projektvezetőt csak az'
		);
		await expect(removeProjectMember({ projectId: 9, employeeId: 80 }, context)).rejects.toThrow('Projektvezetőt csak az');
		expect(written(queries)).toBe(false);
	});

	test('lezárási jog nélkül a többi szerep szabadon módosítható', async () => {
		const { context, queries } = fakeContext({ caps: ['project.manage'], memberRole: 'member' });
		await addProjectMember({ projectId: 9, employeeId: 80, role: 'member_tester' }, context);
		expect(written(queries)).toBe(true);
	});

	test('a projektvezető kijelölhet újabb projektvezetőt', async () => {
		const { context, queries } = fakeContext({ caps: ['work.log'], leadOf: [9] });
		await addProjectMember({ projectId: 9, employeeId: 80, role: 'lead' }, context);
		expect(written(queries)).toBe(true);
	});
});

describe('a dolgozói adatlap láthatósága', () => {
	const detailsQueried = (queries: { sql: string }[]) =>
		queries.some((q) => q.sql.includes('FROM app__racona_work.employee_details'));

	test('employee.view joggal más dolgozónál csak az alapadatok jönnek', async () => {
		const { context, queries } = fakeContext({ caps: ['employee.view'] });
		const view = await getEmployeeDetails({ employeeId: 71 }, context);
		expect(view.employee.userName).toBe('Teszt Elek');
		expect(view.details).toEqual([]);
		expect(view.detailsVisible).toBe(false);
		expect(view.personal).toBeNull();
		expect(detailsQueried(queries)).toBe(false);
	});

	test('a dolgozó a saját adatlapját teljesen látja', async () => {
		const { context } = fakeContext({ caps: ['employee.view'] });
		const view = await getEmployeeDetails({ employeeId: 70 }, context);
		expect(view.detailsVisible).toBe(true);
		expect(view.details.map((d) => d.fieldKey)).toEqual(['Telefon']);
		expect(view.personal?.birthDate).toBe('1990-05-05');
	});

	test('employee.manage joggal más adatlapja is teljes', async () => {
		const { context } = fakeContext({ caps: ['employee.view', 'employee.manage'] });
		const view = await getEmployeeDetails({ employeeId: 71 }, context);
		expect(view.detailsVisible).toBe(true);
		expect(view.details).toHaveLength(1);
		expect(view.personal?.taxId).toBe('8123456789');
	});

	test('leave.balance.manage joggal más adatlapja is teljes', async () => {
		const { context } = fakeContext({ caps: ['employee.view', 'leave.balance.manage'] });
		const view = await getEmployeeDetails({ employeeId: 71 }, context);
		expect(view.detailsVisible).toBe(true);
		expect(view.details).toHaveLength(1);
	});

	test('employee.view nélkül a saját adatlap sem kérhető le', async () => {
		const { context } = fakeContext({ caps: ['leave.request'] });
		await expect(getEmployeeDetails({ employeeId: 70 }, context)).rejects.toThrow('Nincs jogosultságod');
	});
});

describe('Szervezetek menü szervezet adminisztrátornak', () => {
	/** Ál-kontextus: a 7-es felhasználó a 3-as szervezetben `caps` képességekkel, a 4-esben semmivel. */
	function orgContext(opts: { caps: string[]; coreAdmin?: boolean; external?: boolean }) {
		const queries: { sql: string; params: unknown[] }[] = [];
		const org = (id: number) => ({ id, name: `Szervezet ${id}`, slug: `szervezet-${id}`, address: null, address_lat: null });
		const query = async (sql: string, params: unknown[] = []) => {
			queries.push({ sql, params });
			if (sql.includes('SELECT is_external FROM')) return { rows: [{ is_external: opts.external === true }] };
			if (sql.includes('rc.capability = $3')) {
				return { rows: Number(params[0]) === 3 && opts.caps.includes(String(params[2])) ? [{ ok: 1 }] : [] };
			}
			if (sql.includes("rc.capability = 'org.manage'")) {
				return { rows: opts.caps.includes('org.manage') ? [org(3)] : [] };
			}
			if (sql.includes('FROM app__racona_work.organizations') && !sql.includes('WHERE')) return { rows: [org(3), org(4)] };
			if (sql.includes('SELECT address, address_lat FROM')) return { rows: [{ address: null, address_lat: null }] };
			if (sql.includes('SELECT id FROM app__racona_work.organizations WHERE slug')) return { rows: [] };
			if (/^\s*UPDATE app__racona_work.organizations/.test(sql)) return { rows: [org(Number(params[8]))] };
			return { rows: [] };
		};
		const context = {
			pluginId: 'racona-work',
			userId: 7,
			permissions: opts.coreAdmin ? ['admin'] : [],
			db: { query, connect: async () => ({ query, release: () => {} }) }
		} as unknown as RemoteContext;
		return { context, queries };
	}

	test('a szervezet adminisztrátor a saját szervezetét látja', async () => {
		const { context } = orgContext({ caps: ['org.manage'] });
		const orgs = await getOrganizations({}, context);
		expect(orgs.map((o) => o.id)).toEqual([3]);
	});

	test('org.manage nélkül üres a lista, külsősnek is', async () => {
		expect(await getOrganizations({}, orgContext({ caps: ['members.view'] }).context)).toEqual([]);
		expect(await getOrganizations({}, orgContext({ caps: ['org.manage'], external: true }).context)).toEqual([]);
	});

	test('a rendszergazda minden szervezetet lát', async () => {
		const orgs = await getOrganizations({}, orgContext({ caps: [], coreAdmin: true }).context);
		expect(orgs.map((o) => o.id)).toEqual([3, 4]);
	});

	test('a szervezet adminisztrátor csak a saját szervezetét szerkesztheti', async () => {
		const { context } = orgContext({ caps: ['org.manage'] });
		await expect(updateOrganization({ id: 3, name: 'Új név' }, context)).resolves.toMatchObject({ id: 3 });
		await expect(updateOrganization({ id: 4, name: 'Új név' }, context)).rejects.toThrow('Nincs jogosultságod');
	});

	test('létrehozni és törölni továbbra is csak a rendszergazda tud', async () => {
		const { context } = orgContext({ caps: ['org.manage'] });
		await expect(createOrganization({ name: 'Másik' }, context)).rejects.toThrow('adminisztrátori');
		await expect(deleteOrganization({ id: 3 }, context)).rejects.toThrow('adminisztrátori');
	});
});
