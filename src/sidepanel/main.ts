// Logica del side panel. Traduce clicks de la UI en mensajes al content script,
// y pinta lo que el content reporta (progreso, reglas disparadas, logs).

import type { DiagnosticReport } from '@/adapters/botmaker/actions';
import type { BulkActionId, BulkActionParams, BulkProgress, Shortcut } from '@/types';
import type { ContentToPanel, Envelope } from '@/messaging';
import { sendToContent, pingContent } from '@/messaging';
import { get, set } from '@/storage';
import { defaultAdvisorRule } from '@/core/rules-engine';
import { comboFromEvent } from '@/core/shortcuts';
import { RulesEditor } from './rules-editor';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const NOT_CONNECTED =
  'No detecto la extension en esta pestania. Abri go.botmaker.com, recarga la pagina (F5) y reabri el panel.';

// --- refs ---
const selectionToggle = $<HTMLInputElement>('selection-toggle');
const selCount = $('sel-count');
const selTotal = $('sel-total');
const actionSelect = $<HTMLSelectElement>('action-select');
const actionText = $<HTMLTextAreaElement>('action-text');
const postponeSelect = $<HTMLSelectElement>('postpone-select');
const runBulkBtn = $<HTMLButtonElement>('run-bulk');
const cancelBulkBtn = $<HTMLButtonElement>('cancel-bulk');
const progressBox = $('progress-box');
const progressFill = $('progress-fill');
const progressLabel = $('progress-label');
const rulesToggle = $<HTMLInputElement>('rules-toggle');
const rulesDirty = $('rules-dirty');
const shortcutDuration = $<HTMLSelectElement>('shortcut-duration');
const viewMain = $('view-main');
const viewSettings = $('view-settings');
const settingsBtn = $<HTMLButtonElement>('toggle-settings');
const statusEl = $('status');
const postponeGreeting = $<HTMLTextAreaElement>('postpone-greeting');
const postponeAllBtn = $<HTMLButtonElement>('postpone-all');
const postponeModal = $('postpone-modal');
const postponeTitle = $('postpone-title');
const postponeNote = $('postpone-note');
const postponeConfirmBtn = $<HTMLButtonElement>('postpone-confirm');
const postponeCancelBtn = $<HTMLButtonElement>('postpone-cancel');
const closeMessage = $<HTMLTextAreaElement>('close-message');
const closeAllBtn = $<HTMLButtonElement>('close-all');
const closeModal = $('close-modal');
const closeTitle = $('close-title');
const closeNote = $('close-note');
const closePreview = $('close-preview');
const closeConfirmBtn = $<HTMLButtonElement>('close-confirm');
const closeCancelBtn = $<HTMLButtonElement>('close-cancel');
const runDiagBtn = $<HTMLButtonElement>('run-diag');
const logEl = $<HTMLUListElement>('log');

/** Pestania donde corre el lote: cancelar debe llegar ahi aunque cambies de pestania. */
let bulkTabId: number | undefined;
/** Pestania que hizo la busqueda de "Posponer todo". */
let postponeTabId: number | undefined;
/** Pestania que hizo la busqueda de "Cerrar todos". */
let closeTabId: number | undefined;
let diagTimer: number | undefined;

// --- Vistas ---
function showSettings(open: boolean): void {
  viewMain.classList.toggle('hidden', open);
  viewSettings.classList.toggle('hidden', !open);
  $('settings-icon').classList.toggle('hidden', open);
  $('settings-back').classList.toggle('hidden', !open);
  settingsBtn.setAttribute('aria-label', open ? 'Volver' : 'Configuracion');
  settingsBtn.title = open ? 'Volver' : 'Configuracion';
  document.documentElement.scrollTop = 0;
  if (!open && !rulesDirty.classList.contains('hidden')) {
    addLog('Hay cambios en las reglas sin guardar.', 'fail');
  }
}

settingsBtn.addEventListener('click', () =>
  showSettings(viewSettings.classList.contains('hidden')),
);

// --- Seleccion ---
selectionToggle.addEventListener('change', () => {
  void sendToContent({ kind: 'selection:enable', on: selectionToggle.checked });
});
$('sel-all').addEventListener('click', () => void sendToContent({ kind: 'selection:all' }));
$('sel-none').addEventListener('click', () => void sendToContent({ kind: 'selection:none' }));
$('sel-invert').addEventListener('click', () => void sendToContent({ kind: 'selection:invert' }));

// --- Accion masiva ---
const POSTPONE_PATHS: Record<string, string[]> = {
  '4h': ['Horas', 'Por 4 horas'],
  '8h': ['Horas', 'Por 8 horas'],
  '12h': ['Horas', 'Por 12 horas'],
  forever: ['Por siempre'],
};

actionSelect.addEventListener('change', () => {
  actionText.classList.toggle('hidden', actionSelect.value !== 'sendMessage');
  postponeSelect.classList.toggle('hidden', actionSelect.value !== 'postpone');
});

function setBulkRunning(running: boolean, cancellable = running): void {
  runBulkBtn.disabled = running;
  postponeAllBtn.disabled = running;
  closeAllBtn.disabled = running;
  cancelBulkBtn.disabled = !cancellable;
}

runBulkBtn.addEventListener('click', async () => {
  const actionId = actionSelect.value as BulkActionId;
  let params: BulkActionParams | undefined;
  if (actionId === 'sendMessage') {
    const text = actionText.value.trim();
    if (!text) {
      addLog('Escribi el mensaje a enviar.', 'fail');
      return;
    }
    params = { text };
  } else if (actionId === 'postpone') {
    params = { postponePath: POSTPONE_PATHS[postponeSelect.value] };
  }
  setBulkRunning(true);
  progressBox.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = '';
  if (!(await sendToContent({ kind: 'bulk:run', actionId, params }))) {
    setBulkRunning(false);
    addLog(NOT_CONNECTED, 'fail');
  }
});

cancelBulkBtn.addEventListener('click', async () => {
  const sent = await sendToContent({ kind: 'bulk:cancel' }, bulkTabId);
  addLog(sent ? 'Cancelando lote…' : 'No pude cancelar: se perdio la pestania.', sent ? '' : 'fail');
});

// --- Posponer todo ---
const POSTPONE_ALL_DURATION = '4h';

postponeAllBtn.addEventListener('click', async () => {
  const greeting = postponeGreeting.value.trim();
  if (!greeting) {
    addLog('Escribi el saludo en Configuracion.', 'fail');
    return;
  }
  await set('postponeGreeting', greeting);
  setBulkRunning(true, false);
  addLog('Recorriendo la lista de chats…');
  if (!(await sendToContent({ kind: 'postpone:scan', greeting }))) {
    setBulkRunning(false);
    addLog(NOT_CONNECTED, 'fail');
  }
});

function showPostponePreview(total: number, complete: boolean): void {
  setBulkRunning(false);
  if (!total) {
    addLog('No hay chats en la lista.');
    return;
  }
  const note =
    'Se abre cada chat y se posponen 4 horas los que terminan con tu saludo. Los demas quedan igual.';
  postponeTitle.textContent = `Revisar ${total} chats`;
  postponeNote.textContent = complete ? note : `${note} La lista es muy larga: puede haber mas.`;
  postponeModal.classList.remove('hidden');
  postponeCancelBtn.focus();
}

function hidePostponeModal(): void {
  postponeModal.classList.add('hidden');
}

postponeConfirmBtn.addEventListener('click', async () => {
  hidePostponeModal();
  setBulkRunning(true);
  progressBox.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = '';
  const postponePath = POSTPONE_PATHS[POSTPONE_ALL_DURATION];
  if (!(await sendToContent({ kind: 'postpone:confirm', postponePath }, postponeTabId))) {
    setBulkRunning(false);
    addLog(NOT_CONNECTED, 'fail');
  }
});

postponeCancelBtn.addEventListener('click', () => {
  hidePostponeModal();
  void sendToContent({ kind: 'postpone:discard' }, postponeTabId);
  addLog('Posponer todo: cancelado, no se toco ningun chat.');
});

// Los mensajes se editan en Configuracion y se guardan al salir del campo.
postponeGreeting.addEventListener('change', () => {
  const text = postponeGreeting.value.trim();
  if (text) void set('postponeGreeting', text);
});
closeMessage.addEventListener('change', () => {
  const text = closeMessage.value.trim();
  if (text) void set('closeMessage', text);
});

// --- Cerrar todos ---
closeAllBtn.addEventListener('click', async () => {
  const text = closeMessage.value.trim();
  if (!text) {
    addLog('Escribi el mensaje de cierre en Configuracion.', 'fail');
    return;
  }
  await set('closeMessage', text);
  setBulkRunning(true, false);
  addLog('Buscando chats pospuestos…');
  if (!(await sendToContent({ kind: 'close:scan' }))) {
    setBulkRunning(false);
    addLog(NOT_CONNECTED, 'fail');
  }
});

function showClosePreview(count: number, total: number, complete: boolean): void {
  setBulkRunning(false);
  if (!count) {
    addLog(`No hay chats pospuestos entre los ${total} de la lista.`);
    return;
  }
  const note = 'Se envia este mensaje y se libera cada chat. No se puede deshacer.';
  closeTitle.textContent = `Cerrar ${count} de ${total} chats`;
  closeNote.textContent = complete ? note : `${note} La lista es muy larga: puede haber mas.`;
  closePreview.textContent = closeMessage.value.trim();
  closeModal.classList.remove('hidden');
  closeCancelBtn.focus();
}

closeConfirmBtn.addEventListener('click', async () => {
  closeModal.classList.add('hidden');
  setBulkRunning(true);
  progressBox.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = '';
  const text = closeMessage.value.trim();
  if (!(await sendToContent({ kind: 'close:confirm', text }, closeTabId))) {
    setBulkRunning(false);
    addLog(NOT_CONNECTED, 'fail');
  }
});

closeCancelBtn.addEventListener('click', () => {
  closeModal.classList.add('hidden');
  void sendToContent({ kind: 'close:discard' }, closeTabId);
  addLog('Cerrar todos: cancelado, no se toco ningun chat.');
});

// --- Atajos ---
const shortcutInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('.shortcut-input'));

const prettyCombo = (combo: string) =>
  combo
    .split('+')
    .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
    .join('+');

function buildShortcuts(): Shortcut[] {
  const list: Shortcut[] = [];
  for (const inp of shortcutInputs()) {
    const combo = inp.dataset.combo;
    if (!combo) continue;
    const action = inp.dataset.action as BulkActionId;
    if (action === 'release') list.push({ combo, actionId: action, label: 'Liberar' });
    else if (action === 'close')
      list.push({ combo, actionId: action, label: 'Cerrar (consulta resuelta)' });
    else if (action === 'postpone')
      list.push({
        combo,
        actionId: action,
        label: 'Posponer',
        params: { postponePath: POSTPONE_PATHS[shortcutDuration.value] },
      });
  }
  return list;
}

function saveShortcuts(): Promise<void> {
  return set('shortcuts', buildShortcuts());
}

for (const inp of shortcutInputs()) {
  inp.addEventListener('keydown', (e) => {
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') {
      delete inp.dataset.combo;
      inp.value = '';
      void saveShortcuts();
      return;
    }
    // ignorar si solo se apretaron modificadores
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    const combo = comboFromEvent(e);
    inp.dataset.combo = combo;
    inp.value = prettyCombo(combo);
    void saveShortcuts();
  });
}

shortcutDuration.addEventListener('change', () => void saveShortcuts());

// --- Reglas ---
const rulesEditor = new RulesEditor(
  $('rules-list'),
  $<HTMLTemplateElement>('rule-template'),
  () => rulesDirty.classList.remove('hidden'),
);

/** Guarda las reglas de la lista. Devuelve false si alguna esta incompleta. */
async function saveRules(): Promise<boolean> {
  const rules = rulesEditor.read();
  if (!rules) {
    addLog('Cada regla necesita el texto a detectar y la respuesta.', 'fail');
    return false;
  }
  await set('rules', rules);
  rulesDirty.classList.add('hidden');
  return true;
}

$('add-rule').addEventListener('click', () => rulesEditor.add());

rulesToggle.addEventListener('change', async () => {
  // Al activar se guarda lo que se ve en la lista: son las reglas que van a correr.
  if (rulesToggle.checked && !(await saveRules())) {
    rulesToggle.checked = false;
    return;
  }
  await set('rulesEnabled', rulesToggle.checked);
});

$('save-rules').addEventListener('click', async () => {
  if (await saveRules()) addLog('Reglas guardadas.', 'ok');
});

// --- Diagnostico ---
runDiagBtn.addEventListener('click', async () => {
  if (!(await sendToContent({ kind: 'diag:run' }))) {
    addLog(NOT_CONNECTED, 'fail');
    return;
  }
  diagTimer = window.setTimeout(
    () => addLog('Diagnostico: no detecte la app de chats en esta pestania.', 'fail'),
    1500,
  );
});

function paintDiagnostic(report: DiagnosticReport): void {
  window.clearTimeout(diagTimer);
  const counts = Object.entries(report.counts).map(([key, n]) => `${key}: ${n}`);
  const scroll = report.scroller.scrollable ? 'si' : report.scroller.found ? 'sin scroll' : 'no';
  addLog(`Diagnostico | ${counts.join(' | ')} | lista scrolleable: ${scroll}`);
}

// --- Escucha de mensajes del content ---
chrome.runtime.onMessage.addListener((envelope: Envelope, sender) => {
  if (envelope?.to !== 'panel') return;
  const msg = envelope.payload as ContentToPanel;
  switch (msg.kind) {
    case 'state':
      selectionToggle.checked = msg.selectionMode;
      paintCounter(msg.count, msg.total);
      setBulkRunning(msg.bulkRunning);
      if (msg.bulkRunning) bulkTabId = sender.tab?.id;
      break;
    case 'selection:changed':
      paintCounter(msg.count, msg.total);
      break;
    case 'bulk:progress':
      bulkTabId = msg.progress.finished ? undefined : sender.tab?.id;
      paintProgress(msg.progress);
      break;
    case 'postpone:preview':
      postponeTabId = sender.tab?.id;
      showPostponePreview(msg.total, msg.complete);
      break;
    case 'close:preview':
      closeTabId = sender.tab?.id;
      showClosePreview(msg.count, msg.total, msg.complete);
      break;
    case 'bulk:rejected':
      setBulkRunning(false);
      progressBox.classList.add('hidden');
      addLog(msg.reason, 'fail');
      break;
    case 'diag:result':
      paintDiagnostic(msg.report);
      break;
    case 'rule:fired':
      addLog(`Regla "${msg.ruleName}" -> ${msg.chatName}`, 'ok');
      break;
    case 'log':
      addLog(msg.text);
      break;
  }
});

function paintCounter(count: number, total: number): void {
  selCount.textContent = String(count);
  selTotal.textContent = String(total);
}

function paintProgress(p: BulkProgress): void {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  if (p.finished) {
    const title = p.cancelled ? 'Cancelado' : 'Listo';
    const skipped = p.skipped ? `, ${p.skipped} salteados` : '';
    const ok = p.done - p.failed - p.skipped;
    progressLabel.textContent = `${title}: ${ok} ok${skipped}, ${p.failed} con error de ${p.total}.`;
    setBulkRunning(false);
    // Volcar errores al log. Los salteados ya figuran en el resumen.
    p.results
      .filter((r) => !r.ok && !r.skipped)
      .forEach((r) => addLog(`${r.chatName}: ${r.error}`, 'fail'));
    if (p.failed) setStatus(`${p.failed} con error: detalle en Configuracion, Actividad.`, 'fail');
  } else {
    progressLabel.textContent = `Procesando ${p.done}/${p.total}${p.currentChatName ? ` — ${p.currentChatName}` : ''}`;
  }
}

/** Linea de estado del panel principal, donde no se ve la Actividad. */
function setStatus(text: string, cls: '' | 'ok' | 'fail'): void {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
}

function addLog(text: string, cls: '' | 'ok' | 'fail' = ''): void {
  setStatus(text, cls);
  const li = document.createElement('li');
  const ts = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  li.innerHTML = `<span class="ts">${ts}</span><span class="${cls}">${escapeHtml(text)}</span>`;
  logEl.prepend(li);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// --- Init: chequeo de salud + cargar estado guardado ---

/** Sincroniza el panel con la pestania activa. */
async function connectToTab(): Promise<void> {
  if (await pingContent()) {
    addLog('Conectado a la pestania de Botmaker.', 'ok');
    void sendToContent({ kind: 'state:query' });
  } else {
    addLog(NOT_CONNECTED, 'fail');
  }
}

chrome.tabs.onActivated.addListener(() => void connectToTab());

(async function init() {
  const [rules, rulesEnabled, shortcuts, greeting, savedCloseMessage] = await Promise.all([
    get('rules'),
    get('rulesEnabled'),
    get('shortcuts'),
    get('postponeGreeting'),
    get('closeMessage'),
  ]);
  if (greeting) postponeGreeting.value = greeting;
  if (savedCloseMessage) closeMessage.value = savedCloseMessage;
  rulesToggle.checked = rulesEnabled;
  rulesEditor.render(rules.length ? rules : [defaultAdvisorRule()]);
  // Poblar los inputs de atajos con lo guardado.
  for (const inp of shortcutInputs()) {
    const sc = shortcuts.find((s) => s.actionId === (inp.dataset.action as BulkActionId));
    if (sc) {
      inp.dataset.combo = sc.combo;
      inp.value = prettyCombo(sc.combo);
    }
  }
  // Recuperar la duracion del atajo de posponer, para no pisarla al guardar otro atajo.
  const savedPath = shortcuts.find((s) => s.actionId === 'postpone')?.params?.postponePath;
  const savedDuration = Object.keys(POSTPONE_PATHS).find(
    (key) => POSTPONE_PATHS[key].join() === savedPath?.join(),
  );
  if (savedDuration) shortcutDuration.value = savedDuration;

  await connectToTab();
})();
