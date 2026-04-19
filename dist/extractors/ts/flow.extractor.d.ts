import type { SyntaxNode } from '../../utils/ast-helpers';
import type { CodeNode } from '../../types/topology';
/**
 * Extrai nós de controle de fluxo de um arquivo TypeScript/JavaScript.
 * Detecta: if/else, switch, loops, try/catch, return, throw
 */
export declare function extractFlowControl(rootNode: SyntaxNode, filePath: string): CodeNode[];
//# sourceMappingURL=flow.extractor.d.ts.map