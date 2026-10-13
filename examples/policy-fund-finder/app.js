/* global window, document */
(function () {
  'use strict';

  const D = window.PF_DATA;
  const E = window.PF_ELIGIBILITY;
  const fundById = Object.fromEntries(D.FUNDS.map((f) => [f.id, f]));
  const formById = Object.fromEntries(D.FORMS.map((f) => [f.id, f]));

  /* ---------- 저장소 (실패해도 동작) ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_e) { return fallback; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (_e) { /* 저장 불가 환경 */ }
    },
  };

  /* ---------- DOM 헬퍼: 데이터는 항상 textContent 로 넣는다 ---------- */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === false || v === null || v === undefined) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const ext = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', text });

  /* ---------- 프로필 ---------- */
  const FLAGS = [
    ['ownerYouth', '대표자 만 39세 이하'], ['youthEmployee', '청년근로자 고용·유지'], ['disaster', '재해 확인증 보유'],
    ['disabled', '장애인기업'], ['restart', '재창업·채무조정 성실상환'], ['refinance', '7%↑ 고금리·만기연장 애로 대출 보유'],
    ['homeplus', '홈플러스 피해'], ['growthType', '매출 10%↑ 2년 연속·스마트공장·로컬크리에이터'], ['privateInvest', '민간 투자 유치(선투자 추천서)'],
    ['topsSelected', 'TOPS·점프업 선정'], ['hasTech', '특허·R&D·기술인증 보유'], ['innovField', '혁신성장·신산업 분야 영위'],
    ['smartFactory', '스마트공장·자동화 도입 추진'], ['greenTech', '그린기술·친환경 전환'], ['coop', '협동화 계획 승인'],
    ['bizConversion', '사업전환·재편 승인'], ['tradeDesignated', '통상변화대응 지정'], ['distress', '부실징후·워크아웃·회생'],
  ];
  const EXCLS = [
    ['taxArrears', '세금 체납'], ['creditRegistered', '신용정보 등록(연체·부도 등)'], ['closed', '휴·폐업 중'],
    ['excludedIndustry', '융자제외 업종'], ['fundedMany', '최근 5년 정책자금 3회 이상'],
  ];
  const EXAMPLE = {
    bizStatus: 'operating', industry: 'food_lodging', employees: 2, years: 4, need: 'working',
    ncb: 'mid', exportLevel: 'none', salesDrop: 'none', flags: {},
  };
  let profile = Object.assign({}, EXAMPLE, store.get('pf.profile', null) || {});
  profile.flags = Object.assign({}, (store.get('pf.profile', null) || EXAMPLE).flags);
  let usedExample = !store.get('pf.profile', null);

  const form = document.getElementById('profile');
  function buildChips(container, defs) {
    defs.forEach(([key, label]) => {
      container.append(h('label', { class: 'chip' }, h('input', { type: 'checkbox', name: key, id: 'flag-' + key }), h('span', { text: label })));
    });
  }
  buildChips(document.getElementById('flagChips'), FLAGS);
  buildChips(document.getElementById('exclChips'), EXCLS);

  function writeForm() {
    form.elements.bizStatus.value = profile.bizStatus;
    ['industry', 'employees', 'years', 'need', 'ncb', 'exportLevel', 'salesDrop'].forEach((k) => { form.elements[k].value = profile[k]; });
    FLAGS.concat(EXCLS).forEach(([k]) => { form.elements[k].checked = !!profile.flags[k]; });
  }
  function readForm() {
    const num = (v) => (v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
    const next = {
      bizStatus: form.elements.bizStatus.value || 'operating',
      industry: form.elements.industry.value,
      employees: num(form.elements.employees.value),
      years: num(form.elements.years.value),
      need: form.elements.need.value,
      ncb: form.elements.ncb.value,
      exportLevel: form.elements.exportLevel.value,
      salesDrop: form.elements.salesDrop.value,
      flags: {},
    };
    FLAGS.concat(EXCLS).forEach(([k]) => { if (form.elements[k].checked) next.flags[k] = true; });
    return next;
  }

  /* ---------- 결과 ---------- */
  const STATUS = { fit: '입력 기준 충족', check: '확인 필요', no: '해당 없음' };
  const GROUP_TITLE = { fit: '요건을 충족하는 자금', check: '조건 확인이 필요한 자금', no: '해당 없는 자금' };

  function factList(f) {
    const rows = [['한도', f.limit], ['금리', f.rate], ['기간', f.term], ['방식', f.methods.join(' · ')]];
    return h('dl', { class: 'facts' }, rows.map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v }))));
  }

  function agencyTag(f) {
    return h('span', { class: 'agency ' + f.agency, text: D.AGENCIES[f.agency].short });
  }

  function resultCard(r) {
    const f = r.fund;
    const card = h('article', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {},
          h('div', { class: 'meta' }, agencyTag(f), h('span', { text: f.category })),
          h('h4', {}, h('button', { type: 'button', onclick: () => openDetail(f.id, r.reasons), text: f.name })),
        ),
        h('span', { class: 'status ' + r.status, text: STATUS[r.status] }),
      ),
      h('p', { class: 'sub', text: f.summary, style: 'margin:0' }),
      factList(f),
    );
    if (r.status !== 'no') {
      card.append(reasonList(r.reasons));
    } else {
      const miss = r.reasons.filter((x) => x.ok === false);
      card.append(reasonList(miss));
    }
    return card;
  }

  function reasonList(reasons) {
    return h('ul', { class: 'why' }, reasons.map((x) => h('li', {},
      h('b', { class: x.ok === true ? 't' : x.ok === false ? 'f' : 'u', text: x.ok === true ? '충족' : x.ok === false ? '미충족' : '확인' }),
      h('span', { text: x.label }))));
  }

  function renderDerived() {
    const p = E.derive(profile);
    const el = document.getElementById('derived');
    if (p.prospective) el.textContent = '예비창업자: 사업자등록 전에는 소진공 자금 신청이 어렵습니다. 창업 지원 자금(중진공)을 먼저 확인하세요.';
    else el.textContent = p.isSmallBiz
      ? `소상공인에 해당합니다 (상시근로자 ${p.employees}명 < ${p.smallBizLimit}명). 소진공 자금이 기본 대상입니다.`
      : `소상공인 기준(상시근로자 ${p.smallBizLimit}명 미만)을 넘습니다. 중진공 자금이 기본 대상입니다.`;
  }

  function renderResults() {
    renderDerived();
    const all = E.evaluateAll(D.FUNDS, profile);
    const box = clear(document.getElementById('results'));
    const counts = { fit: 0, check: 0, no: 0 };
    all.forEach((r) => { counts[r.status] += 1; });
    document.getElementById('resultCount').textContent = `충족 ${counts.fit} · 확인 필요 ${counts.check} · 해당 없음 ${counts.no} (전체 ${all.length}개 자금)`;
    ['fit', 'check', 'no'].forEach((s) => {
      const rows = all.filter((r) => r.status === s);
      if (!rows.length) return;
      const cards = h('div', { class: 'cards' }, rows.map(resultCard));
      if (s === 'no') {
        box.append(h('details', { class: 'fold' }, h('summary', { text: `${GROUP_TITLE[s]} (${rows.length})` }), cards));
      } else {
        box.append(h('div', { class: 'group' }, h('h3', { text: `${GROUP_TITLE[s]} (${rows.length})` })), cards);
      }
    });
    if (!counts.fit && !counts.check) {
      box.prepend(h('p', { class: 'sub', text: '입력한 조건으로는 신청 가능한 자금이 없습니다. 융자제한 항목을 확인하거나 상담 창구에 문의하세요.' }));
    }
  }

  /* ---------- 상세 ---------- */
  const dialog = document.getElementById('detail');
  const checks = store.get('pf.checks', {});

  function steps(f) {
    if (f.agency === 'kosmes') {
      return ['중진공 누리집에서 지역본·지부별 신청 일정과 신청 가능 자금 확인', '온라인 융자 신청: 정보제공 동의, 사전 기업진단, 기업정보 제출', '정책우선도 평가(사전평가)로 심사 기회 부여 여부 결정', '심사 기회를 받으면 정해진 기한까지 융자 필요서류를 온라인 제출', '기업평가: 현장방문 또는 비대면', '융자 결정: 지원 가능 여부와 금액', '대출(직접 또는 대리) 후 자금 사용 점검'];
    }
    const proxy = f.methods[0] === '대리대출';
    return proxy
      ? ['소상공인정책자금 사이트에서 접수기간 확인', '대표자 본인인증 후 대리대출 확인서 신청: 자가진단, 신용정보 동의, 신청서, 서류', '확인서 발급 승인 후 90일 안에 출력', '취급 은행·신용보증재단 방문: 보증서 발급, 금융기관 대출 심사', '대출 실행']
      : ['소상공인정책자금 사이트에서 자금별 접수기간 확인 (직접대출은 단기간 접수가 많습니다)', '대표자 본인인증 후 업체·자금 선택, 약관 동의, 신청서 작성', '서류 제출: 사업계획서 웹폼과 "필수" 서류 업로드. 제출 마감일이 지나면 신청이 자동 취소됩니다', '소진공 심사: 기술성, 성장잠재력, 경영능력, 사업계획 타당성, 신용도', '대출 약정 체결 후 실행'];
  }

  function docGroups(f) {
    const groups = { A: '온라인 입력 · 동의', B: '준비해서 제출할 서류', C: '발급 · 확인 단계' };
    return Object.keys(groups).map((g) => {
      const ids = f.docs.filter((id) => D.DOCS[id] && D.DOCS[id].group === g);
      return { key: g, title: groups[g], ids };
    }).filter((g) => g.ids.length);
  }

  function checkRow(f, id, onChange) {
    const d = D.DOCS[id];
    const done = !!(checks[f.id] && checks[f.id][id]);
    const input = h('input', { type: 'checkbox', id: `chk-${f.id}-${id}`, checked: done });
    input.addEventListener('change', () => {
      checks[f.id] = Object.assign({}, checks[f.id], { [id]: input.checked });
      store.set('pf.checks', checks);
      onChange();
    });
    const extra = [];
    if (d.where) extra.push(ext(d.where.url, d.where.label + ' ↗'));
    (d.forms || []).forEach((fid) => {
      const fm = formById[fid];
      extra.push(h('a', { href: fm.blank.file, download: fm.blank.name, text: fm.title + ' 양식' }));
      if (fm.sample) extra.push(h('a', { href: fm.sample.file, download: fm.sample.name, text: '작성예시' }));
    });
    return h('label', { class: 'check', for: input.id },
      input,
      h('div', {},
        h('div', { class: 'name' }, h('span', { text: d.name }),
          h('span', { class: 'tag ' + d.status, text: d.status === 'official' ? '공고·안내 명시' : '일반 요구' })),
        h('p', { text: d.desc }),
        extra.length ? h('div', { class: 'links', style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font-size:0.82rem' }, extra) : null,
      ));
  }

  function csvFor(f) {
    const esc = (s) => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [['자금', '서류', '구분', '준비 여부', '설명'].map(esc).join(',')];
    f.docs.forEach((id) => {
      const d = D.DOCS[id];
      if (!d) return;
      lines.push([f.name, d.name, d.status === 'official' ? '공고·안내 명시' : '일반 요구', checks[f.id] && checks[f.id][id] ? '완료' : '미완료', d.desc].map(esc).join(','));
    });
    return '﻿' + lines.join('\r\n');
  }

  function downloadText(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function openDetail(id, reasons) {
    const f = fundById[id];
    const body = clear(document.getElementById('detailBody'));
    const progress = h('p', { class: 'progress' });
    const updateProgress = () => {
      const done = f.docs.filter((d) => checks[f.id] && checks[f.id][d]).length;
      progress.textContent = `서류 준비 ${done} / ${f.docs.length}`;
    };
    body.append(
      h('div', { class: 'dialog-head' },
        h('div', {}, h('div', { class: 'meta' }, agencyTag(f), h('span', { text: f.category })), h('h2', { id: 'detailTitle', text: f.name })),
        h('button', { type: 'button', class: 'close', onclick: () => dialog.close(), text: '닫기' })),
      h('p', { text: f.summary, style: 'margin:0' }),
      factList(f),
      h('p', { class: 'src', text: '운용 규모: ' + f.scale }),
    );
    if (reasons) {
      body.append(h('div', {}, h('h3', { text: '내 정보 기준 진단' }), reasonList(reasons)));
    }
    body.append(h('div', {}, h('h3', { text: '지원 대상 · 조건' }), h('ul', { class: 'plain' }, f.target.map((t) => h('li', { text: t })))));
    if (f.notes.length) body.append(h('div', {}, h('h3', { text: '참고' }), h('ul', { class: 'plain' }, f.notes.map((t) => h('li', { text: t })))));
    body.append(h('div', {}, h('h3', { text: '신청 절차' }), h('ol', { class: 'steps' }, steps(f).map((s) => h('li', { text: s })))));
    body.append(h('p', { class: 'src', text: `접수처: ${D.AGENCIES[f.agency].apply} · 문의 ${D.AGENCIES[f.agency].phone}` }));

    const list = h('div', {});
    docGroups(f).forEach((g) => {
      list.append(h('h3', { text: g.title }), h('div', { class: 'checklist' }, g.ids.map((did) => checkRow(f, did, updateProgress))));
    });
    body.append(h('div', {}, h('h2', { text: '서류 체크리스트', style: 'margin-top:8px' }), progress,
      h('p', { class: 'src', text: '"일반 요구" 서류는 자금·창구에 따라 달라질 수 있습니다. 신청 화면(또는 상담 후 안내)의 필수 표시가 최종 기준입니다.' }), list));
    updateProgress();

    body.append(h('div', { class: 'dl' },
      h('button', { type: 'button', class: 'btn', onclick: () => startDraftFor(f.id), text: '이 자금으로 사업계획서 초안 작성' }),
      h('button', { type: 'button', class: 'btn alt', onclick: () => downloadText(`${f.id}-checklist.csv`, csvFor(f)), text: '체크리스트 CSV 내려받기' }),
      ext(D.SOURCES[f.src].url, '공식 공고 원문 ↗'),
    ));
    body.append(h('p', { class: 'src', text: '출처: ' + D.SOURCES[f.src].label }));
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  /* ---------- 전체 비교 ---------- */
  const filters = { agency: '', method: '', use: '', text: '' };
  function matches(f) {
    if (filters.agency && f.agency !== filters.agency) return false;
    if (filters.method && !f.methods.some((m) => m.includes(filters.method))) return false;
    if (filters.use && !f.uses.some((u) => u.includes(filters.use))) return false;
    if (filters.text) {
      const hay = [f.name, f.category, f.summary, f.target.join(' '), f.notes.join(' ')].join(' ').toLowerCase();
      if (!hay.includes(filters.text.toLowerCase())) return false;
    }
    return true;
  }
  function renderList() {
    const rows = D.FUNDS.filter(matches);
    document.getElementById('listCount').textContent = `${rows.length}개 자금 · 자금명을 누르면 대상·절차·서류를 볼 수 있습니다`;
    const tb = clear(document.querySelector('#fundTable tbody'));
    rows.forEach((f) => tb.append(h('tr', {},
      h('td', {}, h('button', { type: 'button', onclick: () => openDetail(f.id), text: f.name }), h('span', { class: 'cat' }, D.AGENCIES[f.agency].short + ' · ' + f.category)),
      h('td', { text: f.methods.join(' · ') }),
      h('td', { text: f.limit }),
      h('td', { text: f.rate }),
      h('td', { text: f.term }),
    )));
    if (!rows.length) tb.append(h('tr', {}, h('td', { colspan: 5, text: '조건에 맞는 자금이 없습니다.' })));
  }

  /* ---------- 서류·양식, 일정, 푸터 ---------- */
  function renderDocsTab() {
    const grid = clear(document.getElementById('formsGrid'));
    D.FORMS.forEach((fm) => grid.append(h('article', { class: 'form-card' },
      h('h3', { text: fm.title }), h('p', { text: fm.desc }),
      h('div', { class: 'dl' },
        h('a', { class: 'btn', href: fm.blank.file, download: fm.blank.name, text: '빈 양식' }),
        fm.sample ? h('a', { class: 'btn alt', href: fm.sample.file, download: fm.sample.name, text: '작성예시' }) : null))));

    const labels = { A: '온라인 입력 · 동의', B: '준비해서 제출할 서류', C: '발급 · 확인 단계' };
    const box = clear(document.getElementById('docGroups'));
    Object.keys(labels).forEach((g) => {
      const entries = Object.entries(D.DOCS).filter(([, d]) => d.group === g);
      box.append(h('div', { class: 'doc-group' }, h('h3', { text: labels[g] }), h('div', { class: 'docs' }, entries.map(([, d]) => h('div', { class: 'doc' },
        h('div', { class: 'doc-title' }, h('span', { text: d.name }), h('span', { class: 'tag ' + d.status, text: d.status === 'official' ? '공고·안내 명시' : '일반 요구' })),
        h('p', { text: d.desc }),
        d.where ? h('div', { class: 'links', style: 'display:flex;gap:10px;margin-top:6px;font-size:0.82rem' }, ext(d.where.url, '발급처: ' + d.where.label + ' ↗')) : null,
      )))));
    });
  }

  function renderSchedule() {
    document.getElementById('scheduleSub').textContent = `소상공인정책자금 사이트 첫 화면 기준, ${D.SCHEDULE.asOf} 확인. 직접대출은 짧은 기간만 열리는 자금이 많으니 사이트에서 다시 확인하세요.`;
    const tb = clear(document.querySelector('#scheduleTable tbody'));
    D.SCHEDULE.items.forEach((i) => tb.append(h('tr', {}, h('td', { text: i.type }), h('td', { text: i.name }), h('td', { text: i.period }))));
    const c = clear(document.getElementById('contactList'));
    D.CONTACTS.forEach((x) => c.append(h('li', {}, h('strong', { text: x.name }), h('b', { text: x.tel }), h('span', { text: x.note }))));
    const l = clear(document.getElementById('linkList'));
    D.LINKS.forEach((x) => l.append(h('li', {}, ext(x.url, x.name + ' ↗'), h('br'), h('span', { text: x.note }))));
    const s = clear(document.getElementById('sourceList'));
    Object.values(D.SOURCES).forEach((x) => s.append(h('li', {}, ext(x.url, x.label))));
    document.getElementById('asOf').textContent = D.AS_OF;
  }


  /* ---------- 사업계획서 초안 ---------- */
  const DR = window.PF_DRAFT;
  const dform = document.getElementById('draftForm');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const agencyOfFund = (id) => (fundById[id] ? fundById[id].agency : 'semas');
  function defaultFundId() {
    const first = E.evaluateAll(D.FUNDS, profile).find((r) => r.status === 'fit');
    return first ? first.fund.id : 'semas-general';
  }
  const savedDraft = store.get('pf.draft', null);
  const draft = (savedDraft && fundById[savedDraft.fundId] && savedDraft.input)
    ? savedDraft
    : { fundId: defaultFundId(), isExample: true, input: null };
  if (!draft.input) draft.input = clone(DR.EXAMPLES[agencyOfFund(draft.fundId)]);

  function emptyInput() {
    return {
      company: '', ceo: '', openDate: '', industryName: '', address: '', mainBiz: '',
      sales: [0, 1, 2].map(() => ({ year: '', amount: '', profit: '', debt: '' })),
      products: '', customers: '', strengths: '', changes: '', careers: '', tech: '', market: '', hiring: '',
      applyAmount: '', plan: [{ kind: '운전', use: '', party: '', amount: '', when: '' }], repay: '',
    };
  }

  function buildFundSelect() {
    const sel = clear(document.getElementById('dFund'));
    ['semas', 'kosmes'].forEach((ag) => {
      const group = h('optgroup', { label: `${D.AGENCIES[ag].short} (${D.AGENCIES[ag].audience})` });
      D.FUNDS.filter((f) => f.agency === ag).forEach((f) => group.append(h('option', { value: f.id, text: f.name })));
      sel.append(group);
    });
  }

  function inp(attrs) { return h('input', Object.assign({ type: 'text' }, attrs)); }

  function renderRows() {
    const wide = agencyOfFund(draft.fundId) === 'kosmes';
    const sales = clear(document.getElementById('salesRows'));
    draft.input.sales.forEach((r, i) => {
      const row = h('div', { class: 'row-sales' + (wide ? ' wide' : '') },
        inp({ 'data-s': 'year', 'data-i': i, value: r.year, placeholder: '연도', 'aria-label': `${i + 1}번째 연도` }),
        inp({ 'data-s': 'amount', 'data-i': i, value: r.amount, placeholder: '매출액(원)', inputmode: 'numeric', 'aria-label': `${i + 1}번째 매출액` }));
      if (wide) {
        row.append(inp({ 'data-s': 'profit', 'data-i': i, value: r.profit, placeholder: '영업이익(원)', inputmode: 'numeric', 'aria-label': `${i + 1}번째 영업이익` }),
          inp({ 'data-s': 'debt', 'data-i': i, value: r.debt, placeholder: '부채비율%', inputmode: 'numeric', 'aria-label': `${i + 1}번째 부채비율` }));
      }
      sales.append(row);
    });
    const plan = clear(document.getElementById('planRows'));
    draft.input.plan.forEach((r, i) => {
      const kind = h('select', { 'data-p': 'kind', 'data-i': i, 'aria-label': `${i + 1}번째 구분` },
        h('option', { value: '운전', text: '운전' }), h('option', { value: '시설', text: '시설' }));
      kind.value = r.kind === '시설' ? '시설' : '운전';
      plan.append(h('div', { class: 'row-plan' },
        kind,
        inp({ 'data-p': 'use', 'data-i': i, value: r.use, placeholder: '세부 용도', 'aria-label': `${i + 1}번째 용도` }),
        inp({ 'data-p': 'amount', 'data-i': i, value: r.amount, placeholder: '금액(원)', inputmode: 'numeric', 'aria-label': `${i + 1}번째 금액` }),
        h('div', { class: 'full' },
          inp({ 'data-p': 'party', 'data-i': i, value: r.party, placeholder: '거래처·내용', 'aria-label': `${i + 1}번째 거래처` }),
          inp({ 'data-p': 'when', 'data-i': i, value: r.when, placeholder: '집행 시기', 'aria-label': `${i + 1}번째 집행 시기` }),
          h('button', { type: 'button', 'data-del': i, 'aria-label': `${i + 1}번째 행 삭제`, text: '삭제' }))));
    });
  }

  function writeDraft() {
    dform.querySelectorAll('[data-k]').forEach((el) => {
      const k = el.dataset.k;
      el.value = k === 'fundId' ? draft.fundId : (draft.input[k] === undefined || draft.input[k] === null ? '' : draft.input[k]);
    });
    renderRows();
    toggleAgencyFields();
    document.getElementById('draftExample').hidden = !draft.isExample;
    document.getElementById('draftLoad').hidden = draft.isExample;
  }

  function toggleAgencyFields() {
    const ag = agencyOfFund(draft.fundId);
    dform.querySelectorAll('[data-agency]').forEach((el) => { el.hidden = el.dataset.agency !== ag; });
  }

  function readDraft() {
    dform.querySelectorAll('[data-k]').forEach((el) => {
      if (el.dataset.k === 'fundId') draft.fundId = el.value;
      else draft.input[el.dataset.k] = el.value;
    });
    dform.querySelectorAll('[data-s]').forEach((el) => { draft.input.sales[Number(el.dataset.i)][el.dataset.s] = el.value; });
    dform.querySelectorAll('[data-p]').forEach((el) => { draft.input.plan[Number(el.dataset.i)][el.dataset.p] = el.value; });
  }

  function copyText(text, btn) {
    const original = btn.textContent;
    const done = () => { btn.textContent = '복사됨'; setTimeout(() => { btn.textContent = original; }, 1500); };
    const fallback = () => {
      const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (_e) { btn.textContent = '직접 선택해 복사하세요'; }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  const isMissing = (t) => String(t).includes('【작성 필요');
  function textCell(tag, text) {
    return h(tag, {}, isMissing(text) ? h('span', { class: 'missing', text }) : text);
  }

  function renderBlock(b) {
    if (b.type === 'h') return h('p', { class: 'h', text: b.text });
    if (b.type === 'p') {
      return h('p', { class: b.auto ? 'auto' : '' }, isMissing(b.text) ? h('span', { class: 'missing', text: b.text }) : b.text);
    }
    if (b.type === 'kv') {
      return h('div', { class: 'tw' }, h('table', { class: 'kv' }, h('tbody', {}, b.rows.map((r) => h('tr', {}, h('th', { scope: 'row', text: r[0] }), textCell('td', r[1]))))));
    }
    return h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, b.header.map((x) => h('th', { text: x })))),
      h('tbody', {}, b.rows.map((r) => h('tr', {}, r.map((c) => textCell('td', c)))))));
  }

  let lastDoc = null;
  function renderDraftPreview() {
    const fund = fundById[draft.fundId];
    const need = { working: '운전자금', facility: '시설자금', both: '시설·운전자금' }[profile.need];
    const note = clear(document.getElementById('dProfileNote'));
    note.append(`내 정보에서 가져옴: ${DR.INDUSTRY_LABEL[profile.industry]} · 상시근로자 ${profile.employees}명 · 업력 ${profile.years}년 · ${need}${profile.salesDrop !== 'none' ? ' · 매출 감소' : ''} `,
      h('button', { type: 'button', class: 'ghost small', onclick: () => showTab('finder'), text: '수정' }));

    lastDoc = DR.build(draft.input, fund, profile);
    const issues = clear(document.getElementById('draftIssues'));
    lastDoc.issues.forEach((i) => issues.append(h('li', { text: i.msg })));
    if (!lastDoc.issues.length && lastDoc.missing === 0) issues.append(h('li', { class: 'ok', text: '점검 항목이 없습니다. 제출 전에 공고의 최신 요건과 함께 한 번 더 확인하세요.' }));
    document.getElementById('draftMissing').textContent = lastDoc.missing ? `작성 필요 ${lastDoc.missing}곳` : '모든 항목 입력됨';

    const sumEl = document.getElementById('dPlanSum');
    const t = DR.planTotals(draft.input.plan);
    const apply = DR.num(draft.input.applyAmount);
    sumEl.textContent = `집행계획 합계 ${DR.won(t.total) || '0원'}`
      + (Number.isFinite(apply) ? (t.total === apply ? ' · 신청금액과 일치' : ` · 신청금액과 ${DR.won(Math.abs(apply - t.total))} 차이`) : ' · 신청 금액을 입력하세요');

    const box = clear(document.getElementById('draftPreview'));
    lastDoc.sections.forEach((sec) => {
      const copy = h('button', { type: 'button', class: 'ghost small', text: '복사' });
      copy.addEventListener('click', () => copyText(DR.sectionText(sec), copy));
      box.append(h('section', { class: 'draft-sec' },
        h('div', { class: 'draft-sec-head' }, h('h3', { text: sec.title }), copy),
        sec.blocks.map(renderBlock)));
    });
  }

  function persistDraft() { store.set('pf.draft', draft); }

  function setFund(id) {
    const before = agencyOfFund(draft.fundId);
    draft.fundId = id;
    if (draft.isExample && agencyOfFund(id) !== before) draft.input = clone(DR.EXAMPLES[agencyOfFund(id)]);
    persistDraft();
    writeDraft();
    renderDraftPreview();
  }

  function startDraftFor(id) {
    if (dialog.open) dialog.close();
    setFund(id);
    showTab('draft');
  }

  buildFundSelect();
  dform.addEventListener('input', (e) => {
    if (e.target.dataset.k === 'fundId') { setFund(e.target.value); return; }
    readDraft();
    draft.isExample = false;
    document.getElementById('draftExample').hidden = true;
    document.getElementById('draftLoad').hidden = false;
    persistDraft();
    renderDraftPreview();
  });
  dform.addEventListener('submit', (e) => e.preventDefault());
  dform.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      readDraft();
      draft.input.plan.splice(Number(del.dataset.del), 1);
      if (!draft.input.plan.length) draft.input.plan.push({ kind: '운전', use: '', party: '', amount: '', when: '' });
      draft.isExample = false;
      persistDraft();
      writeDraft();
      renderDraftPreview();
    }
  });
  document.getElementById('planAdd').addEventListener('click', () => {
    readDraft();
    draft.input.plan.push({ kind: '운전', use: '', party: '', amount: '', when: '' });
    draft.isExample = false;
    persistDraft();
    renderRows();
    renderDraftPreview();
  });
  document.getElementById('draftClear').addEventListener('click', () => {
    draft.input = emptyInput();
    draft.isExample = false;
    persistDraft();
    writeDraft();
    renderDraftPreview();
  });
  document.getElementById('draftLoad').addEventListener('click', () => {
    draft.input = clone(DR.EXAMPLES[agencyOfFund(draft.fundId)]);
    draft.isExample = true;
    persistDraft();
    writeDraft();
    renderDraftPreview();
  });
  document.getElementById('draftCopyAll').addEventListener('click', (e) => copyText(DR.toText(lastDoc), e.currentTarget));
  document.getElementById('draftDownload').addEventListener('click', () => {
    const name = `사업계획서_초안_${(draft.input.company || '미입력').replace(/[\\/:*?"<>|\s]+/g, '_')}.doc`;
    const url = URL.createObjectURL(new Blob([DR.toWordHtml(lastDoc)], { type: 'application/msword' }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  /* ---------- 탭 ---------- */
  function showTab(name) {
    document.querySelectorAll('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    document.querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = p.id !== 'panel-' + name; });
    store.set('pf.tab', name);
  }
  document.querySelectorAll('[role="tab"]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  /* ---------- 이벤트 ---------- */
  form.addEventListener('input', () => {
    profile = readForm();
    usedExample = false;
    document.getElementById('exampleNote').hidden = true;
    store.set('pf.profile', profile);
    renderResults();
    renderDraftPreview();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('resetProfile').addEventListener('click', () => {
    profile = Object.assign({}, EXAMPLE, { flags: {} });
    usedExample = true;
    document.getElementById('exampleNote').hidden = false;
    store.set('pf.profile', null);
    writeForm();
    renderResults();
    renderDraftPreview();
  });
  [['fAgency', 'agency'], ['fMethod', 'method'], ['fUse', 'use'], ['fText', 'text']].forEach(([id, key]) => {
    document.getElementById(id).addEventListener('input', (e) => { filters[key] = e.target.value; renderList(); });
  });
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /* ---------- 시작 ---------- */
  writeForm();
  document.getElementById('exampleNote').hidden = !usedExample;
  renderResults();
  writeDraft();
  renderDraftPreview();
  renderList();
  renderDocsTab();
  renderSchedule();
  showTab(store.get('pf.tab', 'finder'));
})();
