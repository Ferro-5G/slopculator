import { initOverlay } from './overlay';
import { initAgentapi, linesFromUrl } from './agentapi';
import { initCommands } from './commands';
import { buildMenu, initFile } from './file';
import { initGraphpane } from './graphpane';
import { fitKeyLabels, buildKeypad, initKeypad } from './keypad';
import { graph, listEl } from './layout';
import { initLineoutput } from './lineoutput';
import { initListscroll } from './listscroll';
import { initListtools } from './listtools';
import { initPride } from './pride';
import { rebuildRows, initRows } from './rows';
import { focusRow, views } from './rowviews';
import { fitBar, initSettings } from './settings';
import { connectScreen, doc, recompute } from './sheet';
import { renderResults } from './render';
import { applyUI, initShell } from './shell';
import { applyTheme, initTheme } from './theme';
import { initEdits } from './edits';
import { initThumb } from './thumb';
import { setSound } from './sound';

/**
 * Starts the app, synchronously. Modules only declare things when they load: elements, functions, tables, and the
 * sheet read from storage. Everything that reaches outside its module (the listeners on document and window, the bar's
 * assembly, the first render) runs here, in this order.
 */
export function boot(): void {
  connectScreen({ rebuildRows, renderResults, focusRow, inputOf: (id) => views.get(id)?.input });
  initOverlay();
  initListscroll();
  initGraphpane();
  initPride();
  initFile();
  initEdits();
  initSettings();
  initTheme();
  initShell();
  initListtools();
  initRows();
  initLineoutput();
  initKeypad();
  initThumb();
  initCommands();
  initAgentapi();
  // Canvas text can't use a web font until it has loaded, so the plot redraws once they have.
  void document.fonts.ready.then(() => { graph.refreshTheme(); fitKeyLabels(); fitBar(); });
  // A look's faces load when it's first chosen, after its refit: fold the bar again once they're in.
  document.fonts.addEventListener('loadingdone', () => fitBar());
  setSound(doc.ui.sound !== false);
  applyTheme();
  buildMenu();
  buildKeypad();
  applyUI();
  rebuildRows();
  recompute();
  linesFromUrl();
  requestAnimationFrame(() => focusRow(doc.rows[doc.rows.length - 1].id));

  const hintFirst = () => {
    const first = doc.rows[0];
    const v = views.get(first.id);
    if (v?.input) v.input.placeholder = doc.rows.length === 1 ? 'Type a calculation' : '';
  };
  hintFirst();
  new MutationObserver(hintFirst).observe(listEl, { childList: true });
}
