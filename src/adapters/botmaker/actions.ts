// Adapter de Botmaker: traduce intenciones del copiloto en operaciones sobre el
// DOM real. Depende exclusivamente de selectors.ts + dom.ts.
//
// La lista de chats es react-virtualized: solo estan en el DOM las filas
// visibles y los nodos se reciclan al scrollear. Por eso identificamos cada
// conversacion por el id del wrapper y RE-RESOLVEMOS el nodo por id antes de
// operar, en vez de confiar en una referencia guardada.

import type { BulkActionId, BulkActionParams, ChatRef } from '@/types';
import { SELECTORS, MENU_ITEMS } from './selectors';
import {
  cleanText,
  click,
  findByText,
  normalize,
  queryAllFirst,
  queryFirst,
  setNativeValue,
  waitFor,
  waitForIdle,
} from './dom';

// --- Lista de conversaciones ---

/** Lee las conversaciones actualmente renderizadas (solo las visibles). */
export function listChats(): ChatRef[] {
  let rows = queryAllFirst<HTMLElement>(SELECTORS.chatItem);

  // Fallback: si no dio con el wrapper virtualizado, partimos de cada
  // .customer-item y subimos al ancestro con id (que es la conversacion).
  if (!rows.length) {
    const items = Array.from(document.querySelectorAll<HTMLElement>('.customer-item'));
    const seen = new Set<string>();
    rows = items
      .map((it) => it.closest<HTMLElement>('[id]'))
      .filter((w): w is HTMLElement => {
        if (!w || !w.id || seen.has(w.id)) return false;
        seen.add(w.id);
        return true;
      });
  }

  return rows
    .filter((row) => row.id)
    .map((row) => {
      const nameEl = queryFirst<HTMLElement>(SELECTORS.chatName, row);
      const name = (nameEl?.textContent ?? '').trim().slice(0, 80) || '(sin nombre)';
      return { id: row.id, name, el: row };
    });
}

/** Re-encuentra el wrapper de una conversacion por id (tras un re-render). */
function findRowById(id: string): HTMLElement | null {
  const rows = queryAllFirst<HTMLElement>(SELECTORS.chatItem);
  return rows.find((r) => r.id === id) ?? null;
}

/** Abre (clickea) una conversacion y espera a que cargue el hilo. */
export async function openChat(chat: ChatRef): Promise<void> {
  // La referencia guardada puede estar obsoleta por la virtualizacion.
  let row = chat.el && chat.el.isConnected ? chat.el : findRowById(chat.id);
  if (!row) {
    throw new Error('La conversacion no esta renderizada (probablemente fuera de vista)');
  }
  const openBtn = queryFirst<HTMLElement>(SELECTORS.chatOpen, row) ?? row;
  click(openBtn);
  await waitFor(() => queryFirst(SELECTORS.messageItem), { timeout: 6000 }).catch(() => null);
  await waitForIdle(300);
}

// --- Mensajes ---

/** Texto del ultimo mensaje ENTRANTE (del cliente) de la conversacion abierta. */
export function lastIncomingMessage(): string | null {
  const incoming = queryAllFirst<HTMLElement>(SELECTORS.incomingMessageMarker);
  if (!incoming.length) return null;
  const last = incoming[incoming.length - 1];
  const body = queryFirst<HTMLElement>(SELECTORS.messageBody, last) ?? last;
  const text = cleanText(body);
  return text || null;
}

/** Textos de los mensajes SALIENTES (operador/bot) de la conversacion abierta. */
export function outgoingMessages(): string[] {
  const outs = queryAllFirst<HTMLElement>(['.text-entry-right']);
  return outs.map((el) => {
    const body = queryFirst<HTMLElement>(SELECTORS.messageBody, el) ?? el;
    return cleanText(body);
  });
}

/** True si `text` ya fue enviado antes en esta conversacion (para no repetir). */
export function wasAlreadySent(text: string): boolean {
  const needle = normalize(text).slice(0, 50);
  if (!needle) return false;
  return outgoingMessages().some((m) => normalize(m).includes(needle));
}

// --- Composer / envio ---

export async function typeInComposer(text: string): Promise<void> {
  const composer = await waitFor<HTMLElement>(() => queryFirst(SELECTORS.composer), {
    timeout: 4000,
  });
  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    setNativeValue(composer, text);
  } else {
    composer.textContent = text;
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}

export async function sendComposer(): Promise<void> {
  const btn = queryFirst<HTMLElement>(SELECTORS.sendButton);
  if (btn) {
    click(btn);
  } else {
    queryFirst<HTMLElement>(SELECTORS.composer)?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  }
  await waitForIdle(300);
}

export async function sendMessage(text: string, autoSend: boolean): Promise<void> {
  await typeInComposer(text);
  if (autoSend) await sendComposer();
}

// --- Menu de acciones ---

/** Abre el menu de acciones de la conversacion y espera a que aparezca. */
async function openActionsMenu(): Promise<HTMLElement> {
  const already = queryFirst<HTMLElement>(SELECTORS.actionsMenu);
  if (already) return already;
  const trigger = queryFirst<HTMLElement>(SELECTORS.actionsMenuTrigger);
  if (!trigger) {
    throw new Error(
      'No encontre el boton que abre el menu de acciones (actionsMenuTrigger sin calibrar)',
    );
  }
  click(trigger);
  return waitFor<HTMLElement>(() => queryFirst(SELECTORS.actionsMenu), { timeout: 3000 });
}

/** Hover + click: los submenus de MUI se abren al pasar el mouse por encima. */
function hoverClick(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  click(el);
}

/** Busca un item de menu por texto EXACTO (normalizado) en cualquier menu abierto. */
function findMenuItemExact(label: string): HTMLElement | null {
  const target = normalize(label);
  const menus = document.querySelectorAll<HTMLElement>('ul.MuiMenu-list');
  for (const menu of menus) {
    const items = menu.querySelectorAll<HTMLElement>('li[role="menuitem"]');
    for (const li of items) {
      const textEl = li.querySelector<HTMLElement>('.MuiListItemText-primary') ?? li;
      if (normalize(cleanText(textEl)) === target) return li;
    }
  }
  return null;
}

/** Recorre una ruta de submenus, esperando y clickeando cada nivel. */
async function navigateSubmenu(path: string[]): Promise<void> {
  for (const label of path) {
    const item = await waitFor<HTMLElement>(() => findMenuItemExact(label), { timeout: 3000 });
    hoverClick(item);
    await waitForIdle(250);
  }
}

/** Clickea un item del menu por id-ancla estable o, en su defecto, por texto. */
async function clickMenuItem(spec: { anchorId?: string; text: string }): Promise<void> {
  const menu = await openActionsMenu();

  if (spec.anchorId) {
    const anchor = menu.querySelector(`[id="${spec.anchorId}"]`);
    const li = anchor?.closest('li');
    if (li) {
      hoverClick(li as HTMLElement);
      await waitForIdle(300);
      return;
    }
  }
  const byText = findByText(spec.text, menu, SELECTORS.actionsMenuItem.join(','));
  if (byText) {
    hoverClick((byText.closest('li') as HTMLElement) ?? byText);
    await waitForIdle(300);
    return;
  }
  throw new Error(`No encontre el item del menu: ${spec.text}`);
}

/**
 * Cierra la conversacion abierta eligiendo un tipo (ej. 'Consulta resuelta').
 * Flujo: boton Cerrar -> dialogo -> autocomplete de tipo -> Confirmar.
 */
async function closeConversation(type: string): Promise<void> {
  const btn = queryFirst<HTMLElement>(SELECTORS.closeButton);
  if (!btn) throw new Error('No encontre el boton "Cerrar Conversacion"');
  click(btn);

  const dialog = await waitFor<HTMLElement>(() => queryFirst(SELECTORS.closeDialog), {
    timeout: 4000,
  });

  const input = queryFirst<HTMLInputElement>(SELECTORS.closeTypeInput, dialog);
  if (!input) throw new Error('No encontre el selector de tipo de conversacion');
  click(input);
  input.focus();
  setNativeValue(input, type); // filtra las opciones
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

  // Elegir la opcion que matchee (el listbox se renderiza en un popper aparte).
  const target = normalize(type);
  const option = await waitFor<HTMLElement>(
    () => {
      const opts = queryAllFirst<HTMLElement>(SELECTORS.autocompleteOption);
      return opts.find((o) => normalize(cleanText(o)).includes(target)) ?? null;
    },
    { timeout: 4000 },
  );
  click(option);
  await waitForIdle(250);

  // Confirmar (el boton arranca deshabilitado hasta elegir tipo).
  const confirm = await waitFor<HTMLElement>(
    () => {
      const b = findByText('Confirmar', dialog, 'button') as HTMLButtonElement | null;
      return b && !b.disabled ? b : null;
    },
    { timeout: 4000 },
  );
  click(confirm);
  await waitForIdle(300);
}

/**
 * Ejecuta una accion masiva sobre la conversacion ACTUALMENTE ABIERTA.
 * El orquestador abre cada chat antes de llamar aca.
 */
export async function runAction(
  actionId: BulkActionId,
  params?: BulkActionParams,
): Promise<void> {
  switch (actionId) {
    case 'release':
      return clickMenuItem(MENU_ITEMS.release);
    case 'postpone': {
      const path = params?.postponePath;
      if (!path?.length) throw new Error('postpone requiere una duracion');
      await clickMenuItem(MENU_ITEMS.postpone); // abre el submenu de duracion
      await navigateSubmenu(path); // ej ['Horas','Por 4 horas'] o ['Por siempre']
      await waitForIdle(300);
      return;
    }
    case 'close':
      return closeConversation(params?.closeType ?? 'Consulta resuelta');
    case 'sendMessage':
      if (!params?.text) throw new Error('sendMessage requiere texto');
      return sendMessage(params.text, true);
    default:
      throw new Error(`Accion no soportada: ${actionId as string}`);
  }
}

// util re-exportado por si el content lo necesita
export { normalize };
