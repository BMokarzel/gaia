import type { SyntaxNode } from '../../../utils/ast-helpers';
import { findAll, toLocation, extractStringValue } from '../../../utils/ast-helpers';
import { nodeId, resourceId, tableId as makeTableId } from '../../../utils/id';
import type { DbProcessNode, DatabaseNode, TableNode } from '../../../types/topology';

/** GORM v2 methods → canonical operation */
const GORM_OPERATIONS: Record<string, DbProcessNode['metadata']['operation']> = {
  Find: 'findMany',
  FindInBatches: 'findMany',
  Scan: 'findMany',
  Pluck: 'findMany',
  First: 'findFirst',
  Last: 'findFirst',
  Take: 'findFirst',
  Create: 'create',
  CreateInBatches: 'createMany',
  Save: 'upsert',
  Update: 'update',
  Updates: 'update',
  UpdateColumn: 'update',
  UpdateColumns: 'update',
  Delete: 'delete',
  Count: 'count',
  Raw: 'raw',
  Exec: 'raw',
  Transaction: 'transaction',
  Begin: 'transaction',
};

/** database/sql + sqlx methods → canonical operation */
const SQL_OPERATIONS: Record<string, DbProcessNode['metadata']['operation']> = {
  Query: 'findMany',
  QueryRow: 'findFirst',
  QueryContext: 'findMany',
  QueryRowContext: 'findFirst',
  Get: 'findFirst',   // sqlx
  Select: 'findMany', // sqlx
  NamedExec: 'raw',   // sqlx
  NamedQuery: 'findMany',
};

/** Padrões que indicam um handle de banco de dados */
const DB_HANDLE_PATTERN = /\bdb\b|\bgorm\b|\bsqlx\b|\bconn\b|\bstore\b|\btx\b|\brepo\b|\borm\b/i;

export interface GoDbExtractionResult {
  dbNodes: DbProcessNode[];
  database: DatabaseNode;
}

/**
 * Extrai operações de banco de dados de arquivos Go.
 * Suporta: GORM v2, database/sql, sqlx.
 *
 * Padrões detectados:
 *   db.Find(&users)
 *   db.Where("name = ?", name).First(&user)
 *   db.Model(&user).Updates(map)
 *   db.Create(&order)
 *   db.Delete(&Product{}, id)
 *   db.Raw("SELECT ...").Scan(&result)
 *   db.Query("SELECT ... FROM table", args...)   (database/sql)
 *   db.Get(&user, "SELECT ...", args...)          (sqlx)
 */
export function extractGoDbOperations(
  rootNode: SyntaxNode,
  filePath: string,
): GoDbExtractionResult {
  const dbId = resourceId('database', 'go-db');

  const database: DatabaseNode = {
    id: dbId,
    type: 'database',
    name: 'database',
    metadata: {
      engine: 'custom',
      category: 'sql',
      connectionAlias: 'db',
    },
    tables: [],
  };

  const tablesMap = new Map<string, TableNode>();
  const dbNodes: DbProcessNode[] = [];

  const calls = findAll(rootNode, 'call_expression');

  for (const call of calls) {
    const fn = call.childForFieldName('function');
    if (!fn || fn.type !== 'selector_expression') continue;

    const sel = fn.childForFieldName('field')?.text ?? '';
    const operand = fn.childForFieldName('operand');
    const objText = operand?.text ?? '';

    const gormOp = GORM_OPERATIONS[sel];
    const sqlOp = SQL_OPERATIONS[sel];
    const op = gormOp ?? sqlOp;
    if (!op) continue;

    if (!DB_HANDLE_PATTERN.test(objText)) continue;

    const args = call.childForFieldName('arguments');
    const loc = toLocation(call, filePath);

    // Detecta o model/table — tenta várias estratégias
    let modelName =
      extractChainedModel(fn) ??
      extractGormStructArg(args) ??
      extractSqlTable(call) ??
      'unknown';

    const tableKey = modelName.toLowerCase();
    if (!tablesMap.has(tableKey) && modelName !== 'unknown') {
      const tId = makeTableId(dbId, modelName);
      tablesMap.set(tableKey, {
        id: tId,
        type: 'table',
        name: modelName,
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

    const table = tablesMap.get(tableKey);
    const id = nodeId('dbProcess', filePath, loc.line, `${modelName}.${sel}`);

    // Para raw SQL, refina a operação com base no conteúdo da query
    const finalOp = op === 'raw' ? (refineRawOp(args) ?? op) : op;

    dbNodes.push({
      id,
      type: 'dbProcess',
      name: `${modelName}.${sel}`,
      location: loc,
      children: [],
      metadata: {
        operation: finalOp,
        databaseId: dbId,
        tableId: table?.id ?? makeTableId(dbId, 'unknown'),
        orm: detectOrm(objText, sel),
        conditions: extractWhereCondition(fn),
      },
      raw: call.text.length < 300 ? call.text : undefined,
    });
  }

  database.tables = Array.from(tablesMap.values());
  return { dbNodes, database };
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Para db.Model(&User{}).Updates(...) — extrai User do .Model() encadeado
 */
function extractChainedModel(selectorNode: SyntaxNode): string | null {
  const operand = selectorNode.childForFieldName('operand');
  if (!operand) return null;

  if (operand.type === 'call_expression') {
    const innerFn = operand.childForFieldName('function');
    const innerArgs = operand.childForFieldName('arguments');

    if (innerFn?.type === 'selector_expression') {
      const innerSel = innerFn.childForFieldName('field')?.text ?? '';
      if (innerSel === 'Model' && innerArgs) {
        return extractGormStructArg(innerArgs);
      }
      // Recursivo para chains como db.Where().Model().First()
      return extractChainedModel(innerFn);
    }
  }
  return null;
}

/**
 * Extrai o nome do struct de um argumento &User{} ou &user
 */
function extractGormStructArg(args: SyntaxNode | null): string | null {
  if (!args) return null;
  const text = args.text;

  // &Users{} ou &User{id: 1} → User/Users
  const ptrStruct = text.match(/&([A-Z][a-zA-Z0-9]*)\s*[\{,\)]/);
  if (ptrStruct) return ptrStruct[1];

  // &slice → tenta inferir
  const ptrVar = text.match(/&([a-zA-Z][a-zA-Z0-9]*)\s*[,\)]/);
  if (ptrVar) {
    const v = ptrVar[1];
    // Converte plural para singular (heurística simples)
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  return null;
}

/**
 * Extrai o nome da tabela de uma query SQL raw no primeiro argumento
 */
function extractSqlTable(call: SyntaxNode): string | null {
  const args = call.childForFieldName('arguments');
  if (!args) return null;

  const firstArg = args.namedChildren[0];
  if (!firstArg) return null;

  const sql = extractStringValue(firstArg) ?? firstArg.text;
  if (!sql) return null;

  const patterns = [
    /\bFROM\s+["'`]?(\w+)["'`]?/i,
    /\bINSERT\s+INTO\s+["'`]?(\w+)["'`]?/i,
    /\bUPDATE\s+["'`]?(\w+)["'`]?/i,
    /\bDELETE\s+FROM\s+["'`]?(\w+)["'`]?/i,
    /\bINTO\s+["'`]?(\w+)["'`]?/i,
  ];

  for (const pattern of patterns) {
    const m = sql.match(pattern);
    if (m) return m[1];
  }
  return null;
}

/**
 * Sobe na chain de calls para encontrar um .Where() e retorna sua condição
 * db.Where("age > ?", 18).Find(&users) → "\"age > ?\", 18"
 */
function extractWhereCondition(selectorNode: SyntaxNode): string | undefined {
  const operand = selectorNode.childForFieldName('operand');
  if (!operand || operand.type !== 'call_expression') return undefined;

  const innerFn = operand.childForFieldName('function');
  if (innerFn?.type !== 'selector_expression') return undefined;

  const innerSel = innerFn.childForFieldName('field')?.text ?? '';
  if (['Where', 'Having', 'Not', 'Or'].includes(innerSel)) {
    const innerArgs = operand.childForFieldName('arguments');
    return innerArgs?.text.slice(0, 200);
  }

  return extractWhereCondition(innerFn);
}

function refineRawOp(
  args: SyntaxNode | null,
): DbProcessNode['metadata']['operation'] | null {
  if (!args) return null;
  const sql = args.text.toUpperCase();
  if (sql.includes('SELECT')) return 'findMany';
  if (sql.includes('INSERT')) return 'create';
  if (sql.includes('UPDATE')) return 'update';
  if (sql.includes('DELETE')) return 'delete';
  return null;
}

function detectOrm(objText: string, method: string): string {
  if (/gorm/i.test(objText)) return 'gorm';
  if (/sqlx/i.test(objText)) return 'sqlx';
  // sqlx-specific methods
  if (method === 'Get' || method === 'Select' || method === 'NamedExec' || method === 'NamedQuery') {
    return 'sqlx';
  }
  return 'database/sql';
}
