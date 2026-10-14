/**
 * 자격 진단 엔진. 요건은 이전 정리본(소진공 제2026-448호, 중진공 제2026-464호) 기준이다.
 * 규칙은 fund.ruleId(없으면 fund.id)로 찾는다.
 * 각 규칙은 { ok: true | false | null, label } 를 돌려준다.
 *   true  = 충족, false = 명백히 미충족, null = 입력만으로 판단 불가(확인 필요)
 * 자금 상태: 미충족이 하나라도 있으면 "no", 없고 확인 필요가 있으면 "check", 모두 충족하면 "fit".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PF_ELIGIBILITY = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TEN_INDUSTRIES = ['mfg', 'construction', 'transport', 'mining'];

  const rule = (ok, label) => ({ ok, label });

  function derive(input) {
    const p = Object.assign({
      bizStatus: 'operating', industry: 'service', employees: 0, years: 0,
      ncb: 'unknown', exportLevel: 'none', need: 'working', salesDrop: 'none', flags: {},
    }, input);
    p.flags = Object.assign({}, input && input.flags);
    const limit = TEN_INDUSTRIES.includes(p.industry) ? 10 : 5;
    p.smallBizLimit = limit;
    p.isSmallBiz = Number(p.employees) < limit;
    p.prospective = p.bizStatus === 'prospective';
    return p;
  }

  function semasBase(p) {
    const out = [];
    if (p.prospective) out.push(rule(null, '예비창업자는 개업(사업자등록) 후 신청 가능한지 확인 필요'));
    else out.push(rule(p.isSmallBiz, `소상공인 요건: 상시근로자 ${p.smallBizLimit}명 미만`));
    return out.concat(exclusions(p, 'semas'));
  }

  function kosmesBase(p, opts) {
    const o = opts || {};
    const out = [];
    if (p.isSmallBiz && !p.prospective) {
      if (o.smallBizOk) out.push(rule(true, '소상공인도 지원 대상에 포함되는 자금'));
      else if (p.industry === 'mfg' || p.flags.innovField) out.push(rule(null, '소상공인은 원칙적으로 중진공 융자제한 대상이나 제조업·혁신성장 분야 영위 시 예외 적용 가능'));
      else out.push(rule(false, '소상공인은 중진공 융자제한 대상 (예외: 제조업, 혁신성장·초격차·신산업 분야 영위)'));
    } else {
      out.push(rule(true, '중소기업 요건'));
    }
    return out.concat(exclusions(p, 'kosmes'));
  }

  function exclusions(p, agency) {
    const f = p.flags;
    const out = [];
    if (f.closed) out.push(rule(false, '융자제한: 휴·폐업 중'));
    if (f.creditRegistered) out.push(rule(false, '융자제한: 신용도판단정보·공공정보(연체·부도 등) 등록'));
    if (f.excludedIndustry) out.push(rule(false, '융자제한: 융자제외 업종'));
    if (f.taxArrears) out.push(rule(null, '세금 체납은 융자제한 사유. 압류·매각 유예 등을 받은 경우에 한해 일부 자금에서 예외'));
    if (f.fundedMany) {
      out.push(rule(null, agency === 'semas'
        ? '최근 5년 정책자금 3회 이상 지원: 시설자금 또는 직접대출 성실상환 시 1회 추가 가능, 특별경영안정자금은 횟수 미포함'
        : '최근 5년 정책자금 3회 이상 지원: 예외 요건에 해당하면 추가 지원 가능'));
    }
    return out;
  }

  const needsWorking = (p) => (p.need === 'facility'
    ? rule(false, '운전자금 전용 자금인데 시설자금만 필요하다고 입력함')
    : rule(true, '운전자금 용도'));

  const requireFlag = (p, key, label) => rule(p.flags[key] ? true : false, label);

  const RULES = {
    'semas-general': (p) => semasBase(p).concat(needsWorking(p)),
    'semas-disaster': (p) => semasBase(p).concat(requireFlag(p, 'disaster', '지자체 발급 재해 중소기업(소상공인) 확인증 보유')),
    'semas-temp': (p) => semasBase(p).concat(
      p.salesDrop === '15'
        ? rule(true, '직전 대비 매출 15% 이상 감소')
        : rule(null, '매출 15% 이상 감소가 아니어도 고용위기·산업위기·상권활성화구역 등 지정 지역 소재이면 가능'),
    ),
    'semas-homeplus': (p) => semasBase(p).concat(requireFlag(p, 'homeplus', '홈플러스 피해 소상공인')),
    'semas-credit': (p) => semasBase(p).concat(
      p.ncb === 'le839' ? rule(true, 'NCB 839점 이하')
        : p.ncb === 'unknown' ? rule(null, '신용점수(NCB/NICE)를 확인해야 함 (839점 이하 대상)')
          : rule(false, 'NCB 839점 초과'),
      rule(null, '신청 전 소상공인 지식배움터 신용관리 교육 이수 필요'),
    ),
    'semas-refinance': (p) => semasBase(p).concat(
      p.ncb === 'le839' || p.ncb === 'mid' ? rule(true, 'NCB 919점 이하')
        : p.ncb === 'unknown' ? rule(null, '신용점수(NCB)를 확인해야 함 (919점 이하 대상)')
          : rule(false, 'NCB 919점 초과'),
      requireFlag(p, 'refinance', '2025.6.30 이전 7% 이상 고금리 또는 만기연장 애로 대출 보유'),
    ),
    'semas-restart': (p) => semasBase(p).concat(
      requireFlag(p, 'restart', '재창업·채무조정 성실상환·재기사업화 해당'),
      rule(null, '일반형·희망형·도약형별 세부 요건(교육 수료, 상환 회차, 업력) 확인 필요'),
    ),
    'semas-disabled': (p) => semasBase(p).concat(requireFlag(p, 'disabled', '장애인기업 (복지카드·유공자 증서·장애인기업확인서)')),
    'semas-youth': (p) => {
      const youthOwner = p.flags.ownerYouth && p.years < 3;
      const ok = youthOwner || p.flags.youthEmployee;
      return semasBase(p).concat(rule(ok ? true : false,
        '청년 요건: 업력 3년 미만 청년(만 39세 이하) 대표, 또는 청년근로자 과반·최근 1년 내 청년근로자 고용'));
    },
    'semas-sgongin': (p) => semasBase(p).concat(rule(p.industry === 'mfg', '제조업(표준산업분류 C) 영위 소공인')),
    'semas-innov': (p) => semasBase(p).concat(
      p.flags.growthType || p.exportLevel !== 'none'
        ? rule(true, '수출 또는 성장 유형(매출 신장·스마트공장·로컬크리에이터 등) 해당')
        : rule(null, '혁신형·일반형 유형(수출, 2년 연속 매출 10%↑, 스마트공장·스마트기술, 백년소상공인 등) 해당 여부 확인 필요'),
    ),
    'semas-matching': (p) => semasBase(p).concat(requireFlag(p, 'privateInvest', '민간 투자기관 투자금 수령 및 선투자 추천서 발급')),
    'semas-sangsaeng': (p) => semasBase(p).concat(requireFlag(p, 'topsSelected', 'TOPS·점프업 선정 또는 협약 플랫폼 추천')),

    'kosmes-startup': (p) => kosmesBase(p).concat(
      p.prospective || p.years < 7 ? rule(true, '창업 7년 미만(예비창업자 포함)')
        : rule(false, '업력 7년 이상 (신산업 창업 분야는 10년 이내까지 가능)'),
    ),
    'kosmes-youth': (p) => kosmesBase(p, { smallBizOk: p.flags.innovField || p.industry === 'mfg' }).concat(
      rule(p.flags.ownerYouth && (p.prospective || p.years < 3) ? true : false, '대표자 만 39세 이하 + 업력 3년 미만(또는 창업 예정)'),
    ),
    'kosmes-tech': (p) => kosmesBase(p).concat(requireFlag(p, 'hasTech', '특허·정부 R&D·기술 인증 등 사업화 대상 기술 보유')),
    'kosmes-export-start': (p) => kosmesBase(p, { smallBizOk: true }).concat(
      p.exportLevel === 'lt100k' ? rule(true, '최근 1년 수출실적 10만불 미만 (1불 이상)')
        : p.exportLevel === 'none' ? rule(null, '수출실적이 없으면 수출지원사업 참여·기술수출·해외법인 요건 해당 여부 확인')
          : rule(false, '수출실적 10만불 이상은 "수출기업 글로벌화" 대상'),
    ),
    'kosmes-export-global': (p) => kosmesBase(p, { smallBizOk: true }).concat(
      p.exportLevel === 'gte100k' ? rule(true, '최근 1년 수출실적 10만불 이상') : rule(false, '수출실적 10만불 이상 필요'),
    ),
    'kosmes-innov-growth': (p) => kosmesBase(p).concat(
      p.prospective ? rule(false, '창업 전에는 창업기반지원자금 대상')
        : p.years >= 7 ? rule(true, '업력 7년 이상')
          : rule(null, '업력 7년 미만은 창업자에 해당하지 않는 경우에 한해 가능'),
      p.need === 'working' ? rule(null, '운전자금은 시설자금 도입 후 초기가동비 중심 (시설자금의 50% 이내)') : rule(true, '시설자금 용도'),
    ),
    'kosmes-coop': (p) => kosmesBase(p).concat(requireFlag(p, 'coop', '협동화실천계획 또는 협업사업계획 승인')),
    'kosmes-netzero': (p) => kosmesBase(p).concat(requireFlag(p, 'greenTech', '그린기술 사업화·친환경 전환 설비 도입 기업')),
    'kosmes-smart': (p) => kosmesBase(p).concat(requireFlag(p, 'smartFactory', '스마트공장 지원사업 참여 또는 자동화 시설 도입 추진')),
    'kosmes-conversion': (p) => kosmesBase(p).concat(
      requireFlag(p, 'bizConversion', '사업전환계획(또는 사업재편계획) 승인 후 5년 미만'),
      p.employees >= 5 ? rule(true, '상시근로자 5인 이상') : rule(false, '사업전환자금은 상시근로자 5인 이상'),
    ),
    'kosmes-trade': (p) => kosmesBase(p).concat(requireFlag(p, 'tradeDesignated', '통상변화대응지원기업 지정 후 3년 미만')),
    'kosmes-restructure': (p) => kosmesBase(p).concat(requireFlag(p, 'distress', '부실징후·워크아웃·회생계획 이행 등 구조개선 대상')),
    'kosmes-restart': (p) => kosmesBase(p).concat(
      requireFlag(p, 'restart', '폐업 이력이 있는 재창업자'),
      p.prospective || p.years < 7 ? rule(true, '재창업 후 업력 7년 미만') : rule(false, '업력 7년 이상'),
      rule(null, '성실경영평가 통과 필요'),
    ),
    'kosmes-disaster': (p) => kosmesBase(p).concat(requireFlag(p, 'disaster', '재해중소기업 확인증 보유')),
    'kosmes-temp': (p) => kosmesBase(p).concat(
      p.salesDrop === '10' || p.salesDrop === '15' ? rule(true, '매출 또는 영업이익 10% 이상 감소')
        : rule(false, '매출 또는 영업이익 10% 이상 감소 필요 (대형사고는 피해 1억원 이상)'),
      rule(null, '공고가 정한 경영애로 사유(보호무역·환율·거래처 도산 등) 해당 여부와 6개월 신청기한 확인'),
    ),
  };

  // Funds whose notice text gives no machine-checkable requirement: base conditions only, the rest is "확인 필요".
  RULES['generic-semas'] = (p) => semasBase(p).concat(rule(null, '공고문에서 지원 대상 요건을 확인해야 합니다'));
  RULES['generic-kosmes'] = (p) => kosmesBase(p).concat(rule(null, '공고문에 한도·금리·대상 요건이 기재되지 않아 중진공 상담으로 확인해야 합니다'));

  function evaluate(fund, input) {
    const p = derive(input);
    const fn = RULES[fund.ruleId || fund.id];
    const reasons = fn ? fn(p) : [rule(null, '별도 요건 확인 필요')];
    let status = 'fit';
    if (reasons.some((r) => r.ok === false)) status = 'no';
    else if (reasons.some((r) => r.ok === null)) status = 'check';
    return { fund, status, reasons };
  }

  function evaluateAll(funds, input) {
    const order = { fit: 0, check: 1, no: 2 };
    return funds.map((f) => evaluate(f, input)).sort((a, b) => order[a.status] - order[b.status]);
  }

  return { derive, evaluate, evaluateAll, RULES, TEN_INDUSTRIES };
});
