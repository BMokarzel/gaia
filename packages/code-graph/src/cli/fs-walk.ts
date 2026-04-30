/**
 * Walker recursivo simples — sem dependências externas.
 * Usa node:fs/promises e respeita um conjunto fixo de pastas a ignorar.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

import type { SourceFile } from '../walkers/source-file';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  '.turbo',
  'coverage',
  '.vite',
  '.cache',
]);

const DEFAULT_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export interface CollectOptions {
  extensions?: ReadonlyArray<string>;
  /** Limite de tamanho de arquivo (bytes) — default 1MB. */
  maxFileSize?: number;
}

export async function collectFiles(rootDir: string, options: CollectOptions = {}): Promise<SourceFile[]> {
  const exts = new Set(options.extensions ?? Array.from(DEFAULT_EXTS));
  const maxSize = options.maxFileSize ?? 1024 * 1024;
  const out: SourceFile[] = [];
  await walk(rootDir, rootDir, exts, maxSize, out);
  return out;
}

async function walk(
  root: string,
  dir: string,
  exts: Set<string>,
  maxSize: number,
  out: SourceFile[],
): Promise<void> {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      await walk(root, join(dir, entry.name), exts, maxSize, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = extname(entry.name);
    if (!exts.has(ext)) continue;
    const abs = join(dir, entry.name);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    if (st.size > maxSize) continue;
    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = abs.slice(root.length + 1).replace(/\\/g, '/');
    out.push({ path: rel, content, extension: ext, language: extToLang(ext) });
  }
}

function extToLang(ext: string): string {
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
      return 'javascript';
    case '.jsx':
      return 'jsx';
    default:
      return 'text';
  }
}
