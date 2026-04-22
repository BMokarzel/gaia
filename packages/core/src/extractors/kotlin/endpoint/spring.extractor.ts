import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode, FunctionNode } from '../../../types/topology';

const SPRING_ANNOTATIONS: Record<string, EndpointNode['metadata']['method']> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  PatchMapping: 'PATCH',
  DeleteMapping: 'DELETE',
  RequestMapping: 'GET',
};

/**
 * Extrai endpoints Spring Boot de arquivos Kotlin.
 *
 * Kotlin tree-sitter AST não usa named fields — toda navegação é por tipo de nó filho.
 * annotation → namedChildren[0]:
 *   - user_type { type_identifier }       → @RestController
 *   - constructor_invocation { user_type, value_arguments } → @GetMapping("/items")
 */
export function extractKotlinSpringEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): { endpoints: EndpointNode[]; functions: FunctionNode[] } {
  const endpoints: EndpointNode[] = [];
  const functions: FunctionNode[] = [];

  const classes = findAll(rootNode, 'class_declaration');

  for (const classNode of classes) {
    const modifiers = findAll(classNode, 'annotation');
    const isController = modifiers.some(a =>
      ['RestController', 'Controller'].includes(getAnnotationName(a)),
    );

    if (!isController) continue;

    // class name: namedChildren of type type_identifier
    const className = classNode.namedChildren
      .find(c => c.type === 'type_identifier')?.text ?? 'Controller';

    const requestMappingAnn = modifiers.find(a => getAnnotationName(a) === 'RequestMapping');
    const basePath = requestMappingAnn ? extractAnnotationValue(requestMappingAnn) ?? '' : '';

    const funDeclarations = findAll(classNode, 'function_declaration');

    for (const fun of funDeclarations) {
      const funAnnotations = findAll(fun, 'annotation');
      const httpAnnotation = funAnnotations.find(a => getAnnotationName(a) in SPRING_ANNOTATIONS);
      if (!httpAnnotation) continue;

      const annotationName = getAnnotationName(httpAnnotation);
      const httpMethod = SPRING_ANNOTATIONS[annotationName] ?? 'GET';
      const methodPath = extractAnnotationValue(httpAnnotation) ?? '';
      const fullPath = joinPaths(basePath, methodPath);

      // function name: namedChildren of type simple_identifier
      const methodName = fun.namedChildren
        .find(c => c.type === 'simple_identifier')?.text ?? 'unknown';

      const loc = toLocation(fun, filePath);
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
          framework: 'spring',
          controller: className,
          request: {},
          responses: [],
        },
      });

      functions.push({
        id: nodeId('function', filePath, loc.line, `${className}.${methodName}`),
        type: 'function',
        name: `${className}.${methodName}`,
        location: loc,
        children: [],
        metadata: {
          kind: 'method',
          async: fun.text.includes('suspend'),
          generator: false,
          params: [],
          returnType: fun.namedChildren.find(c => c.type === 'user_type')?.text,
          visibility: 'public',
          className,
          errorMap: [],
        },
      });
    }
  }

  return { endpoints, functions };
}

/**
 * Extrai o nome da annotation independente da forma:
 *   @RestController            → namedChildren[0] = user_type → text = "RestController"
 *   @GetMapping("/items")      → namedChildren[0] = constructor_invocation
 *                                  → namedChildren[0] = user_type → text = "GetMapping"
 */
function getAnnotationName(annotation: SyntaxNode): string {
  const first = annotation.namedChildren[0];
  if (!first) return '';
  if (first.type === 'user_type') return first.text;
  if (first.type === 'constructor_invocation') {
    return first.namedChildren.find(c => c.type === 'user_type')?.text ?? '';
  }
  return '';
}

/**
 * Extrai o valor string da annotation:
 *   @RequestMapping("/api")  → "/api"
 *   @GetMapping("/items")    → "/items"
 * Tanto `value=` quanto posicional.
 */
function extractAnnotationValue(annotation: SyntaxNode): string | null {
  const first = annotation.namedChildren[0];
  if (!first || first.type !== 'constructor_invocation') return null;

  const valueArgs = first.namedChildren.find(c => c.type === 'value_arguments');
  if (!valueArgs) return null;

  // value_arguments text = ("...") — extract first string literal
  const match = valueArgs.text.match(/["']([^"']+)["']/);
  return match ? match[1] : null;
}

function joinPaths(base: string, path: string): string {
  const clean = [base, path]
    .map(p => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return '/' + clean;
}
