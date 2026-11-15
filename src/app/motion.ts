import { finishPresence, initialPresence, presenceOpen, requestPresence, type PresencePhase } from '../ui/presence';

const settlers = new Set<() => void>();
/** Components register once for the page's lifetime. Changing motion policy settles their current intent. */
export const registerMotionSettler = (settle: () => void): void => { settlers.add(settle); };
export const settleMotions = (): void => { for (const settle of settlers) settle(); };

/** Owns a coupled surface/scrim's entry frame and CSS transitions. Reversals keep the current rendered position. */
export class PresenceMotion {
  private state = initialPresence();
  private frame = 0;
  constructor(private elements: HTMLElement[], private changed: (phase: PresencePhase) => void) {
    for (const el of elements) el.dataset.presence = 'closed';
    registerMotionSettler(() => this.set(this.open, false));
  }
  get open(): boolean { return presenceOpen(this.state); }
  get phase(): PresencePhase { return this.state.phase; }

  set(open: boolean, animate: boolean): void {
    const next = requestPresence(this.state, open, animate);
    if (next === this.state) return;
    const wasClosed = this.state.phase === 'closed';
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.state = next;
    if (!animate) {
      this.paint(open);
      this.publish();
      return;
    }
    const start = () => {
      if (this.state.generation !== next.generation) return;
      this.frame = 0;
      this.paint(open);
      // Read the transitions the browser actually started, not an assumed timeout.
      const animations = this.elements.flatMap((el) => el.getAnimations());
      void Promise.allSettled(animations.map((a) => a.finished)).then(() => {
        const settled = finishPresence(this.state, next.generation);
        if (settled === this.state) return;
        this.state = settled;
        this.paint(this.open);
        this.publish();
      });
    };
    for (const el of this.elements) el.hidden = false;
    this.publish();
    if (open && wasClosed) {
      for (const el of this.elements) el.classList.remove('open');
      void this.elements[0].offsetHeight; // Establish the closed style before the entry frame.
      this.frame = requestAnimationFrame(start);
    } else start();
  }
  private paint(open: boolean): void {
    for (const el of this.elements) {
      el.classList.toggle('open', open);
      el.hidden = this.state.phase === 'closed';
    }
  }
  private publish(): void {
    for (const el of this.elements) el.dataset.presence = this.state.phase;
    this.changed(this.state.phase);
  }
}
