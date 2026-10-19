<svelte:options
  customElement={{ tag: "racona-work-organizations", shadow: "none" }}
/>

<script module>
  if (typeof window !== "undefined") {
    (window as any).racona_work_Component_Organizations = function () {
      return { tagName: "racona-work-organizations" };
    };
  }
</script>

<script lang="ts">
  /**
   * Organizations - Szervezetek kezelése (rendszergazda, illetve org.manage képességű szervezet adminisztrátor)
   */

  import { onMount } from "svelte";
  import type { Organization, SavedOrganization } from "../../server/functions.js";
  import {
    getOrganizationStore,
    createOrganizationStore,
  } from "../stores/organizationStore.svelte.js";
  import type { OrganizationStore } from "../stores/organizationStore.svelte.js";
  import { resolveSdk, translate } from "../utils/sdk.js";

  let { pluginId = "racona-work" }: { pluginId?: string } = $props();

  const sdk = $derived(resolveSdk(pluginId));
  const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

  // Organization store - inicializálás
  let orgStore = $state<OrganizationStore | null>(null);

  // --- Állapot ---
  let organizations = $state<Organization[]>([]);
  let selectedOrg = $state<Organization | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // --- Űrlap állapotok ---
  let showCreateForm = $state(false);
  let showEditForm = $state(false);
  let showAddMemberForm = $state(false);
  let newOrgName = $state("");
  let newOrgAddress = $state("");
  let newOrgTaxNumber = $state("");
  let newOrgPhone = $state("");
  let newOrgEmail = $state("");
  let newOrgWebsite = $state("");
  let newOrgNotes = $state("");
  let editOrgId = $state<number | null>(null);
  let editOrgName = $state("");
  let editOrgAddress = $state("");
  let editOrgTaxNumber = $state("");
  let editOrgPhone = $state("");
  let editOrgEmail = $state("");
  let editOrgWebsite = $state("");
  let editOrgNotes = $state("");

  // --- Adatok betöltése ---
  async function loadOrganizations() {
    loading = true;
    error = null;
    try {
      const result = await sdk?.remote?.call("getOrganizations", {});
      organizations = result as Organization[];
      if (organizations.length > 0 && !selectedOrg) {
        selectedOrg = organizations[0];
      }
    } catch (err: any) {
      error = err?.message ?? t("error.loadFailed");
    } finally {
      loading = false;
    }
  }

  // --- Szervezet létrehozása ---
  async function handleCreateOrganization() {
    if (!newOrgName.trim()) {
      error = t('organizations.nameRequired');
      return;
    }

    loading = true;
    error = null;
    try {
      const result = await sdk?.remote?.call("createOrganization", {
        name: newOrgName,
        address: newOrgAddress || undefined,
        taxNumber: newOrgTaxNumber || undefined,
        phone: newOrgPhone || undefined,
        email: newOrgEmail || undefined,
        website: newOrgWebsite || undefined,
        notes: newOrgNotes || undefined,
      });
      const newOrg = result as SavedOrganization;

      // Hozzáadjuk a store-hoz is
      if (orgStore) {
        orgStore.availableOrganizations = [
          ...orgStore.availableOrganizations,
          newOrg,
        ];
        // Automatikusan váltunk az új szervezetre a store-ban is
        await orgStore.switchOrganization(newOrg.id);
      }

      organizations = [...organizations, newOrg];
      selectedOrg = newOrg;
      newOrgName = "";
      newOrgAddress = "";
      newOrgTaxNumber = "";
      newOrgPhone = "";
      newOrgEmail = "";
      newOrgWebsite = "";
      newOrgNotes = "";
      showCreateForm = false;

      // Toast üzenet megjelenítése
      sdk?.ui?.toast(t('organizations.createSuccess', { name: newOrg.name }), 'success');
      if (newOrg.addressGeocodeFailed) sdk?.ui?.toast(t('organizations.addressNotOnMap'), 'warning');

      // Értesítjük a sidebar OrganizationSwitcher-t
      window.dispatchEvent(
        new CustomEvent("organization-created", {
          detail: { organization: newOrg },
        }),
      );
    } catch (err: any) {
      error = err?.message ?? t("error.saveFailed");
    } finally {
      loading = false;
    }
  }

  // --- Szervezet szerkesztése ---
  function openEditForm(org: Organization) {
    editOrgId = org.id;
    editOrgName = org.name;
    editOrgAddress = org.address ?? "";
    editOrgTaxNumber = org.taxNumber ?? "";
    editOrgPhone = org.phone ?? "";
    editOrgEmail = org.email ?? "";
    editOrgWebsite = org.website ?? "";
    editOrgNotes = org.notes ?? "";
    showEditForm = true;
  }

  async function handleUpdateOrganization() {
    if (!editOrgName.trim() || editOrgId === null) {
      error = t('organizations.nameRequired');
      return;
    }

    loading = true;
    error = null;
    try {
      const result = await sdk?.remote?.call("updateOrganization", {
        id: editOrgId,
        name: editOrgName,
        address: editOrgAddress || null,
        taxNumber: editOrgTaxNumber || null,
        phone: editOrgPhone || null,
        email: editOrgEmail || null,
        website: editOrgWebsite || null,
        notes: editOrgNotes || null,
      });
      const updatedOrg = result as SavedOrganization;
      if (updatedOrg.addressGeocodeFailed) sdk?.ui?.toast(t('organizations.addressNotOnMap'), 'warning');

      // Frissítjük a store-ban is
      if (orgStore) {
        orgStore.updateOrganization(updatedOrg);
      }

      // Frissítjük a listát
      organizations = organizations.map((org) =>
        org.id === updatedOrg.id ? updatedOrg : org,
      );

      // Ha ez a kiválasztott szervezet, frissítjük
      if (selectedOrg?.id === updatedOrg.id) {
        selectedOrg = updatedOrg;
      }

      showEditForm = false;
      editOrgId = null;

      // Toast üzenet megjelenítése
      sdk?.ui?.toast(t('organizations.updateSuccess', { name: updatedOrg.name }), 'success');
    } catch (err: any) {
      error = err?.message ?? t("error.saveFailed");
    } finally {
      loading = false;
    }
  }

  // --- Szervezet törlése ---
  async function handleDeleteOrganization(org: Organization) {
    // Először lekérdezzük a tagok számát
    let memberCount = 0;
    try {
      const members = await sdk.remote.call("getOrganizationMembers", {
        organizationId: org.id,
      });
      memberCount = members?.length ?? 0;
    } catch (err) {
      console.error(t('error.loadFailed'), err);
    }

    // Részletes megerősítő dialógus
    const confirmed = await sdk?.ui?.dialog({
      type: "confirm",
      title: t('organizations.delete.title'),
      message: t('organizations.delete.message', { name: org.name, count: memberCount }),
      confirmLabel: t('organizations.delete.confirmLabel'),
      confirmVariant: "destructive",
    });

    if (!confirmed || confirmed.action !== "confirm") {
      return;
    }

    loading = true;
    error = null;
    try {
      // Használjuk a store-t a törléshez
      if (orgStore) {
        const result = await orgStore.deleteOrganization(org.id);
        if (!result.success) {
          throw new Error(orgStore.error ?? t('organizations.delete.failed'));
        }

        // Eltávolítjuk a listából
        organizations = organizations.filter((o) => o.id !== org.id);

        // Ha ez volt a kiválasztott szervezet, válasszuk ki az elsőt
        if (selectedOrg?.id === org.id) {
          selectedOrg = organizations.length > 0 ? organizations[0] : null;
        }

        // Toast üzenet megjelenítése a törölt tagok számával
        const deletedInfo =
          result.memberCount && result.memberCount > 0
            ? ' ' + t('organizations.deleteMembersInfo', { count: result.memberCount })
            : '';
        sdk?.ui?.toast(
          t('organizations.deleteSuccess', { name: org.name }) + deletedInfo,
          'success',
        );
      }
    } catch (err: any) {
      error = err?.message ?? t("error.deleteFailed");
      sdk?.ui?.toast(error, "error");
    } finally {
      loading = false;
    }
  }

  // --- Szervezet váltás ---
  async function handleSelectOrganization(org: Organization) {
    selectedOrg = org;
  }

  // --- Inicializálás ---
  onMount(() => {
    // Store inicializálás
    if (sdk?.remote) {
      try {
        orgStore = getOrganizationStore();
      } catch {
        // Ha még nincs store, létrehozzuk
        orgStore = createOrganizationStore(pluginId, sdk);
      }

      // Szervezetek betöltése
      orgStore.loadOrganizations();

      // Rendszergazdának az összes, szervezet adminisztrátornak a saját szervezetei
      loadOrganizations();
    }
  });
</script>

<div class="rw">
  <section class="page">
    <div class="page-header">
      <div class="page-header-title">
        <h2>{t("organizations.title")}</h2>
        <p class="subtitle">{t("organizations.subtitle")}</p>
      </div>
      <!-- Új szervezetet csak rendszergazda hozhat létre -->
      {#if orgStore?.isAdmin}
        <button class="btn-primary" onclick={() => (showCreateForm = true)}>
          + {t("organizations.create")}
        </button>
      {/if}
    </div>

    {#if error}
      <div class="error-banner">
        <p>{error}</p>
        <button onclick={() => (error = null)}>✕</button>
      </div>
    {/if}

    <div class="content-grid">
      <!-- Szervezetek listája -->
      <div class="org-list-panel">
        <h3>{t("organizations.list.title")}</h3>
        {#if loading && organizations.length === 0}
          <div class="loading-state">
            <div class="spinner"></div>
            <span>{t("loading")}</span>
          </div>
        {:else if organizations.length === 0}
          <p class="empty-state">{t("organizations.empty")}</p>
        {:else}
          <div class="org-list">
            {#each organizations as org (org.id)}
              <button
                class="org-card"
                class:active={selectedOrg?.id === org.id}
                onclick={() => handleSelectOrganization(org)}
              >
                <div class="org-card-details">
                  <span class="org-card-name">{org.name}</span>
                  <span class="org-card-slug">{org.slug}</span>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Szervezet részletek -->
      {#if selectedOrg}
        <div class="details-panel">
          <div class="panel-header">
            <h3>{selectedOrg.name}</h3>
          </div>
          <div class="details-grid">
            <div class="detail-item">
              <span class="detail-label">{t("organizations.slug")}</span>
              <span class="detail-value">{selectedOrg.slug}</span>
            </div>
            {#if selectedOrg.address}
              <div class="detail-item">
                <span class="detail-label">{t("organizations.address")}</span>
                <span class="detail-value">{selectedOrg.address}</span>
              </div>
            {/if}
            {#if selectedOrg.taxNumber}
              <div class="detail-item">
                <span class="detail-label">{t("organizations.taxNumber")}</span>
                <span class="detail-value">{selectedOrg.taxNumber}</span>
              </div>
            {/if}
            {#if selectedOrg.phone}
              <div class="detail-item">
                <span class="detail-label">{t("organizations.phone")}</span>
                <span class="detail-value">{selectedOrg.phone}</span>
              </div>
            {/if}
            {#if selectedOrg.email}
              <div class="detail-item">
                <span class="detail-label">{t("organizations.email")}</span>
                <span class="detail-value">{selectedOrg.email}</span>
              </div>
            {/if}
            {#if selectedOrg.website}
              <div class="detail-item">
                <span class="detail-label">{t("organizations.website")}</span>
                <span class="detail-value">
                  <a
                    href={selectedOrg.website}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {selectedOrg.website}
                  </a>
                </span>
              </div>
            {/if}
            {#if selectedOrg.notes}
              <div class="detail-item">
                <span class="detail-label">{t("organizations.comment")}</span>
                <span class="detail-value">{selectedOrg.notes}</span>
              </div>
            {/if}

          </div>
          <div>
            <button
                class="btn-primary"
                onclick={() => openEditForm(selectedOrg!)}
                >
                {t("button.edit")}
                </button>
            </div>
        </div>
      {/if}
    </div>

    <!-- Új szervezet létrehozása modal -->
    {#if showCreateForm}
      <div
        class="modal-overlay"
        role="presentation"
        onmousedown={(e) => { if (e.target === e.currentTarget) showCreateForm = false; }}
        onkeydown={(e) => e.key === "Escape" && (showCreateForm = false)}
      >
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <div class="modal-header">
            <h3>{t("organizations.create")}</h3>
            <button class="modal-close" onclick={() => (showCreateForm = false)}
              >✕</button
            >
          </div>
          <div class="modal-body">
            <label>
              <span>{t("organizations.name")} *</span>
              <input
                type="text"
                bind:value={newOrgName}
                placeholder={t("organizations.name.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.address")}</span>
              <input
                type="text"
                bind:value={newOrgAddress}
                placeholder={t("organizations.address.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.taxNumber")}</span>
              <input
                type="text"
                bind:value={newOrgTaxNumber}
                placeholder={t("organizations.taxNumber.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.phone")}</span>
              <input
                type="tel"
                bind:value={newOrgPhone}
                placeholder={t("organizations.phone.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.email")}</span>
              <input
                type="email"
                bind:value={newOrgEmail}
                placeholder={t("organizations.email.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.website")}</span>
              <input
                type="url"
                bind:value={newOrgWebsite}
                placeholder={t("organizations.website.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.comment")}</span>
              <textarea
                bind:value={newOrgNotes}
                placeholder={t("organizations.comment.placeholder")}
                class="input textarea"
                rows="3"
              ></textarea>
            </label>
          </div>
          <div class="modal-footer">
            <button
              class="btn-secondary"
              onclick={() => (showCreateForm = false)}
            >
              {t("button.cancel")}
            </button>
            <button
              class="btn-primary"
              onclick={handleCreateOrganization}
              disabled={loading}
            >
              {t("button.save")}
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Szervezet szerkesztése modal -->
    {#if showEditForm}
      <div
        class="modal-overlay"
        role="presentation"
        onmousedown={(e) => { if (e.target === e.currentTarget) showEditForm = false; }}
        onkeydown={(e) => e.key === "Escape" && (showEditForm = false)}
      >
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <div class="modal-header">
            <h3>{t("organizations.edit.title")}</h3>
            <button class="modal-close" onclick={() => (showEditForm = false)}
              >✕</button
            >
          </div>
          <div class="modal-body">
            <label>
              <span>{t("organizations.name")} *</span>
              <input
                type="text"
                bind:value={editOrgName}
                placeholder={t("organizations.name.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.address")}</span>
              <input
                type="text"
                bind:value={editOrgAddress}
                placeholder={t("organizations.address.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.taxNumber")}</span>
              <input
                type="text"
                bind:value={editOrgTaxNumber}
                placeholder={t("organizations.taxNumber.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.phone")}</span>
              <input
                type="tel"
                bind:value={editOrgPhone}
                placeholder={t("organizations.phone.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.email")}</span>
              <input
                type="email"
                bind:value={editOrgEmail}
                placeholder={t("organizations.email.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.website")}</span>
              <input
                type="url"
                bind:value={editOrgWebsite}
                placeholder={t("organizations.website.placeholder")}
                class="input"
              />
            </label>
            <label>
              <span>{t("organizations.comment")}</span>
              <textarea
                bind:value={editOrgNotes}
                placeholder={t("organizations.comment.placeholder")}
                class="input textarea"
                rows="3"
              ></textarea>
            </label>
          </div>
          <div class="modal-footer">
            <!-- Szervezetet csak rendszergazda törölhet -->
            {#if orgStore?.isAdmin}
              <button
                class="btn-danger"
                onclick={() => {
                  const orgToDelete = organizations.find(
                    (o) => o.id === editOrgId,
                  );
                  if (orgToDelete) {
                    showEditForm = false;
                    handleDeleteOrganization(orgToDelete);
                  }
                }}
                disabled={loading}
              >
                {t("button.delete")}
              </button>
            {/if}
            <div style="flex: 1;"></div>
            <button
              class="btn-secondary"
              onclick={() => (showEditForm = false)}
            >
              {t("button.cancel")}
            </button>
            <button
              class="btn-primary"
              onclick={handleUpdateOrganization}
              disabled={loading}
            >
              {t("button.save")}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </section>
</div>

<style>
  @import "../styles/shared.css";

  .content-grid {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 1.5rem;
  }

  /* Szervezetek lista */
  .org-list-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .org-list-panel h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .org-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .org-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.5rem;
    background: var(--color-card, #ffffff);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    flex: 1;
  }

  .org-card:hover {
    background: var(--color-accent, #f8fafc);
    border-color: var(--color-primary, #3730a3);
  }

  .org-card.active {
    background: var(--color-primary-subtle, #eef2ff);
    border-color: var(--color-primary, #3730a3);
  }

  .org-card-details {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    flex: 1;
  }

  .org-card-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-foreground, #0f172a);
  }

  .org-card.active .org-card-name {
    color: var(--color-primary, #3730a3);
  }

  .org-card-slug {
    font-size: 0.75rem;
    color: var(--color-muted-foreground, #94a3b8);
    font-family: "Courier New", monospace;
  }

  /* Details panel */
  .details-panel {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .panel-header h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .details-grid {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.5rem;
    background: var(--color-card, #ffffff);
  }

  .detail-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .detail-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-muted-foreground, #64748b);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .detail-value {
    font-size: 0.875rem;
    color: var(--color-foreground, #0f172a);
  }

  .detail-value a {
    color: var(--color-primary, #3730a3);
    text-decoration: none;
  }

  .detail-value a:hover {
    text-decoration: underline;
  }
</style>
