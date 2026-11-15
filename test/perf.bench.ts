import { evaluateDocument, type RowInput } from '../src/engine/document';
const lines = ['μ = 400', 'σ = 50', 'normalcdf(350, 500, μ, σ)', 'invNorm(0.975, μ, σ)', 'zscore(180, 280, 40)', 'L = {2,4,4,4,5,5,7,9}', 'sdp(L)', 'mean(L)',
  'binomcdf(20, 0.3, 7)', 'nCr(52, 5)', 'det([[1,2,3],[4,5,6],[7,8,10]])', 'inv([[1,2],[3,4]])', 'y = a sin(b(x - c)) + d', 'a = 2', 'b = 3', 'c = 1', 'd = 0',
  'x^2 + y^2 = 25', 'y > x^2 - 4', 'f(x) = x^3 - 3x', 'sum(n^2, n, 1, 100)', 'compound(1000, 0.05, 12, 10)', 'normaldist(μ, σ)', 'sin(30)', 'log_2(1024)'];
const rows: RowInput[] = lines.map((text, i) => ({ id: String(i), kind: 'expr', text }));
const S = { deg: true, complex: false, sample: false };
for (let k = 0; k < 200; k++) evaluateDocument(rows, S);
let t = performance.now();
const N = 2000;
for (let k = 0; k < N; k++) evaluateDocument(rows, S);
const perDoc = (performance.now() - t) / N;
const res = evaluateDocument(rows, S);
const fx = res[12].graph[0] as { f: (x: number) => number };
const imp = res[17].graph[0] as { f: (x: number, y: number) => number };
t = performance.now();
let acc = 0;
for (let k = 0; k < 1e6; k++) acc += fx.f(k * 1e-4);
const fxNs = (performance.now() - t);
t = performance.now();
for (let k = 0; k < 1e6; k++) acc += imp.f(k * 1e-5, 1);
const impNs = (performance.now() - t);
console.log(`whole ${lines.length}-line sheet: ${(perDoc * 1000).toFixed(0)} µs per keystroke`);
console.log(`y = a sin(b(x-c)) + d: ${fxNs.toFixed(0)} ns per sample`);
console.log(`x^2 + y^2 = 25: ${impNs.toFixed(0)} ns per sample`, acc > 0 ? '' : ' ');
