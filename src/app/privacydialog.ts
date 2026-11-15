import { h } from './dom';
import { mountDialog } from './overlay';
import { PRIVACY, PRIVACY_INTRO, PRIVACY_UPDATED, privacyParts } from '../ui/privacy';

export function showPrivacy(): void {
  const paragraph = (p: string) =>
    h('p', {}, ...privacyParts(p).map(({ text, href }) => (href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text) : text)));
  const dialog = h('dialog', { class: 'privacy' },
    h('form', { method: 'dialog' },
      // Focus lands on the title, so the dialog opens at the top instead of scrolled to Close.
      h('h1', { tabindex: '-1', autofocus: true }, 'Privacy'),
      h('p', {}, PRIVACY_INTRO),
      ...PRIVACY.flatMap(({ heading, paragraphs }) => [h('h2', {}, heading), ...paragraphs.map(paragraph)]),
      h('p', { class: 'muted' }, `Last updated ${PRIVACY_UPDATED}.`),
      h('div', { class: 'mx-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Close')),
    ),
  );
  mountDialog(dialog);
  dialog.showModal();
}
