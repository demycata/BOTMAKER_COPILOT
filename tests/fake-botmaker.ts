// Simulacion minima de Botmaker para los tests: reproduce lo que hace dificil al
// DOM real, sobre todo la lista virtualizada que RECICLA los mismos nodos para
// mostrar conversaciones distintas al scrollear.

export interface FakeOptions {
  chats?: number;
  visible?: number;
  /** Demora entre el click en una fila y que quede marcada como abierta. */
  openDelay?: number;
  /** Demora adicional hasta que aparece el hilo de la conversacion. */
  threadDelay?: number;
  /** Mensajes de cada chat; por defecto un saludo distinto por chat. */
  messages?: (id: string) => { from: 'client' | 'agent'; text: string }[];
}

const ROW_HEIGHT = 50;

export function mountFakeBotmaker(options: FakeOptions = {}) {
  const { chats = 12, visible = 4, openDelay = 10, threadDelay = 0 } = options;
  const messages =
    options.messages ?? ((id: string) => [{ from: 'client' as const, text: `Hola desde ${id}` }]);

  Element.prototype.scrollIntoView = () => undefined;
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

  const state = {
    openId: null as string | null,
    sent: [] as { chatId: string | null; text: string }[],
    released: [] as (string | null)[],
    /** La pagina ignora los clicks en las filas. */
    brokenOpen: false,
    /** El boton de enviar no hace nada. */
    brokenSend: false,
    /** Chat sin asignar: el mismo item del menu ofrece tomarlo, no liberarlo. */
    assigned: true,
  };

  let top = 0;
  const height = chats * ROW_HEIGHT;
  const clientHeight = visible * ROW_HEIGHT;
  Object.defineProperty(scroller, 'clientHeight', { get: () => clientHeight });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => height });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => top,
    set(value: number) {
      top = Math.max(0, Math.min(value, height - clientHeight));
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
      const index = first + i;
      const id = `chat-${index}`;
      row.id = id;
      row.style.top = `${index * ROW_HEIGHT}px`;
      row.querySelector('.customer-name')!.textContent = `Cliente ${index}`;
      row.querySelector('.customer-item')!.classList.toggle('selected', state.openId === id);
    });
  }

  function renderThread(id: string): void {
    thread.innerHTML = '';
    for (const m of messages(id)) {
      const bubble = document.createElement('div');
      bubble.className = m.from === 'client' ? 'text-entry-left' : 'text-entry-right';
      bubble.innerHTML = '<div class="render-text-message-body"></div>';
      bubble.firstElementChild!.textContent = m.text;
      thread.append(bubble);
    }
  }

  function open(id: string): void {
    setTimeout(() => {
      state.openId = id;
      render();
      setTimeout(() => renderThread(id), threadDelay);
    }, openDelay);
  }

  sendBtn.addEventListener('click', () => {
    if (state.brokenSend) return;
    state.sent.push({ chatId: state.openId, text: composer.value });
    const bubble = document.createElement('div');
    bubble.className = 'text-entry-right';
    bubble.textContent = composer.value;
    thread.append(bubble);
    composer.value = '';
  });

  menuBtn.addEventListener('click', () => {
    const menu = document.createElement('ul');
    menu.className = 'MuiMenu-list';
    menu.setAttribute('role', 'menu');
    const label = state.assigned ? 'Liberar chat asignado a Operador' : 'Tomar chat';
    menu.innerHTML = `
      <li class="MuiMenuItem-root" role="menuitem">
        <span id="ChatsToolbar.lockChat">${label}</span>
      </li>`;
    menu.querySelector('li')!.addEventListener('click', () => {
      if (state.assigned) state.released.push(state.openId);
      menu.remove();
    });
    document.body.append(menu);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelector('.MuiMenu-list')?.remove();
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
      render();
      renderThread(id);
    },
    checkboxFor: (id: string) =>
      document.getElementById(id)?.querySelector<HTMLInputElement>('.cbm-select-checkbox') ?? null,
  };
}
