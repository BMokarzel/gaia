import {
  appendFileSync, mkdirSync, existsSync, statSync,
  readdirSync, unlinkSync, openSync, closeSync, chmodSync,
} from 'fs';
import { join, resolve, basename, sep } from 'path';
import type { LogTransport, LogEntry } from '../types';
import { safeStringify } from '../sanitize';

export interface FileTransportOptions {
  /** Diretório onde os logs são escritos. Deve estar dentro do projeto. */
  dir: string;
  /** Prefixo do arquivo — normalmente o componente. Default: 'app' */
  component?: string;
  /** Tamanho máximo de um arquivo antes de rotacionar (bytes). Default: 50 MB */
  maxBytes?: number;
  /** Quantos dias manter antes de apagar arquivos antigos. Default: 7 */
  maxAgeDays?: number;
  /**
   * Raiz do projeto — FileTransport recusa `dir` fora dessa raiz.
   * Default: process.cwd()
   */
  projectRoot?: string;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB
const DEFAULT_MAX_AGE_DAYS = 7;

export class FileTransport implements LogTransport {
  private readonly dir: string;
  private readonly component: string;
  private readonly maxBytes: number;
  private readonly maxAgeDays: number;
  private currentDate: string = '';
  private currentPath: string = '';
  private rotationIndex: number = 0;

  constructor(opts: FileTransportOptions) {
    const projectRoot = resolve(opts.projectRoot ?? process.cwd());
    const dir = resolve(opts.dir);

    if (!dir.startsWith(projectRoot + sep) && !dir.startsWith(projectRoot + '/') && dir !== projectRoot) {
      throw new Error(
        `FileTransport: log directory "${dir}" is outside the project root "${projectRoot}". ` +
        `Set projectRoot explicitly if this is intentional.`,
      );
    }

    this.dir = dir;
    this.component = opts.component ?? 'app';
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;

    mkdirSync(this.dir, { recursive: true });
    this.pruneOldFiles();
    this.rotate();
  }

  write(entry: LogEntry): void {
    const today = dateStamp();
    if (today !== this.currentDate || this.sizeExceeded()) {
      this.rotate(today);
    }

    const line = safeStringify(entry) + '\n';
    appendFileSync(this.currentPath, line, { encoding: 'utf-8' });
  }

  async flush(): Promise<void> {
    // appendFileSync é síncrono — não há buffer para flush
  }

  async close(): Promise<void> {
    // sem handles abertos persistentes
  }

  private rotate(date?: string): void {
    const today = date ?? dateStamp();
    this.currentDate = today;
    this.rotationIndex = 0;
    this.currentPath = this.buildPath(today, 0);

    // Se o arquivo já existe e excede o limite, avança o índice
    while (existsSync(this.currentPath) && this.sizeExceeded()) {
      this.rotationIndex += 1;
      this.currentPath = this.buildPath(today, this.rotationIndex);
    }

    if (!existsSync(this.currentPath)) {
      // Cria o arquivo com permissão restrita (somente dono)
      const fd = openSync(this.currentPath, 'a');
      closeSync(fd);
      try { chmodSync(this.currentPath, 0o600); } catch { /* best-effort */ }
    }
  }

  private buildPath(date: string, index: number): string {
    const suffix = index === 0 ? '' : `.${index}`;
    return join(this.dir, `${this.component}-${date}${suffix}.ndjson`);
  }

  private sizeExceeded(): boolean {
    if (!existsSync(this.currentPath)) return false;
    try {
      return statSync(this.currentPath).size >= this.maxBytes;
    } catch {
      return false;
    }
  }

  private pruneOldFiles(): void {
    const cutoff = Date.now() - this.maxAgeDays * 24 * 60 * 60 * 1000;
    let entries: string[];
    try {
      entries = readdirSync(this.dir);
    } catch {
      return;
    }

    for (const name of entries) {
      if (!name.endsWith('.ndjson')) continue;
      const full = join(this.dir, name);
      try {
        if (statSync(full).mtimeMs < cutoff) {
          unlinkSync(full);
        }
      } catch { /* best-effort */ }
    }
  }
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
}
