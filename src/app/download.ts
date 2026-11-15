const two = (n: number): string => String(n).padStart(2, '0');
/** Today's date for a file name, by the clock on the wall: toISOString is UTC, which is tomorrow in the evening west of Greenwich. */
export function fileDate(withTime = false): string {
  const d = new Date();
  const day = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return withTime ? `${day}-${two(d.getHours())}-${two(d.getMinutes())}-${two(d.getSeconds())}` : day;
}
/** A sheet's name as the start of a file name, or the app's when it has none. */
export const fileStem = (sheet: string | null): string => sheet?.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().replace(/\s+/g, '-') || 'slopculator';

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
