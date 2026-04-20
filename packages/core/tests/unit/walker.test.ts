import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { walkRepository, detectServiceBoundaries } from '../../src/core/walker';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gaia-walker-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createFile(relPath: string, content = 'x'): void {
  const abs = join(tmpDir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('walkRepository', () => {
  it('finds TypeScript source files', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('src/utils.ts', 'export const y = 2;');
    const files = walkRepository(tmpDir);
    expect(files.map(f => f.relativePath)).toContain('src/app.ts');
    expect(files.map(f => f.relativePath)).toContain('src/utils.ts');
  });

  it('finds multiple language files', () => {
    createFile('main.go', 'package main');
    createFile('App.java', 'class App {}');
    createFile('app.py', 'print("hi")');
    createFile('lib.rs', 'fn main() {}');
    const files = walkRepository(tmpDir);
    const langs = files.map(f => f.language);
    expect(langs).toContain('go');
    expect(langs).toContain('java');
    expect(langs).toContain('python');
    expect(langs).toContain('rust');
  });

  it('skips node_modules directory', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('node_modules/lib/index.ts', 'module.exports = {}');
    const files = walkRepository(tmpDir);
    expect(files.every(f => !f.relativePath.includes('node_modules'))).toBe(true);
  });

  it('skips dist and build directories', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('dist/app.js', 'const x = 1;');
    createFile('build/app.js', 'const x = 1;');
    const files = walkRepository(tmpDir);
    expect(files.every(f => !f.relativePath.startsWith('dist/'))).toBe(true);
    expect(files.every(f => !f.relativePath.startsWith('build/'))).toBe(true);
  });

  it('skips .git directory', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('.git/config', '[core]');
    const files = walkRepository(tmpDir);
    expect(files.every(f => !f.relativePath.startsWith('.git/'))).toBe(true);
  });

  it('skips test files when skipTests=true (default)', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('src/app.test.ts', 'it("x", () => {})');
    createFile('src/app.spec.ts', 'it("y", () => {})');
    const files = walkRepository(tmpDir, { skipTests: true });
    const paths = files.map(f => f.relativePath);
    expect(paths).toContain('src/app.ts');
    expect(paths).not.toContain('src/app.test.ts');
    expect(paths).not.toContain('src/app.spec.ts');
  });

  it('includes test files when skipTests=false', () => {
    createFile('src/app.test.ts', 'it("x", () => {})');
    const files = walkRepository(tmpDir, { skipTests: false });
    expect(files.map(f => f.relativePath)).toContain('src/app.test.ts');
  });

  it('skips files over maxFileSize', () => {
    createFile('src/small.ts', 'const x = 1;');
    const bigContent = 'x'.repeat(200);
    createFile('src/big.ts', bigContent);
    const files = walkRepository(tmpDir, { maxFileSize: 100 });
    const paths = files.map(f => f.relativePath);
    expect(paths).toContain('src/small.ts');
    expect(paths).not.toContain('src/big.ts');
  });

  it('skips .d.ts declaration files', () => {
    createFile('src/types.d.ts', 'declare const x: number;');
    createFile('src/app.ts', 'const x = 1;');
    const files = walkRepository(tmpDir);
    expect(files.every(f => !f.relativePath.endsWith('.d.ts'))).toBe(true);
  });

  it('returns correct SourceFile shape', () => {
    createFile('src/app.ts', 'const x = 1;');
    const files = walkRepository(tmpDir);
    const file = files.find(f => f.relativePath === 'src/app.ts');
    expect(file).toBeDefined();
    expect(file!.language).toBe('typescript');
    expect(file!.extension).toBe('.ts');
    expect(file!.content).toBe('const x = 1;');
    expect(file!.sizeBytes).toBeGreaterThan(0);
    expect(file!.absolutePath).toContain(tmpDir);
  });

  it('returns empty array for empty directory', () => {
    const files = walkRepository(tmpDir);
    expect(files).toHaveLength(0);
  });

  it('filters by specific extensions', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('main.go', 'package main');
    const files = walkRepository(tmpDir, { extensions: ['.ts'] });
    expect(files.every(f => f.extension === '.ts')).toBe(true);
    expect(files.map(f => f.language)).not.toContain('go');
  });
});

describe('walkRepository — security', () => {
  it('does not follow symlinks to directories outside repo root', () => {
    createFile('src/app.ts', 'const x = 1;');

    // Create a symlink pointing to /tmp (outside our repo)
    const linkPath = join(tmpDir, 'escape');
    try {
      symlinkSync(tmpdir(), linkPath);
    } catch {
      return; // symlink creation might fail in restricted environments
    }

    const files = walkRepository(tmpDir);
    // Files from /tmp must not appear; all paths should be within tmpDir
    for (const file of files) {
      expect(file.absolutePath.startsWith(tmpDir)).toBe(true);
    }
  });

  it('does not follow file symlinks outside repo root', () => {
    createFile('src/app.ts', 'const x = 1;');

    const linkPath = join(tmpDir, 'etc-passwd.ts');
    try {
      symlinkSync('/etc/passwd', linkPath);
    } catch {
      return;
    }

    const files = walkRepository(tmpDir);
    expect(files.every(f => !f.absolutePath.includes('etc-passwd'))).toBe(true);
  });

  it('respects MAX_FILE_SIZE limit (5 MB default)', () => {
    // Verify the hardcoded limit is enforced — create a file larger than 5 MB
    const largePath = join(tmpDir, 'huge.ts');
    const sixMb = Buffer.alloc(6 * 1024 * 1024, 'x');
    require('fs').writeFileSync(largePath, sixMb);
    const files = walkRepository(tmpDir);
    expect(files.find(f => f.relativePath === 'huge.ts')).toBeUndefined();
  });
});

describe('detectServiceBoundaries', () => {
  it('detects npm service from package.json', () => {
    createFile('package.json', JSON.stringify({ name: 'my-service' }));
    const boundaries = detectServiceBoundaries(tmpDir);
    expect(boundaries.some(b => b.manifestType === 'npm')).toBe(true);
  });

  it('detects maven service from pom.xml', () => {
    createFile('pom.xml', '<project/>');
    const boundaries = detectServiceBoundaries(tmpDir);
    expect(boundaries.some(b => b.manifestType === 'maven')).toBe(true);
  });

  it('detects go service from go.mod', () => {
    createFile('go.mod', 'module example.com/app\ngo 1.21\n');
    const boundaries = detectServiceBoundaries(tmpDir);
    expect(boundaries.some(b => b.manifestType === 'go')).toBe(true);
  });

  it('detects python service from requirements.txt', () => {
    createFile('requirements.txt', 'fastapi\n');
    const boundaries = detectServiceBoundaries(tmpDir);
    expect(boundaries.some(b => b.manifestType === 'python')).toBe(true);
  });

  it('detects multiple services in a monorepo', () => {
    createFile('services/api/package.json', JSON.stringify({ name: 'api' }));
    createFile('services/worker/go.mod', 'module example.com/worker\ngo 1.21\n');
    const boundaries = detectServiceBoundaries(tmpDir);
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to a single docker boundary when no manifest found', () => {
    createFile('README.md', '# project');
    // .md is not a manifest
    const boundaries = detectServiceBoundaries(tmpDir);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].manifestType).toBe('docker');
  });

  it('does not recurse beyond depth 6', () => {
    // Deeply nested manifest should be ignored
    const deep = 'a/b/c/d/e/f/g/package.json';
    createFile(deep, JSON.stringify({ name: 'too-deep' }));
    const boundaries = detectServiceBoundaries(tmpDir);
    // Depth 7+ should not be detected
    expect(boundaries.every(b => !b.rootPath.includes('a/b/c/d/e/f/g'))).toBe(true);
  });
});
