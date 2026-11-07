// Utilidades de texto puras, compartidas por el core y el adapter.

/** Quita acentos sin tocar mayusculas ni simbolos (seguro para patrones regex). */
export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normaliza texto: minusculas y sin acentos, para matchear de forma tolerante. */
export function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).trim();
}

/** True si `text` empieza con `prefix`, sin importar mayusculas, acentos ni espacios. */
export function startsWithText(text: string, prefix: string): boolean {
  const compact = (s: string) => normalize(s).replace(/\s+/g, ' ');
  const start = compact(prefix);
  return !!start && compact(text).startsWith(start);
}
