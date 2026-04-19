import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode } from '../../../types/topology';
/**
 * Extrai endpoints Fastify de um arquivo TypeScript/JavaScript.
 * Detecta:
 *   - fastify.get('/path', handler)
 *   - fastify.route({ method: 'GET', url: '/path', handler })
 */
export declare function extractFastifyEndpoints(rootNode: SyntaxNode, filePath: string): EndpointNode[];
//# sourceMappingURL=fastify.extractor.d.ts.map