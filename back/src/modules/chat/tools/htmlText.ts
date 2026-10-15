/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

/** Text extraction from HTML for the model: nothing is rendered or executed, tags are dropped. */

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[entity.toLowerCase()] ?? whole;
  });
}

/** `<title>` of a page, or ''. */
export function titleOf(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? collapse(decodeEntities(stripTags(match[1]))) : '';
}

/** Inline markup disappears without a trace (`<b>a</b>.` stays `a.`); block markup was turned into breaks before. */
const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '');
const collapse = (text: string): string => text.replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/**
 * The readable text of a page: scripts, styles, navigation and other chrome are removed first, block tags become line
 * breaks, the rest of the markup is dropped and entities decoded. Cut to `maxChars` (with a note) when longer.
 */
export function htmlToText(html: string, maxChars: number): { text: string; truncated: boolean } {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg|iframe|head|nav|footer|form|select|button)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article|\/header|\/pre|\/blockquote)\b[^>]*>/gi, '\n')
    .replace(/<\/(td|th)\s*>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n- ');
  const text = collapse(decodeEntities(stripTags(body)));
  return text.length > maxChars ? { text: `${text.slice(0, maxChars)}\n[… texte coupé]`, truncated: true } : { text, truncated: false };
}
