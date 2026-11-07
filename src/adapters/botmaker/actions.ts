// Adapter de Botmaker: traduce intenciones del copiloto en operaciones sobre el
// DOM real. Depende exclusivamente de selectors.ts + dom.ts.
//
// La lista de chats es react-virtualized: solo estan en el DOM las filas
// visibles y los nodos se reciclan al scrollear (el mismo nodo pasa a mostrar
// otra conversacion). Por eso NUNCA se confia en una referencia guardada: cada
// conversacion se busca por id, scrolleando la lista si hace falta, y antes de
// actuar se confirma que la conversacion abierta es la correcta.

import type { BulkActionId, BulkActionParams, ChatRef } from '@/types';
import { normalize, startsWithText } from '@/core/text';
import { SELECTORS, MENU_ITEMS } from './selectors';
import {
  cleanText,
  click,
  findByText,
  queryAllFirst,
  queryFirst,
  setNativeValue,
  waitFor,
  waitForIdle,
  waitUntil,
} from './dom';

const anyOf = (selectors: readonly string[]) => selectors.join(',');

// --- Lista de conversaciones ---

/** Lee las conversaciones actualmente renderizadas (solo las visibles). */
export function listChats(): ChatRef[] {
  let rows = queryAllFirst<HTMLElement>(SELECTORS.chatItem);

  // Fallback: si no dio con el wrapper virtualizado, partimos de cada fila y
  // subimos al ancestro con id (que es la conversacion).
  if (!rows.length) {
    const items = queryAllFirst<HTMLElement>(SELECTORS.chatRow);
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
      const top = parseFloat(row.style.top);
      const preview = queryFirst<HTMLElement>(SELECTORS.chatLastMessage, row);
      return {
        id: row.id,
        name,
        el: row,
        offset: Number.isFinite(top) ? top : row.offsetTop,
        lastMessage: preview ? cleanText(preview) : undefined,
      };
    });
}

/** Encuentra la fila de una conversacion por id, solo entre las renderizadas. */
function findRowById(id: string): HTMLElement | null {
  return listChats().find((c) => c.id === id)?.el ?? null;
}

/** Elemento que scrollea la lista de conversaciones. */
function chatScroller(): HTMLElement | null {
  const row = queryFirst<HTMLElement>(SELECTORS.chatRow);
  const inner = row?.closest<HTMLElement>(anyOf(SELECTORS.chatListInner));
  return inner?.parentElement ?? queryFirst<HTMLElement>(SELECTORS.chatList);
}

function scrollList(scroller: HTMLElement, top: number): Promise<void> {
  scroller.scrollTop = top;
  return waitForIdle(120, 800);
}

type SweepEnd = 'stopped' | 'end' | 'timeout';

/**
 * Recorre la lista de arriba abajo. `visit` recibe lo renderizado en cada paso
 * y devuelve true para cortar. Al llegar al fondo espera un momento por si la
 * lista carga mas conversaciones.
 */
async function sweepList(visit: (chats: ChatRef[]) => boolean, maxMs: number): Promise<SweepEnd> {
  const scroller = chatScroller();
  if (!scroller) return visit(listChats()) ? 'stopped' : 'end';

  const deadline = Date.now() + maxMs;
  const step = Math.max(scroller.clientHeight * 0.8, 40);
  let stalled = 0;
  await scrollList(scroller, 0);

  for (;;) {
    if (visit(listChats())) return 'stopped';
    if (Date.now() > deadline) return 'timeout';

    const top = scroller.scrollTop;
    const height = scroller.scrollHeight;
    await scrollList(scroller, top + step);
    if (scroller.scrollTop !== top) {
      stalled = 0;
      continue;
    }

    await waitForIdle(400, 1500);
    if (scroller.scrollHeight !== height) stalled = 0;
    else if (++stalled >= 2) return 'end';
  }
}

/** Recorre toda la lista y devuelve sus conversaciones, sin mover la vista final. */
export async function collectAllChats(
  maxMs = 60000,
): Promise<{ chats: ChatRef[]; complete: boolean }> {
  const found = new Map<string, ChatRef>();
  const scroller = chatScroller();
  const startTop = scroller?.scrollTop ?? 0;

  const end = await sweepList((chats) => {
    for (const chat of chats) found.set(chat.id, chat);
    return false;
  }, maxMs);

  if (scroller) await scrollList(scroller, startTop);
  return { chats: [...found.values()], complete: end === 'end' };
}

/** Lleva a pantalla la fila de una conversacion y la devuelve. */
async function revealRow(chat: ChatRef): Promise<HTMLElement> {
  const visible = findRowById(chat.id);
  if (visible) return visible;

  const scroller = chatScroller();
  if (scroller && chat.offset !== undefined) {
    await scrollList(scroller, Math.max(0, chat.offset - scroller.clientHeight / 2));
    const near = findRowById(chat.id);
    if (near) return near;
  }

  const hit: { row?: HTMLElement } = {};
  await sweepList((chats) => {
    hit.row = chats.find((c) => c.id === chat.id)?.el;
    return !!hit.row;
  }, 20000);
  if (!hit.row) {
    throw new Error('No encontre la conversacion en la lista (pudo cerrarse o cambiar de vista)');
  }
  return hit.row;
}

function isOpenRow(row: HTMLElement): boolean {
  return row.matches(anyOf(SELECTORS.chatSelected)) || !!queryFirst(SELECTORS.chatSelected, row);
}

/** Conversacion abierta, si su fila esta renderizada. */
export function openChatRef(): ChatRef | null {
  return listChats().find((c) => c.el && isOpenRow(c.el)) ?? null;
}

/** Huella del hilo visible, para detectar que realmente cargo otra conversacion. */
function threadSignature(): string {
  const bubbles = document.querySelectorAll(anyOf(SELECTORS.messageItem));
  return Array.from(bubbles, (b) => b.textContent ?? '').join('\n');
}

/**
 * Abre una conversacion y confirma que quedo abierta y con su hilo cargado. Si
 * no lo puede confirmar falla, para no actuar sobre otro cliente.
 */
export async function openChat(chat: ChatRef): Promise<void> {
  const row = await revealRow(chat);
  if (isOpenRow(row)) {
    await waitForIdle(200);
    return;
  }

  const thread = threadSignature();
  click(queryFirst<HTMLElement>(SELECTORS.chatOpen, row) ?? row);

  await waitUntil(() => openChatRef()?.id === chat.id, {
    timeout: 6000,
    what: 'que se abra la conversacion',
  });
  await waitUntil(() => threadSignature() !== thread, {
    timeout: 4000,
    what: 'que cargue el hilo de la conversacion',
  });
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

/** True si lo ultimo del hilo es del cliente, es decir, nadie le contesto despues. */
export function lastBubbleIsIncoming(): boolean {
  const bubbles = document.querySelectorAll(anyOf(SELECTORS.messageItem));
  const last = bubbles[bubbles.length - 1];
  return !!last?.matches(anyOf(SELECTORS.incomingMessageMarker));
}

/** True si lo ultimo del hilo es un mensaje del operador que empieza con `text`. */
export function lastMessageIsOperatorText(text: string): boolean {
  const bubbles = document.querySelectorAll<HTMLElement>(anyOf(SELECTORS.messageItem));
  const last = bubbles[bubbles.length - 1];
  if (!last?.matches(anyOf(SELECTORS.outgoingMessageMarker))) return false;
  if (!queryFirst(SELECTORS.humanMessageMarker, last)) return false;
  const body = queryFirst<HTMLElement>(SELECTORS.messageText, last);
  return !!body && startsWithText(cleanText(body), text);
}

/** Textos de los mensajes SALIENTES (operador/bot) de la conversacion abierta. */
export function outgoingMessages(): string[] {
  const outs = queryAllFirst<HTMLElement>(SELECTORS.outgoingMessageMarker);
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

function composerText(): string {
  const composer = queryFirst<HTMLElement>(SELECTORS.composer);
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    return composer.value;
  }
  return composer?.textContent ?? '';
}

export async function typeInComposer(text: string): Promise<void> {
  const composer = await waitFor<HTMLElement>(() => queryFirst(SELECTORS.composer), {
    timeout: 4000,
    what: 'el cuadro de texto',
  });
  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    setNativeValue(composer, text);
  } else {
    composer.textContent = text;
    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}

/** Envia lo escrito y confirma que salio: el cuadro de texto queda vacio. */
export async function sendComposer(): Promise<void> {
  const btn = queryFirst<HTMLElement>(SELECTORS.sendButton);
  if (btn) {
    click(btn);
  } else {
    queryFirst<HTMLElement>(SELECTORS.composer)?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
  }
  await waitUntil(() => !composerText().trim(), {
    timeout: 6000,
    what: 'que se envie el mensaje',
  });
  await waitForIdle(300);
}

export async function sendMessage(text: string, autoSend: boolean): Promise<void> {
  const draft = composerText().trim();
  if (draft && draft !== text.trim()) {
    throw new Error('El cuadro de texto tiene un borrador; no lo pise');
  }
  await typeInComposer(text);
  if (autoSend) await sendComposer();
}

// --- Menu de acciones ---

/** Abre el menu de acciones de la conversacion y espera a que aparezca. */
async function openActionsMenu(): Promise<HTMLElement> {
  const already = queryFirst<HTMLElement>(SELECTORS.actionsMenu);
  if (already) return already;
  const trigger = queryFirst<HTMLElement>(SELECTORS.actionsMenuTrigger);
  if (!trigger) throw new Error('No encontre el boton que abre el menu de acciones');
  click(trigger);
  return waitFor<HTMLElement>(() => queryFirst(SELECTORS.actionsMenu), {
    timeout: 3000,
    what: 'el menu de acciones',
  });
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
  for (const menu of queryAllFirst<HTMLElement>(SELECTORS.anyMenu)) {
    for (const li of queryAllFirst<HTMLElement>(SELECTORS.anyMenuItem, menu)) {
      const textEl = queryFirst<HTMLElement>(SELECTORS.menuItemText, li) ?? li;
      if (normalize(cleanText(textEl)) === target) return li;
    }
  }
  return null;
}

/** Recorre una ruta de submenus, esperando y clickeando cada nivel. */
async function navigateSubmenu(path: string[]): Promise<void> {
  for (const label of path) {
    const item = await waitFor<HTMLElement>(() => findMenuItemExact(label), {
      timeout: 3000,
      what: `la opcion "${label}"`,
    });
    hoverClick(item);
    await waitForIdle(250);
  }
}

/** Clickea un item del menu por id-ancla estable o, en su defecto, por texto. */
async function clickMenuItem(spec: {
  anchorId?: string;
  text: string;
  guard?: string;
}): Promise<void> {
  const menu = await openActionsMenu();
  const byAnchor = spec.anchorId
    ? menu.querySelector(`[id="${spec.anchorId}"]`)?.closest<HTMLElement>('li')
    : null;
  const byText = findByText(spec.text, menu, SELECTORS.actionsMenuItem.join(','));
  const item = byAnchor ?? byText?.closest<HTMLElement>('li') ?? byText;

  const guard = normalize(spec.guard ?? spec.text);
  if (!item || !normalize(item.textContent ?? '').includes(guard)) {
    throw new Error(`El menu no ofrece "${spec.text}" en esta conversacion`);
  }
  hoverClick(item);
  await waitForIdle(300);
}

/** Confirma que el menu se cerro, es decir, que la opcion elegida se ejecuto. */
function waitForMenuClosed(): Promise<void> {
  return waitUntil(() => !queryFirst(SELECTORS.anyMenu), {
    timeout: 3000,
    what: 'que se cierre el menu',
  });
}

/** Cierra menus y dialogos que hayan quedado abiertos tras un error. */
function dismissOverlays(): void {
  const open = document.querySelectorAll<HTMLElement>(
    `${anyOf(SELECTORS.anyMenu)},${anyOf(SELECTORS.closeDialog)}`,
  );
  for (const el of Array.from(open).reverse()) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
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
    what: 'el dialogo de cierre',
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
    { timeout: 4000, what: `el tipo "${type}"` },
  );
  click(option);
  await waitForIdle(250);

  // Confirmar (el boton arranca deshabilitado hasta elegir tipo).
  const confirm = await waitFor<HTMLElement>(
    () => {
      const b = findByText('Confirmar', dialog, 'button') as HTMLButtonElement | null;
      return b && !b.disabled ? b : null;
    },
    { timeout: 4000, what: 'el boton Confirmar' },
  );
  click(confirm);
  await waitUntil(() => !dialog.isConnected || dialog.getClientRects().length === 0, {
    timeout: 5000,
    what: 'que se cierre la conversacion',
  });
  await waitForIdle(300);
}

async function dispatchAction(actionId: BulkActionId, params?: BulkActionParams): Promise<void> {
  switch (actionId) {
    case 'release':
      await clickMenuItem(MENU_ITEMS.release);
      return waitForMenuClosed();
    case 'postpone': {
      const path = params?.postponePath;
      if (!path?.length) throw new Error('postpone requiere una duracion');
      await clickMenuItem(MENU_ITEMS.postpone); // abre el submenu de duracion
      await navigateSubmenu(path); // ej ['Horas','Por 4 horas'] o ['Por siempre']
      return waitForMenuClosed();
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

/**
 * Ejecuta una accion sobre la conversacion ACTUALMENTE ABIERTA. Si falla, deja
 * la pantalla limpia para que no trabe a la conversacion siguiente.
 */
export async function runAction(
  actionId: BulkActionId,
  params?: BulkActionParams,
): Promise<void> {
  try {
    await dispatchAction(actionId, params);
  } catch (err) {
    dismissOverlays();
    throw err;
  }
}

// --- Diagnostico ---

export interface DiagnosticReport {
  /** Cantidad de elementos encontrados por cada selector. Sin datos de clientes. */
  counts: Record<string, number>;
  scroller: { found: boolean; scrollable: boolean };
}

/** Comprueba los selectores contra la pagina actual. Solo lee, no toca nada. */
export function diagnose(): DiagnosticReport {
  const counts: Record<string, number> = {};
  for (const [key, selectors] of Object.entries(SELECTORS)) {
    counts[key] = queryAllFirst(selectors).length;
  }
  const scroller = chatScroller();
  return {
    counts,
    scroller: {
      found: !!scroller,
      scrollable: !!scroller && scroller.scrollHeight > scroller.clientHeight,
    },
  };
}
