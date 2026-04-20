export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
export function levelRank(level: LogLevel): number { return LEVEL_RANK[level]; }

export interface LogEntry {
  /** Schema version — permite migrar consumidores sem quebrar parsers existentes */
  v: 1;
  ts: string;
  level: LogLevel;
  /** Componente que originou o log: 'core.orchestrator', 'api.extraction', etc. */
  component: string;
  msg: string;
  pid: number;
  err?: { name: string; message: string; stack?: string };
  /** Campos adicionais injetados via child() ou no call-site */
  [key: string]: unknown;
}

/**
 * Contrato que todas as camadas consomem.
 * Nenhuma camada importa FileTransport, ConsoleTransport ou qualquer implementação concreta.
 */
export interface Logger {
  debug(msg: string, context?: Record<string, unknown>): void;
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
  /** @param cause   Erro original — serializado em entry.err */
  error(msg: string, cause?: Error, context?: Record<string, unknown>): void;
  /**
   * Cria um sub-logger com bindings fixos.
   * Os bindings aparecem em todas as entradas produzidas pelo filho.
   * @example const log = logger.child({ requestId, service });
   */
  child(bindings: Record<string, unknown>): Logger;
}

/** Implementado por cada sink (arquivo, console, remoto, etc.) */
export interface LogTransport {
  write(entry: LogEntry): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}
