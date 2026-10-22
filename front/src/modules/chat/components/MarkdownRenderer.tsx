/**
 * Copyright (c) 2026 Stéphane Vaxelaire - Web3c
 * SPDX-License-Identifier: MIT
 */

import { memo, useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { Box, Button } from '@mui/material'
import CheckRounded from '@mui/icons-material/CheckRounded'
import ContentCopyOutlined from '@mui/icons-material/ContentCopyOutlined'
import ImageOutlined from '@mui/icons-material/ImageOutlined'
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded'
import { copyText } from '@/modules/studio-core/lib/clipboard'
import { useT } from '@/modules/studio-shell/hooks/useT'
import { hostOf, isRemoteImage, isSafeHref } from '../lib/markdownSafety'

/** The languages the code blocks colour (the common ones: a small subset of highlight.js keeps this chunk light). */
const LANGUAGES = { bash, c, cpp, csharp, css, diff, dockerfile, go, java, javascript, json, kotlin, markdown, php, python, ruby, rust, sql, swift, typescript, xml, yaml }
const ALIASES = { bash: ['sh', 'shell', 'zsh'], javascript: ['js', 'jsx', 'mjs'], typescript: ['ts', 'tsx'], python: ['py'], xml: ['html', 'svg'], yaml: ['yml'], csharp: ['cs'], cpp: ['c++', 'hpp'], markdown: ['md'], dockerfile: ['docker'] }

const REMARK = [remarkGfm]
const REHYPE = [[rehypeHighlight, { languages: LANGUAGES, aliases: ALIASES, detect: false }]] as never

function languageOf(className: string | undefined): string {
  const match = /language-([\w+#-]+)/.exec(className ?? '')
  return match ? match[1] : ''
}

/** A fenced block: language and a copy button above the coloured code. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useT()
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const language = languageOf((children as { props?: { className?: string } } | undefined)?.props?.className)
  const copy = () => {
    copyText(ref.current?.textContent ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Box sx={{ my: 1.5, overflow: 'hidden', borderRadius: '12px', border: '1px solid var(--line)', backgroundColor: 'var(--bg-elev)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', backgroundColor: 'var(--surface-2)', px: 1.5, py: '2px' }}>
        <Box component="span" sx={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{language || t('chat.code.plain')}</Box>
        <Button size="small" color="inherit" onClick={copy} startIcon={copied ? <CheckRounded sx={{ fontSize: 14, color: 'var(--ok)' }} /> : <ContentCopyOutlined sx={{ fontSize: 14 }} />} sx={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {t(copied ? 'chat.code.copied' : 'chat.code.copy')}
        </Button>
      </Box>
      <Box ref={ref} component="pre" sx={{ m: 0, overflowX: 'auto', p: 1.5, fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>
        {children}
      </Box>
    </Box>
  )
}

/** An image of the answer: never fetched by itself (privacy); a click loads it, the address is shown. */
function RemoteImage({ src, alt }: ComponentPropsWithoutRef<'img'>) {
  const t = useT()
  const [loaded, setLoaded] = useState(false)
  if (!src || !isRemoteImage(src)) return null
  if (loaded) return <Box component="img" src={src} alt={alt ?? ''} referrerPolicy="no-referrer" loading="lazy" sx={{ maxWidth: '100%', borderRadius: '8px' }} />
  return (
    <Button size="small" variant="outlined" color="inherit" onClick={() => setLoaded(true)} startIcon={<ImageOutlined sx={{ fontSize: 14 }} />} sx={{ my: '2px', fontSize: 12 }} title={src}>
      {t('chat.image.load', [hostOf(src)])}
    </Button>
  )
}

function Link({ href, children }: ComponentPropsWithoutRef<'a'>) {
  if (!isSafeHref(href)) return <span>{children}</span>
  return (
    <Box component="a" href={href} target="_blank" rel="noopener noreferrer nofollow" sx={{ color: 'var(--safe)', textDecoration: 'underline', textUnderlineOffset: '2px', overflowWrap: 'anywhere' }}>
      {children}
      <OpenInNewRounded sx={{ ml: '2px', fontSize: 11, verticalAlign: 'baseline', opacity: 0.6 }} />
    </Box>
  )
}

const COMPONENTS: Components = {
  a: Link,
  img: RemoteImage,
  pre: CodeBlock,
  table: ({ children }) => (
    <Box sx={{ my: 1.5, overflowX: 'auto' }}>
      <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 13.5, '& th, & td': { border: '1px solid var(--line)', px: 1.25, py: '6px', textAlign: 'left' }, '& th': { backgroundColor: 'var(--surface-2)', fontWeight: 500 } }}>{children}</Box>
    </Box>
  ),
  input: ({ checked }) => <Box component="input" type="checkbox" checked={!!checked} disabled readOnly sx={{ mr: '6px', verticalAlign: 'middle' }} />,
}

const HLJS = {
  '& .hljs-comment, & .hljs-quote': { color: 'var(--faint)', fontStyle: 'italic' },
  '& .hljs-keyword, & .hljs-selector-tag, & .hljs-literal, & .hljs-doctag, & .hljs-name': { color: 'var(--safe)' },
  '& .hljs-string, & .hljs-regexp, & .hljs-addition, & .hljs-attribute, & .hljs-template-variable': { color: 'var(--ok)' },
  '& .hljs-number, & .hljs-symbol, & .hljs-bullet, & .hljs-link, & .hljs-variable, & .hljs-type': { color: 'var(--warn)' },
  '& .hljs-title, & .hljs-section, & .hljs-built_in, & .hljs-class, & .hljs-function': { color: 'color-mix(in oklab, var(--ink) 80%, var(--safe))', fontWeight: 500 },
  '& .hljs-meta, & .hljs-selector-id, & .hljs-selector-class, & .hljs-tag': { color: 'var(--muted)' },
  '& .hljs-deletion': { color: 'var(--danger)' },
  '& .hljs-emphasis': { fontStyle: 'italic' },
  '& .hljs-strong': { fontWeight: 600 },
}

/**
 * The Markdown of an answer: GitHub flavour (tables, task lists, strikethrough), no raw HTML (react-markdown does not
 * render it), links of web and mail only and opened outside the app, images from the network blocked until asked,
 * fenced code coloured by a subset of highlight.js with a copy button. Loaded lazily (`Markdown.tsx`): this is the heavy chunk.
 * `MarkdownView` takes extra plugins: `MathMarkdownRenderer` adds the formulas (a chunk of its own).
 */
type Plugins = NonNullable<Options['remarkPlugins']>

export function MarkdownView({ text, remark = [], rehype = [] }: { text: string; remark?: Plugins; rehype?: Plugins }) {
  const remarkPlugins = remark.length > 0 ? [...REMARK, ...remark] : REMARK
  const rehypePlugins = rehype.length > 0 ? [...rehype, ...REHYPE] : REHYPE
  return (
    <Box
      className="chat-markdown"
      sx={{
        overflowWrap: 'anywhere',
        fontSize: 15,
        lineHeight: 1.65,
        color: 'var(--ink)',
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& p': { my: 1 },
        '& ul, & ol': { my: 1, pl: 3 },
        '& li': { my: '2px' },
        '& h1, & h2, & h3, & h4': { mt: 2, mb: 1, fontFamily: 'var(--font-display)', fontWeight: 400, lineHeight: 1.2 },
        '& h1': { fontSize: 24 },
        '& h2': { fontSize: 20 },
        '& h3, & h4': { fontSize: 17 },
        '& blockquote': { m: 0, my: 1, borderLeft: '3px solid var(--line-strong)', pl: 1.5, color: 'var(--ink-2)' },
        '& hr': { border: 0, borderTop: '1px solid var(--line)', my: 2 },
        '& :not(pre) > code': { borderRadius: '6px', backgroundColor: 'var(--surface-3)', px: '5px', py: '1px', fontFamily: 'var(--font-mono)', fontSize: '0.88em' },
        '& pre code': { fontFamily: 'inherit' },
        ...HLJS,
      }}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </Box>
  )
}

function MarkdownRenderer({ text }: { text: string }) {
  return <MarkdownView text={text} />
}

export default memo(MarkdownRenderer)
