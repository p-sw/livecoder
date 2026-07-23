import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs, watch as watchDirectory } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export type EntryKind = 'file' | 'directory';

export interface FileEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size?: number;
  modified?: string;
  language?: string;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.css': 'css',
  '.go': 'go',
  '.html': 'html',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascriptreact',
  '.md': 'markdown',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shellscript',
  '.sql': 'sql',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.vue': 'vue',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};

@Injectable()
export class WorkspaceService {
  resolvePath(input?: string): string {
    const value = (input ?? '').trim();
    if (!value || value === '~') return homedir();
    if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
    return resolve(value);
  }

  async browse(input?: string) {
    const path = this.resolvePath(input);
    await this.assertDirectory(path);
    return {
      path,
      parentPath: dirname(path) === path ? null : dirname(path),
      entries: await this.readEntries(path, true),
    };
  }

  async open(input: string) {
    const path = this.resolvePath(input);
    await this.assertDirectory(path);
    return {
      path,
      name: path.split(sep).filter(Boolean).at(-1) ?? path,
      entries: await this.readEntries(path, false),
    };
  }

  async entries(input: string) {
    const path = this.resolvePath(input);
    await this.assertDirectory(path);
    return { path, entries: await this.readEntries(path, false) };
  }

  async readFile(input: string, workspace?: string) {
    const path = this.resolvePath(input);
    if (workspace) this.assertInside(path, this.resolvePath(workspace));

    let stat;
    try {
      stat = await fs.stat(path);
    } catch {
      throw new NotFoundException('File not found');
    }
    if (!stat.isFile()) throw new BadRequestException('Only files can be opened');

    const content = await fs.readFile(path, 'utf8');
    return {
      path,
      content,
      language: LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? 'plaintext',
      size: stat.size,
      modified: stat.mtime.toISOString(),
    };
  }

  async writeFile(input: string, content: unknown, workspace?: string) {
    if (typeof content !== 'string') throw new BadRequestException('content must be a string');
    const path = this.resolvePath(input);
    if (workspace) this.assertInside(path, this.resolvePath(workspace));
    await fs.writeFile(path, content, 'utf8');
    return this.readFile(path, workspace);
  }

  async assertDirectory(input: string): Promise<void> {
    let stat;
    try {
      stat = await fs.stat(input);
    } catch {
      throw new NotFoundException(`Directory not found: ${input}`);
    }
    if (!stat.isDirectory()) throw new BadRequestException('Workspace path must be a folder');
  }

  watch(input: string, onChange: (path: string) => void): () => void {
    const root = this.resolvePath(input);
    const watcher = watchDirectory(root, { recursive: true }, (_event, filename) => {
      const changed = filename ? join(root, filename.toString()) : root;
      onChange(changed);
    });
    const close = () => watcher.close();
    watcher.on('error', close);
    return close;
  }

  private assertInside(path: string, workspace: string): void {
    const child = relative(workspace, path);
    if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new BadRequestException('Path must be inside the workspace');
    }
  }

  private async readEntries(path: string, foldersOnly: boolean): Promise<FileEntry[]> {
    const entries = await fs.readdir(path, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      const entryPath = join(path, entry.name);
      let kind: EntryKind = entry.isDirectory() ? 'directory' : 'file';
      if (entry.isSymbolicLink()) {
        try {
          kind = (await fs.stat(entryPath)).isDirectory() ? 'directory' : 'file';
        } catch {
          continue;
        }
      }
      if (foldersOnly && kind !== 'directory') continue;

      if (kind === 'directory') {
        result.push({ name: entry.name, path: entryPath, kind });
        continue;
      }

      try {
        const stat = await fs.stat(entryPath);
        result.push({
          name: entry.name,
          path: entryPath,
          kind,
          size: stat.size,
          modified: stat.mtime.toISOString(),
          language: LANGUAGE_BY_EXTENSION[extname(entry.name).toLowerCase()] ?? 'plaintext',
        });
      } catch {
        // A file can disappear between readdir and stat. It is simply omitted.
      }
    }

    return result.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }
}
