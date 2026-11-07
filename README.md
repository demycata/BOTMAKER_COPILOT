# Copilot for Botmaker

Extension de Chrome (Manifest V3) que le agrega a Botmaker un panel lateral con
**seleccion multiple de chats**, **acciones masivas** y un **motor de reglas**
(ej: cuando el cliente escribe "hablar con asesor", responder o dejar escrito un
mensaje). Opera 100% sobre el DOM, simulando a un operador. No usa la API ni la
IA de Botmaker.

Esta es la **primera fase**: la maquinaria completa esta hecha; falta un unico
paso de calibracion (ver mas abajo) para que enganche con el HTML real de tu
Botmaker.

## Instalacion

```bash
npm install
npm run build      # genera la carpeta dist/
```

Despues, en Chrome:

1. Ir a `chrome://extensions`
2. Activar **Modo de desarrollador** (arriba a la derecha)
3. **Cargar descomprimida** (Load unpacked) y elegir la carpeta `dist/`
4. Abrir Botmaker. Clickear el icono de la extension abre el panel lateral.

Para desarrollo: `npm run dev` deja esbuild en modo watch (rebuild automatico).
Tras cada cambio, en `chrome://extensions` tocá "Actualizar" en la extension y
recarga la pagina de Botmaker (F5).

> Nota de build: se usa **esbuild** (no Vite/CRXJS). El content script se compila
> como un bundle IIFE autocontenido para que corra en el mundo aislado sin que el
> CSP de Botmaker bloquee su carga. Con el loader dinamico de CRXJS el content no
> llegaba a ejecutarse en go.botmaker.com.

## Estado: calibrado y completo

Todos los selectores estan ajustados al HTML real de tu Botmaker
(`.customers-list`, `.customer-item`, `.customer-name`, `.text-entry-left`,
`#input-component`, `#send-button-component`, `button[aria-label="Acciones de Chat"]`,
el menu `ul.MuiMenu-list`, etc.). Funciona:

- **Seleccion multiple** sobre las conversaciones visibles, con contador.
- **Liberar** / **Transferir** / **Asignar a cola** / **Marcar spam** (via el menu
  de acciones de cada conversacion).
- **Enviar mensaje** masivo y la **regla "Hablar con Asesor"** (detecta el mensaje
  entrante y responde o deja el texto escrito, segun el toggle de auto-envio).

Unica accion con un paso pendiente: **Posponer** abre un submenu para elegir la
duracion; ese segundo paso queda por calibrar cuando tengas a mano el HTML del
submenu de tiempos. Las demas acciones son de un click y ya andan.

## Limitacion importante: la lista es virtualizada

Tu lista de chats usa **react-virtualized**: el navegador solo tiene en memoria
las filas que se VEN; al scrollear, recicla los nodos. Consecuencias:

- **"Seleccionar todo" abarca solo lo renderizado**, no las 200 conversaciones de
  la cola. Para incluir mas hay que ir scrolleando (o, mas adelante, agregar un
  auto-scroll que las materialice; es mas fragil).
- En una accion masiva, tras abrir un chat la lista puede re-renderizar. Por eso
  el adapter **re-resuelve cada conversacion por su id** antes de operar. Si una
  quedo fuera de vista, ese item falla de forma controlada (se registra y sigue).
- El **motor de reglas no se ve afectado**: opera sobre la conversacion abierta.

## Que funciona hoy

- Panel lateral oscuro con: modo seleccion, contador, todo/ninguno/invertir,
  selector de accion masiva, barra de progreso, editor de la regla y log.
- Toda la logica independiente del DOM: estado de seleccion, cola de acciones
  con manejo de errores por chat + resumen, y evaluacion de reglas.
- Mensajeria tipada panel <-> background <-> content.
- Persistencia de la regla y su estado en `chrome.storage.local`.

## Estructura

```
src/
  adapters/botmaker/   # UNICA capa acoplada a Botmaker (selectors + acciones + dom utils)
  core/                # logica pura: seleccion, cola de acciones, motor de reglas
  content/             # content script: pega todo con el DOM real
  background/          # service worker: relay de mensajes + abre el panel
  sidepanel/           # UI del panel (html + css + ts)
  messaging/           # contrato tipado de mensajes
  storage/             # wrapper de chrome.storage.local
  types/               # tipos de dominio
```

## Notas tecnicas

- El service worker de MV3 es efimero; por eso la orquestacion de lotes y el
  motor de reglas viven en el content script (que dura lo que dure la pestania).
- Las acciones se disparan de a una, con pausa entre chats y try/catch por chat:
  un fallo no frena el lote.
- Las acciones que usan modales (agregar/quitar etiqueta) quedan marcadas como
  pendientes de calibrar, porque dependen de un flujo multi-paso del DOM.
- Automatizar Botmaker via DOM puede chocar con sus terminos de servicio; queda
  a tu criterio.
