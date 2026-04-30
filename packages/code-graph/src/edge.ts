/**
 * Edge — relação tipada entre dois Elements.
 * Referência: AST_FLOW_EXTRACTION_PLAN.md §2.4
 */

export type EdgeKind =
  // Estrutura
  | 'contains'
  // Comportamento
  | 'calls'
  | 'branches_to'
  | 'loop_iterates'
  | 'try_handles'
  // Dependências
  | 'imports'
  | 'injects'
  | 'extends'
  | 'implements'
  // Tipos
  | 'returns_type'
  | 'throws_type'
  | 'typed_as'
  // Dados
  | 'reads'
  | 'writes';

export const ALL_EDGE_KINDS: ReadonlyArray<EdgeKind> = [
  'contains',
  'calls',
  'branches_to',
  'loop_iterates',
  'try_handles',
  'imports',
  'injects',
  'extends',
  'implements',
  'returns_type',
  'throws_type',
  'typed_as',
  'reads',
  'writes',
];

export interface EdgeMeta {
  /** Para branches_to: o texto da condição que originou o caminho. */
  conditionText?: string;
  /** Rótulo legível para visualização. */
  label?: string;
  /** Campos arbitrários — preserva extensibilidade sem mudar tipo. */
  [key: string]: unknown;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  meta?: EdgeMeta;
}
