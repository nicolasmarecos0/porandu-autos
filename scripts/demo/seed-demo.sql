-- =====================================================================
-- Porandú Autos · Lote de demostración (DEC-058)
-- =====================================================================
--
-- Para el SQL Editor de Supabase (corre como `postgres`) o `psql`.
-- Carga en TU organización un lote realista en es-PY:
--
--   · 8 unidades en USD (tres 0 km y cinco usadas): 6 disponibles, 1
--     reservada y 1 vendida;
--   · 12 prospectos con su oportunidad en las cinco etapas, con lo que
--     busca cada uno (el contrato de demanda de DEC-030);
--   · 5 conversaciones de WhatsApp (3 con mensajes sin leer), 2 notas de
--     la bitácora, 6 pruebas de manejo (próximas, vencida, hecha y
--     ausente) y 5 cotizaciones (borrador, aprobada, enviada, aceptada y
--     rechazada).
--
-- No escribe puntajes ni matches: no se persisten (DEC-023, DEC-031,
-- DEC-035). Los calculan los motores en cada lectura a partir de estos
-- datos: Match v0 da el Vehicle Fit y el Top Match con su alternativa, la
-- etapa da el Deal Readiness y la recencia, la penalidad y la NBA.
--
-- Cómo se usa
--   1. Supabase → SQL Editor → New query. Pegá este archivo entero y Run.
--   2. Si tu usuario es admin de una sola organización, no hay que tocar
--      nada. Si no, completá v_admin_email (o v_organization_id) abajo.
--   3. Se puede volver a correr sin duplicar nada: cada fila tiene un id
--      determinista y `ON CONFLICT DO NOTHING`. Para refrescar las fechas
--      (las pruebas "de mañana" dejan de serlo), corré
--      scripts/demo/cleanup-demo.sql y después este archivo.
--
-- Marca de demo: el id de cada fila es
--   md5('porandu-demo:v1:<organization_id>:<clave>')::uuid.
-- La limpieza borra solo esos ids y lo que cuelga de ellos.
--
-- Seguridad
--   · Solo INSERT en tablas de producto de la organización elegida. No
--     crea usuarios, organizaciones, líneas de WhatsApp ni DDL, y no
--     desactiva triggers.
--   · Los teléfonos son ficticios y sin `phone_normalized`: el envío por
--     WhatsApp responde `no_recipient` y nunca le escribe a una persona
--     real (lib/conversations/send.ts).
--   · Todo corre en una sola transacción: si algo falla, no queda nada
--     y la sesión queda limpia.
-- =====================================================================

DO $seed$
DECLARE
  -- ── Configuración (opcional) ─────────────────────────────────────
  -- El email con que entrás a Porandú. NULL: el único admin activo.
  v_admin_email text := NULL;
  -- La organización a cargar. NULL: la del admin.
  v_organization_id uuid := NULL;
  -- ─────────────────────────────────────────────────────────────────

  v_tz constant text := 'America/Asuncion';
  v_org uuid;
  v_admin uuid;
  v_teammate uuid;
  v_ns text;
  v_candidates int;
  v_local_now timestamp;
  v_today timestamp;
  v_slot timestamp;
  v_count int;
  v_inserted int := 0;
BEGIN
  -- 1. Organización y autor ------------------------------------------
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

  SELECT m.organization_id, m.user_id
    INTO v_org, v_admin
    FROM public.memberships m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.active
     AND m.role = 'admin'
     AND (v_admin_email IS NULL OR lower(u.email) = lower(btrim(v_admin_email)))
     AND (v_organization_id IS NULL OR m.organization_id = v_organization_id)
   ORDER BY m.created_at, m.user_id
   LIMIT 1;

  -- Otro miembro activo, si existe: firma las notas, así el Cockpit del
  -- admin las muestra como novedad del equipo (DEC-047). Si no hay, firma
  -- el admin.
  SELECT m.user_id
    INTO v_teammate
    FROM public.memberships m
   WHERE m.organization_id = v_org
     AND m.active
     AND m.user_id <> v_admin
   ORDER BY m.created_at, m.user_id
   LIMIT 1;
  v_teammate := coalesce(v_teammate, v_admin);

  v_ns := 'porandu-demo:v1:' || v_org::text || ':';
  -- Para el resumen del final (también en psql, que confirma el DO solo).
  PERFORM set_config('porandu.demo_org', v_org::text, false);

  -- Reloj de Asunción para las fechas de la agenda y las validez.
  v_local_now := now() AT TIME ZONE v_tz;
  v_today := date_trunc('day', v_local_now);

  -- 2. Stock ----------------------------------------------------------
  INSERT INTO public.vehicles
    (id, organization_id, brand, model, version, year, km, price, currency,
     status, created_at, updated_at)
  SELECT md5(v_ns || 'vehicle:' || v.key)::uuid, v_org, v.brand, v.model,
         v.version, v.year, v.km, v.price, 'USD', v.status,
         now() - v.created_ago, now() - v.updated_ago
    FROM (VALUES
      ('hilux-srv', 'Toyota', 'Hilux', 'SRV 2.8 TDI 4x4 AT', 2026::smallint, 0, 56900.00::numeric, 'available', interval '21 days', interval '21 days'),
      ('hilux-sr', 'Toyota', 'Hilux', 'SR 2.8 TDI 4x4 MT', 2023::smallint, 61200, 38900.00::numeric, 'available', interval '34 days', interval '33 days'),
      ('corolla-cross', 'Toyota', 'Corolla Cross', 'XEi 1.8 Hybrid CVT', 2026::smallint, 0, 37900.00::numeric, 'available', interval '9 days', interval '8 days'),
      ('tucson', 'Hyundai', 'Tucson', 'GLS 2.0 AT', 2024::smallint, 38500, 28900.00::numeric, 'available', interval '47 days', interval '45 days'),
      ('creta', 'Hyundai', 'Creta', 'Limited 1.6 AT', 2026::smallint, 0, 26500.00::numeric, 'available', interval '12 days', interval '11 days'),
      ('sportage', 'Kia', 'Sportage', 'EX 2.0 AT', 2023::smallint, 52300, 25500.00::numeric, 'available', interval '63 days', interval '60 days'),
      ('amarok', 'Volkswagen', 'Amarok', 'Highline V6 3.0 TDI AT', 2022::smallint, 74000, 41500.00::numeric, 'reserved', interval '28 days', interval '3 days'),
      ('kicks', 'Nissan', 'Kicks', 'Exclusive 1.6 CVT', 2024::smallint, 29400, 21900.00::numeric, 'sold', interval '40 days', interval '2 days')
    ) AS v(key, brand, model, version, year, km, price, status, created_ago, updated_ago)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- 3. Prospectos -----------------------------------------------------
  -- Teléfono visible ficticio y sin phone_normalized: nadie real recibe
  -- un mensaje desde la demo.
  INSERT INTO public.contacts
    (id, organization_id, name, phone, phone_normalized, city, created_at,
     updated_at)
  SELECT md5(v_ns || 'contact:' || c.key)::uuid, v_org, c.name, c.phone,
         NULL, c.city, now() - c.created_ago, now() - c.created_ago
    FROM (VALUES
      ('o01', 'María José Benítez', '0900 000 101', 'Asunción', interval '12 days'),
      ('o02', 'Carlos Giménez', '0900 000 102', 'Luque', interval '3 days'),
      ('o03', 'Lucía Ramírez', '0900 000 103', 'San Lorenzo', interval '40 minutes'),
      ('o04', 'Jorge Villalba', '0900 000 104', 'Fernando de la Mora', interval '15 days'),
      ('o05', 'Ana Paula Ortiz', '0900 000 105', 'Lambaré', interval '9 days'),
      ('o06', 'Diego Fernández', '0900 000 106', 'Capiatá', interval '8 minutes'),
      ('o07', 'Sofía Martínez', '0900 000 107', 'Asunción', interval '1 day 3 hours'),
      ('o08', 'Roberto Acosta', '0900 000 108', 'Encarnación', interval '7 days'),
      ('o09', 'Valeria Duarte', '0900 000 109', 'Mariano Roque Alonso', interval '10 days'),
      ('o10', 'Martín Cáceres', '0900 000 110', 'Ciudad del Este', interval '26 hours'),
      ('o11', 'Patricia Insfrán', '0900 000 111', 'Asunción', interval '14 days'),
      ('o12', 'Fernando Ayala', '0900 000 112', 'Itauguá', interval '4 days')
    ) AS c(key, name, phone, city, created_ago)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- 4. Oportunidades --------------------------------------------------
  -- La recencia se fija acá: el trigger de actividad (DEC-036) solo la
  -- adelanta a now() con una nota o un mensaje nuevo vinculado, y no
  -- admite otra escritura. Por eso solo las oportunidades "calientes"
  -- (o01, o06) tienen notas o mensajes vinculados.
  INSERT INTO public.opportunities
    (id, organization_id, contact_id, stage, source, vehicle_id,
     loss_reason, loss_notes, sale_price, sale_currency, payment_method,
     delivery_status, delivery_date, last_activity_at, created_at,
     updated_at)
  SELECT md5(v_ns || 'opportunity:' || o.key)::uuid, v_org,
         md5(v_ns || 'contact:' || o.key)::uuid, o.stage, o.source,
         CASE WHEN o.vehicle IS NULL THEN NULL
              ELSE md5(v_ns || 'vehicle:' || o.vehicle)::uuid END,
         o.loss_reason, o.loss_notes,
         o.sale_price,
         CASE WHEN o.sale_price IS NULL THEN NULL ELSE 'USD' END,
         o.payment_method,
         CASE WHEN o.stage = 'won' THEN 'scheduled' END,
         CASE WHEN o.stage = 'won' THEN (v_today + interval '3 days')::date END,
         now() - o.activity_ago, now() - o.created_ago,
         now() - coalesce(o.updated_ago, o.created_ago)
    FROM (VALUES
      ('o01', 'negotiating', 'whatsapp', 'hilux-srv', NULL::text, NULL::text, NULL::numeric, NULL::text, interval '4 minutes', interval '12 days', interval '5 days'),
      ('o02', 'qualifying', 'meta_ads', NULL, NULL, NULL, NULL, NULL, interval '25 minutes', interval '3 days', interval '2 days'),
      ('o03', 'new', 'web', NULL, NULL, NULL, NULL, NULL, interval '38 minutes', interval '40 minutes', NULL::interval),
      ('o04', 'negotiating', 'showroom', 'amarok', NULL, NULL, NULL, NULL, interval '3 days 2 hours', interval '15 days', interval '4 days'),
      ('o05', 'qualifying', 'referral', NULL, NULL, NULL, NULL, NULL, interval '6 days 3 hours', interval '9 days', interval '7 days'),
      ('o06', 'new', 'whatsapp', NULL, NULL, NULL, NULL, NULL, interval '2 minutes', interval '8 minutes', NULL),
      ('o07', 'new', 'meta_ads', NULL, NULL, NULL, NULL, NULL, interval '1 day 3 hours', interval '1 day 3 hours', NULL),
      ('o08', 'negotiating', 'showroom', NULL, NULL, NULL, NULL, NULL, interval '5 hours', interval '7 days', interval '1 day'),
      ('o09', 'lost', 'web', NULL, 'price', 'Consiguió una Sportage 2023 más barata en otra agencia.', NULL, NULL, interval '4 days', interval '10 days', interval '4 days'),
      ('o10', 'qualifying', 'referral', NULL, NULL, NULL, NULL, NULL, interval '26 hours', interval '26 hours', interval '20 hours'),
      ('o11', 'won', 'showroom', 'kicks', NULL, NULL, 21400.00, 'financing', interval '2 days', interval '14 days', interval '2 days'),
      ('o12', 'qualifying', 'whatsapp', NULL, NULL, NULL, NULL, NULL, interval '10 hours', interval '4 days', interval '3 days')
    ) AS o(key, stage, source, vehicle, loss_reason, loss_notes, sale_price, payment_method, activity_ago, created_ago, updated_ago)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- 5. Lo que busca cada uno (DEC-030) --------------------------------
  -- Un acto humano confirmado por fact, firmado por el admin. o07 no
  -- tiene demanda: muestra el "Sin dato" honesto (DEC-005).
  INSERT INTO public.opportunity_demand_facts
    (id, organization_id, opportunity_id, fact, status, source_kind,
     recorded_by, recorded_at, brand, model, year_min, year_max, amount,
     currency, purchase_type, trade_in, evidence_text)
  SELECT md5(v_ns || 'demand:' || d.key || ':' || d.fact)::uuid, v_org,
         md5(v_ns || 'opportunity:' || d.key)::uuid, d.fact, 'confirmed',
         'member', v_admin,
         now() - o.created_ago + interval '5 minutes',
         d.brand, d.model, d.year_min, d.year_max, d.amount,
         CASE WHEN d.amount IS NULL THEN NULL ELSE 'USD' END,
         d.purchase_type, d.trade_in, d.evidence
    FROM (VALUES
      ('o01', 'desired_vehicle', 'Toyota', 'Hilux', NULL::smallint, NULL::smallint, NULL::numeric, NULL::text, NULL::boolean, 'Consultó por WhatsApp por la SRV 0 km.'),
      ('o01', 'year_range', NULL, NULL, 2025, 2027, NULL, NULL, NULL, NULL),
      ('o01', 'budget_max', NULL, NULL, NULL, NULL, 58000.00, NULL, NULL, NULL),
      ('o01', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'financed', NULL, NULL),
      ('o01', 'trade_in_intent', NULL, NULL, NULL, NULL, NULL, NULL, true, 'Entrega su Hilux 2018.'),
      ('o01', 'down_payment', NULL, NULL, NULL, NULL, 20000.00, NULL, NULL, NULL),
      ('o02', 'desired_vehicle', 'Toyota', 'Corolla Cross', NULL, NULL, NULL, NULL, NULL, NULL),
      ('o02', 'year_range', NULL, NULL, 2025, 2027, NULL, NULL, NULL, NULL),
      ('o02', 'budget_max', NULL, NULL, NULL, NULL, 39000.00, NULL, NULL, NULL),
      ('o02', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'cash', NULL, NULL),
      ('o02', 'trade_in_intent', NULL, NULL, NULL, NULL, NULL, NULL, false, NULL),
      ('o03', 'desired_vehicle', 'Hyundai', 'Tucson', NULL, NULL, NULL, NULL, NULL, 'Formulario web.'),
      ('o03', 'year_range', NULL, NULL, 2023, 2026, NULL, NULL, NULL, NULL),
      ('o03', 'budget_max', NULL, NULL, NULL, NULL, 30000.00, NULL, NULL, NULL),
      ('o03', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'financed', NULL, NULL),
      ('o03', 'down_payment', NULL, NULL, NULL, NULL, 8000.00, NULL, NULL, NULL),
      ('o04', 'desired_vehicle', 'Volkswagen', 'Amarok', NULL, NULL, NULL, NULL, NULL, NULL),
      ('o04', 'year_range', NULL, NULL, 2021, 2024, NULL, NULL, NULL, NULL),
      ('o04', 'budget_max', NULL, NULL, NULL, NULL, 43000.00, NULL, NULL, NULL),
      ('o04', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'financed', NULL, NULL),
      ('o04', 'trade_in_intent', NULL, NULL, NULL, NULL, NULL, NULL, true, NULL),
      ('o04', 'down_payment', NULL, NULL, NULL, NULL, 15000.00, NULL, NULL, NULL),
      ('o05', 'desired_vehicle', 'Toyota', 'Hilux', NULL, NULL, NULL, NULL, NULL, NULL),
      ('o05', 'year_range', NULL, NULL, 2022, 2025, NULL, NULL, NULL, NULL),
      ('o05', 'budget_max', NULL, NULL, NULL, NULL, 42000.00, NULL, NULL, NULL),
      ('o05', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'financed', NULL, NULL),
      ('o05', 'trade_in_intent', NULL, NULL, NULL, NULL, NULL, NULL, false, NULL),
      ('o06', 'desired_vehicle', 'Kia', 'Sportage', NULL, NULL, NULL, NULL, NULL, 'Escribió por WhatsApp.'),
      ('o06', 'budget_max', NULL, NULL, NULL, NULL, 24000.00, NULL, NULL, NULL),
      ('o06', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'undecided', NULL, NULL),
      ('o08', 'desired_vehicle', 'Hyundai', 'Creta', NULL, NULL, NULL, NULL, NULL, NULL),
      ('o08', 'year_range', NULL, NULL, 2025, NULL, NULL, NULL, NULL, NULL),
      ('o08', 'budget_max', NULL, NULL, NULL, NULL, 27000.00, NULL, NULL, NULL),
      ('o08', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'cash', NULL, NULL),
      ('o08', 'trade_in_intent', NULL, NULL, NULL, NULL, NULL, NULL, false, NULL),
      ('o09', 'desired_vehicle', 'Kia', 'Sportage', NULL, NULL, NULL, NULL, NULL, NULL),
      ('o09', 'year_range', NULL, NULL, 2022, NULL, NULL, NULL, NULL, NULL),
      ('o09', 'budget_max', NULL, NULL, NULL, NULL, 23000.00, NULL, NULL, NULL),
      ('o09', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'cash', NULL, NULL),
      ('o10', 'desired_vehicle', 'Toyota', NULL, NULL, NULL, NULL, NULL, NULL, 'Le da igual el modelo si es Toyota.'),
      ('o10', 'year_range', NULL, NULL, 2024, NULL, NULL, NULL, NULL, NULL),
      ('o10', 'budget_max', NULL, NULL, NULL, NULL, 40000.00, NULL, NULL, NULL),
      ('o10', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'financed', NULL, NULL),
      ('o10', 'trade_in_intent', NULL, NULL, NULL, NULL, NULL, NULL, true, NULL),
      ('o10', 'down_payment', NULL, NULL, NULL, NULL, 0.00, NULL, NULL, NULL),
      ('o11', 'desired_vehicle', 'Nissan', 'Kicks', NULL, NULL, NULL, NULL, NULL, NULL),
      ('o11', 'year_range', NULL, NULL, 2023, NULL, NULL, NULL, NULL, NULL),
      ('o11', 'budget_max', NULL, NULL, NULL, NULL, 23000.00, NULL, NULL, NULL),
      ('o11', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'financed', NULL, NULL),
      ('o12', 'desired_vehicle', 'Hyundai', 'Tucson', NULL, NULL, NULL, NULL, NULL, NULL),
      ('o12', 'year_range', NULL, NULL, 2021, 2024, NULL, NULL, NULL, NULL),
      ('o12', 'budget_max', NULL, NULL, NULL, NULL, 27000.00, NULL, NULL, NULL),
      ('o12', 'purchase_type', NULL, NULL, NULL, NULL, NULL, 'financed', NULL, NULL),
      ('o12', 'trade_in_intent', NULL, NULL, NULL, NULL, NULL, NULL, true, 'Entrega su Tucson 2016.'),
      ('o12', 'down_payment', NULL, NULL, NULL, NULL, 6000.00, NULL, NULL, NULL)
    ) AS d(key, fact, brand, model, year_min, year_max, amount, purchase_type, trade_in, evidence)
    JOIN (VALUES
      ('o01', interval '12 days'), ('o02', interval '3 days'),
      ('o03', interval '40 minutes'), ('o04', interval '15 days'),
      ('o05', interval '9 days'), ('o06', interval '8 minutes'),
      ('o08', interval '7 days'), ('o09', interval '10 days'),
      ('o10', interval '26 hours'), ('o11', interval '14 days'),
      ('o12', interval '4 days')
    ) AS o(key, created_ago) USING (key)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- 6. Conversaciones de WhatsApp -------------------------------------
  INSERT INTO public.conversations
    (id, organization_id, contact_id, channel, status, last_message_at,
     last_message_preview, created_at, updated_at)
  SELECT md5(v_ns || 'conversation:' || c.key)::uuid, v_org,
         md5(v_ns || 'contact:' || c.key)::uuid, 'whatsapp', 'open',
         now() - c.last_ago, c.preview, now() - c.created_ago,
         now() - c.last_ago
    FROM (VALUES
      ('o01', interval '4 minutes', interval '3 days', 'Ya vi la cotización. ¿Me confirman si incluye el seguro del primer año?'),
      ('o02', interval '25 minutes', interval '50 minutes', '¡Hola Carlos! Sí, te reservamos un turno hoy. Te esperamos en el salón.'),
      ('o05', interval '6 days 3 hours', interval '6 days 3 hours', '¿Siguen teniendo la Hilux 2023? Quiero saber si aceptan financiación.'),
      ('o06', interval '2 minutes', interval '6 minutes', 'Tengo hasta 24.000 dólares más o menos.'),
      ('o12', interval '10 hours', interval '11 hours', 'Hola Fernando, sí: tiene todos los services en la concesionaria. Mañana te paso la tasación del usado.')
    ) AS c(key, last_ago, created_ago, preview)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- Mensajes: como la ingesta (DEC-039) y el envío (DEC-040). Solo o01 y
  -- o06 los vinculan a la oportunidad (el trigger los pone en "ahora");
  -- el resto quedan en la conversación, como cuando el cliente escribió
  -- antes de que existiera la oportunidad. Sin leer (DEC-044 §2): o01,
  -- o05 y o06, que no tienen una respuesta del admin después del último
  -- entrante.
  INSERT INTO public.messages
    (id, organization_id, contact_id, opportunity_id, conversation_id,
     channel, direction, content, recorded_by, external_id, sent_at,
     created_at)
  SELECT md5(v_ns || 'message:' || m.key || ':' || m.seq)::uuid, v_org,
         md5(v_ns || 'contact:' || m.key)::uuid,
         CASE WHEN m.linked THEN md5(v_ns || 'opportunity:' || m.key)::uuid END,
         md5(v_ns || 'conversation:' || m.key)::uuid,
         'whatsapp', m.direction, m.content,
         CASE WHEN m.direction = 'outbound' THEN v_admin END,
         'wamid.porandu-demo.' || md5(v_ns || 'message:' || m.key || ':' || m.seq),
         now() - m.ago, now() - m.ago
    FROM (VALUES
      ('o01', 1, false, 'inbound', 'Hola, ¿la Hilux SRV 0 km sigue disponible? Me interesa financiada.', interval '3 days'),
      ('o01', 2, false, 'outbound', '¡Hola María José! Sí, está disponible. ¿Te queda bien venir el jueves a probarla?', interval '2 days 23 hours'),
      ('o01', 3, true, 'inbound', 'Ya vi la cotización. ¿Me confirman si incluye el seguro del primer año?', interval '4 minutes'),
      ('o02', 1, false, 'inbound', 'Buenas, vi el anuncio del Corolla Cross híbrido. ¿Hacen prueba de manejo hoy?', interval '50 minutes'),
      ('o02', 2, false, 'outbound', '¡Hola Carlos! Sí, te reservamos un turno hoy. Te esperamos en el salón.', interval '25 minutes'),
      ('o05', 1, false, 'inbound', '¿Siguen teniendo la Hilux 2023? Quiero saber si aceptan financiación.', interval '6 days 3 hours'),
      ('o06', 1, true, 'inbound', 'Hola, busco una Sportage. ¿Qué precio tiene la 2023?', interval '6 minutes'),
      ('o06', 2, true, 'inbound', 'Tengo hasta 24.000 dólares más o menos.', interval '2 minutes'),
      ('o12', 1, false, 'inbound', '¿La Tucson 2024 tiene service oficial? Puedo entregar mi Tucson 2016.', interval '11 hours'),
      ('o12', 2, false, 'outbound', 'Hola Fernando, sí: tiene todos los services en la concesionaria. Mañana te paso la tasación del usado.', interval '10 hours')
    ) AS m(key, seq, linked, direction, content, ago)
   ORDER BY m.ago DESC
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- Estados de entrega de las respuestas (DEC-044 §3.3).
  INSERT INTO public.message_statuses
    (organization_id, message_id, status, occurred_at, created_at)
  SELECT v_org, md5(v_ns || 'message:' || s.key || ':' || s.seq)::uuid,
         s.status, now() - s.ago, now() - s.ago
    FROM (VALUES
      ('o01', 2, 'sent', interval '2 days 23 hours'),
      ('o01', 2, 'delivered', interval '2 days 22 hours 59 minutes'),
      ('o01', 2, 'read', interval '2 days 22 hours 40 minutes'),
      ('o02', 2, 'sent', interval '25 minutes'),
      ('o02', 2, 'delivered', interval '24 minutes'),
      ('o02', 2, 'read', interval '20 minutes'),
      ('o12', 2, 'sent', interval '10 hours'),
      ('o12', 2, 'delivered', interval '9 hours 59 minutes')
    ) AS s(key, seq, status, ago)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- 7. Bitácora (DEC-033) ---------------------------------------------
  INSERT INTO public.opportunity_notes
    (id, organization_id, opportunity_id, body, recorded_by, recorded_at)
  SELECT md5(v_ns || 'note:' || n.key || ':' || n.seq)::uuid, v_org,
         md5(v_ns || 'opportunity:' || n.key)::uuid, n.body, v_teammate,
         now() - n.ago
    FROM (VALUES
      ('o01', 1, 'Entrega su Hilux 2018 con unos 140.000 km como parte de pago. Pidió tasación antes de cerrar.', interval '2 days'),
      ('o01', 2, 'Hizo la prueba de manejo y le encantó la SRV. Consulta financiación a 36 meses con USD 20.000 de entrega.', interval '1 day 2 hours')
    ) AS n(key, seq, body, ago)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- 8. Pruebas de manejo (DEC-041) ------------------------------------
  -- Próxima de hoy: dentro de dos horas, entre las 9 y las 18 de
  -- Asunción; si ya es tarde, mañana a las 9.
  v_slot := date_trunc('hour', v_local_now) + interval '2 hours';
  IF v_slot < v_today + interval '9 hours' THEN
    v_slot := v_today + interval '9 hours';
  ELSIF v_slot > v_today + interval '18 hours' THEN
    v_slot := v_today + interval '1 day 9 hours';
  END IF;

  INSERT INTO public.test_drives
    (id, organization_id, opportunity_id, vehicle_id, scheduled_at, status,
     created_by, created_at, updated_at)
  SELECT md5(v_ns || 'test-drive:' || t.key)::uuid, v_org,
         md5(v_ns || 'opportunity:' || t.opportunity)::uuid,
         md5(v_ns || 'vehicle:' || t.vehicle)::uuid,
         t.local_at AT TIME ZONE v_tz, t.status, v_admin,
         least(now(), t.local_at AT TIME ZONE v_tz) - interval '1 day',
         CASE WHEN t.status IN ('completed', 'no_show')
              THEN (t.local_at AT TIME ZONE v_tz) + interval '2 hours'
              ELSE least(now(), t.local_at AT TIME ZONE v_tz) - interval '1 day' END
    FROM (VALUES
      ('o02-today', 'o02', 'corolla-cross', v_slot, 'confirmed'),
      ('o10-tomorrow', 'o10', 'corolla-cross', v_today + interval '1 day 10 hours 30 minutes', 'scheduled'),
      ('o03-later', 'o03', 'tucson', v_today + interval '3 days 16 hours', 'scheduled'),
      ('o04-overdue', 'o04', 'amarok', v_today - interval '1 day' + interval '16 hours', 'scheduled'),
      ('o01-done', 'o01', 'hilux-srv', v_today - interval '3 days' + interval '11 hours', 'completed'),
      ('o12-no-show', 'o12', 'tucson', v_today - interval '4 days' + interval '15 hours', 'no_show')
    ) AS t(key, opportunity, vehicle, local_at, status)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  -- 9. Cotizaciones (DEC-042, DEC-046) --------------------------------
  -- El número lo asigna el trigger. Lista = precio publicado de la
  -- unidad; el total respeta el descuento (quotes_total_price_check) y la
  -- validez, hasta 30 días desde el alta (día de Asunción).
  INSERT INTO public.quotes
    (id, organization_id, opportunity_id, vehicle_id, status, currency,
     list_price, discount_kind, discount_value, total_price, valid_until,
     notes, created_by, approved_by, approved_at, sent_at, decided_at,
     created_at, updated_at)
  SELECT md5(v_ns || 'quote:' || q.key)::uuid, v_org,
         md5(v_ns || 'opportunity:' || q.key)::uuid,
         md5(v_ns || 'vehicle:' || q.vehicle)::uuid,
         q.status, 'USD', q.list_price, q.discount_kind, q.discount_value,
         CASE q.discount_kind
           WHEN 'none' THEN q.list_price
           WHEN 'amount' THEN q.list_price - q.discount_value
           ELSE round(q.list_price * (100 - q.discount_value) / 100, 2)
         END,
         ((now() - q.created_ago) AT TIME ZONE v_tz)::date + q.valid_days,
         q.notes, v_admin,
         CASE WHEN q.approved_ago IS NULL THEN NULL ELSE v_admin END,
         now() - q.approved_ago, now() - q.sent_ago, now() - q.decided_ago,
         now() - q.created_ago,
         now() - coalesce(q.decided_ago, q.sent_ago, q.approved_ago, q.created_ago)
    FROM (VALUES
      ('o01', 'hilux-srv', 'sent', 56900.00::numeric, 'amount', 1400.00::numeric, 10, 'Incluye patentamiento y el primer service.', interval '2 days', interval '2 days' - interval '1 hour', interval '1 day', NULL::interval),
      ('o04', 'amarok', 'draft', 41500.00, 'percent', 5.00, 7, 'Descuento sujeto a la tasación del usado.', interval '2 hours', NULL, NULL, NULL),
      ('o08', 'creta', 'approved', 26500.00, 'none', NULL, 7, NULL, interval '4 hours', interval '3 hours', NULL, NULL),
      ('o11', 'kicks', 'accepted', 21900.00, 'amount', 500.00, 15, NULL, interval '5 days', interval '5 days' - interval '2 hours', interval '4 days', interval '2 days'),
      ('o09', 'sportage', 'rejected', 25500.00, 'percent', 4.00, 15, NULL, interval '9 days', interval '9 days' - interval '1 hour', interval '8 days', interval '4 days')
    ) AS q(key, vehicle, status, list_price, discount_kind, discount_value, valid_days, notes, created_ago, approved_ago, sent_ago, decided_ago)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_inserted := v_inserted + v_count;

  IF v_inserted = 0 THEN
    RAISE NOTICE 'Porandú demo: el lote ya estaba cargado en la organización %. No se insertó nada.', v_org;
  ELSE
    RAISE NOTICE 'Porandú demo: % filas nuevas en la organización %.', v_inserted, v_org;
  END IF;
END
$seed$;

-- Resumen: lo que tiene ahora la organización (demo y propio).
SELECT r.item AS "Organización cargada", r.total AS "Total"
  FROM (
    SELECT 1, 'Unidades en stock', count(*) FROM public.vehicles
     WHERE organization_id = current_setting('porandu.demo_org', true)::uuid
    UNION ALL
    SELECT 2, 'Oportunidades', count(*) FROM public.opportunities
     WHERE organization_id = current_setting('porandu.demo_org', true)::uuid
    UNION ALL
    SELECT 3, 'Conversaciones', count(*) FROM public.conversations
     WHERE organization_id = current_setting('porandu.demo_org', true)::uuid
    UNION ALL
    SELECT 4, 'Pruebas de manejo', count(*) FROM public.test_drives
     WHERE organization_id = current_setting('porandu.demo_org', true)::uuid
    UNION ALL
    SELECT 5, 'Cotizaciones', count(*) FROM public.quotes
     WHERE organization_id = current_setting('porandu.demo_org', true)::uuid
  ) AS r(position, item, total)
 ORDER BY r.position;
