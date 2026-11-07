// ============================================================================
//  CAPA ANTICORRUPCION - SELECTORES DE BOTMAKER  (CALIBRADO con DOM real)
// ----------------------------------------------------------------------------
//  Unico archivo acoplado al HTML de Botmaker. Si Botmaker cambia, se toca ACA.
//  Cada campo acepta varios selectores: gana el primero que exista.
//
//  NOTA CLAVE: la lista de chats es react-virtualized (.customers-list). Solo
//  existen en el DOM las filas VISIBLES; al scrollear los nodos se reciclan.
//  Por eso identificamos cada conversacion por el id del wrapper (div[id]) y no
//  por la referencia al nodo, que puede quedar obsoleta.
// ============================================================================

export const SELECTORS = {
  /** Grid virtualizado que contiene la lista de conversaciones. */
  chatList: ['.customers-list', '.ReactVirtualized__List'],

  /** Contenedor interno de las filas; su padre es el elemento que scrollea. */
  chatListInner: ['.ReactVirtualized__Grid__innerScrollContainer'],

  /** Contenido de cada fila (dentro del wrapper con id). */
  chatRow: ['.customer-item'],

  /** Wrapper posicionado de cada fila: su id ES el id de la conversacion. */
  chatItem: ['.ReactVirtualized__Grid__innerScrollContainer > div[id]'],

  /** Nombre del cliente dentro de la fila. */
  chatName: ['.customer-name', '.customer-primary-text'],

  /** Elemento clickeable que abre la conversacion (evita los de sesiones). */
  chatOpen: ['.customer-item > .customer-main[role="button"]', '.customer-main[role="button"]'],

  /** Etiqueta naranja de un chat pospuesto ("Puesto en espera por..."). */
  chatPostponed: ['.customer-chip.hold'],

  /** Marca de la fila actualmente abierta/seleccionada. */
  chatSelected: ['.customer-item.selected'],

  // --- Conversacion abierta ---

  /** Cada burbuja de mensaje (entrante o saliente). */
  messageItem: ['.text-entry-left', '.text-entry-right'],

  /** Marca de mensaje ENTRANTE (del cliente). */
  incomingMessageMarker: ['.text-entry-left'],

  /** Marca de mensaje SALIENTE (operador o bot). */
  outgoingMessageMarker: ['.text-entry-right'],

  /** Dentro de una burbuja saliente: la escribio una persona, no el bot. */
  humanMessageMarker: ['.entries-li-sentby.from-human'],

  /** Solo el texto del mensaje, sin el nombre de quien lo envio. */
  messageText: ['.rule-message-all-container', '.inline-text'],

  /** Contenedor del texto dentro de una burbuja. */
  messageBody: ['.render-text-message-body', '.inline-text'],

  /** Cuadro de texto del operador (textarea con id estable). */
  composer: ['#input-component', 'textarea.input-component', '.chat-textarea-container textarea'],

  /** Boton de enviar (id estable). */
  sendButton: ['#send-button-component', 'button[aria-label="Enviar Mensaje"]', '.send-button-component'],

  // --- Menu de acciones de la conversacion ---

  /** Boton que ABRE el menu de acciones de la conversacion. */
  actionsMenuTrigger: ['button[aria-label="Acciones de Chat"]', '.toolbar-menu-button'],

  /** El menu desplegado. */
  actionsMenu: ['ul.MuiMenu-list[role="menu"]'],

  /** Items del menu. */
  actionsMenuItem: ['li.MuiMenuItem-root[role="menuitem"]'],

  /** Cualquier menu abierto, incluidos los submenus. */
  anyMenu: ['ul.MuiMenu-list'],

  /** Item de cualquier menu abierto. */
  anyMenuItem: ['li[role="menuitem"]'],

  /** Texto principal de un item de menu. */
  menuItemText: ['.MuiListItemText-primary'],

  // --- Cerrar conversacion (boton propio + dialogo, no via menu) ---

  /** Boton de la toolbar que abre el dialogo de cierre. */
  closeButton: ['button[aria-label="Cerrar Conversación"]', 'button[aria-label="Cerrar Conversacion"]'],

  /** El dialogo de cierre. */
  closeDialog: ['.BMDS-Dialog-Paper', '.MuiDialog-paper', '[role="dialog"]'],

  /** Input del autocomplete de tipo de conversacion. */
  closeTypeInput: ['.close-conversation-autocomplete input', '.MuiAutocomplete-input'],

  /** Opciones del autocomplete (listbox de MUI, renderizado en un popper). */
  autocompleteOption: ['li[role="option"]', '.MuiAutocomplete-option'],
} as const;

// ----------------------------------------------------------------------------
//  Identificacion de cada item del menu de acciones. Preferimos un id/ancla
//  estable cuando existe; si no, el texto visible (normalizado).
// ----------------------------------------------------------------------------

export const MENU_ITEMS = {
  // "Liberar chat asignado a <me/nombre>" -> el span interno tiene id estable.
  // El ancla podria ser la misma cuando el chat no esta asignado, por eso `guard`
  // exige que el item diga "liberar" antes de clickearlo.
  release: { anchorId: 'ChatsToolbar.lockChat', text: 'Liberar chat asignado', guard: 'liberar' },
  postpone: { text: 'Posponer atencion' }, // submenu: requiere elegir duracion
} as const;
