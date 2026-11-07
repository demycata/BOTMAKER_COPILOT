// Editor de la lista de reglas: pinta una fila por regla y la vuelve a leer.

import type { AutomationRule } from '@/types';

let nextId = 0;

function emptyRule(): AutomationRule {
  return {
    id: `rule-${Date.now()}-${nextId++}`,
    name: '',
    enabled: true,
    oncePerChat: true,
    match: { type: 'contains', value: '' },
    action: { type: 'sendMessage', text: '', autoSend: false },
  };
}

export class RulesEditor {
  constructor(
    private list: HTMLElement,
    private template: HTMLTemplateElement,
    private onChange: () => void,
  ) {
    list.addEventListener('input', onChange);
  }

  render(rules: AutomationRule[]): void {
    this.list.replaceChildren();
    rules.forEach((rule) => this.addRow(rule));
  }

  /** Agrega una regla vacia y deja el cursor en su primer campo. */
  add(): void {
    this.addRow(emptyRule()).querySelector<HTMLInputElement>('.rule-match')?.focus();
    this.onChange();
  }

  /** Lee las reglas, marcando las incompletas. Si hay alguna, devuelve null. */
  read(): AutomationRule[] | null {
    const rows = Array.from(this.list.querySelectorAll<HTMLElement>('.rule-row'));
    const rules = rows.map((row) => this.readRow(row));
    rows.forEach((row, i) => {
      const { match, action } = rules[i];
      row.classList.toggle('rule-invalid', !match.value || !action.text);
    });
    return rules.every((r) => r.match.value && r.action.text) ? rules : null;
  }

  private addRow(rule: AutomationRule): HTMLElement {
    const fragment = this.template.content.cloneNode(true) as DocumentFragment;
    const row = fragment.querySelector<HTMLElement>('.rule-row')!;
    row.dataset.ruleId = rule.id;
    this.field(row, '.rule-enabled').checked = rule.enabled;
    this.field(row, '.rule-match').value = rule.match.value;
    this.field<HTMLTextAreaElement>(row, '.rule-reply').value = rule.action.text;
    this.field(row, '.rule-autosend').checked = rule.action.autoSend;
    row.querySelector('.rule-remove')!.addEventListener('click', () => {
      row.remove();
      this.onChange();
    });
    this.list.append(row);
    return row;
  }

  private readRow(row: HTMLElement): AutomationRule {
    const value = this.field(row, '.rule-match').value.trim();
    return {
      id: row.dataset.ruleId!,
      name: value,
      enabled: this.field(row, '.rule-enabled').checked,
      oncePerChat: true,
      match: { type: 'contains', value },
      action: {
        type: 'sendMessage',
        text: this.field<HTMLTextAreaElement>(row, '.rule-reply').value.trim(),
        autoSend: this.field(row, '.rule-autosend').checked,
      },
    };
  }

  private field<T extends HTMLElement = HTMLInputElement>(row: HTMLElement, selector: string): T {
    return row.querySelector<T>(selector)!;
  }
}
