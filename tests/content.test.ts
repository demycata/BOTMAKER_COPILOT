// Prueba el content script completo contra la simulacion, con un `chrome` falso.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultAdvisorRule } from '@/core/rules-engine';
import type { ContentToPanel, PanelToContent } from '@/messaging';
import type { AutomationRule } from '@/types';
import { mountFakeBotmaker, type FakeOptions } from './fake-botmaker';

type Listener = (envelope: unknown, sender: unknown, respond: () => void) => void;

const advisorRule = (autoSend: boolean): AutomationRule => {
  const rule = defaultAdvisorRule();
  return { ...rule, action: { ...rule.action, text: 'Te derivo con un asesor', autoSend } };
};

const asksForAdvisor: FakeOptions['messages'] = () => [
  { from: 'client', text: 'quiero hablar con asesor' },
];

let toPanel: ContentToPanel[] = [];
let listeners: Listener[] = [];
const runtime: { id: string | undefined } = { id: 'ext' };

function installChrome(storage: Record<string, unknown> = {}): void {
  toPanel = [];
  listeners = [];
  runtime.id = 'ext';
  vi.stubGlobal('chrome', {
    runtime: {
      get id() {
        return runtime.id;
      },
      sendMessage: async (envelope: { payload: ContentToPanel }) => {
        toPanel.push(envelope.payload);
      },
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
    },
    storage: {
      local: { get: async (key: string) => ({ [key]: storage[key] }) },
      onChanged: { addListener: () => undefined },
    },
  });
}

async function startContent(): Promise<void> {
  vi.resetModules();
  await import('@/content/index');
  await new Promise((r) => setTimeout(r, 0)); // deja que cargue la configuracion
}

const send = (payload: PanelToContent) =>
  listeners.forEach((fn) => fn({ to: 'content', payload }, {}, () => undefined));

const lastCounter = () =>
  toPanel.filter((m) => m.kind === 'selection:changed').at(-1) as
    | Extract<ContentToPanel, { kind: 'selection:changed' }>
    | undefined;

const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => installChrome());

afterEach(async () => {
  // Apaga el content de este test para que no reaccione en el siguiente.
  runtime.id = undefined;
  document.body.append(document.createElement('i'));
  await settle(600);
  vi.unstubAllGlobals();
});

describe('reglas', () => {
  it('funcionan solo con lo guardado, aunque el panel nunca se abra', async () => {
    installChrome({ rules: [advisorRule(false)], rulesEnabled: true });
    const fake = mountFakeBotmaker({ messages: asksForAdvisor });
    fake.openNow('chat-1');
    await startContent();
    await vi.waitFor(() => expect(fake.composer.value).toBe('Te derivo con un asesor'), {
      timeout: 3000,
    });
    expect(fake.state.sent).toEqual([]);
    const fired = toPanel.find((m) => m.kind === 'rule:fired');
    expect(fired).toMatchObject({ chatName: 'Cliente 1' });
  });

  it('envia solo si lo ultimo del hilo es del cliente', async () => {
    installChrome({ rules: [advisorRule(true)], rulesEnabled: true });
    const fake = mountFakeBotmaker({ messages: asksForAdvisor });
    fake.openNow('chat-1');
    await startContent();
    await vi.waitFor(() => expect(fake.state.sent).toHaveLength(1), { timeout: 3000 });
    expect(fake.state.sent[0]).toEqual({ chatId: 'chat-1', text: 'Te derivo con un asesor' });
  });

  it('si ya hubo respuesta despues del cliente, lo deja escrito sin enviar', async () => {
    installChrome({ rules: [advisorRule(true)], rulesEnabled: true });
    const fake = mountFakeBotmaker({
      messages: () => [
        { from: 'client', text: 'quiero hablar con asesor' },
        { from: 'agent', text: 'ya te atiendo' },
      ],
    });
    fake.openNow('chat-1');
    await startContent();
    await vi.waitFor(() => expect(fake.composer.value).toBe('Te derivo con un asesor'), {
      timeout: 3000,
    });
    await settle();
    expect(fake.state.sent).toEqual([]);
  });

  it('no pisa lo que esta escribiendo el operador', async () => {
    installChrome({ rules: [advisorRule(false)], rulesEnabled: true });
    const fake = mountFakeBotmaker({ messages: asksForAdvisor });
    fake.openNow('chat-1');
    fake.composer.value = 'mi borrador';
    await startContent();
    await settle(1200);
    expect(fake.composer.value).toBe('mi borrador');
  });

  it('no se dispara si no sabe en que conversacion esta', async () => {
    installChrome({ rules: [advisorRule(true)], rulesEnabled: true });
    const fake = mountFakeBotmaker({ messages: asksForAdvisor });
    fake.openNow('chat-1');
    fake.scroller.scrollTop = 500; // la fila abierta sale de pantalla antes de arrancar
    await startContent();
    await settle(1200);
    expect(fake.state.sent).toEqual([]);
  });
});

describe('seleccion', () => {
  it('sobrevive al scroll y vuelve a marcarse al regresar', async () => {
    const fake = mountFakeBotmaker();
    await startContent();
    send({ kind: 'selection:enable', on: true });

    fake.checkboxFor('chat-0')!.click();
    expect(lastCounter()?.count).toBe(1);

    fake.scroller.scrollTop = 300;
    await settle(500);
    expect(fake.checkboxFor('chat-6')?.checked).toBe(false); // nodo reciclado, sin marcar

    fake.scroller.scrollTop = 0;
    await settle(500);
    expect(fake.checkboxFor('chat-0')?.checked).toBe(true);
    expect(lastCounter()?.count).toBe(1);
  });

  it('"Todo" incluye las conversaciones que no estan en pantalla', async () => {
    mountFakeBotmaker({ chats: 12, visible: 4 });
    await startContent();
    send({ kind: 'selection:enable', on: true });
    send({ kind: 'selection:all' });
    await vi.waitFor(() => expect(lastCounter()).toMatchObject({ count: 12, total: 12 }), {
      timeout: 8000,
    });
  });
});

describe('acciones masivas', () => {
  it('envia a cada conversacion correcta, tambien las fuera de pantalla', async () => {
    const fake = mountFakeBotmaker({ chats: 6, visible: 3 });
    await startContent();
    send({ kind: 'selection:enable', on: true });
    send({ kind: 'selection:all' });
    await vi.waitFor(() => expect(lastCounter()?.count).toBe(6), { timeout: 8000 });

    send({ kind: 'bulk:run', actionId: 'sendMessage', params: { text: 'aviso' } });
    await vi.waitFor(
      () => expect(toPanel.some((m) => m.kind === 'bulk:progress' && m.progress.finished)).toBe(true),
      { timeout: 25000 },
    );

    const ids = fake.state.sent.map((s) => s.chatId).sort();
    expect(ids).toEqual(['chat-0', 'chat-1', 'chat-2', 'chat-3', 'chat-4', 'chat-5']);
    expect(lastCounter()?.count).toBe(0); // los exitosos dejan de estar seleccionados
  }, 40000);

  it('las reglas no interfieren durante un lote', async () => {
    installChrome({ rules: [advisorRule(true)], rulesEnabled: true });
    const fake = mountFakeBotmaker({ chats: 3, visible: 3, messages: asksForAdvisor });
    await startContent();
    send({ kind: 'selection:enable', on: true });
    send({ kind: 'selection:all' });
    await vi.waitFor(() => expect(lastCounter()?.count).toBe(3), { timeout: 8000 });

    send({ kind: 'bulk:run', actionId: 'sendMessage', params: { text: 'aviso' } });
    await vi.waitFor(
      () => expect(toPanel.some((m) => m.kind === 'bulk:progress' && m.progress.finished)).toBe(true),
      { timeout: 15000 },
    );
    expect(fake.state.sent.map((s) => s.text)).toEqual(['aviso', 'aviso', 'aviso']);
  }, 30000);

  it('sin seleccion avisa al panel para que no quede trabado', async () => {
    mountFakeBotmaker();
    await startContent();
    send({ kind: 'bulk:run', actionId: 'release' });
    await vi.waitFor(() =>
      expect(toPanel).toContainEqual({ kind: 'bulk:rejected', reason: 'No hay chats seleccionados.' }),
    );
  });
});

describe('estado y diagnostico', () => {
  it('informa el estado para que el panel se sincronice al reabrir', async () => {
    mountFakeBotmaker({ visible: 4 });
    await startContent();
    send({ kind: 'selection:enable', on: true });
    send({ kind: 'state:query' });
    expect(toPanel.at(-1)).toMatchObject({ kind: 'state', selectionMode: true, bulkRunning: false });
  });

  it('apagar el modo seleccion quita los checkboxes y la seleccion', async () => {
    const fake = mountFakeBotmaker();
    await startContent();
    send({ kind: 'selection:enable', on: true });
    fake.checkboxFor('chat-0')!.click();
    send({ kind: 'selection:enable', on: false });
    expect(fake.checkboxFor('chat-0')).toBeNull();
    expect(lastCounter()?.count).toBe(0);
  });

  it('responde el diagnostico', async () => {
    mountFakeBotmaker();
    await startContent();
    send({ kind: 'diag:run' });
    expect(toPanel.at(-1)).toMatchObject({ kind: 'diag:result' });
  });
});
