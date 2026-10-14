/* 서류·양식 and 일정·문의: prepared forms, documents overview, application schedule, contacts. */
(function () {
  'use strict';

  const PF = window.PF;
  const { h, $, extLink } = PF;
  const data = PF.data;

  const DOC_GROUPS = { A: '온라인 입력·동의', B: '준비해서 제출할 서류', C: '발급·확인 단계' };

  function renderForms() {
    $('docs-disclaimer').textContent = data.meta.disclaimer;
    const grid = PF.clear($('forms-grid'));
    data.forms.forEach(fm => grid.appendChild(h('article', { class: 'form-card' },
      h('h3', { text: fm.title }),
      h('p', { text: fm.desc }),
      h('div', { class: 'btn-row' }, PF.formButtons(fm, false)))));

    const box = PF.clear($('doc-groups'));
    Object.keys(DOC_GROUPS).forEach(g => {
      const entries = Object.entries(data.docs).filter(([, d]) => d.group === g);
      box.appendChild(h('div', { class: 'doc-group' },
        h('h3', { text: DOC_GROUPS[g] }),
        h('ul', { class: 'docs' }, entries.map(([, d]) => h('li', { class: 'doc' },
          h('div', { class: 'doc-title' }, h('span', { text: d.name }), h('span', { class: 'tag tag--' + d.status, text: d.status === 'official' ? '공고·안내 명시' : '일반 요구' })),
          h('p', { text: d.desc }),
          d.where ? h('p', { class: 'doc-where' }, '발급처 ', extLink(d.where.url, d.where.label)) : null)))));
    });

    PF.save.ready.then(() => {
      const note = $('save-note');
      if (PF.save.mode() === 'none') {
        note.hidden = false;
        note.textContent = '이 화면에서는 파일 저장이 허용되지 않아 내려받기가 동작하지 않을 수 있습니다. 저장소의 apps/policy-fund/forms 폴더에서 같은 파일을 받을 수 있습니다.';
      }
    });
  }

  /* ---------- schedule ---------- */

  const DAY = 24 * 60 * 60 * 1000;
  const dayNumber = iso => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);

  function periodEnd(period) {
    const m = period.match(/~\s*(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }

  function renderSchedule() {
    const s = data.schedule;
    const today = PF.today();
    const age = dayNumber(today) - dayNumber(s.asOf);
    $('schedule-sub').textContent = `소상공인정책자금 사이트 첫 화면 기준, ${s.asOf} 확인${age > 0 ? ` (오늘로부터 ${age}일 전)` : ''}. 직접대출은 짧은 기간만 열리는 자금이 많으니 사이트에서 다시 확인하세요.`;
    const tb = PF.clear(document.querySelector('#schedule-table tbody'));
    s.items.forEach(i => {
      const end = periodEnd(i.period);
      const over = end && end < today;
      tb.appendChild(h('tr', {},
        h('td', { 'data-label': '구분', text: i.type }),
        h('td', { 'data-label': '자금', text: i.name }),
        h('td', { 'data-label': '접수기간' }, i.period, over ? h('span', { class: 'flag flag--check', text: '기간 지남' }) : null)));
    });

    const c = PF.clear($('contact-list'));
    data.contacts.forEach(x => c.appendChild(h('li', {}, h('strong', { text: x.name }), h('b', { class: 'tel', text: x.tel }), h('span', { text: x.note }))));
    const l = PF.clear($('link-list'));
    data.links.forEach(x => l.appendChild(h('li', {}, extLink(x.url, x.name), h('span', { text: x.note }))));
  }

  PF.docsView = {
    init() {
      renderForms();
      renderSchedule();
      $('foot-disclaimer').textContent = data.meta.disclaimer;
    }
  };
}());
