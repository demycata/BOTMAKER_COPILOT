// Prueba el panel real (su HTML y su logica) con un `chrome` falso.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentToPanel, PanelToContent } from '@/messaging';
import type { AutomationRule } from '@/types';
import html from '../src/sidepanel/index.html?raw';

type PanelListener = (envelope: unknown, sender: { tab?: { id: number } }) => void;

let storage: Record<string, unknown>;
let sent: { payload: PanelToContent; tabId: number }[];
let panelListener: PanelListener;
let connected: boolean;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const flush = () => new Promise((r) => setTimeout(r, 10));
const logText = () => $('log').textContent ?? '';
const receive = (payload: ContentToPanel, tabId = 7) =>
  panelListener({ to: 'panel', payload }, { tab: { id: tabId } });

async function startPanel(saved: Record<string, unknown> = {}): Promise<void> {
  storage = { ...saved };
  sent = [];
  connected = true;
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  vi.stubGlobal('chrome', {
    tabs: {
      query: async () => [{ id: 1 }],
      sendMessage: async (tabId: number, envelope: { payload: PanelToContent }) => {
        if (!connected) throw new Error('Receiving end does not exist');
        sent.push({ payload: envelope.payload, tabId });
        return envelope.payload.kind === 'ping' ? { pong: true } : undefined;
      },
      onActivated: { addListener: () => undefined },
    },
    runtime: { onMessage: { addListener: (fn: PanelListener) => (panelListener = fn) } },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storage, values),
      },
    },
  });
  vi.resetModules();
  await import('@/sidepanel/main');
  await flush();
}

const clickRun = async () => {
  $('run-bulk').click();
  await flush();
};

const toggleRules = async (on: boolean) => {
  const toggle = $<HTMLInputElement>('rules-toggle');
  toggle.checked = on;
  toggle.dispatchEvent(new Event('change'));
  await flush();
};

beforeEach(() => vi.unstubAllGlobals());

describe('accion masiva', () => {
  it('"Ejecutar" vuelve a funcionar si el content rechaza el lote', async () => {
    await startPanel();
    await clickRun();
    expect($<HTMLButtonElement>('run-bulk').disabled).toBe(true);

    receive({ kind: 'bulk:rejected', reason: 'No hay chats seleccionados.' });

    expect($<HTMLButtonElement>('run-bulk').disabled).toBe(false);
    expect($<HTMLButtonElement>('cancel-bulk').disabled).toBe(true);
    expect(logText()).toContain('No hay chats seleccionados.');
  });

  it('"Ejecutar" no queda trabado si la pestania no responde', async () => {
    await startPanel();
    connected = false;
    await clickRun();
    expect($<HTMLButtonElement>('run-bulk').disabled).toBe(false);
    expect(logText()).toContain('No detecto la extension');
  });

  it('no manda un mensaje masivo vacio', async () => {
    await startPanel();
    $<HTMLSelectElement>('action-select').value = 'sendMessage';
    $<HTMLTextAreaElement>('action-text').value = '   ';
    await clickRun();
    expect(sent.some((s) => s.payload.kind === 'bulk:run')).toBe(false);
    expect($<HTMLButtonElement>('run-bulk').disabled).toBe(false);
  });

  it('cancelar llega a la pestania del lote aunque cambie la activa', async () => {
    await startPanel();
    await clickRun();
    receive(
      {
        kind: 'bulk:progress',
        progress: {
          actionId: 'release',
          total: 2,
          done: 0,
          failed: 0,
          skipped: 0,
          finished: false,
          cancelled: false,
          results: [],
        },
      },
      42,
    );
    $('cancel-bulk').click();
    await flush();
    expect(sent.at(-1)).toEqual({ payload: { kind: 'bulk:cancel' }, tabId: 42 });
  });

  it('muestra que el lote fue cancelado', async () => {
    await startPanel();
    receive({
      kind: 'bulk:progress',
      progress: {
        actionId: 'release',
        total: 3,
        done: 1,
        failed: 0,
        skipped: 0,
        finished: true,
        cancelled: true,
        results: [],
      },
    });
    expect($('progress-label').textContent).toContain('Cancelado');
  });
});

describe('reglas', () => {
  it('activar guarda la regla que se ve en el formulario', async () => {
    await startPanel();
    await toggleRules(true);
    const [rule] = storage.rules as AutomationRule[];
    expect(rule.match.value).toBe('hablar con asesor');
    expect(rule.action.autoSend).toBe(false);
    expect(storage.rulesEnabled).toBe(true);
  });

  it('no deja activar una regla vacia', async () => {
    await startPanel();
    $<HTMLInputElement>('rule-match').value = '  ';
    await toggleRules(true);
    expect($<HTMLInputElement>('rules-toggle').checked).toBe(false);
    expect(storage.rules).toBeUndefined();
    expect(storage.rulesEnabled).toBeUndefined();
  });

  it('no deja guardar una regla vacia', async () => {
    await startPanel();
    $<HTMLTextAreaElement>('rule-reply').value = '';
    $('save-rule').click();
    await flush();
    expect(storage.rules).toBeUndefined();
    expect(logText()).toContain('La regla necesita');
  });
});

describe('estado', () => {
  it('se sincroniza con la pestania al abrir', async () => {
    await startPanel();
    expect(sent.some((s) => s.payload.kind === 'state:query')).toBe(true);
    receive({ kind: 'state', selectionMode: true, count: 2, total: 9, bulkRunning: true });
    expect($<HTMLInputElement>('selection-toggle').checked).toBe(true);
    expect($('sel-count').textContent).toBe('2');
    expect($('sel-total').textContent).toBe('9');
    expect($<HTMLButtonElement>('run-bulk').disabled).toBe(true);
  });

  it('recupera la duracion de posponer y no la pisa al guardar otro atajo', async () => {
    const shortcuts = [
      {
        combo: 'ctrl+p',
        actionId: 'postpone',
        label: 'Posponer',
        params: { postponePath: ['Horas', 'Por 8 horas'] },
      },
    ];
    await startPanel({ shortcuts });
    expect($<HTMLSelectElement>('postpone-select').value).toBe('8h');

    const release = document.querySelector<HTMLInputElement>('[data-action="release"]')!;
    release.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', ctrlKey: true }));
    await flush();

    const saved = storage.shortcuts as typeof shortcuts;
    expect(saved.find((s) => s.actionId === 'postpone')?.params?.postponePath).toEqual([
      'Horas',
      'Por 8 horas',
    ]);
  });
});

describe('posponer todo', () => {
  const previewFrom = (total = 7, complete = true, tabId = 7) =>
    receive({ kind: 'postpone:preview', total, complete }, tabId);
  const modalOpen = () => !$('postpone-modal').classList.contains('hidden');

  it('trae el saludo cargado y lo busca en la lista', async () => {
    await startPanel();
    $('postpone-all').click();
    await flush();
    expect(sent.at(-1)?.payload).toEqual({
      kind: 'postpone:scan',
      greeting: 'Hola, soy Demian del Equipo de Dental, ¿En qué puedo ayudarte?',
    });
    expect($<HTMLButtonElement>('postpone-all').disabled).toBe(true);
    expect($<HTMLButtonElement>('run-bulk').disabled).toBe(true);
  });

  it('recuerda un saludo editado', async () => {
    await startPanel({ postponeGreeting: 'Buen dia, soy Demian' });
    expect($<HTMLTextAreaElement>('postpone-greeting').value).toBe('Buen dia, soy Demian');
  });

  it('guarda el saludo al usarlo', async () => {
    await startPanel();
    $<HTMLTextAreaElement>('postpone-greeting').value = '  Otro saludo ';
    $('postpone-all').click();
    await flush();
    expect(storage.postponeGreeting).toBe('Otro saludo');
  });

  it('no busca sin saludo', async () => {
    await startPanel();
    $<HTMLTextAreaElement>('postpone-greeting').value = '  ';
    $('postpone-all').click();
    await flush();
    expect(sent.some((s) => s.payload.kind === 'postpone:scan')).toBe(false);
    expect(logText()).toContain('Escribi el saludo');
  });

  it('no queda trabado si la pestania no responde', async () => {
    await startPanel();
    connected = false;
    $('postpone-all').click();
    await flush();
    expect($<HTMLButtonElement>('postpone-all').disabled).toBe(false);
  });

  it('pide confirmacion antes de abrir los chats', async () => {
    await startPanel();
    $('postpone-all').click();
    await flush();
    previewFrom(7);

    expect(modalOpen()).toBe(true);
    expect($('postpone-title').textContent).toBe('Revisar 7 chats');
    expect($('postpone-note').textContent).toContain('4 horas');
    expect($<HTMLButtonElement>('postpone-all').disabled).toBe(false);
    expect(sent.some((s) => s.payload.kind === 'postpone:confirm')).toBe(false);
  });

  it('avisa si la lista era demasiado larga para recorrerla entera', async () => {
    await startPanel();
    previewFrom(300, false);
    expect($('postpone-note').textContent).toContain('puede haber mas');
  });

  it('confirmar pospone 4 horas en la pestania de la busqueda', async () => {
    await startPanel();
    previewFrom(7, true, 42);
    $('postpone-confirm').click();
    await flush();
    expect(modalOpen()).toBe(false);
    expect(sent.at(-1)).toEqual({
      payload: { kind: 'postpone:confirm', postponePath: ['Horas', 'Por 4 horas'] },
      tabId: 42,
    });
  });

  it('cancelar cierra sin posponer', async () => {
    await startPanel();
    previewFrom();
    $('postpone-cancel').click();
    await flush();
    expect(modalOpen()).toBe(false);
    expect(sent.at(-1)?.payload).toEqual({ kind: 'postpone:discard' });
    expect(logText()).toContain('no se toco ningun chat');
  });

  it('con la lista vacia no abre la ventana', async () => {
    await startPanel();
    $('postpone-all').click();
    await flush();
    previewFrom(0);
    expect(modalOpen()).toBe(false);
    expect(logText()).toContain('No hay chats en la lista.');
    expect($<HTMLButtonElement>('postpone-all').disabled).toBe(false);
  });

  it('muestra los salteados sin marcarlos como error', async () => {
    await startPanel();
    receive({
      kind: 'bulk:progress',
      progress: {
        actionId: 'postpone',
        total: 2,
        done: 2,
        failed: 0,
        skipped: 1,
        finished: true,
        cancelled: false,
        results: [
          { chatId: 'a', chatName: 'Ana', ok: true },
          { chatId: 'b', chatName: 'Luis', ok: false, skipped: true, error: 'No es tu saludo' },
        ],
      },
    });
    expect($('progress-label').textContent).toBe('Listo: 1 ok, 1 salteados, 0 con error de 2.');
    expect(logText()).not.toContain('Luis');
    expect($('log').querySelector('.fail')).toBeNull();
  });
});

describe('diagnostico', () => {
  it('muestra el resultado en la actividad', async () => {
    await startPanel();
    $('run-diag').click();
    await flush();
    receive({
      kind: 'diag:result',
      report: { counts: { chatItem: 4 }, scroller: { found: true, scrollable: true } },
    });
    expect(logText()).toContain('chatItem: 4');
    expect(logText()).toContain('lista scrolleable: si');
  });
});
