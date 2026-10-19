<svelte:options customElement={{ tag: 'racona-work-quick-work-log', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_QuickWorkLog = function () {
			return { tagName: 'racona-work-quick-work-log' };
		};
	}
</script>

<!--
	Heti gyors rögzítés — a napi munkák rögzítése projektbe lépés nélkül.

	A hét napjai kártyákon; minden naphoz „+ Munka” gomb, amellyel projekt,
	kategória (ha a projektnek van, a dolgozó alapértelmezettje előre kiválasztva)
	és óraszám megadásával egyből menthető a bejegyzés. Aki work.view.all joggal
	rendelkezik (pl. szervezet adminisztrátor), más dolgozót is választhat, és
	helyette rögzíthet.

	A mentés a meglévő createWorkEntry / updateWorkEntry / deleteWorkEntry
	függvényekkel megy, azok ellenőrzéseivel (tagság, lezárás, kezdő dátum).
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		getOrganizationStore,
		createOrganizationStore
	} from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import type {
		Organization,
		QuickEntryOptions,
		QuickEntryProject,
		WorkEntryListResult,
		WorkEntryRow
	} from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { appLocale, formatDate, formatNumber } from '../utils/format.js';

	let { pluginId = 'racona-work' }: { pluginId?: string } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	let canLog = $state(false);

	let options = $state<QuickEntryOptions | null>(null);
	/** Akinek a hetét nézzük; null: a hívó saját maga. */
	let selectedEmployeeId = $state<number | null>(null);
	let weekStart = $state(mondayOf(new Date()));
	let entries = $state<WorkEntryRow[]>([]);
	let loading = $state(false);
	let errorMsg = $state<string | null>(null);

	// Rögzítő / szerkesztő ablak
	let showForm = $state(false);
	let editingEntry = $state<WorkEntryRow | null>(null);
	let formDay = $state('');
	let formProjectId = $state<number | null>(null);
	let formCategoryId = $state<number | null>(null);
	let formHours = $state<number | null>(null);
	let formTitle = $state('');
	let saving = $state(false);

	// --- Dátum segédek (helyi idő szerint) ---

	function ymd(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function mondayOf(d: Date): string {
		const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
		day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
		return ymd(day);
	}

	function addDays(value: string, delta: number): string {
		const [y, m, d] = value.split('-').map(Number);
		return ymd(new Date(y, m - 1, d + delta));
	}

	const today = ymd(new Date());
	const days = $derived(Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)));
	const weekEnd = $derived(days[6]);
	const isCurrentWeek = $derived(weekStart === mondayOf(new Date()));

	function weekdayName(day: string): string {
		const [y, m, d] = day.split('-').map(Number);
		return new Date(y, m - 1, d).toLocaleDateString(appLocale(), { weekday: 'long' });
	}

	function isWeekend(index: number): boolean {
		return index >= 5;
	}

	function hoursLabel(hours: number): string {
		return t('quickLog.hours', { hours: formatNumber(hours, { maximumFractionDigits: 2 }) });
	}

	// --- Származtatott adatok ---

	const ownEmployeeId = $derived(options?.ownEmployeeId ?? null);
	const targetEmployeeId = $derived(options?.employeeId ?? null);
	const forOther = $derived(targetEmployeeId !== null && targetEmployeeId !== ownEmployeeId);
	const projects = $derived(options?.projects ?? []);
	const projectById = $derived(new Map(projects.map((p) => [p.id, p])));

	const entriesByDay = $derived.by(() => {
		const map = new Map<string, WorkEntryRow[]>();
		for (const e of entries) {
			const key = e.workDate.slice(0, 10);
			const list = map.get(key) ?? [];
			list.push(e);
			map.set(key, list);
		}
		return map;
	});

	function dayTotal(day: string): number {
		return (entriesByDay.get(day) ?? []).reduce((sum, e) => sum + e.hours, 0);
	}

	const weekTotal = $derived(entries.reduce((sum, e) => sum + e.hours, 0));

	const formProject = $derived<QuickEntryProject | null>(
		formProjectId !== null ? (projectById.get(formProjectId) ?? null) : null
	);
	const formCategories = $derived(formProject?.categories ?? []);
	/** Szerkesztésnél a bejegyzés azóta inaktivált kategóriája is választható marad. */
	const formInactiveCategory = $derived(
		editingEntry?.categoryId && !formCategories.some((c) => c.id === editingEntry!.categoryId)
			? { id: editingEntry.categoryId, name: editingEntry.categoryName ?? '' }
			: null
	);
	const categoryRequired = $derived(formCategories.length > 0);
	const beforeStart = $derived(!!formProject?.startDate && !!formDay && formDay < formProject.startDate);
	const hoursValid = $derived(formHours !== null && formHours >= 0.25 && formHours <= 24);
	const formValid = $derived(
		formProjectId !== null &&
			(!categoryRequired || formCategoryId !== null) &&
			hoursValid &&
			!!formDay &&
			!beforeStart
	);

	/** Az alapértelmezett kategória, vagy ha csak egy van, az az egy. */
	function preselectCategory(project: QuickEntryProject | null): number | null {
		if (!project) return null;
		if (project.defaultCategoryId) return project.defaultCategoryId;
		return project.categories.length === 1 ? project.categories[0].id : null;
	}

	/** Kategória és feladat; ha a feladat a kategória nevét kapta, csak egyszer. */
	function entryMeta(entry: WorkEntryRow): string {
		if (!entry.categoryName || entry.categoryName === entry.title) return entry.title;
		return `${entry.categoryName} · ${entry.title}`;
	}

	function canEdit(entry: WorkEntryRow): boolean {
		return projectById.has(entry.projectId);
	}

	// --- Betöltés ---

	async function loadOptions() {
		if (!currentOrganization || !sdk?.remote) return;
		try {
			options = (await sdk.remote.call('getQuickEntryOptions', {
				organizationId: currentOrganization.id,
				employeeId: selectedEmployeeId
			})) as QuickEntryOptions;
		} catch (err: any) {
			errorMsg = err?.message ?? t('error.loadFailed');
			options = null;
		}
	}

	async function loadEntries() {
		if (!currentOrganization || !sdk?.remote || !options || options.employeeId === null) {
			entries = [];
			return;
		}
		loading = true;
		try {
			const result = (await sdk.remote.call('listWorkEntries', {
				organizationId: currentOrganization.id,
				scope: forOther ? 'all' : 'mine',
				...(forOther ? { employeeId: options.employeeId } : {}),
				from: weekStart,
				to: weekEnd,
				pageSize: 500,
				sortBy: 'created_at',
				sortOrder: 'asc'
			})) as WorkEntryListResult;
			entries = result?.data ?? [];
		} catch (err: any) {
			errorMsg = err?.message ?? t('error.loadFailed');
			entries = [];
		} finally {
			loading = false;
		}
	}

	async function reloadAll() {
		errorMsg = null;
		loading = true;
		await loadOptions();
		await loadEntries();
		loading = false;
	}

	// --- Ablak ---

	function openCreate(day: string) {
		editingEntry = null;
		formDay = day;
		const onlyProject = projects.length === 1 ? projects[0] : null;
		formProjectId = onlyProject?.id ?? null;
		formCategoryId = preselectCategory(onlyProject);
		formHours = null;
		formTitle = '';
		showForm = true;
	}

	function openEdit(entry: WorkEntryRow) {
		if (!canEdit(entry)) return;
		editingEntry = entry;
		formDay = entry.workDate.slice(0, 10);
		formProjectId = entry.projectId;
		formCategoryId = entry.categoryId ?? null;
		formHours = entry.hours;
		formTitle = entry.title;
		showForm = true;
	}

	function onProjectChange() {
		formCategoryId = preselectCategory(formProject);
	}

	/** Ha a feladat üresen marad, a kategória (vagy a projekt) neve lesz a címe. */
	function resolvedTitle(): string {
		const typed = formTitle.trim();
		if (typed) return typed;
		const category = formCategories.find((c) => c.id === formCategoryId);
		return category?.name ?? formProject?.name ?? t('quickLog.defaultTitle');
	}

	async function submit() {
		if (!formValid || saving) return;
		saving = true;
		try {
			if (editingEntry) {
				await sdk.remote.call('updateWorkEntry', {
					id: editingEntry.id,
					categoryId: formCategoryId,
					title: resolvedTitle(),
					hours: Number(formHours),
					workDate: formDay
				});
			} else {
				await sdk.remote.call('createWorkEntry', {
					projectId: formProjectId,
					...(forOther ? { employeeId: targetEmployeeId } : {}),
					categoryId: formCategoryId,
					title: resolvedTitle(),
					hours: Number(formHours),
					workDate: formDay
				});
			}
			sdk?.ui?.toast?.(t('work.saveSuccess'), 'success');
			showForm = false;
			await loadEntries();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	async function remove(entry: WorkEntryRow) {
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('work.deleteConfirm'),
			message: t('quickLog.deleteMessage', {
				project: entry.projectName,
				hours: formatNumber(entry.hours, { maximumFractionDigits: 2 })
			}),
			confirmLabel: t('button.delete'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('deleteWorkEntry', { id: entry.id });
			sdk?.ui?.toast?.(t('work.deleteSuccess'), 'success');
			if (showForm) showForm = false;
			await loadEntries();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	// --- Inicializálás ---

	function syncFromStore(store: OrganizationStore) {
		currentOrganization = store.currentOrganization;
		hasAccess = store.hasAccess;
		canLog = store.can('work.log') || store.can('work.view.all');
	}

	onMount(async () => {
		if (!sdk?.remote) return;
		try {
			orgStore = getOrganizationStore();
		} catch {
			orgStore = createOrganizationStore(pluginId, sdk);
		}
		if (orgStore.availableOrganizations.length === 0) await orgStore.loadOrganizations();
		if (orgStore.currentOrganization) await orgStore.ensureCapabilities(orgStore.currentOrganization.id);
		syncFromStore(orgStore);
	});

	$effect(() => {
		const handleChange = () => {
			const store = (window as any).__racona_work_org_store__ as OrganizationStore | undefined;
			if (store) {
				selectedEmployeeId = null;
				syncFromStore(store);
			}
		};
		window.addEventListener('organization-changed', handleChange);
		window.addEventListener('plugin-capabilities-changed', handleChange);
		return () => {
			window.removeEventListener('organization-changed', handleChange);
			window.removeEventListener('plugin-capabilities-changed', handleChange);
		};
	});

	// Szervezet- vagy dolgozóváltás: választólisták és a hét újratöltése
	$effect(() => {
		currentOrganization;
		selectedEmployeeId;
		untrack(() => {
			if (currentOrganization && canLog) reloadAll();
		});
	});

	// Hétváltás: csak a bejegyzések
	$effect(() => {
		weekStart;
		untrack(() => {
			if (options) loadEntries();
		});
	});
</script>

<div class="rw">
	<section class="page">
		{#if !hasAccess || (currentOrganization && !canLog)}
			<AccessDenied />
		{:else}
			<div class="page-header">
				<div class="page-header-title">
					<h2>{t('quickLog.title')}</h2>
					<p class="subtitle">{t('quickLog.subtitle')}</p>
				</div>
			</div>

			<div class="toolbar">
				<div class="week-nav">
					<button class="btn-secondary nav-btn" onclick={() => (weekStart = addDays(weekStart, -7))} aria-label={t('quickLog.prevWeek')} title={t('quickLog.prevWeek')}>‹</button>
					<button class="btn-secondary" onclick={() => (weekStart = mondayOf(new Date()))} disabled={isCurrentWeek}>
						{t('quickLog.thisWeek')}
					</button>
					<button class="btn-secondary nav-btn" onclick={() => (weekStart = addDays(weekStart, 7))} aria-label={t('quickLog.nextWeek')} title={t('quickLog.nextWeek')}>›</button>
					<span class="week-range">{formatDate(weekStart)} – {formatDate(weekEnd)}</span>
				</div>
				<div class="toolbar-right">
					{#if options?.canChooseEmployee && options.employees.length > 0}
						<label class="employee-select">
							<span>{t('quickLog.employee')}</span>
							<select class="input" bind:value={selectedEmployeeId}>
								<option value={null}>{t('quickLog.employee.self')}</option>
								{#each options.employees.filter((e) => e.id !== ownEmployeeId) as emp (emp.id)}
									<option value={emp.id}>{emp.name}</option>
								{/each}
							</select>
						</label>
					{/if}
					<span class="week-total">{t('quickLog.weekTotal')}: <strong>{hoursLabel(weekTotal)}</strong></span>
				</div>
			</div>

			{#if errorMsg}
				<div class="error-banner"><p>{errorMsg}</p><button onclick={() => (errorMsg = null)}>✕</button></div>
			{/if}

			{#if options && options.employeeId === null}
				<p class="empty-state">{t('quickLog.notEmployee')}</p>
			{:else}
				{#if options && projects.length === 0}
					<p class="hint">{forOther ? t('quickLog.noProjects.other') : t('quickLog.noProjects')}</p>
				{/if}
				<div class="week-grid" class:loading>
					{#each days as day, index (day)}
						{@const dayEntries = entriesByDay.get(day) ?? []}
						<div class="day-card" class:today={day === today} class:weekend={isWeekend(index)}>
							<div class="day-header">
								<div>
									<div class="day-name">{weekdayName(day)}</div>
									<div class="day-date">{formatDate(day)}</div>
								</div>
								{#if dayEntries.length > 0}
									<span class="day-total">{hoursLabel(dayTotal(day))}</span>
								{/if}
							</div>
							<ul class="entry-list">
								{#each dayEntries as entry (entry.id)}
									<li class="entry" class:locked={!canEdit(entry)}>
										<button
											class="entry-main"
											onclick={() => openEdit(entry)}
											disabled={!canEdit(entry)}
											title={canEdit(entry) ? t('quickLog.edit') : t('quickLog.locked')}
										>
											<span class="entry-project">{entry.projectName}</span>
											<span class="entry-meta">{entryMeta(entry)}</span>
										</button>
										<span class="entry-hours">{hoursLabel(entry.hours)}</span>
										{#if canEdit(entry)}
											<button class="remove-btn" title={t('button.delete')} aria-label={t('button.delete')} onclick={() => remove(entry)}>✕</button>
										{/if}
									</li>
								{/each}
							</ul>
							<button class="add-btn" onclick={() => openCreate(day)} disabled={projects.length === 0}>
								+ {t('quickLog.add')}
							</button>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</section>
</div>

{#if showForm}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (showForm = false)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{editingEntry ? t('quickLog.form.editTitle') : t('quickLog.form.title')}</h3>
				<button class="icon-btn" onclick={() => (showForm = false)}>✕</button>
			</div>
			<div class="modal-body">
				{#if forOther}
					<p class="for-other">
						{t('quickLog.form.forEmployee', {
							name: options?.employees.find((e) => e.id === targetEmployeeId)?.name ?? ''
						})}
					</p>
				{/if}
				<label>
					<span>{t('quickLog.form.day')} *</span>
					<input class="input date-input" type="date" min={formProject?.startDate || undefined} bind:value={formDay} />
					{#if beforeStart && formProject?.startDate}
						<small class="field-error">{t('work.form.beforeStart', { date: formatDate(formProject.startDate) })}</small>
					{/if}
				</label>
				<label>
					<span>{t('quickLog.form.project')} *</span>
					<select class="input" bind:value={formProjectId} onchange={onProjectChange} disabled={!!editingEntry}>
						<option value={null} disabled>{t('quickLog.form.selectProject')}</option>
						{#each projects as project (project.id)}
							<option value={project.id}>{project.name}</option>
						{/each}
					</select>
				</label>
				{#if categoryRequired || formInactiveCategory}
					<label>
						<span>{t('work.form.category')}{categoryRequired ? ' *' : ''}</span>
						<select class="input" bind:value={formCategoryId}>
							<option value={null} disabled={categoryRequired}>{t('work.form.category.none')}</option>
							{#each formCategories as category (category.id)}
								<option value={category.id}>
									{category.name}{category.id === formProject?.defaultCategoryId ? ` (${t('quickLog.form.default')})` : ''}
								</option>
							{/each}
							{#if formInactiveCategory}
								<option value={formInactiveCategory.id}>
									{formInactiveCategory.name} ({t('work.form.category.inactive')})
								</option>
							{/if}
						</select>
					</label>
				{/if}
				<label>
					<span>{t('work.form.hours')} *</span>
					<input
						class="input"
						type="number"
						min="0.25"
						max="24"
						step="0.25"
						bind:value={formHours}
						onkeydown={(e) => e.key === 'Enter' && submit()}
					/>
				</label>
				<label>
					<span>{t('quickLog.form.task')}</span>
					<input
						class="input"
						type="text"
						maxlength="255"
						bind:value={formTitle}
						placeholder={t('quickLog.form.taskPlaceholder')}
						onkeydown={(e) => e.key === 'Enter' && submit()}
					/>
				</label>
			</div>
			<div class="modal-footer">
				{#if editingEntry}
					<button class="btn-danger" onclick={() => remove(editingEntry!)} disabled={saving}>{t('button.delete')}</button>
					<div style="flex: 1;"></div>
				{/if}
				<button class="btn-secondary" onclick={() => (showForm = false)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submit} disabled={!formValid || saving}>
					{saving ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../styles/shared.css';

	.page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.week-nav,
	.toolbar-right {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.nav-btn {
		min-width: 2.25rem;
		font-size: 1.1rem;
		line-height: 1;
	}

	.week-range {
		font-weight: 600;
		font-size: 0.9rem;
		margin-left: 0.25rem;
	}

	.employee-select {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.employee-select .input {
		width: auto;
		min-width: 12rem;
	}

	.week-total {
		font-size: 0.85rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.week-total strong {
		color: var(--color-foreground, #0f172a);
	}

	.hint {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.week-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
		gap: 0.75rem;
		transition: opacity 0.15s;
	}

	.week-grid.loading {
		opacity: 0.6;
	}

	.day-card {
		background: var(--color-card, #fff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-height: 9rem;
	}

	.day-card.weekend {
		background: var(--color-muted, #f8fafc);
	}

	.day-card.today {
		border-color: var(--color-primary, #3730a3);
		box-shadow: 0 0 0 1px var(--color-primary, #3730a3);
	}

	.day-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.day-name {
		font-weight: 600;
		font-size: 0.9rem;
		text-transform: capitalize;
	}

	.day-date {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.day-total {
		font-size: 0.75rem;
		font-weight: 600;
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		background: var(--color-primary-subtle, #eef2ff);
		color: var(--color-primary, #3730a3);
		white-space: nowrap;
	}

	.entry-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		border-radius: 0.375rem;
		padding: 0.25rem 0.25rem 0.25rem 0.375rem;
	}

	.entry:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.entry-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		background: transparent;
		border: none;
		padding: 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
	}

	.entry-main:disabled {
		cursor: default;
	}

	.entry-project {
		font-size: 0.8rem;
		font-weight: 500;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.entry-meta {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #64748b);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.entry-hours {
		font-size: 0.75rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.entry.locked .entry-project {
		color: var(--color-muted-foreground, #64748b);
	}

	.add-btn {
		background: transparent;
		border: 1px dashed var(--color-border, #cbd5e1);
		border-radius: 0.5rem;
		padding: 0.4rem;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
		cursor: pointer;
	}

	.add-btn:hover:not(:disabled) {
		background: var(--color-primary-subtle, #eef2ff);
		border-color: var(--color-primary, #3730a3);
	}

	.add-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.for-other {
		margin: 0;
		font-size: 0.85rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-primary-subtle, #eef2ff);
		color: var(--color-primary, #3730a3);
	}

	.field-error {
		color: #dc2626;
		font-size: 0.75rem;
	}

	:global(.dark) .day-card {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .day-card.weekend {
		background: oklch(0.18 0 0);
	}

	:global(.dark) .entry:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .day-total,
	:global(.dark) .for-other {
		background: rgba(99, 102, 241, 0.2);
		color: #c7d2fe;
	}
</style>
