// Logica del side panel. Traduce clicks de la UI en mensajes al content script,
// y pinta lo que el content reporta (progreso, reglas disparadas, logs).

import type { AutomationRule, BulkActionId, BulkProgress, Shortcut } from '@/types';
import type { ContentToPanel, Envelope } from '@/messaging';
import { sendToContent, pingContent } from '@/messaging';
import { get, set } from '@/storage';
import { defaultAdvisorRule } from '@/core/rules-engine';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

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
const ruleMatch = $<HTMLInputElement>('rule-match');
const ruleReply = $<HTMLTextAreaElement>('rule-reply');
const ruleAutosend = $<HTMLInputElement>('rule-autosend');
const saveRuleBtn = $<HTMLButtonElement>('save-rule');
const logEl = $<HTMLUListElement>('log');

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

runBulkBtn.addEventListener('click', () => {
  const actionId = actionSelect.value as BulkActionId;
  let params: { text?: string; postponePath?: string[] } | undefined;
  if (actionId === 'sendMessage') params = { text: actionText.value };
  else if (actionId === 'postpone') params = { postponePath: POSTPONE_PATHS[postponeSelect.value] };
  runBulkBtn.disabled = true;
  cancelBulkBtn.disabled = false;
  progressBox.classList.remove('hidden');
  void sendToContent({ kind: 'bulk:run', actionId, params });
});

cancelBulkBtn.addEventListener('click', () => {
  void sendToContent({ kind: 'bulk:cancel' });
  addLog('Cancelando lote…');
});

// --- Atajos ---
const shortcutInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('.shortcut-input'));

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
        params: { postponePath: POSTPONE_PATHS[postponeSelect.value] },
      });
  }
  return list;
}

async function saveShortcuts(): Promise<void> {
  const list = buildShortcuts();
  await set('shortcuts', list);
  void sendToContent({ kind: 'shortcuts:set', shortcuts: list });
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

// Si cambia la duracion de posponer, actualizamos el atajo de posponer.
postponeSelect.addEventListener('change', () => void saveShortcuts());

// --- Reglas ---
rulesToggle.addEventListener('change', () => {
  void set('rulesEnabled', rulesToggle.checked);
  void sendToContent({ kind: 'rules:enable', on: rulesToggle.checked });
});

saveRuleBtn.addEventListener('click', async () => {
  const rule: AutomationRule = {
    ...defaultAdvisorRule(),
    match: { type: 'contains', value: ruleMatch.value.trim() },
    action: {
      type: 'sendMessage',
      text: ruleReply.value,
      autoSend: ruleAutosend.checked,
    },
  };
  await set('rules', [rule]);
  void sendToContent({ kind: 'rules:set', rules: [rule] });
  addLog('Regla guardada.', 'ok');
});

// --- Escucha de mensajes del content ---
chrome.runtime.onMessage.addListener((envelope: Envelope) => {
  if (envelope?.to !== 'panel') return;
  const msg = envelope.payload as ContentToPanel;
  switch (msg.kind) {
    case 'selection:changed':
      selCount.textContent = String(msg.count);
      selTotal.textContent = String(msg.total);
      break;
    case 'bulk:progress':
      paintProgress(msg.progress);
      break;
    case 'rule:fired':
      addLog(`Regla "${msg.ruleName}" -> ${msg.chatName}`, 'ok');
      break;
    case 'log':
      addLog(msg.text);
      break;
  }
});

function paintProgress(p: BulkProgress): void {
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  if (p.finished) {
    progressLabel.textContent = `Listo: ${p.done - p.failed} ok, ${p.failed} con error de ${p.total}.`;
    runBulkBtn.disabled = false;
    cancelBulkBtn.disabled = true;
    // Volcar errores al log.
    p.results.filter((r) => !r.ok).forEach((r) => addLog(`${r.chatName}: ${r.error}`, 'fail'));
  } else {
    progressLabel.textContent = `Procesando ${p.done}/${p.total}${p.currentChatName ? ` — ${p.currentChatName}` : ''}`;
  }
}

function addLog(text: string, cls: '' | 'ok' | 'fail' = ''): void {
  const li = document.createElement('li');
  const ts = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  li.innerHTML = `<span class="ts">${ts}</span><span class="${cls}">${escapeHtml(text)}</span>`;
  logEl.prepend(li);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// --- Init: chequeo de salud + cargar estado guardado ---
(async function init() {
  const alive = await pingContent();
  if (!alive) {
    addLog(
      'No detecto la extension en esta pestania. Abri go.botmaker.com, recarga la pagina (F5) y reabri el panel.',
      'fail',
    );
  } else {
    addLog('Conectado a la pestania de Botmaker.', 'ok');
  }

  const [rules, rulesEnabled, shortcuts] = await Promise.all([
    get('rules'),
    get('rulesEnabled'),
    get('shortcuts'),
  ]);
  rulesToggle.checked = rulesEnabled;
  if (rules[0]) {
    ruleMatch.value = rules[0].match.value;
    ruleReply.value = rules[0].action.text;
    ruleAutosend.checked = rules[0].action.autoSend;
  }
  // Poblar los inputs de atajos con lo guardado.
  for (const inp of shortcutInputs()) {
    const sc = shortcuts.find((s) => s.actionId === (inp.dataset.action as BulkActionId));
    if (sc) {
      inp.dataset.combo = sc.combo;
      inp.value = prettyCombo(sc.combo);
    }
  }
  void sendToContent({ kind: 'rules:set', rules });
  void sendToContent({ kind: 'rules:enable', on: rulesEnabled });
  void sendToContent({ kind: 'shortcuts:set', shortcuts });
  void sendToContent({ kind: 'selection:query' });
})();
