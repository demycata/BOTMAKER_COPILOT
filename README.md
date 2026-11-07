# Copilot for Botmaker

Extension de Chrome (Manifest V3) que le agrega a Botmaker un panel lateral con
**seleccion multiple de chats**, **acciones masivas**, un **motor de reglas** y
**atajos de teclado**. Opera 100% sobre el DOM, simulando a un operador. No usa
la API ni la IA de Botmaker.

## Instalacion

```bash
npm install
npm run build      # typecheck + genera la carpeta dist/
```

Despues, en Chrome:

1. Ir a `chrome://extensions`
2. Activar **Modo de desarrollador** (arriba a la derecha)
3. **Cargar descomprimida** (Load unpacked) y elegir la carpeta `dist/`
4. Abrir Botmaker. Clickear el icono de la extension abre el panel lateral.

## Desarrollo

```bash
npm run dev        # esbuild en modo watch
npm test           # tests
npm run typecheck
```

Tras cada cambio, en `chrome://extensions` toca "Actualizar" en la extension y
recarga la pagina de Botmaker (F5).

Los tests corren contra una simulacion de Botmaker ([tests/fake-botmaker.ts](tests/fake-botmaker.ts))
que recicla los nodos de la lista como lo hace la pagina real. No reemplazan
probar en Botmaker: si Botmaker cambia su HTML, los tests siguen pasando.

> Nota de build: se usa **esbuild** (no Vite/CRXJS). El content script se compila
> como un bundle IIFE autocontenido para que corra en el mundo aislado sin que el
> CSP de Botmaker bloquee su carga. Con el loader dinamico de CRXJS el content no
> llegaba a ejecutarse en go.botmaker.com.

## Que hace

El panel principal tiene Seleccion, Accion masiva y los botones Posponer todo y
Cerrar todos. El engranaje abre Configuracion: mensajes, reglas, atajos, actividad
y diagnostico.

- **Seleccion multiple** con checkboxes en la lista y contador. La seleccion se
  mantiene al scrollear.
- **Todo** recorre la lista entera, incluidas las conversaciones que no estan en
  pantalla. Corta a los 60 segundos y avisa si pudo quedar alguna afuera.
- **Acciones masivas**: Liberar, Posponer, Cerrar (consulta resuelta) y Enviar
  mensaje. Los chats que salen bien se desmarcan; los que fallan quedan
  seleccionados para reintentar.
- **Posponer todo** recorre la lista actual: tras confirmar, abre cada chat y
  pospone 4 horas los que terminan con tu saludo escrito por una persona. Los
  demas quedan igual. Posponer solo existe en chats asignados.
- **Cerrar todos** busca los chats pospuestos de la lista actual y, tras confirmar,
  les envia el mensaje configurado y los libera. Si el mensaje no sale, no libera
  ese chat. Si un chat dejo de estar pospuesto, lo saltea.
- **Reglas** "si el mensaje contiene X, responder Y", todas las que quieras. Cada
  una deja el texto escrito o lo envia, y actua una vez por chat. Si coinciden
  varias gana la primera de la lista. Funcionan con el panel cerrado y tras recargar.
- **Atajos** para liberar, posponer y cerrar la conversacion abierta.
- **Diagnostico**: el boton de la seccion Actividad muestra cuantos elementos
  encuentra cada selector en la pagina. Solo lee y no incluye datos de clientes.

## Protecciones

- Antes de actuar confirma que la conversacion abierta es la pedida y que cargo
  su hilo. Si no puede confirmarlo, ese chat falla y el lote sigue.
- Una regla nunca pisa un borrador del operador. Tampoco corre durante una accion
  masiva, ni repite una respuesta que ya figura en el chat.
- Si ya hay mensajes despues del cliente, una regla con auto-envio deja el texto
  escrito en vez de enviarlo: el chat puede estar ya atendido, y esta comprobacion
  no distingue mensajes de operador y de bot.
- Una accion cuenta como exitosa solo si se ve su efecto: el cuadro de texto se
  vacia al enviar, y el menu o el dialogo se cierran al liberar, posponer o cerrar.

## La lista es virtualizada

La lista usa **react-virtualized**: solo existen en el DOM las filas visibles y
los mismos nodos se reciclan para mostrar otras conversaciones. Por eso:

- Una conversacion se identifica siempre por el id de su fila, nunca por una
  referencia guardada al nodo.
- La lista vuelve sola arriba, asi que la fila del chat abierto puede no estar
  renderizada. La conversacion abierta se identifica por la URL (`#/chats/<id>`).
- Para llegar a una conversacion fuera de pantalla se scrollea la lista hasta
  encontrarla. Si no aparece (se cerro o cambiaste de vista), ese chat falla con
  un mensaje y el lote sigue.
- Con la pestania en segundo plano Chrome puede no renderizar el scroll, asi que
  conviene dejar Botmaker visible durante un lote.

## Estructura

```
src/
  adapters/botmaker/   # UNICA capa acoplada a Botmaker (selectors + acciones + dom utils)
  core/                # logica pura: seleccion, cola de acciones, motor de reglas
  content/             # content script: pega todo con el DOM real
  background/          # service worker: abre el panel
  sidepanel/           # UI del panel (html + css + ts)
  messaging/           # contrato tipado de mensajes panel <-> content
  storage/             # wrapper de chrome.storage.local
  types/               # tipos de dominio
tests/                 # tests y simulacion de Botmaker
```

Si Botmaker cambia su HTML, lo que hay que tocar esta en
[selectors.ts](src/adapters/botmaker/selectors.ts). Empeza por el boton
Diagnostico: un selector en 0 indica que hay que recalibrarlo. Los de menu y
dialogo dan 0 mientras no esten abiertos.

## Notas tecnicas

- El service worker de MV3 es efimero; por eso la orquestacion de lotes y el
  motor de reglas viven en el content script (que dura lo que dure la pestania).
- La configuracion vive en `chrome.storage.local`: el panel la escribe y el
  content la lee y escucha sus cambios.
- Automatizar Botmaker via DOM puede chocar con sus terminos de servicio; queda
  a tu criterio.
