import { Injectable, Inject, LoggerService } from '@nestjs/common';
import type { Logger } from '@topology/core';
import { LOGGER_TOKEN } from './logger.token';

/**
 * Adapter entre a interface LoggerService do NestJS e o contrato Logger interno.
 * Registrado como logger global via app.useLogger() em main.ts.
 */
@Injectable()
export class TopologyLoggerService implements LoggerService {
  constructor(
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {}

  log(message: string, context?: string): void {
    this.logger.info(message, context ? { context } : undefined);
  }

  error(message: string, trace?: string, context?: string): void {
    const cause = trace ? Object.assign(new Error(message), { stack: trace }) : undefined;
    this.logger.error(message, cause, context ? { context } : undefined);
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, context ? { context } : undefined);
  }

  debug(message: string, context?: string): void {
    this.logger.debug(message, context ? { context } : undefined);
  }

  verbose(message: string, context?: string): void {
    this.logger.debug(message, context ? { context } : undefined);
  }
}
