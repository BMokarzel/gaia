/**
 * Gold-standard tests for the frontend extractor (screen.extractor.ts).
 *
 * Fixture: tests/fixtures/frontend/react-shop/src/
 *   pages/CartPage.tsx          — Redux store, 4 handlers, analytics, delete
 *   pages/ProductDetailPage.tsx — useParams, quantity change, ReviewList child
 *   pages/ProductListPage.tsx   — list with search, SearchBar + ProductCard children
 *   components/ProductCard.tsx  — reusable card, two click handlers
 *   components/ReviewList.tsx   — useQuery (queryFn pattern), submit review
 *   components/SearchBar.tsx    — controlled input, submit
 *
 * Gold contract: if this test fails, either the fixture changed intentionally
 * or the extractor regressed.  Update gold-output.json via inspect-frontend.ts.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';
import Parser from 'tree-sitter';
import { extractFrontendNodes } from '../../../src/extractors/ts/frontend/screen.extractor';
import type { ScreenNode, ComponentNode, FrontendEventNode } from '../../../src/types/topology';

// ── Setup ─────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, '../../fixtures/frontend/react-shop/src');

let parser: Parser;
let allScreens: ScreenNode[];
let allComponents: ComponentNode[];
let allScreenComponentRefs: Map<string, string[]>;

function walkDir(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkDir(full));
    else if (['.tsx', '.jsx'].includes(extname(entry))) out.push(full);
  }
  return out;
}

beforeAll(() => {
  const tsModule = require('tree-sitter-typescript');
  const tsxLang = tsModule.tsx ?? tsModule;
  parser = new Parser();
  parser.setLanguage(tsxLang);

  allScreens = [];
  allComponents = [];
  allScreenComponentRefs = new Map();

  for (const absPath of walkDir(FIXTURE_DIR)) {
    const content = readFileSync(absPath, 'utf-8');
    const relPath = relative(FIXTURE_DIR, absPath).replace(/\\/g, '/');
    const tree = parser.parse(content);
    const result = extractFrontendNodes(tree.rootNode as any, relPath);
    allScreens.push(...result.screens);
    allComponents.push(...result.components);
    for (const [id, names] of result.screenComponentRefs) {
      allScreenComponentRefs.set(id, names);
    }
  }

  // Simulate orchestrator cross-file component linking
  const byName = new Map(allComponents.map(c => [c.name, c]));
  for (const screen of allScreens) {
    const refs = allScreenComponentRefs.get(screen.id) ?? [];
    const attached = new Set(screen.components.map(c => c.name));
    for (const name of refs) {
      if (!attached.has(name)) {
        const comp = byName.get(name);
        if (comp) { screen.components.push(comp); attached.add(name); }
      }
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function screen(name: string): ScreenNode {
  const s = allScreens.find(s => s.name === name);
  if (!s) throw new Error(`Screen "${name}" not found. Available: ${allScreens.map(s => s.name).join(', ')}`);
  return s;
}

function comp(name: string): ComponentNode {
  const c = allComponents.find(c => c.name === name);
  if (!c) throw new Error(`Component "${name}" not found`);
  return c;
}

function event(component: ComponentNode, handlerName: string): FrontendEventNode {
  const ev = component.events.find(e => e.name === handlerName);
  if (!ev) throw new Error(`Event "${handlerName}" not found in "${component.name}". Available: ${component.events.map(e => e.name).join(', ')}`);
  return ev;
}

function apiCalls(ev: FrontendEventNode) {
  return ev.metadata.actions.filter(a => a.kind === 'api_call') as { kind: 'api_call'; method: string; path: string }[];
}

function navigations(ev: FrontendEventNode) {
  return ev.metadata.actions.filter(a => a.kind === 'navigate') as { kind: 'navigate'; targetScreenId: string }[];
}

// ── Screen count & discovery ──────────────────────────────────────────────────

describe('Screen discovery', () => {
  it('extracts exactly 3 screens from the fixture', () => {
    expect(allScreens).toHaveLength(3);
  });

  it('extracts exactly 6 components from the fixture', () => {
    expect(allComponents).toHaveLength(6);
  });

  it('has no orphan components after linking', () => {
    const attachedIds = new Set(allScreens.flatMap(s => s.components.map(c => c.id)));
    const orphans = allComponents.filter(c => !attachedIds.has(c.id));
    expect(orphans).toHaveLength(0);
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

describe('Route inference', () => {
  it('CartPage → /cart', () => {
    expect(screen('CartPage').metadata.route).toBe('/cart');
  });

  it('ProductDetailPage → /productdetail', () => {
    expect(screen('ProductDetailPage').metadata.route).toBe('/productdetail');
  });

  it('ProductListPage → /productlist', () => {
    expect(screen('ProductListPage').metadata.route).toBe('/productlist');
  });

  it('all routes are lowercase', () => {
    for (const s of allScreens) {
      expect(s.metadata.route).toBe(s.metadata.route!.toLowerCase());
    }
  });
});

// ── Framework detection ───────────────────────────────────────────────────────

describe('Framework detection', () => {
  it('all screens detect React (TSX)', () => {
    for (const s of allScreens) {
      expect(s.metadata.framework).toBe('react');
    }
  });
});

// ── CartPage ──────────────────────────────────────────────────────────────────

describe('CartPage', () => {
  it('has 1 direct component (self)', () => {
    // After linking SearchBar and ProductCard go to ProductListPage; ReviewList to ProductDetail
    expect(screen('CartPage').components).toHaveLength(1);
  });

  it('navigates to /orders/:param/confirmation and /products', () => {
    const nav = screen('CartPage').navigatesTo;
    expect(nav).toContain('/orders/:param/confirmation');
    expect(nav).toContain('/products');
  });

  it('detects Redux store', () => {
    expect(comp('CartPage').metadata.state.store).toBe('redux');
  });

  it('extracts state: coupon (string) and discount (number)', () => {
    const local = comp('CartPage').metadata.state.local;
    expect(local.find(f => f.name === 'coupon')?.type).toBe('string');
    expect(local.find(f => f.name === 'discount')?.type).toBe('number');
  });

  it('handleApplyCoupon: trigger=click, POST /api/coupons/validate', () => {
    const ev = event(comp('CartPage'), 'handleApplyCoupon');
    expect(ev.metadata.trigger).toBe('click');
    const calls = apiCalls(ev);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/coupons/validate');
  });

  it('handleRemoveItem: trigger=click, DELETE with :param in path', () => {
    const ev = event(comp('CartPage'), 'handleRemoveItem');
    expect(ev.metadata.trigger).toBe('click');
    const calls = apiCalls(ev);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].path).toBe('/api/cart/items/:param');
  });

  it('handleCheckout: analytics + POST /api/orders + navigation', () => {
    const ev = event(comp('CartPage'), 'handleCheckout');
    expect(ev.metadata.trigger).toBe('click');

    const analytics = ev.metadata.actions.filter(a => a.kind === 'analytics');
    expect(analytics).toHaveLength(1);
    expect((analytics[0] as any).eventName).toBe('checkout_started');

    const calls = apiCalls(ev);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/orders');

    const nav = navigations(ev);
    expect(nav[0].targetScreenId).toBe('/orders/:param/confirmation');
  });

  it('handleContinueShopping: trigger=click, navigate /products', () => {
    const ev = event(comp('CartPage'), 'handleContinueShopping');
    expect(ev.metadata.trigger).toBe('click');
    expect(navigations(ev)[0].targetScreenId).toBe('/products');
  });
});

// ── ProductDetailPage ─────────────────────────────────────────────────────────

describe('ProductDetailPage', () => {
  it('has 2 components: self + ReviewList (cross-file linking)', () => {
    const names = screen('ProductDetailPage').components.map(c => c.name);
    expect(names).toContain('ProductDetailPage');
    expect(names).toContain('ReviewList');
    expect(names).toHaveLength(2);
  });

  it('navigates to /cart and /products', () => {
    const nav = screen('ProductDetailPage').navigatesTo;
    expect(nav).toContain('/cart');
    expect(nav).toContain('/products');
  });

  it('extracts state: product and quantity', () => {
    const local = comp('ProductDetailPage').metadata.state.local;
    expect(local.find(f => f.name === 'product')).toBeDefined();
    expect(local.find(f => f.name === 'quantity')?.type).toBe('number');
  });

  it('handleAddToCart: trigger=click, POST /api/cart/items then navigate /cart', () => {
    const ev = event(comp('ProductDetailPage'), 'handleAddToCart');
    expect(ev.metadata.trigger).toBe('click');
    expect(apiCalls(ev)[0].path).toBe('/api/cart/items');
    expect(navigations(ev)[0].targetScreenId).toBe('/cart');
  });

  it('handleGoBack: trigger=click, navigate /products', () => {
    const ev = event(comp('ProductDetailPage'), 'handleGoBack');
    expect(ev.metadata.trigger).toBe('click');
    expect(navigations(ev)[0].targetScreenId).toBe('/products');
  });

  it('handleQuantityChange: trigger=change, state update only', () => {
    const ev = event(comp('ProductDetailPage'), 'handleQuantityChange');
    expect(ev.metadata.trigger).toBe('change');
    expect(apiCalls(ev)).toHaveLength(0);
    expect(ev.metadata.actions.some(a => a.kind === 'state_update')).toBe(true);
  });
});

// ── ReviewList ────────────────────────────────────────────────────────────────

describe('ReviewList (child component with useQuery)', () => {
  it('is attached to ProductDetailPage screen', () => {
    const names = screen('ProductDetailPage').components.map(c => c.name);
    expect(names).toContain('ReviewList');
  });

  it('detects useQuery hook', () => {
    expect(comp('ReviewList').metadata.hooks).toContain('useQuery');
  });

  it('extracts query: GET /api/products/:param/reviews from queryFn', () => {
    const queries = comp('ReviewList').metadata.queries ?? [];
    expect(queries).toHaveLength(1);
    expect(queries[0].hookOrMethod).toBe('useQuery');
    expect(queries[0].method).toBe('GET');
    expect(queries[0].path).toBe('/api/products/:param/reviews');
  });

  it('handleSubmitReview: trigger=click, POST /api/products/:param/reviews', () => {
    const ev = event(comp('ReviewList'), 'handleSubmitReview');
    expect(ev.metadata.trigger).toBe('click');
    const calls = apiCalls(ev);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/api/products/:param/reviews');
  });

  it('handleRatingChange: trigger=change, state update only', () => {
    const ev = event(comp('ReviewList'), 'handleRatingChange');
    expect(ev.metadata.trigger).toBe('change');
    expect(apiCalls(ev)).toHaveLength(0);
  });

  it('extracts local state: newReview (string) and rating (number)', () => {
    const local = comp('ReviewList').metadata.state.local;
    expect(local.find(f => f.name === 'newReview')?.type).toBe('string');
    expect(local.find(f => f.name === 'rating')?.type).toBe('number');
  });
});

// ── ProductListPage ───────────────────────────────────────────────────────────

describe('ProductListPage', () => {
  it('has 3 components: self + SearchBar + ProductCard', () => {
    const names = screen('ProductListPage').components.map(c => c.name);
    expect(names).toContain('ProductListPage');
    expect(names).toContain('SearchBar');
    expect(names).toContain('ProductCard');
    expect(names).toHaveLength(3);
  });

  it('extracts state: products, search, loading', () => {
    const local = comp('ProductListPage').metadata.state.local;
    expect(local.find(f => f.name === 'products')).toBeDefined();
    expect(local.find(f => f.name === 'search')?.type).toBe('string');
    expect(local.find(f => f.name === 'loading')?.type).toBe('boolean');
  });

  it('handleSearch: custom trigger (onSearch is a custom prop), GET with :param', () => {
    const ev = event(comp('ProductListPage'), 'handleSearch');
    // onSearch={handleSearch} is a custom component prop, not a HTML event → custom
    expect(ev.metadata.trigger).toBe('custom');
    const calls = apiCalls(ev);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/api/products?search=:param');
  });

  it('handleProductClick: trigger=click, navigate with :param', () => {
    const ev = event(comp('ProductListPage'), 'handleProductClick');
    expect(ev.metadata.trigger).toBe('click');
    expect(navigations(ev)[0].targetScreenId).toBe('/products/:param');
  });

  it('handleAddToCart: custom trigger (onAddToCart prop), POST /api/cart/items', () => {
    const ev = event(comp('ProductListPage'), 'handleAddToCart');
    expect(ev.metadata.trigger).toBe('custom');
    expect(apiCalls(ev)[0].path).toBe('/api/cart/items');
  });
});

// ── ProductCard ───────────────────────────────────────────────────────────────

describe('ProductCard', () => {
  it('is attached to ProductListPage screen', () => {
    const names = screen('ProductListPage').components.map(c => c.name);
    expect(names).toContain('ProductCard');
  });

  it('kind is widget', () => {
    expect(comp('ProductCard').metadata.kind).toBe('widget');
  });

  it('handleClick: trigger=click', () => {
    expect(event(comp('ProductCard'), 'handleClick').metadata.trigger).toBe('click');
  });

  it('handleAddToCart: trigger=click', () => {
    expect(event(comp('ProductCard'), 'handleAddToCart').metadata.trigger).toBe('click');
  });
});

// ── SearchBar ─────────────────────────────────────────────────────────────────

describe('SearchBar', () => {
  it('is attached to ProductListPage screen', () => {
    const names = screen('ProductListPage').components.map(c => c.name);
    expect(names).toContain('SearchBar');
  });

  it('detects useState hook', () => {
    expect(comp('SearchBar').metadata.hooks).toContain('useState');
  });

  it('extracts state: query (string)', () => {
    const local = comp('SearchBar').metadata.state.local;
    expect(local.find(f => f.name === 'query')?.type).toBe('string');
  });

  it('handleChange: trigger=change', () => {
    expect(event(comp('SearchBar'), 'handleChange').metadata.trigger).toBe('change');
  });

  it('handleSubmit: trigger=click', () => {
    expect(event(comp('SearchBar'), 'handleSubmit').metadata.trigger).toBe('click');
  });
});

// ── Template literal normalization ────────────────────────────────────────────

describe('Template literal normalization (Fix 4)', () => {
  it('normalizes ${...} to :param in API paths', () => {
    const ev = event(comp('CartPage'), 'handleRemoveItem');
    expect(apiCalls(ev)[0].path).toBe('/api/cart/items/:param');
  });

  it('normalizes ${...} to :param in navigation targets', () => {
    const ev = event(comp('CartPage'), 'handleCheckout');
    expect(navigations(ev)[0].targetScreenId).toBe('/orders/:param/confirmation');
  });

  it('normalizes ${...} to :param in screen navigatesTo', () => {
    expect(screen('CartPage').navigatesTo).toContain('/orders/:param/confirmation');
  });
});

// ── Cross-file component linking ──────────────────────────────────────────────

describe('Cross-file component linking (Fix 5)', () => {
  it('ReviewList (components/) linked to ProductDetailPage screen', () => {
    const comps = screen('ProductDetailPage').components.map(c => c.name);
    expect(comps).toContain('ReviewList');
  });

  it('SearchBar (components/) linked to ProductListPage screen', () => {
    const comps = screen('ProductListPage').components.map(c => c.name);
    expect(comps).toContain('SearchBar');
  });

  it('ProductCard (components/) linked to ProductListPage screen', () => {
    const comps = screen('ProductListPage').components.map(c => c.name);
    expect(comps).toContain('ProductCard');
  });

  it('no component appears in the wrong screen', () => {
    const cartComps = screen('CartPage').components.map(c => c.name);
    expect(cartComps).not.toContain('ReviewList');
    expect(cartComps).not.toContain('SearchBar');
    expect(cartComps).not.toContain('ProductCard');
  });
});
