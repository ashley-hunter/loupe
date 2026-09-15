import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Markdown } from '../src/renderer/ui/Markdown.js';

/**
 * The parser is `react-markdown` and is not retested here. What is tested is
 * this app's decisions: that GFM is actually wired up, that wide things get the
 * wrapper that lets them scroll, and that a link cannot navigate the app away.
 */
const render = (text: string): string => renderToStaticMarkup(createElement(Markdown, { text }));

describe('Markdown', () => {
  it('renders the inline formatting transcripts are full of', () => {
    expect(render('a **bold** and *italic* and `code` here')).toContain(
      '<p>a <strong>bold</strong> and <em>italic</em> and <code>code</code> here</p>',
    );
  });

  /**
   * The security-relevant one.
   *
   * A bare anchor navigates the renderer itself, replacing the whole interface
   * with whatever a transcript happened to link to and offering no way back.
   * `_blank` routes through the main process's window-open handler, which hands
   * it to the real browser and denies the navigation.
   */
  it('opens links outside the app rather than navigating it', () => {
    const out = render('[docs](https://example.com)');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noreferrer noopener"');
  });

  // Markup in a transcript is content, not markup: react-markdown builds
  // elements rather than HTML, so there is nothing here to sanitise.
  it('escapes markup rather than executing it', () => {
    const out = render('a <img src=x onerror=alert(1)> b');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  // Proves remark-gfm is wired: tables are 3% of messages and are unreadable raw.
  it('builds GFM tables, wrapped so a wide one scrolls', () => {
    const out = render('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<div class="md-table-wrap">');
    expect(out).toContain('<table class="md-table">');
    expect(out).toContain('<th>a</th>');
    expect(out).toContain('<td>1</td>');
  });

  it('leaves a fenced block alone, including markup inside it', () => {
    const out = render('```ts\nconst a = **not bold**;\n```');
    expect(out).toContain('<pre class="md-code">');
    expect(out).toContain('const a = **not bold**;');
    expect(out).not.toContain('<strong>');
  });

  // Backticks win, or every glob and path in a transcript turns into emphasis.
  it('does not read emphasis inside inline code', () => {
    expect(render('`src/**/*.ts`')).toContain('<code>src/**/*.ts</code>');
  });

  it('renders both kinds of list', () => {
    expect(render('- one\n- two')).toContain('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(render('1. one\n2. two')).toContain('<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
  });

  it('renders plain text as plain text, and nothing at all as nothing', () => {
    expect(render('just words')).toContain('<p>just words</p>');
    expect(render('')).toBe('<div class="md"></div>');
  });
});
