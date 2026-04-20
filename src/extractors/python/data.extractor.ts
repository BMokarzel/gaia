import type { SyntaxNode } from '../../utils/ast-helpers';
import { findAll, toLocation } from '../../utils/ast-helpers';
import { nodeId } from '../../utils/id';
import type { DataNode, TypedField } from '../../types/topology';

export function extractPythonDataNodes(
  rootNode: SyntaxNode,
  filePath: string,
): DataNode[] {
  const nodes: DataNode[] = [];

  for (const cls of findAll(rootNode, 'class_definition')) {
    const nameNode = cls.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const loc = toLocation(cls, filePath);

    // Detect base classes to categorize
    const bases = extractBaseClasses(cls);
    const kind = detectDataKind(bases);
    if (!kind) continue; // Skip regular classes (controllers, services)

    const id = nodeId('data', filePath, loc.line, name);
    const fields = extractPythonClassFields(cls, kind);

    const decorators = collectClassDecorators(cls);

    nodes.push({
      id,
      type: 'data',
      name,
      location: loc,
      children: [],
      metadata: {
        kind: 'interface',
        mutable: false,
        scope: 'module' as const,
        fields,
        exported: !name.startsWith('_'),
      },
    });
  }

  // TypedDict via TypedDict inheritance is handled above via bases detection
  // Also handle TypedDict via assignment: MyDict = TypedDict('MyDict', {...})
  for (const assign of findAll(rootNode, 'assignment')) {
    const left = assign.childForFieldName('left');
    const right = assign.childForFieldName('right');
    if (!left || !right) continue;
    if (!right.text.startsWith('TypedDict(')) continue;

    const name = left.text;
    const loc = toLocation(assign, filePath);
    const id = nodeId('data', filePath, loc.line, name);

    nodes.push({
      id,
      type: 'data',
      name,
      location: loc,
      children: [],
      metadata: { kind: 'interface', mutable: false, scope: 'module' as const, fields: [], exported: !name.startsWith('_') },
    });
  }

  return nodes;
}

function extractBaseClasses(classNode: SyntaxNode): string[] {
  const args = classNode.childForFieldName('superclasses');
  if (!args) return [];
  return args.namedChildren.map(c => {
    const text = c.text;
    // Handle generics: BaseModel[T] → BaseModel
    return text.split('[')[0].split('.')[-1 >>> 0] ?? text;
  });
}

function detectDataKind(bases: string[]): 'pydantic' | 'dataclass' | 'typeddict' | 'enum' | null {
  for (const base of bases) {
    if (/BaseModel|Schema|BaseSchema|SQLModel/i.test(base)) return 'pydantic';
    if (/TypedDict/i.test(base)) return 'typeddict';
    if (/Enum|IntEnum|StrEnum|Flag/i.test(base)) return 'enum';
  }
  return null;
}

function extractPythonClassFields(classNode: SyntaxNode, kind: string): TypedField[] {
  const fields: TypedField[] = [];
  const body = classNode.childForFieldName('body') ?? classNode;

  for (const stmt of body.namedChildren) {
    // Annotated assignment: name: type = default
    if (stmt.type === 'expression_statement') {
      const expr = stmt.namedChildren[0];
      if (expr?.type === 'assignment' || expr?.type === 'augmented_assignment') continue;
    }

    if (stmt.type === 'assignment') {
      const left = stmt.childForFieldName('left');
      const name = left?.text ?? '';
      if (name && !name.startsWith('_')) {
        fields.push({ name, type: 'Any', required: true });
      }
      continue;
    }

    // type: annotation  or  name: type = Field(...)
    if (stmt.type === 'annotated_assignment' || stmt.type === 'typed_parameter') {
      const nameNode = stmt.childForFieldName('name') ?? stmt.namedChildren[0];
      const typeNode = stmt.childForFieldName('type') ?? stmt.namedChildren[1];
      const name = nameNode?.text ?? '';
      if (!name || name.startsWith('_')) continue;

      const rawType = typeNode?.text ?? 'Any';
      const isOptional = rawType.startsWith('Optional') || rawType.includes('| None');

      fields.push({ name, type: rawType.replace(/Optional\[(.+)\]/, '$1'), required: !isOptional });
    }
  }

  return fields;
}

function collectClassDecorators(classNode: SyntaxNode): string[] {
  const parent = classNode.parent;
  if (!parent || parent.type !== 'decorated_definition') return [];
  return parent.children
    .filter(c => c.type === 'decorator')
    .map(d => d.text.replace(/^@/, '').split('(')[0].trim());
}
