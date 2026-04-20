/**
 * Escapes all regex metacharacters in a string so it can be safely
 * interpolated into `new RegExp(...)` without altering semantics or
 * enabling ReDoS via crafted input from analyzed source files.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
