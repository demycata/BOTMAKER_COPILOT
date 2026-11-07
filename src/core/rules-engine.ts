// Motor de reglas de automatizacion. Logica pura: recibe un texto (el ultimo
// mensaje del cliente) y una lista de reglas, y decide cual dispara.
// El "efecto" (mandar el mensaje) lo ejecuta quien lo llama, con el adapter.

import type { AutomationRule } from '@/types';
import { normalize } from '@/adapters/botmaker/dom';

export interface RuleHit {
  rule: AutomationRule;
}

/** Devuelve la primera regla habilitada que matchea el texto, o null. */
export function evaluate(text: string, rules: AutomationRule[]): RuleHit | null {
  const haystack = normalize(text);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (matches(haystack, rule)) return { rule };
  }
  return null;
}

function matches(normalizedText: string, rule: AutomationRule): boolean {
  const { match } = rule;
  if (match.type === 'contains') {
    return normalizedText.includes(normalize(match.value));
  }
  // regex: se evalua sobre el texto normalizado, sin flags peligrosas
  try {
    return new RegExp(match.value, 'i').test(normalizedText);
  } catch {
    return false;
  }
}

/**
 * Lleva registro de que reglas ya se dispararon por conversacion, para respetar
 * `oncePerChat` y no spamear al cliente.
 */
export class RuleFireLog {
  private fired = new Set<string>();

  key(chatId: string, ruleId: string): string {
    return `${chatId}::${ruleId}`;
  }

  shouldFire(chatId: string, rule: AutomationRule): boolean {
    if (!rule.oncePerChat) return true;
    return !this.fired.has(this.key(chatId, rule.id));
  }

  markFired(chatId: string, ruleId: string): void {
    this.fired.add(this.key(chatId, ruleId));
  }
}

/** Regla de ejemplo que viene precargada: "hablar con asesor". */
export function defaultAdvisorRule(): AutomationRule {
  return {
    id: 'rule-advisor',
    name: 'Derivar a asesor',
    enabled: true,
    oncePerChat: true,
    match: { type: 'contains', value: 'hablar con asesor' },
    action: {
      type: 'sendMessage',
      text: 'En un momento te derivo con un asesor. Gracias por tu paciencia.',
      autoSend: false, // por defecto NO envia solo: lo revisa el operador
    },
  };
}
