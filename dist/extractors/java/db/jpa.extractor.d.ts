import type { SyntaxNode } from '../../../utils/ast-helpers';
import type { DbProcessNode, DatabaseNode } from '../../../types/topology';
/**
 * Extrai entidades JPA/Hibernate e repositórios Spring Data de arquivos Java.
 * Detecta: @Entity, @Table, @Column, @Id, repositórios com findBy*, save, delete
 */
export declare function extractJPAOperations(rootNode: SyntaxNode, filePath: string): {
    dbNodes: DbProcessNode[];
    database: DatabaseNode;
};
//# sourceMappingURL=jpa.extractor.d.ts.map