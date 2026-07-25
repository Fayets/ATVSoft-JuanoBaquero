-- Defaults para leads (Neon / Postgres). Tabla habitual: `lead`.
--
-- agendo_en: texto del canal donde agendó (ej. Chat, Youtube); misma semántica que el JSON de la API.

UPDATE lead SET origen = 'Setter' WHERE origen IS NULL OR origen = '';
UPDATE lead SET agendo_en = 'Chat' WHERE agendo_en IS NULL OR trim(agendo_en) = '';
