import { readdirSync, lstatSync, readFileSync } from 'fs';
import { join, extname, relative, basename } from 'path';

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  extension: string;
  language: SupportedLanguage;
  content: string;
  sizeBytes: number;
}

export type SupportedLanguage =
  | 'typescript' | 'javascript' | 'tsx' | 'jsx'
  | 'java' | 'kotlin' | 'python' | 'swift'
  | 'go' | 'rust' | 'csharp' | 'cpp' | 'c';

const EXT_TO_LANGUAGE: Record<string, SupportedLanguage> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.py': 'python',
  '.swift': 'swift',
  '.go': 'go',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
};

/** Diretórios a ignorar sempre */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'target', 'bin', 'obj',
  '__pycache__', '.pytest_cache', '.mypy_cache',
  '.next', '.nuxt', '.output', '.cache',
  'coverage', '.nyc_output',
  'vendor', 'Pods',
  '.gradle', '.idea', '.vscode',
  'DerivedData', '.build',
]);

/** Arquivos a ignorar */
const IGNORE_FILES = new Set([
  '.d.ts',       // TypeScript declarations
  '.min.js',     // Minified
  '.bundle.js',
  '.test.ts', '.spec.ts', '.test.js', '.spec.js',
  '.test.py', '_test.go',
]);

/** Tamanho máximo de arquivo (5MB) */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface WalkOptions {
  /** Ignorar arquivos de teste */
  skipTests?: boolean;
  /** Extensões específicas para incluir (undefined = todas suportadas) */
  extensions?: string[];
  /** Tamanho máximo de arquivo em bytes */
  maxFileSize?: number;
}

/**
 * Percorre recursivamente um diretório e retorna todos os arquivos fonte
 */
export function walkRepository(repoPath: string, options: WalkOptions = {}): SourceFile[] {
  const {
    skipTests = true,
    extensions,
    maxFileSize = MAX_FILE_SIZE,
  } = options;

  const files: SourceFile[] = [];
  const allowedExts = extensions
    ? new Set(extensions)
    : new Set(Object.keys(EXT_TO_LANGUAGE));

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.startsWith('.') && IGNORE_DIRS.has(entry)) continue;
      if (IGNORE_DIRS.has(entry)) continue;

      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }

      // Skip symlinks to prevent path traversal outside repo root
      if (stat.isSymbolicLink()) continue;

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!stat.isFile()) continue;
      if (stat.size > maxFileSize) continue;
      if (stat.size === 0) continue;

      const ext = extname(entry).toLowerCase();
      if (!allowedExts.has(ext)) continue;

      // Ignora arquivos de declaração TypeScript
      if (entry.endsWith('.d.ts')) continue;

      // Ignora arquivos gerados/minificados
      if (entry.endsWith('.min.js') || entry.endsWith('.bundle.js')) continue;

      // Ignora testes se skipTests=true
      if (skipTests && isTestFile(entry, fullPath, repoPath)) continue;

      const language = EXT_TO_LANGUAGE[ext];
      if (!language) continue;

      let content: string;
      try {
        content = readFileSync(fullPath, 'utf-8');
      } catch {
        continue;
      }

      // Final containment guard — ensures no path escapes the repo root
      // Normalize separators before comparison (Windows uses \ but repoPath may use /)
      const normalizedFull = fullPath.replace(/\\/g, '/');
      const normalizedRepo = repoPath.replace(/\\/g, '/');
      if (!normalizedFull.startsWith(normalizedRepo)) continue;

      files.push({
        absolutePath: fullPath,
        relativePath: relative(repoPath, fullPath).replace(/\\/g, '/'),
        extension: ext,
        language,
        content,
        sizeBytes: stat.size,
      });
    }
  }

  walk(repoPath);
  return files;
}

function isTestFile(filename: string, fullPath: string, repoPath: string): boolean {
  const lower = filename.toLowerCase();
  // Extensões de teste
  if (lower.includes('.test.') || lower.includes('.spec.')) return true;
  if (lower.endsWith('_test.go') || lower.endsWith('_test.py')) return true;
  if (lower.startsWith('test_')) return true;

  // Diretórios de teste — checar apenas no path RELATIVO ao root do serviço,
  // para não excluir projetos que vivem dentro de um diretório chamado "tests"
  const normalizedFull = fullPath.replace(/\\/g, '/');
  const normalizedRepo = repoPath.replace(/\\/g, '/').replace(/\/?$/, '/');
  const pathWithinService = normalizedFull.startsWith(normalizedRepo)
    ? normalizedFull.slice(normalizedRepo.length)
    : normalizedFull;
  if (pathWithinService.includes('/test/') || pathWithinService.includes('/tests/')) return true;
  if (pathWithinService.includes('/spec/') || pathWithinService.includes('/specs/')) return true;
  if (pathWithinService.includes('/__tests__/')) return true;
  if (pathWithinService.includes('/e2e/')) return true;

  return false;
}

/**
 * Detecta sub-serviços dentro de um monorepo.
 * Um sub-serviço é qualquer diretório com package.json, pom.xml, build.gradle,
 * pyproject.toml, go.mod, Cargo.toml, Package.swift, Dockerfile
 */
export interface ServiceBoundary {
  name: string;
  rootPath: string;
  manifestFile: string;
  manifestType: 'npm' | 'maven' | 'gradle' | 'python' | 'go' | 'cargo' | 'swift' | 'docker' | 'dotnet';
}

const MANIFEST_FILES: Array<[string, ServiceBoundary['manifestType']]> = [
  ['package.json', 'npm'],
  ['pom.xml', 'maven'],
  ['build.gradle', 'gradle'],
  ['build.gradle.kts', 'gradle'],
  ['pyproject.toml', 'python'],
  ['setup.py', 'python'],
  ['requirements.txt', 'python'],
  ['go.mod', 'go'],
  ['Cargo.toml', 'cargo'],
  ['Package.swift', 'swift'],
  ['*.csproj', 'dotnet'],
  ['*.fsproj', 'dotnet'],
];

export function detectServiceBoundaries(repoPath: string): ServiceBoundary[] {
  const boundaries: ServiceBoundary[] = [];
  const found = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > 6) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    // Ignora diretórios comuns
    const dirName = basename(dir);
    if (IGNORE_DIRS.has(dirName)) return;

    for (const [manifest, type] of MANIFEST_FILES) {
      const isGlob = manifest.startsWith('*');
      const hasManifest = isGlob
        ? entries.some(e => e.endsWith(manifest.slice(1)))
        : entries.includes(manifest);

      if (hasManifest && !found.has(dir)) {
        found.add(dir);
        const manifestFile = isGlob
          ? entries.find(e => e.endsWith(manifest.slice(1))) ?? manifest
          : manifest;

        boundaries.push({
          name: basename(dir),
          rootPath: dir,
          manifestFile,
          manifestType: type,
        });
        break;
      }
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      try {
        const s = lstatSync(full);
        if (!s.isSymbolicLink() && s.isDirectory()) {
          walk(full, depth + 1);
        }
      } catch {
        continue;
      }
    }
  }

  walk(repoPath, 0);

  // Se não encontrou nenhum manifesto, trata o repo inteiro como um serviço
  if (boundaries.length === 0) {
    boundaries.push({
      name: basename(repoPath),
      rootPath: repoPath,
      manifestFile: '',
      manifestType: 'docker',
    });
  }

  return boundaries;
}
