import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { privacyHtml, privacyMarkdown, privacyParts } from '../src/ui/privacy';

describe('privacy policy', () => {
  it('PRIVACY.md is the text the app shows', () => {
    // Rewrite it with: node -e "import('./src/ui/privacy.ts').then(m=>require('fs').writeFileSync('PRIVACY.md', m.privacyMarkdown()))"
    expect(readFileSync('PRIVACY.md', 'utf8').replace(/\r\n/g, '\n')).toBe(privacyMarkdown());
  });

  it('cuts a paragraph into text and links', () => {
    expect(privacyParts('See [the policy](https://example.com/p) now.')).toEqual([
      { text: 'See ' }, { text: 'the policy', href: 'https://example.com/p' }, { text: ' now.' },
    ]);
    expect(privacyParts('[only](https://a.b)')).toEqual([{ text: 'only', href: 'https://a.b' }]);
    expect(privacyParts('No [link](http://plain.example) here')).toEqual([{ text: 'No [link](http://plain.example) here' }]);
  });

  it('the hosted page escapes its text and keeps its links', () => {
    const html = privacyHtml();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain("browser's local storage");
    expect(html).toContain('<a href="https://www.cloudflare.com/privacypolicy/">privacy policy</a>');
    expect(html).toMatch(/^<p class="lead">/);
  });
});
