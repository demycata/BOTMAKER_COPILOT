// Contrato tipado de mensajes panel <-> content.
//
// El panel le habla DIRECTO al content de la pestania activa (chrome.tabs), sin
// pasar por el background: menos piezas, menos puntos de falla. El content le
// responde al panel via runtime.sendMessage (llega a las vistas de extension).

import type {
  BulkActionId,
  BulkActionParams,
  BulkProgress,
  AutomationRule,
  Shortcut,
} from '@/types';

// --- Panel -> Content ---
export type PanelToContent =
  | { kind: 'ping' }
  | { kind: 'selection:enable'; on: boolean }
  | { kind: 'selection:all' }
  | { kind: 'selection:none' }
  | { kind: 'selection:invert' }
  | { kind: 'selection:query' }
  | { kind: 'bulk:run'; actionId: BulkActionId; params?: BulkActionParams }
  | { kind: 'bulk:cancel' }
  | { kind: 'rules:set'; rules: AutomationRule[] }
  | { kind: 'rules:enable'; on: boolean }
  | { kind: 'shortcuts:set'; shortcuts: Shortcut[] };

// --- Content -> Panel ---
export type ContentToPanel =
  | { kind: 'selection:changed'; count: number; total: number }
  | { kind: 'bulk:progress'; progress: BulkProgress }
  | { kind: 'rule:fired'; ruleName: string; chatName: string }
  | { kind: 'log'; text: string };

export interface Envelope<T = unknown> {
  to: 'content' | 'panel';
  payload: T;
}

/**
 * (Panel) Envia al content de la pestania activa. Devuelve false si no hay
 * content script escuchando (p.ej. la pestania no es Botmaker o no cargo).
 */
export async function sendToContent(payload: PanelToContent): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return false;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { to: 'content', payload } as Envelope);
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

/** (Content) Responde al panel. */
export function sendToPanel(payload: ContentToPanel): void {
  chrome.runtime.sendMessage({ to: 'panel', payload } as Envelope);
}
