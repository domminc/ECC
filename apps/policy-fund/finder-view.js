/* 내게 맞는 자금: business profile form -> eligibility diagnosis -> grouped result cards and the shared detail panel. */
(function () {
  'use strict';

  const PF = window.PF;
  const { h, $ } = PF;
  const data = PF.data;
  const E = window.PF_ELIGIBILITY;
  const DR = window.PF_DRAFT;

  const FLAGS = [
    ['ownerYouth', '대표자 만 39세 이하'], ['youthEmployee', '청년근로자 고용·유지'], ['disaster', '재해 확인증 보유'],
    ['disabled', '장애인기업'], ['restart', '재창업·채무조정 성실상환'], ['refinance', '7% 이상 고금리·만기연장 애로 대출 보유'],
    ['homeplus', '홈플러스 피해'], ['growthType', '매출 10% 이상 2년 연속·스마트공장·로컬크리에이터'], ['privateInvest', '민간 투자 유치(선투자 추천서)'],
    ['topsSelected', 'TOPS·점프업 선정'], ['hasTech', '특허·R&D·기술인증 보유'], ['innovField', '혁신성장·신산업 분야 영위'],
    ['smartFactory', '스마트공장·자동화 도입 추진'], ['greenTech', '그린기술·친환경 전환'], ['coop', '협동화 계획 승인'],
    ['bizConversion', '사업전환·재편 승인'], ['tradeDesignated', '통상변화대응 지정'], ['distress', '부실징후·워크아웃·회생']
  ];
  const EXCLS = [
    ['taxArrears', '세금 체납'], ['creditRegistered', '신용정보 등록(연체·부도 등)'], ['closed', '휴·폐업 중'],
    ['excludedIndustry', '융자제외 업종'], ['fundedMany', '최근 5년 정책자금 3회 이상']
  ];
  const EXAMPLE = {
    bizStatus: 'operating', industry: 'food_lodging', employees: 2, years: 4, need: 'working',
    ncb: 'mid', exportLevel: 'none', salesDrop: 'none', flags: {}
  };
  const NEED_LABEL = { working: '운전자금', facility: '시설자금', both: '시설·운전자금' };
  const GROUP_TITLE = { fit: '요건을 충족하는 자금', check: '조건 확인이 필요한 자금', no: '해당 없는 자금' };

  const saved = PF.store.get('profile', null);
  let profile = Object.assign({}, EXAMPLE, saved || {});
  profile.flags = Object.assign({}, (saved || EXAMPLE).flags);
  let usedExample = !saved;
  let selected = null;
  let form = null;
  const listeners = [];

  PF.profile = {
    get: () => profile,
    isExample: () => usedExample,
    onChange: cb => listeners.push(cb)
  };

  function buildChips(container, defs) {
    defs.forEach(([key, label]) => {
      container.appendChild(h('label', { class: 'chip' }, h('input', { type: 'checkbox', name: key, id: 'flag-' + key }), h('span', { text: label })));
    });
  }

  function writeForm() {
    form.elements.bizStatus.value = profile.bizStatus;
    ['industry', 'employees', 'years', 'need', 'ncb', 'exportLevel', 'salesDrop'].forEach(k => { form.elements[k].value = profile[k]; });
    FLAGS.concat(EXCLS).forEach(([k]) => { form.elements[k].checked = !!profile.flags[k]; });
  }

  function readForm() {
    const num = v => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
    const next = {
      bizStatus: form.elements.bizStatus.value || 'operating',
      industry: form.elements.industry.value,
      employees: num(form.elements.employees.value),
      years: num(form.elements.years.value),
      need: form.elements.need.value,
      ncb: form.elements.ncb.value,
      exportLevel: form.elements.exportLevel.value,
      salesDrop: form.elements.salesDrop.value,
      flags: {}
    };
    FLAGS.concat(EXCLS).forEach(([k]) => { if (form.elements[k].checked) next.flags[k] = true; });
    return next;
  }

  function summaryText() {
    if (profile.bizStatus === 'prospective') return '예비창업자 · ' + (DR.INDUSTRY_LABEL[profile.industry] || '') + ' · ' + NEED_LABEL[profile.need];
    return [DR.INDUSTRY_LABEL[profile.industry], `상시근로자 ${profile.employees}명`, `업력 ${profile.years}년`, NEED_LABEL[profile.need]].join(' · ');
  }

  function renderDerived() {
    const p = E.derive(profile);
    $('derived').textContent = p.prospective
      ? '예비창업자: 사업자등록 전에는 소진공 자금 신청이 어렵습니다. 창업 지원 자금(중진공)을 먼저 확인하세요.'
      : p.isSmallBiz
        ? `소상공인에 해당합니다 (상시근로자 ${p.employees}명 < ${p.smallBizLimit}명). 소진공 자금이 기본 대상입니다.`
        : `소상공인 기준(상시근로자 ${p.smallBizLimit}명 미만)을 넘습니다. 중진공 자금이 기본 대상입니다.`;
    $('profile-sum').textContent = (usedExample ? '예시 값 · ' : '') + summaryText();
  }

  /* ---------- result cards ---------- */

  function oneLine(r) {
    if (r.status === 'fit') return '입력한 조건을 모두 충족합니다.';
    const want = r.status === 'no' ? false : null;
    const hit = r.reasons.filter(x => x.ok === want);
    return hit[0].label + (hit.length > 1 ? ` 외 ${hit.length - 1}건` : '');
  }

  function resultCard(r) {
    const f = r.fund;
    const btn = h('button', { type: 'button', class: 'card card--result', 'data-id': f.id },
      h('span', { class: 'card-top' }, PF.badge(f), h('span', { class: 'group', text: f.group }), PF.flagsFor(f),
        h('span', { class: 'status status--' + r.status, text: PF.STATUS_LABEL[r.status] })),
      h('span', { class: 'card-title', text: f.name }),
      h('span', { class: 'why-line why-line--' + r.status, text: oneLine(r) }),
      PF.factRow(f));
    btn.addEventListener('click', () => select(f.id, true, btn));
    return h('li', {}, btn);
  }

  let lastResults = [];

  function renderResults() {
    renderDerived();
    lastResults = E.evaluateAll(data.funds, profile);
    const box = PF.clear($('finder-results'));
    const counts = { fit: 0, check: 0, no: 0 };
    lastResults.forEach(r => { counts[r.status] += 1; });
    $('finder-count').textContent = `충족 ${counts.fit} · 확인 필요 ${counts.check} · 해당 없음 ${counts.no} (전체 ${lastResults.length}개 자금)`;
    $('example-note').hidden = !usedExample;

    ['fit', 'check', 'no'].forEach(s => {
      const rows = lastResults.filter(r => r.status === s);
      if (!rows.length) return;
      const list = h('ul', { class: 'fund-list' }, rows.map(resultCard));
      if (s === 'no') {
        box.appendChild(h('details', { class: 'fold fold--results' }, h('summary', { text: `${GROUP_TITLE[s]} (${rows.length})` }), list));
      } else {
        box.appendChild(h('h3', { class: 'group-title', text: `${GROUP_TITLE[s]} (${rows.length})` }));
        box.appendChild(list);
      }
    });
    if (!counts.fit && !counts.check) {
      box.prepend(h('p', { class: 'note', text: '입력한 조건으로는 신청 가능한 자금이 없습니다. 융자제한 항목을 확인하거나 상담 창구에 문의하세요.' }));
    }
    markCurrent();
  }

  function markCurrent() {
    document.querySelectorAll('#finder-results .card').forEach(c => {
      if (c.getAttribute('data-id') === selected) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
  }

  function renderPane() {
    const r = lastResults.find(x => x.fund.id === selected);
    PF.renderDetail($('detail-finder'), r ? r.fund : null, {
      reasons: r ? r.reasons : null,
      status: r ? r.status : null,
      backLabel: '← 결과로',
      emptyText: '결과에서 자금을 선택하면 진단 이유와 필요 서류를 볼 수 있습니다.'
    });
  }

  function select(id, userAction, trigger) {
    selected = id;
    markCurrent();
    renderPane();
    $('detail-finder').scrollTop = 0;
    if (userAction && !PF.wide.matches) PF.sheet.open($('detail-finder'), trigger);
  }

  function refresh() {
    renderResults();
    renderPane();
    listeners.forEach(cb => cb(profile));
  }

  /* ---------- wiring ---------- */

  PF.finderView = {
    init() {
      form = $('profile');
      $('finder-basis').textContent = data.meta.finderBasis + ' 최신 변경공고에서 바뀐 자금은 "변경" 표시를 확인하세요.';
      buildChips($('flag-chips'), FLAGS);
      buildChips($('excl-chips'), EXCLS);
      writeForm();

      form.addEventListener('input', () => {
        profile = readForm();
        usedExample = false;
        PF.store.set('profile', profile);
        refresh();
      });
      form.addEventListener('submit', e => e.preventDefault());
      $('profile-reset').addEventListener('click', () => {
        profile = Object.assign({}, EXAMPLE, { flags: {} });
        usedExample = true;
        PF.store.set('profile', null);
        writeForm();
        refresh();
      });
      $('profile-toggle').addEventListener('click', () => {
        const shell = $('shell-finder');
        const open = shell.getAttribute('data-panel') !== 'open';
        shell.setAttribute('data-panel', open ? 'open' : 'closed');
        $('profile-toggle').setAttribute('aria-expanded', String(open));
      });

      renderResults();
      const first = lastResults.find(r => r.status === 'fit') || lastResults[0];
      selected = first ? first.fund.id : null;
      markCurrent();
      renderPane();
    },
    defaultFundId() {
      const first = lastResults.find(r => r.status === 'fit');
      return first ? first.fund.id : (data.funds[0] || {}).id;
    },
    select(id) {
      select(id, false);
    },
    refreshDetail: renderPane
  };
}());
