// Contrato tipado de mensajes panel <-> content.
//
// El panel le habla DIRECTO al content de la pestania activa (chrome.tabs), sin
// pasar por el background: menos piezas, menos puntos de falla. El content le
// responde al panel via runtime.sendMessage (llega a las vistas de extension).
// Reglas y atajos no viajan por aca: el content los lee de chrome.storage, asi
// funcionan aunque el panel este cerrado.

import type { DiagnosticReport } from '@/adapters/botmaker/actions';
import type { BulkActionId, BulkActionParams, BulkProgress } from '@/types';

// --- Panel -> Content ---
export type PanelToContent =
  | { kind: 'ping' }
  | { kind: 'state:query' }
  | { kind: 'selection:enable'; on: boolean }
  | { kind: 'selection:all' }
  | { kind: 'selection:none' }
  | { kind: 'selection:invert' }
  | { kind: 'bulk:run'; actionId: BulkActionId; params?: BulkActionParams }
  | { kind: 'bulk:cancel' }
  | { kind: 'diag:run' };

// --- Content -> Panel ---
export type ContentToPanel =
  | { kind: 'state'; selectionMode: boolean; count: number; total: number; bulkRunning: boolean }
  | { kind: 'selection:changed'; count: number; total: number }
  | { kind: 'bulk:progress'; progress: BulkProgress }
  | { kind: 'bulk:rejected'; reason: string }
  | { kind: 'rule:fired'; ruleName: string; chatName: string }
  | { kind: 'diag:result'; report: DiagnosticReport }
  | { kind: 'log'; text: string };

export interface Envelope<T = unknown> {
  to: 'content' | 'panel';
  payload: T;
}

/**
 * (Panel) Envia al content de una pestania (por defecto la activa). Devuelve
 * false si no hay content script escuchando.
 */
export async function sendToContent(payload: PanelToContent, tabId?: number): Promise<boolean> {
  const target =
    tabId ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (!target) return false;
  try {
    const res = await chrome.tabs.sendMessage(target, { to: 'content', payload } as Envelope);
    // ping devuelve {pong:true}; el resto puede devolver undefined.
    return payload.kind === 'ping' ? !!(res && res.pong) : true;
  } catch {
    return false; // "Receiving end does not exist" => no hay content script
  }
}

/** (Panel) Chequeo de salud: hay content script vivo en la pestania activa? */
export function pingContent(): Promise<boolean> {
  return sendToContent({ kind: 'ping' });
}

/** (Content) Responde al panel. Si el panel esta cerrado no hay nadie escuchando. */
export function sendToPanel(payload: ContentToPanel): void {
  try {
    chrome.runtime.sendMessage({ to: 'panel', payload } as Envelope).catch(() => undefined);
  } catch {
    // La extension se recargo y este content quedo huerfano.
  }
}
