import type Parser from 'tree-sitter';

export type SyntaxNode = Parser.SyntaxNode;

/**
 * Encontra todos os descendentes de um tipo específico
 */
export function findAll(node: SyntaxNode, type: string | string[]): SyntaxNode[] {
  const types = Array.isArray(type) ? type : [type];
  const results: SyntaxNode[] = [];

  function walk(n: SyntaxNode): void {
    if (types.includes(n.type)) results.push(n);
    for (const child of n.children) walk(child);
  }

  walk(node);
  return results;
}

/**
 * Encontra o primeiro descendente de um tipo específico
 */
export function findFirst(node: SyntaxNode, type: string | string[]): SyntaxNode | null {
  const types = Array.isArray(type) ? type : [type];

  function walk(n: SyntaxNode): SyntaxNode | null {
    if (types.includes(n.type)) return n;
    for (const child of n.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  }

  return walk(node);
}

/**
 * Encontra o nó pai mais próximo de um tipo específico
 */
export function findParent(node: SyntaxNode, type: string | string[]): SyntaxNode | null {
  const types = Array.isArray(type) ? type : [type];
  let current = node.parent;
  while (current) {
    if (types.includes(current.type)) return current;
    current = current.parent;
  }
  return null;
}

/**
 * Retorna o texto de um campo filho pelo nome
 */
export function fieldText(node: SyntaxNode, fieldName: string): string | null {
  return node.childForFieldName(fieldName)?.text ?? null;
}

/**
 * Obtém o texto de um nó, limpando whitespace excessivo
 */
export function nodeText(node: SyntaxNode): string {
  return node.text.trim();
}

/**
 * Verifica se um nó tem um decorator com nome específico
 */
export function hasDecorator(node: SyntaxNode, name: string | string[]): boolean {
  const names = Array.isArray(name) ? name : [name];
  return getDecorators(node).some(d => names.includes(decoratorName(d)));
}

/**
 * Retorna todos os decorators de um nó (class, method, param, etc.)
 */
export function getDecorators(node: SyntaxNode): SyntaxNode[] {
  const decorators: SyntaxNode[] = [];
  for (const child of node.children) {
    if (child.type === 'decorator') decorators.push(child);
  }
  return decorators;
}

/**
 * Extrai o nome de um decorator node
 * @Get('/path') → 'Get'
 * @Controller → 'Controller'
 */
export function decoratorName(decorator: SyntaxNode): string {
  // decorator → call_expression → identifier
  const call = decorator.children.find(c => c.type === 'call_expression');
  if (call) {
    const fn = call.childForFieldName('function');
    if (fn) {
      // Suporte a chained decorators: @NestFactory.create → NestFactory.create
      return fn.text;
    }
  }
  // decorator simples sem args: @Injectable
  const ident = decorator.children.find(c => c.type === 'identifier');
  return ident?.text ?? '';
}

/**
 * Extrai o primeiro argumento string de um decorator
 * @Get('/users/:id') → '/users/:id'
 */
export function decoratorFirstArg(decorator: SyntaxNode): string | null {
  const call = decorator.children.find(c => c.type === 'call_expression');
  if (!call) return null;

  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const first = args.namedChildren[0];
  if (!first) return null;

  return extractStringValue(first);
}

/**
 * Extrai todos os decorators com nome específico de um nó
 */
export function getDecoratorsByName(node: SyntaxNode, name: string | string[]): SyntaxNode[] {
  const names = Array.isArray(name) ? name : [name];
  return getDecorators(node).filter(d => names.includes(decoratorName(d)));
}

/**
 * Extrai o valor string de um nó (string literal, template string, identifier)
 */
export function extractStringValue(node: SyntaxNode): string | null {
  if (node.type === 'string') {
    // Remove aspas
    return node.text.replace(/^['"`]|['"`]$/g, '');
  }
  if (node.type === 'template_string') {
    return node.text.replace(/^`|`$/g, '');
  }
  if (node.type === 'identifier') {
    return node.text;
  }
  return null;
}

/**
 * Junta caminhos HTTP, normalizando barras
 */
export function joinHttpPaths(...parts: string[]): string {
  const joined = parts
    .map(p => p.replace(/^\/+|\/+$/g, ''))
    .filter(p => p.length > 0)
    .join('/');
  return '/' + joined;
}

/**
 * Verifica se um nó está dentro de um await expression
 */
export function isAwaited(node: SyntaxNode): boolean {
  return findParent(node, 'await_expression') !== null;
}

/**
 * Extrai o texto de um call expression como string legível
 * this.userService.findAll() → 'this.userService.findAll'
 */
export function calleeText(callNode: SyntaxNode): string {
  const fn = callNode.childForFieldName('function');
  return fn?.text ?? callNode.text.split('(')[0];
}

/**
 * Extrai argumentos de um call_expression como array de strings
 */
export function callArguments(callNode: SyntaxNode): string[] {
  const args = callNode.childForFieldName('arguments');
  if (!args) return [];
  return args.namedChildren.map(n => n.text.trim());
}

/**
 * Extrai o tipo de retorno de uma function/method
 */
export function extractReturnType(node: SyntaxNode): string | null {
  // TypeScript: return_type → type_annotation → (type)
  const returnType = node.childForFieldName('return_type');
  if (returnType) {
    // Remove o ':' inicial da type_annotation
    const text = returnType.text.replace(/^:\s*/, '');
    return text || null;
  }
  return null;
}

/**
 * Extrai o tipo de um parâmetro
 */
export function extractParamType(paramNode: SyntaxNode): string | null {
  const typeAnnotation = paramNode.childForFieldName('type');
  if (typeAnnotation) {
    return typeAnnotation.text.replace(/^:\s*/, '');
  }
  return null;
}

/**
 * Verifica se um nó representa uma chamada de método de objeto específico
 * ex: this.prisma.user.findMany → object='this.prisma', property chain=['user', 'findMany']
 */
export function isMemberCall(
  callNode: SyntaxNode,
  objectPattern: RegExp,
  methodName: string | string[],
): boolean {
  const fn = callNode.childForFieldName('function');
  if (!fn || fn.type !== 'member_expression') return false;

  const methods = Array.isArray(methodName) ? methodName : [methodName];
  const prop = fn.childForFieldName('property');
  if (!prop || !methods.includes(prop.text)) return false;

  const obj = fn.childForFieldName('object');
  return obj ? objectPattern.test(obj.text) : false;
}

/**
 * Extrai a cadeia de member expressions como array
 * this.userRepo.findOne() → ['this', 'userRepo', 'findOne']
 */
export function memberChain(node: SyntaxNode): string[] {
  const parts: string[] = [];

  function walk(n: SyntaxNode): void {
    if (n.type === 'member_expression') {
      const obj = n.childForFieldName('object');
      const prop = n.childForFieldName('property');
      if (obj) walk(obj);
      if (prop) parts.push(prop.text);
    } else {
      parts.push(n.text);
    }
  }

  walk(node);
  return parts;
}

/**
 * Extrai o nome de uma class declaration ou expression
 */
export function className(node: SyntaxNode): string | null {
  return node.childForFieldName('name')?.text ?? null;
}

/**
 * Extrai o nome de um method/function node
 */
export function functionName(node: SyntaxNode): string | null {
  return node.childForFieldName('name')?.text ?? null;
}

/**
 * Verifica se uma função/método é async
 */
export function isAsync(node: SyntaxNode): boolean {
  return node.children.some(c => c.type === 'async');
}

/**
 * Verifica se uma função/método é generator
 */
export function isGenerator(node: SyntaxNode): boolean {
  return node.text.startsWith('function*') || node.children.some(c => c.text === '*');
}

/**
 * Converte position do tree-sitter para SourceLocation
 */
export function toLocation(node: SyntaxNode, file: string) {
  return {
    file,
    line: node.startPosition.row + 1,
    column: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
  };
}

/**
 * Detecta visibility de um método Java/Kotlin/C#
 */
export function javaVisibility(node: SyntaxNode): 'public' | 'private' | 'protected' {
  const modifiers = findAll(node, 'modifiers');
  const text = modifiers.map(m => m.text).join(' ');
  if (text.includes('private')) return 'private';
  if (text.includes('protected')) return 'protected';
  return 'public';
}

/**
 * Detecta se um import é de uma biblioteca específica
 */
export function isImportFrom(node: SyntaxNode, source: string | RegExp): boolean {
  if (node.type !== 'import_declaration') return false;
  const src = node.childForFieldName('source');
  if (!src) return false;
  const text = extractStringValue(src) ?? '';
  return typeof source === 'string' ? text === source : source.test(text);
}
