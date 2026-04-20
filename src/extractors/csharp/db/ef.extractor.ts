import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode, ColumnDef } from '../../../types/topology';

const EF_OPERATIONS: Record<string, DbProcessNode['metadata']['operation']> = {
  Find: 'findUnique',
  FindAsync: 'findUnique',
  FindById: 'findUnique',
  FirstOrDefault: 'findFirst',
  FirstOrDefaultAsync: 'findFirst',
  SingleOrDefault: 'findUnique',
  SingleOrDefaultAsync: 'findUnique',
  Where: 'findMany',
  ToList: 'findMany',
  ToListAsync: 'findMany',
  Add: 'create',
  AddAsync: 'create',
  AddRange: 'createMany',
  AddRangeAsync: 'createMany',
  Update: 'update',
  UpdateRange: 'updateMany',
  Remove: 'delete',
  RemoveRange: 'deleteMany',
  SaveChanges: 'upsert',
  SaveChangesAsync: 'upsert',
  Count: 'count',
  CountAsync: 'count',
  Any: 'count',
  AnyAsync: 'count',
  FromSqlRaw: 'raw',
  FromSqlInterpolated: 'raw',
};

// DbSet<Model> property names that indicate EF context access
const DBCONTEXT_PATTERNS = [/context|Context|_context|_db\b|Db\b/];

export interface EFExtractionResult {
  dbNodes: DbProcessNode[];
  database: DatabaseNode;
}

export function extractEFOperations(
  rootNode: SyntaxNode,
  filePath: string,
): EFExtractionResult {
  const dbAlias = 'ef';
  const dbId = resourceId('database', dbAlias);

  const database: DatabaseNode = {
    id: dbId,
    type: 'database',
    name: dbAlias,
    metadata: { engine: 'custom', category: 'sql', connectionAlias: dbAlias },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  // Detect DbContext classes and their DbSet<T> properties
  for (const cls of findAll(rootNode, 'class_declaration')) {
    const baseTypes = findAll(cls, 'base_list');
    const isDbContext = baseTypes.some(b => /DbContext|IdentityDbContext/.test(b.text));
    if (!isDbContext) continue;

    // DbSet<User> Users { get; set; }
    for (const prop of findAll(cls, 'property_declaration')) {
      const typeNode = prop.childForFieldName('type');
      const nameNode = prop.childForFieldName('name') ?? prop.children.find(c => c.type === 'identifier');
      if (!typeNode || !nameNode) continue;

      const typeText = typeNode.text;
      const match = typeText.match(/DbSet\s*<\s*([A-Za-z_]\w*)\s*>/);
      if (!match) continue;

      const modelName = match[1];
      const tableName = toSnakeCase(modelName);
      const tableKey = tableName.toLowerCase();

      if (!tablesMap.has(tableKey)) {
        const tId = makeTableId(dbId, tableName);
        tablesMap.set(tableKey, {
          id: tId,
          type: 'table',
          name: tableName,
          columns: [],
          metadata: {
            kind: 'table',
            databaseId: dbId,
            entityName: modelName,
            hasTimestamps: false,
            hasSoftDelete: false,
            columns: [],
          },
        });
      }
    }
  }

  // Detect entity classes (marked with [Table] or inheriting from entity base)
  for (const cls of findAll(rootNode, 'class_declaration')) {
    const attrs = findAll(cls, 'attribute');
    const hasTableAttr = attrs.some(a => /\[Table|Entity/i.test(a.text));
    if (!hasTableAttr) continue;

    const nameNode = cls.childForFieldName('name') ?? cls.children.find(c => c.type === 'identifier');
    if (!nameNode) continue;

    const modelName = nameNode.text;
    const tableAttr = attrs.find(a => a.text.includes('Table'));
    const tableName = tableAttr
      ? (tableAttr.text.match(/["']([^"']+)["']/) ?? [])[1] ?? toSnakeCase(modelName)
      : toSnakeCase(modelName);

    const tableKey = tableName.toLowerCase();
    if (!tablesMap.has(tableKey)) {
      const tId = makeTableId(dbId, tableName);
      tablesMap.set(tableKey, {
        id: tId,
        type: 'table',
        name: tableName,
        columns: [],
        metadata: {
          kind: 'table',
          databaseId: dbId,
          entityName: modelName,
          columns: extractEFColumns(cls, tId),
          hasTimestamps: false,
          hasSoftDelete: false,
        },
      });
    }
  }

  // Detect EF LINQ calls: _context.Users.Where(...).ToListAsync()
  const calls = findAll(rootNode, 'invocation_expression');
  for (const call of calls) {
    const memberAccess = call.childForFieldName('expression');
    if (!memberAccess || memberAccess.type !== 'member_access_expression') continue;

    const methodName = memberAccess.childForFieldName('name')?.text ?? '';
    const operation = EF_OPERATIONS[methodName];
    if (!operation) continue;

    // Walk up the chain to find the DbSet model
    const fullChain = memberAccess.text;
    const modelName = inferModelFromEFChain(fullChain, tablesMap);

    if (!modelName) continue;

    const tableKey = toSnakeCase(modelName).toLowerCase();
    if (!tablesMap.has(tableKey)) {
      const tId = makeTableId(dbId, modelName);
      tablesMap.set(tableKey, {
        id: tId,
        type: 'table',
        name: toSnakeCase(modelName),
        columns: [],
        metadata: {
          kind: 'table',
          databaseId: dbId,
          entityName: modelName,
          hasTimestamps: false,
          hasSoftDelete: false,
          columns: [],
        },
      });
    }

    const table = tablesMap.get(tableKey)!;
    const loc = toLocation(call, filePath);
    const id = nodeId('dbProcess', filePath, loc.line, `${modelName}.${methodName}`);

    dbNodes.push({
      id,
      type: 'dbProcess',
      name: `${modelName}.${methodName}`,
      location: loc,
      children: [],
      metadata: {
        operation,
        databaseId: dbId,
        tableId: table.id,
        orm: 'ef',
      },
      raw: call.text.length < 300 ? call.text : undefined,
    });
  }

  database.tables = Array.from(tablesMap.values());
  return { dbNodes, database };
}

function inferModelFromEFChain(chain: string, tablesMap: Map<string, TableNode>): string | null {
  // _context.Users.Where → 'Users' → look up 'user' → 'User'
  const parts = chain.split('.');
  for (const part of parts) {
    const singular = singularize(part);
    const key = toSnakeCase(singular).toLowerCase();
    if (tablesMap.has(key)) return singular;
    // Try direct match
    if (tablesMap.has(part.toLowerCase())) return part;
    // Heuristic: PascalCase word that could be a model
    if (/^[A-Z][a-zA-Z]+s$/.test(part)) return part.slice(0, -1); // Users → User
  }
  return null;
}

function singularize(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function extractEFColumns(classNode: SyntaxNode, tableId: string): ColumnDef[] {
  const columns: ColumnDef[] = [];
  const props = findAll(classNode, 'property_declaration');

  for (const prop of props) {
    const attrs = findAll(prop, 'attribute');
    const nameNode = prop.childForFieldName('name') ?? prop.children.find(c => c.type === 'identifier');
    const typeNode = prop.childForFieldName('type');
    if (!nameNode) continue;

    const name = toSnakeCase(nameNode.text);
    const csharpType = typeNode?.text ?? 'string';

    const isPrimary = name === 'id' || attrs.some(a => /\[Key\]/.test(a.text));
    const isNullable = csharpType.endsWith('?') || attrs.some(a => /\[AllowNull\]/.test(a.text));
    const isRequired = attrs.some(a => /\[Required\]/.test(a.text));

    columns.push({
      name,
      type: mapCSharpTypeToSQL(csharpType.replace('?', '')),
      nullable: !isPrimary && (isNullable || !isRequired),
      unique: isPrimary,
      primaryKey: isPrimary,
      autoIncrement: isPrimary,
      sourceKind: 'entity',
    });
  }

  return columns;
}

function mapCSharpTypeToSQL(csType: string): string {
  const map: Record<string, string> = {
    string: 'varchar', String: 'varchar',
    int: 'int', Int32: 'int', Integer: 'int',
    long: 'bigint', Int64: 'bigint',
    short: 'smallint', Int16: 'smallint',
    bool: 'boolean', Boolean: 'boolean',
    float: 'float', Float: 'float', Single: 'float',
    double: 'double', Double: 'double',
    decimal: 'decimal', Decimal: 'decimal',
    DateTime: 'timestamp', DateTimeOffset: 'timestamptz',
    DateOnly: 'date', TimeOnly: 'time',
    Guid: 'uuid',
    byte: 'tinyint',
  };
  return map[csType] ?? csType.toLowerCase();
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
