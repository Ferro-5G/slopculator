export interface Step {
  label: string;
  undo: () => void;
  redo: () => void;
  typing?: boolean;
  /** Undo and Redo pass without a toast. */
  quiet?: boolean;
}

export const movedLabel = (line: number, up: boolean): string => `Moved line ${line} ${up ? 'up' : 'down'}`;

export const UNDO_DEPTH = 50;

export class UndoStack {
  private done: Step[] = [];
  private undone: Step[] = [];

  push(step: Step): Step {
    this.done.push(step);
    if (this.done.length > UNDO_DEPTH) this.done.shift();
    this.undone = [];
    return step;
  }

  undo(): Step | null {
    const s = this.done[this.done.length - 1];
    if (!s) return null;
    s.undo();
    this.done.pop();
    this.undone.push(s);
    return s;
  }

  /**
   * Takes back one step that isn't the newest: a toast's Undo for its own step after typing since. Only safe for steps
   * that undo against the sheet as it is, as every step here does.
   */
  undoStep(step: Step): Step | null {
    const i = this.done.lastIndexOf(step);
    if (i < 0) return null;
    step.undo();
    this.done.splice(i, 1);
    this.undone.push(step);
    return step;
  }

  get steps(): readonly Step[] {
    return this.done;
  }

  /** Forgets every step: for when the sheet under them was swapped for one they never applied to. */
  clear(): void {
    this.done = [];
    this.undone = [];
  }

  newestChange(): Step | undefined {
    let i = this.done.length - 1;
    while (i >= 0 && this.done[i].typing) i--;
    return this.done[i];
  }

  redo(): Step | null {
    const s = this.undone[this.undone.length - 1];
    if (!s) return null;
    s.redo();
    this.undone.pop();
    this.done.push(s);
    return s;
  }

  top(): Step | undefined {
    return this.done[this.done.length - 1];
  }

  peekRedo(): Step | undefined {
    return this.undone[this.undone.length - 1];
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  get size(): number {
    return this.done.length;
  }
}

const BURST_MS = 1000;

interface TypingStep extends Step { typing: true; rowId: string; before: string; after: string; at: number; closed: boolean }

export function typingRecorder(stack: UndoStack, put: (rowId: string, text: string) => void, push: (step: Step) => void) {
  return (rowId: string, before: string, after: string, label?: string, quiet = !label): void => {
    const now = Date.now();
    const top = stack.top() as TypingStep | undefined;
    const boundary = after.length > before.length && /[\s,+\-*/^=()]$/.test(after);
    if (label) {
      if (top?.typing) top.closed = true;
    } else if (!stack.canRedo && top?.typing && top.rowId === rowId && !top.closed && now - top.at < BURST_MS && top.after === before) {
      top.after = after;
      top.at = now;
      top.closed = boundary;
      return;
    }
    const step: TypingStep = {
      typing: true, rowId, before, after, at: now, closed: boundary || !!label, quiet, label: label ?? 'Typing',
      undo: () => put(rowId, step.before),
      redo: () => put(rowId, step.after),
    };
    push(step);
  };
}

export function valueDrag(read: (rowId: string) => string | undefined) {
  const lines = new Map<string, string>();
  return {
    lines: lines as ReadonlyMap<string, string>,
    begins(rowId: string, before: string): void {
      if (!lines.has(rowId)) lines.set(rowId, before);
    },
    finish(): { label: string; changes: { rowId: string; before: string; after: string }[] } | null {
      const changes = [...lines].flatMap(([rowId, before]) => {
        const after = read(rowId);
        return after !== undefined && after !== before ? [{ rowId, before, after }] : [];
      });
      lines.clear();
      return changes.length ? { label: changes.length > 1 ? 'Moved point' : 'Slider', changes } : null;
    },
  };
}
