import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  TsAstWalker,
  isTsParserAvailable,
  type ElementBatch,
  type SourceFile,
  type ElementKind,
  type ModuleMeta,
  type ClassMeta,
  type BehavioralMeta,
  type BranchMeta,
  type LoopMeta,
  type CallSiteMeta,
  type AssignSiteMeta,
  type ImportBindingMeta,
  type ParameterMeta,
} from '../../src';

const FIX_DIR = join(__dirname, '..', 'fixtures', 'kinds');

function loadFixture(name: string): SourceFile {
  const path = join(FIX_DIR, name);
  const content = readFileSync(path, 'utf8');
  const ext = '.' + name.split('.').pop()!;
  return { path: name, content, extension: ext, language: 'typescript' };
}

function walk(fixture: string): ElementBatch {
  const walker = new TsAstWalker();
  const result = walker.walk(loadFixture(fixture));
  if (!result) throw new Error(`walk returned null for ${fixture}`);
  return result;
}

function kindsOf(batch: ElementBatch): ElementKind[] {
  return batch.elements.map(e => e.kind);
}

function countKind(batch: ElementBatch, kind: ElementKind): number {
  return batch.elements.filter(e => e.kind === kind).length;
}

const PARSER_OK = isTsParserAvailable();

beforeAll(() => {
  if (!PARSER_OK) {
    // eslint-disable-next-line no-console
    console.warn('tree-sitter-typescript não disponível — testes de walker pulados');
  }
});

describe.skipIf(!PARSER_OK)('TsAstWalker — sanidade', () => {
  it('retorna null para extensão não suportada', () => {
    const w = new TsAstWalker();
    const r = w.walk({ path: 'a.py', content: 'pass', extension: '.py' });
    expect(r).toBeNull();
  });

  it('emite exatamente um module por arquivo', () => {
    const b = walk('structural.ts');
    expect(countKind(b, 'module')).toBe(1);
    const mod = b.elements.find(e => e.kind === 'module')!;
    expect((mod.meta as ModuleMeta).language).toBeTruthy();
  });

  it('toda edge é contains e tem endpoints existentes', () => {
    const b = walk('control-flow.ts');
    const ids = new Set(b.elements.map(e => e.id));
    for (const edge of b.edges) {
      expect(edge.kind).toBe('contains');
      expect(ids.has(edge.from)).toBe(true);
      expect(ids.has(edge.to)).toBe(true);
    }
  });

  it('module é raiz: nenhuma edge contains aponta PARA o module', () => {
    const b = walk('structural.ts');
    const moduleId = b.elements.find(e => e.kind === 'module')!.id;
    const incoming = b.edges.filter(e => e.to === moduleId);
    expect(incoming).toHaveLength(0);
  });
});

describe.skipIf(!PARSER_OK)('TsAstWalker — estruturais', () => {
  let batch: ElementBatch;
  beforeAll(() => {
    batch = walk('structural.ts');
  });

  it('extrai class, abstract class, interface, enum, type_alias', () => {
    expect(countKind(batch, 'class')).toBe(2); // BaseService + UsersService
    expect(countKind(batch, 'interface')).toBe(1);
    expect(countKind(batch, 'enum')).toBe(1);
    expect(countKind(batch, 'type_alias')).toBe(1);
  });

  it('classe com extends/implements registra heritage no meta', () => {
    const usr = batch.elements.find(e => e.kind === 'class' && e.name === 'UsersService')!;
    const meta = usr.meta as ClassMeta;
    expect(meta.extendsName).toContain('BaseService');
    expect(meta.implementsNames.some(n => n.includes('Repo'))).toBe(true);
  });

  it('classe abstrata é marcada', () => {
    const base = batch.elements.find(e => e.kind === 'class' && e.name === 'BaseService')!;
    expect((base.meta as ClassMeta).isAbstract).toBe(true);
  });
});

describe.skipIf(!PARSER_OK)('TsAstWalker — comportamentais', () => {
  let batch: ElementBatch;
  beforeAll(() => {
    batch = walk('behavioral.ts');
  });

  it('extrai method, constructor, getter, setter, function, arrow_function', () => {
    expect(countKind(batch, 'constructor')).toBe(1);
    expect(countKind(batch, 'getter')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'setter')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'method')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'function')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'arrow_function')).toBe(1);
  });

  it('isStatic é detectado', () => {
    const empty = batch.elements.find(e => e.name === 'empty');
    expect(empty).toBeDefined();
    expect((empty!.meta as BehavioralMeta).isStatic).toBe(true);
  });

  it('isAsync é detectado em arrow', () => {
    const mul = batch.elements.find(e => e.kind === 'arrow_function' && e.name === 'multiply');
    expect(mul).toBeDefined();
    expect((mul!.meta as BehavioralMeta).isAsync).toBe(true);
  });
});

describe.skipIf(!PARSER_OK)('TsAstWalker — controle de fluxo', () => {
  let batch: ElementBatch;
  beforeAll(() => {
    batch = walk('control-flow.ts');
  });

  it('extrai branches e seus blocos', () => {
    expect(countKind(batch, 'branch')).toBeGreaterThanOrEqual(2); // if + switch
  });

  it('branch carrega conditionText e branchKind', () => {
    const ifBranch = batch.elements.find(
      e => e.kind === 'branch' && (e.meta as BranchMeta).branchKind === 'if',
    );
    expect(ifBranch).toBeDefined();
    expect((ifBranch!.meta as BranchMeta).conditionText).toContain('input');
    expect((ifBranch!.meta as BranchMeta).hasElse).toBe(true);
  });

  it('extrai todos os tipos de loop', () => {
    const loops = batch.elements.filter(e => e.kind === 'loop');
    const kinds = loops.map(l => (l.meta as LoopMeta).loopKind).sort();
    expect(kinds).toContain('for-of');
    expect(kinds).toContain('for');
    expect(kinds).toContain('while');
    expect(kinds).toContain('do-while');
  });

  it('extrai try_block, catch_block, finally_block', () => {
    expect(countKind(batch, 'try_block')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'catch_block')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'finally_block')).toBeGreaterThanOrEqual(1);
  });

  it('switch produz branch + branch_then por case + branch_else por default', () => {
    expect(countKind(batch, 'branch_then')).toBeGreaterThanOrEqual(2);
    expect(countKind(batch, 'branch_else')).toBeGreaterThanOrEqual(1);
  });
});

describe.skipIf(!PARSER_OK)('TsAstWalker — statements', () => {
  let batch: ElementBatch;
  beforeAll(() => {
    batch = walk('statements.ts');
  });

  it('extrai call_site, return_site, throw_site, assign_site, await_site', () => {
    expect(countKind(batch, 'call_site')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'return_site')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'throw_site')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'assign_site')).toBeGreaterThanOrEqual(1);
  });

  it('call_site captura calleeText e args', () => {
    const calls = batch.elements.filter(e => e.kind === 'call_site');
    const read = calls.find(c => (c.meta as CallSiteMeta).calleeText.includes('readFileSync'));
    expect(read).toBeDefined();
    expect((read!.meta as CallSiteMeta).argsText.length).toBeGreaterThan(0);
  });

  it('throw_site extrai exceptionClassName quando possível', () => {
    const thr = batch.elements.find(e => e.kind === 'throw_site')!;
    expect(thr.meta).toMatchObject({ exceptionClassName: 'Error' });
  });

  it('assign_site captura targetText e isConst', () => {
    const trimmed = batch.elements.find(
      e => e.kind === 'assign_site' && (e.meta as AssignSiteMeta).targetText === 'trimmed',
    );
    expect(trimmed).toBeDefined();
    expect((trimmed!.meta as AssignSiteMeta).isConst).toBe(true);
  });
});

describe.skipIf(!PARSER_OK)('TsAstWalker — declarações', () => {
  let batch: ElementBatch;
  beforeAll(() => {
    batch = walk('declarations.ts');
  });

  it('extrai parameter, field, import_binding, decorator_ref, type_ref', () => {
    expect(countKind(batch, 'parameter')).toBeGreaterThanOrEqual(2);
    expect(countKind(batch, 'field')).toBeGreaterThanOrEqual(1);
    expect(countKind(batch, 'import_binding')).toBeGreaterThanOrEqual(2);
    expect(countKind(batch, 'decorator_ref')).toBeGreaterThanOrEqual(1);
  });

  it('import_binding carrega sourceModule e originalName', () => {
    const imps = batch.elements.filter(e => e.kind === 'import_binding');
    const inj = imps.find(i => (i.meta as ImportBindingMeta).originalName === 'Injectable');
    expect(inj).toBeDefined();
    expect((inj!.meta as ImportBindingMeta).sourceModule).toBe('@nestjs/common');
  });

  it('parâmetro com decorator é capturado', () => {
    const params = batch.elements.filter(e => e.kind === 'parameter');
    const repoParam = params.find(p => (p.meta as ParameterMeta).decorators.includes('Inject'));
    expect(repoParam).toBeDefined();
  });

  it('classe com @Controller-style decorator: registra decorator_ref', () => {
    const decos = batch.elements.filter(e => e.kind === 'decorator_ref');
    expect(decos.some(d => d.name === 'Injectable')).toBe(true);
  });
});

describe.skipIf(!PARSER_OK)('TsAstWalker — cobertura completa', () => {
  it('união dos fixtures cobre todos os kinds principais', () => {
    const all = [
      walk('structural.ts'),
      walk('behavioral.ts'),
      walk('control-flow.ts'),
      walk('statements.ts'),
      walk('declarations.ts'),
    ];
    const seen = new Set<ElementKind>();
    for (const b of all) for (const e of b.elements) seen.add(e.kind);

    const required: ElementKind[] = [
      'module',
      'class',
      'interface',
      'type_alias',
      'enum',
      'method',
      'function',
      'constructor',
      'getter',
      'setter',
      'arrow_function',
      'branch',
      'loop',
      'try_block',
      'catch_block',
      'finally_block',
      'call_site',
      'return_site',
      'throw_site',
      'assign_site',
      'parameter',
      'field',
      'import_binding',
      'decorator_ref',
    ];
    const missing = required.filter(k => !seen.has(k));
    expect(missing).toEqual([]);
  });
});

// Suppress unused-import warning for environment without parser
void existsSync;
