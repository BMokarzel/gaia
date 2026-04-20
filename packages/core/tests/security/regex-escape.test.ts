import { describe, it, expect } from 'vitest';
import { escapeRegex } from '../../src/utils/regex';

describe('escapeRegex', () => {
  it('escapes all regex metacharacters', () => {
    const meta = '\\ ^ $ . * + ? ( ) [ ] { } |';
    const escaped = escapeRegex(meta);
    expect(() => new RegExp(escaped)).not.toThrow();
    expect(new RegExp(escaped).test(meta)).toBe(true);
  });

  it('plain strings are unchanged', () => {
    expect(escapeRegex('topics')).toBe('topics');
    expect(escapeRegex('value')).toBe('value');
    expect(escapeRegex('name')).toBe('name');
  });

  it('prevents ReDoS via crafted annotation attribute name', () => {
    // An attribute name designed to cause catastrophic backtracking if unescaped
    const maliciousAttr = '(a+)+';
    const safe = escapeRegex(maliciousAttr);
    const pattern = new RegExp(`${safe}\\s*=\\s*["']([^"']+)["']`);

    // Should complete instantly — no catastrophic backtracking
    const start = Date.now();
    pattern.test('(a+)+ = "topic"');
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('regex built with escaped attr matches correctly', () => {
    const attr = 'topics';
    const pattern = new RegExp(`${escapeRegex(attr)}\\s*=\\s*["']([^"']+)["']`);
    const match = 'topics = "user.created"'.match(pattern);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('user.created');
  });

  it('does not match when attr has injected regex operators', () => {
    const maliciousAttr = 'topics|value';
    const pattern = new RegExp(`${escapeRegex(maliciousAttr)}\\s*=\\s*["']([^"']+)["']`);
    // Should NOT match "value = ..." because | was escaped
    expect('value = "event"'.match(pattern)).toBeNull();
  });
});
