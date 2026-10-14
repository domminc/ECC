/* Bootstrap: masthead, tab navigation, deep links (#list, #finder, #draft, #docs, #schedule or a fund id) and global keys. */
(function () {
  'use strict';

  const PF = window.PF;
  const { h, $, extLink } = PF;
  const data = PF.data;
  const VIEWS = ['list', 'finder', 'draft', 'docs', 'schedule'];
  let current = 'list';

  function setHash(token) {
    try {
      history.replaceState(null, '', '#' + token);
    } catch (_err) { /* the host frame may refuse history changes */ }
  }

  function show(view, opts) {
    if (!VIEWS.includes(view)) return;
    const o = opts || {};
    PF.sheet.close();
    current = view;
    VIEWS.forEach(v => {
      const tab = $('tab-' + v);
      const on = v === view;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      $('view-' + v).hidden = !on;
    });
    PF.store.set('view', view);
    // Both detail panes can show the same fund; redraw so a ticked document or a changed profile is reflected.
    if (view === 'list' && PF.listView) PF.listView.refreshDetail();
    if (view === 'finder' && PF.finderView) PF.finderView.refreshDetail();
    if (!o.silent) setHash(view);
    const activeTab = $('tab-' + view);
    if (activeTab.scrollIntoView) activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (o.scroll !== false) {
      const top = $('main').getBoundingClientRect().top + window.scrollY - (PF.wide.matches ? 0 : 49);
      if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
    }
  }

  PF.nav = {
    show,
    setHash,
    current: () => current,
    toDraft(fundId) {
      show('draft');
      PF.draftView.startFor(fundId);
    }
  };

  function routeFromHash(silent) {
    const token = decodeURIComponent(location.hash.slice(1));
    if (VIEWS.includes(token)) {
      show(token, { silent, scroll: false });
      return true;
    }
    if (PF.fundById(token)) {
      show('list', { silent: true, scroll: false });
      PF.listView.select(token, false);
      return true;
    }
    return false;
  }

  function bindTabs() {
    const tabs = VIEWS.map(v => $('tab-' + v));
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => show(tab.dataset.view));
      tab.addEventListener('keydown', e => {
        const move = { ArrowRight: 1, ArrowLeft: -1, Home: 'first', End: 'last' }[e.key];
        if (move === undefined) return;
        e.preventDefault();
        const next = move === 'first' ? 0 : move === 'last' ? tabs.length - 1 : (i + move + tabs.length) % tabs.length;
        tabs[next].focus();
        show(tabs[next].dataset.view);
      });
    });
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
    meta.changeNotices.forEach(n => $('sources').appendChild(h('li', {}, extLink(n.url, n.label) || n.label)));

    const foot = $('apply-links');
    foot.appendChild(document.createTextNode('신청 '));
    meta.applyUrls.forEach((a, i) => {
      if (i) foot.appendChild(document.createTextNode(' · '));
      foot.appendChild(extLink(a.url, a.label));
    });

    PF.listView.init();
    PF.finderView.init();
    PF.draftView.init();
    PF.docsView.init();
    bindTabs();

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') PF.sheet.close();
    });
    PF.wide.addEventListener('change', () => {
      if (PF.wide.matches) PF.sheet.close();
    });
    window.addEventListener('hashchange', () => routeFromHash(true));

    if (!routeFromHash(true)) show(VIEWS.includes(PF.store.get('view', 'list')) ? PF.store.get('view', 'list') : 'list', { silent: true, scroll: false });
  }

  init();
}());
