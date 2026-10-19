-- Racona Work Plugin - Alapértelmezett kategória projekttagonként
--
-- A projekt kezelője minden tagnak beállíthat egy alapértelmezett kategóriát a
-- projekt saját listájából. A munka rögzítésekor ez előre ki van választva, így
-- aki szinte mindig ugyanazzal foglalkozik, annak nem kell válogatnia.
-- Ha a kategóriát törlik, az alapértelmezés üresre áll.

ALTER TABLE app__racona_work.project_members
    ADD COLUMN IF NOT EXISTS default_category_id INTEGER
        REFERENCES app__racona_work.work_entry_categories(id)
        ON DELETE SET NULL;
