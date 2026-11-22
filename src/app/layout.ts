import { Graph } from './graph';
import { h } from './dom';

// The canvas sheet: the top bar, then one stage that holds the canvas (the tape, whose list is the canvas's world on a
// wide window and a column on a narrow one), the composer docked at its foot, and the keypad. The graph is a block on
// the canvas (src/app/canvas.ts puts graphPane there); the splitter and the phone's Calculate | Graph switch are gone.
export const app = document.getElementById('app')!;
app.classList.add('canvas-ui');
export const modeBar = h('header', { class: 'modebar' });
export const listEl = h('div', { class: 'rows', role: 'list', 'data-scroll': 'rest' });
export const listTools = h('div', { class: 'list-tools' });
export const coverTop = h('div', { class: 'edge-cover top', 'aria-hidden': 'true' });
export const coverBottom = h('div', { class: 'edge-cover bottom', 'aria-hidden': 'true' });
export const keypadEl = h('section', { class: 'keypad', id: 'keypad' });
/** The canvas's viewport: it clips the world and takes the pan and zoom gestures. */
export const tape = h('div', { class: 'tape cv-viewport' }, listEl, coverTop, coverBottom);
/** Desktop sidebar header: quiet section title and line count. */
export const railCount = h('span', { class: 'rail-count', 'aria-hidden': 'true' }, '0');
export const railHead = h('div', { class: 'rail-head' },
  h('span', { class: 'rail-title' }, 'Sheet'),
  railCount,
);
/** Desktop sidebar outliner: ordered sent lines directly above the composer. */
export const railList = h('div', { class: 'rail-list', role: 'list', 'aria-label': 'Sheet lines' });
/** Where the composer docks; src/app/composer.ts fills it. */
export const composerDock = h('div', { class: 'composer-dock' });
/** On desktop, the unified Liquid Glass sidebar fusing sheet lines, composer, and collapsible keypad; transparent on phone. */
export const deskRail = h('aside', { class: 'desk-rail', 'aria-label': 'Sheet and controls' }, railHead, railList, composerDock, keypadEl);
export const leftPane = h('div', { class: 'left' }, modeBar, tape, deskRail);
export const graphHost = h('div', { class: 'graph-host' });
export const graphTools = h('div', { class: 'graph-tools' });
export const graphChips = h('div', { class: 'graph-chips', role: 'toolbar', 'aria-label': 'Plotted lines', hidden: true });
export const marksHint = h('div', { class: 'marks-hint', 'aria-hidden': 'true' }, h('kbd', {}, '['), ' ', h('kbd', {}, ']'), ' step through points');
export const graphSliders = h('div', { class: 'graph-sliders', role: 'group', 'aria-label': 'Sliders', hidden: true });
/** What sits over or under the plot. On a phone it floats, and the graph is told how much it covers. */
export const graphDock = h('div', { class: 'graph-dock' }, graphChips, graphSliders, graphTools);
/** The graph block: a full-width drag header bar, the plot beneath it, its tools, and a corner to resize it by. */
export const graphUnpin = h('button', {
  type: 'button',
  class: 'blk-unpin',
  title: 'Return graph to automatic layout',
  'aria-label': 'Reset graph position and size',
  hidden: true,
}, 'Auto');
export const graphGrip = h('div', { class: 'blk-grip', title: 'Drag to move graph · Double-click to reset layout' },
  h('span', { class: 'blk-grip-dots', 'aria-hidden': 'true' }),
  h('span', { class: 'blk-grip-title', 'aria-hidden': 'true' }, 'Graph'),
  graphUnpin,
);
export const graphResize = h('div', { class: 'blk-resize', title: 'Drag to resize graph · Double-click to reset size', 'aria-hidden': 'true' });
export const graphPane = h('section', { class: 'graph-pane blk blk-graph', 'aria-label': 'Graph' }, graphGrip, graphHost, graphDock, marksHint, graphResize);
export const splitter = h('div', { class: 'splitter', role: 'separator', 'aria-orientation': 'vertical', title: 'Drag to resize', hidden: true });
export const main = h('main', { class: 'main' }, leftPane);
export const toast = h('div', { class: 'toast', role: 'status' });
toast.inert = true;
export const mobileNav = h('nav', { class: 'mobile-nav', 'aria-label': 'View', hidden: true });
app.append(main, toast);
// The blocks name the curves (each line's rail is its curve's color), so the plot draws no names over them, at any width.
export const graph = new Graph(graphHost, () => true);
/** The example's own small graph, in its frame: only the example's curves draw on it. */
export const exampleGraphHost = h('div', { class: 'example-graph-host' });
export const exampleGraphPane = h('section', { class: 'blk-example-graph', 'aria-label': 'Example graph' }, exampleGraphHost);
export const exampleGraph = new Graph(exampleGraphHost, () => true);
exampleGraph.canvas.className = 'example-graph-canvas';
export const announcer = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
app.append(announcer);
