import type Parser from 'tree-sitter';
export type SyntaxNode = Parser.SyntaxNode;
/**
 * Encontra todos os descendentes de um tipo específico
 */
export declare function findAll(node: SyntaxNode, type: string | string[]): SyntaxNode[];
/**
 * Encontra o primeiro descendente de um tipo específico
 */
export declare function findFirst(node: SyntaxNode, type: string | string[]): SyntaxNode | null;
/**
 * Encontra o nó pai mais próximo de um tipo específico
 */
export declare function findParent(node: SyntaxNode, type: string | string[]): SyntaxNode | null;
/**
 * Retorna o texto de um campo filho pelo nome
 */
export declare function fieldText(node: SyntaxNode, fieldName: string): string | null;
/**
 * Obtém o texto de um nó, limpando whitespace excessivo
 */
export declare function nodeText(node: SyntaxNode): string;
/**
 * Verifica se um nó tem um decorator com nome específico
 */
export declare function hasDecorator(node: SyntaxNode, name: string | string[]): boolean;
/**
 * Retorna todos os decorators de um nó (class, method, param, etc.)
 */
export declare function getDecorators(node: SyntaxNode): SyntaxNode[];
/**
 * Extrai o nome de um decorator node
 * @Get('/path') → 'Get'
 * @Controller → 'Controller'
 */
export declare function decoratorName(decorator: SyntaxNode): string;
/**
 * Extrai o primeiro argumento string de um decorator
 * @Get('/users/:id') → '/users/:id'
 */
export declare function decoratorFirstArg(decorator: SyntaxNode): string | null;
/**
 * Extrai todos os decorators com nome específico de um nó
 */
export declare function getDecoratorsByName(node: SyntaxNode, name: string | string[]): SyntaxNode[];
/**
 * Extrai o valor string de um nó (string literal, template string, identifier)
 */
export declare function extractStringValue(node: SyntaxNode): string | null;
/**
 * Junta caminhos HTTP, normalizando barras
 */
export declare function joinHttpPaths(...parts: string[]): string;
/**
 * Verifica se um nó está dentro de um await expression
 */
export declare function isAwaited(node: SyntaxNode): boolean;
/**
 * Extrai o texto de um call expression como string legível
 * this.userService.findAll() → 'this.userService.findAll'
 */
export declare function calleeText(callNode: SyntaxNode): string;
/**
 * Extrai argumentos de um call_expression como array de strings
 */
export declare function callArguments(callNode: SyntaxNode): string[];
/**
 * Extrai o tipo de retorno de uma function/method
 */
export declare function extractReturnType(node: SyntaxNode): string | null;
/**
 * Extrai o tipo de um parâmetro
 */
export declare function extractParamType(paramNode: SyntaxNode): string | null;
/**
 * Verifica se um nó representa uma chamada de método de objeto específico
 * ex: this.prisma.user.findMany → object='this.prisma', property chain=['user', 'findMany']
 */
export declare function isMemberCall(callNode: SyntaxNode, objectPattern: RegExp, methodName: string | string[]): boolean;
/**
 * Extrai a cadeia de member expressions como array
 * this.userRepo.findOne() → ['this', 'userRepo', 'findOne']
 */
export declare function memberChain(node: SyntaxNode): string[];
/**
 * Extrai o nome de uma class declaration ou expression
 */
export declare function className(node: SyntaxNode): string | null;
/**
 * Extrai o nome de um method/function node
 */
export declare function functionName(node: SyntaxNode): string | null;
/**
 * Verifica se uma função/método é async
 */
export declare function isAsync(node: SyntaxNode): boolean;
/**
 * Verifica se uma função/método é generator
 */
export declare function isGenerator(node: SyntaxNode): boolean;
/**
 * Converte position do tree-sitter para SourceLocation
 */
export declare function toLocation(node: SyntaxNode, file: string): {
    file: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
};
/**
 * Detecta visibility de um método Java/Kotlin/C#
 */
export declare function javaVisibility(node: SyntaxNode): 'public' | 'private' | 'protected';
/**
 * Detecta se um import é de uma biblioteca específica
 */
export declare function isImportFrom(node: SyntaxNode, source: string | RegExp): boolean;
//# sourceMappingURL=ast-helpers.d.ts.map