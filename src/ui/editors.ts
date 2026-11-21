export interface EditorSize { min: number; max: number; start: number }

export const stepSize = (size: EditorSize, now: number, by: -1 | 1): number => Math.min(size.max, Math.max(size.min, now + by));

export function definedNames(rows: readonly ({ kind: 'expr'; text: string } | { kind: 'table' })[]): Set<string> {
  return new Set(rows.flatMap((r) => {
    const m = r.kind === 'expr' ? /^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=(?!=)/u.exec(r.text) : null;
    return m ? [m[1]] : [];
  }));
}

/** The first of an editor's names no line defines: a name a line already has would break both lines. Empty when all are taken. */
export const freeName = (candidates: readonly string[], used: ReadonlySet<string>): string => candidates.find((c) => !used.has(c)) ?? '';

/** Why a typed name can't be used, or '' when it can. Empty is fine: the line just goes unnamed. */
export function nameProblem(typed: string, used: ReadonlySet<string>): string {
  const name = typed.trim();
  return name && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? 'Start with a letter, using letters, numbers, or underscores only.'
    : used.has(name) ? `${name} is already defined on this sheet. Choose another name, or leave it blank.` : '';
}

export interface CellProblem { r: number; c: number; message: string }

export interface EditorText { title: string; subtitle: string; nameLabel: string; nameHint: string; sizeLabel: string; action: string; add: string; remove: string }

interface EditorBase { size: EditorSize; names: readonly string[]; text: EditorText }

export interface MatrixEditor extends EditorBase {
  columnText: Pick<EditorText, 'sizeLabel' | 'add' | 'remove'>;
  placeholder: string;
  cellLabel: (r: number, c: number) => string;
  sizeText: (rows: number, cols: number) => string;
  line: (name: string, cells: readonly (readonly string[])[], rows: number, cols: number) => string;
}

/** An editor that's a list of entries, each a row of `columns` boxes. */
export interface ListEditor extends EditorBase {
  columns: number;
  placeholder: (c: number) => string;
  heading: (r: number, count: number) => string;
  cellLabel: (r: number, c: number) => string;
  sizeText: (count: number) => string;
  /** Why it can't be inserted yet, first thing first, each said on the box to fix. */
  problems: (cells: readonly (readonly string[])[], count: number) => CellProblem[];
  line: (name: string, cells: readonly (readonly string[])[], count: number) => string;
}

const named = (name: string, body: string): string => (name.trim() ? `${name.trim()} = ${body}` : body);

/** Quick-fill identity entries for a rows × cols matrix (1 on the diagonal, 0 elsewhere). */
export const matrixIdentity = (rows: number, cols: number): string[][] =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (r === c ? '1' : '0')));

/** One-tap square matrix sizes inside the Matrix Builder. */
export const MATRIX_SIZES = [2, 3, 4] as const;

/** One-tap vector dimensions inside the Vector Builder. */
export const VECTOR_SIZES = [2, 3, 4] as const;

/** Starter polygons for the shape builder so a user can tweak corners instead of typing from blank boxes. */
export const SHAPE_PRESETS: readonly { label: string; points: readonly [string, string][] }[] = [
  { label: 'Triangle', points: [['0', '0'], ['3', '0'], ['1.5', '2.5']] },
  { label: 'Square', points: [['0', '0'], ['2', '0'], ['2', '2'], ['0', '2']] },
  { label: 'Pentagon', points: [['0', '2'], ['1.9', '0.6'], ['1.2', '-1.6'], ['-1.2', '-1.6'], ['-1.9', '0.6']] },
];

/** Numeric (x, y) points parsed from the shape builder for live mini-plot preview. */
export function polygonPreviewPoints(cells: readonly (readonly string[])[], count: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let r = 0; r < count; r++) {
    const x = Number((cells[r]?.[0] ?? '').trim());
    const y = Number((cells[r]?.[1] ?? '').trim());
    if ((cells[r]?.[0] ?? '').trim() !== '' && (cells[r]?.[1] ?? '').trim() !== '' && Number.isFinite(x) && Number.isFinite(y)) {
      out.push({ x, y });
    }
  }
  return out;
}

/** Live Euclidean magnitude for the vector builder when every component is a plain finite number. */
export function vectorMagnitude(cells: readonly (readonly string[])[], count: number): number | null {
  let sum = 0;
  let any = false;
  for (let r = 0; r < count; r++) {
    const raw = (cells[r]?.[0] ?? '').trim();
    if (!raw) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    any = true;
    sum += n * n;
  }
  return any ? Math.sqrt(sum) : null;
}

const MATRIX_EDITOR: MatrixEditor = {
  size: { min: 1, max: 6, start: 2 },
  names: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  text: {
    title: 'New matrix',
    subtitle: 'Enter values cell by cell — blank cells become 0.',
    nameLabel: 'Matrix name',
    nameHint: 'Optional — reuse in formulas like det(A) or inv(A).',
    sizeLabel: 'Rows',
    action: 'Insert matrix',
    add: 'Add a row',
    remove: 'Remove a row',
  },
  columnText: { sizeLabel: 'Columns', add: 'Add a column', remove: 'Remove a column' },
  placeholder: '0',
  cellLabel: (r, c) => `Row ${r + 1}, column ${c + 1}`,
  sizeText: (rows, cols) => `${rows} × ${cols}`,
  line: (name, cells, rows, cols) => named(name, `[${cells.slice(0, rows).map((r) => `[${r.slice(0, cols).map((c) => c.trim() || '0').join(', ')}]`).join(', ')}]`),
};

const SHAPE_EDITOR: ListEditor = {
  size: { min: 2, max: 12, start: 3 },
  names: ['T', 'P', 'Q', 'R', 'S', 'U', 'V', 'W'],
  text: {
    title: 'New shape',
    subtitle: 'Enter (x, y) corners in order to plot a closed polygon.',
    nameLabel: 'Shape name',
    nameHint: 'Optional — transform later with rotation(90) * T.',
    sizeLabel: 'Points',
    action: 'Draw shape',
    add: 'Add a point',
    remove: 'Remove a point',
  },
  columns: 2,
  placeholder: (c) => (c ? 'y' : 'x'),
  heading: (r) => String(r + 1),
  cellLabel: (r, c) => `Point ${r + 1}, ${c ? 'y' : 'x'}`,
  sizeText: (count) => (count === 2 ? '2 points · segment' : count === 3 ? '3 points · triangle' : count === 4 ? '4 points · quad' : `${count} points`),
  problems(cells, count) {
    const out: CellProblem[] = [];
    const pts = cells.slice(0, count).map((p) => [p[0].trim(), p[1].trim()]);
    let full = 0;
    pts.forEach(([x, y], r) => {
      if (x && y) full++;
      else if (x || y) out.push({ r, c: x ? 1 : 0, message: 'Fill in both x and y, or leave this point empty.' });
    });
    if (full < 2) {
      const r = pts.findIndex(([x, y]) => !x || !y);
      if (r >= 0) out.push({ r, c: pts[r][0] ? 1 : 0, message: 'A shape needs at least 2 points.' });
    }
    return out;
  },
  line: (name, cells, count) => named(name, `polygon(${cells.slice(0, count).map(([x, y]) => [x.trim(), y.trim()]).filter(([x, y]) => x && y).map(([x, y]) => `(${x}, ${y})`).join(', ')})`),
};

const VECTOR_EDITOR: ListEditor = {
  size: { min: 2, max: 6, start: 2 },
  names: ['v', 'u', 'w', 'p', 'q', 'r', 's', 't'],
  text: {
    title: 'New vector',
    subtitle: 'Enter components along each axis — blank entries become 0.',
    nameLabel: 'Vector name',
    nameHint: 'Optional — reuse in mag(v) or dot(v, u).',
    sizeLabel: 'Dimensions',
    action: 'Insert vector',
    add: 'Add a component',
    remove: 'Remove a component',
  },
  columns: 1,
  placeholder: () => '0',
  heading: (r, count) => (count <= 3 ? 'xyz'[r] : String(r + 1)),
  cellLabel: (r) => `Component ${r + 1}`,
  sizeText: (count) => (count <= 3 ? `${count}D vector` : `${count} components`),
  problems: (cells, count) => (cells.slice(0, count).every(([v]) => !v.trim()) ? [{ r: 0, c: 0, message: 'Fill in at least one component.' }] : []),
  line: (name, cells, count) => named(name, `⟨${cells.slice(0, count).map(([v]) => v.trim() || '0').join(', ')}⟩`),
};

export const EDITORS = { matrix: MATRIX_EDITOR, shape: SHAPE_EDITOR, vector: VECTOR_EDITOR };

export type EditorKind = 'matrix' | 'shape' | 'vector' | 'calc' | 'normal' | 'data' | 'chance' | 'hvac';

export interface EditorTile { editor: EditorKind; mode?: string; face: string; name: string; label: string; title: string; wide?: boolean }

export const EDITOR_TILES: Record<EditorKind, EditorTile> = {
  matrix: { editor: 'matrix', face: 'Matrix builder…', name: '2×2, 3×3, up to 6×6', label: 'Build a matrix of any size up to 6 × 6', title: 'Open the visual Matrix Builder (2×2, 3×3, up to 6×6)', wide: true },
  shape: { editor: 'shape', face: 'Shape…', name: 'polygon builder', label: 'Build a polygon from corner points', title: 'Open the visual Polygon Builder with live preview' },
  vector: { editor: 'vector', face: 'Vector…', name: 'vector builder', label: 'Build a 2D to 6D vector', title: 'Open the visual Vector Builder with live magnitude' },
  calc: { editor: 'calc', face: 'Calculus builder…', name: '∫ · d/dx · Σ', label: 'Build an integral, derivative, or sum', title: 'Open the guided Calculus Builder with labeled inputs', wide: true },
  normal: { editor: 'normal', face: 'Normal…', name: 'curve builder', label: 'Build a normal probability or percentile', title: 'Open the guided Normal Curve Builder with live answer' },
  data: { editor: 'data', face: 'Data list…', name: 'list builder', label: 'Build a named data list with live stats', title: 'Open the Data List Builder with live mean and SD' },
  chance: { editor: 'chance', face: 'Chance…', name: 'prob builder', label: 'Build a binomial or Poisson probability', title: 'Open the guided Probability Builder with live answer' },
  hvac: { editor: 'hvac', face: 'HVAC…', name: 'guided builder', label: 'Build an HVAC calculation with labeled units', title: 'Open the guided HVAC Builder with unit labels' },
};
