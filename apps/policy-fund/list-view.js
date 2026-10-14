/* 자금 목록: search, faceted filters with counts, result cards and the detail panel. */
(function () {
  'use strict';

  const PF = window.PF;
  const { h, $ } = PF;
  const data = PF.data;
  const state = { q: '', agency: '', target: '', group: '', basis: '', changed: false, selected: null };
  const optionRefs = {};

  const FACETS = [
    { key: 'agency', title: '기관', values: PF.uniq(data.funds.map(f => f.agency)), test: (f, v) => f.agency === v },
    { key: 'target', title: '대상', values: ['소상공인', '중소기업'], test: (f, v) => f.targets.includes(v) },
    { key: 'group', title: '자금군', values: PF.uniq(data.funds.map(f => f.group)), test: (f, v) => f.group === v },
    { key: 'basis', title: '자료 기준', values: PF.uniq(data.funds.map(f => f.basis)), test: (f, v) => f.basis === v }
  ];

  function matches(f, skip) {
    if (skip !== 'changed' && state.changed && !f.changeMemo) return false;
    for (const facet of FACETS) {
      if (facet.key !== skip && state[facet.key] && !facet.test(f, state[facet.key])) return false;
    }
    if (state.q) {
      const hay = [f.name, f.conditions, f.group, f.agency, f.summary].join(' ').toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  }

  const visibleFunds = () => data.funds.filter(f => matches(f));
  const activeFilterCount = () => FACETS.filter(x => state[x.key]).length + (state.changed ? 1 : 0);

  /* ---------- filters (built once, updated in place so focus is kept) ---------- */

  function option(label, pressed, onClick) {
    const n = h('span', { class: 'n' });
    const btn = h('button', { type: 'button', class: 'opt', 'aria-pressed': String(pressed) }, h('span', { text: label }), n);
    btn.addEventListener('click', onClick);
    return { btn, n };
  }

  function buildFilters() {
    FACETS.forEach(facet => {
      const box = $('facet-' + facet.key);
      const opts = h('div', { class: 'opts', role: 'group', 'aria-label': facet.title });
      optionRefs[facet.key] = [];
      ['', ...facet.values].forEach(value => {
        const o = option(value || '전체', false, () => {
          state[facet.key] = value;
          update();
        });
        optionRefs[facet.key].push({ value, ...o });
        opts.appendChild(o.btn);
      });
      box.appendChild(h('p', { class: 'facet-title', text: facet.title }));
      box.appendChild(opts);
    });

    const changedOpt = option('변경 있는 자금만', false, () => {
      state.changed = !state.changed;
      update();
    });
    optionRefs.changed = changedOpt;
    $('facet-changed').appendChild(h('p', { class: 'facet-title', text: '변경 사항' }));
    $('facet-changed').appendChild(h('div', { class: 'opts' }, changedOpt.btn));
  }

  function updateFilters() {
    FACETS.forEach(facet => {
      optionRefs[facet.key].forEach(o => {
        const n = data.funds.filter(f => matches(f, facet.key) && (!o.value || facet.test(f, o.value))).length;
        o.n.textContent = String(n);
        o.btn.setAttribute('aria-pressed', String(state[facet.key] === o.value));
        o.btn.disabled = n === 0 && state[facet.key] !== o.value;
      });
    });
    const changedN = data.funds.filter(f => matches(f, 'changed') && f.changeMemo).length;
    optionRefs.changed.n.textContent = String(changedN);
    optionRefs.changed.btn.setAttribute('aria-pressed', String(state.changed));
    optionRefs.changed.btn.disabled = changedN === 0 && !state.changed;

    const active = activeFilterCount();
    const badge = $('filter-badge');
    badge.hidden = active === 0;
    badge.textContent = String(active);
    $('reset').hidden = active === 0 && !state.q;
  }

  function resetFilters() {
    Object.assign(state, { q: '', agency: '', target: '', group: '', basis: '', changed: false });
    $('q').value = '';
    update();
  }

  /* ---------- result list ---------- */

  function fact(label, text, unconfirmed) {
    return h('span', { class: 'fact' }, h('span', { class: 'fact-k', text: label }), h('span', { class: 'fact-v' }, PF.valueNode(text, unconfirmed)));
  }

  PF.factRow = f => h('span', { class: 'facts' }, fact('한도', f.limit, f.unconfirmed.limit), fact('금리', f.rate, f.unconfirmed.rate));

  function card(f) {
    const btn = h('button', { type: 'button', class: 'card', 'data-id': f.id },
      h('span', { class: 'card-top' }, PF.badge(f), h('span', { class: 'group', text: f.group }), PF.flagsFor(f)),
      h('span', { class: 'card-title', text: f.name }),
      PF.factRow(f));
    btn.addEventListener('click', () => select(f.id, true, btn));
    return h('li', {}, btn);
  }

  function renderList() {
    const items = visibleFunds();
    const list = $('fund-list');
    list.textContent = '';
    items.forEach(f => list.appendChild(card(f)));
    const total = data.funds.length;
    $('count').textContent = items.length === total ? `총 ${total}건` : `${items.length}건 / 전체 ${total}건`;
    $('empty').hidden = items.length > 0;
    return items;
  }

  /* ---------- detail ---------- */

  function markCurrent() {
    document.querySelectorAll('#fund-list .card').forEach(c => {
      if (c.getAttribute('data-id') === state.selected) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
  }

  function select(id, userAction, trigger) {
    state.selected = id;
    const f = PF.fundById(id);
    markCurrent();
    PF.renderDetail($('detail'), f);
    $('detail').scrollTop = 0;
    if (f && userAction) PF.nav.setHash(id);
    if (userAction && !PF.wide.matches) PF.sheet.open($('detail'), trigger);
  }

  /* ---------- reconciliation memo ---------- */

  const RECON_LABEL = { conflict: '값 엇갈림', 'legacy-only': '이전 공고만', 'not-carried': '싣지 않음' };

  function renderRecon() {
    const list = data.reconciliation || [];
    $('recon').hidden = list.length === 0;
    $('recon-title').textContent = `자료 대조 메모 ${list.length}건`;
    const ul = $('recon-list');
    list.forEach(r => {
      const open = h('button', { type: 'button', class: 'link-btn', text: r.fundName });
      open.addEventListener('click', () => {
        resetFilters();
        select(r.fundId, true, open);
        const c = document.querySelector(`#fund-list .card[data-id="${r.fundId}"]`);
        if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
      });
      ul.appendChild(h('li', {},
        h('span', { class: 'recon-kind recon-kind--' + r.kind, text: RECON_LABEL[r.kind] || r.kind }),
        open,
        r.field ? h('span', { class: 'recon-field', text: ' · ' + r.field }) : null,
        h('p', { text: r.text }),
        r.values ? h('ul', { class: 'bullets' }, r.values.map(v => h('li', { text: `${v.source}: ${v.value}` }))) : null));
    });
  }

  /* ---------- wiring ---------- */

  function update() {
    const items = renderList();
    updateFilters();
    if (!items.some(f => f.id === state.selected)) {
      select(items.length ? items[0].id : null, false);
    } else {
      markCurrent();
    }
  }

  PF.listView = {
    init() {
      const meta = data.meta;
      $('notice-title').textContent = '유의사항 ' + meta.caveats.length + '건';
      meta.caveats.forEach(c => $('caveats').appendChild(h('li', { text: c })));
      renderRecon();
      buildFilters();
      $('q').addEventListener('input', e => {
        state.q = e.target.value.trim();
        update();
      });
      $('reset').addEventListener('click', resetFilters);
      $('empty-reset').addEventListener('click', resetFilters);
      $('filter-toggle').addEventListener('click', () => {
        const open = $('shell').getAttribute('data-filters') !== 'open';
        $('shell').setAttribute('data-filters', open ? 'open' : 'closed');
        $('filter-toggle').setAttribute('aria-expanded', String(open));
      });
      update();
    },
    select(id, userAction) {
      if (!PF.fundById(id)) return;
      select(id, userAction);
    },
    selected: () => state.selected,
    refreshDetail() {
      PF.renderDetail($('detail'), PF.fundById(state.selected));
    }
  };
}());
