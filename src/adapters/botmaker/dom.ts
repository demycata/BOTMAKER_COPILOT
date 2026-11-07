// Utilidades de DOM genericas (no saben nada de Botmaker).
// La idea: primitivas robustas para automatizar una SPA que re-renderiza sola.

/** Espera a que aparezca un elemento que cumpla el predicado, o falla por timeout. */
export function waitFor<T extends Element = Element>(
  find: () => T | null,
  { timeout = 8000, interval = 120 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const found = find();
    if (found) return resolve(found);

    const deadline = Date.now() + timeout;
    const obs = new MutationObserver(() => {
      const el = find();
      if (el) {
        cleanup();
        resolve(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    const poll = window.setInterval(() => {
      const el = find();
      if (el) {
        cleanup();
        resolve(el);
      } else if (Date.now() > deadline) {
        cleanup();
        reject(new Error('waitFor: timeout'));
      }
    }, interval);

    function cleanup() {
      obs.disconnect();
      window.clearInterval(poll);
    }
  });
}

/** Espera a que el DOM se "aquiete" (sin mutaciones) durante `quietMs`. */
export function waitForIdle(quietMs = 400, maxWait = 5000): Promise<void> {
  return new Promise((resolve) => {
    let timer = window.setTimeout(done, quietMs);
    const hardStop = window.setTimeout(done, maxWait);
    const obs = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(done, quietMs);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    function done() {
      obs.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(hardStop);
      resolve();
    }
  });
}

/** Normaliza texto: minusculas y sin acentos, para matchear de forma tolerante. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Extrae el texto visible de un nodo, descartando basura que contamina el
 * textContent: los <span class="material-icons"> traen el NOMBRE del icono
 * como texto (ej "bolt", "done_all") y los tildes/hora de envio se cuelan.
 */
export function cleanText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      '.material-icons, .material-symbols-outlined, .MuiIcon-root, ' +
        '.sent-tildes-container, .sent-tildes, .sent-tilde-time, .sent-tilde-status',
    )
    .forEach((n) => n.remove());
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Busca el primer elemento cuyo texto visible contenga `needle` (normalizado). */
export function findByText(
  needle: string,
  root: ParentNode = document,
  selector = 'button, a, [role="button"], span, div',
): HTMLElement | null {
  const target = normalize(needle);
  const nodes = root.querySelectorAll<HTMLElement>(selector);
  for (const el of nodes) {
    if (normalize(el.textContent ?? '').includes(target)) return el;
  }
  return null;
}

/** Click "humano": dispara los eventos que suelen esperar los frameworks. */
export function click(el: HTMLElement): void {
  el.scrollIntoView({ block: 'center' });
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  el.click();
}

/** Setea el valor de un input/textarea disparando los eventos de React/Angular. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Selecciona el primer selector de una lista que devuelva algo (estrategia en capas). */
export function queryFirst<T extends Element = HTMLElement>(
  selectors: readonly string[],
  root: ParentNode = document,
): T | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector<T>(sel);
      if (el) return el;
    } catch {
      // selector invalido: lo ignoramos y seguimos con el siguiente
    }
  }
  return null;
}

export function queryAllFirst<T extends Element = HTMLElement>(
  selectors: readonly string[],
  root: ParentNode = document,
): T[] {
  for (const sel of selectors) {
    try {
      const els = root.querySelectorAll<T>(sel);
      if (els.length) return Array.from(els);
    } catch {
      // ignorar
    }
  }
  return [];
}
