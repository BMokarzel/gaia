import { analyzeRepository } from './dist/index.js';
import { writeFileSync } from 'node:fs';

const t = await analyzeRepository('C:/Users/User/Desktop/sample-api', {
  onProgress: msg => process.stderr.write(msg + '\n'),
});

writeFileSync('C:/Users/User/Desktop/tree/sample-api-topology.json', JSON.stringify(t, null, 2));

for (const svc of t.services) {
  process.stderr.write(`\n=== ${svc.name} (${svc.endpoints.length} endpoints, ${svc.functions.length} functions) ===\n`);
  for (const ep of svc.endpoints) {
    const count = countDeep(ep.children);
    process.stderr.write(`  ${ep.metadata.method} ${ep.metadata.path}  → ${count} children-deep\n`);
  }
}

function countDeep(nodes) {
  let n = 0;
  for (const c of nodes) { n++; n += countDeep(c.children ?? []); }
  return n;
}
