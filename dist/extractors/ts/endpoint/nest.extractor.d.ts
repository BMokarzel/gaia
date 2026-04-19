import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode, FunctionNode } from '../../../types/topology';
export interface NestExtractionResult {
    endpoints: EndpointNode[];
    functions: FunctionNode[];
}
/**
 * Extrai endpoints NestJS de um arquivo TypeScript
 * Detecta: @Controller + @Get/Post/etc → EndpointNode
 */
export declare function extractNestEndpoints(rootNode: SyntaxNode, filePath: string): NestExtractionResult;
//# sourceMappingURL=nest.extractor.d.ts.map