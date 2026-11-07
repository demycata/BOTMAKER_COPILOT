/**
 * Debounce con espera maxima: agrupa rafagas de llamadas, pero aunque las
 * llamadas no paren, `fn` corre como mucho cada `maxMs`. La SPA muta el DOM todo
 * el tiempo y un debounce comun podria no ejecutarse nunca.
 */
export function debounceMax(fn: () => void, waitMs: number, maxMs: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstCall: number | undefined;
  return () => {
    const now = Date.now();
    firstCall ??= now;
    clearTimeout(timer);
    const delay = Math.min(waitMs, Math.max(0, firstCall + maxMs - now));
    timer = setTimeout(() => {
      firstCall = undefined;
      fn();
    }, delay);
  };
}
