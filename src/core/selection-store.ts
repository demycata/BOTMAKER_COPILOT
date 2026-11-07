// Estado de seleccion multiple. No sabe de Botmaker: solo maneja un Set de ids
// y notifica cambios. El content script lo conecta con las filas reales.

import type { ChatRef } from '@/types';

export class SelectionStore {
  private selected = new Set<string>();
  private listeners = new Set<(count: number, total: number) => void>();
  private universe: ChatRef[] = [];

  /** Actualiza el universo de chats disponibles (lo que hay en la lista). */
  setUniverse(chats: ChatRef[]): void {
    this.universe = chats;
    // Descartamos seleccionados que ya no existen.
    const ids = new Set(chats.map((c) => c.id));
    for (const id of [...this.selected]) {
      if (!ids.has(id)) this.selected.delete(id);
    }
    this.emit();
  }

  toggle(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.emit();
  }

  set(id: string, on: boolean): void {
    if (on) this.selected.add(id);
    else this.selected.delete(id);
    this.emit();
  }

  selectAll(): void {
    this.universe.forEach((c) => this.selected.add(c.id));
    this.emit();
  }

  clear(): void {
    this.selected.clear();
    this.emit();
  }

  invert(): void {
    const next = new Set<string>();
    for (const c of this.universe) {
      if (!this.selected.has(c.id)) next.add(c.id);
    }
    this.selected = next;
    this.emit();
  }

  has(id: string): boolean {
    return this.selected.has(id);
  }

  /** Devuelve los ChatRef seleccionados, en el orden del universo. */
  getSelected(): ChatRef[] {
    return this.universe.filter((c) => this.selected.has(c.id));
  }

  get count(): number {
    return this.selected.size;
  }

  get total(): number {
    return this.universe.length;
  }

  onChange(fn: (count: number, total: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.selected.size, this.universe.length);
  }
}
