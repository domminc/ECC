(function () {
  'use strict';

  const data = window.POLICY_FUND_DATA;
  const $ = id => document.getElementById(id);
  const wide = window.matchMedia('(min-width: 720px)');
  const state = { q: '', agency: '', target: '', group: '', changed: false, selected: null, detailOpen: false };

  let lastTrigger = null;
  const optionRefs = {};

  function h(tag, attrs, ...children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat(Infinity).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function extLink(url, label, cls) {
    if (!/^https:\/\//.test(url)) return null;
    return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: cls }, label, h('span', { class: 'ext', 'aria-hidden': 'true', text: '↗' }));
  }

  const uniq = list => list.filter((v, i) => list.indexOf(v) === i);
  const flagged = f => Object.values(f.unconfirmed).filter(Boolean).length;

  const FACETS = [
    { key: 'agency', title: '기관', values: uniq(data.funds.map(f => f.agency)), test: (f, v) => f.agency === v },
    { key: 'target', title: '대상', values: ['소상공인', '중소기업'], test: (f, v) => f.targets.includes(v) },
    { key: 'group', title: '자금군', values: uniq(data.funds.map(f => f.group)), test: (f, v) => f.group === v }
  ];

  function matches(f, skip) {
    if (skip !== 'changed' && state.changed && !f.changeMemo) return false;
    for (const facet of FACETS) {
      if (facet.key !== skip && state[facet.key] && !facet.test(f, state[facet.key])) return false;
    }
    if (state.q) {
      const hay = [f.name, f.conditions, f.group, f.agency].join(' ').toLowerCase();
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
    Object.assign(state, { q: '', agency: '', target: '', group: '', changed: false });
    $('q').value = '';
    update();
  }

  /* ---------- result list ---------- */

  function valueNode(text, unconfirmed) {
    return unconfirmed ? h('span', { class: 'unk', title: text, text: '확인 필요' }) : text;
  }

  function fact(label, text, unconfirmed) {
    return h('span', { class: 'fact' }, h('span', { class: 'fact-k', text: label }), h('span', { class: 'fact-v' }, valueNode(text, unconfirmed)));
  }

  const badge = f => h('span', { class: 'badge ' + (f.agency === '소진공' ? 'badge--semas' : 'badge--kosmes'), text: f.agency });

  function card(f) {
    const btn = h('button', { type: 'button', class: 'card', 'data-id': f.id },
      h('span', { class: 'card-top' },
        badge(f),
        h('span', { class: 'group', text: f.group }),
        f.changeMemo ? h('span', { class: 'flag flag--change', text: '변경' }) : null,
        flagged(f) ? h('span', { class: 'flag flag--check', text: '확인 필요 ' + flagged(f) }) : null),
      h('span', { class: 'card-title', text: f.name }),
      h('span', { class: 'facts' }, fact('한도', f.limit, f.unconfirmed.limit), fact('금리', f.rate, f.unconfirmed.rate)));
    btn.addEventListener('click', () => {
      lastTrigger = btn;
      select(f.id, true);
    });
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

  function section(title, ...body) {
    return h('section', { class: 'sec' }, h('h3', { text: title }), body);
  }

  function documentsBlock(f) {
    const guide = data.meta.documentGuides[f.agency];
    const guideLink = guide ? h('p', { class: 'note' }, '안내 ', extLink(guide.url, guide.label)) : null;
    if (f.documentGroups.length === 0) {
      return [
        h('div', { class: 'callout callout--check' },
          h('p', { class: 'callout-title', text: '전체 목록 미확인' }),
          h('p', { text: f.documentsNote })),
        guideLink
      ];
    }
    return [
      f.documentGroups.map(g => h('div', { class: 'stage' },
        h('p', { class: 'stage-name', text: g.stage }),
        h('ul', { class: 'checklist' }, g.items.map(item => h('li', { text: item }))))),
      guideLink
    ];
  }

  function renderDetail(f) {
    const pane = $('detail');
    pane.textContent = '';
    if (!f) {
      pane.appendChild(h('p', { class: 'note', text: '목록에서 자금을 선택하면 조건, 필요 서류, 원문 링크를 볼 수 있습니다.' }));
      return;
    }
    const apply = data.meta.applyUrls.find(a => a.agency === f.agency);
    const excluded = f.agency === '중진공' && !f.targets.includes('소상공인');

    pane.appendChild(h('div', { class: 'detail-bar' }, (() => {
      const back = h('button', { type: 'button', class: 'back', text: '← 목록으로' });
      back.addEventListener('click', closeDetail);
      return back;
    })()));

    pane.appendChild(h('header', { class: 'detail-head' },
      h('p', { class: 'detail-meta' }, badge(f), h('span', { text: f.group })),
      h('h2', { id: 'detail-title', tabindex: '-1', text: f.name }),
      h('p', { class: 'targets' }, f.targets.map(t => h('span', { class: 'target-chip', text: t })))));

    pane.appendChild(h('dl', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('dt', { text: '한도' }), h('dd', {}, valueNode(f.limit, f.unconfirmed.limit))),
      h('div', { class: 'kpi' }, h('dt', { text: '금리' }), h('dd', {}, valueNode(f.rate, f.unconfirmed.rate))),
      h('div', { class: 'kpi' }, h('dt', { text: '기간(거치)' }), h('dd', {}, valueNode(f.term, f.unconfirmed.term)))));

    if (f.changeMemo) {
      pane.appendChild(h('div', { class: 'callout callout--change' },
        h('p', { class: 'callout-title', text: '최초 공고 대비 변경' }),
        h('p', { text: f.changeMemo })));
    }

    pane.appendChild(section('신청 대상',
      h('p', { text: f.conditions }),
      excluded ? h('p', { class: 'note', text: '소상공인은 원칙적으로 융자제한 대상입니다. 제조업·혁신성장분야 영위 등은 예외입니다.' }) : null,
      h('dl', { class: 'meta-list' }, h('dt', { text: '대출 방식' }), h('dd', { text: f.method }))));

    pane.appendChild(section('필요 서류', documentsBlock(f)));

    pane.appendChild(section('신청과 서식',
      h('div', { class: 'btn-row' },
        apply ? extLink(apply.url, apply.label, 'btn btn--primary') : null,
        extLink(f.pdfUrl, '공고문 원문 PDF', 'btn btn--secondary')),
      h('p', { class: 'note', text: f.formNote })));

    pane.appendChild(section('출처',
      h('p', { class: 'src' }, f.baseNotice, ' ', h('span', { class: 'mono', text: f.pages }), ' · ', extLink(f.noticeUrl, '공고 원문 페이지'))));
  }

  function select(id, userAction) {
    state.selected = id;
    const f = data.funds.find(x => x.id === id) || null;
    document.querySelectorAll('.card').forEach(c => {
      if (c.getAttribute('data-id') === id) c.setAttribute('aria-current', 'true');
      else c.removeAttribute('aria-current');
    });
    renderDetail(f);
    $('detail').scrollTop = 0;
    try {
      if (f && userAction) history.replaceState(null, '', '#' + id);
    } catch (_err) { /* the host frame may refuse history changes */ }
    if (userAction && !wide.matches) openDetail();
  }

  function openDetail() {
    state.detailOpen = true;
    $('detail').classList.add('is-open');
    document.documentElement.classList.add('has-detail');
    const title = $('detail-title');
    if (title) title.focus({ preventScroll: true });
  }

  function closeDetail() {
    if (!state.detailOpen) return;
    state.detailOpen = false;
    $('detail').classList.remove('is-open');
    document.documentElement.classList.remove('has-detail');
    if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus({ preventScroll: true });
  }

  /* ---------- wiring ---------- */

  function update() {
    const items = renderList();
    updateFilters();
    if (!items.some(f => f.id === state.selected)) {
      select(items.length ? items[0].id : null, false);
    } else {
      document.querySelectorAll('.card').forEach(c => {
        if (c.getAttribute('data-id') === state.selected) c.setAttribute('aria-current', 'true');
      });
    }
  }

  function init() {
    if (!data || !data.funds) {
      $('count').textContent = '데이터를 불러오지 못했습니다.';
      return;
    }
    const meta = data.meta;
    document.title = meta.title;
    $('page-title').textContent = meta.title;
    $('as-of').textContent = meta.asOf.replace(/-/g, '.') + ' 기준';
    $('basis').textContent = meta.basis;
    $('notice-title').textContent = '유의사항 ' + meta.caveats.length + '건';
    meta.caveats.forEach(c => $('caveats').appendChild(h('li', { text: c })));
    meta.changeNotices.forEach(n => $('sources').appendChild(h('li', {}, extLink(n.url, n.label) || n.label)));

    const foot = $('apply-links');
    foot.appendChild(document.createTextNode('신청 '));
    meta.applyUrls.forEach((a, i) => {
      if (i) foot.appendChild(document.createTextNode(' · '));
      foot.appendChild(extLink(a.url, a.label));
    });

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
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeDetail();
    });
    wide.addEventListener('change', () => {
      if (wide.matches) closeDetail();
    });

    update();
    const fromHash = location.hash.slice(1);
    if (data.funds.some(f => f.id === fromHash)) select(fromHash, false);
  }

  init();
})();
