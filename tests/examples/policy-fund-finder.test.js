/**
 * Tests for examples/policy-fund-finder data integrity and eligibility rules.
 *
 * Run with: node tests/examples/policy-fund-finder.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..', 'examples', 'policy-fund-finder');
const D = require(path.join(root, 'data', 'funds.js'));
const E = require(path.join(root, 'data', 'eligibility.js'));

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

const base = {
  bizStatus: 'operating', industry: 'food_lodging', employees: 2, years: 4,
  need: 'working', ncb: 'mid', exportLevel: 'none', salesDrop: 'none', flags: {},
};
const statusOf = (id, input) => E.evaluate(D.FUNDS.find(f => f.id === id), Object.assign({}, base, input)).status;

console.log('\n=== Testing policy-fund-finder ===\n');

let passed = 0;
let failed = 0;
function run(name, fn) { if (test(name, fn)) passed++; else failed++; }

run('fund ids are unique and every fund has the required fields', () => {
  const ids = new Set();
  for (const f of D.FUNDS) {
    assert.ok(!ids.has(f.id), `duplicate id ${f.id}`);
    ids.add(f.id);
    for (const k of ['name', 'summary', 'limit', 'rate', 'term', 'scale', 'src']) {
      assert.ok(f[k], `${f.id} missing ${k}`);
    }
    assert.ok(D.AGENCIES[f.agency], `${f.id} has unknown agency`);
    assert.ok(D.SOURCES[f.src], `${f.id} has unknown source`);
    assert.ok(f.target.length > 0 && f.methods.length > 0 && f.docs.length > 0, `${f.id} has empty lists`);
  }
});

run('every fund has an eligibility rule and every rule has a fund', () => {
  for (const f of D.FUNDS) assert.ok(E.RULES[f.id], `no rule for ${f.id}`);
  for (const id of Object.keys(E.RULES)) assert.ok(D.FUNDS.some(f => f.id === id), `rule ${id} has no fund`);
});

run('fund doc references resolve and doc form references resolve', () => {
  const formIds = new Set(D.FORMS.map(f => f.id));
  for (const f of D.FUNDS) for (const d of f.docs) assert.ok(D.DOCS[d], `${f.id} references unknown doc ${d}`);
  for (const [id, d] of Object.entries(D.DOCS)) {
    assert.ok(['official', 'typical'].includes(d.status), `${id} bad status`);
    assert.ok(['A', 'B', 'C'].includes(d.group), `${id} bad group`);
    for (const fid of d.forms || []) assert.ok(formIds.has(fid), `${id} references unknown form ${fid}`);
  }
});

run('every downloadable form file exists on disk', () => {
  for (const fm of D.FORMS) {
    for (const v of [fm.blank, fm.sample]) {
      if (!v) continue;
      assert.ok(fs.existsSync(path.join(root, v.file)), `missing ${v.file}`);
    }
  }
});

run('rates never embed a hard-coded base rate (it changes every quarter)', () => {
  for (const f of D.FUNDS) {
    assert.ok(!/기준금리\s*[0-9]/.test(f.rate), `${f.id} hard-codes a base rate`);
  }
});

run('small business thresholds: 5 for services, 10 for manufacturing', () => {
  assert.strictEqual(E.derive({ industry: 'service', employees: 4 }).isSmallBiz, true);
  assert.strictEqual(E.derive({ industry: 'service', employees: 5 }).isSmallBiz, false);
  assert.strictEqual(E.derive({ industry: 'mfg', employees: 9 }).isSmallBiz, true);
  assert.strictEqual(E.derive({ industry: 'mfg', employees: 10 }).isSmallBiz, false);
});

run('general stability fund fits a small restaurant and is ruled out for facility-only need', () => {
  assert.strictEqual(statusOf('semas-general', {}), 'fit');
  assert.strictEqual(statusOf('semas-general', { need: 'facility' }), 'no');
});

run('credit-vulnerable fund needs NCB 839 or below', () => {
  assert.strictEqual(statusOf('semas-credit', { ncb: 'mid' }), 'no');
  assert.strictEqual(statusOf('semas-credit', { ncb: 'le839' }), 'check');
});

run('disaster and homeplus funds require their flag', () => {
  assert.strictEqual(statusOf('semas-disaster', {}), 'no');
  assert.strictEqual(statusOf('semas-disaster', { flags: { disaster: true } }), 'fit');
  assert.strictEqual(statusOf('semas-homeplus', {}), 'no');
});

run('sales-drop funds: SEMAS needs 15%, KOSMES needs 10%', () => {
  assert.strictEqual(statusOf('semas-temp', { salesDrop: '15' }), 'fit');
  assert.strictEqual(statusOf('semas-temp', { salesDrop: 'none' }), 'check');
  const big = { industry: 'mfg', employees: 40, years: 9 };
  assert.strictEqual(statusOf('kosmes-temp', Object.assign({ salesDrop: 'none' }, big)), 'no');
  assert.notStrictEqual(statusOf('kosmes-temp', Object.assign({ salesDrop: '10' }, big)), 'no');
});

run('small businesses are excluded from KOSMES funds unless an exception applies', () => {
  assert.strictEqual(statusOf('kosmes-innov-growth', { years: 10 }), 'no');
  assert.strictEqual(statusOf('kosmes-innov-growth', { years: 10, industry: 'mfg' }), 'check');
  assert.strictEqual(statusOf('kosmes-export-global', { exportLevel: 'gte100k' }), 'fit');
});

run('SEMAS youth fund: young owner under 3 years, or youth employee', () => {
  assert.strictEqual(statusOf('semas-youth', { years: 5, flags: { ownerYouth: true } }), 'no');
  assert.strictEqual(statusOf('semas-youth', { years: 2, flags: { ownerYouth: true } }), 'fit');
  assert.strictEqual(statusOf('semas-youth', { years: 5, flags: { youthEmployee: true } }), 'fit');
});

run('hard exclusions rule out every fund; tax arrears only asks for confirmation', () => {
  for (const f of D.FUNDS) {
    assert.strictEqual(E.evaluate(f, Object.assign({}, base, { flags: { creditRegistered: true } })).status, 'no', f.id);
  }
  assert.strictEqual(statusOf('semas-general', { flags: { taxArrears: true } }), 'check');
});

run('evaluateAll orders fit before check before no', () => {
  const out = E.evaluateAll(D.FUNDS, base);
  const order = { fit: 0, check: 1, no: 2 };
  for (let i = 1; i < out.length; i++) assert.ok(order[out[i - 1].status] <= order[out[i].status]);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
