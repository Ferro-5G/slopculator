/** Presence and animation progress are separate from a component's saved preferences. */
export type PresencePhase = 'closed' | 'opening' | 'open' | 'closing';
export interface PresenceState { phase: PresencePhase; generation: number }
export const initialPresence = (open = false): PresenceState => ({ phase: open ? 'open' : 'closed', generation: 0 });
export const presenceOpen = (state: PresenceState): boolean => state.phase === 'opening' || state.phase === 'open';

/** New intent invalidates the previous animation's completion, including on a reversal. */
export function requestPresence(state: PresenceState, open: boolean, animate: boolean): PresenceState {
  const phase = open ? (animate ? 'opening' : 'open') : (animate ? 'closing' : 'closed');
  if (state.phase === phase || (animate && state.phase === (open ? 'open' : 'closed'))) return state;
  return { phase, generation: state.generation + 1 };
}

export function finishPresence(state: PresenceState, generation: number): PresenceState {
  if (state.generation !== generation || (state.phase !== 'opening' && state.phase !== 'closing')) return state;
  return { ...state, phase: presenceOpen(state) ? 'open' : 'closed' };
}
