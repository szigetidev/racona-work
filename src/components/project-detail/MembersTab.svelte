<!--
	ProjectDetail — Tagok fül

	A tagok listája és a "Tag hozzáadása" modal. A tag- és projektadatok
	betöltése a szülőben marad (a fejléc badge-e is azokat használja), ezért
	minden módosítás után `onChanged`-del kérünk újratöltést.

	A "lead" szerepű tag a projektvezető: a projektet kezelheti és lezárhatja
	(specs/project-lead.md). Kijelölni csak az tudja, aki maga is lezárhatja.

	Ha a projektnek több aktív kategóriája van, a kezelő tagonként
	alapértelmezett kategóriát állíthat be: rögzítéskor ez van előre kiválasztva.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		ProjectRow,
		ProjectMemberRow,
		EmployeeRow,
		WorkEntryCategory
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		project,
		members,
		membersLoading = false,
		availableToAdd,
		canManage = false,
		canAssignLead = false,
		closed = false,
		onChanged
	}: {
		pluginId?: string;
		project: ProjectRow;
		members: ProjectMemberRow[];
		membersLoading?: boolean;
		availableToAdd: EmployeeRow[];
		canManage?: boolean;
		/** Projektvezetőt kijelölhet és elvehet (project.close ezen a projekten). */
		canAssignLead?: boolean;
		/** Lezárt projekt: a tagok nem módosíthatók (a szülő a canManage-et is hamisra állítja). */
		closed?: boolean;
		onChanged: () => void | Promise<void>;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	/** A tag szerepének felirata; ismeretlen (régi, szabad szöveges) szerepnél maga a szerep. */
	function roleLabel(role: string): string {
		const key = `projects.members.roleOptions.${role}`;
		const label = t(key);
		return label === key ? role : label;
	}

	const ROLE_OPTIONS = [
		'member',
		'member_developer',
		'member_designer',
		'member_tester',
		'member_external',
		'member_consultant',
		'member_observer',
		'lead',
		'owner'
	] as const;

	const LEAD_ROLE = 'lead';

	/** A választható szerepek; egy régi, listán kívüli szerep is megmarad választhatónak. */
	function roleOptions(current?: string): string[] {
		return current && !(ROLE_OPTIONS as readonly string[]).includes(current)
			? [...ROLE_OPTIONS, current]
			: [...ROLE_OPTIONS];
	}

	let showAddMember = $state(false);
	let addMemberEmployeeId = $state<number | null>(null);
	let addMemberRole = $state<string>('member');
	let addMemberSaving = $state(false);
	let roleSaving = $state<number | null>(null);

	// Alapértelmezett kategória tagonként (csak több aktív kategóriánál van értelme)
	let categories = $state<WorkEntryCategory[]>([]);
	let defaultSaving = $state<number | null>(null);
	const showDefaultCategory = $derived(canManage && categories.length > 1);

	async function loadCategories() {
		try {
			const result = await sdk.remote.call('getWorkEntryCategories', { projectId: project.id });
			categories = Array.isArray(result) ? (result as WorkEntryCategory[]) : [];
		} catch {
			categories = [];
		}
	}

	$effect(() => {
		project.id;
		const manage = canManage;
		untrack(() => {
			if (manage && sdk?.remote) loadCategories();
			else categories = [];
		});
	});

	async function handleDefaultCategoryChange(member: ProjectMemberRow, value: string) {
		const categoryId = value ? Number(value) : null;
		if (categoryId === (member.defaultCategoryId ?? null)) return;
		defaultSaving = member.employeeId;
		try {
			await sdk.remote.call('setProjectMemberDefaultCategory', {
				projectId: project.id,
				employeeId: member.employeeId,
				categoryId
			});
			sdk?.ui?.toast?.(t('projects.members.defaultCategory.saved'), 'success');
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			defaultSaving = null;
			await onChanged();
		}
	}

	function initials(name: string | null | undefined): string {
		return (
			name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'
		);
	}

	async function handleAddMember() {
		if (!addMemberEmployeeId) return;
		addMemberSaving = true;
		try {
			await sdk.remote.call('addProjectMember', {
				projectId: project.id,
				employeeId: addMemberEmployeeId,
				role: addMemberRole
			});
			sdk?.ui?.toast?.(t('projects.members.addSuccess'), 'success');
			showAddMember = false;
			addMemberEmployeeId = null;
			addMemberRole = 'member';
			await onChanged();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			addMemberSaving = false;
		}
	}

	async function handleRoleChange(member: ProjectMemberRow, role: string) {
		if (role === member.role) return;
		roleSaving = member.employeeId;
		try {
			await sdk.remote.call('addProjectMember', {
				projectId: project.id,
				employeeId: member.employeeId,
				role
			});
			sdk?.ui?.toast?.(t('projects.members.roleChanged'), 'success');
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			roleSaving = null;
			// Hibánál is: a választó visszaáll a mentett szerepre; sikernél a saját jog is változhatott
			await onChanged();
		}
	}

	async function handleRemoveMember(employeeId: number) {
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('projects.members.removeConfirm'),
			message: t('projects.members.removeConfirm'),
			confirmLabel: t('projects.members.removeConfirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		try {
			await sdk.remote.call('removeProjectMember', {
				projectId: project.id,
				employeeId
			});
			sdk?.ui?.toast?.(t('projects.members.removeSuccess'), 'success');
			await onChanged();
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.deleteFailed'), 'error');
		}
	}
</script>

<div class="section-header">
	<h3>{t('projects.members.title')}</h3>
	{#if canManage && availableToAdd.length > 0}
		<button class="btn-primary" onclick={() => (showAddMember = true)}>
			+ {t('projects.members.add')}
		</button>
	{/if}
</div>

{#if closed}
	<p class="closed-hint">{t('projects.members.closedHint')}</p>
{:else if showDefaultCategory}
	<p class="closed-hint">{t('projects.members.defaultCategory')}: {t('projects.members.defaultCategory.hint')}</p>
{/if}

{#if membersLoading}
	<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
{:else if members.length === 0}
	<p class="empty-state">{t('projects.members.empty')}</p>
{:else}
	<ul class="member-list">
		{#each members as m (m.employeeId)}
			<li class="member-item">
				<div class="avatar">
					{#if m.userImage}
						<img src={m.userImage} alt={m.userName} />
					{:else}
						<div class="avatar-placeholder">{initials(m.userName)}</div>
					{/if}
				</div>
				<div class="member-info">
					<span class="name">{m.userName}</span>
					<span class="meta">
						{m.userEmail}
						{#if m.position}· {m.position}{/if}
					</span>
				</div>
				{#if canManage}
					<select
						class="role-select"
						class:lead={m.role === LEAD_ROLE}
						value={m.role}
						disabled={roleSaving === m.employeeId || (m.role === LEAD_ROLE && !canAssignLead)}
						aria-label={t('projects.members.role')}
						onchange={(e) => handleRoleChange(m, e.currentTarget.value)}
					>
						{#each roleOptions(m.role) as role (role)}
							<option value={role} disabled={role === LEAD_ROLE && !canAssignLead && m.role !== LEAD_ROLE}>
								{roleLabel(role)}
							</option>
						{/each}
					</select>
					{#if showDefaultCategory}
					<select
						class="role-select category-select"
						value={m.defaultCategoryId && categories.some((c) => c.id === m.defaultCategoryId) ? String(m.defaultCategoryId) : ''}
						disabled={defaultSaving === m.employeeId}
						title={t('projects.members.defaultCategory.hint')}
						aria-label={t('projects.members.defaultCategory')}
						onchange={(e) => handleDefaultCategoryChange(m, e.currentTarget.value)}
					>
						<option value="">
							{t('projects.members.defaultCategory')}: {t('projects.members.defaultCategory.none')}
						</option>
						{#each categories as c (c.id)}
							<option value={String(c.id)}>{c.name}</option>
						{/each}
					</select>
				{/if}
				{:else}
					<span class="role-badge" class:lead={m.role === LEAD_ROLE}>
						{roleLabel(m.role)}
					</span>
				{/if}
				{#if canManage}
					<button
						class="remove-btn"
						title={t('projects.members.removeConfirm')}
						onclick={() => handleRemoveMember(m.employeeId)}
					>
						✕
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<!-- Tag hozzáadása modal -->
{#if showAddMember}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (showAddMember = false)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('projects.members.add')}</h3>
				<button class="icon-btn" onclick={() => (showAddMember = false)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('projects.members.selectEmployee')}</span>
					<select class="input" bind:value={addMemberEmployeeId}>
						<option value={null}>{t('projects.members.selectEmployee')}</option>
						{#each availableToAdd as emp (emp.id)}
							<option value={emp.id}>{emp.userName} — {emp.userEmail}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>{t('projects.members.role')}</span>
					<select class="input" bind:value={addMemberRole}>
						{#each ROLE_OPTIONS as role (role)}
							<option value={role} disabled={role === LEAD_ROLE && !canAssignLead}>{roleLabel(role)}</option>
						{/each}
					</select>
					<small class="lead-hint">{t('projects.members.leadHint')}</small>
				</label>
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showAddMember = false)}>
					{t('form.cancel')}
				</button>
				<button
					class="btn-primary"
					onclick={handleAddMember}
					disabled={!addMemberEmployeeId || addMemberSaving}
				>
					{addMemberSaving ? t('loading') : t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.closed-hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.member-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.member-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		border-radius: 0.375rem;
		border: 1px solid transparent;
	}

	.member-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.member-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.member-info .name {
		font-size: 0.875rem;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.member-info .meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.role-badge {
		font-size: 0.7rem;
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-muted-foreground, #64748b);
		text-transform: capitalize;
	}

	.role-badge.lead,
	.role-select.lead {
		background: var(--color-primary-subtle, #eef2ff);
		color: var(--color-primary, #3730a3);
		font-weight: 600;
	}

	.role-select {
		width: auto;
		max-width: 14rem;
		font-size: 0.75rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 999px;
		background: var(--color-muted, #f1f5f9);
		color: var(--color-foreground, #0f172a);
		cursor: pointer;
	}

	.category-select {
		max-width: 16rem;
		background: var(--color-card, #fff);
	}

	.role-select:disabled {
		cursor: not-allowed;
		opacity: 0.8;
	}

	.lead-hint {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	:global(.dark) .member-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}
</style>
