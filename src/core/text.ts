// Utilidades de texto puras, compartidas por el core y el adapter.

/** Quita acentos sin tocar mayusculas ni simbolos (seguro para patrones regex). */
export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Normaliza texto: minusculas y sin acentos, para matchear de forma tolerante. */
export function normalize(text: string): string {
  return stripAccents(text.toLowerCase()).trim();
}
