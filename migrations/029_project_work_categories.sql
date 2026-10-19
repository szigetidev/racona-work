-- Racona Work Plugin - Projektenkénti munkabejegyzés-kategóriák
--
-- Eddig egyetlen közös kategórialista volt minden projekthez. Mostantól minden
-- projektnek saját listája van (work_entry_categories.project_id).
--
-- A régi közös lista sorai project_id = NULL-lal megmaradnak MINTAKÉNT: a
-- projekt Kategóriák fülén egy gombbal átvehetők (copyWorkEntryCategories).
-- Új projekt kategóriák nélkül indul; amíg nincs aktív kategóriája, a
-- bejegyzésnél nem kötelező kategóriát választani.
--
-- A már felvett bejegyzések megmaradnak: minden projekt saját másolatot kap
-- azokról a régi kategóriákról, amelyeket a bejegyzései használnak (a név, a
-- sorrend és az aktív állapot is átjön), és a bejegyzések a másolatra mutatnak.

-- ============================================================================
-- 1. PROJEKT OSZLOP
-- ============================================================================

ALTER TABLE app__racona_work.work_entry_categories
    ADD COLUMN IF NOT EXISTS project_id INTEGER
        REFERENCES app__racona_work.projects(id)
        ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_work_entry_categories_project
    ON app__racona_work.work_entry_categories (project_id, sort_order ASC, id ASC);

-- ============================================================================
-- 2. A HASZNÁLT RÉGI KATEGÓRIÁK MÁSOLÁSA A PROJEKTEKHEZ
-- ============================================================================

DO $block$
DECLARE
    pair   RECORD;
    new_id INTEGER;
BEGIN
    FOR pair IN
        SELECT DISTINCT we.project_id, we.category_id
          FROM app__racona_work.work_entries we
          JOIN app__racona_work.work_entry_categories c ON c.id = we.category_id
         WHERE c.project_id IS NULL
         ORDER BY we.project_id, we.category_id
    LOOP
        INSERT INTO app__racona_work.work_entry_categories
            (project_id, name, sort_order, is_active, created_at, updated_at)
        SELECT pair.project_id, c.name, c.sort_order, c.is_active, NOW(), NOW()
          FROM app__racona_work.work_entry_categories c
         WHERE c.id = pair.category_id
        RETURNING id INTO new_id;

        UPDATE app__racona_work.work_entries
           SET category_id = new_id
         WHERE project_id = pair.project_id
           AND category_id = pair.category_id;
    END LOOP;
END
$block$;
