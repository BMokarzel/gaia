import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode, FunctionNode } from '../../../types/topology';
/**
 * Extrai endpoints Spring Boot de arquivos Kotlin.
 * O AST do Kotlin é similar ao Java mas com algumas diferenças de sintaxe.
 */
export declare function extractKotlinSpringEndpoints(rootNode: SyntaxNode, filePath: string): {
    endpoints: EndpointNode[];
    functions: FunctionNode[];
};
//# sourceMappingURL=spring.extractor.d.ts.map