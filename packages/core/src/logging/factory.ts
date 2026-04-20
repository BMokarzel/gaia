import type { LogLevel, LogTransport, Logger } from './types';
import { CoreLogger } from './core-logger';
import { NullLogger } from './null-logger';

export interface LoggerOptions {
  /** Nível mínimo de emissão. Default: 'info' */
  level?: LogLevel;
  /** Bindings iniciais aplicados a todas as entradas. */
  bindings?: Record<string, unknown>;
}

/**
 * Cria um Logger concreto para o componente informado.
 *
 * @param component  Identificador do módulo: 'core.orchestrator', 'api.extraction', etc.
 * @param transports Lista de sinks. Se vazia, retorna NullLogger.
 * @param options    Nível mínimo e bindings globais do logger.
 */
export function createLogger(
  component: string,
  transports: LogTransport[],
  options: LoggerOptions = {},
): Logger {
  if (transports.length === 0) return NullLogger;
  return new CoreLogger(component, transports, options);
}
