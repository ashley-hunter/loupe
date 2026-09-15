import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Prose out of a Transcript, rendered.
 *
 * `react-markdown` builds React elements rather than a string of HTML, so the
 * markup a Transcript happens to contain is escaped rather than executed and
 * there is nothing here to sanitise. GFM is on because transcripts are full of
 * tables and fenced code.
 *
 * Only for prose. Tool output - a file, a diff, the stdout of a command - is
 * not Markdown, and running it through this would mangle every `#` comment
 * into a heading and every `*` into emphasis.
 */

const COMPONENTS: Components = {
  pre: ({ children }) => <pre className="md-code">{children}</pre>,
  // Wrapped so a wide table scrolls on its own rather than stretching whatever
  // holds it, which is the rule the rest of the app follows.
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table className="md-table">{children}</table>
    </div>
  ),
  /**
   * Links leave the app rather than navigating it.
   *
   * Without the target, clicking a URL in a transcript replaces the whole
   * interface with that website and there is no way back. `_blank` goes through
   * the window-open handler in the main process, which hands it to the real
   * browser and denies the navigation.
   */
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

export const Markdown = ({ text }: { text: string }) => (
  <div className="md">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  </div>
);
