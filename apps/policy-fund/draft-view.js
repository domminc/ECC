/* 사업계획서 초안: entered facts -> template for the chosen fund -> preview, copy per section, .docx download. */
(function () {
  'use strict';

  const PF = window.PF;
  const { h, $ } = PF;
  const data = PF.data;
  const DR = window.PF_DRAFT;
  const DX = window.PF_DOCX;

  const clone = o => JSON.parse(JSON.stringify(o));
  const blankPlanRow = () => ({ kind: '운전', use: '', party: '', amount: '', when: '' });
  const agencyOf = id => (PF.fundById(id) ? PF.fundById(id).agencyId : 'semas');
  const NEED_LABEL = { working: '운전자금', facility: '시설자금', both: '시설·운전자금' };

  let dform = null;
  let draft = null;
  let lastDoc = null;

  function emptyInput() {
    return {
      company: '', ceo: '', openDate: '', industryName: '', address: '', mainBiz: '',
      sales: [0, 1, 2].map(() => ({ year: '', amount: '', profit: '', debt: '' })),
      products: '', customers: '', strengths: '', changes: '', careers: '', tech: '', market: '', hiring: '',
      applyAmount: '', plan: [blankPlanRow()], repay: ''
    };
  }

  function buildFundSelect() {
    const sel = PF.clear($('d-fund'));
    [['소진공', '소상공인'], ['중진공', '중소기업']].forEach(([short, audience]) => {
      const group = h('optgroup', { label: `${short} (${audience})` });
      data.funds.filter(f => f.agency === short).forEach(f => group.appendChild(h('option', { value: f.id, text: f.name })));
      sel.appendChild(group);
    });
  }

  const inp = attrs => h('input', Object.assign({ type: 'text' }, attrs));

  function renderRows() {
    const wide = agencyOf(draft.fundId) === 'kosmes';
    const sales = PF.clear($('sales-rows'));
    draft.input.sales.forEach((r, i) => {
      const row = h('div', { class: 'row-sales' + (wide ? ' row-sales--wide' : '') },
        inp({ 'data-s': 'year', 'data-i': i, value: r.year, placeholder: '연도', 'aria-label': `${i + 1}번째 연도` }),
        inp({ 'data-s': 'amount', 'data-i': i, value: r.amount, placeholder: '매출액(원)', inputmode: 'numeric', 'aria-label': `${i + 1}번째 매출액` }));
      if (wide) {
        row.appendChild(inp({ 'data-s': 'profit', 'data-i': i, value: r.profit, placeholder: '영업이익(원)', inputmode: 'numeric', 'aria-label': `${i + 1}번째 영업이익` }));
        row.appendChild(inp({ 'data-s': 'debt', 'data-i': i, value: r.debt, placeholder: '부채비율(%)', inputmode: 'numeric', 'aria-label': `${i + 1}번째 부채비율` }));
      }
      sales.appendChild(row);
    });
    const plan = PF.clear($('plan-rows'));
    draft.input.plan.forEach((r, i) => {
      const kind = h('select', { 'data-p': 'kind', 'data-i': i, 'aria-label': `${i + 1}번째 구분` },
        h('option', { value: '운전', text: '운전' }), h('option', { value: '시설', text: '시설' }));
      kind.value = r.kind === '시설' ? '시설' : '운전';
      plan.appendChild(h('div', { class: 'row-plan' },
        kind,
        inp({ 'data-p': 'use', 'data-i': i, value: r.use, placeholder: '세부 용도', 'aria-label': `${i + 1}번째 용도` }),
        inp({ 'data-p': 'amount', 'data-i': i, value: r.amount, placeholder: '금액(원)', inputmode: 'numeric', 'aria-label': `${i + 1}번째 금액` }),
        h('div', { class: 'row-plan-more' },
          inp({ 'data-p': 'party', 'data-i': i, value: r.party, placeholder: '거래처·내용', 'aria-label': `${i + 1}번째 거래처` }),
          inp({ 'data-p': 'when', 'data-i': i, value: r.when, placeholder: '집행 시기', 'aria-label': `${i + 1}번째 집행 시기` }),
          h('button', { type: 'button', class: 'link-btn', 'data-del': i, 'aria-label': `${i + 1}번째 행 삭제`, text: '삭제' }))));
    });
  }

  function toggleAgencyFields() {
    const ag = agencyOf(draft.fundId);
    dform.querySelectorAll('[data-agency]').forEach(el => { el.hidden = el.dataset.agency !== ag; });
  }

  function writeDraft() {
    dform.querySelectorAll('[data-k]').forEach(el => {
      const k = el.dataset.k;
      el.value = k === 'fundId' ? draft.fundId : (draft.input[k] === undefined || draft.input[k] === null ? '' : draft.input[k]);
    });
    renderRows();
    toggleAgencyFields();
    $('draft-example').hidden = !draft.isExample;
    $('draft-load').hidden = draft.isExample;
  }

  function readDraft() {
    dform.querySelectorAll('[data-k]').forEach(el => {
      if (el.dataset.k === 'fundId') draft.fundId = el.value;
      else draft.input[el.dataset.k] = el.value;
    });
    dform.querySelectorAll('[data-s]').forEach(el => { draft.input.sales[Number(el.dataset.i)][el.dataset.s] = el.value; });
    dform.querySelectorAll('[data-p]').forEach(el => { draft.input.plan[Number(el.dataset.i)][el.dataset.p] = el.value; });
  }

  const persist = () => PF.store.set('draft', draft);

  /* ---------- preview ---------- */

  const isMissing = t => String(t).includes('【작성 필요');
  const cellNode = (tag, text) => h(tag, {}, isMissing(text) ? h('span', { class: 'missing', text }) : text);

  function renderBlock(b) {
    if (b.type === 'h') return h('p', { class: 'doc-h', text: b.text });
    if (b.type === 'p') return h('p', { class: b.auto ? 'auto' : '' }, isMissing(b.text) ? h('span', { class: 'missing', text: b.text }) : b.text);
    if (b.type === 'kv') {
      return h('div', { class: 'tw' }, h('table', { class: 'kv' }, h('tbody', {}, b.rows.map(r => h('tr', {}, h('th', { scope: 'row', text: r[0] }), cellNode('td', r[1]))))));
    }
    return h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, b.header.map(x => h('th', { text: x })))),
      h('tbody', {}, b.rows.map(r => h('tr', {}, r.map(c => cellNode('td', c)))))));
  }

  function renderPreview() {
    const fund = PF.fundById(draft.fundId);
    const profile = PF.profile.get();
    const note = PF.clear($('d-profile-note'));
    note.appendChild(document.createTextNode(`내 정보에서 가져옴: ${DR.INDUSTRY_LABEL[profile.industry]} · 상시근로자 ${profile.employees}명 · 업력 ${profile.years}년 · ${NEED_LABEL[profile.need]}${profile.salesDrop !== 'none' ? ' · 매출 감소' : ''} `));
    note.appendChild(h('button', { type: 'button', class: 'link-btn', text: '수정', onclick: () => PF.nav.show('finder') }));

    lastDoc = DR.build(draft.input, fund, profile);
    const issues = PF.clear($('draft-issues'));
    lastDoc.issues.forEach(i => issues.appendChild(h('li', { text: i.msg })));
    if (!lastDoc.issues.length && lastDoc.missing === 0) {
      issues.appendChild(h('li', { class: 'ok', text: '점검 항목이 없습니다. 제출 전에 공고의 최신 요건과 함께 한 번 더 확인하세요.' }));
    }
    $('draft-missing').textContent = lastDoc.missing ? `작성 필요 ${lastDoc.missing}곳` : '모든 항목 입력됨';
    const badge = $('draft-missing-badge');
    badge.hidden = !lastDoc.missing;
    badge.textContent = String(lastDoc.missing);

    const t = DR.planTotals(draft.input.plan);
    const apply = DR.num(draft.input.applyAmount);
    $('d-plan-sum').textContent = `집행계획 합계 ${DR.won(t.total) || '0원'}`
      + (Number.isFinite(apply) ? (t.total === apply ? ' · 신청금액과 일치' : ` · 신청금액과 ${DR.won(Math.abs(apply - t.total))} 차이`) : ' · 신청 금액을 입력하세요');

    const box = PF.clear($('draft-preview'));
    lastDoc.sections.forEach(sec => {
      const copy = h('button', { type: 'button', class: 'link-btn', text: '복사' });
      copy.addEventListener('click', () => PF.copyText(DR.sectionText(sec), copy));
      box.appendChild(h('section', { class: 'draft-sec' },
        h('div', { class: 'draft-sec-head' }, h('h3', { text: sec.title }), copy),
        sec.blocks.map(renderBlock)));
    });
  }

  /* ---------- actions ---------- */

  function buildActions() {
    const box = $('draft-actions');
    box.appendChild(PF.fileButton({
      label: 'Word 문서(.docx)로 내려받기',
      className: 'btn btn--primary',
      getFile: () => ({
        filename: `사업계획서_초안_${(draft.input.company || '미입력').replace(/[\\/:*?"<>|\s]+/g, '_')}.docx`,
        data: DX.buildDocx(lastDoc)
      })
    }));
    const copyAll = h('button', { type: 'button', class: 'btn btn--secondary', text: '전체 텍스트 복사' });
    copyAll.addEventListener('click', () => PF.copyText(DR.toText(lastDoc), copyAll));
    box.appendChild(copyAll);
  }

  function setFund(id) {
    const before = agencyOf(draft.fundId);
    draft.fundId = id;
    if (draft.isExample && agencyOf(id) !== before) draft.input = clone(DR.EXAMPLES[agencyOf(id)]);
    persist();
    writeDraft();
    renderPreview();
  }

  function setPane(name) {
    $('draft').setAttribute('data-pane', name);
    document.querySelectorAll('[data-pane-btn]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.paneBtn === name)));
  }

  PF.draftView = {
    init() {
      dform = $('draft-form');
      const savedDraft = PF.store.get('draft', null);
      draft = savedDraft && PF.fundById(savedDraft.fundId) && savedDraft.input
        ? savedDraft
        : { fundId: PF.finderView.defaultFundId(), isExample: true, input: null };
      if (!draft.input) draft.input = clone(DR.EXAMPLES[agencyOf(draft.fundId)]);

      $('draft-disclaimer').textContent = data.meta.disclaimer;
      buildFundSelect();
      buildActions();
      writeDraft();
      renderPreview();

      dform.addEventListener('input', e => {
        if (e.target.dataset.k === 'fundId') {
          setFund(e.target.value);
          return;
        }
        readDraft();
        draft.isExample = false;
        $('draft-example').hidden = true;
        $('draft-load').hidden = false;
        persist();
        renderPreview();
      });
      dform.addEventListener('submit', e => e.preventDefault());
      dform.addEventListener('click', e => {
        const del = e.target.closest('[data-del]');
        if (!del) return;
        readDraft();
        draft.input.plan.splice(Number(del.dataset.del), 1);
        if (!draft.input.plan.length) draft.input.plan.push(blankPlanRow());
        draft.isExample = false;
        persist();
        writeDraft();
        renderPreview();
      });
      $('plan-add').addEventListener('click', () => {
        readDraft();
        draft.input.plan.push(blankPlanRow());
        draft.isExample = false;
        persist();
        renderRows();
        renderPreview();
      });
      $('draft-clear').addEventListener('click', () => {
        draft.input = emptyInput();
        draft.isExample = false;
        persist();
        writeDraft();
        renderPreview();
      });
      $('draft-load').addEventListener('click', () => {
        draft.input = clone(DR.EXAMPLES[agencyOf(draft.fundId)]);
        draft.isExample = true;
        persist();
        writeDraft();
        renderPreview();
      });
      document.querySelectorAll('[data-pane-btn]').forEach(b => b.addEventListener('click', () => setPane(b.dataset.paneBtn)));
      PF.profile.onChange(renderPreview);
    },
    startFor(id) {
      setFund(id);
      setPane('form');
    }
  };
}());
