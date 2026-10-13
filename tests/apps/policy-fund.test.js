/**
 * Tests for apps/policy-fund data build
 *
 * Run with: node tests/apps/policy-fund.test.js
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const { parseCsv, buildData, CSV_PATH, JSON_PATH, JS_PATH } = require('../../apps/policy-fund/tools/build-data');

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

function runTests() {
  console.log('\n=== Testing apps/policy-fund ===\n');
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const built = buildData(csv);
  const results = [];

  results.push(test('parseCsv handles quoted commas and BOM', () => {
    const rows = parseCsv('﻿a,b\n"x,y","he said ""hi"""\n');
    assert.deepStrictEqual(rows, [['a', 'b'], ['x,y', 'he said "hi"']]);
  }));

  results.push(test('every CSV row becomes a fund with a unique id', () => {
    assert.strictEqual(built.funds.length, parseCsv(csv).length - 1);
    const ids = built.funds.map(f => f.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  }));

  results.push(test('required fields are present and URLs are https', () => {
    for (const f of built.funds) {
      for (const key of ['agency', 'group', 'name', 'conditions', 'limit', 'rate']) {
        assert.ok(f[key], `${f.id} missing ${key}`);
      }
      assert.ok(f.targets.length > 0, `${f.id} has no targets`);
      assert.ok(/^https:\/\//.test(f.noticeUrl), `${f.id} noticeUrl`);
      assert.ok(/^https:\/\//.test(f.pdfUrl), `${f.id} pdfUrl`);
    }
  }));

  results.push(test('KOSMES funds exclude small businesses unless the notice allows them', () => {
    const kosmes = built.funds.filter(f => f.agency === '중진공');
    assert.ok(kosmes.length > 0);
    for (const f of kosmes) {
      const allowed = /소상공인 포함 가능/.test(f.conditions);
      assert.strictEqual(f.targets.includes('소상공인'), allowed, f.name);
    }
    assert.ok(built.funds.filter(f => f.agency === '소진공').every(f => f.targets.join() === '소상공인'));
  }));

  results.push(test('unconfirmed values are flagged, not invented', () => {
    const flagged = built.funds.filter(f => f.unconfirmed.limit || f.unconfirmed.rate);
    assert.ok(flagged.length > 0);
    assert.ok(built.funds.every(f => f.documents.length === 0 && f.forms.length === 0));
  }));

  results.push(test('committed funds.json and funds.js are in sync with the CSV', () => {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')), built);
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(JS_PATH, 'utf8'), sandbox);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.window.POLICY_FUND_DATA)), built);
  }));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}\nFailed: ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
