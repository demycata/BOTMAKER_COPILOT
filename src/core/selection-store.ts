// Estado de seleccion multiple. No sabe de Botmaker: maneja ids y notifica cambios.
//
// La lista de Botmaker es virtualizada: una conversacion que sale de pantalla
// desaparece del DOM pero sigue existiendo. Por eso el store ACUMULA lo que va
// viendo y nunca descarta una conversacion solo porque dejo de estar visible.

import type { ChatRef } from '@/types';

export class SelectionStore {
  private selected = new Set<string>();
  private known = new Map<string, ChatRef>();
  private listeners = new Set<(count: number, total: number) => void>();

  /** Suma las conversaciones visibles a las conocidas (sin guardar nodos del DOM). */
  merge(chats: ChatRef[]): void {
    const before = this.known.size;
    for (const { id, name, offset } of chats) this.known.set(id, { id, name, offset });
    if (this.known.size !== before) this.emit();
  }

  /** Tras recorrer la lista completa: olvida lo que ya no esta en ella. */
  retainOnly(ids: Set<string>): void {
    for (const id of [...this.known.keys()]) {
      if (!ids.has(id)) {
        this.known.delete(id);
        this.selected.delete(id);
      }
    }
    this.emit();
  }

  set(id: string, on: boolean): void {
    if (on) this.selected.add(id);
    else this.selected.delete(id);
    this.emit();
  }

  unselect(ids: string[]): void {
    ids.forEach((id) => this.selected.delete(id));
    this.emit();
  }

  selectAll(): void {
    for (const id of this.known.keys()) this.selected.add(id);
    this.emit();
  }

  clear(): void {
    this.selected.clear();
    this.emit();
  }

  invert(): void {
    const next = new Set<string>();
    for (const id of this.known.keys()) {
      if (!this.selected.has(id)) next.add(id);
    }
    this.selected = next;
    this.emit();
  }

  /** Olvida todo: seleccion y conversaciones conocidas. */
  reset(): void {
    this.selected.clear();
    this.known.clear();
    this.emit();
  }

  has(id: string): boolean {
    return this.selected.has(id);
  }

  getSelected(): ChatRef[] {
    return [...this.known.values()].filter((c) => this.selected.has(c.id));
  }

  get count(): number {
    return this.selected.size;
  }

  get total(): number {
    return this.known.size;
  }

  onChange(fn: (count: number, total: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.selected.size, this.known.size);
  }
}
