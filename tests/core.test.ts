import { describe, expect, it, vi } from 'vitest';
import { BulkRunner } from '@/core/bulk-runner';
import { evaluate, RuleFireLog, defaultAdvisorRule } from '@/core/rules-engine';
import { SelectionStore } from '@/core/selection-store';
import { normalize } from '@/core/text';
import { debounceMax } from '@/core/timing';
import type { AutomationRule, BulkProgress } from '@/types';

const chat = (id: string) => ({ id, name: id });
const rule = (match: AutomationRule['match']): AutomationRule => ({ ...defaultAdvisorRule(), match });

describe('SelectionStore', () => {
  it('conserva la seleccion cuando una conversacion sale de pantalla', () => {
    const store = new SelectionStore();
    store.merge([chat('a'), chat('b')]);
    store.selectAll();
    store.merge([chat('b'), chat('c')]);
    expect(store.count).toBe(2);
    expect(store.has('a')).toBe(true);
    expect(store.total).toBe(3);
    expect(store.getSelected().map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('no guarda nodos del DOM', () => {
    const store = new SelectionStore();
    store.merge([{ ...chat('a'), el: document.createElement('div') }]);
    store.selectAll();
    expect(store.getSelected()[0].el).toBeUndefined();
  });

  it('olvida lo que ya no esta tras recorrer la lista completa', () => {
    const store = new SelectionStore();
    store.merge([chat('a'), chat('b')]);
    store.selectAll();
    store.retainOnly(new Set(['b']));
    expect(store.total).toBe(1);
    expect(store.has('a')).toBe(false);
  });

  it('invierte sobre todas las conocidas, visibles o no', () => {
    const store = new SelectionStore();
    store.merge([chat('a'), chat('b'), chat('c')]);
    store.set('a', true);
    store.invert();
    expect(store.getSelected().map((c) => c.id)).toEqual(['b', 'c']);
  });

  it('no avisa si lo visible no agrega nada nuevo', () => {
    const store = new SelectionStore();
    store.merge([chat('a')]);
    const listener = vi.fn();
    store.onChange(listener);
    store.merge([chat('a')]);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('motor de reglas', () => {
  it('coincide sin importar mayusculas ni acentos', () => {
    const hit = evaluate('Quiero HABLAR con Asesór', [
      rule({ type: 'contains', value: 'hablar con asesor' }),
    ]);
    expect(hit).not.toBeNull();
  });

  it('ignora una regla sin texto en vez de coincidir con todo', () => {
    expect(evaluate('hola', [rule({ type: 'contains', value: '   ' })])).toBeNull();
    expect(evaluate('hola', [rule({ type: 'regex', value: '' })])).toBeNull();
  });

  it('acepta regex con acentos', () => {
    expect(evaluate('atención', [rule({ type: 'regex', value: 'atención' })])).not.toBeNull();
  });

  it('no rompe clases de regex en mayuscula', () => {
    expect(evaluate('abc', [rule({ type: 'regex', value: '^\\D+$' })])).not.toBeNull();
    expect(evaluate('123', [rule({ type: 'regex', value: '^\\D+$' })])).toBeNull();
  });

  it('ignora una regex invalida', () => {
    expect(evaluate('hola', [rule({ type: 'regex', value: '(' })])).toBeNull();
  });

  it('respeta una vez por chat, separado por conversacion', () => {
    const log = new RuleFireLog();
    const r = defaultAdvisorRule();
    log.markFired('a', r.id);
    expect(log.shouldFire('a', r)).toBe(false);
    expect(log.shouldFire('b', r)).toBe(true);
  });
});

describe('BulkRunner', () => {
  const noDelay = { delayMs: 0 };

  it('un fallo no frena el lote', async () => {
    const runner = new BulkRunner({
      ...noDelay,
      openChat: async (c) => {
        if (c.id === 'b') throw new Error('boom');
      },
      runAction: async () => undefined,
    });
    const result = await runner.run([chat('a'), chat('b'), chat('c')], 'release', undefined, () => undefined);
    expect(result.done).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.results[1].error).toBe('boom');
  });

  it('no ejecuta la accion si no pudo abrir el chat', async () => {
    const runAction = vi.fn(async () => undefined);
    const runner = new BulkRunner({
      ...noDelay,
      openChat: async () => {
        throw new Error('no abrio');
      },
      runAction,
    });
    await runner.run([chat('a')], 'close', undefined, () => undefined);
    expect(runAction).not.toHaveBeenCalled();
  });

  it('cancela y lo informa', async () => {
    const seen: BulkProgress[] = [];
    const runner: BulkRunner = new BulkRunner({
      ...noDelay,
      openChat: async () => runner.cancel(),
      runAction: async () => undefined,
    });
    const result = await runner.run([chat('a'), chat('b')], 'release', undefined, (p) => seen.push(p));
    expect(result.done).toBe(1);
    expect(result.cancelled).toBe(true);
    expect(seen.at(-1)?.finished).toBe(true);
  });

  it('indica si esta corriendo', async () => {
    let during = false;
    const runner: BulkRunner = new BulkRunner({
      ...noDelay,
      openChat: async () => {
        during = runner.running;
      },
      runAction: async () => undefined,
    });
    await runner.run([chat('a')], 'release', undefined, () => undefined);
    expect(during).toBe(true);
    expect(runner.running).toBe(false);
  });
});

describe('utilidades', () => {
  it('normaliza acentos, mayusculas y espacios', () => {
    expect(normalize('  ÁtenCión ')).toBe('atencion');
  });

  it('debounceMax corre aunque las llamadas no paren', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = debounceMax(fn, 100, 300);
    for (let i = 0; i < 10; i++) {
      call();
      vi.advanceTimersByTime(50);
    }
    expect(fn).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
