import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode, FunctionNode } from '../../../types/topology';
export interface SpringExtractionResult {
    endpoints: EndpointNode[];
    functions: FunctionNode[];
}
/**
 * Extrai endpoints Spring MVC/Boot de um arquivo Java.
 * Detecta:
 *   @RestController + @GetMapping/@PostMapping/@RequestMapping
 */
export declare function extractSpringEndpoints(rootNode: SyntaxNode, filePath: string): SpringExtractionResult;
//# sourceMappingURL=spring.extractor.d.ts.map