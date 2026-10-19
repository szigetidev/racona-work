<!--
	Munkabejegyzés rögzítése vagy szerkesztése telefonon: projekt (csak nyitott,
	a legutóbb használt előre kiválasztva), kategória, feladat, óra, nap, leírás.
	Szerkesztésnél törölni is lehet.
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { MobileContext } from './types.js';
	import type { ProjectListResult, ProjectRow, WorkEntryCategory, WorkEntryRow } from '../../../server/functions.js';

	let {
		ctx,
		day,
		entry,
		onDone
	}: {
		ctx: MobileContext;
		/** Új bejegyzés napja */
		day: string;
		/** Szerkesztett bejegyzés; null: új */
		entry: WorkEntryRow | null;
		/** Mentés, törlés vagy mégse után; mentéskor a bejegyzés napjával */
		onDone: (savedDay?: string) => void;
	} = $props();

	const t = (key: string, vars?: Record<string, string | number>) => ctx.t(key, vars);
	const LAST_PROJECT_KEY = 'racona-work:mobile:last-project';

	let projects = $state<ProjectRow[]>([]);
	let categories = $state<WorkEntryCategory[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let projectId = $state<number | null>(entry?.projectId ?? null);
	let categoryId = $state<number | null>(entry?.categoryId ?? null);
	let title = $state(entry?.title ?? '');
	let hours = $state<number | null>(entry?.hours ?? null);
	let workDate = $state(entry?.workDate?.slice(0, 10) ?? day);
	let description = $state(entry?.description ?? '');
	let saving = $state(false);
	let deleting = $state(false);
	let submitted = $state(false);

	function lastProjectId(): number | null {
		try {
			const value = Number(localStorage.getItem(LAST_PROJECT_KEY));
			return Number.isInteger(value) && value > 0 ? value : null;
		} catch {
			return null;
		}
	}

	onMount(async () => {
		try {
			const projectResult = (await ctx.sdk.remote.call('listProjects', {
				organizationId: ctx.organization.id,
				status: 'all',
				pageSize: 200,
				sortBy: 'name',
				sortOrder: 'asc'
			})) as ProjectListResult;
			// Lezárt projekthez nem lehet rögzíteni; a szerkesztett bejegyzés projektje maradjon a listában
			projects = (projectResult?.data ?? []).filter((p) => !p.closedAt || p.id === entry?.projectId);

			if (projectId === null) {
				const last = lastProjectId();
				if (last !== null && projects.some((p) => p.id === last)) projectId = last;
				else if (projects.length === 1) projectId = projects[0].id;
			}
		} catch (err: any) {
			loadError = err?.message ?? t('error.loadFailed');
		} finally {
			loading = false;
		}
	});

	// Minden projektnek saját kategórialistája van: projektváltáskor újratöltjük
	$effect(() => {
		const id = projectId;
		untrack(() => loadCategories(id));
	});

	async function loadCategories(id: number | null) {
		if (id === null) {
			categories = [];
			categoryId = null;
			return;
		}
		try {
			const result = (await ctx.sdk.remote.call('getWorkEntryCategories', { projectId: id })) as WorkEntryCategory[];
			if (id !== projectId) return; // közben másik projektet választottak
			categories = result ?? [];
		} catch {
			categories = [];
		}
		if (categoryId !== null && !categories.some((c) => c.id === categoryId) && categoryId !== entry?.categoryId) {
			categoryId = null;
		}
		// Új bejegyzésnél az alapértelmezett kategória, vagy ha csak egy van, az az egy
		if (!entry && categoryId === null) {
			categoryId =
				categories.find((c) => c.isDefault)?.id ?? (categories.length === 1 ? categories[0].id : null);
		}
	}

	/** Ha a projektnek nincs kategóriája, nem kötelező választani. */
	const categoryRequired = $derived(categories.length > 0);
	/** Szerkesztéskor a bejegyzés azóta inaktivált kategóriája is választható marad. */
	const inactiveCategory = $derived(
		entry?.categoryId && !categories.some((c) => c.id === entry.categoryId)
			? { id: entry.categoryId, name: entry.categoryName ?? '' }
			: null
	);

	const hoursValid = $derived(hours !== null && hours >= 0.25 && hours <= 24);
	const valid = $derived(
		projectId !== null &&
			(!categoryRequired || categoryId !== null) &&
			title.trim().length > 0 &&
			hoursValid &&
			!!workDate
	);

	async function save() {
		submitted = true;
		if (!valid || saving) return;
		saving = true;
		try {
			if (entry) {
				await ctx.sdk.remote.call('updateWorkEntry', {
					id: entry.id,
					categoryId,
					title: title.trim(),
					description: description.trim() || null,
					hours,
					workDate
				});
			} else {
				await ctx.sdk.remote.call('createWorkEntry', {
					projectId,
					categoryId,
					title: title.trim(),
					description: description.trim() || undefined,
					hours,
					workDate
				});
			}
			try {
				localStorage.setItem(LAST_PROJECT_KEY, String(projectId));
			} catch {
				// a böngésző tárhelye nem elérhető: a következő alkalommal nincs előválasztás
			}
			ctx.sdk?.ui?.toast(t('work.saveSuccess'), 'success');
			onDone(workDate);
		} catch (err: any) {
			ctx.sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	async function remove() {
		if (!entry || deleting) return;
		if (!window.confirm(t('work.deleteConfirm'))) return;
		deleting = true;
		try {
			await ctx.sdk.remote.call('deleteWorkEntry', { id: entry.id });
			ctx.sdk?.ui?.toast(t('work.deleteSuccess'), 'success');
			onDone();
		} catch (err: any) {
			ctx.sdk?.ui?.toast(err?.message ?? t('error.deleteFailed'), 'error');
		} finally {
			deleting = false;
		}
	}
</script>

<div class="m-screen">
	<h2 class="m-title">{entry ? t('mobile.work.edit') : t('mobile.work.new')}</h2>

	{#if loading}
		<div class="loading-state"><span class="spinner"></span>{t('loading')}</div>
	{:else if loadError}
		<p class="m-error">{loadError}</p>
	{:else}
		<label class="m-field">
			<span class="m-label">{t('mobile.work.project')}</span>
			{#if projects.length === 0}
				<p class="m-muted">{t('mobile.work.noProjects')}</p>
			{:else}
				<!-- Meglévő bejegyzés projektje nem módosítható (a szerver sem engedi) -->
				<select class="m-input" bind:value={projectId} disabled={!!entry || saving}>
					<option value={null}>{t('mobile.work.selectProject')}</option>
					{#each projects as project (project.id)}
						<option value={project.id}>{project.name}</option>
					{/each}
				</select>
			{/if}
			{#if submitted && projectId === null}
				<span class="field-error">{t('form.required')}</span>
			{/if}
		</label>

		{#if categoryRequired || inactiveCategory}
			<label class="m-field">
				<span class="m-label">{t('work.form.category')}</span>
				<select class="m-input" bind:value={categoryId} disabled={saving}>
					<option value={null}>{t('mobile.work.selectCategory')}</option>
					{#each categories as category (category.id)}
						<option value={category.id}>{category.name}</option>
					{/each}
					{#if inactiveCategory}
						<option value={inactiveCategory.id}>
							{inactiveCategory.name} ({t('work.form.category.inactive')})
						</option>
					{/if}
				</select>
				{#if submitted && categoryRequired && categoryId === null}
					<span class="field-error">{t('form.required')}</span>
				{/if}
			</label>
		{/if}

		<label class="m-field">
			<span class="m-label">{t('work.form.title')}</span>
			<input class="m-input" type="text" maxlength="255" bind:value={title} disabled={saving} />
			{#if submitted && !title.trim()}
				<span class="field-error">{t('form.required')}</span>
			{/if}
		</label>

		<div class="row">
			<label class="m-field">
				<span class="m-label">{t('work.form.hours')}</span>
				<input
					class="m-input"
					type="number"
					inputmode="decimal"
					min="0.25"
					max="24"
					step="0.25"
					bind:value={hours}
					disabled={saving}
				/>
			</label>
			<label class="m-field">
				<span class="m-label">{t('work.form.workDate')}</span>
				<input class="m-input" type="date" bind:value={workDate} disabled={saving} />
			</label>
		</div>
		{#if submitted && !hoursValid}
			<span class="field-error">{t('mobile.work.hoursHint')}</span>
		{/if}

		<label class="m-field">
			<span class="m-label">{t('work.form.description')}</span>
			<textarea class="m-input" rows="3" bind:value={description} disabled={saving}></textarea>
		</label>
	{/if}

	<div class="m-actions">
		<button class="m-btn" onclick={() => onDone()} disabled={saving || deleting}>{t('form.cancel')}</button>
		<button class="m-btn m-btn-primary" onclick={save} disabled={loading || !!loadError || saving || deleting}>
			{saving ? t('loading') : t('form.save')}
		</button>
	</div>

	{#if entry}
		<button class="m-btn m-btn-danger m-btn-block" onclick={remove} disabled={saving || deleting}>
			{deleting ? t('loading') : t('button.delete')}
		</button>
	{/if}
</div>

<style>
	@import '../../styles/shared.css';
	@import '../../styles/mobile.css';

	.m-title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
	}

	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
		gap: 0.75rem;
	}

	.field-error {
		font-size: 0.8125rem;
		color: #dc2626;
	}
</style>
