// Tipos de dominio compartidos por todos los modulos.

/** Un chat tal como lo vemos en la lista de conversaciones de Botmaker. */
export interface ChatRef {
  /** Id estable si Botmaker lo expone; si no, un hash del texto de la fila. */
  id: string;
  /** Nombre del cliente, si se puede leer. */
  name: string;
  /** Referencia debil al elemento de la fila en el DOM (no serializable). */
  el?: HTMLElement;
}

/** Acciones masivas disponibles. Cada una se mapea a un handler en el adapter. */
export type BulkActionId =
  | 'release' // Liberar chat asignado (menu)
  | 'postpone' // Posponer atencion (menu, submenu de duracion)
  | 'close' // Cerrar conversacion (boton + dialogo con tipo)
  | 'sendMessage'; // Enviar un mensaje puntual (composer)

/** Parametros opcionales de una accion (etiqueta, texto de plantilla, etc.). */
export interface BulkActionParams {
  tag?: string;
  text?: string;
  templateId?: string;
  /** Ruta de submenus para Posponer, ej. ['Horas', 'Por 4 horas'] o ['Por siempre']. */
  postponePath?: string[];
  /** Tipo de conversacion al cerrar, ej. 'Consulta resuelta'. */
  closeType?: string;
}

/** Resultado del procesamiento de un chat dentro de un lote. */
export interface BulkItemResult {
  chatId: string;
  chatName: string;
  ok: boolean;
  error?: string;
}

/** Estado de avance de un lote (para la barra de progreso). */
export interface BulkProgress {
  actionId: BulkActionId;
  total: number;
  done: number;
  failed: number;
  currentChatName?: string;
  finished: boolean;
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

/** Entrada del historial local de acciones. */
export interface HistoryEntry {
  ts: number;
  text: string;
}

/** Atajo de teclado para una accion sobre el chat abierto. */
export interface Shortcut {
  combo: string; // ej. 'ctrl+shift+l'
  actionId: BulkActionId;
  label: string;
  params?: BulkActionParams;
}
