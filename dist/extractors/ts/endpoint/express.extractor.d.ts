import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode } from '../../../types/topology';
/**
 * Extrai endpoints Express/Router de um arquivo TypeScript/JavaScript.
 * Detecta: app.get('/path', handler), router.post('/path', ...), etc.
 */
export declare function extractExpressEndpoints(rootNode: SyntaxNode, filePath: string): EndpointNode[];
//# sourceMappingURL=express.extractor.d.ts.map