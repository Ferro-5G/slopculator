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
  return name && !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) ? 'A name starts with a letter and has no spaces.'
    : used.has(name) ? `${name} is already used on another line. Pick another name, or clear this to leave it unnamed.` : '';
}

export interface CellProblem { r: number; c: number; message: string }

export interface EditorText { title: string; nameLabel: string; nameHint: string; sizeLabel: string; action: string; add: string; remove: string }

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

const MATRIX_EDITOR: MatrixEditor = {
  size: { min: 1, max: 6, start: 2 },
  names: [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'],
  text: { title: 'New matrix', nameLabel: 'Matrix name', nameHint: 'Leave the name empty to insert just the matrix.', sizeLabel: 'Rows', action: 'Insert', add: 'Add a row', remove: 'Remove a row' },
  columnText: { sizeLabel: 'Columns', add: 'Add a column', remove: 'Remove a column' },
  placeholder: '0',
  cellLabel: (r, c) => `Row ${r + 1}, column ${c + 1}`,
  sizeText: (rows, cols) => `${rows} × ${cols}`,
  line: (name, cells, rows, cols) => named(name, `[${cells.slice(0, rows).map((r) => `[${r.slice(0, cols).map((c) => c.trim() || '0').join(', ')}]`).join(', ')}]`),
};

const SHAPE_EDITOR: ListEditor = {
  size: { min: 2, max: 12, start: 3 },
  names: ['T', 'P', 'Q', 'R', 'S', 'U', 'V', 'W'],
  text: { title: 'New shape', nameLabel: 'Shape name', nameHint: 'Name it to turn it later: rotation(90) * T.', sizeLabel: 'Points', action: 'Draw', add: 'Add a point', remove: 'Remove a point' },
  columns: 2,
  placeholder: (c) => (c ? 'y' : 'x'),
  heading: (r) => String(r + 1),
  cellLabel: (r, c) => `Point ${r + 1}, ${c ? 'y' : 'x'}`,
  sizeText: (count) => (count === 3 ? '3 points: a triangle' : `${count} points`),
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
  text: { title: 'New vector', nameLabel: 'Vector name', nameHint: 'Name it to use it later: mag(v).', sizeLabel: 'Components', action: 'Insert', add: 'Add a component', remove: 'Remove a component' },
  columns: 1,
  placeholder: () => '0',
  heading: (r, count) => (count <= 3 ? 'xyz'[r] : String(r + 1)),
  cellLabel: (r) => `Component ${r + 1}`,
  sizeText: (count) => `${count} components`,
  problems: (cells, count) => (cells.slice(0, count).every(([v]) => !v.trim()) ? [{ r: 0, c: 0, message: 'Fill in at least one component.' }] : []),
  line: (name, cells, count) => named(name, `⟨${cells.slice(0, count).map(([v]) => v.trim() || '0').join(', ')}⟩`),
};

export const EDITORS = { matrix: MATRIX_EDITOR, shape: SHAPE_EDITOR, vector: VECTOR_EDITOR };

export interface EditorTile { editor: 'matrix' | 'shape' | 'vector'; face: string; name: string; label: string; title: string; wide?: boolean }

export const EDITOR_TILES: Record<EditorTile['editor'], EditorTile> = {
  matrix: { editor: 'matrix', face: 'Any size…', name: 'grid editor', label: 'Any size of matrix, in a grid editor', title: 'Fill in a grid of up to 6 × 6, with a name', wide: true },
  shape: { editor: 'shape', face: 'Shape…', name: 'point editor', label: 'Draw a triangle or other shape from its points', title: 'Fill in each corner, x and y' },
  vector: { editor: 'vector', face: 'Vector…', name: 'grid editor', label: 'A vector, in a grid editor', title: 'Fill in each component, with a name' },
};
