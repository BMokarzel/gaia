import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { EndpointNode } from '../../../types/topology';
/**
 * Extrai endpoints de frameworks Go (Gin, Echo, Fiber, Chi, net/http).
 * Detecta: r.GET("/path", handler), r.POST("/path", handler)
 * e também e.GET(), r.Get() (Chi), app.Get() (Fiber)
 */
export declare function extractGoEndpoints(rootNode: SyntaxNode, filePath: string): EndpointNode[];
//# sourceMappingURL=gin.extractor.d.ts.map