import type { Logger } from './types';

/**
 * Logger que descarta tudo silenciosamente.
 * Usado como default em testes e como fallback quando nenhum logger é fornecido.
 */
export const NullLogger: Logger = Object.freeze({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NullLogger,
});
