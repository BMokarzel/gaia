import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectTechStack } from '../../src/core/detector';
import type { ServiceBoundary } from '../../src/core/walker';

function makeBoundary(rootPath: string, manifestType: ServiceBoundary['manifestType']): ServiceBoundary {
  return { name: 'test', rootPath, manifestFile: '', manifestType };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'gaia-detector-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectTechStack — Node.js', () => {
  it('detects express framework', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { express: '^4.18.0' },
    }));
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.runtime).toBe('node');
    expect(stack.framework).toBe('express');
    expect(stack.language).toBe('javascript');
  });

  it('detects NestJS framework', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@nestjs/core': '^10.0.0', typescript: '^5.0.0' },
    }));
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.framework).toBe('nest');
    expect(stack.language).toBe('typescript');
  });

  it('detects fastify framework', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { fastify: '^4.0.0' },
    }));
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.framework).toBe('fastify');
  });

  it('detects typescript when tsconfig.json exists', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { express: '*' } }));
    writeFileSync(join(tmpDir, 'tsconfig.json'), '{}');
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.language).toBe('typescript');
  });

  it('detects prisma database hint', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { '@prisma/client': '^5.0.0', express: '*' },
    }));
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.hasDatabase).toBe(true);
    expect(stack.databaseHints.some(h => h.orm === 'prisma')).toBe(true);
  });

  it('detects multiple database hints', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { typeorm: '*', ioredis: '*' },
    }));
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.databaseHints.length).toBeGreaterThanOrEqual(2);
  });

  it('detects kafka broker', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
      dependencies: { kafkajs: '*', express: '*' },
    }));
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.hasBroker).toBe(true);
    expect(stack.brokerHints.some(b => b.engine === 'kafka')).toBe(true);
  });

  it('extracts PORT from .env file', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: {} }));
    writeFileSync(join(tmpDir, '.env'), 'PORT=3001\nDB_URL=postgres://localhost/db\n');
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.port).toBe(3001);
  });

  it('returns unknown framework when no known dep', () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: {} }));
    const stack = detectTechStack(makeBoundary(tmpDir, 'npm'));
    expect(stack.framework).toBe('unknown');
    expect(stack.hasDatabase).toBe(false);
    expect(stack.hasBroker).toBe(false);
  });
});

describe('detectTechStack — Python', () => {
  it('detects fastapi framework from requirements.txt', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'fastapi==0.104.0\nuvicorn==0.24.0\n');
    const stack = detectTechStack(makeBoundary(tmpDir, 'python'));
    expect(stack.runtime).toBe('python');
    expect(stack.framework).toBe('fastapi');
  });

  it('detects django framework', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'django==4.2.0\n');
    const stack = detectTechStack(makeBoundary(tmpDir, 'python'));
    expect(stack.framework).toBe('django');
    expect(stack.hasDatabase).toBe(true);
  });

  it('detects flask framework', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'flask==3.0.0\n');
    const stack = detectTechStack(makeBoundary(tmpDir, 'python'));
    expect(stack.framework).toBe('flask');
  });

  it('detects sqlalchemy database hint', () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'fastapi\nsqlalchemy\n');
    const stack = detectTechStack(makeBoundary(tmpDir, 'python'));
    expect(stack.databaseHints.some(h => h.orm === 'sqlalchemy')).toBe(true);
  });
});

describe('detectTechStack — Go', () => {
  it('detects chi framework from go.mod', () => {
    writeFileSync(join(tmpDir, 'go.mod'), [
      'module example.com/app',
      'go 1.21',
      'require github.com/go-chi/chi/v5 v5.0.10',
    ].join('\n'));
    const stack = detectTechStack(makeBoundary(tmpDir, 'go'));
    expect(stack.runtime).toBe('go');
    expect(stack.framework).toBe('chi');
  });

  it('detects gin framework', () => {
    writeFileSync(join(tmpDir, 'go.mod'), [
      'module example.com/app',
      'require github.com/gin-gonic/gin v1.9.1',
    ].join('\n'));
    const stack = detectTechStack(makeBoundary(tmpDir, 'go'));
    expect(stack.framework).toBe('gin');
  });

  it('detects gorm database hint', () => {
    writeFileSync(join(tmpDir, 'go.mod'), [
      'module example.com/app',
      'require gorm.io/gorm v1.25.4',
    ].join('\n'));
    const stack = detectTechStack(makeBoundary(tmpDir, 'go'));
    expect(stack.hasDatabase).toBe(true);
    expect(stack.databaseHints.some(h => h.orm === 'gorm')).toBe(true);
  });
});

describe('detectTechStack — Java/Maven', () => {
  it('detects spring framework from pom.xml', () => {
    writeFileSync(join(tmpDir, 'pom.xml'), `
      <project>
        <dependencies>
          <dependency><artifactId>spring-boot-starter-web</artifactId></dependency>
        </dependencies>
      </project>
    `);
    const stack = detectTechStack(makeBoundary(tmpDir, 'maven'));
    expect(stack.runtime).toBe('java');
    expect(stack.framework).toBe('spring');
  });

  it('detects JPA database hint', () => {
    writeFileSync(join(tmpDir, 'pom.xml'), `
      <project>
        <dependencies>
          <dependency><artifactId>spring-data-jpa</artifactId></dependency>
        </dependencies>
      </project>
    `);
    const stack = detectTechStack(makeBoundary(tmpDir, 'maven'));
    expect(stack.hasDatabase).toBe(true);
    expect(stack.databaseHints.some(h => h.orm === 'jpa')).toBe(true);
  });
});

describe('detectTechStack — fallback', () => {
  it('returns safe defaults for unknown manifest type', () => {
    const stack = detectTechStack(makeBoundary(tmpDir, 'docker'));
    expect(stack.framework).toBe('unknown');
    expect(stack.hasDatabase).toBe(false);
    expect(stack.hasBroker).toBe(false);
    expect(stack.databaseHints).toHaveLength(0);
    expect(stack.brokerHints).toHaveLength(0);
  });
});
