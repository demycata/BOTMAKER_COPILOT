// "Posponer todo" de punta a punta: content script contra la simulacion.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bm from '@/adapters/botmaker/actions';
import { BulkRunner, SkipChat } from '@/core/bulk-runner';
import { startsWithText } from '@/core/text';
import type { ContentToPanel, PanelToContent } from '@/messaging';
import type { BulkProgress } from '@/types';
import { mountFakeBotmaker, type FakeMessage } from './fake-botmaker';

const GREETING = 'Hola, soy Demian del Equipo de Dental, ¿En qué puedo ayudarte?';
const POSTPONE_PATH = ['Horas', 'Por 4 horas'];

type Listener = (envelope: unknown, sender: unknown, respond: () => void) => void;

let toPanel: ContentToPanel[] = [];
let listeners: Listener[] = [];
const runtime: { id: string | undefined } = { id: 'ext' };

const send = (payload: PanelToContent) =>
  listeners.forEach((fn) => fn({ to: 'content', payload }, {}, () => undefined));

async function startContent(): Promise<void> {
  vi.resetModules();
  await import('@/content/index');
  await new Promise((r) => setTimeout(r, 0));
}

const preview = () =>
  toPanel.find((m) => m.kind === 'postpone:preview') as
    | Extract<ContentToPanel, { kind: 'postpone:preview' }>
    | undefined;

async function scan(): Promise<void> {
  send({ kind: 'postpone:scan', greeting: GREETING });
  await vi.waitFor(() => expect(preview()).toBeDefined(), { timeout: 10000 });
}

async function finished(): Promise<BulkProgress> {
  let last: BulkProgress | undefined;
  await vi.waitFor(
    () => {
      const msg = toPanel.filter((m) => m.kind === 'bulk:progress').at(-1);
      last = msg?.kind === 'bulk:progress' ? msg.progress : undefined;
      expect(last?.finished).toBe(true);
    },
    { timeout: 20000 },
  );
  return last!;
}

beforeEach(() => {
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
      local: { get: async (key: string) => ({ [key]: undefined }) },
      onChanged: { addListener: () => undefined },
    },
  });
});

afterEach(async () => {
  runtime.id = undefined;
  document.body.append(document.createElement('i'));
  await new Promise((r) => setTimeout(r, 600));
  vi.unstubAllGlobals();
});

/** chat-1 y chat-4 terminan con el saludo; el resto no. chat-4 queda fuera de pantalla. */
function mountWithGreetings(overrides: Record<string, FakeMessage[]> = {}) {
  return mountFakeBotmaker({
    chats: 6,
    visible: 3,
    messages: (id) => {
      if (overrides[id]) return overrides[id];
      if (id === 'chat-1' || id === 'chat-4') {
        return [
          { from: 'client', text: 'hola' },
          { from: 'agent', text: GREETING },
        ];
      }
      return [{ from: 'client', text: `consulta ${id}` }];
    },
  });
}

describe('buscar', () => {
  it('encuentra los chats con el saludo, tambien fuera de pantalla, sin abrir ninguno', async () => {
    const fake = mountWithGreetings();
    await startContent();
    await scan();
    expect(preview()).toMatchObject({
      names: ['Cliente 1', 'Cliente 4'],
      total: 6,
      complete: true,
    });
    expect(fake.state.opened).toEqual([]);
  });

  it('no pospone nada hasta que se confirme', async () => {
    const fake = mountWithGreetings();
    await startContent();
    await scan();
    await new Promise((r) => setTimeout(r, 300));
    expect(fake.state.postponed).toEqual([]);
  });

  it('avisa si no encuentra ninguno', async () => {
    mountFakeBotmaker({ chats: 3, visible: 3 });
    await startContent();
    await scan();
    expect(preview()).toMatchObject({ names: [], total: 3 });
  });
});

describe('confirmar', () => {
  it('pospone solo los que cumplen, y solo abre esos', async () => {
    const fake = mountWithGreetings();
    await startContent();
    await scan();
    send({ kind: 'postpone:confirm', postponePath: POSTPONE_PATH });

    const result = await finished();

    expect(fake.state.postponed).toEqual(['chat-1', 'chat-4']);
    expect(fake.state.opened).toEqual(['chat-1', 'chat-4']);
    expect(result).toMatchObject({ total: 2, failed: 0, skipped: 0 });
  }, 30000);

  it('saltea un chat si el cliente respondio despues de la busqueda', async () => {
    const overrides: Record<string, FakeMessage[]> = {};
    const fake = mountWithGreetings(overrides);
    await startContent();
    await scan();
    overrides['chat-4'] = [
      { from: 'agent', text: GREETING },
      { from: 'client', text: 'necesito un turno' },
    ];
    send({ kind: 'postpone:confirm', postponePath: POSTPONE_PATH });

    const result = await finished();

    expect(fake.state.postponed).toEqual(['chat-1']);
    expect(result).toMatchObject({ failed: 0, skipped: 1 });
  }, 30000);

  it('saltea un chat si el saludo lo mando el bot', async () => {
    const fake = mountWithGreetings({ 'chat-1': [{ from: 'bot', text: GREETING }] });
    await startContent();
    await scan();
    send({ kind: 'postpone:confirm', postponePath: POSTPONE_PATH });
    await finished();
    expect(fake.state.postponed).toEqual(['chat-4']);
  }, 30000);

  it('al cancelar no toca nada', async () => {
    const fake = mountWithGreetings();
    await startContent();
    await scan();
    send({ kind: 'postpone:discard' });
    send({ kind: 'postpone:confirm', postponePath: POSTPONE_PATH });
    await vi.waitFor(() =>
      expect(toPanel).toContainEqual({ kind: 'bulk:rejected', reason: 'No hay chats para posponer.' }),
    );
    expect(fake.state.postponed).toEqual([]);
    expect(fake.state.opened).toEqual([]);
  });
});

describe('verificacion del mensaje', () => {
  const lastIs = (thread: FakeMessage[]) => {
    const fake = mountFakeBotmaker({ messages: () => thread });
    fake.openNow('chat-0');
    return bm.lastMessageIsOperatorText(GREETING);
  };

  it('acepta el saludo del operador aunque la burbuja lleve su nombre antes', () => {
    expect(lastIs([{ from: 'agent', text: GREETING }])).toBe(true);
  });

  it('acepta diferencias de mayusculas, acentos y espacios', () => {
    const variant = 'hola,  soy demian del equipo de dental, ¿en que puedo ayudarte? Hasta luego';
    expect(lastIs([{ from: 'agent', text: variant }])).toBe(true);
  });

  it('rechaza si lo ultimo es del cliente', () => {
    const thread: FakeMessage[] = [
      { from: 'agent', text: GREETING },
      { from: 'client', text: 'hola' },
    ];
    expect(lastIs(thread)).toBe(false);
  });

  it('rechaza si lo mando el bot', () => {
    expect(lastIs([{ from: 'bot', text: GREETING }])).toBe(false);
  });

  it('rechaza otro mensaje del operador', () => {
    expect(lastIs([{ from: 'agent', text: 'Te paso el presupuesto' }])).toBe(false);
  });

  it('rechaza un hilo vacio', () => {
    expect(lastIs([])).toBe(false);
  });
});

describe('piezas', () => {
  it('startsWithText no coincide con un prefijo vacio', () => {
    expect(startsWithText('hola', '   ')).toBe(false);
  });

  it('un chat salteado no cuenta como error', async () => {
    const runner = new BulkRunner({
      delayMs: 0,
      openChat: async () => undefined,
      runAction: async () => {
        throw new SkipChat('no cumple');
      },
    });
    const result = await runner.run([{ id: 'a', name: 'a' }], 'postpone', undefined, () => undefined);
    expect(result).toMatchObject({ failed: 0, skipped: 1, done: 1 });
  });
});
