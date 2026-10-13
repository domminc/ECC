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
const R = require(path.join(root, 'data', 'draft.js'));

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


const fund = (id) => D.FUNDS.find(f => f.id === id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const profileOf = (o) => Object.assign({ industry: 'food_lodging', employees: 2, years: 4, need: 'working', salesDrop: 'none' }, o);

run('draft: average sales and year-over-year growth are computed from input', () => {
  const st = R.salesStats(R.EXAMPLES.semas.sales);
  assert.strictEqual(st.avg, 180000000);
  assert.strictEqual(Math.round(st.rows[1].growth * 10) / 10, 10.3);
  assert.ok(Number.isNaN(st.rows[0].growth));
});

run('draft: complete example has no missing items and no issues', () => {
  const doc = R.build(R.EXAMPLES.semas, fund('semas-general'), profileOf());
  assert.strictEqual(doc.missing, 0);
  assert.deepStrictEqual(doc.issues, []);
  const text = R.toText(doc);
  assert.ok(text.includes('180,000,000원'));
  assert.ok(text.includes('합계가 신청금액(50,000,000원)과 일치합니다'));
});

run('draft: empty input leaves placeholders instead of inventing content', () => {
  const doc = R.build({ sales: [], plan: [] }, fund('semas-general'), profileOf());
  assert.ok(doc.missing >= 8);
  assert.ok(R.toText(doc).includes('【작성 필요'));
  assert.ok(!/\d{2,3},\d{3},\d{3}원/.test(R.toText(doc)), 'no invented amounts');
});

run('draft: plan total mismatch and over-limit amounts are flagged', () => {
  const input = clone(R.EXAMPLES.semas);
  input.applyAmount = '40000000';
  let issues = R.check(input, fund('semas-general'));
  assert.ok(issues.some(i => i.msg.includes('신청금액')));
  input.applyAmount = '100000000';
  input.plan = [{ kind: '운전', use: '식자재', party: '', amount: '100000000', when: '' }];
  issues = R.check(input, fund('semas-general'));
  assert.ok(issues.some(i => i.msg.includes('한도')));
});

run('draft: facility rows on a working-capital-only fund are flagged', () => {
  const input = clone(R.EXAMPLES.semas);
  input.plan = [{ kind: '시설', use: '오븐', party: '', amount: '50000000', when: '' }];
  assert.ok(R.check(input, fund('semas-general')).some(i => i.msg.includes('운전자금 전용')));
});

run('draft: SME template for KOSMES funds includes financial table and auto sales note', () => {
  const doc = R.build(R.EXAMPLES.kosmes, fund('kosmes-innov-growth'), profileOf({ industry: 'mfg', employees: 18, years: 10 }));
  assert.strictEqual(doc.title, '사업계획서 (중소기업용)');
  assert.strictEqual(doc.missing, 0);
  const text = R.toText(doc);
  assert.ok(text.includes('재무 현황'));
  assert.ok(text.includes('2023') && text.includes('2025'));
});

run('draft: sales-drop answer from the profile adds an auto note', () => {
  const doc = R.build(R.EXAMPLES.semas, fund('semas-temp'), profileOf({ salesDrop: '15' }));
  assert.ok(R.toText(doc).includes('15% 이상 감소'));
});

const X = require(path.join(root, 'data', 'docx.js'));

/** 압축 없는 ZIP 을 읽어 {이름: Buffer} 로 돌려준다 (CRC 도 검증) */
function readStoredZip(bytes) {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'no end-of-central-directory');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.strictEqual(buf.readUInt32LE(pos), 0x02014b50);
    const crc = buf.readUInt32LE(pos + 16);
    const size = buf.readUInt32LE(pos + 20);
    const nlen = buf.readUInt16LE(pos + 28);
    const off = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26);
    const data = buf.slice(off + 30 + lnlen, off + 30 + lnlen + size);
    assert.strictEqual(X.crc32(data), crc, `crc mismatch for ${name}`);
    files[name] = data;
    pos += 46 + nlen;
  }
  return files;
}

run('docx: crc32 matches the known check value', () => {
  assert.strictEqual(X.crc32(Buffer.from('123456789')), 0xcbf43926);
});

run('docx: package has the required parts and valid CRCs', () => {
  const doc = R.build(R.EXAMPLES.semas, fund('semas-general'), profileOf());
  const files = readStoredZip(X.buildDocx(doc));
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) {
    assert.ok(files[n], `missing ${n}`);
  }
  const xml = files['word/document.xml'].toString('utf8');
  assert.ok(xml.includes('사업계획서 (소상공인용)'));
  assert.ok(xml.includes('180,000,000원'));
});

run('docx: user input is XML-escaped and control characters are dropped', () => {
  const input = clone(R.EXAMPLES.semas);
  input.company = '<w:evil/>&"x"\u0001';
  input.strengths = '첫 줄\n둘째 줄';
  const xml = readStoredZip(X.buildDocx(R.build(input, fund('semas-general'), profileOf())))['word/document.xml'].toString('utf8');
  assert.ok(!xml.includes('<w:evil/>'));
  assert.ok(xml.includes('&lt;w:evil/&gt;&amp;"x"'));
  assert.ok(!xml.includes('\u0001'));
  assert.ok(xml.includes('<w:br/>'));
});

run('docx: placeholders are highlighted so they stand out in Word', () => {
  const xml = readStoredZip(X.buildDocx(R.build({ sales: [], plan: [] }, fund('semas-general'), profileOf())))['word/document.xml'].toString('utf8');
  assert.ok(xml.includes('<w:highlight w:val="yellow"/>'));
});

run('draft: every fund with limitWon has sane numeric values', () => {
  for (const f of D.FUNDS) {
    if (!f.limitWon) continue;
    for (const v of Object.values(f.limitWon)) assert.ok(Number.isInteger(v) && v > 0, f.id);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
