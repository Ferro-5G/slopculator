import { describe, expect, it } from 'vitest';
import { finishPresence, initialPresence, presenceOpen, requestPresence } from '../src/ui/presence';

describe('presence transitions', () => {
  it('keeps the surface present while closing, but its requested state is closed', () => {
    const open = requestPresence(initialPresence(), true, false);
    const closing = requestPresence(open, false, true);
    expect(closing.phase).toBe('closing');
    expect(presenceOpen(closing)).toBe(false);
    expect(finishPresence(closing, closing.generation).phase).toBe('closed');
  });
  it('ignores an entry completion after a close request', () => {
    const opening = requestPresence(initialPresence(), true, true);
    const closing = requestPresence(opening, false, true);
    expect(finishPresence(closing, opening.generation)).toBe(closing);
  });
  it('ignores a close completion after reopening', () => {
    const closing = requestPresence(initialPresence(true), false, true);
    const reopening = requestPresence(closing, true, true);
    expect(finishPresence(reopening, closing.generation)).toBe(reopening);
    expect(finishPresence(reopening, reopening.generation).phase).toBe('open');
  });
  it('settles the current intent immediately when positional motion is disabled', () => {
    for (const open of [true, false]) {
      const running = requestPresence(initialPresence(!open), open, true);
      const settled = requestPresence(running, open, false);
      expect(settled.phase).toBe(open ? 'open' : 'closed');
      expect(finishPresence(settled, running.generation)).toBe(settled);
    }
  });
  it('does not restart a transition for repeated identical intent', () => {
    const opening = requestPresence(initialPresence(), true, true);
    expect(requestPresence(opening, true, true)).toBe(opening);
    const closed = initialPresence();
    expect(requestPresence(closed, false, true)).toBe(closed);
  });
  it('leaves previous snapshots unchanged', () => {
    const closed = initialPresence();
    requestPresence(closed, true, true);
    expect(closed).toEqual({ phase: 'closed', generation: 0 });
  });
});
