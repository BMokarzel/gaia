import type { LogTransport, LogEntry } from '../types';

/** Fan-out: escreve para múltiplos transports simultaneamente. */
export class CompositeTransport implements LogTransport {
  constructor(private readonly transports: LogTransport[]) {}

  write(entry: LogEntry): void {
    for (const t of this.transports) {
      try {
        t.write(entry);
      } catch { /* falha isolada não afeta os outros */ }
    }
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.transports.map(t => t.flush()));
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.transports.map(t => t.close()));
  }
}
