/**
 * Szabadságkérelem értesítések — rendszeren belüli értesítés és email.
 *
 * Események:
 *   - új kérelem → a szervezet beállításaiban megjelölt dolgozók kapják (8.8)
 *   - elbírálás, függő kérelem törlése → a kérelmet beadó dolgozó kapja (8.9)
 *   - jóváhagyott szabadság törlése → a dolgozó kapja (külön szöveg: az már nem kérelem)
 *   - naptáras mentés (napok törölve, szabadság rögzítve) → a dolgozó kapja
 *   - visszavonás → a beadásról értesített dolgozók kapják
 *
 * Minden küldés best-effort: a hibát naplózzuk, de a kérelem művelete nem
 * gördül vissza, és a hívó nem kap hibát. A műveletet végző felhasználó nem
 * kap értesítést a saját lépéséről. Az email csak akkor megy ki, ha a
 * szervezet az eseményhez bekapcsolta (specs/notifications.md).
 */

import type { RemoteContext, LocalizedText } from './context.js';
import { resolveUserId } from './context.js';
import { isLeaveType, LEAVE_TYPE_LABELS } from './leave-types.js';
import {
	RECIPIENT_LOCALE_SQL,
	escapeHtml,
	itemsHtml,
	itemsText,
	loadOrganizationName,
	loadRecipientsByUserIds,
	noteBlockHtml,
	sendEmails,
	toRecipient
} from './notification-email.js';
import type { Recipient } from './notification-email.js';
import { requireCapability } from './permissions.js';
import { requireOrganizationId } from './trip-access.js';
import { MOBILE_ENTRY } from './mobile.js';

const SCHEMA = 'app__racona_work';

/** Az értesítendő dolgozók listájának kulcsa (LeaveSettings ezzel menti; a havi ellenőrzés is olvassa). */
export function notifiersSettingsKey(organizationId: number): string {
	return `settings:leave_request_notifiers:org_${organizationId}`;
}

/**
 * Az értesítendő listáról csak az kap értesítést, akinek még van leave.balance.manage
 * joga: a szerep elvétele után a lista nem frissül magától, a régi kezelő ne kapjon
 * tovább leveleket. Az `e` aliasú employees sorra szűr.
 */
export const NOTIFIER_CAPABILITY_SQL = `EXISTS (SELECT 1 FROM ${SCHEMA}.wp_member_roles mr
	JOIN ${SCHEMA}.wp_role_capabilities rc ON rc.role_id = mr.role_id
	WHERE mr.organization_id = e.organization_id AND mr.user_id = e.user_id
	  AND rc.capability = 'leave.balance.manage')`;

// ---------------------------------------------------------------------------
// Beállítás: kik kapnak értesítést az új kérelmekről (Beállítások → Szabadság)
// ---------------------------------------------------------------------------

/** Az új szabadságkérelemről értesítendő dolgozók azonosítói. */
export async function getLeaveNotifiers(
	params: { organizationId: number },
	context: RemoteContext
): Promise<number[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'leave.balance.manage');
	const r = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
		notifiersSettingsKey(organizationId)
	]);
	return toIdList(r.rows[0]?.value);
}

/**
 * Az értesítendők mentése. Csak a szervezet dolgozói kerülhetnek a listába;
 * a visszaadott érték a ténylegesen mentett lista.
 */
export async function saveLeaveNotifiers(
	params: { organizationId: number; employeeIds: number[] },
	context: RemoteContext
): Promise<number[]> {
	const organizationId = requireOrganizationId(params?.organizationId);
	await requireCapability(context, organizationId, 'leave.balance.manage');

	const requested = [...new Set(toIdList(params.employeeIds))];
	let employeeIds: number[] = [];
	if (requested.length > 0) {
		const r = await context.db.query(
			`SELECT id FROM ${SCHEMA}.employees
			  WHERE id = ANY($1::int[]) AND organization_id = $2 AND is_external = FALSE
			  ORDER BY id`,
			[requested, organizationId]
		);
		employeeIds = r.rows.map((row: any) => Number(row.id));
	}

	await context.db.query(
		`INSERT INTO ${SCHEMA}.kv_store (key, value, updated_at)
		 VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
		[notifiersSettingsKey(organizationId), JSON.stringify(employeeIds)]
	);
	return employeeIds;
}

export type LeaveDecision = 'approved' | 'rejected' | 'deleted';

const DECISION_TEXTS: Record<
	LeaveDecision,
	{
		title: LocalizedText;
		label: LocalizedText;
		sentence: LocalizedText;
		color: string;
		type: 'success' | 'warning' | 'info';
	}
> = {
	approved: {
		title: { hu: 'Szabadságkérelem jóváhagyva', en: 'Leave request approved' },
		label: { hu: 'jóváhagyva', en: 'approved' },
		sentence: { hu: 'jóváhagyták', en: 'has been approved' },
		color: '#16a34a',
		type: 'success'
	},
	rejected: {
		title: { hu: 'Szabadságkérelem elutasítva', en: 'Leave request rejected' },
		label: { hu: 'elutasítva', en: 'rejected' },
		sentence: { hu: 'elutasították', en: 'has been rejected' },
		color: '#dc2626',
		type: 'warning'
	},
	// Csak függő (még el nem bírált) kérelem törlésénél; a jóváhagyott
	// szabadság törlése a notifyLeaveDeleted külön szövegével megy.
	deleted: {
		title: { hu: 'Szabadságkérelem törölve', en: 'Leave request deleted' },
		label: { hu: 'törölve', en: 'deleted' },
		sentence: { hu: 'törölték', en: 'has been deleted' },
		color: '#71717a',
		type: 'info'
	}
};

/** Az értesítéshez szükséges kérelem adatok. */
export interface LeaveNotificationRequest {
	id: number;
	employeeId: number;
	organizationId: number;
	leaveType: string;
	/** YYYY-MM-DD */
	startDate: string;
	/** YYYY-MM-DD */
	endDate: string;
	days: number;
	reason?: string | null;
}

/**
 * Új kérelem értesítés a szervezet beállításaiban megjelölt dolgozóknak.
 *
 * @param context - Remote hívás kontextus.
 * @param request - A létrehozott kérelem.
 */
export async function notifyLeaveRequestCreated(
	context: RemoteContext,
	request: LeaveNotificationRequest
): Promise<void> {
	await notifyLeaveRequestsCreated(context, [request]);
}

/**
 * Egyszerre beadott kérelmek (a naptárból) egy értesítésben: az időszakok
 * felsorolva, a munkanapok összesítve. Egy kérelemnél ugyanaz, mint a sima
 * új-kérelem értesítés.
 *
 * @param context - Remote hívás kontextus.
 * @param requests - A létrehozott kérelmek, azonos dolgozótól és típusból.
 */
export async function notifyLeaveRequestsCreated(
	context: RemoteContext,
	requests: LeaveNotificationRequest[]
): Promise<void> {
	if (requests.length === 0) return;
	const request = requests[0];
	try {
		const settingsResult = await context.db.query(
			`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`,
			[notifiersSettingsKey(request.organizationId)]
		);
		const notifierEmployeeIds = toIdList(settingsResult.rows[0]?.value);
		if (notifierEmployeeIds.length === 0) return;

		const actorUserId = await resolveActorUserId(context);

		// Csak az adott szervezet aktív dolgozói — egy másik szervezetből
		// bekerült vagy azóta kilépett dolgozó nem kap értesítést.
		const recipientResult = await context.db.query(
			`SELECT DISTINCT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
			   FROM ${SCHEMA}.employees e
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE e.id = ANY($1::int[])
			    AND e.organization_id = $2
			    AND e.status = 'active'
			    AND e.is_external = FALSE
			    AND ${NOTIFIER_CAPABILITY_SQL}`,
			[notifierEmployeeIds, request.organizationId]
		);
		const recipients = recipientResult.rows
			.map(toRecipient)
			.filter((r) => r.userId !== actorUserId);
		if (recipients.length === 0) return;

		const employee = await loadEmployee(context, request.employeeId);
		const organizationName = await loadOrganizationName(context, request.organizationId);
		const employeeName = employee?.name ?? '—';
		const leaveType = leaveTypeLabel(request.leaveType);
		const periods = requests.map((r) => formatPeriod(r.startDate, r.endDate));
		const period: LocalizedText = {
			hu: periods.map((p) => p.hu).join(', '),
			en: periods.map((p) => p.en).join(', ')
		};
		const days = requests.reduce((sum, r) => sum + r.days, 0);

		await sendInApp(context, {
			userIds: recipients.map((r) => r.userId),
			title:
				requests.length === 1
					? { hu: 'Új szabadságkérelem', en: 'New leave request' }
					: { hu: `${requests.length} új szabadságkérelem`, en: `${requests.length} new leave requests` },
			message: {
				hu: `${employeeName}: ${leaveType.hu}, ${period.hu} (${days} munkanap)`,
				en: `${employeeName}: ${leaveType.en}, ${period.en} (${workingDaysEn(days)})`
			},
			type: 'info',
			data: { leaveRequestId: request.id, organizationId: request.organizationId }
		});

		const reason = request.reason?.trim() || '';
		const reasonLabel: LocalizedText = { hu: 'Indoklás', en: 'Reason' };
		await sendEmails(context, {
			organizationId: request.organizationId,
			event: 'leave.requestCreated',
			template: 'leave_request_new',
			recipients,
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				employeeName,
				employeeNameHtml: escapeHtml(employeeName),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				leaveTypeLabel: leaveType[recipient.locale],
				period: period[recipient.locale],
				days,
				reasonHtml: reason ? noteBlockHtml(reasonLabel[recipient.locale], reason) : '',
				reasonText: reason ? `${reasonLabel[recipient.locale]}: ${reason}\n` : ''
			})
		});
	} catch (err) {
		console.error('[Work] Új szabadságkérelem értesítés sikertelen:', err);
	}
}

/**
 * Elbírálás / törlés értesítés a kérelmet beadó dolgozónak.
 *
 * @param context - Remote hívás kontextus.
 * @param request - Az érintett kérelem.
 * @param decision - Mi történt a kérelemmel.
 */
export async function notifyLeaveRequestDecision(
	context: RemoteContext,
	request: LeaveNotificationRequest,
	decision: LeaveDecision
): Promise<void> {
	try {
		const employee = await loadEmployee(context, request.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		const texts = DECISION_TEXTS[decision];
		const leaveType = leaveTypeLabel(request.leaveType);
		const period = formatPeriod(request.startDate, request.endDate);

		await sendInApp(context, {
			userIds: [employee.userId],
			title: texts.title,
			message: {
				hu: `${leaveType.hu}, ${period.hu} (${request.days} munkanap)`,
				en: `${leaveType.en}, ${period.en} (${workingDaysEn(request.days)})`
			},
			type: texts.type,
			// A mobil keretben a szabadság-képernyő nyílik meg
			data: { leaveRequestId: request.id, organizationId: request.organizationId, mobileEntry: MOBILE_ENTRY.leave }
		});

		const organizationName = await loadOrganizationName(context, request.organizationId);
		await sendEmails(context, {
			organizationId: request.organizationId,
			event: decision === 'deleted' ? 'leave.deleted' : 'leave.requestDecided',
			template: 'leave_request_status',
			recipients: [employee],
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				statusLabel: texts.label[recipient.locale],
				statusSentence: texts.sentence[recipient.locale],
				statusColor: texts.color,
				leaveTypeLabel: leaveType[recipient.locale],
				period: period[recipient.locale],
				days: request.days
			})
		});
	} catch (err) {
		console.error(`[Work] Szabadságkérelem értesítés sikertelen (${decision}):`, err);
	}
}

// ---------------------------------------------------------------------------
// Küldés
// ---------------------------------------------------------------------------

async function sendInApp(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) {
		console.warn(
			'[Work] A core nem ad át notifications szolgáltatást — a rendszeren belüli értesítés kimarad.'
		);
		return;
	}
	// Saját hibakezelés, hogy egy sikertelen értesítés után az email még kimenjen.
	try {
		const result = await context.notifications.send(params);
		if (!result.success) {
			console.error('[Work] Rendszeren belüli értesítés sikertelen:', result.error);
		}
	} catch (err) {
		console.error('[Work] Rendszeren belüli értesítés sikertelen:', err);
	}
}

// ---------------------------------------------------------------------------
// Adatok
// ---------------------------------------------------------------------------

/** A műveletet végző felhasználó; ha nem oldható fel, senkit nem szűrünk ki. */
async function resolveActorUserId(context: RemoteContext): Promise<number | null> {
	try {
		return await resolveUserId(context);
	} catch {
		return null;
	}
}

async function loadEmployee(context: RemoteContext, employeeId: number): Promise<Recipient | null> {
	const result = await context.db.query(
		`SELECT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
		   FROM ${SCHEMA}.employees e
		   JOIN auth.users u ON u.id = e.user_id
		  WHERE e.id = $1`,
		[employeeId]
	);
	return result.rows[0] ? toRecipient(result.rows[0]) : null;
}

/** A kv_store-ban tárolt értéket pozitív egész ID listává alakítja. */
function toIdList(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.map(Number).filter((id) => Number.isInteger(id) && id > 0);
}

// ---------------------------------------------------------------------------
// Formázás
// ---------------------------------------------------------------------------

function workingDaysEn(days: number): string {
	return `${days} working ${days === 1 ? 'day' : 'days'}`;
}

function leaveTypeLabel(type: string): LocalizedText {
	return isLeaveType(type) ? LEAVE_TYPE_LABELS[type] : { hu: type, en: type };
}

function formatDay(isoDay: string, locale: string): string {
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'UTC'
	}).format(new Date(`${isoDay}T00:00:00Z`));
}

/** Az időszak olvasható formában; egynapos távollétnél csak a nap. */
function formatPeriod(startDay: string, endDay: string): LocalizedText {
	if (startDay === endDay) {
		return { hu: formatDay(startDay, 'hu-HU'), en: formatDay(startDay, 'en-GB') };
	}
	return {
		hu: `${formatDay(startDay, 'hu-HU')} – ${formatDay(endDay, 'hu-HU')}`,
		en: `${formatDay(startDay, 'en-GB')} – ${formatDay(endDay, 'en-GB')}`
	};
}

/**
 * A dolgozó visszavonta a függő kérelmét: értesítés azoknak, akik a
 * beadásról is értesültek. Email csak bekapcsolt beállításnál (alapból ki).
 *
 * @param context - Remote hívás kontextus.
 * @param request - A visszavont kérelem.
 */
export async function notifyLeaveRequestWithdrawn(
	context: RemoteContext,
	request: LeaveNotificationRequest
): Promise<void> {
	try {
		const settingsResult = await context.db.query(
			`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`,
			[notifiersSettingsKey(request.organizationId)]
		);
		const notifierEmployeeIds = toIdList(settingsResult.rows[0]?.value);
		if (notifierEmployeeIds.length === 0) return;

		const actorUserId = await resolveActorUserId(context);
		const recipientResult = await context.db.query(
			`SELECT DISTINCT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
			   FROM ${SCHEMA}.employees e
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE e.id = ANY($1::int[])
			    AND e.organization_id = $2
			    AND e.status = 'active'
			    AND e.is_external = FALSE
			    AND ${NOTIFIER_CAPABILITY_SQL}`,
			[notifierEmployeeIds, request.organizationId]
		);
		const recipients = recipientResult.rows
			.map(toRecipient)
			.filter((r) => r.userId !== actorUserId);
		if (recipients.length === 0) return;

		const employee = await loadEmployee(context, request.employeeId);
		const employeeName = employee?.name ?? '—';
		const leaveType = leaveTypeLabel(request.leaveType);
		const period = formatPeriod(request.startDate, request.endDate);

		await sendInApp(context, {
			userIds: recipients.map((r) => r.userId),
			title: { hu: 'Szabadságkérelem visszavonva', en: 'Leave request withdrawn' },
			message: {
				hu: `${employeeName}: ${leaveType.hu}, ${period.hu} (${request.days} munkanap)`,
				en: `${employeeName}: ${leaveType.en}, ${period.en} (${workingDaysEn(request.days)})`
			},
			type: 'info',
			data: { leaveRequestId: request.id, organizationId: request.organizationId }
		});

		const organizationName = await loadOrganizationName(context, request.organizationId);
		await sendEmails(context, {
			organizationId: request.organizationId,
			event: 'leave.requestWithdrawn',
			template: 'leave_request_withdrawn',
			recipients,
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				employeeName,
				employeeNameHtml: escapeHtml(employeeName),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				leaveTypeLabel: leaveType[recipient.locale],
				period: period[recipient.locale],
				days: request.days
			})
		});
	} catch (err) {
		console.error('[Work] Szabadságkérelem visszavonás értesítés sikertelen:', err);
	}
}

/**
 * Jóváhagyott szabadság törlése: értesítés a dolgozónak. Külön szöveg, mert
 * a jóváhagyott szabadság már nem kérelem.
 *
 * @param context - Remote hívás kontextus.
 * @param request - A törölt (korábban jóváhagyott) kérelem.
 */
export async function notifyLeaveDeleted(
	context: RemoteContext,
	request: LeaveNotificationRequest
): Promise<void> {
	try {
		const employee = await loadEmployee(context, request.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		const leaveType = leaveTypeLabel(request.leaveType);
		const period = formatPeriod(request.startDate, request.endDate);

		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'Jóváhagyott szabadság törölve', en: 'Approved leave deleted' },
			message: {
				hu: `${leaveType.hu}, ${period.hu} (${request.days} munkanap)`,
				en: `${leaveType.en}, ${period.en} (${workingDaysEn(request.days)})`
			},
			type: 'warning',
			data: { leaveRequestId: request.id, organizationId: request.organizationId }
		});

		const organizationName = await loadOrganizationName(context, request.organizationId);
		const lines = {
			hu: [`Típus: ${leaveType.hu}`, `Időszak: ${period.hu}`, `Munkanapok: ${request.days}`],
			en: [`Type: ${leaveType.en}`, `Period: ${period.en}`, `Working days: ${request.days}`]
		};
		await sendEmails(context, {
			organizationId: request.organizationId,
			event: 'leave.deleted',
			template: 'leave_deleted',
			recipients: [employee],
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				itemsHtml: itemsHtml(lines[recipient.locale]),
				itemsText: itemsText(lines[recipient.locale])
			})
		});
	} catch (err) {
		console.error('[Work] Jóváhagyott szabadság törlése értesítés sikertelen:', err);
	}
}

// --- Naptáras mentés ----------------------------------------------------------
// Mentésenként egy-egy összefoglaló a törölt napokról és a felvett szakaszokról
// (specs/leave-days.md, D16). A HR nem kap értesítést a saját napjairól.

export interface LeaveDaysRemovedNotice {
	employeeId: number;
	organizationId: number;
	/** A törölt napok a típusukkal (YYYY-MM-DD). */
	days: { day: string; leaveType: string }[];
}

export interface LeaveDaysAddedNotice {
	employeeId: number;
	organizationId: number;
	leaveType: string;
	/** A létrehozott kérelmek időszakai. */
	periods: { startDate: string; endDate: string; days: number }[];
	/**
	 * Melyik email-beállítás vonatkozik rá: a HR naptáras rögzítése (alapértelmezett)
	 * vagy a kötelező szabadság kiírása.
	 */
	event?: 'leave.calendarChanged' | 'leave.mandatoryAssigned';
}

/**
 * A HR a naptárból törölte a dolgozó napjait: értesítés a dolgozónak.
 *
 * @param context - Remote hívás kontextus.
 * @param notice - A törölt napok.
 */
export async function notifyLeaveDaysRemoved(
	context: RemoteContext,
	notice: LeaveDaysRemovedNotice
): Promise<void> {
	if (notice.days.length === 0) return;
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		// Típusonként csoportosítva, hogy a lista rövid és olvasható legyen
		const byType = new Map<string, string[]>();
		for (const d of notice.days) {
			if (!byType.has(d.leaveType)) byType.set(d.leaveType, []);
			byType.get(d.leaveType)!.push(d.day);
		}
		const lines: LocalizedText[] = [...byType].map(([type, days]) => {
			const label = leaveTypeLabel(type);
			return {
				hu: `${label.hu}: ${days.map((d) => formatDay(d, 'hu-HU')).join(', ')}`,
				en: `${label.en}: ${days.map((d) => formatDay(d, 'en-GB')).join(', ')}`
			};
		});
		const count = notice.days.length;

		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'Szabadságnapok törölve', en: 'Leave days removed' },
			message: {
				hu: `${count} nap törölve a naptárból. ${lines.map((l) => l.hu).join(' ')}`,
				en: `${count} ${count === 1 ? 'day' : 'days'} removed from the calendar. ${lines.map((l) => l.en).join(' ')}`
			},
			type: 'warning',
			data: { employeeId: notice.employeeId, organizationId: notice.organizationId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.calendarChanged',
			template: 'leave_days_removed',
			recipients: [employee],
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				dayCount: count,
				itemsHtml: itemsHtml(lines.map((l) => l[recipient.locale])),
				itemsText: itemsText(lines.map((l) => l[recipient.locale]))
			})
		});
	} catch (err) {
		console.error('[Work] Szabadságnapok törlése értesítés sikertelen:', err);
	}
}

/**
 * A HR a naptárból szabadságot rögzített a dolgozónak: értesítés a dolgozónak.
 *
 * @param context - Remote hívás kontextus.
 * @param notice - A létrehozott időszakok.
 */
export async function notifyLeaveDaysAdded(
	context: RemoteContext,
	notice: LeaveDaysAddedNotice
): Promise<void> {
	if (notice.periods.length === 0) return;
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		const leaveType = leaveTypeLabel(notice.leaveType);
		const count = notice.periods.reduce((sum, p) => sum + p.days, 0);
		const lines: LocalizedText[] = notice.periods.map((p) => {
			const period = formatPeriod(p.startDate, p.endDate);
			return {
				hu: `${period.hu} (${p.days} munkanap)`,
				en: `${period.en} (${workingDaysEn(p.days)})`
			};
		});

		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'Szabadság rögzítve', en: 'Leave recorded' },
			message: {
				hu: `${leaveType.hu}: ${lines.map((l) => l.hu).join(', ')}`,
				en: `${leaveType.en}: ${lines.map((l) => l.en).join(', ')}`
			},
			type: 'success',
			data: { employeeId: notice.employeeId, organizationId: notice.organizationId }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: notice.event ?? 'leave.calendarChanged',
			template: 'leave_days_added',
			recipients: [employee],
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				leaveTypeLabel: leaveType[recipient.locale],
				dayCount: count,
				itemsHtml: itemsHtml(lines.map((l) => l[recipient.locale])),
				itemsText: itemsText(lines.map((l) => l[recipient.locale]))
			})
		});
	} catch (err) {
		console.error('[Work] Szabadság rögzítése értesítés sikertelen:', err);
	}
}

// --- Dolgozói adatbejelentések ------------------------------------------------
// Email csak bekapcsolt beállításnál (alapból ki): az adatbejelentés ritka és nem sürgős.

export interface LeaveDataRequestNotice {
	id: number;
	employeeId: number;
	organizationId: number;
	/** Rövid leírás, pl. „Új gyerek: 2026. 07. 01.” */
	summary: LocalizedText;
}

/**
 * Új adatbejelentés értesítés mindenkinek, akinek a szervezetben
 * leave.balance.manage joga van (a bejelentőt kivéve).
 */
export async function notifyLeaveDataRequestCreated(
	context: RemoteContext,
	request: LeaveDataRequestNotice
): Promise<void> {
	try {
		const actorUserId = await resolveActorUserId(context);
		const result = await context.db.query(
			`SELECT DISTINCT mr.user_id
			   FROM ${SCHEMA}.wp_member_roles mr
			   JOIN ${SCHEMA}.wp_role_capabilities rc ON rc.role_id = mr.role_id
			  WHERE mr.organization_id = $1 AND rc.capability = 'leave.balance.manage'
			    AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.employees x
			                     WHERE x.organization_id = mr.organization_id AND x.user_id = mr.user_id AND x.is_external)`,
			[request.organizationId]
		);
		const userIds = result.rows
			.map((row: { user_id: number }) => Number(row.user_id))
			.filter((id: number) => id !== actorUserId);
		if (userIds.length === 0) return;

		const employee = await loadEmployee(context, request.employeeId);
		const name = employee?.name ?? '—';
		await sendInApp(context, {
			userIds,
			title: { hu: 'Új adatbejelentés', en: 'New data change request' },
			message: { hu: `${name}: ${request.summary.hu}`, en: `${name}: ${request.summary.en}` },
			type: 'info',
			data: {
				leaveDataRequestId: request.id,
				employeeId: request.employeeId,
				organizationId: request.organizationId
			}
		});

		const organizationName = await loadOrganizationName(context, request.organizationId);
		await sendEmails(context, {
			organizationId: request.organizationId,
			event: 'leave.dataRequestCreated',
			template: 'leave_data_request_new',
			recipients: await loadRecipientsByUserIds(context, userIds),
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				employeeName: name,
				employeeNameHtml: escapeHtml(name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				summary: request.summary[recipient.locale],
				summaryHtml: escapeHtml(request.summary[recipient.locale])
			})
		});
	} catch (err) {
		console.error('[Work] Adatbejelentés értesítés sikertelen:', err);
	}
}

/** Döntés az adatbejelentésről: értesítés a bejelentő dolgozónak. */
export async function notifyLeaveDataRequestDecision(
	context: RemoteContext,
	request: LeaveDataRequestNotice,
	decision: 'approved' | 'rejected',
	decisionNote: string | null
): Promise<void> {
	try {
		const employee = await loadEmployee(context, request.employeeId);
		if (!employee || employee.userId === (await resolveActorUserId(context))) return;

		const approved = decision === 'approved';
		const note = decisionNote?.trim();
		await sendInApp(context, {
			userIds: [employee.userId],
			title: approved
				? { hu: 'Adatbejelentés jóváhagyva', en: 'Data change approved' }
				: { hu: 'Adatbejelentés elutasítva', en: 'Data change rejected' },
			message: {
				hu: note ? `${request.summary.hu} — ${note}` : request.summary.hu,
				en: note ? `${request.summary.en} — ${note}` : request.summary.en
			},
			type: approved ? 'success' : 'warning',
			data: { leaveDataRequestId: request.id, organizationId: request.organizationId }
		});

		const texts = DECISION_TEXTS[decision];
		const noteLabel: LocalizedText = { hu: 'Megjegyzés', en: 'Note' };
		const organizationName = await loadOrganizationName(context, request.organizationId);
		await sendEmails(context, {
			organizationId: request.organizationId,
			event: 'leave.dataRequestDecided',
			template: 'leave_data_request_status',
			recipients: [employee],
			buildData: (recipient) => ({
				recipientName: recipient.name,
				recipientNameHtml: escapeHtml(recipient.name),
				organizationName,
				organizationNameHtml: escapeHtml(organizationName),
				statusLabel: texts.label[recipient.locale],
				statusSentence: texts.sentence[recipient.locale],
				statusColor: texts.color,
				summary: request.summary[recipient.locale],
				summaryHtml: escapeHtml(request.summary[recipient.locale]),
				noteHtml: note ? noteBlockHtml(noteLabel[recipient.locale], note) : '',
				noteText: note ? `\n  ${noteLabel[recipient.locale]}: ${note}` : ''
			})
		});
	} catch (err) {
		console.error('[Work] Adatbejelentés döntés értesítés sikertelen:', err);
	}
}
