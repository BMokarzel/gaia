import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { walkRepository } from '../../src/core/walker';
import { analyzeRepository } from '../../src/core/orchestrator';
import { detectTechStack } from '../../src/core/detector';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gaia-sandbox-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function createFile(relPath: string, content = ''): void {
  const abs = join(tmpDir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('Walker — path traversal prevention', () => {
  it('all returned file paths are descendants of the repo root', () => {
    createFile('src/app.ts', 'const x = 1;');
    createFile('src/utils.ts', 'const y = 2;');
    const files = walkRepository(tmpDir);
    for (const file of files) {
      expect(
        file.absolutePath.startsWith(tmpDir),
        `Path "${file.absolutePath}" escapes repo root "${tmpDir}"`,
      ).toBe(true);
    }
  });

  it('symlink to directory outside root is not followed', () => {
    createFile('src/app.ts', 'export const x = 1;');
    const escapeLinkPath = join(tmpDir, 'escape');
    try {
      symlinkSync('/tmp', escapeLinkPath);
    } catch {
      return; // Symlink creation may be restricted in CI — skip
    }

    const files = walkRepository(tmpDir);
    const escaped = files.filter(f => !f.absolutePath.startsWith(tmpDir));
    expect(escaped).toHaveLength(0);
  });

  it('symlink to sensitive file outside root is not read', () => {
    const sensitiveLink = join(tmpDir, 'secrets.ts');
    try {
      symlinkSync('/etc/passwd', sensitiveLink);
    } catch {
      return;
    }

    const files = walkRepository(tmpDir);
    expect(files.find(f => f.absolutePath === sensitiveLink)).toBeUndefined();
  });

  it('deeply nested symlink chain does not escape root', () => {
    createFile('src/real.ts', 'const z = 3;');
    const linkPath = join(tmpDir, 'src', 'linked');
    try {
      symlinkSync(tmpdir(), linkPath);
    } catch {
      return;
    }

    const files = walkRepository(tmpDir);
    for (const file of files) {
      expect(file.absolutePath.startsWith(tmpDir)).toBe(true);
    }
  });
});

describe('Walker — file size and resource limits', () => {
  it('skips files larger than 5 MB (default limit)', () => {
    createFile('small.ts', 'const x = 1;');
    const largePath = join(tmpDir, 'large.ts');
    writeFileSync(largePath, Buffer.alloc(6 * 1024 * 1024, 'a'));

    const files = walkRepository(tmpDir);
    expect(files.find(f => f.relativePath === 'large.ts')).toBeUndefined();
    expect(files.find(f => f.relativePath === 'small.ts')).toBeDefined();
  });

  it('skips empty files', () => {
    createFile('empty.ts', '');
    createFile('notempty.ts', 'const x = 1;');
    const files = walkRepository(tmpDir);
    expect(files.find(f => f.relativePath === 'empty.ts')).toBeUndefined();
    expect(files.find(f => f.relativePath === 'notempty.ts')).toBeDefined();
  });

  it('respects custom maxFileSize option', () => {
    createFile('ok.ts', 'x'.repeat(50));
    createFile('toobig.ts', 'x'.repeat(200));
    const files = walkRepository(tmpDir, { maxFileSize: 100 });
    expect(files.find(f => f.relativePath === 'ok.ts')).toBeDefined();
    expect(files.find(f => f.relativePath === 'toobig.ts')).toBeUndefined();
  });
});

describe('Walker — no code execution from analyzed repos', () => {
  it('does not execute JavaScript/TypeScript files during analysis', async () => {
    // Plant a file that would have a side-effect if executed
    const sideEffectPath = join(tmpdir(), 'gaia-exec-probe-' + Date.now() + '.txt');
    const payload = `
      import { writeFileSync } from 'fs';
      writeFileSync('${sideEffectPath}', 'executed');
    `;
    createFile('src/malicious.ts', payload);
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'probe', dependencies: {} }));

    await analyzeRepository(tmpDir, { onProgress: () => {} });

    const { existsSync } = await import('fs');
    expect(existsSync(sideEffectPath)).toBe(false);

    try { rmSync(sideEffectPath); } catch {}
  });

  it('does not eval() content of analyzed source files', () => {
    // Walker only calls readFileSync — verify the content is treated as a string, not executed
    createFile('src/app.ts', 'process.exit(1);'); // Would kill process if eval'd
    const files = walkRepository(tmpDir);
    const file = files.find(f => f.relativePath === 'src/app.ts');
    expect(file).toBeDefined();
    expect(file!.content).toBe('process.exit(1);');
    // The fact that the test is still running proves the content was not executed
  });
});

describe('Detector — no code execution from manifest files', () => {
  it('reads package.json as data, does not execute it', () => {
    const sideEffectPath = join(tmpdir(), 'gaia-manifest-probe-' + Date.now() + '.txt');
    // A valid JSON package.json — no execution risk, but crafted to look suspicious
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      name: 'probe',
      scripts: { postinstall: `node -e "require('fs').writeFileSync('${sideEffectPath}','x')"` },
      dependencies: { express: '*' },
    }));

    detectTechStack({ name: 'probe', rootPath: tmpDir, manifestFile: 'package.json', manifestType: 'npm' });

    const { existsSync } = require('fs');
    expect(existsSync(sideEffectPath)).toBe(false);
  });

  it('handles malformed JSON in package.json without crashing', () => {
    writeFileSync(join(tmpDir, 'package.json'), '{ invalid json ]]');
    expect(() => {
      detectTechStack({ name: 'probe', rootPath: tmpDir, manifestFile: 'package.json', manifestType: 'npm' });
    }).not.toThrow();
  });

  it('handles malformed go.mod without crashing', () => {
    writeFileSync(join(tmpDir, 'go.mod'), '<<< MERGE CONFLICT >>>');
    expect(() => {
      detectTechStack({ name: 'probe', rootPath: tmpDir, manifestFile: 'go.mod', manifestType: 'go' });
    }).not.toThrow();
  });

  it('handles path with special characters in requirements.txt without crashing', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), '../../../etc/passwd\x00\nfastapi\n');
    expect(() => {
      detectTechStack({ name: 'probe', rootPath: tmpDir, manifestFile: 'requirements.txt', manifestType: 'python' });
    }).not.toThrow();
  });
});

describe('Orchestrator — resilience with hostile repos', () => {
  it('does not crash when analyzing a repo with only binary files', async () => {
    writeFileSync(join(tmpDir, 'binary.ts'), Buffer.from([0x00, 0xff, 0xfe, 0x00]));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'bin-probe', dependencies: {} }));

    await expect(
      analyzeRepository(tmpDir, { onProgress: () => {} }),
    ).resolves.toBeDefined();
  });

  it('does not crash when analyzing an empty directory with a package.json', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'empty', dependencies: {} }));

    const topology = await analyzeRepository(tmpDir, { onProgress: () => {} });
    expect(topology).toBeDefined();
    expect(Array.isArray(topology.services)).toBe(true);
  });

  it('does not crash with deeply nested directory structure', async () => {
    let current = tmpDir;
    for (let i = 0; i < 10; i++) {
      current = join(current, `level${i}`);
      mkdirSync(current, { recursive: true });
    }
    writeFileSync(join(current, 'app.ts'), 'const x = 1;');
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'deep', dependencies: {} }));

    await expect(
      analyzeRepository(tmpDir, { onProgress: () => {} }),
    ).resolves.toBeDefined();
  });
});
