import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext, EndpointNode } from '../types/topology';
import { findAll, toLocation } from '../utils/ast-helpers';
import { nodeId } from '../utils/id';

function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class CSharpParser implements LanguageParser {
  readonly supportedExtensions = ['.cs'];

  private parser: Parser | null = null;
  private lang: unknown = null;

  private init(): Parser | null {
    if (this.parser) return this.parser;
    this.lang = loadLanguage('tree-sitter-c-sharp');
    if (!this.lang) return null;
    this.parser = new Parser();
    return this.parser;
  }

  supports(file: SourceFile): boolean {
    return file.extension === '.cs';
  }

  parse(file: SourceFile, context: AnalysisContext): ParseResult {
    const parser = this.init();
    if (!parser || !this.lang) return emptyResult();

    try {
      parser.setLanguage(this.lang as any);
      const tree = parser.parse(file.content);
      const root = tree.rootNode;

      const codeNodes: any[] = [];
      codeNodes.push(...extractAspNetEndpoints(root as any, file.relativePath));

      return { codeNodes, databases: [], brokers: [] };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `C# parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}

const ASPNET_HTTP_ATTRS: Record<string, EndpointNode['metadata']['method']> = {
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpPatch: 'PATCH',
  HttpDelete: 'DELETE',
};

function extractAspNetEndpoints(root: any, filePath: string): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  const classes = findAll(root, 'class_declaration');

  for (const cls of classes) {
    // Verifica [ApiController] ou [Route("...")]
    const attrs = findAll(cls, 'attribute');
    const isController = attrs.some(a => {
      const text = a.text;
      return text.includes('ApiController') || text.includes('Controller');
    });
    if (!isController) continue;

    const routeAttr = attrs.find(a => a.text.includes('Route'));
    const basePath = routeAttr
      ? (routeAttr.text.match(/["']([^"']+)["']/) ?? [])[1] ?? ''
      : '';

    const className = cls.childForFieldName('name')?.text ?? 'Controller';

    const methods = findAll(cls, 'method_declaration');

    for (const method of methods) {
      const methodAttrs = findAll(method, 'attribute');
      const httpAttr = methodAttrs.find(a =>
        Object.keys(ASPNET_HTTP_ATTRS).some(k => a.text.includes(k))
      );
      if (!httpAttr) continue;

      const httpKey = Object.keys(ASPNET_HTTP_ATTRS).find(k => httpAttr.text.includes(k)) ?? 'HttpGet';
      const httpMethod = ASPNET_HTTP_ATTRS[httpKey];

      // Extrai path do atributo: [HttpGet("users/{id}")]
      const pathMatch = httpAttr.text.match(/["']([^"']+)["']/);
      const methodPath = pathMatch ? pathMatch[1] : '';
      const fullPath = joinPaths(basePath, methodPath);

      const methodName = method.childForFieldName('name')?.text ?? 'Action';
      const loc = toLocation(method, filePath);
      const id = nodeId('endpoint', filePath, loc.line, `${className}.${methodName}`);

      endpoints.push({
        id,
        type: 'endpoint',
        name: `${className}.${methodName}`,
        location: loc,
        children: [],
        metadata: {
          method: httpMethod,
          path: fullPath,
          framework: 'aspnet',
          controller: className,
          request: extractAspNetPathParams(fullPath),
          responses: [],
        },
      });
    }
  }

  return endpoints;
}

function extractAspNetPathParams(path: string): EndpointNode['metadata']['request'] {
  const params = [...path.matchAll(/\{([^}:?]+)/g)].map(m => ({
    name: m[1], type: 'string', required: true,
  }));
  return { params: params.length > 0 ? params : undefined };
}

function joinPaths(base: string, path: string): string {
  // ASP.NET usa [controller] e [action] como placeholders
  const clean = [base, path]
    .map(p => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return '/' + (clean || '');
}
