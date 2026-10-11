// While an ability mode owns the mouse (Shrapnel click-to-confirm, Assassinate aim), LMB must not fire the rifle and
// RMB must not toggle the scope. The gate strips those codes from the player's bindings and restores them after —
// for LMB only once the button is released, so the confirming click doesn't turn into a held-fire shot.
import type { Action, Bindings } from '../input';

export interface GateInput {
  readonly bindings: Bindings;
  rebind(action: Action, codes: string[]): void;
}

export class MouseGate {
  private saved: { fire: string[]; scope: string[] } | null = null;
  private restoreOnUp = false;
  private leftDown = false;

  constructor(private readonly input: GateInput) {}

  get engaged(): boolean {
    return this.saved !== null;
  }

  engage(): void {
    this.restoreOnUp = false;
    if (this.saved) return;
    const b = this.input.bindings;
    this.saved = { fire: [...b.fire], scope: [...b.scope] };
    this.input.rebind('fire', this.saved.fire.filter((c) => c !== 'Mouse0'));
    this.input.rebind('scope', this.saved.scope.filter((c) => c !== 'Mouse2'));
  }

  release(): void {
    if (!this.saved) return;
    if (this.leftDown) this.restoreOnUp = true;
    else this.restore();
  }

  mouseDown(button: number): void {
    if (button === 0) this.leftDown = true;
  }

  mouseUp(button: number): void {
    if (button !== 0) return;
    this.leftDown = false;
    if (this.restoreOnUp) this.restore();
  }

  restore(): void {
    if (!this.saved) return;
    this.input.rebind('fire', this.saved.fire);
    this.input.rebind('scope', this.saved.scope);
    this.saved = null;
    this.restoreOnUp = false;
  }
}
