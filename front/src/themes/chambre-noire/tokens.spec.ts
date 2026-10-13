/**
 * Copyright (c) 2026 Stéphane Vaxelaire
 * SPDX-License-Identifier: MIT
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { darkTokens, lightTokens, tokenCssVars, type ChambreNoireTokens } from './tokens';

const css = readFileSync(resolve(__dirname, 'theme.css'), 'utf8');

/** Body of the first rule whose selector list starts with `selector`. */
function ruleBody(selector: string): string {
  const start = css.indexOf(selector + ' {');
  if (start < 0) throw new Error(`rule not found: ${selector}`);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

function declared(body: string, name: string): string {
  const match = body.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`variable not found: ${name}`);
  return match[1].trim();
}

describe('chambre-noire tokens', () => {
  const cases: [string, string, ChambreNoireTokens][] = [
    ['dark', ':root,\n:root[data-color-scheme="dark"]', darkTokens],
    ['light', ':root[data-color-scheme="light"]', lightTokens],
  ];

  for (const [mode, selector, tokens] of cases) {
    it(`${mode}: every hex token of tokens.ts equals its CSS variable`, () => {
      const body = ruleBody(selector);
      for (const key of Object.keys(tokenCssVars) as (keyof ChambreNoireTokens)[]) {
        expect(declared(body, tokenCssVars[key]), `${mode} ${key}`).toBe(tokens[key]);
      }
    });
  }

  it('keeps the grain opacity of the former interface', () => {
    expect(declared(ruleBody(':root,\n:root[data-color-scheme="dark"]'), '--grain-opacity')).toBe('0.05');
    expect(declared(ruleBody(':root[data-color-scheme="light"]'), '--grain-opacity')).toBe('0.035');
  });
});
