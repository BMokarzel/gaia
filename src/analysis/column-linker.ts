import type {
  ServiceNode, DatabaseNode, TableNode, ColumnNode,
  DbProcessNode, Edge, ColumnDef,
} from '../types/topology';
import { columnId } from '../utils/id';

/**
 * Promove ColumnDef[] de metadata.columns para ColumnNode[] no nível do TableNode.
 * Chamada depois de todos os extractors rodarem.
 */
export function promoteColumnsToNodes(databases: DatabaseNode[]): void {
  for (const db of databases) {
    for (const table of db.tables) {
      if (table.columns && table.columns.length > 0) continue; // já promovido

      const legacyCols: ColumnDef[] = table.metadata.columns ?? [];
      table.columns = legacyCols.map(col => columnDefToNode(col, table.id));
    }
  }
}

function columnDefToNode(col: ColumnDef, tblId: string): ColumnNode {
  const id = columnId(tblId, col.name);
  return {
    id,
    type: 'column',
    name: col.name,
    metadata: {
      tableId: tblId,
      dataType: col.type,
      nullable: col.nullable,
      primaryKey: col.primaryKey,
      unique: col.unique,
      autoIncrement: col.autoIncrement ?? false,
      defaultValue: col.defaultValue,
      generated: col.generated,
      length: col.length,
      precision: col.precision,
      scale: col.scale,
      enumValues: col.enumValues,
      check: col.check,
      foreignKeyTo: col.reference
        ? `${col.reference.tableId}:${col.reference.column}`
        : undefined,
      decorators: col.decorators,
      sourceKind: col.sourceKind,
    },
  };
}

/**
 * Constrói edges WRITES_TO / READS_FROM entre DbProcessNode e ColumnNode.
 * Quando fields[] está presente e resolve para colunas conhecidas, cria edge por coluna.
 * Caso contrário, fallback para edge com a TableNode.
 */
export function buildColumnEdges(
  services: ServiceNode[],
  databases: DatabaseNode[],
): Edge[] {
  const edges: Edge[] = [];

  // Índice: tableId → Map<colName → columnId>
  const tableColIndex = new Map<string, Map<string, string>>();
  for (const db of databases) {
    for (const table of db.tables) {
      const colMap = new Map<string, string>();
      for (const col of table.columns) {
        colMap.set(col.name.toLowerCase(), col.id);
      }
      tableColIndex.set(table.id, colMap);
    }
  }

  const WRITE_OPS = new Set([
    'create', 'createMany', 'update', 'updateMany',
    'upsert', 'delete', 'deleteMany', 'raw', 'migrate',
  ]);

  function walkNodes(nodes: import('../types/topology').CodeNode[]): void {
    for (const node of nodes) {
      if (node.type === 'dbProcess') {
        const dbNode = node as DbProcessNode;
        const isWrite = WRITE_OPS.has(dbNode.metadata.operation);
        const edgeKind: Edge['kind'] = isWrite ? 'writes_to' : 'reads_from';

        const colMap = tableColIndex.get(dbNode.metadata.tableId);
        const fields = dbNode.metadata.fields ?? [];

        const resolvedIds: string[] = [];

        if (colMap && fields.length > 0) {
          for (const fieldName of fields) {
            const colId = colMap.get(fieldName.toLowerCase());
            if (colId) {
              resolvedIds.push(colId);
              edges.push({
                from: dbNode.id,
                to: colId,
                kind: edgeKind,
                metadata: { operation: dbNode.metadata.operation },
              });
            }
          }
        }

        if (resolvedIds.length === 0) {
          // Fallback: edge para tabela
          edges.push({
            from: dbNode.id,
            to: dbNode.metadata.tableId,
            kind: edgeKind,
            metadata: { operation: dbNode.metadata.operation },
          });
        } else {
          dbNode.metadata.resolvedColumnIds = resolvedIds;
        }
      }

      walkNodes(node.children);
    }
  }

  for (const service of services) {
    walkNodes(service.endpoints as import('../types/topology').CodeNode[]);
    walkNodes(service.functions as import('../types/topology').CodeNode[]);
  }

  return edges;
}
