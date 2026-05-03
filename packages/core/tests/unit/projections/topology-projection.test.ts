import { describe, it, expect } from 'vitest';
import {
  buildServiceFlowGraph,
  projectEndpointFlow,
} from '../../../src/projections/topology-projection';
import type {
  CodeNode, FlowControlNode, DbProcessNode, ExternalCallNode, ThrowNode,
} from '../../../src/types/topology';
import type { SourceFile } from '../../../src/core/walker';

/**
 * Inline TS fixture exercising the three Fase 0 projection features:
 *   • #6  branches[] populated for `if/else`
 *   • #5  Prisma call → dbProcess
 *   • #4  axios.get / fetch → externalCall
 */
const FIXTURE_SOURCE = `
import axios from 'axios';

class PrismaClient {
  user!: {
    findMany: (args?: any) => Promise<any[]>;
    create: (args: any) => Promise<any>;
  };
}

export class OrderService {
  prisma = new PrismaClient();

  async handleOrder(input: { id: number; force: boolean }): Promise<any> {
    if (input.force) {
      const fresh = await axios.get(\`/api/users/\${input.id}\`);
      return fresh;
    } else {
      const cached = await fetch('https://cache.example.com/orders');
      const users = await this.prisma.user.findMany({ where: { id: input.id } });
      return { users, cached };
    }
  }
}
`;

function makeFile(): SourceFile {
  return {
    absolutePath: '/virtual/order.service.ts',
    relativePath: 'order.service.ts',
    extension: '.ts',
    language: 'typescript',
    content: FIXTURE_SOURCE,
    sizeBytes: FIXTURE_SOURCE.length,
  };
}

/** Walk the projected tree, normalizing volatile fields (ids, locations). */
function normalize(nodes: CodeNode[]): unknown[] {
  return nodes.map(n => {
    const { id: _id, location: _loc, children, ...rest } = n as CodeNode & { children: CodeNode[] };
    const out: any = { ...rest, children: normalize(children) };
    // normalize branches[] (type-narrow to flowControl)
    if (n.type === 'flowControl') {
      const b = (n as FlowControlNode).metadata.branches;
      if (b) {
        out.metadata = {
          ...out.metadata,
          branches: b.map(br => ({ label: br.label, children: normalize(br.children) })),
        };
      }
    }
    return out;
  });
}

function findMethodId(graph: ReturnType<typeof buildServiceFlowGraph>, name: string): string {
  for (const el of graph.getElementsByKind('method')) {
    if (el.name === name) return el.id;
  }
  throw new Error(`method not found: ${name}`);
}

function flatten(nodes: CodeNode[]): CodeNode[] {
  const out: CodeNode[] = [];
  const walk = (n: CodeNode) => {
    out.push(n);
    n.children?.forEach(walk);
    if (n.type === 'flowControl') {
      (n as FlowControlNode).metadata.branches?.forEach(b => b.children.forEach(walk));
    }
  };
  nodes.forEach(walk);
  return out;
}

describe('topology-projection — Fase 0 features', () => {
  const graph = buildServiceFlowGraph([makeFile()]);
  const methodId = findMethodId(graph, 'handleOrder');
  const projected = projectEndpointFlow(graph, methodId);
  const all = flatten(projected);


  it('#6 — branch flowControl carries metadata.branches with then/else', () => {
    const ifNode = all.find(
      n => n.type === 'flowControl' && (n as FlowControlNode).metadata.kind === 'if',
    ) as FlowControlNode | undefined;
    expect(ifNode).toBeDefined();
    expect(ifNode!.metadata.branches).toBeDefined();
    const labels = ifNode!.metadata.branches!.map(b => b.label);
    expect(labels).toContain('then');
    expect(labels).toContain('else');
    // Outer children of a `branch` flowControl should be empty — content lives in branches[]
    expect(ifNode!.children).toEqual([]);
  });

  it('#5 — Prisma call is projected as dbProcess', () => {
    const dbs = all.filter(n => n.type === 'dbProcess') as DbProcessNode[];
    expect(dbs.length).toBeGreaterThan(0);
    const prisma = dbs.find(d => d.metadata.orm === 'prisma');
    expect(prisma).toBeDefined();
    expect(prisma!.metadata.tableId).toBe('user');
    expect(prisma!.metadata.operation).toBe('findMany');
  });

  it('#4 — axios.get and fetch are projected as externalCall', () => {
    const exts = all.filter(n => n.type === 'externalCall') as ExternalCallNode[];
    const axiosCall = exts.find(e => e.metadata.httpClient === 'axios');
    const fetchCall = exts.find(e => e.metadata.httpClient === 'fetch');
    expect(axiosCall).toBeDefined();
    expect(axiosCall!.metadata.method).toBe('GET');
    // template-literal `${id}` placeholder should be normalized to `:param`
    expect(axiosCall!.metadata.path).toBe('/api/users/:param');
    expect(fetchCall).toBeDefined();
    expect(fetchCall!.metadata.method).toBe('GET');
    expect(fetchCall!.metadata.baseUrl).toBe('https://cache.example.com');
    expect(fetchCall!.metadata.path).toBe('/orders');
  });

  it('matches normalized snapshot', () => {
    expect(normalize(projected)).toMatchSnapshot();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fase 2 #3 — throw labels ricos: inferHttpStatus extended heuristics
// ─────────────────────────────────────────────────────────────────────────

const THROW_FIXTURE_SOURCE = `
class BadRequestException extends Error {}
class UserNotFoundError extends Error {}
class IllegalArgumentException extends Error {}
class CustomDomainBoom extends Error {}

export class CheckoutService {
  validate(x: number): void {
    if (x < 0) {
      throw new BadRequestException('negative');
    }
    if (x > 1000) {
      throw new IllegalArgumentException('too large');
    }
    if (x === 42) {
      throw new UserNotFoundError('not found');
    }
    throw new CustomDomainBoom('mystery');
  }
}
`;

function makeThrowFile(): SourceFile {
  return {
    absolutePath: '/virtual/checkout.service.ts',
    relativePath: 'checkout.service.ts',
    extension: '.ts',
    language: 'typescript',
    content: THROW_FIXTURE_SOURCE,
    sizeBytes: THROW_FIXTURE_SOURCE.length,
  };
}

describe('topology-projection — Fase 2 #3 throw labels', () => {
  const graph = buildServiceFlowGraph([makeThrowFile()]);
  const methodId = findMethodId(graph, 'validate');
  const projected = projectEndpointFlow(graph, methodId);
  const throws = flatten(projected).filter((n): n is ThrowNode => n.type === 'throw');

  it('infers httpStatus for NestJS-style class names (exact match)', () => {
    const t = throws.find(t => t.metadata.errorClass === 'BadRequestException');
    expect(t).toBeDefined();
    expect(t!.metadata.httpStatus).toBe(400);
  });

  it('infers httpStatus for Spring/Jakarta names (exact match)', () => {
    const t = throws.find(t => t.metadata.errorClass === 'IllegalArgumentException');
    expect(t).toBeDefined();
    expect(t!.metadata.httpStatus).toBe(400);
  });

  it('infers httpStatus via substring (NotFound suffix)', () => {
    const t = throws.find(t => t.metadata.errorClass === 'UserNotFoundError');
    expect(t).toBeDefined();
    expect(t!.metadata.httpStatus).toBe(404);
  });

  it('leaves httpStatus undefined for uninformative names', () => {
    const t = throws.find(t => t.metadata.errorClass === 'CustomDomainBoom');
    expect(t).toBeDefined();
    expect(t!.metadata.httpStatus).toBeUndefined();
  });

  it('captures the constructor message text', () => {
    const t = throws.find(t => t.metadata.errorClass === 'BadRequestException');
    expect(t!.metadata.message).toBe('negative');
  });
});
