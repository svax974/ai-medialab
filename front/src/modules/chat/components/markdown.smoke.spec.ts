/**
 * Copyright (c) 2026 Stéphane VAXELAIRE
 * SPDX-License-Identifier: MIT
 */

// Server-side render of the Markdown renderer (the lazy chunk): what an answer may contain and what it may not.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const fr = vi.hoisted(() => ({ texts: {} as Record<string, string> }))
vi.mock('@/modules_shared/common/core/i18n/I18n', () => ({
  i18n: {
    get: (key: string, params?: (string | number)[]) => (fr.texts[key] ?? key).replace(/\{(\d+)\}/g, (_m, i) => String(params?.[Number(i)] ?? '')),
    getLang: () => 'fr',
    addEventListener: () => 0,
    removeEventListerner: () => undefined,
  },
}))

import { ThemeProvider } from '@mui/material/styles'
import { createChambreNoireTheme } from '@/themes/chambre-noire/muiTheme'
import MarkdownRenderer from './MarkdownRenderer'
import MathMarkdownRenderer from './MathMarkdownRenderer'

for (const dir of ['modules/chat', 'modules/studio-core', 'modules_shared/common']) {
  Object.assign(fr.texts, JSON.parse(readFileSync(resolve(__dirname, '../../../..', 'src', dir, 'locales/locales.fr.json'), 'utf8')))
}

const renderMath = (text: string) => renderToString(createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MathMarkdownRenderer, { text }))).replace(/<!-- -->/g, '')
const render = (text: string) => renderToString(createElement(ThemeProvider, { theme: createChambreNoireTheme('dark') }, createElement(MarkdownRenderer, { text }))).replace(/<!-- -->/g, '')

describe('MarkdownRenderer', () => {
  it('draws GitHub-flavoured Markdown: headings, emphasis, lists, task lists, tables, strikethrough', () => {
    const html = render('# Titre\n\nUn **gras**, un *italique* et ~~barré~~.\n\n- [x] fait\n- [ ] à faire\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    expect(html).toContain('<h1>Titre</h1>')
    expect(html).toContain('<strong>gras</strong>')
    expect(html).toContain('<del>barré</del>')
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*checked/)
    expect(html).toContain('<table')
    expect(html).toContain('<th')
  })

  it('colours fenced code of a known language, names it, and offers to copy it', () => {
    const html = render('```python\ndef f(x):\n    return x + 1\n```')
    expect(html).toContain('language-python')
    expect(html).toContain('class="hljs-keyword"')
    expect(html).toContain('>python<')
    expect(html).toContain('Copier')
  })

  it('leaves code of an unknown or missing language as plain text', () => {
    const html = render('```\nrien de spécial\n```')
    expect(html).toContain('rien de spécial')
    expect(html).not.toContain('class="hljs-')
    expect(html).toContain('>texte<')
  })

  it('never renders raw HTML or scripts', () => {
    const html = render('Avant <script>alert(1)</script> <img src=x onerror=alert(1)> <b>gras</b> après')
    // The tags come out as inert text (escaped), never as elements.
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('opens web links outside the app and drops unsafe ones', () => {
    const html = render('[site](https://example.org/a) et [piège](javascript:alert(1)) et [mail](mailto:a@b.c)')
    expect(html).toContain('href="https://example.org/a"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('piège')
  })

  it('blocks images from the network and offers to load them, showing the host', () => {
    const html = render('![suivi](https://tracker.example/pixel.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('Charger l&#x27;image (tracker.example)')
  })

  it('keeps inline code and block quotes', () => {
    const html = render('Utilise `npm test`.\n\n> citation')
    expect(html).toContain('<code>npm test</code>')
    expect(html).toContain('<blockquote>')
  })
})

describe('MathMarkdownRenderer', () => {
  it('draws formulas with KaTeX: inline, in a block, and the \\( \\) and $ forms models write', () => {
    expect(renderMath('Soit $$x^2$$ positif')).toContain('class="katex"')
    expect(renderMath('Soit \\(x^2\\) positif')).toContain('class="katex"')
    expect(renderMath('Soit $x^2$ positif')).toContain('class="katex"')
    expect(renderMath('Alors :\n\\[ E = mc^2 \\]')).toContain('katex-display')
  })

  it('keeps prices as text and code as code', () => {
    const html = renderMath('Cela coûte $5 et $6.\n\n```js\nconst s = "$x$"\n```')
    expect(html).not.toContain('class="katex"')
    expect(html).toContain('coûte $5 et $6')
  })

  it('is safe: no link or image from a formula, a bad formula does not break the answer, raw HTML stays text', () => {
    const links = renderMath('$$\\href{javascript:alert(1)}{clic}$$')
    expect(links).not.toMatch(/<a[\s>]/)
    expect(links).not.toContain('href=')
    expect(links).toContain('katex') // drawn as an error (the formula text), never as a link
    expect(renderMath('$$\\includegraphics{http://evil.example/x.png}$$')).not.toMatch(/<img[\s>]/)
    expect(renderMath('Avant $$\\frac{1}{$$ après')).toContain('après')
    expect(renderMath('$$a$$ <img src=x onerror=alert(1)>')).not.toMatch(/<img[\s>]/)
  })
})
