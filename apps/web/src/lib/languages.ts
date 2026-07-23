import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { StreamLanguage, StreamParser, LanguageSupport } from '@codemirror/language';

// ponytail: dotenv and toml aren't first-class CM6 packages. StreamLanguage with a
// regex parser keeps us at zero extra deps while giving accurate highlighting
// for a viewer. Replace with @lezer/toml-style grammars when touch lands.

const dotenvParser: StreamParser<unknown> = {
  name: 'dotenv',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#[^\n]*/)) return 'lineComment';
    if (stream.match(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/)) return 'propertyName';
    if (stream.eat('=')) return 'operator';
    if (stream.eat('"')) { stream.eatWhile(/[^"\n]/); stream.eat('"'); return 'string'; }
    if (stream.eat("'")) { stream.eatWhile(/[^'\n]/); stream.eat("'"); return 'string'; }
    stream.eatWhile(/[^#\n]/);
    return 'string';
  },
  languageData: { commentTokens: { line: '#' } },
};

const tomlParser: StreamParser<unknown> = {
  name: 'toml',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^#[^\n]*/)) return 'lineComment';
    if (stream.match(/^\[\[?[A-Za-z0-9_.\-]+\]?\]/)) return 'heading';
    if (stream.match(/^[A-Za-z0-9_.\-]+(?=\s*=)/)) return 'propertyName';
    if (stream.eat('=')) return 'operator';
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';
    if (stream.match(/^(true|false)\b/)) return 'bool';
    if (stream.match(/^-?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\b/)) return 'number';
    if (stream.match(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?/)) return 'number';
    if (stream.eat('[')) { stream.eatWhile(/[^\]]/); stream.eat(']'); return 'atom'; }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
};

const LOADER_BY_LANGUAGE: Record<string, () => LanguageSupport> = {
  typescript: () => javascript({ typescript: true, jsx: false }),
  javascript: () => javascript({ jsx: false }),
  javascriptreact: () => javascript({ jsx: true }),
  typescriptreact: () => javascript({ typescript: true, jsx: true }),
  python: () => python(),
  yaml: () => yaml(),
  json: () => json(),
  // ponytail: JSONC gets JSON's parser + grammar; trailing commas / comments will
  // surface as parse errors in the gutter. Acceptable for a viewer — the file
  // still highlights. A dedicated lezer-jsonc would be the upgrade path.
  jsonc: () => json(),
  html: () => html(),
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  markdown: () => markdown(),
  toml: () => new LanguageSupport(StreamLanguage.define(tomlParser)),
  // ponytail: plaintext uses a no-op StreamLanguage parser — LRLanguage's
  // constructor is private, so we route through StreamLanguage for a clean
  // empty highlight tagger instead of building one by hand.
  plaintext: () => new LanguageSupport(StreamLanguage.define({ name: 'plaintext', token: () => null })),
};

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python',
  yaml: 'yaml', yml: 'yaml',
  json: 'json', jsonc: 'jsonc',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  toml: 'toml',
  env: 'dotenv',
};

// ponytail: VS Code language IDs that LSP servers expect — this is what the
// bridge hands to the LSP `initialize` handshake and `textDocument/didOpen`.
const LSP_ID: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  typescriptreact: 'typescriptreact',
  javascriptreact: 'javascriptreact',
  python: 'python',
  yaml: 'yaml',
  json: 'json',
  jsonc: 'jsonc',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  markdown: 'markdown',
  toml: 'toml',
  dotenv: 'dotenv',
  plaintext: 'plaintext',
};

export interface LanguageMatch {
  id: string;
  support: LanguageSupport;
}

export function detectLanguage(name: string, reported: string | undefined): LanguageMatch {
  const lower = name.toLowerCase();

  // ponytail: special filenames override extension matching — tsconfig.json
  // and .env.example would otherwise be misclassified as JSON / unknown.
  if (lower === 'tsconfig.json' || lower === 'jsconfig.json' || lower.endsWith('.jsonc'))
    return resolveId('jsonc');
  if (lower === '.env' || lower.startsWith('.env.') || lower === 'env')
    return resolveId('dotenv');

  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const fromExt = EXT_TO_LANGUAGE[ext];
  if (fromExt) return resolveId(fromExt);

  const lowerReported = reported?.toLowerCase();
  if (lowerReported && lowerReported in LOADER_BY_LANGUAGE) return resolveId(lowerReported);
  if (lowerReported === 'tsx') return resolveId('typescriptreact');
  if (lowerReported === 'jsx') return resolveId('javascriptreact');
  return resolveId('plaintext');
}

function resolveId(id: string): LanguageMatch {
  const loader = LOADER_BY_LANGUAGE[id] ?? LOADER_BY_LANGUAGE.plaintext;
  return { id: LSP_ID[id] ?? id, support: loader() };
}
