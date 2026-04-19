import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { ScreenNode, ComponentNode } from '../../../types/topology';
/**
 * Extrai screens, components e eventos de frontend de um arquivo TypeScript/TSX.
 * Detecta: React pages/components, React Native screens, Vue components
 */
export declare function extractFrontendNodes(rootNode: SyntaxNode, filePath: string): {
    screens: ScreenNode[];
    components: ComponentNode[];
};
//# sourceMappingURL=screen.extractor.d.ts.map