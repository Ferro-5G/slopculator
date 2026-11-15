import { describe, it, expect } from 'vitest';
import { typingRecorder, UndoStack, UNDO_DEPTH } from '../src/ui/undo';
import { findMarks, markText } from '../src/ui/pois';

describe('a typing step that announces itself', () => {
  const record = () => {
    const u = new UndoStack();
    return { u, typing: typingRecorder(u, () => {}, (step) => u.push(step)) };
  };

  it('stays quiet with no label, whatever the default label says', () => {
    const { u, typing } = record();
    typing('r', 'a', 'ab');
    expect(u.top()?.quiet).toBe(true);
  });

  it('is announced when it has a label', () => {
    const { u, typing } = record();
    typing('r', 'a', 'sqrt(', 'sqrt');
    expect(u.top()?.quiet).toBe(false);
  });

  it('stays quiet with a label when the caller asks', () => {
    const { u, typing } = record();
    typing('r', 'a', 'ab', 'Fix', true);
    expect(u.top()?.quiet).toBe(true);
  });
});

describe('the undo stack', () => {
  it('undoes in order, newest first, and redoes in reverse', () => {
    const log: string[] = [];
    const u = new UndoStack();
    for (const n of ['a', 'b', 'c']) u.push({ label: n, undo: () => log.push(`-${n}`), redo: () => log.push(`+${n}`) });
    expect(u.undo()?.label).toBe('c');
    expect(u.undo()?.label).toBe('b');
    expect(u.redo()?.label).toBe('b');
    expect(log).toEqual(['-c', '-b', '+b']);
    expect(u.top()?.label).toBe('b');
    expect(u.peekRedo()?.label).toBe('c');
  });

  it('keeps at least twenty steps, and a new step clears the redo side', () => {
    const u = new UndoStack();
    expect(UNDO_DEPTH).toBeGreaterThanOrEqual(20);
    for (let k = 0; k < UNDO_DEPTH + 5; k++) u.push({ label: String(k), undo() {}, redo() {} });
    expect(u.size).toBe(UNDO_DEPTH);
    u.undo();
    expect(u.canRedo).toBe(true);
    u.push({ label: 'new', undo() {}, redo() {} });
    expect(u.canRedo).toBe(false);
  });

  it('keeps a failed undo available to retry without changing either side', () => {
    const u = new UndoStack();
    let fails = true;
    const step = u.push({ label: 'Retry', undo() { if (fails) throw new Error('not ready'); }, redo() {} });
    expect(() => u.undo()).toThrow('not ready');
    expect(u.top()).toBe(step);
    expect(u.canRedo).toBe(false);
    fails = false;
    expect(u.undo()).toBe(step);
    expect(u.canUndo).toBe(false);
    expect(u.peekRedo()).toBe(step);
  });

  it('keeps a failed selective undo in its original place', () => {
    const u = new UndoStack();
    const first = u.push({ label: 'First', undo() { throw new Error('not ready'); }, redo() {} });
    const last = u.push({ label: 'Last', undo() {}, redo() {} });
    expect(() => u.undoStep(first)).toThrow('not ready');
    expect(u.steps).toEqual([first, last]);
    expect(u.canRedo).toBe(false);
  });

  it('keeps a failed redo available to retry', () => {
    const u = new UndoStack();
    let fails = true;
    const step = u.push({ label: 'Retry', undo() {}, redo() { if (fails) throw new Error('not ready'); } });
    u.undo();
    expect(() => u.redo()).toThrow('not ready');
    expect(u.peekRedo()).toBe(step);
    expect(u.canUndo).toBe(false);
    fails = false;
    expect(u.redo()).toBe(step);
    expect(u.canRedo).toBe(false);
    expect(u.top()).toBe(step);
  });

  it('says so when there is nothing to undo or redo', () => {
    const u = new UndoStack();
    expect(u.undo()).toBeNull();
    expect(u.redo()).toBeNull();
  });
});

describe('graph marks on every curve', () => {
  const xs = Array.from({ length: 401 }, (_, k) => -5 + k * 0.025);
  it('marks each curve\'s zeros and where two curves cross', () => {
    const marks = findMarks([{ f: (x) => x * x - 1.5, rowId: 'a' }, { f: (x) => x, rowId: 'b' }], xs, 20, false);
    const zeros = marks.filter((m) => m.kind === 'zero');
    expect(zeros.filter((m) => m.rowId === 'a').map((m) => Number(m.x.toFixed(4)))).toEqual([-1.2247, 1.2247]);
    expect(zeros.some((m) => m.rowId === 'b' && Math.abs(m.x) < 1e-9)).toBe(true);
    expect(marks.filter((m) => m.kind === 'intersection')).toHaveLength(2);
    expect(marks.some((m) => m.kind === 'min' && m.rowId === 'a')).toBe(true);
  });
  it('reads a mark as "zero (1.2247, 0)"', () => {
    expect(markText({ x: 1.224744871, y: 0, kind: 'zero' }, (v) => String(Number(v.toPrecision(5))))).toBe('zero (1.2247, 0)');
  });
});
