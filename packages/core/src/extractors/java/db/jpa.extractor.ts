import type { SyntaxNode } from '../../../utils/ast-helpers';
import {
  findAll, toLocation, fieldText,
} from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode, ColumnDef } from '../../../types/topology';

/**
 * Extrai entidades JPA/Hibernate e repositórios Spring Data de arquivos Java.
 * Detecta: @Entity, @Table, @Column, @Id, repositórios com findBy*, save, delete
 */
export function extractJPAOperations(
  rootNode: SyntaxNode,
  filePath: string,
): { dbNodes: DbProcessNode[]; database: DatabaseNode } {
  const dbAlias = 'jpa';
  const dbId = resourceId('database', dbAlias);

  const database: DatabaseNode = {
    id: dbId,
    type: 'database',
    name: 'jpa',
    metadata: {
      engine: 'postgresql',
      category: 'sql',
      connectionAlias: dbAlias,
    },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  const classes = findAll(rootNode, 'class_declaration');

  for (const classNode of classes) {
    const annotations = findAll(classNode, 'marker_annotation')
      .concat(findAll(classNode, 'annotation'));

    // Detecta @Entity para extrair schema
    const entityAnn = annotations.find(a =>
      a.childForFieldName('name')?.text === 'Entity'
    );

    if (entityAnn) {
      const table = extractEntityTable(classNode, annotations, dbId);
      if (table) {
        tablesMap.set(table.name.toLowerCase(), table);
        database.tables.push(table);
      }
      continue;
    }

    // Detecta repositório JPA (interface extends JpaRepository/CrudRepository)
    const isInterface = classNode.type === 'interface_declaration';
    if (isInterface) {
      const repoOps = extractRepositoryOperations(classNode, filePath, dbId, tablesMap);
      dbNodes.push(...repoOps);
    }
  }

  // Também procura chamadas de método de repositório no código
  const methodCalls = findAll(rootNode, 'method_invocation');
  for (const call of methodCalls) {
    const methodName = call.childForFieldName('name')?.text ?? '';
    const operation = mapJPAMethod(methodName);
    if (!operation) continue;

    const obj = call.childForFieldName('object');
    const objText = obj?.text ?? '';

    // Verifica se parece um repositório
    if (!/(repository|repo|service)/i.test(objText) && !/(this\.)/i.test(objText)) continue;

    const modelName = inferModelFromRepo(objText);
    const tableKey = modelName.toLowerCase();

    if (!tablesMap.has(tableKey) && modelName !== 'unknown') {
      const tId = makeTableId(dbId, modelName);
      const table: TableNode = {
        id: tId,
        type: 'table',
        name: modelName,
        metadata: {
          kind: 'table',
          databaseId: dbId,
          entityName: modelName,
          hasTimestamps: false,
          hasSoftDelete: false,
          columns: [],
        },
      };
      tablesMap.set(tableKey, table);
      database.tables.push(table);
    }

    const table = tablesMap.get(tableKey) ?? { id: makeTableId(dbId, 'unknown'), name: 'unknown' } as TableNode;
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
        orm: 'jpa',
      },
    });
  }

  return { dbNodes, database };
}

function extractEntityTable(
  classNode: SyntaxNode,
  annotations: SyntaxNode[],
  dbId: string,
): TableNode | null {
  const className = fieldText(classNode, 'name') ?? 'Unknown';

  // Detecta nome da tabela via @Table(name = "users")
  const tableAnn = annotations.find(a => a.childForFieldName('name')?.text === 'Table');
  const tableName = tableAnn
    ? (extractAnnotationStringAttr(tableAnn, 'name') ?? toSnakeCase(className))
    : toSnakeCase(className);

  const tId = makeTableId(dbId, tableName);
  const columns: ColumnDef[] = [];

  // Extrai campos da classe
  const fields = findAll(classNode, 'field_declaration');

  for (const field of fields) {
    const fieldAnnotations = findAll(field, 'marker_annotation')
      .concat(findAll(field, 'annotation'));

    const hasColumnAnn = fieldAnnotations.some(a =>
      ['Column', 'Id', 'GeneratedValue', 'JoinColumn', 'OneToMany',
       'ManyToOne', 'ManyToMany', 'OneToOne', 'Lob', 'Enumerated'].includes(
        a.childForFieldName('name')?.text ?? ''
      )
    );

    if (!hasColumnAnn && !fieldAnnotations.some(a => a.childForFieldName('name')?.text === 'Id')) {
      continue;
    }

    const typeNode = field.childForFieldName('type');
    const declarators = field.childForFieldName('declarator') ?? field;
    const nameNode = findAll(declarators, 'variable_declarator')[0]?.childForFieldName('name')
      ?? findAll(field, 'identifier')[0];

    const fieldName = nameNode?.text ?? 'unknown';
    const javaType = typeNode?.text ?? 'Object';

    const isId = fieldAnnotations.some(a => a.childForFieldName('name')?.text === 'Id');
    const isGenerated = fieldAnnotations.some(a =>
      a.childForFieldName('name')?.text === 'GeneratedValue'
    );

    const columnAnn = fieldAnnotations.find(a => a.childForFieldName('name')?.text === 'Column');
    const columnName = columnAnn
      ? (extractAnnotationStringAttr(columnAnn, 'name') ?? toSnakeCase(fieldName))
      : toSnakeCase(fieldName);

    const nullable = columnAnn
      ? !columnAnn.text.includes('nullable = false')
      : !isId;

    const unique = columnAnn
      ? columnAnn.text.includes('unique = true')
      : false;

    const lengthMatch = columnAnn?.text.match(/length\s*=\s*(\d+)/);
    const length = lengthMatch ? parseInt(lengthMatch[1], 10) : undefined;

    columns.push({
      name: columnName,
      type: mapJavaTypeToSQL(javaType),
      nullable,
      unique: unique || isId,
      primaryKey: isId,
      autoIncrement: isGenerated,
      length,
      decorators: fieldAnnotations.map(a => a.childForFieldName('name')?.text ?? '').filter(Boolean),
      sourceKind: 'entity',
    });
  }

  const hasTimestamps = columns.some(c =>
    ['created_at', 'createdAt', 'updated_at', 'updatedAt'].includes(c.name)
  );
  const hasSoftDelete = columns.some(c =>
    ['deleted_at', 'deletedAt', 'removed_at'].includes(c.name)
  );

  return {
    id: tId,
    type: 'table',
    name: tableName,
    metadata: {
      kind: 'table',
      databaseId: dbId,
      entityName: className,
      columns,
      hasTimestamps,
      hasSoftDelete,
      primaryKey: columns.filter(c => c.primaryKey).map(c => c.name),
    },
  };
}

function extractRepositoryOperations(
  interfaceNode: SyntaxNode,
  filePath: string,
  dbId: string,
  tablesMap: Map<string, TableNode>,
): DbProcessNode[] {
  return [];
}

const JPA_METHOD_MAP: Record<string, DbProcessNode['metadata']['operation']> = {
  save: 'upsert',
  saveAll: 'createMany',
  saveAndFlush: 'upsert',
  findById: 'findUnique',
  findAll: 'findMany',
  findBy: 'findMany',
  delete: 'delete',
  deleteById: 'delete',
  deleteAll: 'deleteMany',
  count: 'count',
  existsById: 'count',
  findFirst: 'findFirst',
  getOne: 'findUnique',
  getById: 'findUnique',
};

function mapJPAMethod(method: string): DbProcessNode['metadata']['operation'] | null {
  if (method in JPA_METHOD_MAP) return JPA_METHOD_MAP[method];
  if (method.startsWith('findBy')) return 'findMany';
  if (method.startsWith('findOneBy') || method.startsWith('findFirst')) return 'findFirst';
  if (method.startsWith('deleteBy')) return 'deleteMany';
  if (method.startsWith('countBy')) return 'count';
  if (method.startsWith('existsBy')) return 'count';
  return null;
}

function inferModelFromRepo(repoName: string): string {
  const match = repoName.match(/(?:this\.)?(\w+?)(?:[Rr]epository|[Rr]epo)(?:\b|$)/);
  if (match) return toPascalCase(match[1]);
  return 'unknown';
}

function extractAnnotationStringAttr(ann: SyntaxNode, attr: string): string | null {
  const args = ann.childForFieldName('arguments');
  if (!args) return null;
  const match = args.text.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`));
  return match ? match[1] : null;
}

function mapJavaTypeToSQL(javaType: string): string {
  const map: Record<string, string> = {
    String: 'varchar',
    Integer: 'int',
    Long: 'bigint',
    Boolean: 'boolean',
    Double: 'double',
    Float: 'float',
    Date: 'timestamp',
    LocalDate: 'date',
    LocalDateTime: 'timestamp',
    BigDecimal: 'decimal',
    UUID: 'uuid',
    byte: 'tinyint',
    short: 'smallint',
    int: 'int',
    long: 'bigint',
    boolean: 'boolean',
    double: 'double',
    float: 'float',
  };
  return map[javaType.trim()] ?? javaType.toLowerCase();
}

function toSnakeCase(str: string): string {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
