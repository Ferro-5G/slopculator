/**
 * The privacy policy: shown in the app, published at /privacy on a hosted copy, and kept as PRIVACY.md (a test holds
 * the three together). A paragraph may hold [text](https://link) links and nothing else.
 */
export const PRIVACY_UPDATED = '22 November 2026';
export const PRIVACY_INTRO = 'Slopculator runs directly in your browser. Your calculations, sheets, and graphs stay on your device, and there are no accounts, ads, or analytics.';
export const PRIVACY: { heading: string; paragraphs: string[] }[] = [
  {
    heading: 'Your data',
    paragraphs: [
      'Your sheets, history, and preferences are saved in your browser\'s local storage so they are still there when you come back. That data only leaves your device when you choose to copy something, export a sheet, or save a graph. Clearing site data in your browser removes it completely.',
    ],
  },
  {
    heading: 'How the app runs',
    paragraphs: [
      'All of the code and fonts are bundled into the page itself. Once loaded, Slopculator works offline without talking to a server. The standalone HTML file from GitHub works the same way straight from your computer.',
    ],
  },
  {
    heading: 'Website hosting',
    paragraphs: [
      'The website is hosted on Cloudflare Pages. Serving the page requires Cloudflare to handle basic connection details like your IP address, browser, and requested URL under Cloudflare\'s [privacy policy](https://www.cloudflare.com/privacypolicy/). We keep Cloudflare Web Analytics turned off and do not store visitor logs, so we only see broad traffic totals.',
      'Cloudflare may occasionally run a bot check that sets a cf_clearance cookie, and Cloudflare Pages sends a Network Error Logging header that asks your browser for a short report only if a connection fails. Cloudflare strips IP addresses from those reports.',
    ],
  },
  {
    heading: 'Source code and downloads',
    paragraphs: [
      'The repository and downloadable HTML builds are hosted on GitHub under GitHub\'s [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).',
    ],
  },
  {
    heading: 'Updates and questions',
    paragraphs: [
      'If this ever changes, we will update this page and its date before anything new is collected. If you have questions, open an issue on [GitHub](https://github.com/Ferro-5G/slopculator/issues).',
    ],
  },
];

export type PrivacyPart = { text: string; href?: string };
/** A paragraph cut into plain text and links. */
export function privacyParts(paragraph: string): PrivacyPart[] {
  const parts: PrivacyPart[] = [];
  let at = 0;
  for (const m of paragraph.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g)) {
    if (m.index > at) parts.push({ text: paragraph.slice(at, m.index) });
    parts.push({ text: m[1], href: m[2] });
    at = m.index + m[0].length;
  }
  if (at < paragraph.length) parts.push({ text: paragraph.slice(at) });
  return parts;
}

/** PRIVACY.md, word for word. */
export function privacyMarkdown(): string {
  return [
    '# Privacy',
    '',
    PRIVACY_INTRO,
    '',
    ...PRIVACY.flatMap(({ heading, paragraphs }) => [`## ${heading}`, '', ...paragraphs.flatMap((p) => [p, ''])]),
    `Last updated ${PRIVACY_UPDATED}.`,
    '',
  ].join('\n');
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const paragraphHtml = (p: string) =>
  privacyParts(p).map(({ text, href }) => (href ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : escapeHtml(text))).join('');

/** The policy as HTML, for the /privacy page of a hosted copy (site/privacy.html). */
export function privacyHtml(): string {
  const sections = PRIVACY.map(({ heading, paragraphs }) => [`<h2>${escapeHtml(heading)}</h2>`, ...paragraphs.map((p) => `<p>${paragraphHtml(p)}</p>`)]);
  return [`<p class="lead">${escapeHtml(PRIVACY_INTRO)}</p>`, ...sections.flat(), `<p class="updated">Last updated ${escapeHtml(PRIVACY_UPDATED)}.</p>`].join('\n');
}
