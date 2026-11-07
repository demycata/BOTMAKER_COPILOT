// Content script: vive dentro de la pestania de Botmaker. Unico contexto con
// acceso al DOM, asi que orquesta todo lo que toca la pagina.
//
// Ojo con la virtualizacion: la lista solo tiene en el DOM las filas visibles y
// recicla nodos al scrollear. La seleccion se lleva por id de conversacion; los
// checkboxes se re-sincronizan en cada refresh para tolerar el reciclaje.

import type { AutomationRule, BulkActionId, BulkActionParams, ChatRef, Shortcut } from '@/types';
import type { Envelope, PanelToContent } from '@/messaging';
import { sendToPanel } from '@/messaging';
import { get } from '@/storage';
import { SelectionStore } from '@/core/selection-store';
import { BulkRunner, SkipChat } from '@/core/bulk-runner';
import { evaluate, RuleFireLog } from '@/core/rules-engine';
import { comboFromEvent } from '@/core/shortcuts';
import { startsWithText } from '@/core/text';
import { debounceMax } from '@/core/timing';
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

/** Ejecuta la accion solo si el chat, ya abierto, sigue cumpliendo la condicion. */
async function runGuardedAction(actionId: BulkActionId, params?: BulkActionParams): Promise<void> {
  const required = params?.requireLastMessage;
  if (required && !bm.lastMessageIsOperatorText(required)) {
    throw new SkipChat('Ya no cumple: el ultimo mensaje no es tu saludo');
  }
  await bm.runAction(actionId, params);
}

const bulk = new BulkRunner({ openChat: bm.openChat, runAction: runGuardedAction });
const fireLog = new RuleFireLog();

let selectionMode = false;
let rules: AutomationRule[] = [];
let rulesEnabled = false;
let shortcuts: Shortcut[] = [];
let lastFingerprint = ''; // id-conversacion + texto, para no re-disparar reglas
let lastOpenChat: ChatRef | null = null;
let scanning = false; // recorriendo la lista para "Todo"
let ruleInFlight = false;
let postponeCandidates: ChatRef[] = [];
let postponeGreeting = '';

// Con all_frames:true el content corre en varios frames (el principal y el
// iframe "bmchildf" que tiene la app de chats). Solo el frame que realmente ve
// la app debe operar y responder; el resto queda pasivo para no competir.
let isAppFrame = false;

/** Mientras corre un lote o un recorrido, nada mas debe tocar la pagina. */
function isBusy(): boolean {
  return bulk.running || scanning;
}

// --- Sincronizacion lista -> store + checkboxes ---

function refresh(): void {
  const chats = bm.listChats();
  if (!isAppFrame && (chats.length || queryFirst(SELECTORS.composer))) {
    isAppFrame = true;
    console.log(
      '%c[copilot] content activo en el frame de la app de Botmaker',
      'color:#4c9aff;font-weight:bold',
    );
    sendState();
  }
  if (!isAppFrame) return;
  selection.merge(chats);
  if (selectionMode) syncCheckboxes(chats);
}

/** Idempotente y tolerante al reciclaje de react-virtualized. */
function syncCheckboxes(chats: ChatRef[]): void {
  for (const chat of chats) {
    const row = chat.el;
    if (!row) continue;
    const item = queryFirst<HTMLElement>(SELECTORS.chatRow, row) ?? row;
    let cb = item.querySelector<HTMLInputElement>(`.${CHECKBOX_CLASS}`);
    if (!cb) {
      ensureStyles();
      cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = CHECKBOX_CLASS;
      cb.title = 'Seleccionar para accion masiva';
      cb.addEventListener('click', (e) => {
        e.stopPropagation(); // que no abra el chat
        const box = e.currentTarget as HTMLInputElement;
        selection.set(box.dataset.chatId!, box.checked);
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

function sendState(): void {
  sendToPanel({
    kind: 'state',
    selectionMode,
    count: selection.count,
    total: selection.total,
    bulkRunning: bulk.running,
  });
}

selection.onChange((count, total) => {
  if (!isAppFrame) return;
  if (selectionMode) syncCheckboxes(bm.listChats());
  sendToPanel({ kind: 'selection:changed', count, total });
});

/** "Todo": recorre la lista entera para incluir lo que no esta en pantalla. */
async function selectEverything(): Promise<void> {
  if (isBusy()) {
    sendToPanel({ kind: 'log', text: 'Espera a que termine el proceso en curso.' });
    return;
  }
  scanning = true;
  sendToPanel({ kind: 'log', text: 'Recorriendo la lista de conversaciones…' });
  try {
    const { chats, complete } = await bm.collectAllChats();
    selection.merge(chats);
    if (complete) selection.retainOnly(new Set(chats.map((c) => c.id)));
    selection.selectAll();
    sendToPanel({
      kind: 'log',
      text: complete
        ? `Seleccionadas las ${selection.count} conversaciones de la lista.`
        : `La lista es muy larga: seleccionadas ${selection.count}, puede haber mas.`,
    });
  } finally {
    scanning = false;
  }
}

// --- Acciones masivas ---

async function runBulk(actionId: BulkActionId, params?: BulkActionParams): Promise<void> {
  if (isBusy()) {
    sendToPanel({ kind: 'bulk:rejected', reason: 'Ya hay un proceso en curso.' });
    return;
  }
  const chats = selection.getSelected();
  if (!chats.length) {
    sendToPanel({ kind: 'bulk:rejected', reason: 'No hay chats seleccionados.' });
    return;
  }
  const result = await bulk.run(chats, actionId, params, (p) =>
    sendToPanel({ kind: 'bulk:progress', progress: p }),
  );
  // Quedan seleccionados solo los que fallaron, listos para reintentar.
  selection.unselect(result.results.filter((r) => r.ok).map((r) => r.chatId));
}

// --- Posponer todo ---

/**
 * Busca los chats cuyo ultimo mensaje es el saludo. Usa lo que muestra la lista,
 * asi no abre ningun chat ni los marca como leidos.
 */
async function scanForPostpone(greeting: string): Promise<void> {
  if (isBusy()) {
    sendToPanel({ kind: 'bulk:rejected', reason: 'Ya hay un proceso en curso.' });
    return;
  }
  scanning = true;
  try {
    const { chats, complete } = await bm.collectAllChats();
    postponeCandidates = chats
      .filter((c) => startsWithText(c.lastMessage ?? '', greeting))
      .map(({ id, name, offset }) => ({ id, name, offset }));
    postponeGreeting = greeting;
    sendToPanel({
      kind: 'postpone:preview',
      names: postponeCandidates.map((c) => c.name),
      total: chats.length,
      complete,
    });
  } catch (err) {
    sendToPanel({ kind: 'bulk:rejected', reason: (err as Error).message });
  } finally {
    scanning = false;
  }
}

async function confirmPostpone(postponePath: string[]): Promise<void> {
  const chats = postponeCandidates;
  postponeCandidates = [];
  if (isBusy() || !chats.length) {
    sendToPanel({ kind: 'bulk:rejected', reason: 'No hay chats para posponer.' });
    return;
  }
  await bulk.run(chats, 'postpone', { postponePath, requireLastMessage: postponeGreeting }, (p) =>
    sendToPanel({ kind: 'bulk:progress', progress: p }),
  );
}

// --- Motor de reglas (sobre la conversacion abierta) ---

/**
 * Conversacion abierta. Si su fila salio de pantalla se usa la ultima conocida:
 * para cambiar de chat hay que clickear una fila, que entonces esta renderizada.
 */
function currentChat(): ChatRef | null {
  lastOpenChat = bm.openChatRef() ?? lastOpenChat;
  return lastOpenChat;
}

async function checkRules(): Promise<void> {
  if (!isAppFrame || !rulesEnabled || !rules.length || isBusy() || ruleInFlight) return;
  const text = bm.lastIncomingMessage();
  const chat = currentChat();
  if (!text || !chat) return;

  const fingerprint = `${chat.id}::${text}`;
  if (fingerprint === lastFingerprint) return; // mismo mensaje, no repetir
  lastFingerprint = fingerprint;

  const hit = evaluate(text, rules);
  if (!hit || !fireLog.shouldFire(chat.id, hit.rule)) return;
  const { rule } = hit;

  // Doble seguro: si esa respuesta ya figura en los mensajes salientes del chat,
  // no la repetimos (aunque se haya recargado la pagina y se pierda el registro).
  if (bm.wasAlreadySent(rule.action.text)) {
    fireLog.markFired(chat.id, rule.id);
    sendToPanel({ kind: 'log', text: `Regla "${rule.name}": ya estaba respondida, se omite.` });
    return;
  }

  // Si alguien escribio despues del cliente, el mensaje puede estar ya atendido:
  // se deja escrito para que decida el operador, nunca se envia solo.
  const autoSend = rule.action.autoSend && bm.lastBubbleIsIncoming();

  ruleInFlight = true;
  try {
    await bm.sendMessage(rule.action.text, autoSend);
    fireLog.markFired(chat.id, rule.id);
    sendToPanel({ kind: 'rule:fired', ruleName: rule.name, chatName: chat.name });
    if (rule.action.autoSend && !autoSend) {
      sendToPanel({
        kind: 'log',
        text: `Regla "${rule.name}": ya hay mensajes despues del cliente, lo deje escrito sin enviar.`,
      });
    }
  } catch (err) {
    sendToPanel({ kind: 'log', text: `Regla "${rule.name}" fallo: ${(err as Error).message}` });
  } finally {
    ruleInFlight = false;
  }
}

// --- Atajos de teclado (sobre el chat abierto) ---

function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

async function runShortcut(sc: Shortcut): Promise<void> {
  if (isBusy()) {
    sendToPanel({ kind: 'log', text: `Atajo ${sc.label}: hay un proceso en curso.` });
    return;
  }
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

const scheduleRefresh = debounceMax(refresh, 300, 1500);
// La espera deja que termine de cargar el hilo: asi no se cruza el mensaje de un
// chat con el id de otro al cambiar de conversacion.
const scheduleRules = debounceMax(() => void checkRules(), 500, 2000);

const observer = new MutationObserver(() => {
  if (!chrome.runtime?.id) {
    observer.disconnect(); // la extension se recargo: este content quedo huerfano
    return;
  }
  scheduleRefresh();
  scheduleRules();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// --- Configuracion: se lee del storage, no depende de que el panel este abierto ---

async function loadConfig(): Promise<void> {
  [rules, rulesEnabled, shortcuts] = await Promise.all([
    get('rules'),
    get('rulesEnabled'),
    get('shortcuts'),
  ]);
  scheduleRules();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.rules) rules = (changes.rules.newValue as AutomationRule[] | undefined) ?? [];
  if (changes.rulesEnabled) rulesEnabled = !!changes.rulesEnabled.newValue;
  if (changes.shortcuts) shortcuts = (changes.shortcuts.newValue as Shortcut[] | undefined) ?? [];
  // Una regla recien activada o editada se evalua de nuevo sobre el chat abierto.
  lastFingerprint = '';
  scheduleRules();
});

// --- Canal de mensajes desde el panel ---

chrome.runtime.onMessage.addListener((envelope: Envelope, _sender, sendResponse) => {
  if (envelope?.to !== 'content') return;
  const msg = envelope.payload as PanelToContent;

  if (msg.kind === 'ping') {
    sendResponse({ pong: true }); // señal de vida (cualquier frame)
    return;
  }

  // El resto solo lo maneja el frame que ve la app.
  if (!isAppFrame && msg.kind !== 'selection:enable') return;

  switch (msg.kind) {
    case 'state:query':
      sendState();
      break;
    case 'selection:enable':
      selectionMode = msg.on;
      if (!isAppFrame) return; // el frame principal no pinta nada
      if (msg.on) {
        refresh();
        const n = selection.total;
        sendToPanel({
          kind: 'log',
          text: n
            ? `Modo seleccion: ${n} conversaciones detectadas.`
            : 'Modo seleccion: no detecte la lista de chats (0). Revisar selectores.',
        });
      } else {
        removeCheckboxes();
        selection.reset();
      }
      break;
    case 'selection:all':
      void selectEverything();
      break;
    case 'selection:none':
      selection.clear();
      break;
    case 'selection:invert':
      selection.invert();
      break;
    case 'bulk:run':
      void runBulk(msg.actionId, msg.params);
      break;
    case 'bulk:cancel':
      bulk.cancel();
      break;
    case 'postpone:scan':
      void scanForPostpone(msg.greeting);
      break;
    case 'postpone:confirm':
      void confirmPostpone(msg.postponePath);
      break;
    case 'postpone:discard':
      postponeCandidates = [];
      break;
    case 'diag:run':
      sendToPanel({ kind: 'diag:result', report: bm.diagnose() });
      break;
  }
});

refresh();
void loadConfig();
