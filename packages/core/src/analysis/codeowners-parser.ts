// ============================================================
// CODEOWNERS parser (Fase 3 — Ownership)
// ------------------------------------------------------------
// Parses GitHub-style CODEOWNERS files and matches relative
// file paths against patterns. Last matching pattern wins,
// per the GitHub spec.
//
// Supported pattern syntax (subset of gitignore/CODEOWNERS):
//   - "*"   — single path segment
//   - "**"  — any number of segments (zero or more)
//   - "?"   — single character
//   - leading "/" — anchored to repo root
//   - trailing "/" — directory (matches anything inside)
//   - no leading "/" and no slash — matches at any depth
//
// Owner spec is whitespace-separated; entries may be:
//   - "@user"      — individual GitHub user
//   - "@org/team"  — team handle
//   - "name@host"  — email address
//
// Comments start with "#" and inline comments after a "#" are
// stripped (after escaping support is intentionally omitted).
// ============================================================

import { readFileSync } from 'fs';
import { existsSync } from 'fs';
import { join, normalize } from 'path';

export interface CodeOwnersRule {
  /** Original source line (for diagnostics). */
  raw: string;
  /** Glob-like pattern as written in the file. */
  pattern: string;
  /** Compiled regex matching repo-relative paths. */
  regex: RegExp;
  /** Owner specs (handles or emails) attached to the pattern. */
  owners: string[];
  /** 1-based line number in the source file. */
  line: number;
}

export interface ParsedCodeOwners {
  /** Path to the CODEOWNERS file relative to the repo root. */
  source: string;
  rules: CodeOwnersRule[];
}

/** Standard locations searched, in CODEOWNERS spec order. */
const CODEOWNERS_LOCATIONS = [
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
];

/**
 * Locate and parse a CODEOWNERS file under `repoPath`. Returns null when
 * no CODEOWNERS file is present (the orchestrator treats that as "no
 * ownership info available" rather than an error).
 */
export function loadCodeOwners(repoPath: string): ParsedCodeOwners | null {
  for (const rel of CODEOWNERS_LOCATIONS) {
    const abs = join(repoPath, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const rules = parseCodeOwnersText(text);
    return { source: rel.replace(/\\/g, '/'), rules };
  }
  return null;
}

/**
 * Parse the raw text of a CODEOWNERS file into rules. Exposed separately
 * from `loadCodeOwners` so tests can drive it without filesystem I/O.
 */
export function parseCodeOwnersText(text: string): CodeOwnersRule[] {
  const rules: CodeOwnersRule[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip comments. Note: we don't support escaping "\#" since
    // CODEOWNERS in practice does not commonly use literal "#" in patterns.
    const stripped = raw.replace(/(^|\s)#.*$/, '$1').trim();
    if (!stripped) continue;
    const tokens = stripped.split(/\s+/);
    if (tokens.length < 2) continue; // pattern with no owners → ignored
    const pattern = tokens[0];
    const owners = tokens.slice(1);
    const regex = compilePattern(pattern);
    rules.push({ raw, pattern, regex, owners, line: i + 1 });
  }
  return rules;
}

/**
 * Compile a CODEOWNERS pattern into a RegExp matching repo-relative paths
 * (forward-slash separated, no leading slash). Anchored at start and end.
 */
export function compilePattern(pattern: string): RegExp {
  let p = pattern;

  // Trailing "/" → match anything below the directory.
  let trailingSlash = false;
  if (p.endsWith('/')) {
    trailingSlash = true;
    p = p.slice(0, -1);
  }

  // Leading "/" anchors at repo root; without it, pattern matches at any depth
  // unless it already contains a "/" (gitignore-style behavior).
  let anchored = false;
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  } else if (!p.includes('/')) {
    // Bare filename / wildcard — match at any depth.
    p = '**/' + p;
    anchored = true;
  } else {
    anchored = true;
  }

  // Build regex by escaping literal chars and translating glob meta.
  // We process character-by-character to handle "**" before "*".
  let out = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      // "**" — zero or more path segments. Handle trailing or middle "**".
      const next = p[i + 2];
      if (next === '/') {
        out += '(?:.*/)?';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
    } else if (c === '*') {
      out += '[^/]*';
      i += 1;
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if (/[.+^$(){}|\\\[\]]/.test(c)) {
      out += '\\' + c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }

  if (trailingSlash) {
    // Directory: match anything inside (slash + content).
    out += '/.*';
  }

  return new RegExp('^' + (anchored ? '' : '(?:.*/)?') + out + '$');
}

/**
 * Match a repo-relative path against parsed rules. Returns the LAST matching
 * rule, mirroring CODEOWNERS precedence ("the most recently defined pattern
 * takes the most precedence").
 */
export function matchOwners(
  parsed: ParsedCodeOwners,
  relativePath: string,
): CodeOwnersRule | null {
  // Normalize separators — CODEOWNERS patterns are forward-slash based.
  const norm = normalize(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
  let last: CodeOwnersRule | null = null;
  for (const rule of parsed.rules) {
    if (rule.regex.test(norm)) last = rule;
  }
  return last;
}
