import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode } from '../../../types/topology';
/**
 * Extrai endpoints Django de um arquivo Python.
 * Detecta:
 *   - urls.py: path('users/', UserListView.as_view(), name='user-list')
 *   - views.py: class UserListView(APIView) com get/post/put/delete/patch
 *   - @api_view(['GET', 'POST'])
 */
export declare function extractDjangoEndpoints(rootNode: SyntaxNode, filePath: string): EndpointNode[];
//# sourceMappingURL=django.extractor.d.ts.map