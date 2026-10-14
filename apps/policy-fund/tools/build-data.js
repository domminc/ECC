#!/usr/bin/env node
/**
 * Build data/funds.json and data/funds.js.
 *
 * Inputs
 *  - data/policy_funds_2026.csv        latest notices (소진공 제2026-576호, 중진공 제2026-574호). Wins on every overlap.
 *  - data/legacy/finder-funds.js       earlier hand-curated set (소진공 제2026-448호, 중진공 제2026-464호): fund summaries,
 *                                      document checklist ids, forms, schedule, contacts. Used only where the CSV is silent.
 *
 * Usage: node apps/policy-fund/tools/build-data.js
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CSV_PATH = path.join(DATA_DIR, 'policy_funds_2026.csv');
const LEGACY_PATH = path.join(DATA_DIR, 'legacy', 'finder-funds.js');
const JSON_PATH = path.join(DATA_DIR, 'funds.json');
const JS_PATH = path.join(DATA_DIR, 'funds.js');

const UNCONFIRMED = /공고문 확인 필요|추후 공고|미확인|미기재/;
const AGENCIES = {
  소진공: { id: 'semas', short: '소진공', defaultTargets: ['소상공인'] },
  중진공: { id: 'kosmes', short: '중진공', defaultTargets: ['중소기업'] }
};

const BASIS_LATEST = '최신 공고 정리본';
const BASIS_LEGACY = '이전 공고 기준';

const META = {
  title: '2026년 정책자금 한눈에 보기',
  asOf: '2026-10-13',
  basis: '소진공 제2026-576호·중진공 제2026-574호(2026.10.1) 통합 변경공고 기준',
  finderBasis: '자격 진단·서류 체크리스트·사업계획서 초안은 소진공 제2026-448호(2026.07.10)·중진공 제2026-464호(2026.07.28) 기준으로 정리한 내용입니다.',
  disclaimer: '이 화면의 양식과 초안은 공식 서식이 아니며 개인이 정리한 신청 준비용 안내입니다. 실제 신청은 각 기관의 온라인 시스템에서 입력·제출하세요.',
  caveats: [
    '금리는 분기별로 변동하는 정책자금 기준금리에 가산금리를 더하는 구조입니다. 실제 %는 기관 공지를 확인하세요.',
    '소진공 필요 서류의 전체 목록은 공고문에 없고 소진공 신청안내자료를 따릅니다. 이 화면에는 확인된 서류와 일반적으로 요구되는 서류를 구분해 표시합니다.',
    '소진공·중진공의 공식 서식 다운로드 링크는 확인되지 않았습니다(온라인 작성·제출). 서류·양식 탭의 파일은 개인이 정리한 준비용 양식이며 공식 서식이 아닙니다.',
    '중진공 자금은 원칙적으로 소상공인이 융자제한 대상입니다(제조업·혁신성장분야 영위 등은 예외).',
    '자격 진단, 서류 체크리스트, 사업계획서 초안은 이전 정리본(제2026-448호·464호) 기준의 1차 점검이며 심사 결과를 보장하지 않습니다.'
  ],
  changeNotices: [
    {
      label: '소진공 제2026-576호 (2026.10.1, 변경 5차) 원문',
      url: 'https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1071565&parentSeq=1071565'
    },
    {
      label: '중진공 제2026-574호 (2026.10.1) 원문',
      url: 'https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1071549&parentSeq=1071549'
    }
  ],
  documentGuides: {
    소진공: { label: '정부24 소상공인 정책자금 안내', url: 'https://www.gov.kr/portal/service/serviceInfo/SD0000007429' },
    중진공: { label: '중진공 융자절차 안내', url: 'https://www.kosmes.or.kr/nsh/SH/SBI/SHSBI003M0.do' }
  },
  applyUrls: [
    { agency: '소진공', label: '소진공 온라인 신청', url: 'https://ols.semas.or.kr' },
    { agency: '중진공', label: '중진공 온라인 신청', url: 'https://www.kosmes.or.kr' }
  ]
};

/** CSV fund name -> id of the matching entry in the earlier hand-curated set. */
const LEGACY_MAP = {
  일반경영안정자금: 'semas-general',
  '긴급경영안정(재해)': 'semas-disaster',
  '긴급경영안정(일시적 경영애로)': 'semas-temp',
  '긴급경영안정(홈플러스 피해)': 'semas-homeplus',
  신용취약소상공인자금: 'semas-credit',
  대환대출: 'semas-refinance',
  '재도전특별자금(일반형)': 'semas-restart',
  '재도전특별자금(희망형)': 'semas-restart',
  '재도전특별자금(도약형)': 'semas-restart',
  장애인기업지원자금: 'semas-disabled',
  청년고용연계자금: 'semas-youth',
  소공인특화자금: 'semas-sgongin',
  '혁신성장촉진자금(혁신형)': 'semas-innov',
  '혁신성장촉진자금(일반형)': 'semas-innov',
  '민간투자연계형 매칭융자': 'semas-matching',
  상생성장지원자금: 'semas-sangsaeng',
  '창업기반지원자금(일반)': 'kosmes-startup',
  '창업기반지원자금(청년전용)': 'kosmes-youth',
  '내수기업 수출기업화': 'kosmes-export-start',
  '혁신성장지원자금(일반)': 'kosmes-innov-growth',
  사업전환자금: 'kosmes-conversion',
  '긴급경영안정자금(재해)': 'kosmes-disaster',
  '긴급경영안정자금(일시적 경영애로)': 'kosmes-temp'
};

/** The CSV splits these into one row per type; the earlier set has a single general-type limit. Amounts are the CSV limit text. */
const LIMIT_WON_BY_NAME = {
  '재도전특별자금(일반형)': { working: 70000000 },
  '재도전특별자금(희망형)': { working: 100000000 },
  '재도전특별자금(도약형)': { working: 200000000 },
  '혁신성장촉진자금(혁신형)': { working: 200000000, facility: 1000000000 },
  '혁신성장촉진자금(일반형)': { working: 100000000, facility: 500000000 }
};

const DEFAULT_DOCS = {
  semas: ['apply-form', 'consent', 'required-upload', 'biz-reg', 'tax-cert', 'sales-proof'],
  kosmes: ['kosmes-apply', 'kosmes-required', 'biz-plan-sme', 'biz-reg', 'tax-cert', 'financials', 'corp-docs']
};

const KOSMES_GROUP_ORDER = ['혁신창업사업화', '신시장진출지원', '신성장기반', '재도약지원', '긴급경영안정', '밸류체인안정화'];
const LEGACY_GROUP = {
  혁신창업사업화자금: '혁신창업사업화',
  신시장진출지원자금: '신시장진출지원',
  신성장기반자금: '신성장기반',
  재도약지원자금: '재도약지원',
  긴급경영안정자금: '긴급경영안정'
};

/** Values the two sources state differently. Shown as "확인 필요" with both readings; nothing is picked. */
const CONFLICTS_BY_NAME = {
  '창업기반지원자금(일반)': [{
    field: 'rate',
    label: '금리',
    text: '공고의 요약표와 상세 항목이 시설자금 금리를 다르게 적고 있습니다. 최신 통합본(제2026-574호)에서도 같은지 확인하지 못했습니다.',
    values: [
      { source: '요약표', value: '기준금리 −0.6%p' },
      { source: '상세 항목 (CSV 정리본과 같음)', value: '기준금리 −0.3%p' }
    ]
  }]
};

function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function agencyKey(name) {
  const key = Object.keys(AGENCIES).find(k => name.startsWith(k));
  if (!key) throw new Error(`Unknown agency: ${name}`);
  return key;
}

function parseDocumentGroups(text) {
  const groups = [];
  for (const part of text.split(' / ')) {
    const m = part.match(/^\[(.+?)\]\s*(.*)$/) || part.match(/^(해당 시):\s*(.*)$/);
    if (!m) return [];
    const items = m[2]
      .replace(/\(kosmes\.or\.kr[^)]*\)$/, '')
      .split(', ')
      .map(item => item.trim())
      .filter(Boolean);
    if (items.length === 0) return [];
    groups.push({ stage: m[1], items });
  }
  return groups;
}

function loadLegacy() {
  return require(LEGACY_PATH);
}

/** Fields only the earlier set provides. Never overrides a CSV field. */
function finderFields(legacy, name, agencyId, hasConflict) {
  if (!legacy) {
    return {
      ruleId: `generic-${agencyId}`,
      summary: '',
      methods: [],
      uses: [],
      limitWon: null,
      notes: [],
      legacyTargets: [],
      docs: DEFAULT_DOCS[agencyId].slice()
    };
  }
  return {
    ruleId: legacy.id,
    summary: legacy.summary,
    methods: legacy.methods.slice(),
    uses: legacy.uses.slice(),
    limitWon: LIMIT_WON_BY_NAME[name] || legacy.limitWon || null,
    notes: legacy.notes.filter(n => !(hasConflict && /표기가 다릅니다/.test(n))),
    legacyTargets: legacy.target.slice(),
    docs: legacy.docs.slice()
  };
}

function buildData(csvText, legacyData) {
  const L = legacyData || loadLegacy();
  const legacyById = Object.fromEntries(L.FUNDS.map(f => [f.id, f]));
  const [header, ...rows] = parseCsv(csvText);
  if (header.length !== 15) {
    throw new Error(`Expected 15 columns, got ${header.length}`);
  }
  const counters = {};
  const usedLegacy = new Set();
  const reconciliation = [];

  const funds = rows.map(cols => {
    const [agencyName, group, name, conditions, limit, rate, term, method, docs, formNote, pages, baseNotice, noticeUrl, pdfUrl, changeMemo] =
      cols.map(c => c.trim());
    const key = agencyKey(agencyName);
    const agency = AGENCIES[key];
    counters[agency.id] = (counters[agency.id] || 0) + 1;

    const targets = [...agency.defaultTargets];
    if (/소상공인 포함 가능/.test(conditions) && !targets.includes('소상공인')) {
      targets.push('소상공인');
    }

    const legacy = legacyById[LEGACY_MAP[name]] || null;
    if (legacy) usedLegacy.add(legacy.id);
    const id = `${agency.id}-${String(counters[agency.id]).padStart(2, '0')}`;
    const unconfirmed = {
      limit: UNCONFIRMED.test(limit) || limit === '-',
      rate: UNCONFIRMED.test(rate) || rate === '-',
      term: UNCONFIRMED.test(term) || term === '-'
    };

    const conflicts = (CONFLICTS_BY_NAME[name] || []).map(c => ({ ...c }));
    conflicts.forEach(c => {
      unconfirmed[c.field] = true;
      reconciliation.push({ kind: 'conflict', fundId: id, fundName: name, field: c.label, text: c.text, values: c.values });
    });

    const newScale = (changeMemo.match(/규모[^→]*→\s*([\d,]+억)/) || [])[1];
    if (legacy && legacy.scale && newScale && !legacy.scale.includes(newScale)) {
      reconciliation.push({
        kind: 'not-carried',
        fundId: id,
        fundName: name,
        field: '운용 규모',
        text: `이전 정리본의 운용 규모(${legacy.scale})는 최신 변경공고에서 조정되어(${changeMemo}) 싣지 않았습니다.`
      });
    }

    return {
      id,
      agency: agency.short,
      agencyId: agency.id,
      agencyFull: agencyName,
      group,
      name,
      targets,
      conditions,
      limit,
      rate,
      term,
      method,
      documentGroups: parseDocumentGroups(docs),
      documentsNote: docs,
      unconfirmed,
      conflicts,
      forms: [],
      formNote,
      changeMemo,
      pages,
      baseNotice,
      noticeUrl,
      pdfUrl,
      source: 'csv',
      basis: BASIS_LATEST,
      basisNote: '',
      ...finderFields(legacy, name, agency.id, conflicts.length > 0)
    };
  });

  const kosmesRef = funds.find(f => f.agencyId === 'kosmes' && f.documentGroups.length > 0);
  const legacyOnly = L.FUNDS.filter(f => !usedLegacy.has(f.id)).map(l => {
    const agencyKeyName = l.agency === 'semas' ? '소진공' : '중진공';
    const agency = AGENCIES[agencyKeyName];
    const targets = [...agency.defaultTargets];
    if (/소상공인.{0,6}포함/.test(l.target.join(' ')) && !targets.includes('소상공인')) targets.push('소상공인');
    const ref = l.agency === 'kosmes' ? kosmesRef : null;
    const src = L.SOURCES[l.src];
    reconciliation.push({
      kind: 'legacy-only',
      fundId: l.id,
      fundName: l.name,
      field: '',
      text: `최신 통합 공고 정리본에 없는 자금입니다. ${l.agency === 'semas' ? '소진공 제2026-448호(2026.07.10)' : '중진공 제2026-464호(2026.07.28)'} 기준 값을 그대로 싣고 "${BASIS_LEGACY}"으로 표시했습니다. 최신 공고와의 대조는 미확인입니다.`
    });
    return {
      id: l.id,
      agency: agency.short,
      agencyId: agency.id,
      agencyFull: l.agency === 'semas' ? '소상공인시장진흥공단' : '중소벤처기업진흥공단',
      group: LEGACY_GROUP[l.category] || l.category,
      name: l.name,
      targets,
      conditions: l.summary,
      limit: l.limit,
      rate: l.rate,
      term: l.term,
      method: l.methods.join(' · '),
      documentGroups: ref ? ref.documentGroups : [],
      documentsNote: ref ? ref.documentsNote : '',
      unconfirmed: { limit: false, rate: false, term: false },
      conflicts: [],
      forms: [],
      formNote: ref ? ref.formNote : '',
      changeMemo: '',
      pages: '',
      baseNotice: '중진공 제2025-649호 · 변경 제2026-464호(2026.07.28) 기준',
      noticeUrl: src.url,
      pdfUrl: '',
      source: 'legacy',
      basis: BASIS_LEGACY,
      basisNote: '이 자금은 최신 통합 공고 정리본(제2026-574호)에 없어 이전 공고(제2026-464호) 기준으로 싣고 있습니다. 최신 공고와의 대조는 확인하지 못했으니 신청 전에 공고 원문을 확인하세요.',
      ...finderFields(l, l.name, agency.id),
      scale: l.scale
    };
  });

  const all = funds.concat(legacyOnly);
  const kosmesOrder = id => {
    const g = all.find(f => f.id === id).group;
    const i = KOSMES_GROUP_ORDER.indexOf(g);
    return i === -1 ? KOSMES_GROUP_ORDER.length : i;
  };
  const semas = all.filter(f => f.agencyId === 'semas');
  const kosmes = all.filter(f => f.agencyId === 'kosmes')
    .map((f, i) => ({ f, i }))
    .sort((a, b) => kosmesOrder(a.f.id) - kosmesOrder(b.f.id) || a.i - b.i)
    .map(x => x.f);

  return {
    meta: META,
    funds: semas.concat(kosmes),
    agencies: L.AGENCIES,
    sources: L.SOURCES,
    docs: L.DOCS,
    forms: L.FORMS,
    schedule: L.SCHEDULE,
    contacts: L.CONTACTS,
    links: L.LINKS,
    reconciliation
  };
}

function writeOutputs() {
  const data = buildData(fs.readFileSync(CSV_PATH, 'utf8'));
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(JSON_PATH, `${json}\n`);
  fs.writeFileSync(
    JS_PATH,
    `// Generated by tools/build-data.js from policy_funds_2026.csv and legacy/finder-funds.js. Do not edit.\nwindow.POLICY_FUND_DATA = ${json};\n`
  );
  return data;
}

if (require.main === module) {
  const data = writeOutputs();
  console.log(`Wrote ${data.funds.length} funds to ${path.relative(process.cwd(), JSON_PATH)}`);
}

module.exports = { parseCsv, buildData, META, CSV_PATH, LEGACY_PATH, JSON_PATH, JS_PATH, LEGACY_MAP };
