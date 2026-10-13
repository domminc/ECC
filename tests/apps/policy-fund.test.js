/**
 * Tests for apps/policy-fund data build
 *
 * Run with: node tests/apps/policy-fund.test.js
 */

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const { parseCsv, buildData, CSV_PATH, JSON_PATH, JS_PATH } = require('../../apps/policy-fund/tools/build-data');
const { buildArtifactHtml } = require('../../apps/policy-fund/tools/build-artifact');

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
    const rows = parseCsv('\uFEFFa,b\n"x,y","he said ""hi"""\n');
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

  results.push(test('meta links are https or empty with a label', () => {
    assert.ok(built.meta.applyUrls.every(a => a.agency), 'apply links name their agency');
    for (const link of [...built.meta.changeNotices, ...built.meta.applyUrls]) {
      assert.ok(link.label, 'link needs a label');
      assert.ok(link.url === '' || /^https:\/\//.test(link.url), link.label);
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
    const flagged = built.funds.filter(f => f.unconfirmed.limit || f.unconfirmed.rate || f.unconfirmed.term);
    assert.ok(flagged.length > 0);
    assert.ok(flagged.every(f => /미확인|미기재|확인 필요|추후/.test(`${f.limit}${f.rate}${f.term}`)));
    assert.ok(built.funds.every(f => f.forms.length === 0), 'no form links until confirmed');
  }));

  results.push(test('KOSMES documents are parsed into stages; SEMAS list stays unconfirmed', () => {
    for (const f of built.funds) {
      if (f.agency === '중진공') {
        assert.ok(f.documentGroups.length >= 2, `${f.id} groups`);
        for (const g of f.documentGroups) {
          assert.ok(g.stage && g.items.length > 0 && g.items.every(Boolean), `${f.id} ${g.stage}`);
        }
      } else {
        assert.strictEqual(f.documentGroups.length, 0, `${f.id} should not invent a document list`);
        assert.ok(/미확인/.test(f.documentsNote), `${f.id} note`);
      }
    }
  }));

  results.push(test('change memos and base notice are carried through', () => {
    assert.ok(built.funds.some(f => f.changeMemo));
    assert.ok(built.funds.every(f => f.baseNotice && f.formNote));
  }));

  results.push(test('committed funds.json and funds.js are in sync with the CSV', () => {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')), built);
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(JS_PATH, 'utf8'), sandbox);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.window.POLICY_FUND_DATA)), built);
  }));

  results.push(test('artifact bundle is one self-contained fragment', () => {
    const html = buildArtifactHtml();
    assert.ok(/^<title>[^<]+<\/title>/.test(html), 'starts with title');
    assert.ok(!/<(!doctype|html|head|body)[\s>]/i.test(html), 'no document wrapper');
    assert.ok(!/<script src=|href="(?!https:\/\/fonts\.(googleapis|gstatic)\.com)[^"]*\.css"/i.test(html), 'no external files');
    assert.ok(!/<link\b/i.test(html), 'no link tags');
    assert.strictEqual((html.match(/window\.POLICY_FUND_DATA =/g) || []).length, 1);
    assert.ok(/@font-face\s*{[^}]*url\("data:font\/woff2;base64,/.test(html), 'font embedded as data URI');
    assert.ok(/--font-body:\s*"Pretendard"/.test(html), 'Pretendard leads the font stack');
    assert.ok(html.includes(built.funds[0].name));
    assert.ok(html.includes('id="fund-list"'));
  }));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}\nFailed: ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
