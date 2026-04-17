import Parser from 'tree-sitter';
import type { LanguageParser, ParseResult } from './base';
import { emptyResult } from './base';
import type { SourceFile } from '../core/walker';
import type { AnalysisContext, EndpointNode } from '../types/topology';
import { findAll, toLocation, extractStringValue } from '../utils/ast-helpers';
import { nodeId } from '../utils/id';

function loadLanguage(name: string): unknown {
  try {
    const mod = require(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export class RustParser implements LanguageParser {
  readonly supportedExtensions = ['.rs'];

  private parser: Parser | null = null;
  private lang: unknown = null;

  private init(): Parser | null {
    if (this.parser) return this.parser;
    this.lang = loadLanguage('tree-sitter-rust');
    if (!this.lang) return null;
    this.parser = new Parser();
    return this.parser;
  }

  supports(file: SourceFile): boolean {
    return file.extension === '.rs';
  }

  parse(file: SourceFile, context: AnalysisContext): ParseResult {
    const parser = this.init();
    if (!parser || !this.lang) return emptyResult();

    try {
      parser.setLanguage(this.lang as any);
      const tree = parser.parse(file.content);
      const root = tree.rootNode;

      const codeNodes: any[] = [];

      // Actix-web: #[get("/path")] / #[post("/path")]
      codeNodes.push(...extractActixEndpoints(root as any, file.relativePath));

      // Axum: Router::new().route("/path", get(handler))
      codeNodes.push(...extractAxumEndpoints(root as any, file.relativePath));

      return { codeNodes, databases: [], brokers: [] };
    } catch (err) {
      context.diagnostics.push({
        level: 'error',
        message: `Rust parser error in ${file.relativePath}: ${(err as Error).message}`,
        location: { file: file.relativePath, line: 1, column: 0 },
      });
      return emptyResult();
    }
  }
}

const ACTIX_HTTP_ATTRS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

function extractActixEndpoints(root: any, filePath: string): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  // Rust attributes: #[get("/path")]
  const attrItems = findAll(root, 'attribute_item');

  for (const attr of attrItems) {
    const attrText = attr.text;
    const methodMatch = attrText.match(/#\[(\w+)\s*\(\s*["']([^"']+)["']/);
    if (!methodMatch) continue;

    const [, method, path] = methodMatch;
    if (!ACTIX_HTTP_ATTRS.has(method.toLowerCase())) continue;

    // A função logo após o attribute
    const fn = attr.nextNamedSibling;
    const fnName = fn?.childForFieldName('name')?.text ?? 'handler';

    const loc = toLocation(attr, filePath);
    const id = nodeId('endpoint', filePath, loc.line, `${method}:${path}`);

    endpoints.push({
      id,
      type: 'endpoint',
      name: fnName,
      location: loc,
      children: [],
      metadata: {
        method: method.toUpperCase() as EndpointNode['metadata']['method'],
        path,
        framework: 'actix',
        request: extractRustPathParams(path),
        responses: [],
      },
    });
  }

  return endpoints;
}

function extractAxumEndpoints(root: any, filePath: string): EndpointNode[] {
  const endpoints: EndpointNode[] = [];

  // .route("/path", get(handler)) ou .route("/path", post(handler))
  const calls = findAll(root, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn) continue;

    // method_call: obj.route(...)
    if (fn.type !== 'field_expression') continue;

    const methodName = fn.childForFieldName('field')?.text ?? '';
    if (methodName !== 'route') continue;

    const args = call.childForFieldName('arguments');
    if (!args) continue;

    const argNodes = args.namedChildren;
    if (argNodes.length < 2) continue;

    const pathArg = argNodes[0];
    const handlerArg = argNodes[1];

    const path = extractStringValue(pathArg as any);
    if (!path) continue;

    // get(handler) / post(handler) / ...
    const handlerText = handlerArg.text;
    const methodMatch = handlerText.match(/^(get|post|put|patch|delete|options|head)\s*\(/i);
    if (!methodMatch) continue;

    const method = methodMatch[1].toUpperCase();
    const loc = toLocation(call, filePath);
    const id = nodeId('endpoint', filePath, loc.line, `${method}:${path}`);

    endpoints.push({
      id,
      type: 'endpoint',
      name: path,
      location: loc,
      children: [],
      metadata: {
        method: method as EndpointNode['metadata']['method'],
        path,
        framework: 'axum',
        request: extractRustPathParams(path),
        responses: [],
      },
    });
  }

  return endpoints;
}

function extractRustPathParams(path: string): EndpointNode['metadata']['request'] {
  // Axum: /users/:id, Actix: /users/{id}
  const colonParams = [...path.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(m => ({
    name: m[1], type: 'String', required: true,
  }));
  const braceParams = [...path.matchAll(/\{([^}]+)\}/g)].map(m => ({
    name: m[1], type: 'String', required: true,
  }));
  const params = [...colonParams, ...braceParams];
  return { params: params.length > 0 ? params : undefined };
}
