import type { SyntaxNode } from '../../../utils/ast-helpers';
import {
  findAll, getDecorators, toLocation, fieldText, extractStringValue,
} from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type { EndpointNode, FunctionNode, ParamInfo } from '../../../types/topology';

/** Annotations Spring MVC → HTTP method */
const SPRING_HTTP_ANNOTATIONS: Record<string, EndpointNode['metadata']['method']> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  PatchMapping: 'PATCH',
  DeleteMapping: 'DELETE',
  RequestMapping: 'GET', // default, será sobrescrito pelo atributo method
};

/** Annotations de parâmetro Spring */
const SPRING_PARAM_ANNOTATIONS = new Set([
  'PathVariable', 'RequestParam', 'RequestBody', 'RequestHeader',
  'MatrixVariable', 'ModelAttribute',
]);

export interface SpringExtractionResult {
  endpoints: EndpointNode[];
  functions: FunctionNode[];
}

/**
 * Extrai endpoints Spring MVC/Boot de um arquivo Java.
 * Detecta:
 *   @RestController + @GetMapping/@PostMapping/@RequestMapping
 */
export function extractSpringEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): SpringExtractionResult {
  const endpoints: EndpointNode[] = [];
  const functions: FunctionNode[] = [];

  // Em Java, usamos 'class_declaration'
  const classes = findAll(rootNode, 'class_declaration');

  for (const classNode of classes) {
    // Verifica @RestController ou @Controller
    const annotations = findAll(classNode, 'marker_annotation')
      .concat(findAll(classNode, 'annotation'));

    const controllerAnnotation = annotations.find(a => {
      const name = a.childForFieldName('name')?.text ?? '';
      return name === 'RestController' || name === 'Controller';
    });

    if (!controllerAnnotation) continue;

    // Detecta base path via @RequestMapping na classe
    const classRequestMapping = annotations.find(a =>
      a.childForFieldName('name')?.text === 'RequestMapping'
    );
    const basePath = extractAnnotationValue(classRequestMapping) ?? '';
    const className = fieldText(classNode, 'name') ?? 'UnknownController';

    // Encontra métodos da classe
    const classBody = classNode.childForFieldName('body') ?? classNode;
    const methods = findAll(classBody, 'method_declaration');

    for (const method of methods) {
      const methodAnnotations = findAll(method, 'marker_annotation')
        .concat(findAll(method, 'annotation'));

      const httpAnnotation = methodAnnotations.find(a => {
        const name = a.childForFieldName('name')?.text ?? '';
        return name in SPRING_HTTP_ANNOTATIONS;
      });

      if (!httpAnnotation) continue;

      const annotationName = httpAnnotation.childForFieldName('name')?.text ?? '';
      let httpMethod = SPRING_HTTP_ANNOTATIONS[annotationName] ?? 'GET';

      // Para @RequestMapping, detecta o atributo method
      if (annotationName === 'RequestMapping') {
        const args = httpAnnotation.childForFieldName('arguments');
        if (args) {
          const methodAttr = args.text;
          if (methodAttr.includes('POST')) httpMethod = 'POST';
          else if (methodAttr.includes('PUT')) httpMethod = 'PUT';
          else if (methodAttr.includes('PATCH')) httpMethod = 'PATCH';
          else if (methodAttr.includes('DELETE')) httpMethod = 'DELETE';
        }
      }

      const methodPath = extractAnnotationValue(httpAnnotation) ?? '';
      const fullPath = joinPaths(basePath, methodPath);
      const methodName = fieldText(method, 'name') ?? 'unknown';

      // Parâmetros
      const request = extractSpringParams(method);

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
          framework: 'spring',
          controller: className,
          request,
          responses: [],
        },
        raw: undefined,
      });

      // FunctionNode para o fluxo interno
      functions.push(buildJavaFunction(method, filePath, className));
    }
  }

  return { endpoints, functions };
}

function extractSpringParams(method: SyntaxNode): EndpointNode['metadata']['request'] {
  const params: EndpointNode['metadata']['request']['params'] = [];
  const query: EndpointNode['metadata']['request']['query'] = [];
  const body: EndpointNode['metadata']['request']['body'] = [];
  const headers: EndpointNode['metadata']['request']['headers'] = [];

  const formalParams = method.childForFieldName('parameters');
  if (!formalParams) return {};

  for (const param of formalParams.namedChildren) {
    // Java: formal_parameter → annotation* type identifier
    const annotations = findAll(param, 'marker_annotation').concat(findAll(param, 'annotation'));
    const typeNode = param.childForFieldName('type');
    const nameNode = param.childForFieldName('name');

    const paramName = nameNode?.text ?? 'param';
    const paramType = typeNode?.text ?? 'Object';

    for (const ann of annotations) {
      const annName = ann.childForFieldName('name')?.text ?? '';
      const annValue = extractAnnotationValue(ann);
      const fieldName = annValue ?? paramName;

      const field = { name: fieldName, type: paramType, required: true };

      switch (annName) {
        case 'PathVariable':
          (params as typeof field[]).push(field);
          break;
        case 'RequestParam':
          (query as typeof field[]).push(field);
          break;
        case 'RequestBody':
          (body as typeof field[]).push(field);
          break;
        case 'RequestHeader':
          (headers as typeof field[]).push(field);
          break;
      }
    }
  }

  return {
    params: params.length > 0 ? params : undefined,
    query: query.length > 0 ? query : undefined,
    body: body.length > 0 ? body : undefined,
    headers: headers.length > 0 ? headers : undefined,
  };
}

function buildJavaFunction(
  method: SyntaxNode,
  filePath: string,
  className: string,
): FunctionNode {
  const loc = toLocation(method, filePath);
  const methodName = fieldText(method, 'name') ?? 'unknown';
  const id = nodeId('function', filePath, loc.line, `${className}.${methodName}`);

  const modifiers = findAll(method, 'modifiers');
  const modText = modifiers.map(m => m.text).join(' ');
  const visibility = modText.includes('private') ? 'private'
    : modText.includes('protected') ? 'protected' : 'public';

  return {
    id,
    type: 'function',
    name: `${className}.${methodName}`,
    location: loc,
    children: [],
    metadata: {
      kind: 'method',
      async: false, // Java não tem async/await nativamente
      generator: false,
      params: [],
      returnType: method.childForFieldName('type')?.text,
      visibility,
      className,
      errorMap: [],
    },
  };
}

/** Extrai o value de uma annotation Spring
 *  @GetMapping("/users") → "/users"
 *  @RequestMapping(value = "/users", method = ...) → "/users"
 */
function extractAnnotationValue(annotation: SyntaxNode | undefined): string | null {
  if (!annotation) return null;

  const args = annotation.childForFieldName('arguments');
  if (!args) return null;

  const text = args.text;

  // value = "/path"
  const valueAttr = text.match(/value\s*=\s*["']([^"']+)["']/);
  if (valueAttr) return valueAttr[1];

  // { "/path" }
  const arrayDirect = text.match(/\{\s*["']([^"']+)["']/);
  if (arrayDirect) return arrayDirect[1];

  // ("path") or "/path" — any quoted string inside the args
  const direct = text.match(/["']([^"']+)["']/);
  if (direct) return direct[1];

  return null;
}

function joinPaths(...parts: string[]): string {
  const joined = parts
    .map(p => p.replace(/^\/+|\/+$/g, ''))
    .filter(p => p.length > 0)
    .join('/');
  return '/' + joined;
}
