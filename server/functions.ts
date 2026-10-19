/**
 * Szerver oldali függvények — Work plugin (barrel).
 *
 * Ezek a függvények a Racona szerveren futnak, a plugin a `remote.call()`-lal
 * hívja őket. A remote dispatcher `serverModule[functionName]`-ként éri el a
 * függvényeket, ezért MINDEN remote-ból hívható függvényt itt kell
 * reexportálni — a fájl ezen kívül nem tartalmaz logikát.
 *
 * Fontos: amit ez a fájl futásidőben exportál, az remote-ból hívható. A csak
 * modulok közt használt belső segédek (pl. `assignDefaultEmployeeRole`)
 * szándékosan NEM szerepelnek itt.
 *
 * Domain modulok:
 *   context.ts       — remote kontextus típusok és segédek (dev mód, user id)
 *   types.ts         — modulok közt megosztott típusok
 *   employees.ts     — dolgozók és dolgozói adatlap
 *   leave.ts         — szabadságkérelmek és egyenlegek
 *   leave-days.ts    — a jóváhagyott szabadság napjai és a szabadságnaptár
 *   leave-closing.ts — év lezárása és megnyitása (csak nyitott évre lehet szabadságot rögzíteni)
 *   leave-year-opening.ts — évnyitás: keretek és a kötelező szabadságok kiírása
 *   leave-usage-plan.ts — szabadságfelhasználási terv (évenként; a tiszta rész: leave-usage-plan-utils.ts)
 *   leave-balance-overview.ts — szabadság egyenleg (a tiszta számítás: leave-balance-utils.ts, a kliens is importálja)
 *   leave-entitlement.ts — éves szabadságkeret számítása (tiszta függvény)
 *   leave-profile.ts — a számítás adatai (születési dátum, gyerekek, távollétek) és a számított keretek
 *   leave-allowances.ts — betegszabadság, apasági és szülői szabadság kerete
 *   leave-history.ts — a szabadságkeretek változásnaplója
 *   leave-carry-over.ts — az áthozott napok felhasználása és határideje
 *   leave-data-requests.ts — dolgozói adatbejelentések és azok elbírálása
 *   leave-data-request-files.ts — igazolások a bejelentésekhez (bytea a plugin sémában)
 *   dates.ts         — dátum-segédek (budapesti nap, YYYY-MM-DD ellenőrzés)
 *   leave-types.ts   — szabadságtípusok (a kliens is importálja)
 *   dashboard.ts     — irányítópult statisztikák
 *   leave-notifications.ts — szabadságos értesítések és az új kérelmek értesítendőinek beállítása
 *   notification-settings.ts — mely eseményekről menjen email (szervezetenként)
 *   notification-email.ts — közös email-küldés, a beállítás ellenőrzésével
 *   organizations.ts — szervezetek és szervezeti tagság
 *   permissions.ts   — szerepek és képességek
 *   projects.ts      — projektek, projekt tagok, projektvezetők
 *   work-entries.ts  — munkabejegyzések (lista, CRUD, kategóriák)
 *   project-report.ts — projekt riport (munkabejegyzések aggregálása)
 *   trip-calc.ts     — kiküldetési rendelvény számítása (tiszta függvények, a kliens is importálja)
 *   polyline.ts      — útvonal-alak kódolása (a kliens is importálja)
 *   trip-access.ts   — kiküldetések: „saját vagy HR” jogosultsági segédek
 *   trip-settings.ts — kiküldetések: beállítások és NAV üzemanyagárak
 *   geo.ts           — címkeresés (Nominatim) és útvonaltervezés (Valhalla) gyorsítótárral
 *   trip-vehicles.ts — a dolgozók autói
 *   trip-places.ts   — mentett helyek (lakcím, munkahely, céges és saját helyek)
 *   trips.ts         — utak rögzítése, elrendelő felülbírálása
 *   trip-settlements.ts — havi kiküldetési rendelvény: beküldés, jóváhagyás, kifizetés
 *   trip-notifications.ts — kiküldetési értesítések
 *
 * A kliens kód a típusokat innen importálja (`../../server/functions.js`),
 * ezért a domain modulok típusai is itt vannak reexportálva.
 */

// --- Kontextus --------------------------------------------------------------

export type { RemoteContext, PluginEmailService, PluginNotificationService } from './context.js';

// --- Megosztott típusok -----------------------------------------------------

export type { PaginatedResult } from './types.js';

// --- Dolgozókezelés ---------------------------------------------------------

export {
	getUnlinkedUsers,
	createEmployeeFromUser,
	createEmployeeWithUser,
	getEmployees,
	getEmployeeDetails,
	saveEmployeeDetail,
	deleteEmployeeDetail,
	updateEmployee,
	saveEmployeeBirthDate,
	saveEmployeePersonalData,
	getMyEmployee
} from './employees.js';

export type {
	Employee,
	EmployeeRow,
	EmployeeDetail,
	EmployeeDetailView,
	EmployeePersonalData,
	EmployeeListParams,
	UnlinkedUser
} from './employees.js';

// --- Dolgozói dokumentumok (specs/employee-documents.md) -------------------

export {
	listDocumentTypes,
	saveDocumentType,
	archiveDocumentType,
	deleteDocumentType,
	getDocumentSettings,
	saveDocumentSettings
} from './document-types.js';
export type { DocumentType, DocumentFileMode, DocumentTypeInput, DocumentSettings } from './document-types.js';

export {
	listEmployeeDocuments,
	getEmployeeDocumentEvents,
	saveEmployeeDocument,
	deleteEmployeeDocument,
	prepareDocumentUpload,
	attachDocumentFile,
	deleteDocumentFile,
	getDocumentFileUrl,
	getMyDocumentsEmployee,
	submitMyDocument,
	confirmMyDocumentSubmission,
	reviewEmployeeDocument
} from './employee-documents.js';
export { getDocumentOverview } from './document-overview.js';
export type { DocumentIssue, DocumentIssueKind, DocumentIssueCounts, DocumentOverview } from './document-overview.js';
export type {
	EmployeeDocument,
	EmployeeDocumentFile,
	EmployeeDocumentsView,
	EmployeeDocumentEvent,
	DocumentStatus,
	DocumentExpiryStatus,
	DocumentEventAction,
	SaveEmployeeDocumentInput
} from './employee-documents.js';

// --- Szabadság nyilvántartó -------------------------------------------------

export {
	calculateWorkingDays,
	previewLeaveDays,
	getLeaveRequests,
	createLeaveRequest,
	approveLeaveRequest,
	rejectLeaveRequest,
	withdrawLeaveRequest,
	deleteLeaveRequest,
	getLeaveBalances
} from './leave.js';

export type {
	LeaveRequest,
	LeaveRequestRow,
	LeaveRequestListParams,
	CreateLeaveRequestParams,
	LeaveBalance,
	LeaveBalanceCalculation
} from './leave.js';

// --- Szabadságnapok és naptár ---------------------------------------------

export {
	getLeaveCalendar,
	previewLeaveCalendarSave,
	saveLeaveCalendar,
	previewLeaveRequestBatch,
	submitLeaveRequestBatch
} from './leave-days.js';
export { getLeaveClosedYear, setLeaveClosedYear } from './leave-closing.js';
export type { LeaveYearState } from './leave-closing.js';
export {
	previewOpenLeaveYear,
	openLeaveYear,
	previewMandatoryLeave,
	applyMandatoryLeave
} from './leave-year-opening.js';
export type {
	MandatoryLeavePeriod,
	MandatoryLeaveRow,
	MandatoryLeavePlan,
	OpenLeaveYearPreview,
	MandatoryLeaveResult,
	OpenLeaveYearResult
} from './leave-year-opening.js';
export {
	getMonthConfirmations,
	sendMonthConfirmations,
	resolveMonthConfirmation,
	getMyMonthConfirmations,
	respondMonthConfirmation
} from './leave-month-confirmations.js';
export type {
	MonthConfirmation,
	MonthConfirmationRow,
	MonthConfirmationOverview,
	MonthConfirmationSendResult
} from './leave-month-confirmations.js';
// Havi ellenőrzés automatizálása (specs/leave-month-automation.md). A napi futás
// belső függvényei (processOrganization, performMonthConfirmationSend) szándékosan
// nincsenek itt: rendszerjogon futnak, csak a server/jobs.ts hívhatja őket.
export { getLeaveMonthAutomation, saveLeaveMonthAutomation } from './leave-month-automation.js';
export type { LeaveMonthAutomationInfo, MonthAutomationStatus } from './leave-month-automation.js';
export type {
	AutomationDayKind,
	AutoSendSettings,
	ReminderSettings,
	LeaveMonthAutomationSettings,
	LastAutoSend
} from './leave-month-automation-utils.js';
// Hiányzó munkanapló-bejegyzések figyelése (specs/work-log-check.md). A napi futás
// (runWorkLogCheckForAll) szándékosan nincs itt: csak a server/jobs.ts hívhatja.
export { getWorkLogCheck, getWorkLogCheckStatus, saveWorkLogCheck } from './work-log-check.js';
export type { WorkLogCheckInfo, WorkLogCheckEmployee, WorkLogCheckLastRun } from './work-log-check.js';
export type { WorkLogCheckSettings } from './work-log-check-utils.js';
export type {
	MonthConfirmationStatus,
	MonthSnapshot,
	SnapshotDay,
	SnapshotSummary,
	SnapshotPeriod,
	DisputeItem,
	DisputeItemKind,
	SendAction
} from './leave-month-confirmation-utils.js';
export { getLeaveUsagePlan, saveLeaveUsagePlan } from './leave-usage-plan.js';
export type { UsagePlanSource, ResolvedUsagePlan, LeaveUsagePlanView } from './leave-usage-plan.js';
export type { UsagePlan, PlanError, PlanErrorCode } from './leave-usage-plan-utils.js';
export { getLeaveBalanceOverview } from './leave-balance-overview.js';
export type { LeaveBalanceOverview, BalanceOverviewProject } from './leave-balance-overview.js';
export type {
	BalanceEmployeeRow,
	BalanceStatus,
	BalanceFilter,
	BalanceSummary,
	EmployeeFigures,
	SeriesPoint,
	MonthDetail,
	TrendPoint
} from './leave-balance-utils.js';
export type {
	LeaveCalendar,
	LeaveCalendarDay,
	LeaveCalendarPendingDay,
	LeaveCalendarChangeParams,
	LeaveCalendarChangePlan,
	LeaveCalendarSaveResult,
	LeaveRequestBatchParams,
	LeaveRequestBatchResult,
	CalendarBalanceEffect,
	LeaveRun
} from './leave-days.js';

// --- Szabadságkeret-számítás ------------------------------------------------

export {
	getLeaveProfile,
	saveEmployeeChild,
	deleteEmployeeChild,
	saveExtraLeave,
	deleteExtraLeave,
	saveAbsencePeriod,
	deleteAbsencePeriod,
	previewLeaveEntitlement,
	createLeaveBalanceFromCalculation,
	setLeaveBalanceAdjustment,
	applyCalculationToBalance,
	previewBulkEntitlements,
	applyLeaveEntitlements,
	getLeavePolicy,
	saveLeavePolicy
} from './leave-profile.js';

export type {
	LeaveProfile,
	EmployeeChild,
	ExtraLeave,
	EmployeeAbsence,
	EmployeeAbsenceKind,
	RecalculatedBalance,
	PreviousYearBalance,
	BulkEntitlementRow,
	BulkEntitlementPreview,
	BulkEntitlementDecision
} from './leave-profile.js';

export { getLeaveAllowances } from './leave-allowances.js';
export type { LeaveAllowances, SickLeaveStatus, ChildLeaveStatus } from './leave-allowances.js';

export {
	submitLeaveDataRequest,
	cancelLeaveDataRequest,
	getLeaveDataRequests,
	decideLeaveDataRequest
} from './leave-data-requests.js';
export type {
	LeaveDataRequest,
	LeaveDataRequestKind,
	LeaveDataRequestStatus,
	LeaveDataRequestPayload,
	ChildData,
	ReportableExtraKind
} from './leave-data-requests.js';

export {
	attachLeaveDataRequestFile,
	getLeaveDataRequestFile,
	deleteLeaveDataRequestFile
} from './leave-data-request-files.js';
export type { LeaveDataRequestFile, CertificateMimeType } from './leave-data-request-files.js';

export { getCarryOverAlerts } from './leave-carry-over.js';
export type { CarryOverAlert } from './leave-carry-over.js';

export { getLeaveBalanceHistory } from './leave-history.js';
export type { BalanceHistoryEntry, BalanceHistoryAction, BalanceSnapshot } from './leave-history.js';

export type { LeaveType } from './leave-types.js';

export type {
	EntitlementResult,
	EntitlementItem,
	EntitlementItemCode,
	EntitlementWarning,
	EntitlementWarningCode,
	ExtraLeaveKind,
	LeavePolicy,
	CarryOverUsage,
	CarryOverStatus
} from './leave-entitlement.js';

// --- Irányítópult -----------------------------------------------------------

export { getDashboardStats } from './dashboard.js';
export type { DashboardStats } from './dashboard.js';

// --- Beállítások ------------------------------------------------------------

export { getLeaveNotifiers, saveLeaveNotifiers } from './leave-notifications.js';
export { getNotificationSettings, saveNotificationSettings } from './notification-settings.js';
export type { NotificationEvent, NotificationGroup, NotificationSettings } from './notification-settings.js';

// --- Szervezetek ------------------------------------------------------------

export {
	generateSlug,
	createOrganization,
	isUserAdmin,
	getUserOrganizations,
	getOrganizations,
	updateOrganization,
	deleteOrganization,
	getOrganizationMembers,
	removeEmployeeFromOrganization
} from './organizations.js';

export type {
	Organization,
	SavedOrganization,
	OrganizationMember,
	OrganizationMemberRow
} from './organizations.js';

// --- Munkanaptár ------------------------------------------------------------

export {
	listCalendarDays,
	upsertCalendarDay,
	deleteCalendarDay,
	generateHungarianHolidays,
	hungarianPublicHolidays
} from './work-calendar.js';

export type { CalendarDay, CalendarDayKind } from './work-calendar.js';

// --- Jogosultságkezelés (szervezet-szintű szerepek, képességek) -------------

export {
	getMyCapabilities,
	listRoles,
	createRole,
	updateRole,
	deleteRole,
	listRoleMembers,
	addRoleMember,
	removeRoleMember
} from './permissions.js';
// A seedDefaultRoles belső segéd (createOrganization hívja): remote-ból hívva
// bárki szervezet-adminisztrátorrá tehette volna magát, ezért nincs itt.

export type { Capability, RoleRow, RoleMemberRow } from './permissions.js';

// --- Projektek --------------------------------------------------------------

export {
	listProjects,
	getProject,
	createProject,
	updateProject,
	deleteProject,
	closeProject,
	reopenProject,
	listProjectMembers,
	addProjectMember,
	removeProjectMember
} from './projects.js';

export type {
	Project,
	ProjectRow,
	ProjectStatus,
	ProjectListParams,
	ProjectListResult,
	ProjectMemberRow,
	ProjectAccess,
	ProjectDetailRow
} from './projects.js';

// --- Munkabejegyzések (work entries) ---------------------------------------

export {
	listWorkEntries,
	createWorkEntry,
	updateWorkEntry,
	deleteWorkEntry
} from './work-entries.js';

export type {
	WorkEntry,
	WorkEntryRow,
	WorkEntryListParams,
	WorkEntryListResult
} from './work-entries.js';

// --- Munkabejegyzés-kategóriák (projektenként) -----------------------------

export {
	getWorkEntryCategories,
	getWorkEntryCategorySources,
	createWorkEntryCategory,
	updateWorkEntryCategory,
	deleteWorkEntryCategory,
	reorderWorkEntryCategories,
	copyWorkEntryCategories,
	setProjectMemberDefaultCategory
} from './work-categories.js';

export type { WorkEntryCategory, WorkEntryCategorySource } from './work-categories.js';

// --- Heti gyors rögzítés ----------------------------------------------------

export { getQuickEntryOptions } from './quick-entry.js';

export type {
	QuickEntryOptions,
	QuickEntryProject,
	QuickEntryCategory,
	QuickEntryEmployee
} from './quick-entry.js';

// --- Projekt riport ---------------------------------------------------------

export { getProjectReport } from './project-report.js';

export type {
	ProjectReport,
	ProjectReportEmployee,
	ProjectReportEmployeeCategory,
	ProjectReportCategory,
	ProjectReportDaily,
	ProjectReportBucket,
	ProjectReportLifetime
} from './project-report.js';

// --- Kiküldetések -------------------------------------------------------------

export { getTripPolicy, saveTripPolicy, getFuelPrices, saveFuelPrice } from './trip-settings.js';
export type { TripPolicy, FuelPrice } from './trip-settings.js';

export { previewNavFuelPrices, applyNavFuelPrices } from './nav-fuel-import.js';
export type { NavFuelPreview, NavFuelApplyResult } from './nav-fuel-import.js';

export { searchPlaces, calculateRoute } from './geo.js';
export type { PlaceResult, RouteResult } from './geo.js';

export { getTripVehicles, saveTripVehicle, archiveTripVehicle } from './trip-vehicles.js';
export type { TripVehicle } from './trip-vehicles.js';

export { getTripPlaces, getCompanyTripPlaces, saveTripPlace, deleteTripPlace } from './trip-places.js';
export type { TripPlace, TripPlaces } from './trip-places.js';

export { getTrip, saveTrip, deleteTrip, setTripOrderedBy } from './trips.js';
export type { TripRow, TripDetail, SaveTripParams } from './trips.js';

export {
	getTripMonth,
	getSettlements,
	getSettlementDocument,
	submitSettlement,
	withdrawSettlement,
	decideSettlement,
	markSettlementPaid,
	reopenSettlement,
	getSettlementPermissions,
	getTripOrderers
} from './trip-settlements.js';
export type { SettlementKey, TripMonthGroup, SettlementListRow } from './trip-settlements.js';

export type {
	FuelType,
	PriceType,
	ReturnMode,
	SettlementStatus,
	SettlementWarning,
	SettlementDocument,
	SettlementRow,
	SettlementCalc,
	VehicleConsumption,
	Waypoint
} from './trip-calc.js';
