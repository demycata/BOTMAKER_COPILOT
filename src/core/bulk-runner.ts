// Orquestador de acciones masivas. Recorre los chats seleccionados de a uno,
// abre cada uno, ejecuta la accion y reporta progreso. Un fallo NO frena el
// lote: se registra y sigue. Al final emite un resumen.
//
// Es "agnostico" al adapter: recibe las funciones openChat/runAction inyectadas,
// asi se testea sin DOM.

import type {
  BulkActionId,
  BulkActionParams,
  BulkItemResult,
  BulkProgress,
  ChatRef,
} from '@/types';

export interface BulkDeps {
  openChat: (chat: ChatRef) => Promise<void>;
  runAction: (actionId: BulkActionId, params?: BulkActionParams) => Promise<void>;
  /** Pausa entre chats para no saturar la SPA (configurable). */
  delayMs?: number;
}

export class BulkRunner {
  private cancelled = false;
  private active = false;

  constructor(private deps: BulkDeps) {}

  get running(): boolean {
    return this.active;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(
    chats: ChatRef[],
    actionId: BulkActionId,
    params: BulkActionParams | undefined,
    onProgress: (p: BulkProgress) => void,
  ): Promise<BulkProgress> {
    this.cancelled = false;
    this.active = true;
    const results: BulkItemResult[] = [];
    const delay = this.deps.delayMs ?? 350;

    const snapshot = (currentChatName?: string, finished = false): BulkProgress => ({
      actionId,
      total: chats.length,
      done: results.length,
      failed: results.filter((r) => !r.ok).length,
      currentChatName,
      finished,
      cancelled: this.cancelled,
      results: [...results],
    });

    try {
      onProgress(snapshot());
      for (const chat of chats) {
        if (this.cancelled) break;
        onProgress(snapshot(chat.name));
        try {
          await this.deps.openChat(chat);
          await this.deps.runAction(actionId, params);
          results.push({ chatId: chat.id, chatName: chat.name, ok: true });
        } catch (err) {
          results.push({
            chatId: chat.id,
            chatName: chat.name,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await sleep(delay);
      }
    } finally {
      this.active = false;
    }

    const final = snapshot(undefined, true);
    onProgress(final);
    return final;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
