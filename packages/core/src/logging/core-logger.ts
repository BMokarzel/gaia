import type { Logger, LogTransport, LogEntry, LogLevel } from './types';
import { levelRank } from './types';
import { sanitizeContext, sanitizeMessage } from './sanitize';

export class CoreLogger implements Logger {
  private readonly bindings: Record<string, unknown>;
  private readonly minLevel: LogLevel;

  constructor(
    private readonly component: string,
    private readonly transports: LogTransport[],
    options: { level?: LogLevel; bindings?: Record<string, unknown> } = {},
  ) {
    this.minLevel = options.level ?? 'info';
    this.bindings = options.bindings ?? {};
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.emit('debug', msg, undefined, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.emit('info', msg, undefined, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.emit('warn', msg, undefined, context);
  }

  error(msg: string, cause?: Error, context?: Record<string, unknown>): void {
    this.emit('error', msg, cause, context);
  }

  child(bindings: Record<string, unknown>): Logger {
    return new CoreLogger(this.component, this.transports, {
      level: this.minLevel,
      bindings: { ...this.bindings, ...sanitizeContext(bindings) },
    });
  }

  private emit(
    level: LogLevel,
    msg: string,
    cause: Error | undefined,
    context: Record<string, unknown> | undefined,
  ): void {
    if (levelRank(level) < levelRank(this.minLevel)) return;

    const entry: LogEntry = {
      v: 1,
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg: sanitizeMessage(msg),
      pid: process.pid,
      ...this.bindings,
      ...(context ? sanitizeContext(context) : {}),
    };

    if (cause) {
      entry.err = {
        name: cause.name,
        message: cause.message,
        stack: cause.stack,
      };
    }

    for (const t of this.transports) {
      try {
        t.write(entry);
      } catch {
        // transport failure nunca deve derrubar o processo
      }
    }
  }
}
