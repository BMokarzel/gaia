import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { DbProcessNode, DatabaseNode, TableNode } from '../../../types/topology';
export interface TypeORMExtractionResult {
    dbNodes: DbProcessNode[];
    database: DatabaseNode;
    tables: TableNode[];
}
/**
 * Extrai operações TypeORM de um arquivo TypeScript.
 * Detecta:
 *   - this.userRepository.find(...)
 *   - getRepository(User).findOne(...)
 *   - @Entity(), @Column() para schema
 */
export declare function extractTypeORMOperations(rootNode: SyntaxNode, filePath: string): TypeORMExtractionResult;
//# sourceMappingURL=typeorm.extractor.d.ts.map