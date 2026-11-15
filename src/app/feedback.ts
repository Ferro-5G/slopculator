import { type MotionPref, motionOf } from '../ui/appearance';
import { play } from './sound';
import { doc } from './sheet';
import { showToast } from './toast';

const pulseTimers = new WeakMap<Element, number>();
export function pulse(el: Element | null | undefined, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  clearTimeout(pulseTimers.get(el));
  // Reduced motion has no animation to play, and an animation that never runs never ends to take its class off.
  if (motionNow() === 'reduced') return;
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  const end = () => el.classList.remove(cls);
  el.addEventListener('animationend', end, { once: true });
  // In case it never ends anyway: the element is hidden, or the look has no animation for it.
  pulseTimers.set(el, window.setTimeout(end, 1000));
}
export async function copy(text: string, from?: Element | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    play('copy');
    pulse(from, 'copied');
    showToast(`Copied ${text.length > 40 ? text.slice(0, 40) + '…' : text}`);
  } catch {
    showToast('Copy failed');
  }
}
export const osReduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const motionNow = (): MotionPref => motionOf(doc.ui.motion, osReduceMotion.matches);
