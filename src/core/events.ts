/** Minimal typed event bus. Event maps are declared in types.ts (GameEvents). */
export class EventBus<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(handler);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (!list) return;
    for (const handler of [...list]) handler(payload);
  }

  clear(): void {
    this.handlers = {};
  }
}
