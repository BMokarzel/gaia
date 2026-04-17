import type { SourceFile } from '../core/walker';
import type { AnalysisContext, CodeNode, DatabaseNode, BrokerNode } from '../types/topology';

export interface ParseResult {
  codeNodes: CodeNode[];
  /** Databases detectados no arquivo */
  databases: DatabaseNode[];
  /** Brokers detectados no arquivo */
  brokers: BrokerNode[];
}

/**
 * Interface que todos os parsers de linguagem devem implementar
 */
export interface LanguageParser {
  /** Retorna as extensões de arquivo que este parser suporta */
  readonly supportedExtensions: string[];

  /**
   * Parseia um arquivo fonte e retorna nós de código
   * @param file - Arquivo fonte a ser analisado
   * @param context - Contexto de análise compartilhado do repositório
   */
  parse(file: SourceFile, context: AnalysisContext): ParseResult;

  /**
   * Verifica se este parser suporta o arquivo
   */
  supports(file: SourceFile): boolean;
}

/**
 * Resultado vazio — helper para retornar quando o arquivo é irrelevante
 */
export function emptyResult(): ParseResult {
  return { codeNodes: [], databases: [], brokers: [] };
}

/**
 * Merge de resultados de múltiplos parsers/extractors
 */
export function mergeResults(...results: ParseResult[]): ParseResult {
  return {
    codeNodes: results.flatMap(r => r.codeNodes),
    databases: results.flatMap(r => r.databases),
    brokers: results.flatMap(r => r.brokers),
  };
}
