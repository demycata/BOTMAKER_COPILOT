// "Cerrar todos" de punta a punta: content script contra la simulacion.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentToPanel, PanelToContent } from '@/messaging';
import type { BulkProgress } from '@/types';
import { mountFakeBotmaker } from './fake-botmaker';

const MESSAGE = 'Voy a cerrar el chat\n\n¡Saludos!';

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

const preview = () => toPanel.find((m) => m.kind === 'close:preview');

async function scan(): Promise<void> {
  send({ kind: 'close:scan' });
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
    { timeout: 25000 },
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

/** chat-1 y chat-4 estan pospuestos; chat-4 queda fuera de pantalla. */
const mountWithHolds = () =>
  mountFakeBotmaker({ chats: 6, visible: 3, postponed: ['chat-1', 'chat-4'] });

describe('antes de confirmar', () => {
  it('cuenta solo los pospuestos, sin abrir ni enviar nada', async () => {
    const fake = mountWithHolds();
    await startContent();
    await scan();
    expect(preview()).toMatchObject({ count: 2, total: 6, complete: true });
    expect(fake.state.opened).toEqual([]);
    expect(fake.state.sent).toEqual([]);
  });
});

describe('al confirmar', () => {
  it('envia el mensaje y libera solo los pospuestos', async () => {
    const fake = mountWithHolds();
    await startContent();
    await scan();
    send({ kind: 'close:confirm', text: MESSAGE });

    const result = await finished();

    expect(fake.state.sent).toEqual([
      { chatId: 'chat-1', text: MESSAGE },
      { chatId: 'chat-4', text: MESSAGE },
    ]);
    expect(fake.state.released).toEqual(['chat-1', 'chat-4']);
    expect(result).toMatchObject({ total: 2, failed: 0, skipped: 0 });
  }, 30000);

  it('no le escribe a un chat que dejo de estar pospuesto', async () => {
    const fake = mountWithHolds();
    await startContent();
    await scan();
    fake.clearHold('chat-4');
    send({ kind: 'close:confirm', text: MESSAGE });

    const result = await finished();

    expect(fake.state.sent.map((s) => s.chatId)).toEqual(['chat-1']);
    expect(result).toMatchObject({ failed: 0, skipped: 1 });
  }, 30000);

  it('si el mensaje no sale, no libera el chat', async () => {
    const fake = mountFakeBotmaker({ chats: 3, visible: 3, postponed: ['chat-1'] });
    await startContent();
    await scan();
    fake.state.brokenSend = true;
    send({ kind: 'close:confirm', text: MESSAGE });

    const result = await finished();

    expect(fake.state.released).toEqual([]);
    expect(result).toMatchObject({ failed: 1 });
    expect(result.results[0].error).toContain('se envie');
  }, 30000);

  it('no pisa un borrador: falla ese chat sin enviar ni liberar', async () => {
    const fake = mountFakeBotmaker({ chats: 3, visible: 3, postponed: ['chat-1'] });
    await startContent();
    await scan();
    fake.composer.value = 'borrador';
    send({ kind: 'close:confirm', text: MESSAGE });

    const result = await finished();

    expect(fake.state.sent).toEqual([]);
    expect(fake.state.released).toEqual([]);
    expect(result.results[0].error).toContain('borrador');
  }, 30000);

  it('avisa si envio pero Botmaker nunca ofrecio Liberar', async () => {
    const fake = mountFakeBotmaker({ chats: 3, visible: 3, postponed: ['chat-1'] });
    await startContent();
    await scan();
    fake.state.sendTakesChat = false;
    send({ kind: 'close:confirm', text: MESSAGE });

    const result = await finished();

    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.released).toEqual([]);
    expect(result.results[0].error).toContain('Mensaje enviado, pero no pude liberar');
    expect(document.querySelector('.MuiMenu-list')).toBeNull();
  }, 30000);

  it('al cancelar no toca nada', async () => {
    const fake = mountWithHolds();
    await startContent();
    await scan();
    send({ kind: 'close:discard' });
    send({ kind: 'close:confirm', text: MESSAGE });
    await vi.waitFor(() =>
      expect(toPanel).toContainEqual({ kind: 'bulk:rejected', reason: 'No hay chats para cerrar.' }),
    );
    expect(fake.state.sent).toEqual([]);
  });
});
