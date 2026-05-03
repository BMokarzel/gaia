import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import { extractNestEndpoints } from '../../../src/extractors/ts/endpoint/nest.extractor';
import { extractExpressEndpoints } from '../../../src/extractors/ts/endpoint/express.extractor';
import { buildServiceNode } from '../../../src/builders/service.builder';
import type { ServiceBoundary } from '../../../src/core/walker';
import type { ServiceTechStack } from '../../../src/core/detector';
import type {
  CodeNode, EndpointNode, MiddlewareNode, FunctionNode,
} from '../../../src/types/topology';

/* eslint-disable @typescript-eslint/no-var-requires */
const tsModule: any = require('tree-sitter-typescript');
const tsLang: any = tsModule.typescript ?? tsModule;

function parse(source: string): any {
  const p = new Parser();
  p.setLanguage(tsLang);
  return p.parse(source).rootNode;
}

const NEST_FIXTURE = `
import { Controller, Get, Post, UseGuards, UsePipes, UseInterceptors, HttpCode } from '@nestjs/common';

class AuthGuard {}
class RoleGuard {}
class ValidationPipe {}
class LoggingInterceptor {}

@Controller('orders')
export class OrdersController {
  @Get()
  @UseGuards(AuthGuard, RoleGuard)
  @UsePipes(ValidationPipe)
  list() {
    return [];
  }

  @Post()
  @UseInterceptors(LoggingInterceptor)
  @HttpCode(201)
  create() {
    return {};
  }
}
`;

const EXPRESS_FIXTURE = `
import express from 'express';
const app = express();

function authMw(req, res, next) { next(); }
function logMw(req, res, next) { next(); }

app.get('/users/:id', authMw, logMw, (req, res) => {
  res.json({ id: req.params.id });
});
`;

describe('middleware extraction — Fase 0 #16', () => {
  describe('NestJS', () => {
    const root = parse(NEST_FIXTURE);
    const { endpoints } = extractNestEndpoints(root, 'orders.controller.ts');

    it('extracts middleware as MiddlewareDetail[] with kind classification', () => {
      const list = endpoints.find(e => e.name === 'OrdersController.list');
      expect(list).toBeDefined();
      const mw = list!.metadata.middleware;
      expect(mw).toBeDefined();
      // 2 guards + 1 pipe
      expect(mw!.length).toBe(3);

      const kinds = mw!.map(m => m.kind);
      expect(kinds.filter(k => k === 'guard').length).toBe(2);
      expect(kinds.filter(k => k === 'pipe').length).toBe(1);

      // All entries are framework=nest
      expect(mw!.every(m => m.framework === 'nest')).toBe(true);

      // Source decorator name preserved
      const guards = mw!.filter(m => m.kind === 'guard');
      expect(guards.map(g => g.name).sort()).toEqual(['AuthGuard', 'RoleGuard']);
      expect(guards.every(g => g.source === 'UseGuards')).toBe(true);

      // Order is monotonic across decorators on this method
      const orders = mw!.map(m => m.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it('classifies @HttpCode/@UseInterceptors correctly', () => {
      const create = endpoints.find(e => e.name === 'OrdersController.create');
      expect(create).toBeDefined();
      const mw = create!.metadata.middleware!;
      const interceptor = mw.find(m => m.kind === 'interceptor');
      const decorator = mw.find(m => m.kind === 'decorator');
      expect(interceptor?.name).toBe('LoggingInterceptor');
      expect(interceptor?.source).toBe('UseInterceptors');
      expect(decorator?.source).toBe('HttpCode');
    });
  });

  describe('Express', () => {
    const root = parse(EXPRESS_FIXTURE);
    const endpoints = extractExpressEndpoints(root, 'app.ts');

    it('extracts intermediate args as middleware with kind=middleware', () => {
      expect(endpoints.length).toBe(1);
      const mw = endpoints[0].metadata.middleware!;
      expect(mw.length).toBe(2);
      expect(mw.map(m => m.name)).toEqual(['authMw', 'logMw']);
      expect(mw.every(m => m.kind === 'middleware')).toBe(true);
      expect(mw.every(m => m.framework === 'express')).toBe(true);
      expect(mw.map(m => m.order)).toEqual([0, 1]);
    });
  });

  describe('service builder — prependMiddlewareNodes', () => {
    it('materializes MiddlewareNode entries at the head of endpoint.children', () => {
      const root = parse(NEST_FIXTURE);
      const { endpoints, functions } = extractNestEndpoints(root, 'orders.controller.ts');

      const boundary: ServiceBoundary = {
        rootPath: '/virtual/orders',
        name: 'orders-service',
        files: [],
      } as ServiceBoundary;
      const stack: ServiceTechStack = {
        runtime: 'node',
        language: 'typescript',
        framework: 'nest',
        hasGraphQL: false,
        hasGRPC: false,
        hasBroker: false,
      } as ServiceTechStack;

      const codeNodes: CodeNode[] = [...endpoints, ...functions];
      const service = buildServiceNode(boundary, stack, codeNodes);

      const list = service.endpoints.find(e => e.name === 'OrdersController.list')!;
      // First 3 children must be MiddlewareNode in source order
      const firstThree = list.children.slice(0, 3);
      expect(firstThree.every(n => n.type === 'middleware')).toBe(true);

      const mwChildren = firstThree as MiddlewareNode[];
      expect(mwChildren.map(m => m.metadata.kind)).toEqual(['guard', 'guard', 'pipe']);
      expect(mwChildren.map(m => m.name)).toEqual(['AuthGuard', 'RoleGuard', 'ValidationPipe']);
      expect(mwChildren.map(m => m.metadata.order)).toEqual([0, 1, 2]);

      // Each MiddlewareNode has a stable id
      const ids = mwChildren.map(m => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
