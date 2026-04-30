import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildGraph,
  buildFlowTree,
  callersOf,
  calleesOf,
  deadCode,
  throwSitesReachableFrom,
  depthFromEntry,
  cycles,
  unresolvedCalls,
  isTsParserAvailable,
  type SourceFile,
  type FlowNode,
  type ElementGraph,
  type Element,
} from '../../src';

const FIX_DIR = join(__dirname, '..', 'fixtures', 'api');
const PARSER_OK = isTsParserAvailable();

function load(name: string): SourceFile {
  return {
    path: `api/${name}`,
    content: readFileSync(join(FIX_DIR, name), 'utf8'),
    extension: '.ts',
    language: 'typescript',
  };
}

function api() {
  return buildGraph([
    load('users.repository.ts'),
    load('users.service.ts'),
    load('users.controller.ts'),
  ]);
}

function find(graph: ElementGraph, kind: Parameters<ElementGraph['getElementsByKind']>[0], name: string): Element {
  const el = graph.getElementsByKind(kind).find(e => e.name === name);
  if (!el) throw new Error(`não achei ${kind} '${name}'`);
  return el;
}

function flatten(node: FlowNode, depth = 0): Array<{ depth: number; node: FlowNode }> {
  const out = [{ depth, node }];
  for (const c of node.children) out.push(...flatten(c, depth + 1));
  return out;
}

describe.skipIf(!PARSER_OK)('buildGraph (orquestrador)', () => {
  it('processa todos os arquivos do fixture e roda resolvers', () => {
    const r = api();
    expect(r.stats.filesProcessed).toBe(3);
    expect(r.stats.filesSkipped).toBe(0);
    expect(r.stats.elementCount).toBeGreaterThan(0);
    expect(r.stats.edgeCount).toBeGreaterThan(0);
    expect(r.stats.errors).toEqual([]);
    expect(r.stats.resolver.callsResolved).toBeGreaterThanOrEqual(2);
  });
});

describe.skipIf(!PARSER_OK)('buildFlowTree', () => {
  it('aceite §A.5: a partir de createUser, FlowTree expande até UsersRepository.save', () => {
    const { graph } = api();
    const ctrl = find(graph, 'class', 'UsersController');
    const createUser = graph.getChildren(ctrl.id).find(c => c.name === 'createUser')!;
    const tree = buildFlowTree(createUser.id, graph);

    expect(tree.root.elementId).toBe(createUser.id);
    expect(tree.stats.totalNodes).toBeGreaterThan(0);

    const flat = flatten(tree.root);
    const labels = flat.map(({ node }) => node.label);
    // Espera-se que apareça em algum nível: throw_site, return, e expansão para create()
    const hasReturn = labels.some(l => l.includes('return'));
    expect(hasReturn).toBe(true);

    // O nó com edgeKind 'calls' deve existir (expansão de this.usersService.create)
    const callsExpansion = flat.find(({ node }) => node.edgeKind === 'calls' && !node.marker);
    expect(callsExpansion).toBeDefined();

    // E deve eventualmente alcançar UsersRepository.save (expansão da chain)
    const repoSave = find(graph, 'class', 'UsersRepository');
    const saveMethod = graph.getChildren(repoSave.id).find(c => c.name === 'save')!;
    const reached = flat.find(({ node }) => node.elementId === saveMethod.id);
    expect(reached).toBeDefined();
  });

  it('respeita maxDepth — produz folhas marker max_depth', () => {
    const { graph } = api();
    const createUser = graph.getChildren(find(graph, 'class', 'UsersController').id).find(c => c.name === 'createUser')!;
    const tree = buildFlowTree(createUser.id, graph, { maxDepth: 1 });
    const flat = flatten(tree.root);
    const truncated = flat.find(({ node }) => node.marker === 'max_depth');
    expect(truncated).toBeDefined();
  });

  it('detecta ciclo simples (auto-recursão) e emite marker cycle', () => {
    const recur: SourceFile = {
      path: 'recur.ts',
      content: `
        export class R {
          loop(n: number): number {
            if (n <= 0) return 0;
            return this.loop(n - 1);
          }
        }
      `,
      extension: '.ts',
      language: 'typescript',
    };
    const { graph } = buildGraph([recur]);
    const r = find(graph, 'class', 'R');
    const loop = graph.getChildren(r.id).find(c => c.name === 'loop')!;
    const tree = buildFlowTree(loop.id, graph);
    const flat = flatten(tree.root);
    const cycle = flat.find(({ node }) => node.marker === 'cycle');
    expect(cycle).toBeDefined();
    expect(tree.stats.detectedCycles.length).toBeGreaterThanOrEqual(1);
  });
});

describe.skipIf(!PARSER_OK)('queries', () => {
  it('callersOf(UsersService.create) inclui UsersController.createUser', () => {
    const { graph } = api();
    const svc = find(graph, 'class', 'UsersService');
    const create = graph.getChildren(svc.id).find(c => c.name === 'create')!;
    const callers = callersOf(graph, create.id);
    const ctrlMethod = callers.find(c => c.name === 'createUser');
    expect(ctrlMethod).toBeDefined();
  });

  it('calleesOf(UsersController.createUser) inclui UsersService.create', () => {
    const { graph } = api();
    const ctrl = find(graph, 'class', 'UsersController');
    const createUser = graph.getChildren(ctrl.id).find(c => c.name === 'createUser')!;
    const callees = calleesOf(graph, createUser.id);
    expect(callees.some(c => c.name === 'create')).toBe(true);
  });

  it('deadCode lista métodos sem callers', () => {
    const { graph } = api();
    // findById e find existem mas só find chama findById; createUser é entry-like
    const dead = deadCode(graph, el => el.name === 'createUser');
    const names = dead.map(d => d.name);
    // createUser está excluído; mas createUser e outras entradas sem callers entram aqui
    expect(Array.isArray(dead)).toBe(true);
    expect(names).not.toContain('create'); // create É chamado
    expect(names).not.toContain('save');   // save É chamado
  });

  it('throwSitesReachableFrom(createUser) inclui o throw new Error', () => {
    const { graph } = api();
    const ctrl = find(graph, 'class', 'UsersController');
    const createUser = graph.getChildren(ctrl.id).find(c => c.name === 'createUser')!;
    const thr = throwSitesReachableFrom(graph, createUser.id);
    expect(thr.length).toBeGreaterThanOrEqual(1);
  });

  it('depthFromEntry(createUser → save) é finito e > 0', () => {
    const { graph } = api();
    const ctrl = find(graph, 'class', 'UsersController');
    const createUser = graph.getChildren(ctrl.id).find(c => c.name === 'createUser')!;
    const repo = find(graph, 'class', 'UsersRepository');
    const save = graph.getChildren(repo.id).find(c => c.name === 'save')!;
    const d = depthFromEntry(graph, createUser.id, save.id);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(20);
  });

  it('cycles() retorna array vazio na fixture api/ (sem recursão)', () => {
    const { graph } = api();
    expect(cycles(graph)).toEqual([]);
  });

  it('unresolvedCalls inclui call_sites externos (ex.: Promise.resolve)', () => {
    const file: SourceFile = {
      path: 'ext.ts',
      content: `
        export async function f() {
          const x = await Promise.resolve(1);
          return x;
        }
      `,
      extension: '.ts',
      language: 'typescript',
    };
    const { graph } = buildGraph([file]);
    const u = unresolvedCalls(graph);
    expect(u.length).toBeGreaterThanOrEqual(1);
  });
});
