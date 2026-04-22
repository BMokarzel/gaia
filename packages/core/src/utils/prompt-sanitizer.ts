/**
 * Escapes all regex metacharacters in a string before interpolating it into
 * `new RegExp(...)`. Prevents ReDoS via crafted annotation attribute names
 * in analyzed source files.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

const MAX_FIELD_LENGTH = 300;

/**
 * Sanitizes a string derived from analyzed repository data before it is
 * interpolated into an LLM prompt.
 *
 * Removes control characters and newlines that could be used to inject
 * instructions into the prompt, and truncates to a safe length.
 */
export function sanitizeForPrompt(value: string): string {
  return value
    .replace(/[\x00-\x1F\x7F]/g, ' ') // strip all control chars including \n \r \t
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim()
    .slice(0, MAX_FIELD_LENGTH);
}

/**
 * Sanitizes each element of an array for prompt interpolation.
 */
export function sanitizeArrayForPrompt(values: string[]): string[] {
  return values.map(sanitizeForPrompt);
}
