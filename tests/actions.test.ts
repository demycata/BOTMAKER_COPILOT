import { describe, expect, it } from 'vitest';
import * as bm from '@/adapters/botmaker/actions';
import { mountFakeBotmaker } from './fake-botmaker';

describe('openChat', () => {
  it('abre la conversacion pedida aunque el nodo guardado ahora muestre otra', async () => {
    const fake = mountFakeBotmaker();
    const stale = bm.listChats()[0];
    fake.scroller.scrollTop = 300; // el mismo nodo pasa a mostrar otro chat
    expect(stale.el?.isConnected).toBe(true);
    expect(stale.el?.id).not.toBe('chat-0');

    await bm.openChat(stale);

    expect(fake.state.openId).toBe('chat-0');
  });

  it('llega a una conversacion fuera de pantalla usando su posicion', async () => {
    const fake = mountFakeBotmaker();
    await bm.openChat({ id: 'chat-10', name: 'Cliente 10', offset: 500 });
    expect(fake.state.openId).toBe('chat-10');
  });

  it('llega a una conversacion fuera de pantalla sin pista de posicion', async () => {
    const fake = mountFakeBotmaker();
    await bm.openChat({ id: 'chat-11', name: 'Cliente 11' });
    expect(fake.state.openId).toBe('chat-11');
  });

  it('falla si la conversacion ya no esta en la lista', async () => {
    const fake = mountFakeBotmaker();
    await expect(bm.openChat({ id: 'chat-99', name: 'x' })).rejects.toThrow('No encontre');
    expect(fake.state.openId).toBeNull();
  });

  it('falla si no puede confirmar que se abrio', async () => {
    const fake = mountFakeBotmaker();
    fake.openNow('chat-1');
    fake.state.brokenOpen = true;
    await expect(bm.openChat({ id: 'chat-2', name: 'x' })).rejects.toThrow('se abra');
  });

  it('espera a que cargue el hilo nuevo y no se queda con el anterior', async () => {
    const fake = mountFakeBotmaker({ threadDelay: 600 });
    fake.openNow('chat-1');
    await bm.openChat({ id: 'chat-2', name: 'x' });
    expect(bm.lastIncomingMessage()).toBe('Hola desde chat-2');
  });

  it('no da por cargado un hilo que todavia esta vacio', async () => {
    const fake = mountFakeBotmaker({ threadDelay: 600, clearsThreadOnOpen: true });
    fake.openNow('chat-1');
    await bm.openChat({ id: 'chat-2', name: 'x' });
    expect(bm.lastIncomingMessage()).toBe('Hola desde chat-2');
  });

  it('reconoce el cambio entre dos chats con el mismo contenido', async () => {
    const fake = mountFakeBotmaker({ messages: () => [{ from: 'agent', text: 'igual' }] });
    fake.openNow('chat-1');
    await expect(bm.openChat({ id: 'chat-2', name: 'x' })).resolves.toBeUndefined();
    expect(fake.state.openId).toBe('chat-2');
  });

  it('confirma por la URL aunque la lista vuelva sola arriba al abrir', async () => {
    const fake = mountFakeBotmaker({ chats: 12, visible: 4, listJumpsOnOpen: true });
    await bm.openChat({ id: 'chat-10', name: 'x' });
    expect(fake.state.openId).toBe('chat-10');
    expect(document.getElementById('chat-10')).toBeNull(); // su fila ya no esta en pantalla
    expect(bm.openChatRef()?.id).toBe('chat-10');
  });

  it('sin datos en la URL usa la fila marcada', () => {
    const fake = mountFakeBotmaker();
    fake.openNow('chat-1');
    window.location.hash = '';
    expect(bm.openChatRef()?.id).toBe('chat-1');
  });

  it('vuelve a abrir un chat si la URL lo muestra pero su hilo esta vacio', async () => {
    const fake = mountFakeBotmaker();
    fake.openNow('chat-1');
    fake.thread.replaceChildren();
    await bm.openChat({ id: 'chat-1', name: 'x' });
    expect(fake.state.opened).toEqual(['chat-1']);
  });

  it('no reabre la conversacion que ya esta abierta', async () => {
    const fake = mountFakeBotmaker();
    fake.openNow('chat-1');
    fake.state.brokenOpen = true;
    await expect(bm.openChat({ id: 'chat-1', name: 'x' })).resolves.toBeUndefined();
  });
});

describe('collectAllChats', () => {
  it('junta toda la lista y deja el scroll donde estaba', async () => {
    const fake = mountFakeBotmaker({ chats: 12, visible: 4 });
    fake.scroller.scrollTop = 100;
    const { chats, complete } = await bm.collectAllChats();
    expect(chats).toHaveLength(12);
    expect(complete).toBe(true);
    expect(fake.scroller.scrollTop).toBe(100);
  });
});

describe('composer', () => {
  it('no pisa el borrador del operador', async () => {
    const fake = mountFakeBotmaker();
    fake.composer.value = 'estoy escribiendo';
    await expect(bm.sendMessage('respuesta', true)).rejects.toThrow('borrador');
    expect(fake.composer.value).toBe('estoy escribiendo');
    expect(fake.state.sent).toEqual([]);
  });

  it('confirma que el mensaje salio', async () => {
    const fake = mountFakeBotmaker();
    fake.openNow('chat-1');
    await bm.sendMessage('hola', true);
    expect(fake.state.sent).toEqual([{ chatId: 'chat-1', text: 'hola' }]);
  });

  it('informa el error si el mensaje no salio', async () => {
    const fake = mountFakeBotmaker();
    fake.state.brokenSend = true;
    await expect(bm.sendMessage('hola', true)).rejects.toThrow('se envie');
  });

  it('solo lo deja escrito si no hay auto-envio', async () => {
    const fake = mountFakeBotmaker();
    await bm.sendMessage('hola', false);
    expect(fake.composer.value).toBe('hola');
    expect(fake.state.sent).toEqual([]);
  });
});

describe('mensajes', () => {
  it('distingue si lo ultimo del hilo es del cliente', () => {
    let last: 'client' | 'agent' = 'client';
    const fake = mountFakeBotmaker({
      messages: () => [
        { from: 'client', text: 'hola' },
        { from: last, text: 'chau' },
      ],
    });
    fake.openNow('chat-0');
    expect(bm.lastBubbleIsIncoming()).toBe(true);
    last = 'agent';
    fake.openNow('chat-0');
    expect(bm.lastBubbleIsIncoming()).toBe(false);
  });
});

describe('liberar', () => {
  it('libera la conversacion abierta', async () => {
    const fake = mountFakeBotmaker();
    fake.openNow('chat-1');
    await bm.runAction('release');
    expect(fake.state.released).toEqual(['chat-1']);
  });

  it('no clickea el item si en realidad ofrece tomar el chat, y cierra el menu', async () => {
    const fake = mountFakeBotmaker();
    fake.openNow('chat-1');
    fake.state.assigned = false;
    await expect(bm.runAction('release')).rejects.toThrow('no ofrece');
    expect(document.querySelector('.MuiMenu-list')).toBeNull();
  });
});

describe('diagnose', () => {
  it('cuenta lo que encuentra sin devolver datos de clientes', () => {
    const fake = mountFakeBotmaker({ visible: 4 });
    fake.openNow('chat-0');
    const report = bm.diagnose();
    expect(report.counts.chatItem).toBe(4);
    expect(report.counts.composer).toBe(1);
    expect(report.counts.actionsMenu).toBe(0);
    expect(report.scroller).toEqual({ found: true, scrollable: true });
    expect(JSON.stringify(report)).not.toContain('Cliente');
  });
});
