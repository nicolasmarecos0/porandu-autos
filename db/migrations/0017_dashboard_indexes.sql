CREATE INDEX "opportunities_organization_id_closed_at_idx" ON "opportunities" USING btree ("organization_id","updated_at") WHERE "opportunities"."stage" IN ('won', 'lost');--> statement-breakpoint
-- Custom SQL (no lo genera drizzle-kit) · postcondición de DEC-043 §7: los
-- cierres de un rango del Dashboard Directivo (ventas cerradas, perdidas y
-- tasa de conversión, hasta 366 días) leen este índice parcial y no recorren
-- las oportunidades abiertas. La fecha de cierre de una oportunidad `won` o
-- `lost` es su `updated_at` (DEC-037 §5).
--
-- El índice tiene que existir válido, no único, sobre exactamente
-- (organization_id, updated_at), con organization_id primero (ADR-001 §2:
-- toda lectura filtra por la organización activa) y parcial sobre las dos
-- etapas terminales. Si no, la migración se revierte y no se aplica nada.
--
-- 0017 solo agrega este índice: no crea ni cambia tablas, policies, grants,
-- funciones ni triggers, así que las invariantes de ADR-001 §3.6 que
-- verificó 0016 no cambian y no se repiten acá.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    WHERE i.indrelid = 'public.opportunities'::regclass
      AND c.relname = 'opportunities_organization_id_closed_at_idx'
      AND c.relnamespace = 'public'::regnamespace
      AND i.indisvalid
      AND i.indisready
      AND NOT i.indisunique
      AND i.indnatts = 2
      AND i.indkey[0] = (
        SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.opportunities'::regclass
          AND a.attname = 'organization_id'
          AND NOT a.attisdropped
      )
      AND i.indkey[1] = (
        SELECT a.attnum FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.opportunities'::regclass
          AND a.attname = 'updated_at'
          AND NOT a.attisdropped
      )
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid)
        = '(stage = ANY (ARRAY[''won''::text, ''lost''::text]))'
  ) THEN
    RAISE EXCEPTION 'DEC-043: opportunities need the valid partial index on (organization_id, updated_at) for won and lost closures';
  END IF;
END
$$;
