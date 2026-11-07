// Simulacion minima de Botmaker para los tests: reproduce lo que hace dificil al
// DOM real, sobre todo la lista virtualizada que RECICLA los mismos nodos para
// mostrar conversaciones distintas al scrollear.

export interface FakeMessage {
  from: 'client' | 'agent' | 'bot';
  text: string;
}

export interface FakeOptions {
  chats?: number;
  visible?: number;
  /** Demora entre el click en una fila y que quede marcada como abierta. */
  openDelay?: number;
  /** Demora adicional hasta que aparece el hilo de la conversacion. */
  threadDelay?: number;
  /** Mensajes de cada chat; por defecto un saludo distinto por chat. */
  messages?: (id: string) => FakeMessage[];
  /** Chats pospuestos: muestran la etiqueta y no ofrecen "Liberar". */
  postponed?: string[];
  /** Al abrir, el hilo anterior desaparece antes de que llegue el nuevo. */
  clearsThreadOnOpen?: boolean;
  /** Como en Botmaker: al abrir un chat la lista puede volver sola arriba. */
  listJumpsOnOpen?: boolean;
}

const ROW_HEIGHT = 50;

export function mountFakeBotmaker(options: FakeOptions = {}) {
  const { chats = 12, visible = 4, openDelay = 10, threadDelay = 0 } = options;
  const messages =
    options.messages ?? ((id: string): FakeMessage[] => [{ from: 'client', text: `Hola desde ${id}` }]);

  Element.prototype.scrollIntoView = () => undefined;
  window.location.hash = '';
  document.body.innerHTML = `
    <div class="ReactVirtualized__Grid customers-list">
      <div class="ReactVirtualized__Grid__innerScrollContainer"></div>
    </div>
    <div class="thread"></div>
    <textarea id="input-component"></textarea>
    <button id="send-button-component"></button>
    <button aria-label="Acciones de Chat"></button>`;

  const scroller = document.querySelector<HTMLElement>('.customers-list')!;
  const inner = scroller.firstElementChild as HTMLElement;
  const thread = document.querySelector<HTMLElement>('.thread')!;
  const composer = document.querySelector<HTMLTextAreaElement>('#input-component')!;
  const sendBtn = document.querySelector<HTMLElement>('#send-button-component')!;
  const menuBtn = document.querySelector<HTMLElement>('[aria-label="Acciones de Chat"]')!;

  const ids = Array.from({ length: chats }, (_, i) => `chat-${i}`);
  const holds = new Set(options.postponed ?? []);
  const state = {
    openId: null as string | null,
    /** Veces que se abrio un chat con un click en su fila. */
    opened: [] as string[],
    sent: [] as { chatId: string | null; text: string }[],
    released: [] as (string | null)[],
    postponed: [] as (string | null)[],
    /** La pagina ignora los clicks en las filas. */
    brokenOpen: false,
    /** El boton de enviar no hace nada. */
    brokenSend: false,
    /** Chat sin asignar: el mismo item del menu ofrece tomarlo, no liberarlo. */
    assigned: true,
    /** Enviar un mensaje a un chat pospuesto lo vuelve a asignar. */
    sendTakesChat: true,
  };

  let top = 0;
  const height = () => ids.length * ROW_HEIGHT;
  const clientHeight = visible * ROW_HEIGHT;
  Object.defineProperty(scroller, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(scroller, 'scrollHeight', { get: height });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set(value: number) {
      top = Math.max(0, Math.min(value, height() - clientHeight));
      render();
    },
  });

  // Pool fijo de nodos, como react-virtualized.
  const pool = Array.from({ length: visible }, () => {
    const row = document.createElement('div');
    row.innerHTML = `
      <div class="customer-item">
        <div class="customer-main" role="button"><span class="customer-name"></span></div>
      </div>`;
    row.querySelector('.customer-main')!.addEventListener('click', () => {
      if (!state.brokenOpen) open(row.id);
    });
    inner.append(row);
    return row;
  });

  function render(): void {
    const first = Math.floor(top / ROW_HEIGHT);
    pool.forEach((row, i) => {
      const id = ids[first + i];
      if (!id) {
        row.removeAttribute('id');
        row.style.display = 'none';
        return;
      }
      row.style.display = '';
      row.id = id;
      row.style.top = `${(first + i) * ROW_HEIGHT}px`;
      row.querySelector('.customer-name')!.textContent = `Cliente ${id.slice(5)}`;
      row.querySelector('.customer-item')!.classList.toggle('selected', state.openId === id);
      row.querySelector('.customer-chip')?.remove();
      if (holds.has(id)) {
        const chip = document.createElement('div');
        chip.className = 'customer-chip hold';
        row.querySelector('.customer-item')!.append(chip);
      }
    });
  }

  function renderBubble(m: FakeMessage): HTMLElement {
    const bubble = document.createElement('div');
    bubble.className = m.from === 'client' ? 'text-entry-left' : 'text-entry-right';
    // Como en Botmaker: el nombre de quien envia va antes del texto.
    const sender =
      m.from === 'client'
        ? ''
        : `<div class="entries-li-sentby-container">
             <div class="entries-li-sentby from-${m.from === 'agent' ? 'human' : 'bot'}">
               <span>Remitente</span>
             </div>
           </div>`;
    bubble.innerHTML = `
      <div class="render-text-message-body">
        ${sender}
        <div class="inline-text">
          <div class="rule-message-all-container"><div class="rule-message-line"></div></div>
          <div class="sent-tildes-container"><span class="sent-tilde-time">10:00</span></div>
        </div>
      </div>`;
    bubble.querySelector('.rule-message-line')!.textContent = m.text;
    return bubble;
  }

  function renderThread(id: string): void {
    thread.replaceChildren(...messages(id).map(renderBubble));
  }

  function open(id: string): void {
    state.opened.push(id);
    setTimeout(() => {
      state.openId = id;
      window.location.hash = `#/chats/${id}`;
      if (options.listJumpsOnOpen) top = 0;
      if (options.clearsThreadOnOpen) thread.replaceChildren();
      render();
      setTimeout(() => renderThread(id), threadDelay);
    }, openDelay);
  }

  sendBtn.addEventListener('click', () => {
    if (state.brokenSend) return;
    state.sent.push({ chatId: state.openId, text: composer.value });
    if (state.sendTakesChat && state.openId) holds.delete(state.openId);
    const bubble = document.createElement('div');
    bubble.className = 'text-entry-right';
    bubble.textContent = composer.value;
    thread.append(bubble);
    composer.value = '';
  });

  const closeMenus = () => document.querySelectorAll('.MuiMenu-list').forEach((m) => m.remove());

  function addMenu(items: { html: string; onClick: () => void }[]): void {
    const menu = document.createElement('ul');
    menu.className = 'MuiMenu-list';
    menu.setAttribute('role', 'menu');
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'MuiMenuItem-root';
      li.setAttribute('role', 'menuitem');
      li.innerHTML = item.html;
      li.addEventListener('click', item.onClick);
      menu.append(li);
    }
    document.body.append(menu);
  }

  function postponeOpenChat(): void {
    state.postponed.push(state.openId);
    ids.splice(ids.indexOf(state.openId!), 1); // sale de la lista; la URL no cambia
    state.openId = null;
    thread.replaceChildren();
    closeMenus();
    scroller.scrollTop = top;
  }

  const canRelease = () => state.assigned && !(state.openId && holds.has(state.openId));

  menuBtn.addEventListener('click', () => {
    const label = canRelease() ? 'Liberar chat asignado a Operador' : 'Tomar chat';
    addMenu([
      {
        html: `<span id="ChatsToolbar.lockChat">${label}</span>`,
        onClick: () => {
          if (canRelease()) state.released.push(state.openId);
          closeMenus();
        },
      },
      {
        html: 'Posponer atención',
        onClick: () =>
          addMenu([
            {
              html: 'Horas',
              onClick: () => addMenu([{ html: 'Por 4 horas', onClick: postponeOpenChat }]),
            },
          ]),
      },
    ]);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
  });

  render();

  return {
    state,
    scroller,
    composer,
    thread,
    /** Abre un chat como lo haria el operador. */
    openNow(id: string) {
      state.openId = id;
      window.location.hash = `#/chats/${id}`;
      render();
      renderThread(id);
    },
    /** Saca la marca de pospuesto, ej. porque el cliente respondio. */
    clearHold(id: string) {
      holds.delete(id);
      render();
    },
    checkboxFor: (id: string) =>
      document.getElementById(id)?.querySelector<HTMLInputElement>('.cbm-select-checkbox') ?? null,
  };
}
