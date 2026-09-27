**PORANDÚ AUTOS  /  TECHNICAL BLUEPRINT  v1.1**

**PORANDÚ AUTOS**

**Technical Blueprint**

Tesis consolidada + Productivo 1 + arquitectura de evolución

| **DECISIÓN OFICIAL** Porandú Autos queda definido como el proyecto prioritario. Su objetivo central es ayudar a una playa o showroom a vender más vehículos. La administración existe como soporte de ese objetivo. La visión de largo plazo es construir la infraestructura de inteligencia comercial para el sector automotor latinoamericano. |
| --- |

**Versión 1.1  ·  Estado: BASELINE APROBADA**

Fecha: 12 de septiembre de 2026

Alcance: producto, UX, datos, integraciones, arquitectura, roadmap y criterios de aceptación

# **Control del documento**

| **Campo** | **Definición** |
| --- | --- |
| **Producto** | Porandú Autos |
| **Categoría** | Automotive Revenue OS / Sales Engine |
| **Versión** | 1.1 |
| **Estado** | Baseline consolidada y scope freeze antes de repositorio |
| **Cliente inicial** | Playas y showrooms con volumen real de stock, WhatsApp activo y cartera histórica de consultas |
| **North Star** | Ventas influenciadas por Porandú |
| **Principio rector** | Construir software para vender más autos; administrar solo lo necesario y convertir datos comerciales en mejores decisiones. |
| **Regla de cambio** | No reabrir decisiones selladas salvo evidencia nueva de usuario, piloto, datos o restricción técnica real. |
| Visión | Construir la infraestructura de inteligencia comercial para el sector automotor latinoamericano. |
| Intelligence Layer | Porandú Memory + Qualification + Match + Next Best Action + Attribution; Demand/Marketing Intelligence en evolución. |

## **Índice**

1. Tesis consolidada, visión y posicionamiento

2. Cliente objetivo, problemas y jobs-to-be-done

3. Arquitectura funcional: tres motores + Intelligence Layer

4. Productivo 1: alcance definitivo

5. Navegación y mapa de pantallas

6. Flujos operativos críticos

7. Corazón conversacional / WhatsApp

8. Stock Match Engine y reactivación

9. Trade-In Auto-Funnel

10. Modelo de datos y multi-tenancy

11. Arquitectura técnica

12. Seguridad, permisos y auditoría

13. Métricas, atribución y observabilidad

14. Roadmap de evolución y expansión

15. Orden de construcción e hitos

16. Criterios de aceptación de Productivo 1

17. Decisiones selladas, scope freeze y preguntas abiertas

Anexo C - Delta v1.1, decisiones de ideas y visión futura

# **1. Tesis consolidada, visión y posicionamiento**

Porandú Autos es un Automotive Revenue OS / Sales Intelligence Platform para playas, showrooms y operaciones automotrices. Conecta inventario, conversaciones, intención de compra y operación comercial para producir acciones que aumenten la probabilidad de vender cada unidad. No compite primero por ser el ERP más completo ni se reduce a reciclar leads antiguos: busca convertirse progresivamente en la capa de inteligencia comercial del negocio automotor.

| **PROMESA CENTRAL** Cada vez que aparece una oportunidad comercial -un lead nuevo, un vehículo nuevo, un trade-in o una conversación dormida-, Porandú debe responder: ¿a quién hay que contactar ahora, por qué y cuál es la siguiente mejor acción? |
| --- |

## Tesis ejecutiva v1.1

La empresa se construye alrededor de una misión simple: ayudar a los negocios automotores a vender más vehículos y aprovechar mejor cada oportunidad comercial. Porandú debe entender qué quiere comprar cada prospecto, qué stock puede resolver esa demanda, cuál es la siguiente mejor acción y qué actividades terminaron generando una venta.

| **Nivel** | **Definición oficial** |
| --- | --- |
| Visión | Construir la infraestructura de inteligencia comercial para el sector automotor latinoamericano. |
| Misión | Ayudar a showrooms, playas y vendedores a vender más vehículos y aprovechar mejor cada oportunidad comercial. |
| Promesa simple | Porandú ayuda a tu showroom a vender más autos. |
| Producto | Automotive Revenue OS / Sales Intelligence Platform. |
| Capa de inteligencia | Porandú Memory + Qualification + Match + Next Best Action + Attribution. |
| Caso de uso estrella | Revenue Recovery: recuperar oportunidades existentes cuando aparece el vehículo correcto. |
| North Star | Ventas influenciadas por Porandú y valor vendido atribuible. |
| Regla de enfoque | Revenue first. La administración solo se construye cuando sostiene ventas, velocidad, margen, retención o aprendizaje. |

## Porandú Memory

Porandú Memory es la memoria comercial estructurada del negocio. No es un producto separado ni una base aislada: emerge de contactos, leads, preferencias, conversaciones, trade-ins, citas y ventas. Su función es preservar intención y contexto para que una conversación de hoy siga teniendo valor mañana.

| **REVENUE RECOVERY = CASO DE USO, NO DEFINICIÓN TOTAL** Recuperar leads y gasto publicitario ya realizado es una capacidad comercial muy potente, pero Porandú también debe calificar leads nuevos, mover inventario, asistir al vendedor, gestionar test drives y aprender de las ventas. La startup no se limita a “reciclar leads”. |
| --- |

## Tesis de datos y defensibilidad

A medida que el sistema acumula intención, stock, conversaciones y resultados, puede formar un Automotive Intent Graph: relaciones entre compradores, capacidad financiera, preferencias, trade-ins, vehículos, acciones y conversiones. El moat no depende de una pantalla o de un chatbot aislado, sino de la calidad del histórico y de aprender qué señales terminan en conversación, cita y venta.

## **Posicionamiento oficial**

| **Elemento** | **Definición** |
| --- | --- |
| **Marca** | Porandú |
| **Vertical inicial** | Automotive |
| **Producto** | Porandú Autos |
| **Categoría deseada** | Automotive Revenue OS / Sales Intelligence Platform |
| **Objetivo principal** | Hacer que una playa venda más autos y aproveche mejor cada oportunidad comercial |
| **Corazón** | WhatsApp + Qualification Engine + Porandú Memory |
| **Ventaja inicial** | Stock Match + Lead Reactivation + Trade-In Loop + Next Best Action |
| **Interfaz** | Action-first, rápida, responsive, dark mode elegante, cero ERP visual innecesario |
| **Expansión** | Marketing Intelligence -> cobranzas/documentación -> lifecycle/posventa -> Demand & Stock Intelligence -> ecosistema |
| **North Star** | Ventas influenciadas por Porandú |
| Visión LATAM | Infraestructura de inteligencia comercial para el sector automotor latinoamericano |

## **Principios de producto**

Revenue before administration: cada módulo nuevo debe justificar cómo protege o genera ventas, margen, velocidad o retención.

Action before analytics: la pantalla principal prioriza qué hacer hoy; los gráficos son secundarios.

Conversation as data entry: el sistema debe extraer estructura desde WhatsApp para evitar carga manual.

Explainable automation: score, matches y recomendaciones deben explicar por qué se sugieren.

Human control at irreversible moments: envíos sensibles, reservas, venta, precio, financiación, documentación y cobro mantienen control humano en Productivo 1.

One product, progressive depth: no construir un ERP completo antes de validar el motor comercial.

Multi-tenant from day one: cada organización conserva aislamiento estricto de datos.

## **Core loop**

| AUTO / STOCK     ↓ MATCH CON DEMANDA HISTÓRICA     ↓ WHATSAPP / REACTIVACIÓN     ↓ CALIFICACIÓN     ↓ TEST DRIVE / NEGOCIACIÓN     ↓ VENTA     ↓ TRADE-IN (si existe)     ↓ NUEVO STOCK     ↓ NUEVOS MATCHES |
| --- |

A futuro se extiende con: venta -> cuotas/documentación -> service -> recompra. Sin embargo, Productivo 1 se concentra en el ciclo corto que puede demostrar impacto comercial en días o semanas.

# **2. Cliente objetivo, problemas y jobs-to-be-done**

## **ICP inicial**

El cliente ideal inicial no es la playa mínima ni el gran grupo corporativo con procesos rígidos. El mejor punto de entrada es una operación suficientemente activa como para tener stock, consultas y leads dormidos, pero con capacidad de decisión rápida.

| **Dimensión** | **Perfil deseado** |
| --- | --- |
| **Tipo** | Playa de autos, showroom de usados/importados o concesionario independiente |
| **Stock** | Aproximadamente 20-100+ unidades activas o rotación equivalente |
| **Equipo** | 2-15 vendedores/operadores comerciales |
| **Canal** | WhatsApp como canal comercial crítico |
| **Datos** | Historial de consultas, chats, Excel/CRM o cartera de contactos |
| **Operación** | Contado y/o financiación; ideal si acepta vehículo a cambio |
| **Dolor** | Seguimiento manual, leads olvidados, stock parado, respuestas repetitivas, baja visibilidad sobre quién compraría cada auto |

## **Jobs-to-be-done principales**

| **Actor** | **Necesidad que Porandú debe resolver** |
| --- | --- |
| **Dueño/Gerente** | Quiero vender el stock más rápido y saber si el sistema realmente genera ventas. |
| **Vendedor** | Quiero saber a quién escribir hoy y tener contexto suficiente sin buscar chats viejos. |
| **Marketing** | Quiero cargar un auto una vez y generar material comercial utilizable de inmediato. |
| **Administración** | Quiero registrar la venta y dejar trazabilidad mínima para documentación y posventa. |
| **Recepción/Taller (futuro)** | Quiero recuperar al cliente meses después y convertir la posventa en ingresos recurrentes. |

## **Problemas que Productivo 1 debe atacar**

Leads que preguntaron hace semanas y quedaron en visto o se perdieron entre conversaciones.

Ingreso de vehículos sin una forma sistemática de cruzarlos contra demanda histórica.

Calificación inconsistente: el vendedor no siempre captura contado/financiado, entrega o trade-in.

Información repartida entre WhatsApp, memoria del vendedor y planillas.

Pérdida de tiempo respondiendo repetidamente datos que ya existen en el sistema.

Ausencia de una atribución simple que muestre qué conversaciones o ventas fueron recuperadas por Porandú.

# **3. Arquitectura funcional: tres motores + Intelligence Layer**

| **Motor** | **Incluye** | **Objetivo** |
| --- | --- | --- |
| **Porandú Sales Engine** | WhatsApp, inbox, calificación, CRM/Kanban, NBA, citas/test drives | Convertir consultas en compradores. |
| **Porandú Stock Engine** | Inventario, estados, Match Engine, reactivación, trade-in, preventa | Hacer que cada vehículo encuentre compradores. |
| **Porandú Lifecycle Engine** | Cuotas, documentación, service, taller, recompra | Seguir monetizando y atendiendo después de la venta. |

## Intelligence Layer - capa transversal

Sales Engine, Stock Engine y Lifecycle Engine siguen siendo la arquitectura funcional principal. v1.1 agrega una capa transversal de inteligencia que no reemplaza a esos motores: los conecta y convierte datos operativos en contexto, prioridad y aprendizaje.

| **INTELLIGENCE LAYER** **Porandú Memory · Qualification · Match Engine · Next Best Action · Revenue Recovery · Campaign Attribution · Intent Graph (evolutivo)**  **Debajo operan Sales Engine, Stock Engine y Lifecycle Engine.** |
| --- |

| **Capacidad** | **Función** | **Momento** |
| --- | --- | --- |
| Porandú Memory | Preservar intención y contexto comercial. | P1 / transversal |
| Qualification Engine | Convertir conversación en datos accionables. | P1 |
| Match Engine | Relacionar demanda con stock y explicar compatibilidad. | P1 |
| Next Best Action | Priorizar qué hacer ahora y por qué. | P1 |
| Revenue Recovery | Reactivar oportunidades existentes con contexto real. | P1 / caso de uso |
| Campaign Attribution | Conservar origen/campaña y conectar fuente con resultado. | Captura P1; análisis gradual |
| Marketing Intelligence | Detectar campañas/posts que producen mejor retorno comercial. | P4 |
| Automotive Intent Graph | Aprender relaciones entre intención, stock y conversiones. | Evolución con datos |

Productivo 1 implementa Sales Engine + Stock Engine en profundidad suficiente para cerrar el loop comercial. Lifecycle Engine queda diseñado en el modelo, pero no se construye completo hasta validar ventas.

## **Capacidades futuras preservadas**

| **Capacidad** | **Destino** |
| --- | --- |
| **Marketing Express / copy en un clic** | P1.1 |
| **Preventa “Próximamente”** | P1.1 |
| **Auto-respuestas de gestoría/escribanía** | P1.1/P2 |
| **Reactivación totalmente automática** | P1.2, después de validar templates, consentimiento y calidad |
| **Cuotas / financiación propia** | P2 |
| **Recibos PDF y alertas de mora** | P2 |
| **Tracking de transferencias/documentos** | P2 |
| **Service 180 días** | P3 |
| **Agenda de taller** | P3 |
| **Inteligencia de demanda y recomendación de stock** | P4 |
| Landing Pages dinámicas por vehículo/modelo | P1.1 |
| Comparador lado a lado para asistencia de venta | P1.1 / P2 |
| Instagram comentario/DM -> información o WhatsApp | P1.2 |
| Omnichannel Lead Capture | P1.2+ |
| Lifecycle Journey: entrega, reviews, mantenimiento, recompra | P3 |
| Marketing Intelligence / ROI por campaña o post | P4 |
| Integraciones de ecosistema / partners / APIs | P5 / futuro |

# **4. Productivo 1: alcance definitivo**

| **OBJETIVO DE P1** Demostrar que Porandú puede transformar stock + WhatsApp + leads nuevos o históricos en conversaciones, test drives y ventas medibles. |
| --- |

## **Dentro de alcance**

| **Dominio** | **Funcionalidad** | **Prioridad** |
| --- | --- | --- |
| **SaaS base** | Organizaciones/showrooms, sucursales básicas, usuarios y roles | Crítica |
| **Inventario** | Alta/edición rápida, fotos, moneda/precio/entrega, estado del vehículo | Crítica |
| **Leads** | Contacto, oportunidad, preferencias, origen/canal, metadata de campaña cuando exista, vendedor y recencia | Crítica |
| **WhatsApp** | Conexión, webhooks, inbox central, mensajes, estados de conversación | Crítica |
| **Qualification** | Contado/financiado, entrega inicial, trade-in, preferencias mínimas | Crítica |
| **Trade-In** | Captura de vehículo usado + fotos y datos básicos | Muy alta |
| **Pipeline** | Kanban: Nuevos/Bot -> Calificados -> Cita/Test Drive -> Vendido/Posventa | Alta |
| **Match** | Cruce stock-lead, score, razones y ranking | Crítica |
| **Reactivación** | Mensaje sugerido/aprobado por humano y trazabilidad de resultado | Crítica |
| **Agenda** | Test drive/cita simple | Alta |
| **Ventas** | Registrar cierre, vehículo, comprador, monto y trade-in asociado | Crítica |
| **Cockpit** | Prioridades del día, nuevos matches, test drives, conversaciones pendientes | Muy alta |
| **Atribución** | Registrar match -> reactivación -> cita -> venta influenciada; conservar origen/campaña cuando esté disponible | Crítica |

## **Fuera de alcance de P1**

ERP contable, facturación fiscal, contabilidad, compras/proveedores y caja completa.

Gestión integral de taller u órdenes de reparación.

Motor completo de financiación, intereses, refinanciaciones o cobranzas judiciales.

Automatizaciones masivas sin control humano previo.

Pricing dinámico automatizado.

Recomendación predictiva de qué vehículos importar/comprar.

Marketplace público o red interconcesionarios.

App móvil nativa; P1 será web responsive.

Instagram/DM automation y omnicanalidad completa; WhatsApp sigue siendo el canal primario de P1.

Landing pages, comparador de vehículos y Marketing Intelligence; se preservan en roadmap sin bloquear P1.

Lifecycle Journey completo: reviews, mantenimiento, seguros/trámites, referidos y recompra.

## **Definición de “vendible”**

Productivo 1 se considera comercialmente presentable cuando un showroom puede: cargar stock, recibir/calificar leads, ver el historial, obtener matches explicables, reactivar un lead, agendar un test drive y registrar una venta atribuible sin usar herramientas paralelas para ese flujo central.

# **5. Navegación y mapa de pantallas**

## **Navegación principal**

| PORANDÚ AUTOS ├── Inicio / Cockpit ├── Inbox ├── Leads ├── Inventario ├── Pipeline ├── Agenda ├── Ventas └── Configuración |
| --- |

## **Pantallas Productivo 1**

| **Pantalla** | **Propósito** | **Elementos clave** |
| --- | --- | --- |
| **1. Login / acceso** | Entrar al tenant correcto | Auth, sesión, recuperación, selección de organización si corresponde |
| **2. Sales Action Cockpit** | Responder “¿qué hago hoy?” | Prioridad Hoy, matches, conversaciones, test drives, ventas influenciadas |
| **3. Inbox** | Gestionar WhatsApp | Lista conversaciones, chat, ficha lateral, bot/humano, etiquetas, NBA |
| **4. Leads** | Consultar demanda | Lista/filtros, score, vendedor, recencia, preferencias, estado |
| **5. Lead Drawer** | Entender un lead sin salir del contexto | Calificación, trade-in, historial, matches, próximo paso |
| **6. Inventario** | Control de stock comercial | Cards/lista, estados, precio/entrega, match count, alta rápida |
| **7. Vehicle Drawer** | Ver demanda asociada al auto | Datos, fotos, matches, interesados, estado, acciones |
| **8. Pipeline** | Mover oportunidades | 4 columnas, drag/drop o cambio controlado, filtros |
| **9. Agenda** | Coordinar test drives | Día/semana, lead, vehículo, vendedor, estado |
| **10. Venta** | Cerrar ciclo | Comprador, vehículo, monto, financiación simple declarativa, trade-in |
| **11. Configuración** | Integraciones y reglas | Usuarios, roles, WhatsApp, sucursal, plantillas, score base |

## **Sales Action Cockpit**

No es un dashboard analítico tradicional. Debe priorizar acciones y contexto. Cada tarjeta accionable debe incluir persona/vehículo, razón de prioridad, recencia y CTA inmediato.

| **Bloque** | **Ejemplos** |
| --- | --- |
| **Prioridad Hoy** | Leads calientes, matches nuevos, test drives por confirmar, conversaciones sin respuesta |
| **Match Feed** | “Diego Benítez · 89% match · Premio 2016 · entrega suficiente · consultó hace 18 días” |
| **Inbox SLA** | Conversaciones entrantes sin respuesta y tiempo transcurrido |
| **Agenda** | Próximos test drives y conflictos |
| **Impacto** | Ventas influenciadas y valor vendido en periodo; secundaria respecto a la acción |

## **Diseño UI/UX sellado**

Dark mode elegante y glassmorphism moderado; claridad antes que decoración.

Desktop/tablet primero; responsive suficiente para teléfono, sin convertir P1 en app móvil nativa.

Alta de vehículo en una sola vista con campos mínimos y progresivos.

Drawers laterales para lead y vehículo, evitando navegación profunda.

CTA principal único por contexto: responder, contactar match, agendar test drive o cerrar venta.

Estados, score y recencia visibles sin saturar de métricas.

Carga percibida rápida; skeletons, optimistic UI donde sea seguro y feedback inmediato.

# **6. Flujos operativos críticos**

## **Flujo A - Lead nuevo por WhatsApp**

1.  Webhook recibe mensaje e identifica organización, número y conversación.

2.  Se busca contacto por organization_id + teléfono; si no existe, se crea.

3.  Se crea o reabre una oportunidad/lead activa.

4.  Qualification Engine identifica qué datos faltan.

5.  Bot hace la siguiente pregunta necesaria o deriva a humano según reglas.

6.  Las respuestas estructuran compra: contado/financiado, entrega, preferencias y trade-in.

7.  El lead obtiene score/estado y aparece en Inbox, Leads y Pipeline.

8.  Si alcanza criterio, se recomienda test drive/handoff a vendedor.

## **Flujo B - Nuevo vehículo disponible**

1.  Usuario crea/actualiza vehículo y lo marca “Disponible”.

2.  Se dispara job de matching dentro del tenant.

3.  Se filtran leads elegibles según recencia, estado, consentimiento y exclusiones.

4.  Se calcula match_score y razones.

5.  Se guardan stock_matches y se muestran en Vehicle Drawer/Cockpit.

6.  Usuario revisa candidatos y dispara reactivación sugerida.

7.  Respuesta del lead actualiza recencia, pipeline y atribución.

8.  Si termina en test drive o venta, el match conserva trazabilidad.

## **Flujo C - Venta con trade-in**

1.  Vendedor marca lead como Vendido e inicia registro de venta.

2.  Selecciona vehículo vendido, precio/monto final y datos mínimos del cierre.

3.  Si existe trade-in, se convierte la ficha temporal en vehículo de inventario “En preparación”.

4.  El nuevo vehículo conserva vínculo con la venta/origen del trade-in.

5.  Al cambiar a “Disponible”, dispara Match Engine.

6.  Se inicia un nuevo ciclo comercial sin recargar manualmente toda la información.

## **Flujo D - Test drive**

1.  Desde lead/match se selecciona “Agendar test drive”.

2.  Se propone fecha/hora, vehículo, vendedor y sucursal.

3.  Agenda registra pendiente/confirmado/completado/cancelado/no-show.

4.  Recordatorio y confirmación pueden incorporarse gradualmente.

5.  Resultado del test drive alimenta NBA y pipeline.

## Flujo E - Revenue Recovery / oportunidad histórica

Un lead anterior conserva preferencias, capacidad financiera, trade-in, contexto y origen cuando esos datos existen.

Un vehículo nuevo o reingresado pasa a Disponible y dispara el Match Engine.

Porandú identifica leads actuales o históricos elegibles y prioriza los de mayor compatibilidad.

El vendedor revisa el contexto y dispara una reactivación controlada.

Si el lead responde, la oportunidad vuelve al flujo activo sin perder trazabilidad histórica.

Si termina en test drive o venta, Porandú registra la atribución y, cuando exista, el origen/campaña que generó inicialmente la demanda.

# **7. Corazón conversacional / WhatsApp + Porandú Memory**

## **Objetivo**

WhatsApp es la principal interfaz invisible de Porandú. La web no debe obligar al equipo a duplicar datos que ya aparecen en las conversaciones. Cada mensaje relevante debe poder actualizar la estructura comercial del lead.

## Memoria comercial estructurada

Cada mensaje relevante debe enriquecer Porandú Memory. El objetivo no es guardar chats por guardar: es conservar intención utilizable -qué busca, cómo compra, cuánto puede entregar, qué usado posee, urgencia, objeciones y resultados previos- para operar el presente y reutilizar ese contexto en futuras oportunidades.

## **Qualification Engine v1**

| **Dimensión** | **Campos mínimos** | **Uso** |
| --- | --- | --- |
| **Tipo de compra** | contado / financiado / no definido | Determina preguntas y compatibilidad |
| **Entrega inicial** | monto + moneda | Variable fuerte del match |
| **Trade-in** | sí/no + marca/modelo/año/km/fotos | Valor comercial y nuevo stock potencial |
| **Preferencia** | marca/modelo; opcional año/transmisión/tipo | Demanda |
| **Timing** | ahora / <30d / 30-90d / explorando | Priorización |
| **Estado** | nuevo, calificado, cita, vendido, no interesado | Pipeline |

## **Regla de las 3 preguntas**

| 1) ¿Buscás comprar al contado o financiar? 2) ¿Con cuánto aproximadamente contarías para la entrega inicial? 3) ¿Tenés algún vehículo para entregar como parte de pago? |
| --- |

Las preguntas pueden variar en lenguaje según estilo del showroom, pero la estructura de datos debe permanecer estable. Si el lead ya dio una respuesta espontáneamente, el bot no debe volver a preguntarla.

## **Estados de control de conversación**

| **Estado** | **Comportamiento** |
| --- | --- |
| **BOT_ACTIVE** | Porandú puede continuar calificación dentro de reglas. |
| **HUMAN_TAKEOVER** | El vendedor tomó control; bot no envía mensajes salvo acción explícita. |
| **WAITING_CUSTOMER** | Se espera respuesta del prospecto. |
| **NEEDS_REVIEW** | Ambigüedad, excepción o baja confianza; requiere humano. |
| **CLOSED** | Conversación comercial cerrada/no interesada/vendida. |

## **Respuesta de documentación - diseño futuro compatible**

P1 deja preparada la entidad de estados/documentación, pero la automatización profunda puede entrar después. La regla es: el bot solo responde estados que provienen de datos registrados; nunca inventa el estado de cédula, chapa o transferencia.

## Contexto de adquisición y canal

P1 debe conservar el origen del lead y, cuando el canal lo provea, identificadores de campaña/anuncio/post o parámetros UTM. Esto no convierte P1 en una herramienta de marketing; evita perder los datos necesarios para atribución futura.

| **Dato** | **Uso** |
| --- | --- |
| source / channel | Meta, Instagram, Marketplace, web, Sirius/partner, directo, etc. |
| campaign_id / campaign_name | Relacionar demanda con campaña cuando esté disponible. |
| ad_id / post_id | Trazabilidad de creativo/post/anuncio cuando aplique. |
| utm_* | Atribución desde landing pages o web. |
| source_metadata JSONB | Preservar metadata variable sin rigidizar P1. |

## **Consentimiento y políticas**

Toda automatización de WhatsApp debe modelar consentimiento, plantillas, ventanas de conversación y políticas vigentes de la plataforma. Productivo 1 prioriza reactivación sugerida con control humano y trazabilidad antes de habilitar automatización total.

WhatsApp es el canal primario de Productivo 1. Instagram comments/DM, landings, webs, marketplaces y partners se incorporan progresivamente como fuentes de demanda que terminan alimentando el mismo modelo de contacto, lead e intención.

# **8. Stock Match Engine y reactivación**

| **MOAT INICIAL** El Match Engine convierte un ingreso de stock en una lista priorizada de compradores potenciales. Su valor aumenta cuando utiliza Porandú Memory y registra resultados. La defensibilidad futura surge de acumular intención + contexto + conversiones, no de un filtro visual aislado. |
| --- |

## **Elegibilidad antes del score**

Mismo organization_id.

Lead no vendido/no bloqueado/no excluido.

Dentro de ventana de recencia configurable (por defecto conceptual: 30-90 días).

Datos mínimos suficientes para calcular compatibilidad.

Reglas de consentimiento/canal satisfechas para cualquier contacto saliente.

No duplicar una reactivación reciente del mismo vehículo/lead.

## **Match Score v1 - base explicable**

| **Factor** | **Peso inicial sugerido** | **Ejemplo** |
| --- | --- | --- |
| **Entrega / capacidad financiera** | 25 | Entrega declarada alcanza el mínimo o rango compatible |
| **Marca** | 20 | Coincidencia exacta o familia aceptada |
| **Modelo** | 20 | Coincidencia exacta o alternativa configurada |
| **Tipo de compra / financiación** | 15 | Vehículo/operación compatible con preferencia |
| **Recencia** | 10 | Mayor peso a interacción reciente |
| **Año / rango** | 4 | Dentro de rango deseado |
| **Transmisión** | 3 | Coincide si fue declarada |
| **Otros atributos** | 3 | Combustible/tipo/color, solo si existen datos fiables |

Los pesos son baseline técnica, no una verdad permanente. Se configuran y se recalibran con datos de pilotos. La explicación del score debe guardarse junto al match para auditoría y UX.

## **Bandas recomendadas**

| **Score** | **Etiqueta** | **Acción** |
| --- | --- | --- |
| **80-100** | Alta prioridad | Mostrar en Cockpit y sugerir contacto inmediato |
| **60-79** | Buen candidato | Mostrar en Vehicle Drawer / lista de reactivación |
| **40-59** | Posible | Disponible bajo filtro; no interrumpir al vendedor |
| **<****40** | Bajo | No priorizar por defecto |

## **Explicabilidad en UI**

| 89% MATCH ✓ Toyota Premio ✓ Automático ✓ Entrega declarada suficiente ✓ Consultó hace 18 días ~ Año preferido no confirmado |
| --- |

## **Reactivación v1**

P1 genera un borrador contextual y deja al vendedor revisar/enviar. Debe evitar mensajes genéricos y usar datos reales del match. El sistema registra suggested_at, sent_at, replied_at, appointment_at y sale_at para atribución.

## Revenue Recovery

Revenue Recovery es el caso de uso que aprovecha demanda ya adquirida: Porandú detecta cuándo un vehículo nuevo coincide con una oportunidad anterior y ayuda a reabrirla. Comercialmente permite demostrar que una campaña o conversación puede seguir generando valor semanas o meses después, sin redefinir toda la plataforma alrededor de leads antiguos.

# **9. Trade-In Auto-Funnel**

## **Tesis**

Un vehículo entregado no es solamente un dato de negociación: puede convertirse en nuevo inventario y disparar otro ciclo de demanda. Por eso Trade-In debe tener identidad propia en el dominio y vínculo con la oportunidad/venta que lo originó.

| LEAD   ↓ TRADE-IN CAPTURADO   ↓ TASACIÓN / REVISIÓN HUMANA   ↓ VENTA CERRADA   ↓ CREAR VEHÍCULO EN STOCK = EN_PREPARACIÓN   ↓ FOTOS / LIMPIEZA / TALLER   ↓ DISPONIBLE   ↓ MATCH ENGINE   ↓ PREVENTA / REACTIVACIÓN |
| --- |

## **Campos mínimos**

| **Grupo** | **Campos** |
| --- | --- |
| **Identidad** | marca, modelo, año |
| **Uso** | kilometraje |
| **Evidencia** | fotos_urls |
| **Documentación** | estado declarado / notas |
| **Negociación** | valor estimado/tasado (si se usa), comentarios |
| **Trazabilidad** | lead_id, sale_id, converted_vehicle_id, created_at |

## **Preventa “Próximamente”**

Se diseña para P1.1. Permite mostrar que un vehículo está en preparación y empezar a reunir interesados antes de estar listo. No se debe confundir con “Disponible”: la UI debe dejar claro que la unidad todavía no está lista para entrega/test drive.

# **10. Modelo de datos y multi-tenancy**

## **Principio obligatorio**

| **AISLAMIENTO** Ninguna entidad comercial puede vivir globalmente sin organization_id o una relación inequívoca hacia la organización. Teléfonos y otros identificadores se vuelven únicos dentro del tenant, no en toda la plataforma. |
| --- |

## **Entidades P1**

| **Entidad** | **Responsabilidad** | **Relaciones principales** |
| --- | --- | --- |
| **organizations** | Tenant/showroom | memberships, branches, vehicles, contacts |
| **branches** | Sucursal básica | organization, users, appointments |
| **profiles** | Identidad de usuario | memberships |
| **memberships** | Rol del usuario por organización | organization + profile + role |
| **vehicles** | Unidad de inventario | organization, branch, source_trade_in |
| **vehicle_media** | Fotos/documentos del vehículo | vehicle |
| **contacts** | Persona única dentro del tenant | organization, leads, conversations |
| **leads** | Oportunidad comercial + contexto mínimo de adquisición | contact, assigned_user, preferences, trade_in, source metadata |
| **lead_preferences** | Demanda estructurada | lead |
| **trade_ins** | Usado ofrecido en negociación | lead; luego sale/vehicle |
| **conversations** | Hilo por canal | contact, lead, organization |
| **messages** | Mensajes entrantes/salientes | conversation |
| **whatsapp_consents** | Consentimiento y fuente | contact/organization |
| **stock_matches** | Compatibilidad vehículo-lead | vehicle + lead + score/reasons |
| **reactivations** | Acción sobre un match | stock_match + message/actor/outcome |
| **appointments** | Test drive/cita | lead + vehicle + seller |
| **sales** | Cierre | lead + vehicle + buyer + seller |
| **audit_events** | Trazabilidad de acciones críticas | organization + actor + entity |

## **Estados de vehículo**

| EN_PREPARACION -> DISPONIBLE -> RESERVADO -> VENDIDO                  \->                   RETIRADO / BAJA (opcional administrativo) |
| --- |

P1 exige como mínimo: en_preparacion, disponible, reservado y vendido. Cualquier estado adicional debe justificar un caso real de piloto.

## **Estados de lead / pipeline**

| NUEVO_BOT -> CALIFICADO -> CITA_TEST_DRIVE -> VENDIDO_POSVENTA       \->            \->    NO_INTERESADO   EN_NEGOCIACION (estado interno opcional) |
| --- |

La UI mantiene cuatro columnas simples. “En negociación” puede existir internamente como estado/flag sin obligar a crear una quinta columna si complica la experiencia.

## **Esqueleto lógico de schema**

| organizations(id, name, timezone, currency_default, created_at) profiles(id, full_name, email, phone) memberships(id, organization_id, profile_id, role, active) vehicles(id, organization_id, branch_id, brand, model, year, transmission, fuel, km,          cash_price, min_down_payment, currency, status, created_at, updated_at) contacts(id, organization_id, name, whatsapp_phone, created_at, last_contact_at) leads(id, organization_id, contact_id, status, assigned_user_id, source, source_metadata_json, score, created_at) lead_preferences(id, lead_id, purchase_type, down_payment, currency, brand, model, year_min, year_max, ...) trade_ins(id, lead_id, brand, model, year, km, photos, notes, converted_vehicle_id) conversations(id, organization_id, contact_id, lead_id, channel, control_state, external_thread_id) messages(id, conversation_id, direction, body, sender_type, external_message_id, status, created_at) stock_matches(id, organization_id, vehicle_id, lead_id, match_score, reasons_json, status, matched_at) reactivations(id, stock_match_id, suggested_at, sent_at, replied_at, outcome) appointments(id, organization_id, lead_id, vehicle_id, seller_id, starts_at, status) sales(id, organization_id, lead_id, vehicle_id, seller_id, amount, currency, sold_at) |
| --- |

## Captura mínima de atribución en P1

P1 conserva source y source_metadata_json cuando exista información de campaña, anuncio, post o UTM. El análisis de ROI y la optimización de campañas pertenecen a fases posteriores. La decisión de v1.1 es almacenar contexto útil ahora sin construir todavía un ad-tech platform.

## **Restricciones clave**

UNIQUE (organization_id, whatsapp_phone) para contactos.

Un vehículo vendido no puede venderse dos veces salvo reversión administrativa explícita.

stock_matches debe evitar duplicados activos por organization_id + vehicle_id + lead_id + versión de cálculo.

Mensajes externos guardan external_message_id para idempotencia de webhooks.

Ventas y cambios sensibles generan audit_event.

Fechas se almacenan con zona horaria/UTC y se presentan en timezone de organización.

# **11. Arquitectura técnica**

## **Stack baseline**

| **Capa** | **Decisión baseline** | **Razón** |
| --- | --- | --- |
| **Frontend / Full-stack** | Next.js + TypeScript | Un único codebase, velocidad de desarrollo, SSR/SPA según pantalla |
| **UI** | React + componentes accesibles + sistema de diseño propio | Consistencia y velocidad |
| **Database** | PostgreSQL vía Supabase | Relacional, RLS, madurez y velocidad de MVP |
| **Auth** | Supabase Auth | Reduce superficie de autenticación |
| **Storage** | Supabase Storage | Fotos de vehículos y trade-ins |
| **ORM/query layer** | Drizzle ORM o acceso tipado equivalente | Schema explícito y migraciones controladas |
| **WhatsApp** | WhatsApp Business Platform / Cloud API | Canal oficial e integración por webhooks |
| **Jobs** | Job runner/queue simple compatible con hosting | Matching, reintentos, recordatorios; sin microservicios |
| **IA** | Proveedor LLM desacoplado detrás de servicio interno | Extracción/copy; no acoplar dominio a un proveedor |
| **Hosting** | Proveedor compatible con Next.js + Supabase | Simplicidad operativa |
| **Observabilidad** | logs estructurados + error tracking | Depuración y piloto |

## **Arquitectura lógica**

| **Web App (Next.js)** **       │** **       ├── Server Actions / API layer** **       │       ├── Inventory Service** **       │       ├── Lead / CRM Service** **       │       ├── Qualification Service** **       │       ├── Match Service** **       │       ├── Reactivation Service** **       │       └── Appointment / Sales Service** **       │** **       ├── PostgreSQL / RLS** **       ├── Storage** **       └── Auth**  **WhatsApp Cloud API** **       │ webhooks** **       ▼** **Webhook Handler -****>**** Idempotency -****>**** Conversation Service -****>**** Qualification -****>**** Events/Jobs** |
| --- |

## **No microservicios en P1**

La aplicación se implementa como monolito modular. Separar dominios en código, no en infraestructura. Un servicio se extrae únicamente cuando volumen, despliegue independiente o aislamiento operacional lo justifiquen con evidencia.

## **Estructura de repositorio sugerida**

| porandu-autos/ ├── app/ │   ├── (auth)/ │   ├── (dashboard)/ │   │   ├── page.tsx                # Cockpit │   │   ├── inbox/ │   │   ├── leads/ │   │   ├── inventory/ │   │   ├── pipeline/ │   │   ├── calendar/ │   │   ├── sales/ │   │   └── settings/ │   └── api/ │       ├── webhooks/whatsapp/ │       └── jobs/ ├── components/ │   ├── ui/ │   ├── cockpit/ │   ├── inbox/ │   ├── leads/ │   └── inventory/ ├── domains/ │   ├── organizations/ │   ├── inventory/ │   ├── crm/ │   ├── conversations/ │   ├── qualification/ │   ├── matching/ │   ├── reactivation/ │   ├── appointments/ │   └── sales/ ├── db/ │   ├── schema/ │   ├── migrations/ │   └── queries/ ├── lib/ │   ├── auth/ │   ├── whatsapp/ │   ├── ai/ │   ├── jobs/ │   └── observability/ ├── tests/ └── docs/ |
| --- |

## **Eventos de dominio útiles**

| **Evento** | **Consumidores** |
| --- | --- |
| **vehicle.available** | Match Engine |
| **lead.qualified** | Match recalculation / Cockpit |
| **message.received** | Qualification / Inbox SLA |
| **match.created** | Cockpit / Vehicle Drawer |
| **reactivation.replied** | Pipeline / attribution |
| **appointment.created** | Agenda / notifications |
| **sale.closed** | Inventory + attribution + future lifecycle |
| **tradein.converted** | Inventory creation |

# **12. Seguridad, permisos y auditoría**

## **Roles P1**

| **Rol** | **Puede** |
| --- | --- |
| **admin** | Configurar organización, usuarios, WhatsApp, score, inventario, leads, ventas y reportes. |
| **vendedor** | Trabajar Inbox/leads asignados, inventario visible, matches, citas y ventas según permisos. |
| **recepcion_taller** | Reservado para evolución; en P1 puede existir sin acceso relevante o no exponerse en UI. |

## **Controles obligatorios**

Row Level Security o control equivalente por organization_id.

Nunca confiar en organization_id enviado por cliente sin validarlo contra sesión/membership.

Webhooks verificados y procesamiento idempotente.

Secrets solo en entorno seguro; jamás en cliente/browser.

URLs de media controladas; aplicar políticas de tamaño/tipo y acceso.

Audit trail para venta, cambio de estado crítico, asignación y configuración.

Soft-delete o archivado para entidades comerciales importantes cuando borrar destruya trazabilidad.

Backups y migraciones versionadas antes de pilotos reales.

## **Privacidad por diseño**

Porandú manejará conversaciones, teléfonos y datos comerciales. Debe minimizar datos innecesarios, controlar acceso por rol y conservar evidencia de consentimiento/canal cuando corresponda. El producto no debe convertir bases históricas en campañas indiscriminadas.

# **13. Métricas, atribución y observabilidad**

## **North Star**

| **VENTAS INFLUENCIADAS POR PORANDÚ** **Una venta es influenciada cuando existe una cadena trazable entre una acción/recomendación de Porandú y el avance comercial: match, reactivación, conversación, cita o cierre.** |
| --- |

## **Funnel comercial**

| **Métrica** | **Definición** |
| --- | --- |
| **Leads analizados** | Oportunidades elegibles procesadas |
| **Matches creados** | Compatibilidades stock-lead superiores al umbral mínimo |
| **Reactivaciones enviadas** | Mensajes salientes originados en match |
| **Respuestas recuperadas** | Lead responde después de reactivación |
| **Test drives generados** | Citas asociadas a flujo Porandú |
| **Ventas influenciadas** | Cierres con atribución válida |
| **Valor vendido** | Monto total de ventas influenciadas |
| **Tiempo stock -****>**** primer match** | Velocidad de reacción del sistema |
| **Tiempo mensaje -****>**** respuesta humana** | SLA operativo del showroom |
| Oportunidades recuperadas | Leads históricos que vuelven a una conversación activa por acción de Porandú. |
| Valor recuperado | Monto de ventas influenciadas que nacen de reactivaciones de oportunidades anteriores. |
| Ventas por origen/campaña | Ventas atribuibles a source/campaign cuando existe metadata suficiente. |

## **Eventos de producto mínimos**

| vehicle_created vehicle_status_changed lead_created lead_qualified message_received message_sent match_created match_opened reactivation_suggested reactivation_sent reactivation_replied appointment_created appointment_completed sale_closed tradein_created tradein_converted_to_stock |
| --- |

## Campaign Attribution y Marketing Intelligence

v1.1 separa dos niveles: P1 preserva el origen comercial y la cadena de atribución disponible; las fases posteriores comparan campañas, posts y canales por calidad de lead, test drives, ventas y valor vendido. El objetivo futuro es decir qué marketing produce negocio real, no solo clics o conversaciones.

| **Métrica** | **Qué responde** | **Fase** |
| --- | --- | --- |
| Leads por origen | ¿De dónde llega la demanda? | P1 / básico |
| Calificados por origen | ¿Qué fuente trae intención útil? | P1.1+ |
| Test drives por campaña | ¿Qué campañas mueven al cliente? | P1.1+ |
| Ventas / valor por campaña | ¿Qué marketing produce facturación? | P2/P4 |
| Revenue Recovery por fuente | ¿Qué campañas siguen generando valor después? | P2/P4 |
| Recomendación de inversión | ¿Dónde conviene potenciar presupuesto? | P4, con datos suficientes |

## **Observabilidad técnica**

Error tracking con contexto de organization_id anonimizado/seguro.

Logs estructurados por request/job/webhook.

Dead-letter o registro de jobs fallidos.

Panel interno mínimo: webhooks fallidos, mensajes no procesados, jobs de match y errores de auth.

No depender de logs manuales para reconstruir una venta o un envío.

# **14. Roadmap de evolución y expansión**

| **Fase** | **Nombre** | **Resultado** |
| --- | --- | --- |
| **P1** | Sell More | Inventario + WhatsApp + Qualification + Match + Reactivation + Trade-In + Test Drive + Venta + captura mínima de origen/campaña |
| **P1.1** | Commercial Acceleration | Marketing Express, Landing Pages dinámicas, “Próximamente”, comparador lado a lado, respuestas documentales simples, templates mejorados |
| **P1.2** | Automation & Omnichannel | Reactivación más automática con guardrails, follow-ups, Instagram comments/DM -> información/WhatsApp y bases de captura omnicanal |
| **P2** | Collect & Deliver | Financiación propia, cuotas, vencimientos, recibos, gestoría/documentos y trazabilidad operativa de entrega |
| **P3** | Retain / Lifecycle | Mensaje Día 1, Review Journey, mantenimiento/service, recordatorios de trámites/seguro, agenda taller, historial posventa y recompra |
| **P4** | Predict / Intelligence | Demand Intelligence, recomendación de stock, aging/tendencias, Marketing Intelligence y análisis de campañas/posts por retorno comercial |
| P5 | Ecosystem / LATAM | APIs e integraciones con marketplaces, partners y fuentes externas; normalización multi-país y expansión de infraestructura comercial. |

## Lifecycle Journey - visión P3

La venta no termina al entregar las llaves. P3 busca conservar la relación y abrir nuevas oportunidades durante la vida del cliente.

| **Momento** | **Automatización / acción** | **Estado** |
| --- | --- | --- |
| Día 1 | Felicitación + ficha digital + recomendaciones de uso. | Roadmap P3 |
| 24-48 h | Solicitud de reseña en Google sin condicionar un incentivo. | Roadmap P3 |
| Mantenimiento | Recordatorios según tiempo/uso disponible. | Roadmap P3 |
| 6 meses | Invitación a cambio de aceite/filtros y agenda de taller/partner. | Roadmap P3 |
| Trámites / seguro | Avisos configurables cuando existan fechas/datos fiables. | P2/P3 |
| 24-36 meses aprox. | Señales de recompra/cambio de vehículo cuando exista evidencia suficiente. | P3/P4 |

## **Visión P4**

Con suficientes datos, Porandú puede evolucionar desde “encontrar comprador para el auto que tengo” hacia “decirme qué auto debería tener”. Esa transición convierte datos operativos en inteligencia de demanda, pero no se programa antes de contar con señales reales de pilotos.

## Idea Bank - buenas ideas, no compromiso de construcción ahora

Estas ideas se conservan porque podrían ampliar retención o distribución, pero no justifican complejidad antes de validar Productivo 1.

| **Idea** | **Decisión v1.1** | **Condición para reconsiderar** |
| --- | --- | --- |
| Sistema de referidos con recompensa | Idea Bank | Probar primero retención, tracking y economics del incentivo. |
| Porandú Seller / plan individual | Hipótesis GTM y pricing | Validar después de pilotos si vendedor individual tiene suficiente willingness-to-pay y canal de expansión. |
| Integración profunda con Sirius/marketplaces | Ecosistema futuro | Solo si existe partner/API/beneficio mutuo comprobable. |
| Incentivo condicionado por reseña | Descartado en esa forma | Conservar Review Journey sin exigir recompensa a cambio de valoración. |

# **15. Orden de construcción e hitos**

## **Hito 0 - Fundación**

Repositorio y convenciones.

Next.js/TypeScript + Supabase + entorno local/staging.

Auth, organizations, memberships, RLS.

Design tokens y shell de navegación.

## **Hito 1 - Inventario + CRM básico**

Schema vehicles, contacts, leads, preferences y media.

Alta rápida de vehículo, lista/cards, Vehicle Drawer.

Leads list + Lead Drawer.

Pipeline de 4 columnas.

Datos seed para demo.

Captura de source/source_metadata cuando el canal lo provea.

## **Hito 2 - WhatsApp + Qualification**

Webhook oficial, idempotencia y conversaciones.

Inbox usable.

Control BOT/HUMAN.

Extracción/registro de las 3 preguntas.

Trade-in básico con fotos.

## **Hito 3 - Match Engine**

Eligibility query.

Scoring explainable.

stock_matches + razones.

Vehicle Drawer con compradores potenciales.

Cockpit con Match Feed.

## **Hito 4 - Reactivación + agenda**

Borradores de reactivación.

Envío controlado y trazabilidad.

Respuesta vinculada al match.

Agenda/test drive.

NBA y prioridades.

## **Hito 5 - Venta + atribución + Trade-In Loop**

Registro de venta.

Venta influenciada por match/reactivación.

Convertir trade-in en nuevo stock.

Dashboard mínimo de impacto.

Flujo end-to-end demostrable.

## **Hito 6 - Piloto**

Onboarding de 1 showroom real.

Carga/importación controlada de stock y leads.

Definir baseline antes de Porandú.

Medir matches, respuestas, citas y ventas.

Recolectar fricciones y cambiar producto solo con evidencia.

Medir también origen/campaña y Revenue Recovery cuando la calidad de datos del piloto lo permita, sin convertirlo en requisito de éxito del primer onboarding.

## **Regla de implementación**

| **NO CONSTRUIR POR MÓDULOS AISLADOS** Cada hito debe cerrar una porción del loop comercial. Priorizar vertical slices que un usuario pueda recorrer de extremo a extremo, aunque algunas capacidades empiecen simples. |
| --- |

# **16. Criterios de aceptación de Productivo 1**

| **Área** | **Criterio de aceptación** |
| --- | --- |
| **Tenant** | Un usuario solo ve datos de organizaciones donde posee membership válido. |
| **Inventario** | Puede crear un vehículo en menos de un minuto y marcarlo Disponible. |
| **Lead** | Puede crear/recibir un lead y almacenar calificación sin duplicar contacto dentro del tenant. |
| **WhatsApp** | Un mensaje entrante aparece una sola vez en la conversación correcta. |
| **Qualification** | Las tres variables centrales se capturan y pueden corregirse manualmente. |
| **Trade-In** | El lead puede tener usado asociado con datos/fotos y trazabilidad. |
| **Match** | Al marcar un vehículo Disponible, se generan candidatos con score y razones explicables. |
| **Reactivación** | El vendedor puede revisar/enviar un mensaje desde un match y ver si hubo respuesta. |
| **Pipeline** | Lead puede progresar por Nuevos/Bot -> Calificados -> Cita/Test Drive -> Vendido/Posventa. |
| **Agenda** | Puede crear y actualizar un test drive asociado a lead + vehículo + vendedor. |
| **Venta** | Puede cerrar venta y evitar doble venta accidental de la misma unidad. |
| **Trade-In Loop** | Un trade-in de venta cerrada puede convertirse en vehículo En Preparación sin recapturar datos básicos. |
| **Atribución** | Una venta originada en match/reactivación aparece como influenciada por Porandú. |
| **Cockpit** | Al abrir el sistema, el vendedor ve acciones prioritarias reales, no solo gráficos. |
| **Resiliencia** | Webhooks y jobs son idempotentes/reintentables y dejan error observable. |
| **UX** | Flujos críticos funcionan en desktop/tablet y son razonablemente usables en móvil. |
| Porandú Memory | La intención estructurada capturada en una conversación permanece disponible para futuros matches sin depender de la memoria humana. |
| Origen comercial | Si el canal entrega source/campaign metadata, Porandú la conserva y la mantiene trazable hasta la oportunidad/venta. |

## **Demo de aceptación end-to-end**

1.  Crear Toyota Premio y dejarlo En Preparación.

2.  Registrar/importar tres leads históricos con distintas entregas/preferencias.

3.  Cambiar Toyota Premio a Disponible.

4.  Porandú genera matches y prioriza al lead correcto explicando el score.

5.  Vendedor envía reactivación desde Porandú.

6.  Simular respuesta y completar calificación.

7.  Agendar test drive.

8.  Cerrar venta.

9.  Registrar Toyota Vitz recibido como trade-in.

10.  Convertir Vitz a En Preparación y luego Disponible.

11.  Generar nueva ronda de matches.

12.  Mostrar en Cockpit la venta influenciada y el nuevo ciclo iniciado.

# **17. Decisiones selladas, scope freeze y preguntas abiertas**

## **Sellado**

Porandú Autos reemplaza a Porandú Inmobiliario como proyecto prioritario.

Objetivo: vender más autos; administración como soporte.

Productivo 1 se enfoca en Sales Engine + Stock Engine.

WhatsApp es el canal conversacional principal.

Match Engine + reactivación + Trade-In Loop son la diferenciación inicial.

Action Cockpit reemplaza un dashboard analítico como home principal.

Multi-tenancy real desde el inicio.

Monolito modular, PostgreSQL/Supabase, Next.js/TypeScript; sin microservicios prematuros.

Reactivación humana/sugerida antes de automatización total.

Taller, cuotas, gestoría e inteligencia predictiva quedan en roadmap y no bloquean P1.

Visión oficial: construir la infraestructura de inteligencia comercial para el sector automotor latinoamericano.

Porandú Memory es una capacidad transversal; Revenue Recovery es un caso de uso estrella, no la definición completa de la startup.

Productivo 1 mantiene su alcance central; v1.1 solo añade captura mínima de origen/campaña cuando el dato exista.

WhatsApp sigue siendo el canal primario de P1; Instagram/DM, landings y omnicanalidad quedan en evolución posterior.

Marketing Intelligence se construye sobre ventas y atribución reales; no se optimiza pauta antes de acumular datos suficientes.

Lifecycle Journey agrupa entrega, reseñas, mantenimiento, trámites, service y recompra en fases posteriores.

Scope freeze v1.1: no incorporar nuevas features a Productivo 1 antes de Hito 0/piloto salvo bloqueo técnico, legal o evidencia fuerte de usuario.

## **Abierto para validar con pilotos**

| **Tema** | **Qué falta aprender** |
| --- | --- |
| **Pricing** | Setup, mensualidad y eventualmente componente variable por sucursal/uso/resultado. |
| **Umbrales del Match Score** | Pesos y score mínimo con mejor conversión real. |
| **Segmento exacto** | Tamaño/stock/equipo con menor fricción comercial y mayor ROI. |
| **Onboarding de datos** | WhatsApp histórico, CSV/Excel, CRM existente y calidad mínima necesaria. |
| **Automatización** | Cuánto control humano prefieren los showrooms antes de enviar reactivaciones. |
| **Financiación** | Qué modelos de financiación propia son lo bastante frecuentes para P2. |
| **Documentación** | Estados reales y terminología que varía por operación/gestoría. |
| **Taller** | Qué porcentaje de clientes tiene taller propio o partner y cómo monetiza el service. |
| Packaging Seller vs Showroom | Validar si conviene plan individual, plan de equipo y multi-sucursal después de conocer ROI y willingness-to-pay. |
| Datos de campañas | Calidad y disponibilidad real de campaign/ad/post/UTM según canal y onboarding. |
| Omnichannel | Qué canal adicional después de WhatsApp produce mayor impacto: Instagram, landings, web o partners. |
| Lifecycle | Qué postventa tiene mayor adopción real: reviews, mantenimiento, taller, trámites o recompra. |

## **Próximo artefacto de ingeniería**

Con v1.1 consolidada y el scope congelado, el siguiente trabajo es traducir la baseline a un paquete ejecutable de ingeniería: schema SQL/migraciones P1, contratos de dominio, backlog por hito, wireframes funcionales y configuración inicial del repositorio. Desde este punto, nuevas ideas van al Idea Bank y no reabren Productivo 1 salvo evidencia real.

| **REGLA FINAL** Una nueva idea puede entrar al roadmap si fortalece ventas, reduce fricción, aumenta retención o mejora aprendizaje. No entra automáticamente en Productivo 1. P1 existe para probar que Porandú ayuda a una playa a vender más autos; v1.1 queda congelada antes de repositorio. |
| --- |

# **Anexo A - Product Backlog resumido**

| **Epic** | **P1** | **P1.1** | **P2** | **P3** | **P4** |
| --- | --- | --- | --- | --- | --- |
| **Tenant/Auth** | Sí |  |  |  |  |
| **Inventario** | Sí | Mejoras |  |  |  |
| **Inbox WhatsApp** | Sí | Mejoras |  |  |  |
| **Qualification** | Sí | Optimización |  |  |  |
| **Trade-In** | Sí | Preventa |  |  |  |
| **Match/Reactivation** | Sí | Automatización |  |  | Predictivo |
| **Marketing Express** |  | Sí |  |  |  |
| **Gestoría/Escribanía** |  | Simple | Sí |  |  |
| **Cuotas/Cobranzas** |  |  | Sí |  |  |
| **Recibos PDF** |  |  | Sí |  |  |
| **Service 180 días** |  |  |  | Sí |  |
| **Agenda taller** |  |  |  | Sí |  |
| **Demand Intelligence** |  |  |  |  | Sí |
| Porandú Memory | Sí | Optimización |  |  | Intent Graph |
| Campaign Attribution | Captura | Reportes |  |  | Intelligence |
| Landing Pages dinámicas |  | Sí |  |  | Optimización |
| Instagram / Omnichannel |  | P1.2 |  |  |  |
| Comparador de vehículos |  | Sí |  |  |  |
| Lifecycle Journey |  |  |  | Sí | Optimización |
| Marketing Intelligence |  |  |  |  | Sí |

# **Anexo B - Definiciones de dominio**

| **Término** | **Definición** |
| --- | --- |
| **Contacto** | Persona dentro de una organización, identificada principalmente por WhatsApp/teléfono. |
| **Lead** | Oportunidad comercial activa o histórica asociada a un contacto. |
| **Calificado** | Lead con suficiente información para evaluar compatibilidad y siguiente acción. |
| **Match** | Relación evaluada entre un vehículo y un lead con score + razones. |
| **Reactivación** | Contacto iniciado a partir de un match o evento de stock. |
| **Venta influenciada** | Venta con una cadena de atribución hacia una acción/recomendación de Porandú. |
| **Trade-In** | Vehículo ofrecido por el comprador como parte de una negociación. |
| **NBA** | Next Best Action: recomendación operativa prioritaria para un vendedor. |
| **Recencia** | Tiempo desde la última interacción significativa del lead. |
| **Tenant** | Organización/showroom cuyo conjunto de datos debe permanecer aislado. |
| Porandú Memory | Memoria comercial estructurada construida a partir de intención, conversaciones y resultados; no es un módulo aislado. |
| Intelligence Layer | Capa transversal que conecta datos de Sales, Stock y Lifecycle con scoring, matches, NBA y atribución. |
| Revenue Recovery | Uso de Porandú Memory + Match + Reactivation para recuperar oportunidades ya adquiridas. |
| Campaign Attribution | Trazabilidad entre origen/campaña y avances comerciales cuando existen identificadores suficientes. |
| Marketing Intelligence | Análisis futuro de qué fuentes, campañas y posts producen mejor retorno comercial real. |
| Automotive Intent Graph | Representación evolutiva de relaciones entre compradores, intención, stock, acciones y conversiones. |
| Lifecycle Journey | Secuencia de acciones postventa desde entrega hasta mantenimiento, service y recompra. |

**FIN DE BASELINE v1.1**

A partir de aquí: ingeniería, prototipo y validación con showroom piloto.

# Anexo C - Delta v1.1, decisiones de ideas y visión futura

Este anexo registra qué cambió respecto de v1.0 y evita que las ideas aprobadas se pierdan o entren prematuramente en Productivo 1.

| **Idea / concepto** | **Decisión** | **Fase** | **Razonamiento** |
| --- | --- | --- | --- |
| Visión LATAM de inteligencia comercial | OFICIAL | Estratégica | Amplía el norte de empresa sin inflar el MVP. |
| Porandú Memory | OFICIAL / transversal | P1+ | Preserva intención y contexto para operación presente y futura. |
| Revenue Recovery | OFICIAL / caso de uso | P1 | Demuestra ROI recuperando oportunidades sin limitar la definición de Porandú. |
| Campaign Attribution | OFICIAL | Captura P1; análisis gradual | Conviene no perder metadata de origen que después será difícil reconstruir. |
| Marketing Intelligence | ROADMAP | P4 | Necesita volumen y ventas reales antes de recomendar inversión. |
| Instagram comment/DM -> información/WhatsApp | ROADMAP | P1.2 | Buen canal de captura, pero WhatsApp debe estar sólido primero. |
| Omnichannel Lead Capture | ROADMAP | P1.2+ | Todas las fuentes deben alimentar el mismo modelo de contacto/intención. |
| Landing Pages dinámicas por vehículo | ROADMAP | P1.1 | Acelera campañas y mejora trazabilidad entre anuncio, lead y venta. |
| Comparador lado a lado | ROADMAP | P1.1/P2 | Asistencia útil para cerrar indecisos; no es moat inicial. |
| Mensaje Día 1 / reviews / mantenimiento / trámites | ROADMAP | P3 | Se agrupan bajo Lifecycle Journey. |
| Service 6 meses / taller / recompra | YA PRESERVADO | P3 | Extiende monetización y fidelización después de la venta. |
| Seller Plan | HIPÓTESIS GTM | Post-piloto | No fijar pricing/packaging antes de medir ROI y willingness-to-pay. |
| Referidos con recompensa | IDEA BANK | Futuro | Posible growth loop, pero requiere economics y tracking validados. |
| Incentivo a cambio de reseña | DESCARTADO / REFORMULADO | - | Conservar solicitud de reseña; no condicionar recompensa a valoración. |

| **TESIS CONSOLIDADA v1.1** Porandú Autos conecta inventario, conversaciones, intención y operación comercial para ayudar a negocios automotores a vender más vehículos. Su Intelligence Layer recuerda contexto, califica, encuentra matches, recomienda acciones y atribuye resultados. Revenue Recovery, Marketing Intelligence y Lifecycle son extensiones de esa misma tesis. La visión de largo plazo es construir la infraestructura de inteligencia comercial para el sector automotor latinoamericano; Productivo 1 permanece enfocado en demostrar ventas medibles antes de ampliar el sistema. |
| --- |

Baseline v1.1 consolidada · 12 Sep 2026 · Documento de producto e ingeniería