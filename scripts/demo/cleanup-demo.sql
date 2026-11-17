-- =====================================================================
-- Porandú Autos · Limpieza del lote de demostración (DEC-058)
-- =====================================================================
--
-- Borra de TU organización lo que cargó scripts/demo/seed-demo.sql: las
-- filas con ids demo (md5('porandu-demo:v1:<organization_id>:<clave>'))
-- y todo lo que cuelga de ellas, también lo que se haya hecho sobre la
-- demo desde la app (notas, cotizaciones, pruebas, tomas de usados,
-- entregas pendientes, mensajes y lecturas).
--
-- Nunca toca filas propias que no dependan de la demo: los datos reales
-- de la organización quedan como estaban. Sin DDL, sin CASCADE y sin
-- desactivar triggers.
--
-- Se niega, sin borrar nada, si:
--   · una oportunidad demo tiene una entrega completada (DEC-054 la
--     conserva: una unidad que salió del salón no se borra);
--   · una oportunidad propia usa una unidad demo, o tiene a un prospecto
--     demo (desvinculalas o cerralas antes).
--
-- Mismo uso que el seed: SQL Editor de Supabase → Run. Si tu usuario es
-- admin de una sola organización, no hay que tocar nada.
-- =====================================================================

DO $cleanup$
DECLARE
  -- ── Configuración (opcional): la misma del seed ──────────────────
  v_admin_email text := NULL;
  v_organization_id uuid := NULL;
  -- ─────────────────────────────────────────────────────────────────

  v_org uuid;
  v_ns text;
  v_candidates int;
  v_vehicles uuid[];
  v_contacts uuid[];
  v_opportunities uuid[];
  v_converted uuid[];
  v_count int;
  v_deleted int := 0;
BEGIN
  SELECT count(DISTINCT m.organization_id)
    INTO v_candidates
    FROM public.memberships m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.active
     AND m.role = 'admin'
     AND (v_admin_email IS NULL OR lower(u.email) = lower(btrim(v_admin_email)))
     AND (v_organization_id IS NULL OR m.organization_id = v_organization_id);

  IF v_candidates = 0 THEN
    RAISE EXCEPTION 'No encontré un admin activo con esos datos. Revisá v_admin_email / v_organization_id.';
  ELSIF v_candidates > 1 THEN
    RAISE EXCEPTION 'Hay % organizaciones posibles. Completá v_admin_email o v_organization_id al principio del script.', v_candidates;
  END IF;

  SELECT m.organization_id
    INTO v_org
    FROM public.memberships m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.active
     AND m.role = 'admin'
     AND (v_admin_email IS NULL OR lower(u.email) = lower(btrim(v_admin_email)))
     AND (v_organization_id IS NULL OR m.organization_id = v_organization_id)
   LIMIT 1;

  v_ns := 'porandu-demo:v1:' || v_org::text || ':';

  -- Los ids demo (las mismas claves que el seed).
  SELECT array_agg(md5(v_ns || 'vehicle:' || k)::uuid)
    INTO v_vehicles
    FROM unnest(ARRAY['hilux-srv', 'hilux-sr', 'corolla-cross', 'tucson',
                      'creta', 'sportage', 'amarok', 'kicks']) AS k;
  SELECT array_agg(md5(v_ns || 'contact:' || k)::uuid),
         array_agg(md5(v_ns || 'opportunity:' || k)::uuid)
    INTO v_contacts, v_opportunities
    FROM unnest(ARRAY['o01', 'o02', 'o03', 'o04', 'o05', 'o06', 'o07',
                      'o08', 'o09', 'o10', 'o11', 'o12']) AS k;

  -- Guardas: nada se borra si algo propio depende de la demo.
  IF EXISTS (
    SELECT FROM public.deliveries
     WHERE organization_id = v_org
       AND status = 'completed'
       AND (opportunity_id = ANY (v_opportunities) OR vehicle_id = ANY (v_vehicles))
  ) THEN
    RAISE EXCEPTION 'Una oportunidad demo tiene una entrega completada: se conserva (DEC-054). No se borró nada.';
  END IF;

  IF EXISTS (
    SELECT FROM public.opportunities
     WHERE organization_id = v_org
       AND NOT (id = ANY (v_opportunities))
       AND (vehicle_id = ANY (v_vehicles) OR contact_id = ANY (v_contacts))
  ) THEN
    RAISE EXCEPTION 'Una oportunidad propia usa una unidad o un prospecto demo. Desvinculala antes. No se borró nada.';
  END IF;

  -- Mensajes, estados y lecturas de las conversaciones demo.
  DELETE FROM public.message_statuses s
   USING public.messages m
   WHERE s.organization_id = v_org
     AND m.organization_id = v_org
     AND m.id = s.message_id
     AND m.contact_id = ANY (v_contacts);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.conversation_reads r
   USING public.conversations c
   WHERE r.organization_id = v_org
     AND c.organization_id = v_org
     AND c.id = r.conversation_id
     AND c.contact_id = ANY (v_contacts);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.messages
   WHERE organization_id = v_org AND contact_id = ANY (v_contacts);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.conversations
   WHERE organization_id = v_org AND contact_id = ANY (v_contacts);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  -- Lo que cuelga de las oportunidades y las unidades demo.
  DELETE FROM public.deliveries
   WHERE organization_id = v_org
     AND (opportunity_id = ANY (v_opportunities) OR vehicle_id = ANY (v_vehicles));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  -- Un usado aceptado entra al stock como unidad nueva (DEC-052): si salió
  -- de una oportunidad demo, también es demo y se borra si nada más la usa.
  SELECT array_agg(converted_vehicle_id)
    INTO v_converted
    FROM public.trade_ins
   WHERE organization_id = v_org
     AND opportunity_id = ANY (v_opportunities)
     AND converted_vehicle_id IS NOT NULL;

  DELETE FROM public.trade_ins
   WHERE organization_id = v_org AND opportunity_id = ANY (v_opportunities);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.quotes
   WHERE organization_id = v_org
     AND (opportunity_id = ANY (v_opportunities) OR vehicle_id = ANY (v_vehicles));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.test_drives
   WHERE organization_id = v_org
     AND (opportunity_id = ANY (v_opportunities) OR vehicle_id = ANY (v_vehicles));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.opportunity_notes
   WHERE organization_id = v_org AND opportunity_id = ANY (v_opportunities);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  -- Ledger append-only (DEC-030): solo el owner puede borrarlo, y solo
  -- las filas de las oportunidades demo. Una sola sentencia: las cadenas
  -- de correcciones (target / previous) se van juntas.
  DELETE FROM public.opportunity_demand_facts
   WHERE organization_id = v_org AND opportunity_id = ANY (v_opportunities);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.opportunities
   WHERE organization_id = v_org AND id = ANY (v_opportunities);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.contacts
   WHERE organization_id = v_org AND id = ANY (v_contacts);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  DELETE FROM public.vehicles v
   WHERE v.organization_id = v_org
     AND (v.id = ANY (v_vehicles) OR v.id = ANY (coalesce(v_converted, '{}')))
     AND NOT EXISTS (SELECT FROM public.opportunities o
                      WHERE o.organization_id = v_org AND o.vehicle_id = v.id)
     AND NOT EXISTS (SELECT FROM public.quotes q
                      WHERE q.organization_id = v_org AND q.vehicle_id = v.id)
     AND NOT EXISTS (SELECT FROM public.test_drives t
                      WHERE t.organization_id = v_org AND t.vehicle_id = v.id)
     AND NOT EXISTS (SELECT FROM public.deliveries d
                      WHERE d.organization_id = v_org AND d.vehicle_id = v.id)
     AND NOT EXISTS (SELECT FROM public.trade_ins ti
                      WHERE ti.organization_id = v_org
                        AND ti.converted_vehicle_id = v.id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted := v_deleted + v_count;

  RAISE NOTICE 'Porandú demo: % filas borradas de la organización %.', v_deleted, v_org;
END
$cleanup$;
