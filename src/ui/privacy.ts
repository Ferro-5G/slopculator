/**
 * The privacy policy: shown in the app, published at /privacy on a hosted copy, and kept as PRIVACY.md (a test holds
 * the three together). A paragraph may hold [text](https://link) links and nothing else.
 */
export const PRIVACY_UPDATED = '15 November 2026';
export const PRIVACY_INTRO = 'Slopculator collects nothing about you. It has no accounts, analytics, ads, cookies or tracking, and it never sends your calculations anywhere.';
export const PRIVACY: { heading: string; paragraphs: string[] }[] = [
  {
    heading: 'What stays on your device',
    paragraphs: [
      'Your lines, saved sheets, history and settings are kept in your browser\'s local storage, on your device. They leave it only when you export a file, copy, or share something yourself. Clearing this site\'s data in your browser deletes them.',
    ],
  },
  {
    heading: 'What the app sends',
    paragraphs: [
      'Nothing. Once the page has loaded it makes no network requests: no fonts, scripts or images from other sites. In a link that ends in #q=sqrt(2), the calculation sits after the #, and browsers never send that part to a server.',
    ],
  },
  {
    heading: 'Hosting',
    paragraphs: [
      'The website is served by Cloudflare. To deliver a page and block attacks, Cloudflare handles your IP address, your browser\'s name and the address you asked for, like any web host. Its [privacy policy](https://www.cloudflare.com/privacypolicy/) covers that data.',
      'We don\'t get a log of visitors, and Cloudflare\'s visitor analytics stays off. Cloudflare\'s dashboard shows us totals, such as how many requests came in and from which countries, but nothing about any one person.',
      'If Cloudflare decides a visit looks like an attack, it may show a check and set a cookie, cf_clearance, that records only that you passed it.',
    ],
  },
  {
    heading: 'Source code and downloads',
    paragraphs: [
      'The code and the downloadable file are on GitHub, which has its own [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement). The downloaded file works like the website: it makes no requests and keeps everything in the browser that opens it.',
    ],
  },
  {
    heading: 'Changes and questions',
    paragraphs: [
      'If this ever changes, this policy will say so, with a new date, before the app collects anything. Every past version is public in the repository.',
      'Questions go to [the issue tracker](https://github.com/Ferro-5G/slopculator/issues).',
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
