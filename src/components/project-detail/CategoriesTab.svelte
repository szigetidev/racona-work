<!--
	ProjectDetail — Kategóriák fül

	A projekt saját munkabejegyzés-kategóriái: felvétel, átnevezés, sorrend,
	aktiválás/inaktiválás és törlés (csak használatlané). Kategóriák átvehetők a
	szervezet egy másik projektjéből vagy a régi közös listából.

	Amíg a projektnek nincs aktív kategóriája, a munkanaplóban nem kötelező
	kategóriát választani. Lezárt projekt kategóriái csak megtekinthetők.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		ProjectRow,
		WorkEntryCategory,
		WorkEntryCategorySource
	} from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';

	let {
		pluginId = 'racona-work',
		project,
		closed = false
	}: {
		pluginId?: string;
		project: ProjectRow;
		/** Lezárt projekt: a kategóriák nem módosíthatók. */
		closed?: boolean;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let categories = $state<WorkEntryCategory[]>([]);
	let sources = $state<WorkEntryCategorySource[]>([]);
	let loading = $state(false);
	let busy = $state(false);

	// Felvétel / átnevezés modal
	let showNameForm = $state(false);
	let editingId = $state<number | null>(null);
	let nameValue = $state('');

	// Átvétel modal; a forrás kulcsa: 'legacy' vagy a projekt azonosítója
	let showCopyForm = $state(false);
	let copySourceKey = $state<string>('');

	const legacySource = $derived(sources.find((s) => s.projectId === null) ?? null);
	const activeCount = $derived(categories.filter((c) => c.isActive).length);

	function sourceKey(source: WorkEntryCategorySource): string {
		return source.projectId === null ? 'legacy' : String(source.projectId);
	}

	function sourceLabel(source: WorkEntryCategorySource): string {
		const name = source.projectId === null ? t('categories.copy.legacy') : source.name ?? '';
		return `${name} (${t('categories.copy.count', { count: source.categoryCount })})`;
	}

	async function load() {
		if (!sdk?.remote) return;
		loading = true;
		try {
			const [cats, srcs] = await Promise.all([
				sdk.remote.call('getWorkEntryCategories', { projectId: project.id, includeInactive: true }),
				closed
					? Promise.resolve([])
					: sdk.remote.call('getWorkEntryCategorySources', { projectId: project.id })
			]);
			categories = Array.isArray(cats) ? (cats as WorkEntryCategory[]) : [];
			sources = Array.isArray(srcs) ? (srcs as WorkEntryCategorySource[]) : [];
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.loadFailed'), 'error');
		} finally {
			loading = false;
		}
	}

	/** Közös futtató: hibánál toast, a végén mindig friss lista. */
	async function run(action: () => Promise<unknown>, successKey?: string) {
		busy = true;
		try {
			await action();
			if (successKey) sdk?.ui?.toast?.(t(successKey), 'success');
		} catch (err: any) {
			sdk?.ui?.toast?.(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			busy = false;
			await load();
		}
	}

	function openCreate() {
		editingId = null;
		nameValue = '';
		showNameForm = true;
	}

	function openRename(category: WorkEntryCategory) {
		editingId = category.id;
		nameValue = category.name;
		showNameForm = true;
	}

	async function submitName() {
		const name = nameValue.trim();
		if (!name) return;
		const id = editingId;
		showNameForm = false;
		await run(
			() =>
				id === null
					? sdk.remote.call('createWorkEntryCategory', { projectId: project.id, name })
					: sdk.remote.call('updateWorkEntryCategory', { id, name }),
			id === null ? 'categories.createSuccess' : 'categories.updateSuccess'
		);
	}

	function toggleActive(category: WorkEntryCategory) {
		return run(
			() => sdk.remote.call('updateWorkEntryCategory', { id: category.id, isActive: !category.isActive }),
			category.isActive ? 'categories.deactivateSuccess' : 'categories.activateSuccess'
		);
	}

	async function remove(category: WorkEntryCategory) {
		const confirmed = await sdk?.ui?.dialog?.({
			type: 'confirm',
			title: t('categories.delete.title'),
			message: t('categories.delete.message', { name: category.name }),
			confirmLabel: t('categories.delete.confirm'),
			confirmVariant: 'destructive'
		});
		const ok = confirmed?.action === 'confirm' || (typeof confirmed === 'boolean' && confirmed);
		if (!ok && confirmed !== undefined) return;
		await run(() => sdk.remote.call('deleteWorkEntryCategory', { id: category.id }), 'categories.deleteSuccess');
	}

	function move(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= categories.length) return;
		const ids = categories.map((c) => c.id);
		[ids[index], ids[target]] = [ids[target], ids[index]];
		return run(() => sdk.remote.call('reorderWorkEntryCategories', { projectId: project.id, ids }));
	}

	function openCopy(source?: WorkEntryCategorySource) {
		copySourceKey = source ? sourceKey(source) : sources[0] ? sourceKey(sources[0]) : '';
		showCopyForm = true;
	}

	async function submitCopy() {
		if (!copySourceKey) return;
		const sourceProjectId = copySourceKey === 'legacy' ? null : Number(copySourceKey);
		showCopyForm = false;
		await run(async () => {
			const result = (await sdk.remote.call('copyWorkEntryCategories', {
				projectId: project.id,
				sourceProjectId
			})) as { added: number; skipped: number };
			sdk?.ui?.toast?.(
				result.skipped > 0
					? t('categories.copy.resultWithSkipped', { added: result.added, skipped: result.skipped })
					: t('categories.copy.result', { added: result.added }),
				'success'
			);
		});
	}

	$effect(() => {
		project.id;
		closed;
		untrack(() => load());
	});
</script>

<div class="section-header">
	<div>
		<h3>{t('categories.title')}</h3>
		<p class="hint">
			{activeCount > 0 ? t('categories.hint.required') : t('categories.hint.optional')}
		</p>
	</div>
	{#if !closed}
		<div class="header-actions">
			{#if sources.length > 0}
				<button class="btn-secondary" onclick={() => openCopy()} disabled={busy}>
					{t('categories.copy.button')}
				</button>
			{/if}
			<button class="btn-primary" onclick={openCreate} disabled={busy}>
				+ {t('categories.create')}
			</button>
		</div>
	{/if}
</div>

{#if closed}
	<p class="hint">{t('categories.closedHint')}</p>
{/if}

{#if loading && categories.length === 0}
	<div class="loading-state"><div class="spinner"></div><span>{t('loading')}</span></div>
{:else if categories.length === 0}
	<div class="empty-box">
		<p class="empty-state">{t('categories.empty')}</p>
		{#if !closed && legacySource}
			<button class="btn-primary" onclick={() => openCopy(legacySource)} disabled={busy}>
				{t('categories.copy.fromLegacy', { count: legacySource.categoryCount })}
			</button>
		{/if}
	</div>
{:else}
	<ul class="category-list">
		{#each categories as category, index (category.id)}
			<li class="category-item" class:inactive={!category.isActive}>
				{#if !closed}
					<div class="order-buttons">
						<button
							class="icon-btn"
							title={t('categories.moveUp')}
							aria-label={t('categories.moveUp')}
							onclick={() => move(index, -1)}
							disabled={busy || index === 0}>↑</button
						>
						<button
							class="icon-btn"
							title={t('categories.moveDown')}
							aria-label={t('categories.moveDown')}
							onclick={() => move(index, 1)}
							disabled={busy || index === categories.length - 1}>↓</button
						>
					</div>
				{/if}
				<div class="category-info">
					<span class="name">{category.name}</span>
					<span class="meta">
						{t('categories.entryCount', { count: category.entryCount })}
						{#if !category.isActive}· <span class="inactive-badge">{t('categories.inactive')}</span>{/if}
					</span>
				</div>
				{#if !closed}
					<div class="item-actions">
						<button class="btn-link" onclick={() => openRename(category)} disabled={busy}>
							{t('categories.rename')}
						</button>
						<button class="btn-link" onclick={() => toggleActive(category)} disabled={busy}>
							{category.isActive ? t('categories.deactivate') : t('categories.activate')}
						</button>
						{#if category.entryCount === 0}
							<button
								class="remove-btn"
								title={t('categories.delete.title')}
								aria-label={t('categories.delete.title')}
								onclick={() => remove(category)}
								disabled={busy}>✕</button
							>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<!-- Felvétel / átnevezés modal -->
{#if showNameForm}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (showNameForm = false)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{editingId === null ? t('categories.create') : t('categories.rename')}</h3>
				<button class="icon-btn" onclick={() => (showNameForm = false)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('categories.name')} *</span>
					<input
						class="input"
						type="text"
						maxlength="200"
						bind:value={nameValue}
						onkeydown={(e) => e.key === 'Enter' && submitName()}
					/>
				</label>
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showNameForm = false)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitName} disabled={!nameValue.trim() || busy}>
					{t('form.save')}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Átvétel modal -->
{#if showCopyForm}
	<div class="modal-overlay" onclick={(e) => e.target === e.currentTarget && (showCopyForm = false)} role="presentation">
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1">
			<div class="modal-header">
				<h3>{t('categories.copy.title')}</h3>
				<button class="icon-btn" onclick={() => (showCopyForm = false)}>✕</button>
			</div>
			<div class="modal-body">
				<label>
					<span>{t('categories.copy.source')}</span>
					<select class="input" bind:value={copySourceKey}>
						{#each sources as source (sourceKey(source))}
							<option value={sourceKey(source)}>{sourceLabel(source)}</option>
						{/each}
					</select>
				</label>
				<p class="hint">{t('categories.copy.description')}</p>
			</div>
			<div class="modal-footer">
				<button class="btn-secondary" onclick={() => (showCopyForm = false)}>{t('form.cancel')}</button>
				<button class="btn-primary" onclick={submitCopy} disabled={!copySourceKey || busy}>
					{t('categories.copy.submit')}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.hint {
		margin: 0.25rem 0 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.empty-box {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
	}

	.category-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.category-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem;
		border-radius: 0.375rem;
	}

	.category-item:hover {
		background: var(--color-accent, #f1f5f9);
	}

	.category-item.inactive .name {
		color: var(--color-muted-foreground, #64748b);
		text-decoration: line-through;
	}

	.order-buttons {
		display: flex;
		flex-direction: column;
	}

	.order-buttons .icon-btn {
		padding: 0 0.35rem;
		line-height: 1.1;
	}

	.category-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.category-info .name {
		font-size: 0.875rem;
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	.category-info .meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.inactive-badge {
		font-weight: 600;
	}

	.item-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.btn-link {
		background: transparent;
		border: none;
		padding: 0.2rem 0.25rem;
		font-size: 0.8rem;
		color: var(--color-primary, #3730a3);
		cursor: pointer;
	}

	.btn-link:hover:not(:disabled) {
		text-decoration: underline;
	}

	.btn-link:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.dark) .category-item:hover {
		background: var(--color-accent, oklch(0.269 0 0));
	}
</style>
