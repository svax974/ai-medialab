/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, it } from '@jest/globals';
import { decodeEntities, htmlToText, titleOf } from './htmlText';

describe('htmlToText', () => {
  const page = `<!doctype html><html><head><title>Notes &amp; versions</title><style>p{color:red}</style><script>alert('x')</script></head>
    <body><nav><a href="/">Accueil</a></nav><h1>Titre</h1><p>Premier&nbsp;paragraphe avec <b>gras</b>.</p><ul><li>un</li><li>deux</li></ul>
    <!-- commentaire --><script>document.write('piège')</script><footer>pied</footer><p>Fin &eacute;t&#233; &#x41;</p></body></html>`;

  it('keeps the readable text, drops scripts, styles, navigation and comments', () => {
    const { text } = htmlToText(page, 10_000);
    expect(text).toContain('Titre');
    expect(text).toContain('Premier paragraphe avec gras.');
    expect(text).toContain('- un');
    expect(text).toContain('- deux');
    expect(text).toContain('Fin été A');
    for (const gone of ['alert', 'color:red', 'Accueil', 'commentaire', 'piège', 'pied', '<', '>']) expect(text).not.toContain(gone);
  });

  it('cuts a long page with a note', () => {
    const { text, truncated } = htmlToText(`<p>${'mot '.repeat(5000)}</p>`, 100);
    expect(truncated).toBe(true);
    expect(text.endsWith('[… texte coupé]')).toBe(true);
    expect(text.length).toBeLessThan(130);
  });

  it('reads the title', () => {
    expect(titleOf(page)).toBe('Notes & versions');
    expect(titleOf('<p>rien</p>')).toBe('');
  });

  it('decodes entities and leaves unknown ones alone', () => {
    expect(decodeEntities('&lt;a&gt; &quot;x&quot; &#8364; &unknown; &#0; &#1114112;')).toBe('<a> "x" € &unknown; &#0; &#1114112;');
  });
});
