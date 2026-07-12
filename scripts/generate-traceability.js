#!/usr/bin/env node
// Session 19 (SPEC.md §8 hardening pass): generates the requirement traceability matrix from
// test names. CLAUDE.md's testing-discipline rule requires every test name to embed the
// requirement ID(s) it proves (`describe('PLT-2 audit trail', ...)`, `it('DOC-2: ...', ...)`) —
// this script is the "small script" the Session 19 brief asked for to turn that convention into
// a generated artifact rather than a manually maintained one, so it can be re-run every session.
//
// Usage: node scripts/generate-traceability.js
// Output: validation-pack/traceability/traceability-matrix.md
//         validation-pack/traceability/traceability-data.json

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPEC_PATH = path.join(ROOT, 'SPEC.md');
const OUT_DIR = path.join(ROOT, 'validation-pack', 'traceability');

const TEST_GLOBS = [
  { dir: path.join(ROOT, 'server', 'src'), exts: ['.spec.ts', '.e2e-spec.ts'] },
  { dir: path.join(ROOT, 'server', 'test'), exts: ['.e2e-spec.ts'] },
  { dir: path.join(ROOT, 'client', 'src'), exts: ['.test.ts', '.test.tsx'] },
  { dir: path.join(ROOT, 'packages', 'shared', 'src'), exts: ['.spec.ts'] },
];

const REQ_ID_RE = /\b([A-Z]{2,5}-\d+)\b/g;
// Matches describe(...)/it(...) calls whose first argument is a plain string literal (single,
// double, or backtick quoted) — the only style used across this codebase's test suites.
const TEST_CALL_RE = /\b(describe|it)\(\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;

function walk(dir, exts, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function collectTestFiles() {
  const files = [];
  for (const { dir, exts } of TEST_GLOBS) walk(dir, exts, files);
  return files;
}

// Parses SPEC.md's requirement tables. §6.1 (PLT-x) has no priority column — every core platform
// service is treated as P0 ("build FIRST — everything depends on these"). §7.x module tables
// (DOC/TRN/EQP/QRX) have an explicit `| ID | P | Requirement |` column.
function parseSpecRequirements() {
  const text = fs.readFileSync(SPEC_PATH, 'utf8');
  const lines = text.split('\n');
  const requirements = new Map();
  let inPltTable = false;
  let inModuleTable = false;

  for (const line of lines) {
    if (/^###?\s*6\.1/.test(line)) { inPltTable = true; inModuleTable = false; continue; }
    if (/^###?\s*7\./.test(line)) { inModuleTable = true; inPltTable = false; continue; }
    if (/^##\s/.test(line) && !/^###?\s*7\./.test(line) && !/^###?\s*6\.1/.test(line)) { inPltTable = false; inModuleTable = false; }

    const pltMatch = inPltTable && line.match(/^\|\s*(PLT-\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*$/);
    if (pltMatch) {
      requirements.set(pltMatch[1], { id: pltMatch[1], priority: 'P0', description: pltMatch[3].trim() });
      continue;
    }

    const modMatch = inModuleTable && line.match(/^\|\s*([A-Z]+-\d+)\s*\|\s*(P\d)\s*\|\s*([^|]+)\|\s*$/);
    if (modMatch) {
      requirements.set(modMatch[1], { id: modMatch[1], priority: modMatch[2], description: modMatch[3].trim() });
    }
  }
  return requirements;
}

function collectTestReferences(files) {
  const refs = new Map(); // reqId -> [{file, kind, name}]
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relFile = path.relative(ROOT, file).replace(/\\/g, '/');
    let match;
    TEST_CALL_RE.lastIndex = 0;
    while ((match = TEST_CALL_RE.exec(content))) {
      const [, kind, , name] = match;
      const ids = new Set();
      let idMatch;
      REQ_ID_RE.lastIndex = 0;
      while ((idMatch = REQ_ID_RE.exec(name))) ids.add(idMatch[1]);
      for (const id of ids) {
        if (!refs.has(id)) refs.set(id, []);
        refs.get(id).push({ file: relFile, kind, name });
      }
    }
  }
  return refs;
}

function priorityRank(p) {
  return { P0: 0, P1: 1, P2: 2 }[p] ?? 3;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const requirements = parseSpecRequirements();
  const files = collectTestFiles();
  const refs = collectTestReferences(files);

  const sortedIds = [...requirements.keys()].sort((a, b) => {
    const [prefixA, numA] = a.split('-');
    const [prefixB, numB] = b.split('-');
    if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
    return Number(numA) - Number(numB);
  });

  const rows = sortedIds.map((id) => {
    const req = requirements.get(id);
    const tests = refs.get(id) ?? [];
    return { ...req, testCount: tests.length, tests };
  });

  // Requirement IDs referenced by tests but absent from SPEC.md's tables (typos, or IDs from an
  // out-of-scope section) — a sanity check, not a gap in coverage.
  const unknownIds = [...refs.keys()].filter((id) => !requirements.has(id)).sort();

  const p0Gaps = rows.filter((r) => r.priority === 'P0' && r.testCount === 0);
  const builtNonP0WithTests = rows.filter((r) => r.priority !== 'P0' && r.testCount > 0);
  const builtNonP0NoTests = rows.filter((r) => r.priority !== 'P0' && r.testCount === 0);

  const lines = [];
  lines.push('# Requirement Traceability Matrix');
  lines.push('');
  lines.push('Auto-generated by `scripts/generate-traceability.js` from test `describe`/`it` names — do not hand-edit; re-run the script instead.');
  lines.push('');
  lines.push(`Generated from ${files.length} test files. ${rows.length} requirements found in SPEC.md (§6.1, §7).`);
  lines.push('');
  lines.push('## P0 coverage gaps (must be zero before v1 sign-off)');
  lines.push('');
  if (p0Gaps.length === 0) {
    lines.push('None — every P0 requirement has at least one test referencing its ID.');
  } else {
    for (const r of p0Gaps) lines.push(`- **${r.id}** — ${r.description}`);
  }
  lines.push('');
  lines.push('## Full matrix');
  lines.push('');
  lines.push('| ID | Priority | Tests | Sample test names |');
  lines.push('|---|---|---|---|');
  for (const r of rows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id))) {
    const sample = r.tests.slice(0, 2).map((t) => `\`${t.name}\` (${t.file})`).join('<br>') || '—';
    const flag = r.priority === 'P0' && r.testCount === 0 ? ' ⚠️' : '';
    lines.push(`| ${r.id}${flag} | ${r.priority} | ${r.testCount} | ${sample} |`);
  }

  if (unknownIds.length > 0) {
    lines.push('');
    lines.push('## IDs referenced in tests but not found in SPEC.md (verify — typo, or out-of-scope section)');
    lines.push('');
    for (const id of unknownIds) {
      const count = refs.get(id).length;
      lines.push(`- ${id} (${count} reference${count === 1 ? '' : 's'})`);
    }
  }

  lines.push('');
  lines.push('## P1/P2 requirements already built (have tests) vs. not yet built');
  lines.push('');
  lines.push(`- Built with test coverage: ${builtNonP0WithTests.map((r) => r.id).join(', ') || 'none'}`);
  lines.push(`- Not yet built (no tests — expected for out-of-scope/future-phase items): ${builtNonP0NoTests.map((r) => r.id).join(', ') || 'none'}`);
  lines.push('');

  fs.writeFileSync(path.join(OUT_DIR, 'traceability-matrix.md'), lines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(
    path.join(OUT_DIR, 'traceability-data.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), requirements: rows, unknownIds }, null, 2) + '\n',
    'utf8',
  );

  console.log(`Traceability matrix written to ${path.relative(ROOT, OUT_DIR)}/`);
  console.log(`P0 requirements: ${rows.filter((r) => r.priority === 'P0').length}, gaps: ${p0Gaps.length}`);
  if (p0Gaps.length > 0) {
    console.log('P0 GAPS:', p0Gaps.map((r) => r.id).join(', '));
    process.exitCode = 1;
  }
}

main();
