/**
 * 사업계획서 초안 생성.
 * 입력값에서 계산할 수 있는 사실(평균 매출, 전년 대비 증감, 자금집행 합계, 한도 비교)만 문장으로 만든다.
 * 비어 있는 항목은 지어내지 않고 "【작성 필요: …】"로 표시한다.
 * 항목 구성은 소진공 직접대출 서류제출(영업현황·경력·자금집행계획)과 중진공 기업평가 항목을 따른다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PF_DRAFT = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const INDUSTRY_LABEL = {
    mfg: '제조업', construction: '건설업', transport: '운수업', mining: '광업',
    wholesale_retail: '도·소매업', food_lodging: '음식·숙박업', service: '서비스업', other: '기타',
  };
  const SALES_DROP_LABEL = { none: '', 10: '10% 이상', 15: '15% 이상' };

  const need = (label) => `【작성 필요: ${label}】`;
  const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

  function num(v) {
    if (isBlank(v)) return NaN;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  const won = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString('ko-KR')}원` : '');
  const pct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

  function lines(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  function splitCols(line, n) {
    const cols = line.split('|').map((c) => c.trim());
    while (cols.length < n) cols.push('');
    return cols.slice(0, n);
  }

  /** 연도별 매출 행 → 평균·전년 대비 */
  function salesStats(rows) {
    const valid = (rows || []).map((r) => ({ year: String(r.year || '').trim(), amount: num(r.amount), profit: num(r.profit), debt: num(r.debt) }))
      .filter((r) => r.year && Number.isFinite(r.amount));
    const avg = valid.length ? valid.reduce((s, r) => s + r.amount, 0) / valid.length : NaN;
    const rowsOut = valid.map((r, i) => ({
      year: r.year, amount: r.amount, profit: r.profit, debt: r.debt,
      growth: i > 0 && valid[i - 1].amount > 0 ? ((r.amount - valid[i - 1].amount) / valid[i - 1].amount) * 100 : NaN,
    }));
    return { rows: rowsOut, avg, count: valid.length };
  }

  /** 자금집행계획 합계 */
  function planTotals(plan) {
    const rows = (plan || []).map((r) => ({
      kind: r.kind === '시설' ? '시설' : '운전', use: String(r.use || '').trim(), party: String(r.party || '').trim(),
      amount: num(r.amount), when: String(r.when || '').trim(),
    })).filter((r) => r.use || Number.isFinite(r.amount));
    const sum = (k) => rows.filter((r) => !k || r.kind === k).reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
    return { rows, total: sum(), working: sum('운전'), facility: sum('시설') };
  }

  /** 점검 항목: 사용자가 제출 전에 고쳐야 할 것 */
  function check(input, fund) {
    const issues = [];
    const t = planTotals(input.plan);
    const apply = num(input.applyAmount);
    if (!Number.isFinite(apply)) issues.push({ level: 'warn', msg: '신청 금액을 입력하세요.' });
    else if (t.rows.length && t.total !== apply) {
      issues.push({ level: 'warn', msg: `자금집행계획 합계(${won(t.total)})가 신청금액(${won(apply)})과 다릅니다. 합계를 신청금액과 맞춰야 합니다.` });
    }
    const lim = fund && fund.limitWon;
    if (lim) {
      if (lim.working && t.working > lim.working) {
        issues.push({ level: 'warn', msg: `운전자금 ${won(t.working)}이 공고 기준 한도(연간 ${won(lim.working)})를 넘습니다. 유형·우대에 따라 한도가 다를 수 있으니 공고를 확인하세요.` });
      }
      if (lim.facility && t.facility > lim.facility) {
        issues.push({ level: 'warn', msg: `시설자금 ${won(t.facility)}이 공고 기준 한도(연간 ${won(lim.facility)})를 넘습니다.` });
      }
      if (!lim.facility && t.facility > 0) {
        issues.push({ level: 'warn', msg: `${fund.name}은(는) 운전자금 전용인데 시설 항목이 있습니다.` });
      }
    }
    return issues;
  }

  const P = (text, label) => ({ type: 'p', text: isBlank(text) ? need(label) : String(text).trim(), missing: isBlank(text) });
  const KV = (rows) => ({ type: 'kv', rows: rows.map(([k, v, label]) => [k, isBlank(v) ? need(label || k) : v, isBlank(v)]) });
  const TABLE = (header, rows, emptyLabel) => (rows.length
    ? { type: 'table', header, rows }
    : { type: 'p', text: need(emptyLabel), missing: true });

  function overview(input, fund, profile, stats, extra) {
    const industryName = input.industryName || INDUSTRY_LABEL[profile.industry] || '';
    const rows = [
      ['상호', input.company],
      ['대표자', input.ceo],
      ['개업일자', input.openDate],
      ['업종', industryName],
      ['업력', Number.isFinite(Number(profile.years)) && String(profile.years) !== '' ? `${profile.years}년` : '', '업력'],
      ['사업장 주소', input.address],
      ['상시근로자 수', Number.isFinite(Number(profile.employees)) ? `${profile.employees}명` : '', '상시근로자 수'],
      ['최근 3개년 평균 연매출액', Number.isFinite(stats.avg) ? won(stats.avg) : '', '연도별 매출'],
      ['주요 사업내용', input.mainBiz],
      ['신청 자금', fund.name],
      ['신청 금액', Number.isFinite(num(input.applyAmount)) ? won(num(input.applyAmount)) : '', '신청 금액'],
    ].concat(extra || []);
    return KV(rows);
  }

  function salesTable(stats) {
    return TABLE(['연도', '연 매출액(원)', '전년 대비'], stats.rows.map((r) => [
      r.year, r.amount.toLocaleString('ko-KR'), Number.isFinite(r.growth) ? pct(r.growth) : '-',
    ]), '연도별 매출(연도와 금액)');
  }

  function salesSummary(stats) {
    if (stats.count < 2) return '';
    const first = stats.rows[0];
    const last = stats.rows[stats.rows.length - 1];
    const total = first.amount > 0 ? ((last.amount - first.amount) / first.amount) * 100 : NaN;
    const dir = last.amount >= first.amount ? '증가' : '감소';
    return `${first.year}년 ${won(first.amount)}에서 ${last.year}년 ${won(last.amount)}으로 ${Number.isFinite(total) ? Math.abs(total).toFixed(1) + '% ' : ''}${dir}했고, ${stats.count}개년 평균은 ${won(stats.avg)}입니다.`;
  }

  function planTable(input) {
    const t = planTotals(input.plan);
    const rows = t.rows.map((r) => [r.kind, r.use, r.party, Number.isFinite(r.amount) ? r.amount.toLocaleString('ko-KR') : '', r.when]);
    if (rows.length) rows.push(['', '합계', '', t.total.toLocaleString('ko-KR'), '']);
    const block = TABLE(['구분', '세부 용도', '거래처·내용', '금액(원)', '집행 시기'], rows, '자금집행계획(용도와 금액)');
    const apply = num(input.applyAmount);
    const note = Number.isFinite(apply) && t.rows.length
      ? (t.total === apply ? `합계가 신청금액(${won(apply)})과 일치합니다.` : `합계(${won(t.total)})가 신청금액(${won(apply)})과 다릅니다.`)
      : '';
    return { block, note, totals: t };
  }

  function smallBiz(input, fund, profile) {
    const stats = salesStats(input.sales);
    const productRows = lines(input.products).map((l) => splitCols(l, 4));
    const careerRows = lines(input.careers).map((l) => splitCols(l, 3));
    const plan = planTable(input);

    const changes = !isBlank(input.changes) ? input.changes : '';
    const dropNote = SALES_DROP_LABEL[profile.salesDrop]
      ? `직전 대비 매출이 ${SALES_DROP_LABEL[profile.salesDrop]} 감소했습니다(입력 기준). 감소 원인과 회복 계획을 구체적으로 적으세요.` : '';

    const repayAuto = Number.isFinite(stats.avg) ? `3개년 평균 연매출 기준 월 평균 매출은 약 ${won(stats.avg / 12)}입니다. ` : '';

    return [
      { title: '1. 업체 개요', blocks: [overview(input, fund, profile, stats)] },
      {
        title: '2. 영업현황',
        blocks: [
          { type: 'h', text: '2-1. 주요 상품·서비스와 판매 방식' },
          TABLE(['상품·서비스', '판매 방식', '매출 비중', '대표 가격'], productRows, '상품·서비스(한 줄에 "상품 | 판매 방식 | 비중 | 가격")'),
          { type: 'h', text: '2-2. 주요 고객과 거래처' },
          P(input.customers, '주 고객층, 거래처, 결제 조건'),
          { type: 'h', text: '2-3. 최근 매출 추이' },
          salesTable(stats),
          salesSummary(stats) ? { type: 'p', text: salesSummary(stats), auto: true } : null,
          { type: 'h', text: '2-4. 경쟁 환경과 강점' },
          P(input.strengths, '경쟁 환경과 우리 가게의 강점'),
          { type: 'h', text: '2-5. 최근 매출 변동과 원인' },
          dropNote ? { type: 'p', text: dropNote, auto: true } : null,
          P(changes, '매출 변동 원인과 전망'),
        ].filter(Boolean),
      },
      { title: '3. 경력', blocks: [TABLE(['기간', '근무처·사업', '담당 업무'], careerRows, '대표자 경력(한 줄에 "기간 | 근무처 | 업무")')] },
      {
        title: '4. 자금집행계획',
        blocks: [plan.block, plan.note ? { type: 'p', text: plan.note, auto: true } : null].filter(Boolean),
      },
      { title: '5. 상환 계획', blocks: [{ type: 'p', text: repayAuto, auto: true, hide: !repayAuto }, P(input.repay, '상환 재원과 월 상환 가능 금액')].filter((b) => !b.hide) },
      {
        title: '6. 유의사항 확인',
        blocks: [KV([
          ['확인 문구', '대출금을 사업과 무관한 용도로 사용할 경우 자금 조기회수 등 불이익을 받을 수 있음을 확인합니다.'],
          ['작성일 / 대표자', `${new Date().toISOString().slice(0, 10)} / ${input.ceo ? input.ceo + ' (인)' : ''}`, '대표자'],
        ])],
      },
    ];
  }

  function sme(input, fund, profile) {
    const stats = salesStats(input.sales);
    const careerRows = lines(input.careers).map((l) => splitCols(l, 3));
    const plan = planTable(input);
    const fin = stats.rows.map((r) => [r.year, r.amount.toLocaleString('ko-KR'), Number.isFinite(r.profit) ? r.profit.toLocaleString('ko-KR') : '', Number.isFinite(r.debt) ? `${r.debt}%` : '']);
    const dropNote = SALES_DROP_LABEL[profile.salesDrop]
      ? `직전 대비 매출 또는 영업이익이 ${SALES_DROP_LABEL[profile.salesDrop]} 감소했습니다(입력 기준). 경영애로 사유와 정상화 계획을 함께 적으세요.` : '';
    return [
      {
        title: '1. 기업 개요',
        blocks: [overview(input, fund, profile, stats, [
          ['자금 용도', profile.need === 'facility' ? '시설자금' : profile.need === 'both' ? '시설·운전자금' : '운전자금'],
        ])],
      },
      { title: '2. 대표자 및 경영진 (경영능력)', blocks: [TABLE(['기간', '근무처·직책', '담당 업무'], careerRows, '대표자·경영진 경력(한 줄에 "기간 | 근무처 | 업무")')] },
      { title: '3. 사업 내용과 기술 (기술성)', blocks: [P(input.tech, '주요 제품·서비스, 보유 기술(특허·인증·R&D), 경쟁력')] },
      {
        title: '4. 시장과 영업 (사업성)',
        blocks: [P(input.market, '시장 규모, 주요 고객·거래 비중, 수주 현황'), salesTable(stats),
          salesSummary(stats) ? { type: 'p', text: salesSummary(stats), auto: true } : null,
          dropNote ? { type: 'p', text: dropNote, auto: true } : null].filter(Boolean),
      },
      {
        title: '5. 투자 계획과 자금 소요 (계획의 타당성)',
        blocks: [plan.block, plan.note ? { type: 'p', text: plan.note, auto: true } : null].filter(Boolean),
      },
      { title: '6. 고용 · 수출 계획 (미래성장성)', blocks: [P(input.hiring, '최근 1년 고용 증가 인원, 향후 채용·수출 계획')] },
      { title: '7. 재무 현황', blocks: [TABLE(['연도', '매출액(원)', '영업이익(원)', '부채비율'], fin, '연도별 매출·영업이익·부채비율')] },
      { title: '8. 상환 계획과 위험 요인', blocks: [P(input.repay, '상환 재원, 위험 요인과 대응')] },
    ];
  }

  function build(input, fund, profile) {
    const p = profile || {};
    const sections = fund.agencyId === 'semas' ? smallBiz(input, fund, p) : sme(input, fund, p);
    let missing = 0;
    sections.forEach((s) => s.blocks.forEach((b) => {
      if (b.missing) missing += 1;
      if (b.type === 'kv') b.rows.forEach((r) => { if (r[2]) missing += 1; });
    }));
    return {
      title: fund.agencyId === 'semas' ? '사업계획서 (소상공인용)' : '사업계획서 (중소기업용)',
      subtitle: `${fund.name} · ${input.company || need('상호')}`,
      sections, missing, issues: check(input, fund),
    };
  }

  /* ---------- 직렬화 ---------- */
  function blockText(b) {
    if (b.type === 'h') return `[${b.text}]`;
    if (b.type === 'p') return b.text;
    if (b.type === 'kv') return b.rows.map((r) => `${r[0]}: ${r[1]}`).join('\n');
    if (b.type === 'table') return [b.header.join(' | ')].concat(b.rows.map((r) => r.join(' | '))).join('\n');
    return '';
  }
  function sectionText(s) {
    return s.blocks.map(blockText).filter(Boolean).join('\n');
  }
  function toText(doc) {
    const head = `${doc.title}\n${doc.subtitle}\n초안 (공식 서식 아님, 신청 화면에 옮겨 입력하세요)`;
    return [head].concat(doc.sections.map((s) => `\n${s.title}\n${sectionText(s)}`)).join('\n');
  }

  const EXAMPLES = {
    semas: {
      company: '예시분식', ceo: '홍길동', openDate: '2021-03-02', industryName: '음식점업 (분식)',
      address: '예시시 예시구 예시로 12, 1층', mainBiz: '학교 인근 분식 매장 운영 및 배달',
      sales: [{ year: '2023', amount: '165000000' }, { year: '2024', amount: '182000000' }, { year: '2025', amount: '193000000' }],
      products: '떡볶이·김밥 세트 | 매장 + 배달앱 | 55% | 8,500원\n튀김·분식 단품 | 매장 + 포장 | 30% | 3,000~5,000원\n도시락 단체 주문 | 전화 주문 | 15% | 7,000원',
      customers: '인근 중·고등학교 학생과 교직원, 주변 사무실 직장인이 주 고객이며, 식자재는 지역 도매업체 2곳에서 월 단위 정산으로 구매합니다.',
      strengths: '반경 500m 내 분식점은 3곳입니다. 직접 만든 소스와 방학 기간 단체 도시락이 차별점이며 재방문율이 높습니다.',
      changes: '올해 하반기 식자재 단가 상승으로 매출원가가 늘어 운영자금이 부족합니다. 매출은 전년과 비슷한 수준을 유지하고 있습니다.',
      careers: '2015.03~2020.12 | 예시식품(주) | 조리·메뉴 개발\n2021.03~현재 | 예시분식 | 대표 · 운영 전반',
      applyAmount: '50000000',
      plan: [
        { kind: '운전', use: '식자재 구입', party: '지역 도매업체 2곳', amount: '20000000', when: '대출 후 1~3개월' },
        { kind: '운전', use: '임차료', party: '사업장 월세 6개월분', amount: '12000000', when: '매월' },
        { kind: '운전', use: '인건비', party: '직원 2명 급여', amount: '10000000', when: '매월' },
        { kind: '운전', use: '홍보·배달 수수료', party: '배달앱 광고비', amount: '8000000', when: '대출 후 1~6개월' },
      ],
      repay: '월 평균 매출 약 1,600만원에서 매출원가·고정비를 제외하고 월 100만원 이상 상환이 가능합니다.',
      tech: '', market: '', hiring: '',
    },
    kosmes: {
      company: '예시정밀(주)', ceo: '김예시', openDate: '2016-05-10', industryName: '금속가공 (자동차 부품용 정밀 가공품)',
      address: '예시시 산업단지', mainBiz: '자동차 부품용 정밀 가공품 제조',
      sales: [{ year: '2023', amount: '2100000000', profit: '160000000', debt: '145' }, { year: '2024', amount: '2450000000', profit: '200000000', debt: '132' }, { year: '2025', amount: '2820000000', profit: '250000000', debt: '120' }],
      products: '', customers: '', strengths: '', changes: '',
      careers: '2005~2020 | 자동차 부품 제조사 | 생산·품질 관리, 기계가공기능장\n2016~현재 | 예시정밀(주) | 대표이사',
      tech: '5축 가공 기반 정밀 부품을 공급합니다. 공차 ±0.005mm를 안정적으로 맞추는 공정 노하우가 강점이며 불량률은 0.4%입니다. 특허 1건(가상), ISO 9001 인증(가상)을 보유합니다.',
      market: '주요 거래처 3곳이 매출의 68%를 차지하며 모두 3년 이상 거래 중입니다. 전기차 부품 수주 문의가 늘고 있습니다.',
      hiring: '최근 1년 3명을 신규 채용했으며, 설비 도입 후 2명을 추가 채용할 계획입니다. 직접 수출은 없고 협력사 경유 간접 수출이 있습니다.',
      applyAmount: '500000000',
      plan: [
        { kind: '시설', use: '5축 머시닝센터 1대', party: '견적서 기준', amount: '500000000', when: '2026-12' },
      ],
      repay: '영업이익과 감가상각비로 연 원리금 약 1.1억원을 상환할 수 있습니다. 주요 거래처 의존도는 신규 거래처 2곳 확보로 낮출 계획입니다.',
    },
  };

  return { build, check, salesStats, planTotals, toText, sectionText, num, won, EXAMPLES, INDUSTRY_LABEL };
});
