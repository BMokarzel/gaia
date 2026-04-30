/**
 * SourceFile — input mínimo dos walkers. Definido localmente porque o pacote
 * é autônomo e não importa de @topology/core.
 */

export interface SourceFile {
  /** Caminho relativo (preferencial) ou absoluto. Usado em element.location.file. */
  path: string;
  /** Conteúdo bruto. */
  content: string;
  /** Extensão com ponto (ex.: '.ts', '.tsx'). */
  extension: string;
  /** Linguagem hint — opcional, walkers podem deduzir da extensão. */
  language?: string;
}
