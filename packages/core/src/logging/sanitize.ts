const SENSITIVE_KEY_RE = /token|secret|password|passwd|authorization|auth|apikey|api_key|credential|private/i;
const MAX_MSG_LENGTH = 2_000;
const MAX_VALUE_LENGTH = 500;
const MAX_CONTEXT_DEPTH = 4;

/** Remove chaves sensíveis e trunca valores longos antes de escrever no log. */
export function sanitizeContext(
  ctx: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > MAX_CONTEXT_DEPTH) return { '[truncated]': 'max depth exceeded' };

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = sanitizeValue(v, depth);
  }
  return out;
}

export function sanitizeMessage(msg: string): string {
  return msg.slice(0, MAX_MSG_LENGTH);
}

function sanitizeValue(v: unknown, depth: number): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return v.slice(0, MAX_VALUE_LENGTH);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    return v.slice(0, 20).map(item => sanitizeValue(item, depth + 1));
  }
  if (typeof v === 'object') {
    return sanitizeContext(v as Record<string, unknown>, depth + 1);
  }
  return String(v).slice(0, MAX_VALUE_LENGTH);
}

const SEEN = new WeakSet<object>();

/** JSON.stringify seguro — substitui referências circulares por '[Circular]'. */
export function safeStringify(value: unknown): string {
  SEEN.add(value as object);
  try {
    return JSON.stringify(value, circularReplacer());
  } finally {
    // WeakSet não tem clear(); recria a referência local por chamada
  }
}

function circularReplacer() {
  const seen = new WeakSet<object>();
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}
