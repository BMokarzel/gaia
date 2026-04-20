import type { LogTransport, LogEntry, LogLevel } from '../types';
import { levelRank } from '../types';

export interface ConsoleTransportOptions {
  /** Nível mínimo para exibir. Default: 'info' */
  level?: LogLevel;
  /** Habilita cores ANSI. Default: true quando stderr.isTTY */
  colorize?: boolean;
  /** Exibe o JSON completo em vez de formato legível. Default: false */
  json?: boolean;
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',  // cinza
  info:  '\x1b[36m',  // ciano
  warn:  '\x1b[33m',  // amarelo
  error: '\x1b[31m',  // vermelho
};
const RESET = '\x1b[0m';
const DIM   = '\x1b[2m';
const BOLD  = '\x1b[1m';

export class ConsoleTransport implements LogTransport {
  private readonly minLevel: LogLevel;
  private readonly colorize: boolean;
  private readonly json: boolean;

  constructor(opts: ConsoleTransportOptions = {}) {
    this.minLevel = opts.level ?? 'info';
    this.colorize = opts.colorize ?? (process.stderr.isTTY ?? false);
    this.json = opts.json ?? false;
  }

  write(entry: LogEntry): void {
    if (levelRank(entry.level) < levelRank(this.minLevel)) return;

    if (this.json) {
      process.stderr.write(JSON.stringify(entry) + '\n');
      return;
    }

    process.stderr.write(this.format(entry) + '\n');
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}

  private format(entry: LogEntry): string {
    const c = this.colorize;
    const time = entry.ts.slice(11, 23); // HH:MM:SS.mmm
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const color = c ? COLORS[entry.level] : '';
    const reset = c ? RESET : '';
    const dim   = c ? DIM   : '';
    const bold  = c ? BOLD  : '';

    // Campos extras (exceto campos reservados da LogEntry)
    const RESERVED = new Set(['v', 'ts', 'level', 'component', 'msg', 'pid', 'err']);
    const extras = Object.entries(entry)
      .filter(([k]) => !RESERVED.has(k))
      .map(([k, v]) => `${dim}${k}=${JSON.stringify(v)}${reset}`)
      .join(' ');

    const header =
      `${dim}${time}${reset} ` +
      `${color}${bold}${levelStr}${reset} ` +
      `${dim}[${entry.component}]${reset} ` +
      `${entry.msg}`;

    const extraStr = extras ? `  ${extras}` : '';

    if (entry.err) {
      const errLine = `\n  ${color}${entry.err.name}: ${entry.err.message}${reset}`;
      const stack = entry.err.stack
        ? `\n${dim}${entry.err.stack.split('\n').slice(1).join('\n')}${reset}`
        : '';
      return `${header}${extraStr}${errLine}${stack}`;
    }

    return `${header}${extraStr}`;
  }
}
