// Tipos de dominio compartidos por todos los modulos.

/** Un chat tal como lo vemos en la lista de conversaciones de Botmaker. */
export interface ChatRef {
  /** Id del wrapper de la fila en la lista de Botmaker. */
  id: string;
  /** Nombre del cliente, si se puede leer. */
  name: string;
  /** Fila en el DOM. Solo vale en el instante en que se leyo: los nodos se reciclan. */
  el?: HTMLElement;
  /** Posicion vertical en la lista, pista para volver a encontrarla al scrollear. */
  offset?: number;
  /** Ultimo mensaje que muestra la fila en la lista. */
  lastMessage?: string;
}

/** Acciones masivas disponibles. Cada una se mapea a un handler en el adapter. */
export type BulkActionId =
  | 'release' // Liberar chat asignado (menu)
  | 'postpone' // Posponer atencion (menu, submenu de duracion)
  | 'close' // Cerrar conversacion (boton + dialogo con tipo)
  | 'sendMessage'; // Enviar un mensaje puntual (composer)

/** Parametros opcionales de una accion. */
export interface BulkActionParams {
  text?: string;
  /** Ruta de submenus para Posponer, ej. ['Horas', 'Por 4 horas'] o ['Por siempre']. */
  postponePath?: string[];
  /** Tipo de conversacion al cerrar, ej. 'Consulta resuelta'. */
  closeType?: string;
  /** Solo actua si el ultimo mensaje del chat es del operador y empieza con este texto. */
  requireLastMessage?: string;
}

/** Resultado del procesamiento de un chat dentro de un lote. */
export interface BulkItemResult {
  chatId: string;
  chatName: string;
  ok: boolean;
  /** No se actuo porque el chat no cumplia la condicion; no es un error. */
  skipped?: boolean;
  error?: string;
}

/** Estado de avance de un lote (para la barra de progreso). */
export interface BulkProgress {
  actionId: BulkActionId;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  currentChatName?: string;
  finished: boolean;
  cancelled: boolean;
  results: BulkItemResult[];
}

/** Una regla del motor de automatizacion. */
export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Se evalua contra el ultimo mensaje del cliente. */
  match: RuleMatch;
  /** Accion a ejecutar cuando matchea. */
  action: RuleAction;
  /** Evita disparar dos veces sobre la misma conversacion. */
  oncePerChat: boolean;
}

export interface RuleMatch {
  /** 'contains' hace match por substring (case-insensitive, sin acentos). */
  type: 'contains' | 'regex';
  value: string;
}

export interface RuleAction {
  /** Por ahora: insertar y (opcionalmente) enviar un mensaje. Extensible. */
  type: 'sendMessage';
  text: string;
  /** Si false, deja el texto en el cuadro pero NO envia (lo revisa el operador). */
  autoSend: boolean;
}

/** Atajo de teclado para una accion sobre el chat abierto. */
export interface Shortcut {
  combo: string; // ej. 'ctrl+shift+l'
  actionId: BulkActionId;
  label: string;
  params?: BulkActionParams;
}
