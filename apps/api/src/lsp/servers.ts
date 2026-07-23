// ponytail: registry of LSP servers we know how to spawn. Each entry lists the
// command, args, and the languages it can serve. The bridge uses the language
// id from the WebSocket query to look one up.

export interface LspServerSpec {
  command: string;
  args: string[];
  /** languages this server can handle (LSP `languageId` values) */
  languages: readonly string[];
}

// ponytail: server binaries are resolved by name (PATH lookup). Each spec is
// the conventional name — `vscode-langservers-extracted` ships
// `vscode-{json,html,css,markdown}-language-server`; `typescript-language-server`
// and `pyright-langserver` come from their own packages.
export const LSP_SERVERS: readonly LspServerSpec[] = [
  {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
  },
  {
    command: 'pyright-langserver',
    args: ['--stdio'],
    languages: ['python'],
  },
  {
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    languages: ['json', 'jsonc'],
  },
  {
    command: 'yaml-language-server',
    args: ['--stdio'],
    languages: ['yaml'],
  },
  {
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    languages: ['html'],
  },
  {
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    languages: ['css', 'scss', 'less'],
  },
  {
    command: 'vscode-markdown-language-server',
    args: ['--stdio'],
    languages: ['markdown'],
  },
];

export function findLspServer(languageId: string): LspServerSpec | null {
  return LSP_SERVERS.find((spec) => spec.languages.includes(languageId)) ?? null;
}
