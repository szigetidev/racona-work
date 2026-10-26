/**
 * Havi szabadság-ellenőrzés — értesítések (specs/leave-month-confirmation.md, 8. fejezet).
 *
 * Események:
 *   - kiküldés, újraküldés → a dolgozó kapja az összesítőt
 *   - eltérés → a kiküldő és a Szabadság beállításoknál kijelöltek
 *   - lezárás elfogadás nélkül → a dolgozó
 *   - emlékeztető → a válaszra váró dolgozó (specs/leave-month-automation.md, K3)
 *   - zárási összesítő → a kijelölt szabadságkezelők (specs/leave-month-automation.md, K4)
 *
 * Minden küldés best-effort: a hibát naplózzuk, a művelet nem gördül vissza.
 * A műveletet végző felhasználó nem kap értesítést a saját lépéséről (a HR a
 * saját összesítőjét az irányítópulton így is látja). Az email csak akkor megy
 * ki, ha a szervezet az eseményhez bekapcsolta.
 */

import type { LocalizedText, RemoteContext } from './context.js';
import { resolveUserId } from './context.js';
import {
	RECIPIENT_LOCALE_SQL,
	escapeHtml,
	itemsHtml,
	itemsText,
	loadOrganizationName,
	noteBlockHtml,
	sendEmails,
	toRecipient
} from './notification-email.js';
import type { Recipient } from './notification-email.js';
import { NOTIFIER_CAPABILITY_SQL, notifiersSettingsKey } from './leave-notifications.js';
import { isLeaveType, LEAVE_TYPE_LABELS } from './leave-types.js';
import { formatMonthLabel, summarizeSnapshot } from './leave-month-confirmation-utils.js';
import type { DisputeItem, MonthSnapshot, SnapshotPeriod, SnapshotSummary } from './leave-month-confirmation-utils.js';
import type { MonthConfirmationOverview } from './leave-month-confirmations.js';
import { SCHEMA } from './trip-access.js';
import { MOBILE_ENTRY } from './mobile.js';

type Locale = keyof LocalizedText;

interface ConfirmationRef {
	id: number;
	employeeId: number;
	organizationId: number;
	year: number;
	month: number;
}

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

async function sendInApp(
	context: RemoteContext,
	params: Parameters<NonNullable<RemoteContext['notifications']>['send']>[0]
): Promise<void> {
	if (!context.notifications) {
		console.warn('[Work] A core nem ad át notifications szolgáltatást — a rendszeren belüli értesítés kimarad.');
		return;
	}
	try {
		const result = await context.notifications.send(params);
		if (!result.success) console.error('[Work] Rendszeren belüli értesítés sikertelen:', result.error);
	} catch (err) {
		console.error('[Work] Rendszeren belüli értesítés sikertelen:', err);
	}
}

async function actorUserId(context: RemoteContext): Promise<number | null> {
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

function typeLabel(type: string, locale: Locale): string {
	return isLeaveType(type) ? LEAVE_TYPE_LABELS[type][locale] : type;
}

function formatDay(isoDay: string, locale: Locale): string {
	return new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'UTC'
	}).format(new Date(`${isoDay}T00:00:00Z`));
}

function daysText(days: number, locale: Locale): string {
	return locale === 'hu' ? `${days} munkanap` : `${days} working ${days === 1 ? 'day' : 'days'}`;
}

function periodLine(p: SnapshotPeriod, locale: Locale): string {
	const range =
		p.startDate === p.endDate
			? formatDay(p.startDate, locale)
			: `${formatDay(p.startDate, locale)} – ${formatDay(p.endDate, locale)}`;
	return `${range} · ${typeLabel(p.leaveType, locale)} · ${daysText(p.days, locale)}`;
}

function byTypeText(byType: { leaveType: string; days: number }[], locale: Locale): string {
	return byType.map((t) => `${typeLabel(t.leaveType, locale)} ${t.days}`).join(', ');
}

/** „Válaszolási határidő: 2026. október 28.” — üres, ha nincs határidő. */
function deadlineText(deadline: string | null, locale: Locale, prefix: string): string {
	if (!deadline) return '';
	const date = new Intl.DateTimeFormat(locale === 'hu' ? 'hu-HU' : 'en-GB', {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${deadline}T00:00:00Z`));
	// A magyar dátum már ponttal végződik („2026. november 26.”)
	return locale === 'hu' ? `${prefix}Válaszolási határidő: ${date}` : `${prefix}Please answer by: ${date}.`;
}

/** Magyar névelő egy számjeggyel írt sorszám elé (1–20): „az 1.”, „az 5.”, egyébként „a”. */
function huArticle(n: number): 'a' | 'az' {
	return n === 1 || n === 5 ? 'az' : 'a';
}

/** A havi összesítő sorai az emailhez: szakaszok és összesen, vagy hogy nincs szabadság. */
function summaryLines(summary: SnapshotSummary, locale: Locale): string[] {
	if (summary.dayCount === 0) {
		return [locale === 'hu' ? 'Erre a hónapra nincs rögzített szabadságod.' : 'No leave is recorded for you this month.'];
	}
	return [
		...summary.periods.map((p) => periodLine(p, locale)),
		locale === 'hu'
			? `Összesen ${daysText(summary.dayCount, locale)}: ${byTypeText(summary.byType, locale)}`
			: `Total ${daysText(summary.dayCount, locale)}: ${byTypeText(summary.byType, locale)}`
	];
}

/** Egy eltérés-tétel olvasható formában. */
function disputeLine(item: DisputeItem, snapshot: MonthSnapshot, locale: Locale): string {
	const day = formatDay(item.day, locale);
	const recorded = snapshot.days.find((d) => d.day === item.day)?.leaveType;
	const recordedLabel = recorded ? typeLabel(recorded, locale) : '—';
	const correct = item.leaveType ? typeLabel(item.leaveType, locale) : '—';
	switch (item.kind) {
		case 'not_on_leave':
			return locale === 'hu'
				? `${day}: nem volt szabadságon (rögzítve: ${recordedLabel})`
				: `${day}: was not on leave (recorded: ${recordedLabel})`;
		case 'wrong_type':
			return locale === 'hu'
				? `${day}: más a típusa (${recordedLabel} helyett ${correct})`
				: `${day}: wrong type (${correct} instead of ${recordedLabel})`;
		case 'missing':
			return locale === 'hu' ? `${day}: hiányzik (${correct})` : `${day}: missing (${correct})`;
	}
}

// ---------------------------------------------------------------------------
// Kiküldés és újraküldés
// ---------------------------------------------------------------------------

/**
 * Az összesítő a dolgozónak, rendszeren belül és emailben (K4).
 *
 * @param notice.resent - Újraküldés: a korábbi összesítő frissített változata.
 * @param notice.note - A HR megjegyzése (újraküldésnél a válasz az eltérésre).
 */
export async function notifyMonthConfirmationRequested(
	context: RemoteContext,
	notice: ConfirmationRef & { snapshot: MonthSnapshot; note: string | null; resent: boolean }
): Promise<void> {
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await actorUserId(context))) return;

		const summary = summarizeSnapshot(notice.snapshot);
		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};
		const recorded: LocalizedText =
			summary.dayCount === 0
				? { hu: 'nincs rögzített szabadságod', en: 'no leave is recorded for you' }
				: {
						hu: `${summary.dayCount} nap rögzítve (${byTypeText(summary.byType, 'hu')})`,
						en: `${summary.dayCount} ${summary.dayCount === 1 ? 'day' : 'days'} recorded (${byTypeText(summary.byType, 'en')})`
					};

		await sendInApp(context, {
			userIds: [employee.userId],
			title: notice.resent
				? { hu: 'Frissített havi szabadság-összesítő', en: 'Updated monthly leave summary' }
				: { hu: 'Ellenőrizd a havi szabadságaidat', en: 'Please check your monthly leave' },
			message: {
				hu: `${label.hu}: ${recorded.hu}. Az irányítópulton elfogadhatod, vagy jelezheted, ha valami nem stimmel.${notice.note ? ` HR: ${notice.note}` : ''}`,
				en: `${label.en}: ${recorded.en}. Accept it on the dashboard, or report if something is wrong.${notice.note ? ` HR: ${notice.note}` : ''}`
			},
			type: 'info',
			data: { monthConfirmationId: notice.id, organizationId: notice.organizationId, mobileEntry: MOBILE_ENTRY.month }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);

		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationRequested',
			template: 'leave_month_confirmation_request',
			recipients: [employee],
			buildData: (recipient) => {
				const locale = recipient.locale;
				const lines = summaryLines(summary, locale);
				const pendingLabel = locale === 'hu' ? 'Függő kérelmek (még nincsenek benne)' : 'Pending requests (not included yet)';
				const pendingValue = summary.pendingPeriods.map((p) => periodLine(p, locale)).join('; ');
				const noteLabel = locale === 'hu' ? 'A HR megjegyzése' : 'Note from HR';
				const updateNotice = notice.resent
					? locale === 'hu'
						? 'Ez a korábbi összesítő frissített változata, a régit nem kell figyelembe venned.'
						: 'This is an updated version of the earlier summary; you can ignore the previous one.'
					: '';
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[locale],
					dayCount: summary.dayCount,
					itemsHtml: itemsHtml(lines),
					itemsText: itemsText(lines),
					pendingHtml: pendingValue ? noteBlockHtml(pendingLabel, pendingValue) : '',
					pendingText: pendingValue ? `\n${pendingLabel}: ${pendingValue}\n` : '',
					noteHtml: notice.note ? noteBlockHtml(noteLabel, notice.note) : '',
					noteText: notice.note ? `\n${noteLabel}: ${notice.note}\n` : '',
					updateNoticeHtml: escapeHtml(updateNotice),
					updateNoticeText: updateNotice
				};
			}
		});
	} catch (err) {
		console.error('[Work] Havi szabadság-összesítő értesítés sikertelen:', err);
	}
}

// ---------------------------------------------------------------------------
// Eltérés
// ---------------------------------------------------------------------------

/**
 * A dolgozó eltérést jelzett: értesítés a kiküldőnek és a kijelölt
 * értesítendőknek (K7).
 */
export async function notifyMonthConfirmationDisputed(
	context: RemoteContext,
	notice: ConfirmationRef & {
		snapshot: MonthSnapshot;
		items: DisputeItem[];
		note: string | null;
		sentBy: number | null;
	}
): Promise<void> {
	try {
		const settings = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
			notifiersSettingsKey(notice.organizationId)
		]);
		const stored = settings.rows[0]?.value;
		const notifierEmployeeIds = Array.isArray(stored)
			? stored.map(Number).filter((id) => Number.isInteger(id) && id > 0)
			: [];

		const recipientResult = await context.db.query(
			`SELECT DISTINCT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
			   FROM auth.users u
			  WHERE u.id = $1
			     OR u.id IN (SELECT e.user_id FROM ${SCHEMA}.employees e
			                  WHERE e.id = ANY($2::int[]) AND e.organization_id = $3 AND e.status = 'active' AND e.is_external = FALSE
			                    AND ${NOTIFIER_CAPABILITY_SQL})`,
			[notice.sentBy ?? 0, notifierEmployeeIds, notice.organizationId]
		);
		const actor = await actorUserId(context);
		const recipients: Recipient[] = recipientResult.rows.map(toRecipient).filter((r: Recipient) => r.userId !== actor);
		if (recipients.length === 0) return;

		const employee = await loadEmployee(context, notice.employeeId);
		const name = employee?.name ?? '—';
		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};
		const lines = (locale: Locale) => notice.items.map((item) => disputeLine(item, notice.snapshot, locale));
		const brief = (locale: Locale) =>
			[
				locale === 'hu' ? `${notice.items.length} tétel` : `${notice.items.length} item(s)`,
				notice.note ? `„${notice.note}”` : ''
			]
				.filter(Boolean)
				.join(' · ');

		await sendInApp(context, {
			userIds: recipients.map((r) => r.userId),
			title: { hu: 'Eltérés a havi szabadság-összesítőben', en: 'Discrepancy in a monthly leave summary' },
			message: { hu: `${name}, ${label.hu}: ${brief('hu')}`, en: `${name}, ${label.en}: ${brief('en')}` },
			type: 'warning',
			data: {
				monthConfirmationId: notice.id,
				employeeId: notice.employeeId,
				organizationId: notice.organizationId
			}
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationDisputed',
			template: 'leave_month_confirmation_disputed',
			recipients,
			buildData: (recipient) => {
				const locale = recipient.locale;
				const emailLines = notice.items.length
					? lines(locale)
					: [locale === 'hu' ? 'Tételt nem jelölt meg, lásd a megjegyzést.' : 'No items marked, see the note.'];
				const noteLabel = locale === 'hu' ? 'A dolgozó megjegyzése' : "Employee's note";
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					employeeName: name,
					employeeNameHtml: escapeHtml(name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[locale],
					itemsHtml: itemsHtml(emailLines),
					itemsText: itemsText(emailLines),
					noteHtml: notice.note ? noteBlockHtml(noteLabel, notice.note) : '',
					noteText: notice.note ? `\n${noteLabel}: ${notice.note}\n` : ''
				};
			}
		});
	} catch (err) {
		console.error('[Work] Havi összesítő eltérés értesítés sikertelen:', err);
	}
}

// ---------------------------------------------------------------------------
// Lezárás elfogadás nélkül
// ---------------------------------------------------------------------------

/** A HR a dolgozó elfogadása nélkül lezárta az ellenőrzést (K8). */
export async function notifyMonthConfirmationClosed(
	context: RemoteContext,
	notice: ConfirmationRef & { note: string }
): Promise<void> {
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee || employee.userId === (await actorUserId(context))) return;

		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};
		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'A HR lezárta a havi szabadság-ellenőrzést', en: 'HR closed the monthly leave check' },
			message: { hu: `${label.hu}: ${notice.note}`, en: `${label.en}: ${notice.note}` },
			type: 'info',
			data: { monthConfirmationId: notice.id, organizationId: notice.organizationId, mobileEntry: MOBILE_ENTRY.month }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationClosed',
			template: 'leave_month_confirmation_closed',
			recipients: [employee],
			buildData: (recipient) => {
				const noteLabel = recipient.locale === 'hu' ? 'Indoklás' : 'Reason';
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[recipient.locale],
					noteHtml: noteBlockHtml(noteLabel, notice.note),
					noteText: `${noteLabel}: ${notice.note}`
				};
			}
		});
	} catch (err) {
		console.error('[Work] Havi ellenőrzés lezárás értesítés sikertelen:', err);
	}
}

// ---------------------------------------------------------------------------
// Emlékeztető (specs/leave-month-automation.md, K3)
// ---------------------------------------------------------------------------

/**
 * Emlékeztető a válaszra váró dolgozónak, rendszeren belül és emailben.
 *
 * @param notice.reminderNumber - Hányadik emlékeztető (1-től).
 * @param notice.deadline - A válaszolási határidő (a zárás előtti utolsó munkanap), vagy null.
 */
export async function notifyMonthConfirmationReminder(
	context: RemoteContext,
	notice: ConfirmationRef & { snapshot: MonthSnapshot; reminderNumber: number; deadline: string | null }
): Promise<void> {
	try {
		const employee = await loadEmployee(context, notice.employeeId);
		if (!employee) return;

		const summary = summarizeSnapshot(notice.snapshot);
		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};

		await sendInApp(context, {
			userIds: [employee.userId],
			title: { hu: 'Emlékeztető: havi szabadság-ellenőrzés', en: 'Reminder: monthly leave check' },
			message: {
				hu: `${label.hu}: még nem válaszoltál a havi szabadság-összesítőre.${deadlineText(notice.deadline, 'hu', ' ')} Az irányítópulton elfogadhatod, vagy jelezheted, ha valami nem stimmel.`,
				en: `${label.en}: you have not answered the monthly leave summary yet.${deadlineText(notice.deadline, 'en', ' ')} Accept it on the dashboard, or report if something is wrong.`
			},
			type: 'warning',
			data: { monthConfirmationId: notice.id, organizationId: notice.organizationId, mobileEntry: MOBILE_ENTRY.month }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationReminder',
			template: 'leave_month_confirmation_reminder',
			recipients: [employee],
			buildData: (recipient) => {
				const locale = recipient.locale;
				const lines = summaryLines(summary, locale);
				const reminderNotice = [
					locale === 'hu'
						? `Ez ${huArticle(notice.reminderNumber)} ${notice.reminderNumber}. emlékeztető.`
						: `This is reminder no. ${notice.reminderNumber}.`,
					deadlineText(notice.deadline, locale, '')
				]
					.filter(Boolean)
					.join(' ');
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[locale],
					itemsHtml: itemsHtml(lines),
					itemsText: itemsText(lines),
					reminderNoticeHtml: escapeHtml(reminderNotice),
					reminderNoticeText: reminderNotice
				};
			}
		});
	} catch (err) {
		console.error('[Work] Havi ellenőrzés emlékeztető sikertelen:', err);
	}
}

// ---------------------------------------------------------------------------
// Zárási összesítő (specs/leave-month-automation.md, K4)
// ---------------------------------------------------------------------------

/**
 * A hónap zárásának napján (az emlékeztetők leállásakor) összesítő a
 * Szabadság beállításoknál kijelölt értesítendőknek: ki fogadta el, ki nem
 * válaszolt, ki jelzett eltérést, kinek változtak a napjai, ki nem kapta meg.
 *
 * @returns Ment-e ki értesítés (ha nincs kijelölt értesítendő, nem).
 */
export async function notifyMonthConfirmationClosingSummary(
	context: RemoteContext,
	notice: { organizationId: number; year: number; month: number; overview: MonthConfirmationOverview }
): Promise<boolean> {
	try {
		const settings = await context.db.query(`SELECT value FROM ${SCHEMA}.kv_store WHERE key = $1`, [
			notifiersSettingsKey(notice.organizationId)
		]);
		const stored = settings.rows[0]?.value;
		const notifierEmployeeIds = Array.isArray(stored)
			? stored.map(Number).filter((id) => Number.isInteger(id) && id > 0)
			: [];

		const recipientResult = await context.db.query(
			`SELECT DISTINCT u.id AS user_id, u.full_name, u.email, ${RECIPIENT_LOCALE_SQL}
			   FROM ${SCHEMA}.employees e
			   JOIN auth.users u ON u.id = e.user_id
			  WHERE e.id = ANY($1::int[]) AND e.organization_id = $2 AND e.status = 'active' AND e.is_external = FALSE
			    AND ${NOTIFIER_CAPABILITY_SQL}`,
			[notifierEmployeeIds, notice.organizationId]
		);
		const recipients: Recipient[] = recipientResult.rows.map(toRecipient);
		if (recipients.length === 0) {
			console.warn('[Work] Havi ellenőrzés: a zárási összesítő nem ment ki, mert nincs kijelölt értesítendő.');
			return false;
		}

		const groups = closingGroups(notice.overview);
		const label: LocalizedText = {
			hu: formatMonthLabel(notice.year, notice.month, 'hu'),
			en: formatMonthLabel(notice.year, notice.month, 'en')
		};
		const brief = (locale: Locale) =>
			locale === 'hu'
				? `${label.hu}: elfogadta ${groups.accepted}, nem válaszolt ${groups.pending.length}, eltérést jelzett ${groups.disputed.length}.` +
					(notice.overview.closable ? ' A hónap zárható.' : '')
				: `${label.en}: accepted ${groups.accepted}, not answered ${groups.pending.length}, discrepancy ${groups.disputed.length}.` +
					(notice.overview.closable ? ' The month can be closed.' : '');

		await sendInApp(context, {
			userIds: recipients.map((r) => r.userId),
			title: { hu: 'Havi szabadság-ellenőrzés: zárás', en: 'Monthly leave check: closing' },
			message: { hu: brief('hu'), en: brief('en') },
			type: groups.pending.length + groups.disputed.length + groups.stale.length > 0 ? 'warning' : 'success',
			data: { organizationId: notice.organizationId, year: notice.year, month: notice.month }
		});

		const organizationName = await loadOrganizationName(context, notice.organizationId);
		await sendEmails(context, {
			organizationId: notice.organizationId,
			event: 'leave.monthConfirmationSummary',
			template: 'leave_month_confirmation_summary',
			recipients,
			buildData: (recipient) => {
				const lines = closingLines(groups, notice.overview.closable, recipient.locale);
				return {
					recipientName: recipient.name,
					recipientNameHtml: escapeHtml(recipient.name),
					organizationName,
					organizationNameHtml: escapeHtml(organizationName),
					periodLabel: label[recipient.locale],
					itemsHtml: itemsHtml(lines),
					itemsText: itemsText(lines)
				};
			}
		});
		return true;
	} catch (err) {
		console.error('[Work] Havi ellenőrzés zárási összesítő sikertelen:', err);
		return false;
	}
}

interface ClosingGroups {
	accepted: number;
	closed: number;
	pending: string[];
	disputed: string[];
	stale: string[];
	notSent: string[];
}

/** A hónap dolgozói állapot szerint (a változott tételek külön, mert újra kell küldeni). */
function closingGroups(overview: MonthConfirmationOverview): ClosingGroups {
	const groups: ClosingGroups = { accepted: 0, closed: 0, pending: [], disputed: [], stale: [], notSent: [] };
	for (const row of overview.rows) {
		const c = row.confirmation;
		if (!c) {
			if (row.eligible) groups.notSent.push(row.employeeName);
		} else if (c.status === 'disputed') {
			groups.disputed.push(row.employeeName);
		} else if (c.stale) {
			groups.stale.push(row.employeeName);
		} else if (c.status === 'pending') {
			groups.pending.push(row.employeeName);
		} else if (c.status === 'accepted') {
			groups.accepted++;
		} else if (c.status === 'closed') {
			groups.closed++;
		}
	}
	return groups;
}

function closingLines(groups: ClosingGroups, closable: boolean, locale: Locale): string[] {
	const hu = locale === 'hu';
	const named = (labelHu: string, labelEn: string, names: string[]) =>
		names.length > 0 ? [`${hu ? labelHu : labelEn} (${names.length}): ${names.join(', ')}`] : [];
	return [
		hu ? `Elfogadta: ${groups.accepted} dolgozó` : `Accepted: ${groups.accepted} employee(s)`,
		...(groups.closed > 0
			? [hu ? `HR lezárta elfogadás nélkül: ${groups.closed}` : `Closed by HR without acceptance: ${groups.closed}`]
			: []),
		...named('Nem válaszolt', 'Not answered', groups.pending),
		...named('Eltérést jelzett', 'Reported a discrepancy', groups.disputed),
		...named('Változott a kiküldés óta, újra kell küldeni', 'Changed since sending, needs resending', groups.stale),
		...named('Nem kapta meg', 'Not sent', groups.notSent),
		closable
			? hu
				? 'Minden dolgozó elfogadta vagy le van zárva: a hónap zárható.'
				: 'Everyone accepted or is closed: the month can be closed.'
			: hu
				? 'A hónap még nem zárható: a fenti tételeket a csapatnézetben kezelheted.'
				: 'The month cannot be closed yet: handle the items above in the team view.'
	];
}
