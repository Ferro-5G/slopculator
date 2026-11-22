// Readout ports, shared by every front end. A block with several results (a moist-air state's Tdp, W and h; a list's
// n, x̄, s and median; a fit's slope, intercept and R²) has a port per result, and a line that reads one result
// (A.h, mean(data), m) is wired from that result's port rather than from the block as a whole. This decides which rows
// have ports, which port a read goes to, and the number each port carries. No DOM here.
import { parse, type Node } from '../engine/parser';
import { isFitNode } from '../engine/regress';
import { listSummary } from '../engine/builtins';
import type { RowInput, RowResult } from '../engine/document';
import type { RecordV, Value } from '../engine/values';

/** What kind of results a row's ports read: a moist-air state, a list of numbers, a fit (y1 ~ m x1 + b), or linreg. */
export type PortKind = 'air' | 'list' | 'fit' | 'linreg';
export interface RowPorts { kind: PortKind; ports: string[] }

/** The least numbers a list needs to be a stats block, with its histogram and ports. */
export const STATS_MIN = 4;
/** A moist-air state's ports, in the order its readouts show them. */
export const AIR_PORTS = ['Tdp', 'W', 'h'] as const;
export const LIST_PORTS = ['n', 'mean', 's', 'median'] as const;
/** A fit's R², by the key its record gives it. */
export const R2_PORT = 'R2';

/** The functions of a list that read one of its ports: mean(data) and data.mean read x̄. */
export const LIST_FNS: Readonly<Record<string, string>> = { mean: 'mean', avg: 'mean', average: 'mean', stdev: 's', sds: 's', sd_s: 's', median: 'median', len: 'n', length: 'n' };
/** Fields a moist-air state answers to through a port: W in g/kg or grains reads the W port too. */
const AIR_ALIAS: Readonly<Record<string, string>> = { g: 'W', gr: 'W' };

function tree(text: string): Node | null {
  try {
    return parse(text);
  } catch {
    return null;
  }
}

const isRecord = (v: Value | undefined): v is RecordV => typeof v === 'object' && v.t === 'record';

/** The numbers of a list or [ ] list, when it is one of real numbers; else null. */
export function listNumbers(v: Value | undefined): number[] | null {
  if (typeof v !== 'object') return null;
  const items: Value[] = v.t === 'list' ? v.items : v.t === 'vector' ? v.c : [];
  if (!items.length || !items.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return items as number[];
}

/** Whether a line is a regression, y1 ~ m x1 + b. */
export function isFitLine(text: string): boolean {
  const n = tree(text);
  return !!n && isFitNode(n);
}

/** A fit's unknowns, in order (its record's rows other than R²). */
export const fitParams = (v: RecordV): string[] => v.rows.filter((r) => r.key !== R2_PORT && typeof r.value === 'number').map((r) => r.label);

/** The ports a row has, or null for a row with one result (or none). */
export function rowPorts(row: RowInput, result: RowResult | undefined): RowPorts | null {
  if (row.kind !== 'expr' || !result || result.error || result.slider || result.value === undefined) return null;
  const v = result.value;
  if (isRecord(v)) {
    if (v.kind === 'air') return { kind: 'air', ports: [...AIR_PORTS] };
    if (isFitLine(row.text)) return { kind: 'fit', ports: [...fitParams(v), ...(v.rows.some((r) => r.key === R2_PORT) ? [R2_PORT] : [])] };
    if (v.title.startsWith('Linear regression')) return { kind: 'linreg', ports: v.rows.filter((r) => r.label === 'a' || r.label === 'b' || r.key === 'r2').map((r) => r.key ?? r.label) };
    return null;
  }
  const xs = listNumbers(v);
  if (xs && xs.length >= STATS_MIN) return { kind: 'list', ports: xs.length > 1 ? [...LIST_PORTS] : LIST_PORTS.filter((p) => p !== 's') };
  return null;
}

/** The port a field read goes to (A.h, A.tdp, A.g, L.a), or null when the field has no port of its own. */
function fieldPort(p: RowPorts, v: RecordV | null, field: string): string | null {
  if (p.kind === 'list') return LIST_FNS[field] ?? null;
  if (!v) return null;
  const row = v.rows.find((r) => r.key === field) ?? v.rows.find((r) => r.label === field) ?? v.rows.find((r) => r.key !== undefined && r.key.toLowerCase() === field.toLowerCase());
  const key = row ? (row.key ?? row.label) : null;
  if (!key) return null;
  const port = p.kind === 'air' ? AIR_ALIAS[key] ?? key : key;
  return p.ports.includes(port) ? port : null;
}

/** Where a row that defines a name is, as the wires see it. */
export interface Definer { row: RowInput; result: RowResult | undefined }

/** A read of one result: the name read, and the port it reads. */
export interface PortRead { name: string; port: string }

/**
 * The results a line reads through ports, and how many of its mentions of each name they account for (`consumed`,
 * against `mentions`): a name every mention of which goes through a port needs no wire from its block as a whole. A
 * field after a dot that is no function of the sheet's (the h of A.h) is listed in `fields`, since it's no name read.
 */
export function portReads(n: Node, definer: (name: string) => Definer | null, isSheetFunction: (name: string) => boolean = () => false): { reads: PortRead[]; consumed: Map<string, number>; mentions: Map<string, number>; fields: Set<string> } {
  const reads: PortRead[] = [];
  const consumed = new Map<string, number>(), mentions = new Map<string, number>();
  const fields = new Set<string>();
  const seen = new Set<string>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const add = (name: string, port: string) => {
    bump(consumed, name);
    const key = `${name}.${port}`;
    if (!seen.has(key)) { seen.add(key); reads.push({ name, port }); }
  };
  const visit = (m: Node) => {
    if (m.k === 'id') {
      bump(mentions, m.name);
      const d = definer(m.name);
      const p = d && rowPorts(d.row, d.result);
      if (p?.kind === 'fit' && p.ports.includes(m.name)) add(m.name, m.name);
      return;
    }
    if (m.k === 'call' && m.args.length === 1 && m.args[0].k === 'id' && !m.base) {
      const base = m.args[0].name;
      const d = definer(base);
      const p = d && rowPorts(d.row, d.result);
      const port = p && (m.dot ? fieldPort(p, isRecord(d.result?.value) ? d.result!.value as RecordV : null, m.name) : p.kind === 'list' && !isSheetFunction(m.name) ? LIST_FNS[m.name] ?? null : null);
      if (m.dot && (port || !isSheetFunction(m.name))) fields.add(m.name);
      bump(mentions, base);
      if (port) add(base, port);
      return;
    }
    if (m.k === 'call' && m.dot && m.args.length === 1 && !isSheetFunction(m.name)) fields.add(m.name);
    for (const c of childrenOf(m)) visit(c);
  };
  visit(n);
  return { reads, consumed, mentions, fields };
}

function childrenOf(n: Node): Node[] {
  switch (n.k) {
    case 'num': case 'str': case 'id': return [];
    case 'un': case 'post': case 'abs': return [n.a];
    case 'bin': return [n.a, n.b];
    case 'call': return n.base ? [n.base, ...n.args] : n.args;
    case 'point': case 'vec': case 'bracket': case 'list': case 'rel': return n.items;
    case 'piece': return n.branches.flatMap((b) => [...(b.cond ? [b.cond] : []), ...(b.val ? [b.val] : [])]);
  }
}

/** The number a port carries: the result its wire takes to the line that reads it (A.h's enthalpy, the list's mean). */
export function portValue(row: RowInput, result: RowResult | undefined, port: string): number | undefined {
  const p = rowPorts(row, result);
  if (!p || !p.ports.includes(port)) return undefined;
  const v = result!.value!;
  if (p.kind === 'list') {
    const s = listSummary(listNumbers(v)!);
    const out = port === 'n' ? s.n : port === 'mean' ? s.mean : port === 's' ? s.s : s.median;
    return out ?? undefined;
  }
  if (!isRecord(v)) return undefined;
  const r = v.rows.find((x) => (x.key ?? x.label) === port);
  return typeof r?.value === 'number' ? r.value : undefined;
}

/** The ports of a block that no wire leaves from: they show as small hollow dots. */
export function unusedPorts(id: string, ports: readonly string[], wires: readonly { from: string; fromPort?: string }[]): string[] {
  const used = new Set(wires.filter((w) => w.from === id && w.fromPort).map((w) => w.fromPort!));
  return ports.filter((p) => !used.has(p));
}

/** A port's name on its wire's tag: A.h, data's x̄, m. */
export function portTagName(name: string, kind: PortKind | null, port: string): string {
  if (kind === 'list') return { n: `n(${name})`, mean: `x̄(${name})`, s: `s(${name})`, median: `median(${name})` }[port] ?? name;
  if (kind === 'fit') return port === R2_PORT ? 'R²' : port;
  return `${name}.${port === 'r2' ? 'r²' : port}`;
}

/** The runnable expression that reads a block's port, for inserting when a port dot is clicked. */
export function portExpr(name: string, kind: PortKind | null, port: string): string {
  if (kind === 'list') return { n: `len(${name})`, mean: `mean(${name})`, s: `stdev(${name})`, median: `median(${name})` }[port] ?? name;
  if (kind === 'fit') return port === R2_PORT ? '' : port;
  return name ? `${name}.${port}` : '';
}
