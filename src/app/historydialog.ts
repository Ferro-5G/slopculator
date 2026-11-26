import { downloadBlob, fileDate } from './download';
import { type HistoryEntry, searchHistory, dayLabel, entryTime, removeEntry } from '../ui/history';
import { h } from './dom';
import { commitRow, insertLine } from './edits';
import { dialogShell } from './overlay';
import { loadHistory, changeHistory } from './persistence';
import { activeId } from './sheet';

function exportHistory(): void {
  downloadBlob(new Blob([JSON.stringify(loadHistory(), null, 2)], { type: 'application/json' }), `slopculator-history-${fileDate()}.json`);
}
export function openHistoryDialog(): void {
  commitRow(activeId);
  const PAGE = 200;
  let limit = PAGE;
  const search = h('input', { class: 'text', type: 'search', placeholder: 'Search expressions and answers', 'aria-label': 'Search history', spellcheck: 'false', autocomplete: 'off' });
  const listBox = h('div', { class: 'sheet-list history-list' });
  const clear = h('button', { type: 'button', class: 'history-clear' }, 'Clear history…');
  const exportBtn = h('button', { type: 'button' }, 'Export');
  const dialog = dialogShell(
    'History',
    search,
    listBox,
    h('div', { class: 'mx-actions' }, clear, exportBtn, h('button', { type: 'submit', value: 'cancel' }, 'Close')),
  );
  dialog.classList.add('history-dialog');
  const use = (text: string) => {
    dialog.close();
    insertLine(text);
  };
  let first: HistoryEntry | undefined;
  const draw = () => {
    const all = loadHistory();
    const found = searchHistory(all, search.value);
    first = found[0];
    clear.disabled = !all.length;
    if (!found.length) {
      listBox.replaceChildren(h('p', { class: 'muted' }, all.length ? 'No matches.' : 'No history yet.'));
      return;
    }
    const parts: HTMLElement[] = [];
    let day = '';
    for (const e of found.slice(0, limit)) {
      const label = dayLabel(e.at);
      if (label !== day) {
        day = label;
        parts.push(h('div', { class: 'history-day' }, label));
      }
      const open = h('button', { type: 'button', class: 'sheet-open history-open' },
        h('span', { class: 'history-text' }, e.text),
        h('span', { class: 'sheet-meta' }, entryTime(e.at), e.sheet ? ` · ${e.sheet}` : ''));
      open.addEventListener('click', () => use(e.text));
      const del = h('button', { type: 'button', class: 'sheet-del', title: 'Remove from history', 'aria-label': `Remove ${e.text} from history` }, '×');
      del.addEventListener('click', () => {
        changeHistory((list) => removeEntry(list, e));
        draw();
      });
      const row: HTMLElement[] = [open];
      if (e.result) {
        const answer = h('button', { type: 'button', class: 'history-result' }, `= ${e.result}`);
        answer.addEventListener('click', () => use(e.result));
        row.push(answer);
      }
      parts.push(h('div', { class: 'sheet-item' }, ...row, del));
    }
    if (found.length > limit) {
      const more = h('button', { type: 'button', class: 'history-more' }, `Show more (${found.length - limit} left)`);
      more.addEventListener('click', () => {
        limit += PAGE;
        draw();
      });
      parts.push(more);
    }
    listBox.replaceChildren(...parts);
  };
  search.addEventListener('input', () => {
    limit = PAGE;
    draw();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (first) use(first.text);
  });
  exportBtn.addEventListener('click', exportHistory);
  clear.addEventListener('click', () => {
    if (clear.dataset.armed) {
      delete clear.dataset.armed;
      clear.textContent = 'Clear history…';
      changeHistory(() => []);
      draw();
      return;
    }
    clear.dataset.armed = '1';
    clear.textContent = `Delete all ${loadHistory().length}? This can't be undone`;
  });
  draw();
  dialog.showModal();
  search.focus();
}
