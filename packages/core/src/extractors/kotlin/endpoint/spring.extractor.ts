import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation, fieldText } from '../../../utils/ast-helpers';
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
 * O AST do Kotlin é similar ao Java mas com algumas diferenças de sintaxe.
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
    const isController = modifiers.some(a => {
      const name = a.childForFieldName('userType')?.text
        ?? a.childForFieldName('name')?.text ?? '';
      return name === 'RestController' || name === 'Controller';
    });

    if (!isController) continue;

    const className = classNode.childForFieldName('name')?.text
      ?? classNode.childForFieldName('simpleIdentifier')?.text ?? 'Controller';

    const classAnnotations = modifiers;
    const requestMappingAnn = classAnnotations.find(a => {
      const name = a.childForFieldName('userType')?.text ?? '';
      return name === 'RequestMapping';
    });
    const basePath = requestMappingAnn
      ? extractKotlinAnnotationValue(requestMappingAnn)
      : '';

    // Kotlin: fun declarations dentro da classe
    const funDeclarations = findAll(classNode, 'function_declaration');

    for (const fun of funDeclarations) {
      const funAnnotations = findAll(fun, 'annotation');
      const httpAnnotation = funAnnotations.find(a => {
        const name = a.childForFieldName('userType')?.text ?? '';
        return name in SPRING_ANNOTATIONS;
      });

      if (!httpAnnotation) continue;

      const annotationName = httpAnnotation.childForFieldName('userType')?.text ?? '';
      const httpMethod = SPRING_ANNOTATIONS[annotationName] ?? 'GET';
      const methodPath = extractKotlinAnnotationValue(httpAnnotation) ?? '';
      const fullPath = joinPaths(basePath ?? '', methodPath);

      const methodName = fun.childForFieldName('simpleIdentifier')?.text ?? 'unknown';
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
          returnType: fun.childForFieldName('type')?.text,
          visibility: 'public',
          className,
          errorMap: [],
        },
      });
    }
  }

  return { endpoints, functions };
}

function extractKotlinAnnotationValue(annotation: SyntaxNode): string | null {
  const valueArgs = annotation.childForFieldName('valueArguments');
  if (!valueArgs) return null;

  const text = valueArgs.text;
  const match = text.match(/["']([^"']+)["']/);
  return match ? match[1] : null;
}

function joinPaths(base: string, path: string): string {
  const clean = [base, path]
    .map(p => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return '/' + clean;
}
