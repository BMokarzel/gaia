import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode, ColumnDef } from '../../../types/topology';

const DJANGO_OPERATIONS: Record<string, DbProcessNode['metadata']['operation']> = {
  get: 'findUnique',
  filter: 'findMany',
  all: 'findMany',
  first: 'findFirst',
  last: 'findFirst',
  latest: 'findFirst',
  earliest: 'findFirst',
  create: 'create',
  get_or_create: 'upsert',
  update_or_create: 'upsert',
  bulk_create: 'createMany',
  bulk_update: 'updateMany',
  update: 'update',
  delete: 'delete',
  count: 'count',
  exists: 'count',
  values: 'findMany',
  values_list: 'findMany',
  aggregate: 'aggregate',
  annotate: 'findMany',
  exclude: 'findMany',
  order_by: 'findMany',
  select_related: 'findMany',
  prefetch_related: 'findMany',
};

export interface DjangoOrmExtractionResult {
  dbNodes: DbProcessNode[];
  database: DatabaseNode;
}

export function extractDjangoOrmOperations(
  rootNode: SyntaxNode,
  filePath: string,
): DjangoOrmExtractionResult {
  const dbAlias = 'django';
  const dbId = resourceId('database', dbAlias);

  const database: DatabaseNode = {
    id: dbId,
    type: 'database',
    name: dbAlias,
    metadata: { engine: 'postgresql', category: 'sql', connectionAlias: dbAlias },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  // Detect Django Model classes
  for (const cls of findAll(rootNode, 'class_definition')) {
    const bases = (cls.childForFieldName('superclasses')?.namedChildren ?? []).map(c => c.text);
    const isDjangoModel = bases.some(b => /models\.Model|Model/i.test(b));
    if (!isDjangoModel) continue;

    const name = cls.childForFieldName('name')?.text ?? 'Unknown';
    const tableName = extractDjangoTableName(cls) ?? toSnakeCase(name);
    const tableKey = tableName.toLowerCase();

    if (!tablesMap.has(tableKey)) {
      const tId = makeTableId(dbId, tableName);
      const columns = extractDjangoColumns(cls, tId);
      tablesMap.set(tableKey, {
        id: tId,
        type: 'table',
        name: tableName,
        columns: [],
        metadata: {
          kind: 'table',
          databaseId: dbId,
          entityName: name,
          columns,
          hasTimestamps: columns.some(c => ['created_at', 'updated_at'].includes(c.name)),
          hasSoftDelete: columns.some(c => c.name === 'deleted_at'),
        },
      });
    }
  }

  // Detect Model.objects.method() calls
  const calls = findAll(rootNode, 'call');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'attribute') continue;

    const attr = fn.childForFieldName('attribute')?.text ?? '';
    const operation = DJANGO_OPERATIONS[attr];
    if (!operation) continue;

    const obj = fn.childForFieldName('object');
    if (!obj) continue;

    // Model.objects.filter() or queryset.filter()
    // obj.text could be "Model.objects" or "qs" (queryset variable)
    const objText = obj.text;
    const modelName = extractModelFromObjects(objText);

    if (!modelName) continue;
    if (!/^[A-Z]/.test(modelName)) continue;

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
          hasTimestamps: true, // Django auto_now_add is common
          hasSoftDelete: false,
          columns: [],
        },
      });
    }

    const table = tablesMap.get(tableKey)!;
    const loc = toLocation(call, filePath);
    const id = nodeId('dbProcess', filePath, loc.line, `${modelName}.${attr}`);

    dbNodes.push({
      id,
      type: 'dbProcess',
      name: `${modelName}.${attr}`,
      location: loc,
      children: [],
      metadata: {
        operation,
        databaseId: dbId,
        tableId: table.id,
        orm: 'django',
      },
      raw: call.text.length < 300 ? call.text : undefined,
    });
  }

  database.tables = Array.from(tablesMap.values());
  return { dbNodes, database };
}

function extractModelFromObjects(objText: string): string | null {
  // User.objects → 'User'
  const match = objText.match(/^([A-Z][a-zA-Z0-9_]*)\.objects/);
  return match ? match[1] : null;
}

function extractDjangoTableName(classNode: SyntaxNode): string | null {
  const body = classNode.childForFieldName('body') ?? classNode;
  // Look for Meta class with db_table = "name"
  for (const inner of findAll(body, 'class_definition')) {
    const innerName = inner.childForFieldName('name')?.text;
    if (innerName !== 'Meta') continue;
    const metaBody = inner.childForFieldName('body') ?? inner;
    for (const stmt of metaBody.namedChildren) {
      const left = stmt.childForFieldName('left') ?? stmt.namedChildren[0];
      if (left?.text !== 'db_table') continue;
      const right = stmt.childForFieldName('right') ?? stmt.namedChildren[1];
      return right?.text.replace(/^['"]|['"]$/g, '') ?? null;
    }
  }
  return null;
}

function extractDjangoColumns(classNode: SyntaxNode, tableId: string): ColumnDef[] {
  const columns: ColumnDef[] = [];
  const body = classNode.childForFieldName('body') ?? classNode;

  for (const stmt of body.namedChildren) {
    const left = (stmt.childForFieldName('left') ?? stmt.namedChildren[0]);
    const right = (stmt.childForFieldName('right') ?? stmt.namedChildren[1]);
    if (!left || !right) continue;

    const name = left.text;
    if (name.startsWith('_') || !/^[a-z]/.test(name)) continue;

    const rText = right.text;
    if (!/models\.\w+Field|models\.ManyToMany|models\.OneToOne|models\.ForeignKey/.test(rText)) continue;

    const fieldMatch = rText.match(/models\.(\w+)/);
    const fieldType = fieldMatch ? fieldMatch[1] : 'CharField';

    const isPrimary = name === 'id' || rText.includes('primary_key=True');
    const isNullable = rText.includes('null=True');
    const isUnique = rText.includes('unique=True') || isPrimary;
    const hasDefault = rText.includes('default=') || rText.includes('auto_now');

    columns.push({
      name,
      type: mapDjangoFieldToSQL(fieldType),
      nullable: isNullable,
      unique: isUnique,
      primaryKey: isPrimary,
      autoIncrement: isPrimary,
      sourceKind: 'entity',
    });
  }

  return columns;
}

function mapDjangoFieldToSQL(fieldType: string): string {
  const map: Record<string, string> = {
    AutoField: 'int', BigAutoField: 'bigint', SmallAutoField: 'smallint',
    CharField: 'varchar', TextField: 'text', EmailField: 'varchar',
    URLField: 'varchar', SlugField: 'varchar', UUIDField: 'uuid',
    IntegerField: 'int', BigIntegerField: 'bigint', SmallIntegerField: 'smallint',
    PositiveIntegerField: 'int', PositiveBigIntegerField: 'bigint',
    FloatField: 'float', DecimalField: 'decimal',
    BooleanField: 'boolean', NullBooleanField: 'boolean',
    DateField: 'date', DateTimeField: 'timestamp', TimeField: 'time',
    DurationField: 'interval',
    JSONField: 'json', BinaryField: 'bytea',
    ForeignKey: 'int', OneToOneField: 'int', ManyToManyField: 'int',
    ImageField: 'varchar', FileField: 'varchar',
  };
  return map[fieldType] ?? 'varchar';
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}
