<svelte:options customElement={{ tag: 'racona-work-project-detail', shadow: 'none' }} />

<script module>
	if (typeof window !== 'undefined') {
		(window as any).racona_work_Component_ProjectDetail = function () {
			return { tagName: 'racona-work-project-detail' };
		};
	}
</script>

<!--
	Projekt adatlap — váz.

	Ez a komponens csak a keretet adja: jogosultságok, projekt/tag/szerep
	betöltés, fejléc, fülek és a törlés. A fülek tartalma külön komponensekben
	él a `project-detail/` mappában:

	  - OverviewTab     — adatlap + szerkesztő űrlap
	  - MembersTab      — tagok listája + hozzáadás modal
	  - WorkLogTab      — munkanapló (saját szűrők, felviteli modal)
	  - ReportTab       — aggregált riport + CSV export (önállóan tölt)
	  - CategoriesTab   — a projekt saját munkabejegyzés-kategóriái (önállóan tölt)

	Az a lista, amit a fejléc badge-e is használ (tagok), itt marad; a fülek
	`onChanged`-del kérnek újratöltést.

	A kezelési és lezárási jog a szervezeti szerepből vagy projektvezetőként
	jöhet (specs/project-lead.md); az utóbbit a getProject `access` mezője adja.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {} from '@racona/sdk/types';
	import {
		getOrganizationStore,
		createOrganizationStore
	} from '../stores/organizationStore.svelte.js';
	import type { OrganizationStore } from '../stores/organizationStore.svelte.js';
	import type {
		Organization,
		ProjectRow,
		ProjectDetailRow,
		ProjectAccess,
		ProjectMemberRow,
		EmployeeRow,
		PaginatedResult,
		WorkEntryListResult
	} from '../../server/functions.js';
	import AccessDenied from './AccessDenied.svelte';
	import OverviewTab from './project-detail/OverviewTab.svelte';
	import MembersTab from './project-detail/MembersTab.svelte';
	import WorkLogTab from './project-detail/WorkLogTab.svelte';
	import ReportTab from './project-detail/ReportTab.svelte';
	import CategoriesTab from './project-detail/CategoriesTab.svelte';
	import { resolveSdk, translate } from '../utils/sdk.js';
	import { formatDateTime } from '../utils/format.js';

	let { pluginId = 'racona-work', projectId }: { pluginId?: string; projectId: number } =
		$props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let orgStore = $state<OrganizationStore | null>(null);
	let currentOrganization = $state<Organization | null>(null);
	let hasAccess = $state(false);
	// Szervezeti szerepből
	let orgCanManage = $state(false);
	let orgCanClose = $state(false);
	let orgCanViewAllWork = $state(false);
	let canLogWork = $state(false);
	// Ezen a projekten (szervezeti szerep vagy projektvezetés)
	let projectAccess = $state<ProjectAccess>({ manage: false, close: false });

	let canManage = $derived(orgCanManage || projectAccess.manage);
	let canClose = $derived(orgCanClose || projectAccess.close);
	let canViewAllWork = $derived(orgCanViewAllWork || canManage);

	// Csak akkor látható a riport fül, ha van jog hozzá.
	let canViewReport = $derived(canViewAllWork);

	type Tab = 'overview' | 'members' | 'work' | 'report' | 'categories' | 'settings';
	let activeTab = $state<Tab>('overview');

	// Projekt adatok
	let project = $state<ProjectRow | null>(null);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let editMode = $state(false);

	// Tagok
	let members = $state<ProjectMemberRow[]>([]);
	let membersLoading = $state(false);
	let orgEmployees = $state<EmployeeRow[]>([]);

	// Munkanapló bejegyzések száma a fül badge-éhez. A fül mountolásakor a
	// WorkLogTab írja (bind), előtte egy könnyű darabszám-kéréssel töltjük.
	let workEntryCount = $state(0);

	async function loadProject() {
		if (!projectId || !sdk?.remote) return;
		loading = true;
		loadError = null;
		try {
			const result = (await sdk.remote.call('getProject', { id: projectId })) as ProjectDetailRow;
			project = result;
			projectAccess = result.access ?? { manage: false, close: false };
		} catch (err: any) {
			loadError = err?.message ?? t('error.loadFailed');
			project = null;
			projectAccess = { manage: false, close: false };
		} finally {
			loading = false;
		}
	}

	async function loadMembers() {
		if (!projectId || !sdk?.remote) return;
		membersLoading = true;
		try {
			const result = (await sdk.remote.call('listProjectMembers', {
				projectId
			})) as ProjectMemberRow[];
			members = Array.isArray(result) ? result : [];
		} catch {
			members = [];
		} finally {
			membersLoading = false;
		}
	}

	async function loadOrgEmployees() {
		if (!currentOrganization || !sdk?.remote) return;
		try {
			const result = (await sdk.remote.call('getEmployees', {
				organizationId: currentOrganization.id,
				pageSize: 500,
				status: 'active',
				// A külsősök is a projekt tagjai lehetnek
				includeExternal: true
			})) as PaginatedResult<EmployeeRow>;
			orgEmployees = result?.data ?? [];
		} catch {
			orgEmployees = [];
		}
	}

	/** Csak a badge-hez: a saját bejegyzések darabszáma, lista nélkül. */
	async function loadWorkEntryCount() {
		if (!projectId || !sdk?.remote) return;
		try {
			const result = (await sdk.remote.call('listWorkEntries', {
				projectId,
				scope: 'mine',
				pageSize: 1
			})) as WorkEntryListResult;
			workEntryCount = result?.pagination?.totalCount ?? 0;
		} catch {
			workEntryCount = 0;
		}
	}

	function handleBack() {
		sdk?.ui?.navigateTo?.('ProjectList', {});
	}

	async function handleDelete() {
		if (!project) return;
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('projects.detail.delete'),
			message: t('projects.detail.deleteConfirm'),
			confirmLabel: t('projects.detail.delete'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('deleteProject', { id: project.id });
			sdk?.ui?.toast?.(t('projects.detail.deleteSuccess'), 'success');
			sdk?.ui?.navigateTo?.('ProjectList', {});
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}

	// Lezárás / visszanyitás
	let closingBusy = $state(false);

	let closedInfo = $derived(
		project?.closedAt
			? t('projects.closedInfo', {
					name: project.closedByName ?? '—',
					date: formatDateTime(project.closedAt)
				})
			: ''
	);

	async function setClosed(close: boolean) {
		if (!project) return;
		const prefix = close ? 'projects.detail.close' : 'projects.detail.reopen';
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t(`${prefix}.title`),
			message: t(`${prefix}.confirm`),
			confirmLabel: t(`${prefix}.button`)
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		closingBusy = true;
		try {
			project = (await sdk.remote.call(close ? 'closeProject' : 'reopenProject', {
				id: project.id
			})) as ProjectRow;
			// Lezárt projekt adatai nem szerkeszthetők
			if (close) editMode = false;
			sdk?.ui?.toast?.(t(`${prefix}.success`), 'success');
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			closingBusy = false;
		}
	}

	/** Tagváltozás után a projekt is újratöltődik (memberCount a fejlécben). */
	async function reloadMembers() {
		await Promise.all([loadMembers(), loadProject()]);
	}

	function syncCapabilities(store: OrganizationStore) {
		orgCanManage = store.can('project.manage');
		orgCanClose = store.can('project.close');
		canLogWork = store.can('work.log');
		orgCanViewAllWork = store.can('work.view.all');
	}

	onMount(async () => {
		if (sdk?.remote) {
			try {
				orgStore = getOrganizationStore();
			} catch {
				orgStore = createOrganizationStore(pluginId, sdk);
			}

			currentOrganization = orgStore.currentOrganization;
			hasAccess = orgStore.hasAccess;
			syncCapabilities(orgStore);

			if (orgStore.availableOrganizations.length === 0) {
				await orgStore.loadOrganizations();
				currentOrganization = orgStore.currentOrganization;
				hasAccess = orgStore.hasAccess;
			}

			// Biztosítjuk, hogy a capabilities friss legyen az aktuális szervezetre.
			// A store életciklus-problémája miatt előfordulhat, hogy a halmaz üres,
			// amikor a ProjectDetail mount-ol.
			if (currentOrganization) {
				await orgStore.ensureCapabilities(currentOrganization.id);
				syncCapabilities(orgStore);
			}
		}

		await loadProject();
		await loadMembers();
		await loadOrgEmployees();
		await loadWorkEntryCount();
	});

	// plugin-capabilities-changed: ha a store capabilities halmaza frissül
	// (pl. szervezet-váltás utáni backend-válasz), itt is szinkronizálunk.
	$effect(() => {
		const handleCaps = () => {
			if (!orgStore) return;
			syncCapabilities(orgStore);
		};
		window.addEventListener('plugin-capabilities-changed', handleCaps);
		return () => window.removeEventListener('plugin-capabilities-changed', handleCaps);
	});

	$effect(() => {
		const handleOrgChange = () => {
			const store = (window as any).__racona_work_org_store__ as OrganizationStore | undefined;
			if (store) {
				currentOrganization = store.currentOrganization;
				hasAccess = store.hasAccess;
				syncCapabilities(store);
			}
		};
		window.addEventListener('organization-changed', handleOrgChange);
		return () => window.removeEventListener('organization-changed', handleOrgChange);
	});

	// Ha projectId prop változik, újratöltjük
	$effect(() => {
		projectId;
		untrack(() => {
			if (projectId && sdk?.remote) {
				editMode = false;
				loadProject();
				loadMembers();
				loadWorkEntryCount();
			}
		});
	});

	let availableToAdd = $derived.by(() => {
		const existing = new Set(members.map((m) => m.employeeId));
		return orgEmployees.filter((e) => !existing.has(e.id));
	});
</script>

<div class="rw">
<section class="page">
	{#if !hasAccess}
		<AccessDenied />
	{:else}
		<div class="page-header">
			<button class="btn-back" onclick={handleBack}>← {t('projects.detail.back')}</button>
		</div>

		{#if loading}
			<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
		{:else if loadError || !project}
			<div class="error-banner">{loadError ?? t('error.loadFailed')}</div>
		{:else}
			<div class="title-row">
				<div>
					<h2>{project.name}</h2>
					<span class="status status-{project.status}">
						{t(`projects.status.${project.status}`)}
					</span>
					{#if project.closedAt}
						<span class="status status-closed" title={closedInfo}><svg class="lock-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> {t('projects.closed')}</span>
					{/if}
				</div>
				{#if canManage}
					<div class="title-actions">
						{#if !editMode && activeTab === 'overview' && !project.closedAt}
							<button class="btn-primary" onclick={() => (editMode = true)}>
								{t('projects.detail.edit')}
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<div class="tabs">
				<button
					class="tab"
					class:active={activeTab === 'overview'}
					onclick={() => (activeTab = 'overview')}
				>
					{t('projects.detail.tabs.overview')}
				</button>
				<button
					class="tab"
					class:active={activeTab === 'members'}
					onclick={() => (activeTab = 'members')}
				>
					{t('projects.detail.tabs.members')}
					<span class="tab-badge">{project.memberCount}</span>
				</button>
				{#if canLogWork}
					<button
						class="tab"
						class:active={activeTab === 'work'}
						onclick={() => (activeTab = 'work')}
					>
						{t('projects.detail.tabs.work')}
						{#if workEntryCount > 0}
							<span class="tab-badge">{workEntryCount}</span>
						{/if}
					</button>
				{/if}
				{#if canViewReport}
					<button
						class="tab"
						class:active={activeTab === 'report'}
						onclick={() => (activeTab = 'report')}
					>
						{t('projects.detail.tabs.report')}
					</button>
				{/if}
				{#if canManage}
					<button
						class="tab"
						class:active={activeTab === 'categories'}
						onclick={() => (activeTab = 'categories')}
					>
						{t('projects.detail.tabs.categories')}
					</button>
				{/if}
				{#if canManage || canClose}
					<button
						class="tab"
						class:active={activeTab === 'settings'}
						onclick={() => (activeTab = 'settings')}
					>
						{t('projects.detail.tabs.settings')}
					</button>
				{/if}
			</div>

			{#if activeTab === 'overview'}
				<div class="tab-content">
					<OverviewTab {pluginId} {project} bind:editMode onSaved={loadProject} />
				</div>
			{/if}

			{#if activeTab === 'members'}
				<div class="tab-content">
					<MembersTab
						{pluginId}
						{project}
						{members}
						{membersLoading}
						{availableToAdd}
						canManage={canManage && !project.closedAt}
						canAssignLead={canClose}
						closed={!!project.closedAt}
						onChanged={reloadMembers}
					/>
				</div>
			{/if}

			{#if activeTab === 'work' && canLogWork}
				<div class="tab-content">
					<WorkLogTab
						{pluginId}
						{projectId}
						{project}
						{members}
						{canViewAllWork}
						closed={!!project.closedAt}
						bind:entryCount={workEntryCount}
					/>
				</div>
			{/if}

			{#if activeTab === 'report' && canViewReport}
				<div class="tab-content">
					<ReportTab {pluginId} {projectId} {project} />
				</div>
			{/if}

			{#if activeTab === 'categories' && canManage}
				<div class="tab-content">
					<CategoriesTab {pluginId} {project} closed={!!project.closedAt} />
				</div>
			{/if}

			{#if activeTab === 'settings' && (canManage || canClose)}
				<div class="tab-content">
					{#if canClose}
						<div class="closing-zone">
							{#if project.closedAt}
								<h3>{t('projects.detail.reopen.title')}</h3>
								<p>{closedInfo}. {t('projects.detail.reopen.description')}</p>
								<button class="btn-secondary" onclick={() => setClosed(false)} disabled={closingBusy}>
									{t('projects.detail.reopen.button')}
								</button>
							{:else}
								<h3>{t('projects.detail.close.title')}</h3>
								<p>{t('projects.detail.close.description')}</p>
								<button class="btn-primary" onclick={() => setClosed(true)} disabled={closingBusy}>
									<svg class="lock-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
									{t('projects.detail.close.button')}
								</button>
							{/if}
						</div>
					{/if}
					{#if canManage}
						<div class="danger-zone">
							<h3>{t('projects.detail.delete')}</h3>
							<p>
								{project.closedAt
									? t('projects.detail.deleteClosed')
									: t('projects.detail.deleteConfirm')}
							</p>
							<button class="btn-danger" onclick={handleDelete} disabled={!!project.closedAt}>
								{t('projects.detail.delete')}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}
</section>
</div>

<style>
	@import '../styles/shared.css';

	.page {
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.page-header {
		display: flex;
		justify-content: space-between;
	}

	.btn-back {
		background: transparent;
		border: 1px solid var(--color-border, #e2e8f0);
		color: var(--color-foreground, #0f172a);
		padding: 0.4rem 0.75rem;
		border-radius: 0.375rem;
		cursor: pointer;
		font-size: 0.85rem;
	}

	.btn-back:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 1rem;
	}

	.title-row h2 {
		font-size: 1.5rem;
		font-weight: 700;
		margin: 0;
		display: inline-block;
		margin-right: 0.5rem;
	}

	.status {
		display: inline-block;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		vertical-align: middle;
	}

	.status-active { background: #dcfce7; color: #15803d; }

	.status-paused { background: #fef3c7; color: #a16207; }

	.status-completed { background: #dbeafe; color: #1d4ed8; }

	.status-archived { background: #e5e7eb; color: #374151; }

	.status-closed {
		background: #fee2e2;
		color: #b91c1c;
		margin-left: 0.25rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	.closing-zone .btn-primary {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
	}

	.closing-zone {
		border: 1px solid var(--color-border, #e2e8f0);
		background: var(--color-muted, #f8fafc);
		padding: 1rem;
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.closing-zone h3 {
		margin: 0;
		font-size: 1rem;
	}

	.closing-zone p {
		margin: 0;
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.85rem;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-border, #e2e8f0);
	}

	.tab {
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		padding: 0.5rem 0.75rem;
		margin-bottom: -1px;
		font-size: 0.875rem;
		cursor: pointer;
		color: var(--color-muted-foreground, #64748b);
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.tab:hover {
		color: var(--color-foreground, #0f172a);
	}

	.tab.active {
		color: var(--color-primary, #3730a3);
		border-bottom-color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	.tab-badge {
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		font-size: 0.7rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}

	.tab.active .tab-badge {
		background: var(--color-primary-subtle, #eef2ff);
		color: var(--color-primary, #3730a3);
	}

	.tab-content {
		background: var(--color-card, #fff);
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.danger-zone {
		border: 1px solid #fecaca;
		background: #fef2f2;
		padding: 1rem;
		border-radius: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		align-items: flex-start;
	}

	.danger-zone h3 {
		margin: 0;
		color: #dc2626;
		font-size: 1rem;
	}

	.danger-zone p {
		margin: 0;
		color: #991b1b;
		font-size: 0.85rem;
	}

	:global(.dark) .tab-content {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .status-active { background: rgba(22, 163, 74, 0.2); color: #86efac; }

	:global(.dark) .status-paused { background: rgba(202, 138, 4, 0.2); color: #fde68a; }

	:global(.dark) .status-completed { background: rgba(37, 99, 235, 0.2); color: #bfdbfe; }

	:global(.dark) .status-archived { background: oklch(0.3 0 0); color: oklch(0.75 0 0); }

	:global(.dark) .status-closed { background: rgba(220, 38, 38, 0.2); color: #fca5a5; }

	:global(.dark) .closing-zone {
		background: oklch(0.18 0 0);
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .danger-zone {
		background: rgba(220, 38, 38, 0.1);
		border-color: rgba(220, 38, 38, 0.3);
	}

	:global(.dark) .danger-zone p { color: #fca5a5; }

	:global(.dark) .btn-back:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}
</style>
