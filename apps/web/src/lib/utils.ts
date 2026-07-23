import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function relativePath(path: string, root: string): string {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(normalizedRoot) ? path.slice(normalizedRoot.length) : path;
}

export function fileLanguage(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension ? extension.toUpperCase() : 'TEXT';
}
