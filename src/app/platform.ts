import { PHONE_QUERY } from './breakpoints';


export const dark = matchMedia('(prefers-color-scheme: dark)');
export const coarse = matchMedia('(pointer: coarse)');
export const narrow = matchMedia(PHONE_QUERY);
export const deskKeys = matchMedia('(pointer: fine) and (hover: hover) and (min-width: 1100px)');
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS/.test(navigator.userAgent);
export const primaryMod = (e: KeyboardEvent): boolean => (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
export const cmdOrCtrl = (e: KeyboardEvent): boolean => (isMac ? e.metaKey : e.ctrlKey);
export const kb = (s: string): string => (isMac
  ? s.replace(/\bCtrl\+(?!(?:Shift\+)?Alt\+)/g, 'Cmd+').replace(/\b(?:(?:Cmd|Ctrl|Alt|Shift)\+)+(?:Backspace\b|Enter\b)?(?![a-z])/g, (m) =>
    m.replace(/Cmd\+/g, '⌘').replace(/Ctrl\+/g, '⌃').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧').replace('Backspace', '⌫').replace('Enter', '↩'))
  : s);
