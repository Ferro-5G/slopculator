/**
 * The privacy policy: shown in the app, published at /privacy on a hosted copy, and kept as PRIVACY.md (a test holds
 * the three together). A paragraph may hold [text](https://link) links and nothing else.
 */
export const PRIVACY_UPDATED = '21 November 2026';
export const PRIVACY_INTRO = 'Slopculator collects nothing about you. The app itself has no accounts, analytics, ads, cookies or tracking, and it never sends your calculations anywhere.';
export const PRIVACY: { heading: string; paragraphs: string[] }[] = [
  {
    heading: 'What stays on your device',
    paragraphs: [
      'Your lines, saved sheets, history and settings are stored only in your browser\'s local storage on your device. They leave your device only when you export a file, copy, or share something yourself. Clearing this site\'s data in your browser deletes them.',
    ],
  },
  {
    heading: 'What the app sends',
    paragraphs: [
      'Nothing. Once the page loads, the app makes no network requests — no external fonts, scripts or images, and its Content Security Policy sets connect-src \'none\'. In a link ending in #q=sqrt(2), the calculation sits after the # fragment, which browsers do not send to a server.',
    ],
  },
  {
    heading: 'Hosting',
    paragraphs: [
      'The website is hosted on Cloudflare Pages. To serve pages and mitigate abuse, Cloudflare processes your IP address, user-agent string and requested URL, as any web host does. Cloudflare\'s [privacy policy](https://www.cloudflare.com/privacypolicy/) covers that processing.',
      'We do not collect visitor logs, and Cloudflare Web Analytics is off. Cloudflare\'s dashboard shows aggregate totals (such as request counts and countries), not individual visitors.',
      'If Cloudflare flags a visit as suspicious, it may show a challenge and set a strictly necessary cookie (cf_clearance) recording that you passed it.',
      'Cloudflare Pages sends Network Error Logging (NEL) headers with success_fraction set to 0.0, so your browser may send Cloudflare a short report only if a connection fails, never on normal page loads. Cloudflare states that it strips IP addresses from NEL reports.',
    ],
  },
  {
    heading: 'Source code and downloads',
    paragraphs: [
      'The source code and downloadable single-file HTML releases are hosted on GitHub, under GitHub\'s [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement). The downloaded file runs offline in your browser and makes no network requests.',
    ],
  },
  {
    heading: 'Changes and questions',
    paragraphs: [
      'If this ever changes, this policy will be updated with a new date before anything is collected. Every past version is public in the repository.',
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
