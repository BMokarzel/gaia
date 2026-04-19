import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode } from '../../../types/topology';
/**
 * Extrai endpoints FastAPI de um arquivo Python.
 * Detecta: @app.get('/path'), @router.post('/path')
 */
export declare function extractFastAPIEndpoints(rootNode: SyntaxNode, filePath: string): EndpointNode[];
//# sourceMappingURL=fastapi.extractor.d.ts.map