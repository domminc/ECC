/**
 * Tests for apps/policy-fund: data build and merge rules, eligibility rules, business-plan draft,
 * .docx writer and the single-file artifact bundle.
 *
 * Run with: node tests/apps/policy-fund.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.resolve(__dirname, '..', '..', 'apps', 'policy-fund');
const { parseCsv, buildData, CSV_PATH, JSON_PATH, JS_PATH, LEGACY_PATH, LEGACY_MAP } = require(path.join(APP, 'tools', 'build-data'));
const { buildArtifactHtml, scriptSources } = require(path.join(APP, 'tools', 'build-artifact'));
const E = require(path.join(APP, 'lib', 'eligibility'));
const R = require(path.join(APP, 'lib', 'draft'));
const X = require(path.join(APP, 'lib', 'docx'));

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

const clone = o => JSON.parse(JSON.stringify(o));
const base = {
  bizStatus: 'operating', industry: 'food_lodging', employees: 2, years: 4,
  need: 'working', ncb: 'mid', exportLevel: 'none', salesDrop: 'none', flags: {}
};
const profileOf = o => Object.assign({ industry: 'food_lodging', employees: 2, years: 4, need: 'working', salesDrop: 'none' }, o);

function runTests() {
  console.log('\n=== Testing apps/policy-fund ===\n');
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const legacy = require(LEGACY_PATH);
  const built = buildData(csv, legacy);
  const [header, ...csvRows] = parseCsv(csv);
  const col = name => header.indexOf(name);
  const csvFunds = built.funds.filter(f => f.source === 'csv');
  const legacyOnly = built.funds.filter(f => f.source === 'legacy');
  const byRule = ruleId => built.funds.find(f => f.ruleId === ruleId);
  const statusOf = (ruleId, input) => E.evaluate(byRule(ruleId), Object.assign({}, base, input)).status;
  const results = [];

  /* ---------- data build ---------- */

  results.push(test('parseCsv handles quoted commas and BOM', () => {
    const rows = parseCsv('\uFEFFa,b\n"x,y","he said ""hi"""\n');
    assert.deepStrictEqual(rows, [['a', 'b'], ['x,y', 'he said "hi"']]);
  }));

  results.push(test('every CSV row becomes a fund and all ids are unique', () => {
    assert.strictEqual(csvFunds.length, csvRows.length);
    const ids = built.funds.map(f => f.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.strictEqual(built.funds.length, csvRows.length + legacyOnly.length);
  }));

  results.push(test('required fields are present and URLs are https', () => {
    for (const f of built.funds) {
      for (const key of ['agency', 'group', 'name', 'conditions', 'limit', 'rate', 'method']) {
        assert.ok(f[key], `${f.id} missing ${key}`);
      }
      assert.ok(f.targets.length > 0, `${f.id} has no targets`);
      assert.ok(/^https:\/\//.test(f.noticeUrl), `${f.id} noticeUrl`);
      assert.ok(f.pdfUrl === '' || /^https:\/\//.test(f.pdfUrl), `${f.id} pdfUrl`);
    }
    for (const f of csvFunds) assert.ok(/^https:\/\//.test(f.pdfUrl), `${f.id} pdfUrl`);
  }));

  results.push(test('meta links are https or empty with a label', () => {
    assert.ok(built.meta.applyUrls.every(a => a.agency), 'apply links name their agency');
    for (const link of [...built.meta.changeNotices, ...built.meta.applyUrls]) {
      assert.ok(link.label, 'link needs a label');
      assert.ok(link.url === '' || /^https:\/\//.test(link.url), link.label);
    }
  }));

  results.push(test('KOSMES funds exclude small businesses unless the notice allows them', () => {
    const kosmes = csvFunds.filter(f => f.agency === '중진공');
    assert.ok(kosmes.length > 0);
    for (const f of kosmes) {
      const allowed = /소상공인 포함 가능/.test(f.conditions);
      assert.strictEqual(f.targets.includes('소상공인'), allowed, f.name);
    }
    assert.ok(built.funds.filter(f => f.agency === '소진공').every(f => f.targets.join() === '소상공인'));
  }));

  results.push(test('unconfirmed values are flagged, not invented', () => {
    const flagged = csvFunds.filter(f => (f.unconfirmed.limit || f.unconfirmed.rate || f.unconfirmed.term) && f.conflicts.length === 0);
    assert.ok(flagged.length > 0);
    assert.ok(flagged.every(f => /미확인|미기재|확인 필요|추후/.test(`${f.limit}${f.rate}${f.term}`)));
    assert.ok(built.funds.every(f => f.forms.length === 0), 'no official form links until confirmed');
  }));

  results.push(test('KOSMES documents are parsed into stages; SEMAS list stays unconfirmed', () => {
    for (const f of csvFunds) {
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

  /* ---------- merge rules ---------- */

  results.push(test('CSV wins: values of CSV funds are copied from the CSV row', () => {
    csvRows.forEach((row, i) => {
      const f = built.funds.find(x => x.id === csvFunds[i].id);
      assert.strictEqual(f.name, row[col('자금명')]);
      assert.strictEqual(f.limit, row[col('한도')], `${f.id} limit`);
      assert.strictEqual(f.rate, row[col('금리')], `${f.id} rate`);
      assert.strictEqual(f.term, row[col('대출기간(거치)')], `${f.id} term`);
      assert.strictEqual(f.conditions, row[col('지원대상·조건')], `${f.id} conditions`);
      assert.strictEqual(f.basis, '최신 공고 정리본');
    });
  }));

  results.push(test('source-only funds are KOSMES, marked as earlier-notice basis and listed in the memo', () => {
    assert.strictEqual(legacyOnly.length, 8);
    for (const f of legacyOnly) {
      assert.strictEqual(f.agency, '중진공', f.id);
      assert.strictEqual(f.basis, '이전 공고 기준', f.id);
      assert.ok(/이전 공고/.test(f.basisNote) && /미확인|확인하지 못/.test(f.basisNote), `${f.id} basisNote`);
      assert.ok(built.reconciliation.some(r => r.kind === 'legacy-only' && r.fundId === f.id), `${f.id} not in memo`);
    }
    assert.ok(csvFunds.every(f => !f.basisNote), 'CSV funds carry no earlier-notice note');
  }));

  results.push(test('every source fund is merged into a CSV fund or listed as source-only', () => {
    const legacyIds = new Set(legacy.FUNDS.map(f => f.id));
    const mapped = Object.values(LEGACY_MAP);
    assert.ok(mapped.every(id => legacyIds.has(id)), 'LEGACY_MAP names an unknown source fund');
    assert.ok(Object.keys(LEGACY_MAP).every(name => csvFunds.some(f => f.name === name)), 'LEGACY_MAP names an unknown CSV fund');
    const used = new Set([...mapped, ...legacyOnly.map(f => f.id)]);
    const leftover = legacy.FUNDS.filter(f => !used.has(f.id));
    assert.ok(leftover.every(f => csvFunds.some(c => c.ruleId === f.id)), `source funds neither merged nor listed: ${leftover.map(f => f.id)}`);
  }));

  results.push(test('the 창업기반지원자금(일반) rate conflict is shown, not silently resolved', () => {
    const f = built.funds.find(x => x.name === '창업기반지원자금(일반)');
    assert.ok(f.unconfirmed.rate, 'rate flagged');
    assert.strictEqual(f.conflicts.length, 1);
    const values = f.conflicts[0].values.map(v => v.value).join('|');
    assert.ok(/-0\.6%p|−0\.6%p/.test(values) && /-0\.3%p|−0\.3%p/.test(values), 'both values kept');
    assert.ok(built.reconciliation.some(r => r.kind === 'conflict' && r.fundId === f.id));
  }));

  results.push(test('stale scale figures from the source are not carried onto updated funds', () => {
    for (const f of csvFunds) assert.strictEqual(f.scale, undefined, f.id);
    const youth = byRule('semas-youth');
    assert.ok(built.reconciliation.some(r => r.kind === 'not-carried' && r.fundId === youth.id));
  }));

  results.push(test('rates never embed a hard-coded base rate (it changes every quarter)', () => {
    for (const f of built.funds) assert.ok(!/기준금리\s*[0-9]/.test(f.rate), `${f.id} hard-codes a base rate`);
  }));

  results.push(test('every fund resolves to an eligibility rule, document ids and form ids', () => {
    const formIds = new Set(built.forms.map(f => f.id));
    for (const f of built.funds) {
      assert.ok(E.RULES[f.ruleId], `no rule ${f.ruleId} for ${f.id}`);
      assert.ok(f.docs.length > 0, `${f.id} has no checklist documents`);
      for (const d of f.docs) assert.ok(built.docs[d], `${f.id} references unknown doc ${d}`);
    }
    for (const [id, d] of Object.entries(built.docs)) {
      assert.ok(['official', 'typical'].includes(d.status), `${id} bad status`);
      assert.ok(['A', 'B', 'C'].includes(d.group), `${id} bad group`);
      for (const fid of d.forms || []) assert.ok(formIds.has(fid), `${id} references unknown form ${fid}`);
    }
    for (const id of Object.keys(E.RULES)) {
      assert.ok(/^generic-/.test(id) || built.funds.some(f => f.ruleId === id), `rule ${id} has no fund`);
    }
  }));

  results.push(test('every form file exists on disk and the on-screen disclaimer is present', () => {
    for (const fm of built.forms) {
      for (const v of [fm.blank, fm.sample]) {
        if (!v) continue;
        assert.ok(fs.existsSync(path.join(APP, v.file)), `missing ${v.file}`);
        assert.ok(v.name && /\.(docx|xlsx)$/.test(v.file));
      }
    }
    assert.ok(/공식 서식이 아니며 개인이 정리한/.test(built.meta.disclaimer));
  }));

  results.push(test('schedule carries its confirmation date', () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(built.schedule.asOf));
    assert.ok(built.schedule.items.length > 0);
    assert.ok(built.schedule.items.every(i => i.type && i.name && i.period));
  }));

  results.push(test('committed funds.json and funds.js are in sync with the CSV and source data', () => {
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(JSON_PATH, 'utf8')), built);
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(JS_PATH, 'utf8'), sandbox);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.window.POLICY_FUND_DATA)), built);
  }));

  /* ---------- eligibility rules (ported from the source session) ---------- */

  results.push(test('small business thresholds: 5 for services, 10 for manufacturing', () => {
    assert.strictEqual(E.derive({ industry: 'service', employees: 4 }).isSmallBiz, true);
    assert.strictEqual(E.derive({ industry: 'service', employees: 5 }).isSmallBiz, false);
    assert.strictEqual(E.derive({ industry: 'mfg', employees: 9 }).isSmallBiz, true);
    assert.strictEqual(E.derive({ industry: 'mfg', employees: 10 }).isSmallBiz, false);
  }));

  results.push(test('general stability fund fits a small restaurant and is ruled out for facility-only need', () => {
    assert.strictEqual(statusOf('semas-general', {}), 'fit');
    assert.strictEqual(statusOf('semas-general', { need: 'facility' }), 'no');
  }));

  results.push(test('credit-vulnerable fund needs NCB 839 or below', () => {
    assert.strictEqual(statusOf('semas-credit', { ncb: 'mid' }), 'no');
    assert.strictEqual(statusOf('semas-credit', { ncb: 'le839' }), 'check');
  }));

  results.push(test('disaster and homeplus funds require their flag', () => {
    assert.strictEqual(statusOf('semas-disaster', {}), 'no');
    assert.strictEqual(statusOf('semas-disaster', { flags: { disaster: true } }), 'fit');
    assert.strictEqual(statusOf('semas-homeplus', {}), 'no');
  }));

  results.push(test('sales-drop funds: SEMAS needs 15%, KOSMES needs 10%', () => {
    assert.strictEqual(statusOf('semas-temp', { salesDrop: '15' }), 'fit');
    assert.strictEqual(statusOf('semas-temp', { salesDrop: 'none' }), 'check');
    const big = { industry: 'mfg', employees: 40, years: 9 };
    assert.strictEqual(statusOf('kosmes-temp', Object.assign({ salesDrop: 'none' }, big)), 'no');
    assert.notStrictEqual(statusOf('kosmes-temp', Object.assign({ salesDrop: '10' }, big)), 'no');
  }));

  results.push(test('small businesses are excluded from KOSMES funds unless an exception applies', () => {
    assert.strictEqual(statusOf('kosmes-innov-growth', { years: 10 }), 'no');
    assert.strictEqual(statusOf('kosmes-innov-growth', { years: 10, industry: 'mfg' }), 'check');
    assert.strictEqual(statusOf('kosmes-export-global', { exportLevel: 'gte100k' }), 'fit');
  }));

  results.push(test('SEMAS youth fund: young owner under 3 years, or youth employee', () => {
    assert.strictEqual(statusOf('semas-youth', { years: 5, flags: { ownerYouth: true } }), 'no');
    assert.strictEqual(statusOf('semas-youth', { years: 2, flags: { ownerYouth: true } }), 'fit');
    assert.strictEqual(statusOf('semas-youth', { years: 5, flags: { youthEmployee: true } }), 'fit');
  }));

  results.push(test('funds without a dedicated rule fall back to their agency rule', () => {
    const generic = built.funds.filter(f => /^generic-/.test(f.ruleId));
    assert.ok(generic.length > 0);
    for (const f of generic) {
      const out = E.evaluate(f, base);
      assert.ok(['fit', 'check', 'no'].includes(out.status), f.id);
      assert.ok(out.reasons.length > 0, f.id);
    }
  }));

  results.push(test('hard exclusions rule out every fund; tax arrears only asks for confirmation', () => {
    for (const f of built.funds) {
      assert.strictEqual(E.evaluate(f, Object.assign({}, base, { flags: { creditRegistered: true } })).status, 'no', f.id);
    }
    assert.strictEqual(statusOf('semas-general', { flags: { taxArrears: true } }), 'check');
  }));

  results.push(test('evaluateAll orders fit before check before no', () => {
    const out = E.evaluateAll(built.funds, base);
    const order = { fit: 0, check: 1, no: 2 };
    assert.strictEqual(out.length, built.funds.length);
    for (let i = 1; i < out.length; i++) assert.ok(order[out[i - 1].status] <= order[out[i].status]);
  }));

  /* ---------- business-plan draft (ported) ---------- */

  const general = byRule('semas-general');

  results.push(test('draft: average sales and year-over-year growth are computed from input', () => {
    const st = R.salesStats(R.EXAMPLES.semas.sales);
    assert.strictEqual(st.avg, 180000000);
    assert.strictEqual(Math.round(st.rows[1].growth * 10) / 10, 10.3);
    assert.ok(Number.isNaN(st.rows[0].growth));
  }));

  results.push(test('draft: complete example has no missing items and no issues', () => {
    const doc = R.build(R.EXAMPLES.semas, general, profileOf());
    assert.strictEqual(doc.missing, 0);
    assert.deepStrictEqual(doc.issues, []);
    const text = R.toText(doc);
    assert.ok(text.includes('180,000,000원'));
    assert.ok(text.includes('합계가 신청금액(50,000,000원)과 일치합니다'));
  }));

  results.push(test('draft: empty input leaves placeholders instead of inventing content', () => {
    const doc = R.build({ sales: [], plan: [] }, general, profileOf());
    assert.ok(doc.missing >= 8);
    assert.ok(R.toText(doc).includes('【작성 필요'));
    assert.ok(!/\d{2,3},\d{3},\d{3}원/.test(R.toText(doc)), 'no invented amounts');
  }));

  results.push(test('draft: plan total mismatch and over-limit amounts are flagged', () => {
    const input = clone(R.EXAMPLES.semas);
    input.applyAmount = '40000000';
    let issues = R.check(input, general);
    assert.ok(issues.some(i => i.msg.includes('신청금액')));
    input.applyAmount = '100000000';
    input.plan = [{ kind: '운전', use: '식자재', party: '', amount: '100000000', when: '' }];
    issues = R.check(input, general);
    assert.ok(issues.some(i => i.msg.includes('한도')));
  }));

  results.push(test('draft: facility rows on a working-capital-only fund are flagged', () => {
    const input = clone(R.EXAMPLES.semas);
    input.plan = [{ kind: '시설', use: '오븐', party: '', amount: '50000000', when: '' }];
    assert.ok(R.check(input, general).some(i => i.msg.includes('운전자금 전용')));
  }));

  results.push(test('draft: SME template for KOSMES funds includes financial table and auto sales note', () => {
    const doc = R.build(R.EXAMPLES.kosmes, byRule('kosmes-innov-growth'), profileOf({ industry: 'mfg', employees: 18, years: 10 }));
    assert.strictEqual(doc.title, '사업계획서 (중소기업용)');
    assert.strictEqual(doc.missing, 0);
    const text = R.toText(doc);
    assert.ok(text.includes('재무 현황'));
    assert.ok(text.includes('2023') && text.includes('2025'));
  }));

  results.push(test('draft: sales-drop answer from the profile adds an auto note', () => {
    const doc = R.build(R.EXAMPLES.semas, byRule('semas-temp'), profileOf({ salesDrop: '15' }));
    assert.ok(R.toText(doc).includes('15% 이상 감소'));
  }));

  results.push(test('draft: every fund limitWon holds positive whole numbers; per-type limits follow the CSV', () => {
    for (const f of built.funds) {
      if (!f.limitWon) continue;
      for (const v of Object.values(f.limitWon)) assert.ok(Number.isInteger(v) && v > 0, f.id);
    }
    const innov = built.funds.find(f => f.name === '혁신성장촉진자금(혁신형)');
    assert.deepStrictEqual(innov.limitWon, { working: 200000000, facility: 1000000000 });
  }));

  /* ---------- .docx writer (ported) ---------- */

  /** Read an uncompressed ZIP into {name: Buffer} and verify every CRC. */
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

  results.push(test('docx: crc32 matches the known check value', () => {
    assert.strictEqual(X.crc32(Buffer.from('123456789')), 0xcbf43926);
  }));

  results.push(test('docx: package has the required parts and valid CRCs', () => {
    const files = readStoredZip(X.buildDocx(R.build(R.EXAMPLES.semas, general, profileOf())));
    for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) {
      assert.ok(files[n], `missing ${n}`);
    }
    const xml = files['word/document.xml'].toString('utf8');
    assert.ok(xml.includes('사업계획서 (소상공인용)'));
    assert.ok(xml.includes('180,000,000원'));
  }));

  results.push(test('docx: user input is XML-escaped and control characters are dropped', () => {
    const input = clone(R.EXAMPLES.semas);
    input.company = '<w:evil/>&"x"\u0001';
    input.strengths = '첫 줄\n둘째 줄';
    const xml = readStoredZip(X.buildDocx(R.build(input, general, profileOf())))['word/document.xml'].toString('utf8');
    assert.ok(!xml.includes('<w:evil/>'));
    assert.ok(xml.includes('&lt;w:evil/&gt;&amp;"x"'));
    assert.ok(!xml.includes('\u0001'));
    assert.ok(xml.includes('<w:br/>'));
  }));

  results.push(test('docx: placeholders are highlighted so they stand out in Word', () => {
    const xml = readStoredZip(X.buildDocx(R.build({ sales: [], plan: [] }, general, profileOf())))['word/document.xml'].toString('utf8');
    assert.ok(xml.includes('<w:highlight w:val="yellow"/>'));
  }));

  /* ---------- single-file artifact bundle ---------- */

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

  results.push(test('artifact bundle inlines every script of index.html in order and embeds the form files', () => {
    const html = buildArtifactHtml();
    const sources = scriptSources(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'));
    assert.deepStrictEqual(sources.slice(0, 1), ['data/funds.js']);
    assert.strictEqual(sources[sources.length - 1], 'app.js');
    let at = -1;
    for (const src of sources) {
      const marker = fs.readFileSync(path.join(APP, src), 'utf8').split('\n').find(l => l.trim().length > 20).trim();
      const next = html.indexOf(marker);
      assert.ok(next > at, `${src} missing or out of order`);
      at = next;
    }
    const files = vm.runInNewContext(`(${html.match(/window\.PF_FORM_FILES = (\{[\s\S]*?\});\n<\/script>/)[1]})`);
    for (const fm of built.forms) {
      for (const v of [fm.blank, fm.sample].filter(Boolean)) {
        assert.ok(files[v.file], `${v.file} not embedded`);
        assert.strictEqual(files[v.file], fs.readFileSync(path.join(APP, v.file)).toString('base64'));
      }
    }
    assert.ok(/claude\.use\(['"]downloads['"]\)/.test(html), 'uses the downloads capability when framed');
  }));

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\nPassed: ${passed}\nFailed: ${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
