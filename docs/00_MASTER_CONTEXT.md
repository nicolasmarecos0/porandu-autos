# PORANDÚ AUTOS — MASTER CONTEXT v1.0
**Fecha de consolidación:** 21 de septiembre de 2026  
**Estado:** Contexto maestro para Proyecto + Repositorio + agentes de construcción  
**Uso:** Documento de handoff para ChatGPT/Claude/Codex y referencia central del proyecto.  
**Regla:** No reabrir decisiones ya aprobadas salvo limitación técnica real, conflicto arquitectónico, evidencia de piloto/usuario o nueva decisión explícita del fundador.

---

## 0. CÓMO USAR ESTE DOCUMENTO

Este archivo consolida las decisiones tomadas en los distintos chats de estrategia, arquitectura técnica y diseño visual de Porandú Autos. Su objetivo es eliminar dependencia de contexto distribuido.

### Jerarquía de autoridad
1. **Decisiones explícitamente aprobadas más recientes del fundador.**
2. **Technical Blueprint v1.1 — baseline aprobada 12-sep-2026.**
3. **Visual & Product Design Blueprint v0.1 — baseline aprobada 12-sep-2026.**
4. **Actualizaciones posteriores incorporadas en este Master Context**: monetización, Zero-Touch, Humanized Conversation Engine, Guardia 24/7, Lead Reactivation, Morning Brief, PAO y estado de construcción.
5. Ideas antiguas o exploratorias quedan subordinadas a esta baseline.

### Regla para agentes de IA
- No reinventar el producto.
- No agregar features a P1 sin marcarlas como propuestas.
- No mover backlog futuro a P1 por comodidad técnica.
- No cambiar arquitectura visual cerrada salvo bloqueo técnico real.
- No acoplar el dominio a un proveedor específico de IA.
- Priorizar vertical slices end-to-end sobre módulos aislados.
- Mantener trazabilidad y control humano en acciones comerciales irreversibles.

---

# 1. IDENTIDAD DEL PRODUCTO

## Producto
**Porandú Autos**

## Categoría
**Automotive Revenue OS / Sales Intelligence Platform**

También puede describirse internamente como un **Sales Engine automotor**.

## Misión
Ayudar a showrooms, playas y vendedores a **vender más vehículos y aprovechar mejor cada oportunidad comercial**.

## Visión de largo plazo
> **Construir la infraestructura de inteligencia comercial para el sector automotor latinoamericano.**

## Promesa simple
> **Porandú ayuda a tu showroom a vender más autos.**

## North Star
**Ventas influenciadas por Porandú** y valor vendido atribuible a sus acciones/recomendaciones.

## Posicionamiento
Porandú:
- es SaaS B2B para el sector automotor;
- conecta inventario, conversaciones, intención y operación comercial;
- convierte datos comerciales en acciones;
- prioriza revenue antes que administración;
- **no es un marketplace**;
- **no busca ser primero un ERP completo**;
- Revenue Recovery es un caso de uso estrella, pero no define toda la empresa.

## Regla de enfoque
> **Revenue first.** La administración solo se construye cuando sostiene ventas, velocidad, margen, retención o aprendizaje.

---

# 2. CLIENTE INICIAL Y PROBLEMA

## Cliente inicial
Playas, showrooms y concesionarias con:
- stock real;
- WhatsApp activo;
- flujo de consultas;
- vendedores/equipo comercial;
- cartera histórica de leads.

Mercado inicial: Paraguay.  
Visión posterior: LATAM.

## Problemas que Porandú resuelve
1. Leads que entran y no reciben seguimiento consistente.
2. Consultas nocturnas o de fin de semana que se enfrían.
3. Vendedores perdiendo tiempo filtrando chats poco calificados.
4. Inventario que entra sin cruzarse automáticamente contra demanda histórica.
5. Leads antiguos que se abandonan aunque después aparezca el auto correcto.
6. Información importante atrapada en WhatsApp y en la memoria del vendedor.
7. Trade-ins que se registran de forma aislada y no disparan un nuevo ciclo comercial.
8. Showrooms que ven métricas pero no saben **qué acción hacer ahora**.

## Pregunta central del producto
Cada vez que aparece un lead, un vehículo, un trade-in o una conversación dormida, Porandú debe responder:

> **¿A quién hay que contactar ahora, por qué y cuál es la siguiente mejor acción?**

---

# 3. ARQUITECTURA FUNCIONAL OFICIAL

Porandú se organiza en **tres motores funcionales + una Intelligence Layer transversal**.

## 3.1 Porandú Sales Engine
Incluye:
- WhatsApp / Inbox;
- leads/contactos;
- Qualification Engine;
- CRM/Pipeline;
- Next Best Action;
- citas/test drives;
- asistencia de venta;
- ofertas.

Objetivo:
> Convertir consultas en compradores.

## 3.2 Porandú Stock Engine
Incluye:
- inventario;
- estados del vehículo;
- Stock Match Engine;
- compradores potenciales por unidad;
- reactivación;
- Trade-In Loop;
- preventa futura.

Objetivo:
> Convertir stock en oportunidades comerciales accionables.

## 3.3 Lifecycle Engine
Diseñado desde el modelo, pero no construido completo en P1.

Incluye evolución hacia:
- entrega;
- documentación;
- mantenimiento;
- service;
- taller;
- fidelización;
- recompra;
- referidos.

Objetivo:
> Seguir monetizando y atendiendo después de la venta.

## 3.4 Intelligence Layer
Capa transversal. No sustituye los tres motores.

Incluye:
- **Porandú Memory**;
- Qualification;
- Match Engine;
- Next Best Action;
- Revenue Recovery;
- Campaign Attribution;
- scoring;
- Automotive Intent Graph evolutivo;
- Demand / Marketing Intelligence futura.

---

# 4. LOOP CENTRAL DEL PRODUCTO

## Loop comercial principal
**Detectar → Priorizar → Entender → Recomendar → Construir oferta → Actuar → Medir → Aprender**

## Loop stock-demand
```text
Stock disponible
      ↓
Match histórico
      ↓
Reactivación / WhatsApp
      ↓
Qualification
      ↓
Test Drive / Negociación
      ↓
Venta
      ↓
Trade-In
      ↓
Nuevo stock
      ↓
Nueva ronda de matches
```

## Match bidireccional
Porandú debe operar en las dos direcciones:

**Lead → Stock**
> ¿Qué vehículo del inventario encaja mejor con esta persona?

**Stock → Leads**
> ¿A qué compradores potenciales puedo vender este vehículo que acaba de entrar?

---

# 5. PRODUCTIVO 1 (P1) — ALCANCE DEFINITIVO

## Objetivo de P1
Demostrar que Porandú puede transformar:

> **stock + WhatsApp + leads nuevos o históricos**

en:

> **conversaciones + test drives + ventas medibles**.

## Dentro de P1

### Fundación SaaS
- multi-tenant;
- organizaciones/showrooms;
- sucursales básicas;
- usuarios;
- memberships;
- roles/permisos.

### Inventario
- alta y edición rápida;
- fotos;
- precio/moneda;
- entrega;
- kilometraje y datos comerciales;
- estado;
- cards/lista;
- Vehicle Drawer;
- match count.

### Leads / CRM
- contacto;
- oportunidad;
- preferencias;
- origen/canal;
- campaign/source metadata cuando exista;
- vendedor;
- recencia;
- historial.

### WhatsApp
- conexión oficial;
- webhooks;
- Inbox central;
- mensajes;
- estados de conversación;
- control BOT/HUMAN;
- actualización de Memory desde conversación.

### Qualification
Mínimo:
1. contado / financiado;
2. entrega inicial;
3. trade-in;
4. preferencias mínimas;
5. timing/urgencia cuando esté disponible.

### Trade-In
- vehículo usado;
- marca/modelo/año;
- km;
- fotos;
- notas;
- trazabilidad;
- valoración estimada/tasada cuando exista.

### Pipeline
Baseline simple:
- Nuevos/Bot
- Calificados
- Cita/Test Drive
- Vendido/Posventa

### Match Engine
- stock ↔ lead;
- score;
- razones;
- ranking;
- explicación.

### Reactivación
- borrador contextual;
- revisión/aprobación humana;
- envío;
- tracking de respuesta;
- atribución.

### Agenda
- cita/test drive;
- lead;
- vehículo;
- vendedor;
- estados.

### Venta
- comprador;
- vehículo;
- monto;
- forma simple declarativa;
- trade-in;
- evitar doble venta accidental.

### Sales Action Cockpit
- prioridad de hoy;
- matches;
- conversaciones pendientes;
- test drives;
- ventas influenciadas;
- acciones concretas.

### Attribution
Conservar:
- match → reactivación → cita → venta;
- source/channel;
- campaign/ad/post/UTM cuando el canal lo provea.

---

# 6. FUERA DE ALCANCE DE P1

No construir ahora:
- ERP contable;
- facturación fiscal;
- contabilidad completa;
- compras/proveedores/caja;
- taller integral;
- motor financiero/bancario completo;
- cobranzas judiciales;
- pricing dinámico automático;
- inteligencia predictiva de qué autos importar;
- marketplace público;
- red interconcesionarios;
- app móvil nativa;
- omnicanalidad completa;
- Instagram automation completa;
- Marketing Intelligence profunda;
- Lifecycle Journey completo;
- automatización masiva irrestricta;
- microservicios prematuros.

P1 será **web responsive**, desktop/tablet first.

---

# 7. SALES ACTION COCKPIT — HOME PRINCIPAL

## Definición
El home no debe ser un dashboard de gráficos.

Debe responder:
> **¿Qué hago hoy?**

Cada tarjeta accionable debe incluir:
- persona/vehículo;
- motivo de prioridad;
- recencia;
- CTA inmediato.

## Bloques
### Prioridad Hoy
Ejemplos:
- lead caliente;
- match nuevo;
- test drive por confirmar;
- conversación sin respuesta;
- lead reactivado;
- oferta respondida.

### Match Feed
Ejemplo:
> Diego Benítez · 89% match · Premio 2016 · entrega suficiente · consultó hace 18 días.

### Inbox SLA
Conversaciones entrantes sin respuesta + tiempo transcurrido.

### Agenda
Próximos test drives y conflictos.

### Impacto
Ventas influenciadas y valor vendido, secundario a las acciones.

## Visión “al despertar”
Una visión central del producto es:

> **El jefe abre Porandú por la mañana y el sistema ya estuvo trabajando.**

Ejemplo conceptual:
- 5 oportunidades calientes nuevas;
- 3 leads reactivados;
- 2 clientes respondieron ofertas;
- 1 unidad nueva tiene 7 compradores potenciales;
- 4 seguimientos listos para revisar.

No significa comprometer precios o condiciones económicas sin permisos.

---

# 8. ARQUITECTURA VISUAL — OPPORTUNITY WORKSPACE

## Layout oficial de escritorio
```text
┌────────┬──────────────────────┬────────────────────────────────────┬──────────────────────┐
│ NAV    │ CUSTOMER / MEMORY    │ INTELLIGENCE WORKSPACE             │ VEHICLE RAIL         │
│        │                      │                                    │                      │
│        │ Perfil del cliente   │ Scores                             │ Current Vehicle      │
│        │ WhatsApp ● En vivo   │ ¿Por qué ahora?                    │ Trade-In             │
│        │ Estado / asesor      │ Talking Points                     │ Top Match            │
│        │ accesos internos     │ Next Best Action                   │ Alternative Match    │
└────────┴──────────────────────┴────────────────────────────────────┴──────────────────────┘
```

## Global Navigation Rail
Baseline inicial:
- Cockpit
- Opportunities
- Stock
- Conversations
- Calendar
- Recovery
- Intelligence
- Settings

## Customer / Memory Panel
Siempre visible:
- cliente;
- estado comercial;
- vendedor;
- score/prioridad;
- WhatsApp **● En vivo** con punto verde cuando corresponde;
- Perfil;
- Conversación;
- Notas;
- Actividad;
- Campañas;
- Historial.

### Conversación vs Actividad
- **Conversación:** qué se dijo.
- **Actividad:** qué ocurrió/cambió en el sistema.

Ejemplo de Actividad:
- Intent 82 → 91;
- presupuesto confirmado;
- trade-in detectado;
- mensaje respondido;
- vehículo enviado;
- lead creado.

---

# 9. PORANDÚ MEMORY

## Principio
> **El vendedor corrige; no carga.**

WhatsApp y otros eventos deben alimentar el sistema automáticamente siempre que sea posible.

```text
WhatsApp
   ↓
Interpretación
   ↓
Extracción estructurada
   ↓
Porandú Memory
   ↓
Stock / Scores / Match / NBA
   ↓
UI actualizada
```

## Current Truth
Cada dato debe conservar:
- valor vigente;
- historial;
- fuente;
- timestamp;
- estado/confianza.

Estados baseline:
- **Detectado**
- **Confirmado**
- **Corregido por humano**

Una corrección humana confirmada tiene prioridad sobre inferencias posteriores dudosas.

## Ejemplo
Cliente primero dice:
> presupuesto USD 20.000

Luego:
> puedo llegar a USD 23.000 si toman bien mi usado

Porandú:
- cambia Current Truth a USD 23.000;
- conserva USD 20.000 en historial;
- recalcula Match/Deal;
- registra el cambio en Activity.

## Regla
Porandú no guarda chats solo por guardar: conserva **intención reutilizable**:
- qué busca;
- cómo compra;
- entrega;
- usado;
- urgencia;
- objeciones;
- resultados anteriores.

---

# 10. INTELLIGENCE WORKSPACE v0.1

## Cuatro scores visibles
```text
PORANDÚ        INTENT        VEHICLE FIT        DEAL
   88             92              91             79
```

### Porandú Score
Prioridad comercial general.

Fórmula conceptual inicial:
- Intent: 40%
- Vehicle Fit: 30%
- Deal Readiness: 30%

Se recalibrará con datos del piloto.

### Intent Score
Mide qué tan seriamente parece querer comprar/cambiar ahora.

Escala:
- 0–39: Exploratorio
- 40–64: Interés
- 65–79: Qualified Intent
- 80–89: High Intent
- 90–100: Buying Window

Señales fuertes:
- timing cercano;
- pregunta por cuota/documentos;
- disponibilidad para visita;
- entrega confirmada;
- test drive;
- financiación;
- respuestas recientes.

### Vehicle Fit
Mide compatibilidad entre intención y stock.

Variables posibles:
- presupuesto;
- tipo;
- marca;
- modelo;
- año;
- transmisión;
- combustible;
- km;
- color/equipamiento cuando son datos fiables;
- disponibilidad.

**Falta de información no penaliza automáticamente.**

### Deal Readiness
Mide qué tan viable está convertir la intención en operación.

Variables:
- presupuesto;
- entrega;
- financiación;
- cuota objetivo;
- trade-in;
- stock;
- timing;
- información crítica pendiente.

## Reglas de scoring
Todos los scores deben ser:
- explicables;
- trazables;
- reversibles;
- dinámicos.

No se debe confundir entusiasmo verbal con intención comercial real.

---

# 11. ¿POR QUÉ AHORA? / TALKING POINTS / NBA

## ¿Por qué ahora?
Máximo 3–5 drivers fuertes.

Ejemplos:
- quiere comprar este mes;
- presupuesto confirmado;
- trade-in detectado;
- preguntó financiación hace 6 minutos;
- pidió test drive.

Cada driver debe poder tener internamente:
- tipo;
- valor;
- fuente;
- timestamp;
- confidence/estado.

## Talking Points

### Bueno para mencionar
Ejemplo:
- unidad dentro del presupuesto;
- aceptamos trade-in;
- financiación disponible;
- test drive disponible.

### Validar
Ejemplo:
- km del usado;
- cuota máxima;
- monto real de entrega.

### Evitar / No asumir
Ejemplo:
- no asumir marca exclusiva;
- no prometer valor final de tasación sin inspección.

## Next Best Action
Regla:
- 1 acción primaria;
- hasta 2 secundarias;
- siempre explicar **qué hacer y por qué**.

Ejemplos:
- Preguntar presupuesto.
- Enviar Sportage 2022.
- Construir oferta.
- Agendar test drive.
- Seguimiento WhatsApp.
- Reactivar por nuevo stock.
- Mantener búsqueda activa.

---

# 12. RECENCY / ACTIVIDAD

Recency debe ser visible sin saturar.

Baseline visual aprobado:
- 🔥 **EN VIVO**: <5 min
- 🟢 **5–30 min**
- 🟡 **30 min–2 h**
- ❄️ **>2 h**

Debe representar tiempo desde una interacción significativa, no simplemente desde una actualización técnica.

---

# 13. VEHICLE RAIL — COLUMNA DERECHA

Objetivo:
> Mostrar qué tiene el cliente, qué venderle y cuál es la alternativa.

## Current Vehicle
- representación genérica/de catálogo;
- modelo/año;
- color si se conoce;
- kilometraje si existe;
- indicar que es representación, no foto real.

## Trade-In
Solo se activa si el cliente manifestó intención de entregar su vehículo.

Distinguir:
- detectado;
- estimación;
- tasación;
- valor aprobado.

## Top Match
Tarjeta protagonista:
- Match %;
- representación genérica;
- modelo/año;
- precio;
- km/transmisión;
- disponibilidad;
- hasta 3 razones de match;
- cuota estimada solo si existen datos suficientes;
- CTA **Construir oferta**;
- link **Ver unidad real**.

## Match Breakdown
Al abrir el score:
- presupuesto;
- tipo;
- transmisión;
- año;
- marca;
- km;
- confidence/información disponible.

## Alternative Match
Una segunda tarjeta visualmente secundaria.

Después:
> Ver más alternativas / Comparar

No llenar el Workspace con muchas unidades simultáneamente.

## Imágenes
### Opportunity Workspace
Representaciones genéricas/de catálogo.

### Stock
Fotos reales de la unidad.

Si las fotos ya llegaron por WhatsApp y corresponden al stock, Porandú debe intentar asociarlas a la ficha.

---

# 14. VEHICLE VISUAL RESOLVER

Responsabilidad:
```text
Marca + Modelo + Generación/Año + Color
                 ↓
        Vehicle Visual Resolver
                 ↓
       representación adecuada
```

Fallbacks:
1. modelo/generación/color;
2. modelo/generación;
3. modelo;
4. representación neutra.

Nunca aparentar que una imagen genérica es la fotografía real de esa unidad.

---

# 15. STOCK UX

## Principio
El módulo Stock representa la **realidad física del inventario**.

Debe priorizar:
- fotos reales;
- identificación rápida;
- alta ultrarrápida;
- edición progresiva;
- estado;
- precio;
- km;
- disponibilidad;
- matches/compradores potenciales.

## Alta rápida
Pocos campos mínimos inicialmente; enriquecer después.

## Fotos
- incorporar fotos existentes cuando sea posible;
- permitir actualizar/agregar fotos;
- fotos reales solo dentro del contexto de stock/unidad.

## Nuevo stock
Al pasar a **Disponible**:
- disparar Match Engine;
- generar compradores potenciales;
- mostrar match count;
- alimentar Cockpit.

---

# 16. STOCK MATCH ENGINE

## Tesis
El ingreso de stock debe convertirse automáticamente en una lista priorizada de compradores potenciales.

## Elegibilidad antes de score
Baseline:
- mismo organization_id;
- lead no vendido/bloqueado/excluido;
- recencia válida/configurable;
- datos mínimos;
- consentimiento/canal válido;
- evitar reactivación duplicada reciente.

## Match Score técnico inicial
Baseline técnica original:
- capacidad financiera/entrega: 25
- marca: 20
- modelo: 20
- tipo compra/financiación: 15
- recencia: 10
- año/rango: 4
- transmisión: 3
- otros atributos fiables: 3

Estos pesos **no son verdad permanente**; se calibran con pilotos.

## Bandas
- 80–100: alta prioridad;
- 60–79: buen candidato;
- 40–59: posible;
- <40: no priorizar por defecto.

## Explicabilidad
Guardar score + razones junto al match.

---

# 17. REVENUE RECOVERY / REACTIVACIÓN

## Definición
Revenue Recovery utiliza:
- Porandú Memory;
- Match Engine;
- stock nuevo;
- reactivación;
- atribución.

No define toda la startup.

## Reactivación P1
Antes de automatización total:
- Porandú genera borrador contextual;
- vendedor revisa;
- vendedor envía;
- se registra:
  - suggested_at
  - sent_at
  - replied_at
  - appointment_at
  - sale_at

## “Reciclador de Leads”
Nombre/caso de uso comercial futuro.

Puede:
- importar CSV/Excel histórico;
- segmentar;
- generar reenganche contextual;
- clasificar respuesta:
  - ya compró;
  - sigue buscando;
  - sin respuesta;
  - otros;
- escalar al humano solo interés real.

Toda salida masiva debe respetar:
- consentimiento;
- templates;
- ventana de conversación;
- políticas vigentes de WhatsApp.

---

# 18. TRADE-IN AUTO-FUNNEL

## Tesis
Un trade-in puede convertirse en nuevo inventario y reiniciar el loop.

```text
Lead
 ↓
Trade-In capturado
 ↓
Tasación / revisión humana
 ↓
Venta cerrada
 ↓
Crear vehículo en stock = En preparación
 ↓
Fotos / limpieza / preparación
 ↓
Disponible
 ↓
Match Engine
 ↓
Preventa / reactivación
```

## Datos mínimos
- marca;
- modelo;
- año;
- km;
- fotos;
- documentación/notas;
- valor estimado/tasado si existe;
- lead_id;
- sale_id;
- converted_vehicle_id;
- trazabilidad.

## Preventa “Próximamente”
P1.1:
- vehículo todavía en preparación;
- recoger interesados;
- UI debe dejar claro que no está aún disponible para entrega/test drive.

---

# 19. OFFER BUILDER v0.1

## Objetivo
Convertir contexto comercial ya conocido en propuesta lista para revisar/enviar en **30–60 segundos**.

## Apertura
Drawer grande desde la derecha, sin perder el Opportunity Workspace.

## Estructura
1. Vehículo
2. Trade-In
3. Estructura económica
4. Financiación simple si aplica
5. Deal Health
6. Preview / Offer Card
7. Mensaje acompañante
8. Acción final

## Vehículo
Distinguir:
- precio publicado;
- precio oferta.

Cambios del vendedor quedan registrados.

## Trade-In
Separar:
- detectado;
- estimado;
- tasado;
- aprobado.

## Estructura económica
Soportar conceptualmente:
- contado;
- financiación;
- mixto / trade-in + efectivo + financiación.

## Goal Seek
Si el cliente informó cuota objetivo, Porandú intenta:
- estructurar una operación compatible;
- o sugerir otra unidad.

No inventar condiciones financieras inexistentes.

## Deal Health
Indicador interno de qué tan completa/cerrable está **esa oferta**.  
No es un quinto score global.

## Preview
Offer Card visual, limpia, compartible.

WhatsApp es el canal principal. PDF no es protagonista de P1.

## Mensaje acompañante
Porandú redacta un mensaje contextual.  
Más adelante utilizará Style Profile por asesor.

## Human Approval
En P1:
> Las ofertas económicas requieren aprobación humana antes de enviar.

## Estados
- Borrador
- Enviada
- Vista
- En negociación
- Aceptada
- Rechazada
- Expirada (si aplica)

## Negociación viva
Objeciones y contraofertas:
- detectar;
- registrar;
- conservar historial;
- nunca sobrescribir silenciosamente.

---

# 20. WHATSAPP / CONVERSATION INTELLIGENCE

## Rol
WhatsApp es la **principal interfaz invisible** de Porandú.

La web no debe obligar a duplicar datos que ya existen en conversación.

## Regla de las 3 preguntas
1. ¿Buscás comprar al contado o financiar?
2. ¿Con cuánto aproximadamente contarías para la entrega inicial?
3. ¿Tenés algún vehículo para entregar como parte de pago?

El lenguaje puede adaptarse al showroom, pero la estructura de datos permanece estable.

Si el prospecto ya dio el dato, Porandú no lo vuelve a preguntar.

## Estados de conversación
- BOT_ACTIVE
- HUMAN_TAKEOVER
- WAITING_CUSTOMER
- NEEDS_REVIEW
- CLOSED

## Handoff
El humano puede tomar control en cualquier momento.

## Auto-respuestas de documentación
Futuro:
- cédula;
- chapa;
- transferencia;
- gestoría/escribanía.

Regla:
> responder solo estados que provienen de datos reales; nunca inventar estado documental.

---

# 21. HUMANIZED CONVERSATION ENGINE — FUTURO APROBADO

## Objetivo
Que Porandú no responda con una voz genérica, sino adaptada al estilo del asesor/showroom.

## Style Profile por asesor
Puede incluir:
- vocabulario;
- formalidad;
- longitud;
- emojis;
- saludos;
- cierres;
- ritmo;
- patrones de mensajes.

## Modos futuros
- sugerido/revisión;
- semi-automático;
- automático dentro de permisos.

## Pacing natural
- indicador de “escribiendo…” mientras realmente se prepara una respuesta;
- pausas razonables;
- división natural de mensajes.

No diseñar trucos cuyo objetivo sea afirmar falsamente que un humano está escribiendo manualmente.

---

# 22. GUARDIA 24/7 — CASO DE USO FUTURO DE ALTO VALOR

## Objetivo
Atender y cualificar inbound fuera de horario.

## Flujo deseado
1. Lead entra noche/fin de semana.
2. Porandú responde con baja latencia.
3. Qualification conversacional:
   - presupuesto;
   - vehículo;
   - contado/financiado;
   - trade-in.
4. Consulta stock.
5. Recomienda unidades pertinentes.
6. Agenda cita/test drive.
7. Prepara handoff/resumen.
8. Vendedor llega y encuentra oportunidad lista.

**<10s** es objetivo interno, no promesa comercial hasta validar infraestructura.

---

# 23. ZERO-TOUCH ONBOARDING — P1.1 / P1.2

## Objetivo
Eliminar la carga manual inicial y reducir Time-to-Value.

## Visión
> Conectar WhatsApp y que Porandú reconstruya automáticamente la mayor cantidad posible del negocio.

## Mecánica deseada
- integración oficial;
- historial disponible según capacidades reales de la plataforma/proveedor;
- background jobs;
- UI no se bloquea;
- progreso visible;
- descubrimiento progresivo de:
  - clientes;
  - intenciones;
  - trade-ins;
  - vehículos;
  - fotos;
  - posibles matches.

## “Efecto magia”
Ejemplo:
- X clientes encontrados;
- Y oportunidades;
- Z posibles trade-ins;
- vehículos detectados;
- matches apareciendo.

## Regla de incertidumbre
No convertir automáticamente toda mención en verdad.

Clasificar:
- stock confirmado;
- candidato a stock;
- trade-in / vehículo de cliente;
- histórico/vendido;
- requiere revisión.

## Marketing
No prometer todavía:
- 30/60/90 días exactos;
- “todo en 3 minutos”.

Framing provisional:
> **Conectá tu WhatsApp y empezá a descubrir oportunidades en minutos.**

---

# 24. OMNICHANNEL SOCIAL INBOUND — POST-P1

## Principio
WhatsApp sigue siendo el Qualification Engine central.

Otros canales son fuentes de adquisición.

## Instagram
P1.2 candidato:
- comentarios;
- DMs;
- detección de intención;
- triaje;
- derivación a WhatsApp;
- preservar source/campaign/post.

Flujo:
```text
Instagram
  ↓
Comentario / DM
  ↓
Social Triage
  ↓
Intención detectada
  ↓
WhatsApp
  ↓
Qualification Engine
  ↓
Porandú Memory
```

## TikTok
Exploración futura.  
No comprometer automatización comercial hasta validar APIs/capacidades oficiales reales.

---

# 25. CAMPAIGN ATTRIBUTION Y MARKETING INTELLIGENCE

## P1
Capturar metadata mínima cuando exista:
- source/channel;
- campaign_id/name;
- ad_id/post_id;
- UTM;
- source_metadata flexible.

## Futuro
Marketing Intelligence:
- campañas/posts que producen consultas;
- consultas que se califican;
- citas;
- ventas;
- revenue real;
- ROI.

No convertir P1 en una plataforma de marketing.

---

# 26. AUTOMOTIVE INTENT GRAPH — MOAT FUTURO

Con el tiempo, Porandú puede representar relaciones entre:
- compradores;
- intención;
- capacidad financiera;
- preferencias;
- trade-ins;
- stock;
- conversaciones;
- acciones;
- conversiones.

La defensibilidad futura no depende de un chatbot o una pantalla aislada, sino del histórico y aprendizaje acumulado.

---

# 27. PORANDÚ AUTO-OPTIMIZER (PAO) — BACKLOG FUTURO

Módulo futuro de optimización continua.

Objetivo:
- analizar interacciones;
- inventario;
- respuestas;
- resultados;
- detectar qué prompts/preguntas/secuencias/ofertas funcionan mejor;
- generar hipótesis;
- ejecutar experimentos controlados;
- medir impacto comercial.

No construir ahora.  
Solo activar cuando exista volumen de datos y guardrails suficientes.

---

# 28. LIFECYCLE / POSVENTA — ROADMAP

Ideas aprobadas de evolución:
- mensaje de entrega Día 1;
- ficha digital/recomendaciones;
- recordatorio mantenimiento ~6 meses;
- agenda de taller;
- review journey;
- recompra 2–3 años;
- trade-in futuro;
- fidelización.

Lifecycle Engine no bloquea P1.

---

# 29. MODELO DE NEGOCIO — BASELINE PROVISIONAL

Modelo:
> **SaaS B2B MRR + Fee de Setup/Implementación**

Los precios son una hipótesis de trabajo, no precio definitivo.

| Plan | Target | Stock | Usuarios | Precio mensual |
|---|---|---:|---:|---:|
| Starter | playas/agencias pequeñas | hasta 30 | hasta 3 | **850.000 PYG** |
| Pro | concesionarias/playas consolidadas | hasta 80 | hasta 8 | **1.800.000 PYG** |
| Enterprise | grupos multisucursal | placeholder ilimitado | placeholder ilimitado | **3.500.000 PYG** |

Aprox. de trabajo:
- Starter ~USD 115
- Pro ~USD 240
- Enterprise ~USD 470

### Nota
“Unlimited” en Enterprise es placeholder comercial. Más adelante revisar fair-use/costos variables.

---

# 30. SETUP Y GO-TO-MARKET

## Clientes pioneros / laboratorios
Primeras **3–5 agencias**:
- setup: **0 PYG**;
- uso intensivo;
- feedback continuo;
- métricas reales;
- casos de éxito;
- validación de pricing y producto.

## Fase comercial regular
Setup baseline:
**3.500.000–5.000.000 PYG**, según escala.

Puede incluir:
- importación inicial;
- stock/datos;
- integración de canales;
- configuración de reglas;
- onboarding/capacitación.

No es precio definitivo hasta validar disposición a pagar.

## Pilares de venta
1. Recuperar revenue.
2. Reducir leads perdidos.
3. Trabajar fuera de horario.
4. Priorizar compradores reales.
5. Reducir carga administrativa del vendedor.
6. Hacer que el inventario encuentre demanda.

## ROI
“El software se paga solo” es framing válido.

La afirmación:
> “1 vehículo adicional al año paga Pro”

debe validarse contra margen/contribución real del cliente antes de usarla como promesa universal.

Evitar claims absolutos como “cero fuga” si no pueden demostrarse.

---

# 31. ARQUITECTURA TÉCNICA OFICIAL

Esta sección **supersede exploraciones tempranas de SQLite local → Postgres/OpenAI**.

## Frontend / Full-stack
- **Next.js**
- **TypeScript**
- React
- sistema de diseño propio
- componentes accesibles

## Database
- **PostgreSQL vía Supabase**

## Auth
- **Supabase Auth**

## Storage
- **Supabase Storage**
- fotos de stock;
- fotos de trade-ins.

## ORM / Query Layer
- **Drizzle ORM** o acceso tipado equivalente;
- schema explícito;
- migraciones controladas.

## IA
- proveedor LLM desacoplado detrás de servicio interno;
- no acoplar dominio a OpenAI/Claude/etc.;
- IA para extracción, copy, asistencia y razonamiento acotado.

## Hosting
Proveedor compatible con Next.js + Supabase.

## Arquitectura
**Monolito modular**.

No microservicios prematuros.

## Multi-tenancy
Desde el inicio:
- organization_id;
- memberships;
- RLS;
- aislamiento por tenant.

Teléfonos/identificadores pueden ser únicos **dentro del tenant**, no globalmente.

## Observabilidad
- logs estructurados;
- error tracking;
- jobs observables.

## Integraciones
- webhooks idempotentes;
- jobs reintentables;
- errores visibles.

## Entornos
- local;
- staging;
- producción más adelante.

---

# 32. PRINCIPIOS DE DATOS Y DOMINIO

## Entidades centrales
- Organization / Tenant
- Branch
- User
- Membership
- Contact
- Lead / Opportunity
- Preference / Intent
- Conversation
- Message
- Vehicle
- Vehicle Media
- Trade-In
- Stock Match
- Appointment / Test Drive
- Sale
- Attribution Event
- Activity Event

## Definiciones
### Contact
Persona identificada principalmente por teléfono/WhatsApp dentro de una organización.

### Lead
Oportunidad comercial activa o histórica asociada a un contacto.

### Calificado
Lead con información suficiente para evaluar compatibilidad y siguiente acción.

### Match
Relación lead ↔ vehículo con score + razones.

### Reactivación
Contacto iniciado a partir de un match/evento.

### Venta influenciada
Venta con cadena de atribución hacia una acción/recomendación de Porandú.

### NBA
Next Best Action.

### Porandú Memory
Memoria estructurada transversal, no módulo aislado.

---

# 33. DISEÑO UI/UX SELLADO

## Principios
- action-first;
- claridad antes que decoración;
- desktop/tablet first;
- responsive móvil suficiente;
- drawers laterales;
- navegación poco profunda;
- CTA principal único por contexto;
- score/estado/recencia visibles;
- loading percibido rápido;
- skeletons;
- optimistic UI solo donde sea seguro;
- feedback inmediato.

## Estilo base
- dark mode elegante;
- glassmorphism moderado;
- identidad visual propia de Porandú;
- tomar inspiración estructural de sistemas automotrices estudiados, **sin copia pixel-perfect**.

## Regla visual
> **Cada elemento de interfaz debe justificar una decisión comercial.**

---

# 34. ORDEN DE CONSTRUCCIÓN OFICIAL

## Hito 0 — Fundación
- crear repositorio;
- convenciones;
- Next.js/TypeScript;
- Supabase;
- local/staging;
- Auth;
- organizations;
- memberships;
- RLS;
- design tokens;
- shell de navegación.

## Hito 1 — Inventario + CRM básico
- schema vehicles;
- contacts;
- leads;
- preferences;
- media;
- alta rápida;
- cards/lista;
- Vehicle Drawer;
- leads list;
- Lead Drawer;
- pipeline;
- seed/demo;
- source metadata.

## Hito 2 — WhatsApp + Qualification
- webhook oficial;
- idempotencia;
- conversaciones;
- Inbox;
- BOT/HUMAN;
- extracción de preguntas;
- trade-in básico/fotos.

## Hito 3 — Match Engine
- eligibility query;
- scoring explicable;
- stock_matches;
- razones;
- Vehicle Drawer compradores;
- Cockpit Match Feed.

## Hito 4 — Reactivación + Agenda
- borradores;
- envío controlado;
- trazabilidad;
- respuesta vinculada;
- test drive;
- NBA.

## Hito 5 — Venta + Attribution + Trade-In Loop
- venta;
- atribución;
- convertir trade-in en stock;
- impacto mínimo;
- demo end-to-end.

## Hito 6 — Piloto
- onboarding de 1 showroom real;
- importación controlada;
- baseline “antes de Porandú”;
- medir matches;
- respuestas;
- citas;
- ventas;
- Revenue Recovery/origen cuando los datos permitan;
- cambiar producto con evidencia.

---

# 35. ESTRATEGIA DE PROTOTIPADO ACTUAL

Antes de integrar todo el backend, validar el vertical slice visual principal.

## Vertical slice inicial recomendado
```text
Action Cockpit
      ↓
Opportunity Workspace
      ↓
Intelligence Workspace
      ↓
Vehicle Rail
      ↓
Offer Builder
```

Usar mock/seed data inicialmente para validar:
- jerarquía;
- interacción;
- fluidez;
- diseño;
- claridad comercial.

Luego conectar progresivamente:
- persistencia;
- Stock;
- Memory;
- Match;
- WhatsApp;
- IA.

Esto no reemplaza los hitos técnicos; es la estrategia de validación de UX dentro del inicio de construcción.

---

# 36. CRITERIOS DE ACEPTACIÓN P1

P1 debe poder demostrar que:

- usuario solo ve tenants autorizados;
- vehículo puede cargarse rápido y pasar a Disponible;
- lead puede crearse/recibirse sin duplicar contacto;
- WhatsApp entrante aparece una sola vez;
- calificación puede extraerse y corregirse;
- trade-in tiene datos/fotos/trazabilidad;
- un vehículo Disponible genera matches explicables;
- vendedor puede revisar/enviar reactivación;
- lead avanza por pipeline;
- test drive se agenda con lead + vehículo + vendedor;
- venta evita doble venta;
- trade-in de venta puede convertirse en stock;
- venta influenciada queda atribuida;
- Cockpit muestra acciones reales;
- jobs/webhooks son resilientes;
- flows principales funcionan desktop/tablet;
- Memory conserva intención para futuros matches;
- source/campaign metadata se conserva cuando existe.

---

# 37. DEMO END-TO-END DE REFERENCIA

1. Crear Toyota Premio y dejarlo En Preparación.
2. Registrar/importar leads históricos con distintas preferencias/entregas.
3. Cambiar Premio a Disponible.
4. Generar matches y explicar score.
5. Vendedor envía reactivación.
6. Simular respuesta.
7. Completar Qualification.
8. Agendar test drive.
9. Cerrar venta.
10. Registrar Toyota Vitz como trade-in.
11. Convertir Vitz a En Preparación → Disponible.
12. Generar nueva ronda de matches.
13. Cockpit muestra venta influenciada y nuevo ciclo.

---

# 38. ROADMAP FUTURO CONSOLIDADO

## P1.1
- mejoras de inventario;
- optimización de Qualification;
- Marketing Express/copy;
- preventa “Próximamente”;
- landing pages dinámicas;
- comparador de vehículos;
- Zero-Touch Onboarding;
- posibles auto-respuestas simples de gestoría;
- mejoras de Offer Builder;
- Humanized Conversation Engine gradual.

## P1.2
- Instagram comments/DM → WhatsApp;
- Omnichannel Lead Capture inicial;
- automatización de reactivación después de validar políticas;
- Social Triage;
- mayor autonomía de Guardia 24/7.

## P2
- gestoría/escribanía más profunda;
- cuotas/financiación propia si se valida;
- recibos;
- mora;
- tracking de documentos/transferencias;
- comparador avanzado.

## P3
- service;
- agenda taller;
- Lifecycle Journey;
- mantenimiento;
- reviews;
- fidelización;
- recompra.

## P4
- Demand Intelligence;
- Marketing Intelligence;
- recomendación de stock;
- Automotive Intent Graph más avanzado.

## P5 / Futuro
- partners;
- APIs;
- ecosistema;
- PAO / Auto-Optimizer;
- optimización autónoma basada en resultados.

---

# 39. DECISIONES EXPLÍCITAMENTE SELLADAS

No reabrir sin evidencia:
- Porandú Autos es proyecto prioritario.
- Objetivo = vender más autos.
- SaaS B2B, no marketplace.
- P1 = Sales Engine + Stock Engine.
- Lifecycle existe en diseño pero no completo en P1.
- WhatsApp es canal principal.
- Match + Reactivation + Trade-In Loop son diferenciadores iniciales.
- Porandú Memory es transversal.
- Revenue Recovery es caso de uso estrella, no definición total.
- Action Cockpit es home action-first.
- Multi-tenancy real desde inicio.
- Monolito modular.
- Next.js/TypeScript + Supabase/PostgreSQL.
- No microservicios prematuros.
- Reactivación humana/sugerida antes de automatización total.
- Attribution mínima desde P1.
- UI principal = Opportunity Workspace + Intelligence + Vehicle Rail.
- Four scores = Porandú / Intent / Vehicle Fit / Deal.
- Scores explicables/trazables/reversibles/dinámicos.
- Opportunity Workspace usa representaciones genéricas.
- Stock usa fotos reales.
- Offer Builder requiere aprobación humana para ofertas económicas en P1.
- El vendedor corrige; no debería cargar manualmente información que Porandú ya puede obtener.
- Nuevas ideas van a backlog salvo evidencia para cambiar P1.

---

# 40. PREGUNTAS QUE SIGUEN ABIERTAS

No bloquear creación del repositorio por estas preguntas:
- nombre final de algunos componentes internos;
- branding/colores finales;
- proveedor LLM concreto;
- proveedor WhatsApp/BSP concreto;
- pesos finales de scores;
- pricing definitivo;
- límites/fair-use Enterprise;
- reglas exactas de autonomía;
- profundidad de histórico disponible en Zero-Touch;
- integración bancaria/financiera futura;
- TikTok APIs;
- PAO experimental design.

Estas se resuelven con implementación, investigación técnica o pilotos, no reabriendo la tesis.

---

# 41. PUNTO EXACTO DE REANUDACIÓN — 21 SEP 2026

La fase estratégica principal está cerrada.

Ahora comienza **Fase de Construcción e Ingeniería**.

## Secuencia inmediata
1. Crear repositorio oficial.
2. Crear `/docs` y guardar este Master Context.
3. Definir convenciones y arquitectura inicial de archivos.
4. Scaffold Next.js/TypeScript.
5. Configurar Supabase y variables de entorno.
6. Crear shell/navegación con design tokens.
7. Implementar vertical slice visual con mock data:
   - Action Cockpit
   - Opportunity Workspace
   - Intelligence Workspace
   - Vehicle Rail
   - Offer Builder
8. Validar la experiencia.
9. Implementar schemas P1 y persistencia.
10. Seguir hitos oficiales.

## Regla de trabajo ChatGPT ↔ Claude
ChatGPT puede actuar como:
- Product Architect;
- arquitecto funcional;
- reviewer;
- diseñador de flujos;
- guardián de baseline;
- generador de specs/prompts;
- revisión de PRs/decisiones.

Claude puede actuar como:
- ingeniero de implementación;
- generador/refactor de código;
- ejecutor de specs.

Ningún agente debe cambiar el producto por iniciativa propia.

---

# 42. ESTRUCTURA DOCUMENTAL RECOMENDADA DEL REPO

```text
porandu-autos/
├── README.md
├── docs/
│   ├── 00_MASTER_CONTEXT.md
│   ├── 01_TECHNICAL_BLUEPRINT_v1.1.md
│   ├── 02_VISUAL_PRODUCT_BLUEPRINT_v0.1.md
│   ├── 03_P1_BUILD_SCOPE.md
│   ├── 04_FUTURE_BACKLOG.md
│   └── 05_DECISIONS_LOG.md
├── app/
├── components/
├── lib/
├── public/
└── ...
```

Este Master Context puede convertirse directamente en:
`docs/00_MASTER_CONTEXT.md`

---

# 43. DIRECTIVA FINAL PARA CUALQUIER AGENTE QUE LEA ESTE ARCHIVO

> Estás trabajando sobre Porandú Autos, una baseline ya definida. No estás en una fase de ideación abierta. Tu responsabilidad es convertir las decisiones aprobadas en software claro, mantenible y testeable. Si detectás una limitación técnica real, explicala y proponé la mínima modificación compatible con la tesis. Cualquier mejora no necesaria para P1 debe ir al backlog. El objetivo de Productivo 1 es probar que Porandú ayuda a un showroom a vender más autos.

**FIN — MASTER CONTEXT v1.0**
