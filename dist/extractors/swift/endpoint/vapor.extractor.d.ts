import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode } from '../../../types/topology';
/**
 * Extrai endpoints Vapor (Swift) de arquivos Swift.
 * Detecta: app.get("path") { req in ... }
 */
export declare function extractVaporEndpoints(rootNode: SyntaxNode, filePath: string): EndpointNode[];
//# sourceMappingURL=vapor.extractor.d.ts.map