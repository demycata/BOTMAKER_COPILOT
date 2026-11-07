// Content script: vive dentro de la pestania de Botmaker. Unico contexto con
// acceso al DOM, asi que orquesta todo lo que toca la pagina.
//
// Ojo con la virtualizacion: la lista solo tiene en el DOM las filas visibles y
// recicla nodos al scrollear. La seleccion se lleva por id de conversacion; los
// checkboxes se re-sincronizan en cada refresh para tolerar el reciclaje.

import type { AutomationRule, BulkActionId, BulkActionParams, Shortcut } from '@/types';
import type { Envelope, PanelToContent } from '@/messaging';
import { sendToPanel } from '@/messaging';
import { SelectionStore } from '@/core/selection-store';
import { BulkRunner } from '@/core/bulk-runner';
import { evaluate, RuleFireLog } from '@/core/rules-engine';
import * as bm from '@/adapters/botmaker/actions';
import { SELECTORS } from '@/adapters/botmaker/selectors';
import { queryFirst } from '@/adapters/botmaker/dom';

const CHECKBOX_CLASS = 'cbm-select-checkbox';

/** Inyecta (una vez) el estilo del checkbox para que combine con el panel. */
function ensureStyles(): void {
  if (document.getElementById('cbm-styles')) return;
  const style = document.createElement('style');
  style.id = 'cbm-styles';
  style.textContent = `
    .${CHECKBOX_CLASS} {
      appearance: none; -webkit-appearance: none;
      width: 18px; height: 18px; flex: none; align-self: center;
      margin: 0 8px 0 2px; cursor: pointer; position: relative;
      border: 1.5px solid #4c9aff; border-radius: 5px;
      background: rgba(76,154,255,0.10);
      transition: background .12s, border-color .12s;
    }
    .${CHECKBOX_CLASS}:hover { border-color: #7fb4ff; background: rgba(76,154,255,0.20); }
    .${CHECKBOX_CLASS}:checked { background: #4c9aff; border-color: #4c9aff; }
    .${CHECKBOX_CLASS}:checked::after {
      content: ''; position: absolute; left: 5px; top: 1px;
      width: 4px; height: 9px; border: solid #0b1524;
      border-width: 0 2px 2px 0; transform: rotate(45deg);
    }
  `;
  (document.head ?? document.documentElement).appendChild(style);
}

const selection = new SelectionStore();
const bulk = new BulkRunner({ openChat: bm.openChat, runAction: bm.runAction });
const fireLog = new RuleFireLog();

let selectionMode = false;
let rules: AutomationRule[] = [];
let rulesEnabled = false;
let shortcuts: Shortcut[] = [];
let lastFingerprint = ''; // id-conversacion + texto, para no re-disparar reglas

// Con all_frames:true el content corre en varios frames (el principal y el
// iframe "bmchildf" que tiene la app de chats). Solo el frame que realmente ve
// la app debe operar y responder; el resto queda pasivo para no competir.
let isAppFrame = false;

// --- Sincronizacion lista -> store + checkboxes ---

function refresh(): void {
  const chats = bm.listChats();
  if (chats.length || document.querySelector('#input-component')) isAppFrame = true;
  selection.setUniverse(chats);
  if (selectionMode && isAppFrame) syncCheckboxes();
}

/** Idempotente y tolerante al reciclaje de react-virtualized. */
function syncCheckboxes(): void {
  const chats = bm.listChats();
  for (const chat of chats) {
    const row = chat.el;
    if (!row) continue;
    const item = row.querySelector<HTMLElement>('.customer-item') ?? row;
    let cb = item.querySelector<HTMLInputElement>(`.${CHECKBOX_CLASS}`);
    if (!cb) {
      ensureStyles();
      cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = CHECKBOX_CLASS;
      cb.title = 'Seleccionar para accion masiva';
      cb.addEventListener('click', (e) => {
        e.stopPropagation(); // que no abra el chat
        const cid = cb!.dataset.chatId!;
        selection.set(cid, cb!.checked);
      });
      item.prepend(cb);
    }
    // Clave del reciclaje: re-vincular id y estado en cada pasada.
    cb.dataset.chatId = chat.id;
    cb.checked = selection.has(chat.id);
  }
}

function removeCheckboxes(): void {
  document.querySelectorAll(`.${CHECKBOX_CLASS}`).forEach((el) => el.remove());
}

selection.onChange((count, total) => {
  if (!isAppFrame) return;
  if (selectionMode) syncCheckboxes();
  sendToPanel({ kind: 'selection:changed', count, total });
});

// --- Acciones masivas ---

async function runBulk(actionId: BulkActionId, params?: BulkActionParams): Promise<void> {
  const chats = selection.getSelected();
  if (!chats.length) {
    sendToPanel({ kind: 'log', text: 'No hay chats seleccionados.' });
    return;
  }
  await bulk.run(chats, actionId, params, (p) => sendToPanel({ kind: 'bulk:progress', progress: p }));
}

// --- Motor de reglas (sobre la conversacion abierta) ---

function openChatId(): string {
  const selected = queryFirst<HTMLElement>(SELECTORS.chatSelected);
  const wrapper = selected?.closest('div[id]') as HTMLElement | null;
  return wrapper?.id ?? 'open';
}

function checkRules(): void {
  if (!isAppFrame || !rulesEnabled || !rules.length) return;
  const text = bm.lastIncomingMessage();
  if (!text) return;

  const chatId = openChatId();
  const fingerprint = `${chatId}::${text}`;
  if (fingerprint === lastFingerprint) return; // mismo mensaje, no repetir
  lastFingerprint = fingerprint;

  const hit = evaluate(text, rules);
  if (!hit || !fireLog.shouldFire(chatId, hit.rule)) return;

  const { text: reply, autoSend } = hit.rule.action;

  // Doble seguro: si esa respuesta ya figura en los mensajes salientes del chat,
  // no la repetimos (aunque se haya recargado la pagina y se pierda el registro).
  if (bm.wasAlreadySent(reply)) {
    fireLog.markFired(chatId, hit.rule.id);
    sendToPanel({ kind: 'log', text: `Regla "${hit.rule.name}": ya estaba respondida, se omite.` });
    return;
  }

  fireLog.markFired(chatId, hit.rule.id);
  bm.sendMessage(reply, autoSend)
    .then(() => sendToPanel({ kind: 'rule:fired', ruleName: hit.rule.name, chatName: chatId }))
    .catch((err) => sendToPanel({ kind: 'log', text: `Regla "${hit.rule.name}" fallo: ${err.message}` }));
}

// --- Atajos de teclado (sobre el chat abierto) ---

function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  if (e.metaKey) parts.push('meta');
  const key = e.key.toLowerCase();
  if (!['control', 'alt', 'shift', 'meta'].includes(key)) parts.push(key);
  return parts.join('+');
}

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

async function runShortcut(sc: Shortcut): Promise<void> {
  sendToPanel({ kind: 'log', text: `Atajo: ${sc.label}…` });
  try {
    await bm.runAction(sc.actionId, sc.params);
    sendToPanel({ kind: 'log', text: `Atajo: ${sc.label} OK` });
  } catch (err) {
    sendToPanel({ kind: 'log', text: `Atajo ${sc.label} fallo: ${(err as Error).message}` });
  }
}

window.addEventListener(
  'keydown',
  (e) => {
    if (!isAppFrame || !shortcuts.length) return;
    const combo = comboFromEvent(e);
    const sc = shortcuts.find((s) => s.combo === combo);
    if (!sc) return;
    const hasMod = e.ctrlKey || e.altKey || e.metaKey;
    if (isEditableTarget(e.target) && !hasMod) return; // no romper la escritura
    e.preventDefault();
    e.stopPropagation();
    void runShortcut(sc);
  },
  true,
);

// --- Observador de la SPA ---

const observer = new MutationObserver(() => {
  scheduleRefresh();
  checkRules();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

let refreshTimer: number | undefined;
function scheduleRefresh(): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refresh, 300);
}

// --- Canal de mensajes desde el panel ---

chrome.runtime.onMessage.addListener((envelope: Envelope, _sender, sendResponse) => {
  if (envelope?.to !== 'content') return;
  const msg = envelope.payload as PanelToContent;

  if (msg.kind === 'ping') {
    sendResponse({ pong: true }); // señal de vida (cualquier frame)
    return;
  }

  // rules puede setearse en cualquier frame; solo el frame de la app tiene
  // mensajes entrantes, asi que solo ahi disparara.
  if (msg.kind === 'rules:set') {
    rules = msg.rules;
    return;
  }
  if (msg.kind === 'rules:enable') {
    rulesEnabled = msg.on;
    return;
  }
  if (msg.kind === 'shortcuts:set') {
    shortcuts = msg.shortcuts;
    return;
  }

  // El resto solo lo maneja el frame que ve la app.
  if (!isAppFrame && msg.kind !== 'selection:enable') return;

  switch (msg.kind) {
    case 'selection:enable':
      selectionMode = msg.on;
      if (!isAppFrame) return; // el frame principal no pinta nada
      if (msg.on) {
        refresh();
        syncCheckboxes();
        const n = selection.total;
        sendToPanel({
          kind: 'log',
          text: n
            ? `Modo seleccion: ${n} conversaciones detectadas.`
            : 'Modo seleccion: no detecte la lista de chats (0). Revisar selectores.',
        });
      } else {
        removeCheckboxes();
      }
      break;
    case 'selection:all':
      selection.selectAll();
      break;
    case 'selection:none':
      selection.clear();
      break;
    case 'selection:invert':
      selection.invert();
      break;
    case 'selection:query':
      sendToPanel({ kind: 'selection:changed', count: selection.count, total: selection.total });
      break;
    case 'bulk:run':
      void runBulk(msg.actionId, msg.params);
      break;
    case 'bulk:cancel':
      bulk.cancel();
      break;
  }
});

refresh();
if (isAppFrame) {
  console.log(
    '%c[copilot] content activo en el frame de la app de Botmaker',
    'color:#4c9aff;font-weight:bold',
  );
}
