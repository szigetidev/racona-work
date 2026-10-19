<!--
	ProjectDetail — Munkanapló fül

	Saját állapotában tartja a szűrőket, a bejegyzés-listát és a felviteli
	modalt. A fejléc badge-éhez a betöltött bejegyzések számát a szülőnek is
	visszaadja (`entryCount`, bindable).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		ProjectRow,
		ProjectMemberRow,
		WorkEntryRow,
		WorkEntryListResult,
		WorkEntryCategory
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { appLocale, formatDate } from '../../utils/format.js';

	let {
		pluginId = 'racona-work',
		projectId,
		project,
		members,
		canViewAllWork = false,
		closed = false,
		entryCount = $bindable(0)
	}: {
		pluginId?: string;
		projectId: number;
		project: ProjectRow;
		members: ProjectMemberRow[];
		canViewAllWork?: boolean;
		/** Lezárt projekt: nincs felvitel, szerkesztés, törlés. */
		closed?: boolean;
		entryCount?: number;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	/** A core által megosztott DatePicker; ha nincs, natív date inputra esünk vissza. */
	const DatePickerComponent = $derived((sdk as any)?.components?.DatePicker ?? null);
	/** A dátumválasztó nyelve a felület nyelvét követi. */
	const dateLocale = $derived(appLocale());

	/** A projekt kezdő dátuma (YYYY-MM-DD): ennél korábbi nap nem rögzíthető. */
	const projectStart = $derived(toYmd(project.startDate));

	function toYmd(raw: string | null): string {
		if (!raw) return '';
		if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
		const d = new Date(raw);
		if (isNaN(d.getTime())) return '';
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	// Szűrők
	let workScope = $state<'mine' | 'all'>('mine');
	let workFrom = $state('');
	let workTo = $state('');
	let workFilterEmployeeId = $state<number | null>(null);

	// Lista
	let workEntries = $state<WorkEntryRow[]>([]);
	let workTotalHours = $state(0);
	let workLoading = $state(false);
	let workCategories = $state<WorkEntryCategory[]>([]);

	// Új/edit bejegyzés modal
	let showWorkForm = $state(false);
	let workFormMode = $state<'create' | 'edit'>('create');
	let workEditId = $state<number | null>(null);
	let workTitle = $state('');
	let workDescription = $state('');
	let workHours = $state<number>(1);
	let workWorkDate = $state(new Date().toISOString().slice(0, 10));
	let workForEmployeeId = $state<number | null>(null);
	let workCategoryId = $state<number | null>(null);
	let workSaving = $state(false);
	/** Szerkesztéskor a bejegyzés azóta inaktivált kategóriája, hogy megtartható legyen. */
	let workInactiveCategory = $state<{ id: number; name: string } | null>(null);

	/** A projekt saját kategóriái; ha nincs egy sem, a kategória nem kötelező. */
	const categoryRequired = $derived(workCategories.length > 0);
	const showCategorySelect = $derived(categoryRequired || workInactiveCategory !== null);

	/** `employeeId`: akinek az alapértelmezett kategóriáját jelölje (null: a hívóé). */
	async function loadWorkCategories(employeeId: number | null = null) {
		if (!projectId || !sdk?.remote) return;
		try {
			const result = (await sdk.remote.call('getWorkEntryCategories', {
				projectId,
				employeeId
			})) as WorkEntryCategory[];
			workCategories = Array.isArray(result) ? result : [];
		} catch {
			workCategories = [];
		}
	}

	async function loadWorkEntries() {
		if (!projectId || !sdk?.remote) return;
		workLoading = true;
		try {
			const scope: 'mine' | 'all' = canViewAllWork ? workScope : 'mine';
			const result = (await sdk.remote.call('listWorkEntries', {
				projectId,
				scope,
				pageSize: 200,
				sortBy: 'work_date',
				sortOrder: 'desc',
				...(workFrom ? { from: workFrom } : {}),
				...(workTo ? { to: workTo } : {}),
				...(canViewAllWork && workFilterEmployeeId ? { employeeId: workFilterEmployeeId } : {})
			})) as WorkEntryListResult;
			workEntries = result?.data ?? [];
			workTotalHours = result?.totalHours ?? 0;
		} catch (err: any) {
			console.warn('[WorkLogTab] loadWorkEntries hiba:', err);
			workEntries = [];
			workTotalHours = 0;
		} finally {
			workLoading = false;
			entryCount = workEntries.length;
		}
	}

	function openCreateWorkEntry() {
		workFormMode = 'create';
		workEditId = null;
		workTitle = '';
		workDescription = '';
		workHours = 1;
		workWorkDate = new Date().toISOString().slice(0, 10);
		workForEmployeeId = null; // saját magam
		workCategoryId = null;
		workInactiveCategory = null;
		showWorkForm = true;
		loadWorkCategories().then(preselectDefaultCategory);
	}

	/** Új bejegyzésnél: a dolgozó alapértelmezett kategóriája, vagy ha csak egy van, az az egy. */
	function preselectDefaultCategory() {
		workCategoryId =
			workCategories.find((c) => c.isDefault)?.id ??
			(workCategories.length === 1 ? workCategories[0].id : null);
	}

	function onForEmployeeChange() {
		loadWorkCategories(workForEmployeeId).then(preselectDefaultCategory);
	}

	function openEditWorkEntry(entry: WorkEntryRow) {
		workFormMode = 'edit';
		workEditId = entry.id;
		workTitle = entry.title;
		workDescription = entry.description ?? '';
		workHours = entry.hours;
		workWorkDate = entry.workDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
		workForEmployeeId = entry.employeeId;
		workCategoryId = entry.categoryId ?? null;
		workInactiveCategory = null;
		showWorkForm = true;
		loadWorkCategories().then(() => {
			if (entry.categoryId && !workCategories.some((c) => c.id === entry.categoryId)) {
				workInactiveCategory = { id: entry.categoryId, name: entry.categoryName ?? '' };
			}
		});
	}

	async function submitWorkEntry() {
		if (!workTitle.trim()) {
			sdk?.ui?.toast?.(t('work.form.title') + ': ' + t('form.required'), 'error');
			return;
		}
		if (categoryRequired && !workCategoryId) {
			sdk?.ui?.toast?.(t('work.form.category') + ': ' + t('form.required'), 'error');
			return;
		}
		if (projectStart && workWorkDate < projectStart) {
			sdk?.ui?.toast?.(
				t('work.form.beforeStart', {
					date: formatDate(projectStart)
				}),
				'error'
			);
			return;
		}
		workSaving = true;
		try {
			if (workFormMode === 'edit' && workEditId !== null) {
				await sdk.remote.call('updateWorkEntry', {
					id: workEditId,
					categoryId: workCategoryId,
					title: workTitle.trim(),
					description: workDescription.trim() || null,
					hours: Number(workHours),
					workDate: workWorkDate
				});
			} else {
				await sdk.remote.call('createWorkEntry', {
					projectId: project.id,
					employeeId: workForEmployeeId ?? undefined,
					categoryId: workCategoryId,
					title: workTitle.trim(),
					description: workDescription.trim() || undefined,
					hours: Number(workHours),
					workDate: workWorkDate
				});
			}
			sdk?.ui?.toast?.(t('work.saveSuccess'), 'success');
			showWorkForm = false;
			await loadWorkEntries();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			workSaving = false;
		}
	}

	async function handleDeleteWorkEntry(entry: WorkEntryRow) {
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('work.deleteConfirm'),
			message: t('work.deleteConfirm'),
			confirmLabel: t('work.deleteConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('deleteWorkEntry', { id: entry.id });
			sdk?.ui?.toast?.(t('work.deleteSuccess'), 'success');
			await loadWorkEntries();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	// Szűrő- vagy projektváltás → újratöltés (mountkor is lefut).
	$effect(() => {
		projectId;
		workScope;
		workFrom;
		workTo;
		workFilterEmployeeId;
		untrack(() => {
			if (projectId && sdk?.remote) loadWorkEntries();
		});
	});

	$effect(() => {
		projectId;
		untrack(() => loadWorkCategories());
	});
</script>

<div class="section-header">
	<div>
		<h3>{t('work.title')}</h3>
		<p class="perm-hint">
			{t('work.totalHours', { hours: workTotalHours.toFixed(2) })}
		</p>
	</div>
	<div class="header-actions">
		{#if canViewAllWork}
			<div class="view-toggle">
				<button
					class="chip"
					class:active={workScope === 'mine'}
					onclick={() => (workScope = 'mine')}
				>
					{t('work.scope.mine')}
				</button>
				<button
					class="chip"
					class:active={workScope === 'all'}
					onclick={() => (workScope = 'all')}
				>
					{t('work.scope.all')}
				</button>
			</div>
		{/if}
		{#if !closed}
			<button class="btn-primary" onclick={openCreateWorkEntry}>
				+ {t('work.newEntry')}
			</button>
		{/if}
	</div>
</div>

{#if closed}
	<div class="closed-notice"><svg class="lock-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> {t('work.closedNotice')}</div>
{/if}

<!-- Intervallum szűrő -->
<div class="date-filter-bar">
	<div class="date-filter-picker">
		{#if DatePickerComponent}
			<DatePickerComponent bind:value={workFrom} locale={dateLocale} placeholder={t('filter.datePlaceholder')} />
		{:else}
			<input class="input input-sm" type="date" bind:value={workFrom} />
		{/if}
	</div>
	<span class="date-filter-label">{t('filter.from')}</span>
	<div class="date-filter-picker">
		{#if DatePickerComponent}
			<DatePickerComponent bind:value={workTo} locale={dateLocale} placeholder={t('filter.datePlaceholder')} />
		{:else}
			<input class="input input-sm" type="date" bind:value={workTo} />
		{/if}
	</div>
	<span class="date-filter-label">{t('filter.to')}</span>
	{#if canViewAllWork && members.length > 0}
		<select class="input input-sm work-emp-filter" bind:value={workFilterEmployeeId}>
			<option value={null}>{t('work.filter.allEmployees')}</option>
			{#each members as m (m.employeeId)}
				<option value={m.employeeId}>{m.userName}</option>
			{/each}
		</select>
	{/if}
	{#if workFrom || workTo || workFilterEmployeeId}
		<button
			class="btn-ghost-sm"
			onclick={() => { workFrom = ''; workTo = ''; workFilterEmployeeId = null; }}
			title={t('filter.clear')}
		>
			✕ {t('filter.clear')}
		</button>
	{/if}
</div>

{#if workLoading}
	<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
{:else if workEntries.length === 0}
	<p class="empty-state">
		{workScope === 'mine' ? t('work.emptyMine') : t('work.empty')}
	</p>
{:else}
	<div class="entries-list">
		{#each workEntries as entry (entry.id)}
			<div class="entry-row">
				<div class="entry-date">
					{formatDate(entry.workDate)}
				</div>
				<div class="entry-main">
					{#if entry.categoryName}
						<div class="entry-category">{entry.categoryName}</div>
					{/if}
					<div class="entry-title">{entry.title}</div>
					{#if entry.description}
						<div class="entry-desc">{entry.description}</div>
					{/if}
					{#if workScope === 'all'}
						<div class="entry-meta">{entry.employeeName}</div>
					{/if}
				</div>
				<div class="entry-hours">{entry.hours.toFixed(2)} {t('work.columns.hours').toLowerCase()}</div>
				{#if !closed}
				<div class="entry-actions">
					<button
						class="icon-btn"
						title={t('projects.detail.edit')}
						onclick={() => openEditWorkEntry(entry)}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
					</button>
					<button
						class="icon-btn danger"
						title={t('work.deleteConfirm')}
						onclick={() => handleDeleteWorkEntry(entry)}
					>
						<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>
					</button>
				</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<!-- Munkabejegyzés modal (új / szerkesztés) -->
{#if showWorkForm}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (showWorkForm = false)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{workFormMode === 'edit' ? t('projects.detail.edit') : t('work.newEntry')}</h3>
				<button class="icon-btn" onclick={() => (showWorkForm = false)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('work.form.title')} *</span>
					<input class="input" type="text" bind:value={workTitle} />
				</label>
				{#if showCategorySelect}
					<label>
						<span>{t('work.form.category')}{categoryRequired ? ' *' : ''}</span>
						<select class="input" bind:value={workCategoryId}>
							<option value={null} disabled={categoryRequired}>{t('work.form.category.none')}</option>
							{#each workCategories as cat (cat.id)}
								<option value={cat.id}>{cat.name}</option>
							{/each}
							{#if workInactiveCategory}
								<option value={workInactiveCategory.id}>
									{workInactiveCategory.name} ({t('work.form.category.inactive')})
								</option>
							{/if}
						</select>
					</label>
				{/if}
				<label>
					<span>{t('work.form.description')}</span>
					<textarea class="input textarea" rows="2" bind:value={workDescription}></textarea>
				</label>
				<div class="form-row-2">
					<label>
						<span>{t('work.form.workDate')} *</span>
						<input
							class="input date-input"
							type="date"
							min={projectStart || undefined}
							bind:value={workWorkDate}
						/>
					</label>
					<label>
						<span>{t('work.form.hours')} *</span>
						<input
							class="input"
							type="number"
							min="0.25"
							max="24"
							step="0.25"
							bind:value={workHours}
						/>
					</label>
				</div>
				{#if workFormMode === 'create' && canViewAllWork && members.length > 1}
					<label>
						<span>{t('work.form.forEmployee')}</span>
						<select class="input" bind:value={workForEmployeeId} onchange={onForEmployeeChange}>
							<option value={null}>{t('work.form.forEmployee.self')}</option>
							{#each members as m (m.employeeId)}
								<option value={m.employeeId}>{m.userName} — {m.userEmail}</option>
							{/each}
						</select>
					</label>
				{/if}
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showWorkForm = false)}>
					{t('form.cancel')}
				</button>
				<button
					class="btn-primary"
					onclick={submitWorkEntry}
					disabled={workSaving || !workTitle.trim() || (categoryRequired && !workCategoryId)}
				>
					{workSaving ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	/* ---------- Lezárt projekt ---------- */
	.closed-notice {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid #fecaca;
		background: #fef2f2;
		color: #991b1b;
		border-radius: 0.5rem;
		font-size: 0.85rem;
	}

	:global(.dark) .closed-notice {
		background: rgba(220, 38, 38, 0.1);
		border-color: rgba(220, 38, 38, 0.3);
		color: #fca5a5;
	}

	/* ---------- Intervallum szűrő ---------- */
	.date-filter-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: nowrap;
		padding: 0.5rem 0.75rem;
		background: var(--color-muted, #f8fafc);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		overflow-x: auto;
	}

	.date-filter-label {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		font-weight: 500;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.date-filter-picker {
		width: 9rem;
		flex-shrink: 0;
	}

	.input-sm {
		padding: 0.25rem 0.5rem;
		font-size: 0.8rem;
		height: auto;
	}

	.work-emp-filter {
		min-width: 8rem;
		max-width: 13rem;
		margin-left: 0.5rem;
		flex-shrink: 0;
	}

	.btn-ghost-sm {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		color: var(--color-muted-foreground, #64748b);
		padding: 0.25rem 0.625rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.75rem;
		margin-left: auto;
		white-space: nowrap;
		flex-shrink: 0;
		transition: background 0.15s, color 0.15s;
	}

	.btn-ghost-sm:hover {
		background: var(--color-accent, #f1f5f9);
		color: var(--color-foreground, #0f172a);
	}

	:global(.dark) .date-filter-bar {
		background: oklch(0.18 0 0);
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .btn-ghost-sm:hover {
		background: var(--color-accent, oklch(0.269 0 0));
		color: oklch(0.985 0 0);
	}

	/* ---------- Permissions fül ---------- */
	.perm-hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		margin: 0.25rem 0 0;
		max-width: 520px;
	}

	/* ---------- Munkanapló ---------- */
	.header-actions {
		display: flex;
		gap: 0.75rem;
		align-items: center;
	}

	.entries-list {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.entry-row {
		display: grid;
		grid-template-columns: 100px 1fr auto auto;
		gap: 0.75rem;
		align-items: start;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-card, #ffffff);
	}

	.entry-date {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
	}

	.entry-main {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.entry-title {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.entry-desc {
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.entry-category {
		display: inline-block;
		align-self: flex-start;
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--color-primary, #3730a3);
		background: color-mix(in srgb, var(--color-primary, #3730a3) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-primary, #3730a3) 25%, transparent);
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
		margin-top: 0.15rem;
	}

	:global(.dark) .entry-category {
		color: oklch(0.75 0.12 264);
		background: oklch(0.75 0.12 264 / 12%);
		border-color: oklch(0.75 0.12 264 / 30%);
	}

	.entry-meta {
		font-size: 0.7rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.entry-hours {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--color-primary, #3730a3);
		white-space: nowrap;
		align-self: center;
	}

	.entry-actions {
		display: flex;
		gap: 0.25rem;
		align-self: center;
	}

	.entry-actions .icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem;
	}

	.icon-btn.danger:hover {
		background: #fee2e2;
		color: #dc2626;
	}

	.form-row-2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	/* Natív date input — visszaadjuk a böngésző gyári naptár ikonját */
	.date-input {
		appearance: auto;
		-webkit-appearance: auto;
	}

	.date-input::-webkit-calendar-picker-indicator {
		display: block;
		cursor: pointer;
		opacity: 0.7;
	}

	.date-input::-webkit-calendar-picker-indicator:hover {
		opacity: 1;
	}

	:global(.dark) .entry-row {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	/* Sötét mód: a világos státuszszínek sötét párjai */
	:global(.dark) .icon-btn.danger:hover {
		background: var(--rw-dark-danger-bg);
		color: var(--rw-dark-danger-fg);
	}
</style>
