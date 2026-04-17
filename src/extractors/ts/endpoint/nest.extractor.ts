import type { SyntaxNode } from '../../../utils/ast-helpers';
import {
  findAll, getDecorators, decoratorName, decoratorFirstArg,
  getDecoratorsByName, joinHttpPaths, toLocation, isAsync,
  extractReturnType, extractParamType, fieldText,
} from '../../../utils/ast-helpers';
import { nodeId } from '../../../utils/id';
import type {
  EndpointNode, FunctionNode, ParamInfo, TypedField,
} from '../../../types/topology';

// HTTP method decorators do NestJS
const HTTP_DECORATORS = new Set([
  'Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All',
]);

// Decorators de parâmetro de requisição
const PARAM_DECORATORS = new Set([
  'Param', 'Body', 'Query', 'Headers', 'Ip', 'HostParam', 'Session', 'UploadedFile', 'UploadedFiles',
]);

// Decorators de middleware/segurança
const MIDDLEWARE_DECORATORS = [
  'UseGuards', 'UseInterceptors', 'UsePipes', 'UseFilters',
  'HttpCode', 'Header', 'Redirect', 'Render', 'Version',
];

export interface NestExtractionResult {
  endpoints: EndpointNode[];
  functions: FunctionNode[];
}

/**
 * Extrai endpoints NestJS de um arquivo TypeScript
 * Detecta: @Controller + @Get/Post/etc → EndpointNode
 */
export function extractNestEndpoints(
  rootNode: SyntaxNode,
  filePath: string,
): NestExtractionResult {
  const endpoints: EndpointNode[] = [];
  const functions: FunctionNode[] = [];

  // Encontra todas as class declarations
  const classes = findAll(rootNode, 'class_declaration');

  for (const classNode of classes) {
    const controllerDec = getDecoratorsByName(classNode, 'Controller');
    if (controllerDec.length === 0) continue;

    const basePath = decoratorFirstArg(controllerDec[0]) ?? '';
    const classNameNode = classNode.childForFieldName('name');
    const controllerName = classNameNode?.text ?? 'UnknownController';

    // Encontra métodos dentro do corpo da classe
    const classBody = classNode.childForFieldName('body');
    if (!classBody) continue;

    const methods = findAll(classBody, 'method_definition');

    for (const method of methods) {
      const httpDec = getDecorators(method).find(d => HTTP_DECORATORS.has(decoratorName(d)));
      if (!httpDec) continue;

      const httpVerb = decoratorName(httpDec).toUpperCase();
      // 'ALL' não existe no tipo, usa GET como fallback
      const httpMethod = httpVerb === 'ALL' ? 'GET' : httpVerb as EndpointNode['metadata']['method'];
      const methodPath = decoratorFirstArg(httpDec) ?? '';
      const fullPath = joinHttpPaths(basePath, methodPath);

      const methodName = fieldText(method, 'name') ?? 'unknown';

      // Middleware/guards
      const middleware = MIDDLEWARE_DECORATORS
        .flatMap(name => getDecoratorsByName(method, name))
        .map(d => {
          const args = d.children.find(c => c.type === 'call_expression')
            ?.childForFieldName('arguments')?.text ?? '';
          return `${decoratorName(d)}${args}`;
        });

      // Parâmetros da requisição
      const request = extractNestRequestParams(method);

      const loc = toLocation(method, filePath);
      const id = nodeId('endpoint', filePath, loc.line, `${controllerName}.${methodName}`);

      const endpoint: EndpointNode = {
        id,
        type: 'endpoint',
        name: `${controllerName}.${methodName}`,
        location: loc,
        children: [],
        metadata: {
          method: httpMethod,
          path: fullPath,
          framework: 'nest',
          middleware: middleware.length > 0 ? middleware : undefined,
          controller: controllerName,
          request,
          responses: [],
        },
        raw: method.text.length < 500 ? method.text : undefined,
      };

      endpoints.push(endpoint);

      // Também extrai como FunctionNode para capturar o fluxo interno
      const fn = extractMethodAsFunction(method, filePath, controllerName, endpoint.id);
      functions.push(fn);
    }
  }

  return { endpoints, functions };
}

/**
 * Extrai parâmetros da requisição de um método NestJS
 */
function extractNestRequestParams(method: SyntaxNode): EndpointNode['metadata']['request'] {
  const params: TypedField[] = [];
  const query: TypedField[] = [];
  const body: TypedField[] = [];
  const headers: TypedField[] = [];

  const formalParams = method.childForFieldName('parameters');
  if (!formalParams) return {};

  for (const param of formalParams.namedChildren) {
    if (param.type !== 'required_parameter' && param.type !== 'optional_parameter') continue;

    const paramDecorators = getDecorators(param);
    const paramName = param.childForFieldName('pattern')?.text ?? param.childForFieldName('name')?.text ?? '';
    const paramType = extractParamType(param) ?? 'unknown';
    const optional = param.type === 'optional_parameter';

    const field: TypedField = {
      name: paramName,
      type: paramType,
      required: !optional,
    };

    let categorized = false;

    for (const dec of paramDecorators) {
      const name = decoratorName(dec);

      if (!PARAM_DECORATORS.has(name)) continue;
      categorized = true;

      // Sobrescreve o nome com o argumento do decorator se existir
      // @Param('id') id: string → field.name = 'id'
      const decArg = decoratorFirstArg(dec);
      const namedField: TypedField = { ...field, name: decArg ?? field.name };

      switch (name) {
        case 'Param':
          params.push(namedField);
          break;
        case 'Query':
          query.push(namedField);
          break;
        case 'Body':
          body.push(namedField);
          break;
        case 'Headers':
          headers.push(namedField);
          break;
        default:
          break;
      }
    }

    // Parâmetro sem decorator de binding → provavelmente injetado (service, etc.)
    if (!categorized && paramDecorators.length === 0) {
      // Ignora — é uma injeção de dependência
    }
  }

  // Detecta tipo do body a partir do tipo do parâmetro @Body
  const bodyType = body[0]?.type;

  return {
    params: params.length > 0 ? params : undefined,
    query: query.length > 0 ? query : undefined,
    body: body.length > 0 ? body : undefined,
    bodyType: bodyType && bodyType !== 'unknown' ? bodyType : undefined,
    headers: headers.length > 0 ? headers : undefined,
  };
}

/**
 * Converte um method node em FunctionNode para capturar o fluxo interno
 */
function extractMethodAsFunction(
  method: SyntaxNode,
  filePath: string,
  className: string,
  endpointId: string,
): FunctionNode {
  const loc = toLocation(method, filePath);
  const methodName = fieldText(method, 'name') ?? 'unknown';

  // Coleta todos os decorators do método (exceto HTTP)
  const allDecorators = getDecorators(method)
    .map(d => decoratorName(d))
    .filter(n => !HTTP_DECORATORS.has(n));

  // Parâmetros da função
  const formalParams = method.childForFieldName('parameters');
  const params: ParamInfo[] = [];

  if (formalParams) {
    for (const param of formalParams.namedChildren) {
      if (param.type !== 'required_parameter' && param.type !== 'optional_parameter') continue;

      const paramDecorators = getDecorators(param).map(d => decoratorName(d));
      const paramName = param.childForFieldName('pattern')?.text
        ?? param.childForFieldName('name')?.text ?? '';

      params.push({
        name: paramName,
        type: extractParamType(param) ?? undefined,
        optional: param.type === 'optional_parameter',
        defaultValue: undefined,
        destructured: paramName.startsWith('{'),
        decorators: paramDecorators.length > 0 ? paramDecorators : undefined,
      });
    }
  }

  return {
    id: nodeId('function', filePath, loc.line, `${className}.${methodName}`),
    type: 'function',
    name: `${className}.${methodName}`,
    location: loc,
    children: [],
    metadata: {
      kind: 'method',
      async: isAsync(method),
      generator: false,
      params,
      returnType: extractReturnType(method) ?? undefined,
      visibility: 'public',
      decorators: allDecorators.length > 0 ? allDecorators : undefined,
      className,
      errorMap: [],
    },
  };
}
