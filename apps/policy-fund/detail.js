/* Fund detail panel shared by the list and the finder: facts, diagnosis, documents checklist, downloads. */
(function () {
  'use strict';

  const PF = window.PF;
  const { h, extLink } = PF;
  const data = PF.data;
  const checks = PF.store.get('checks', {});

  /* ---------- small shared pieces ---------- */

  PF.badge = f => h('span', { class: 'badge ' + (f.agencyId === 'semas' ? 'badge--semas' : 'badge--kosmes'), text: f.agency });
  PF.flagged = f => Object.values(f.unconfirmed).filter(Boolean).length;

  PF.valueNode = function (text, unconfirmed) {
    return unconfirmed ? h('span', { class: 'unk', title: text, text: '확인 필요' }) : text;
  };

  PF.flagsFor = function (f) {
    return [
      f.changeMemo ? h('span', { class: 'flag flag--change', text: '변경' }) : null,
      PF.flagged(f) ? h('span', { class: 'flag flag--check', text: '확인 필요 ' + PF.flagged(f) }) : null,
      f.source === 'legacy' ? h('span', { class: 'flag flag--legacy', text: '이전 공고 기준' }) : null
    ];
  };

  PF.reasonList = reasons => h('ul', { class: 'why' }, reasons.map(x => h('li', {},
    h('b', { class: 'why-k ' + (x.ok === true ? 't' : x.ok === false ? 'f' : 'u'), text: x.ok === true ? '충족' : x.ok === false ? '미충족' : '확인' }),
    h('span', { text: x.label }))));

  function section(title, ...body) {
    return h('section', { class: 'sec' }, h('h3', { text: title }), body);
  }

  /* ---------- sheet (phone) ---------- */

  let openEl = null;
  let lastTrigger = null;
  PF.sheet = {
    open(el, trigger) {
      lastTrigger = trigger || null;
      openEl = el;
      el.classList.add('is-open');
      document.documentElement.classList.add('has-detail');
      const title = el.querySelector('h2');
      if (title) title.focus({ preventScroll: true });
    },
    close() {
      if (!openEl) return;
      openEl.classList.remove('is-open');
      openEl = null;
      document.documentElement.classList.remove('has-detail');
      if (lastTrigger && document.contains(lastTrigger)) lastTrigger.focus({ preventScroll: true });
    },
    isOpen: () => openEl !== null
  };

  /* ---------- procedure ---------- */

  function steps(f) {
    if (f.agencyId === 'kosmes') {
      return [
        '중진공 누리집에서 지역본·지부별 신청 일정과 신청 가능 자금 확인',
        '온라인 융자 신청: 정보제공 동의, 사전 기업진단, 기업정보 제출',
        '정책우선도 평가(사전평가)로 심사 기회 부여 여부 결정',
        '심사 기회를 받으면 정해진 기한까지 융자 필요서류를 온라인 제출',
        '기업평가: 현장방문 또는 비대면',
        '융자 결정: 지원 가능 여부와 금액',
        '대출(직접 또는 대리) 후 자금 사용 점검'
      ];
    }
    return f.methods[0] === '대리대출'
      ? [
        '소상공인정책자금 사이트에서 접수기간 확인',
        '대표자 본인인증 후 대리대출 확인서 신청: 자가진단, 신용정보 동의, 신청서, 서류',
        '확인서 발급 승인 후 90일 안에 출력',
        '취급 은행·신용보증재단 방문: 보증서 발급, 금융기관 대출 심사',
        '대출 실행'
      ]
      : [
        '소상공인정책자금 사이트에서 자금별 접수기간 확인 (직접대출은 단기간 접수가 많습니다)',
        '대표자 본인인증 후 업체·자금 선택, 약관 동의, 신청서 작성',
        '서류 제출: 사업계획서 웹폼과 "필수" 서류 업로드. 제출 마감일이 지나면 신청이 자동 취소됩니다',
        '소진공 심사: 기술성, 성장잠재력, 경영능력, 사업계획 타당성, 신용도',
        '대출 약정 체결 후 실행'
      ];
  }

  /* ---------- documents ---------- */

  function officialDocuments(f) {
    const guide = data.meta.documentGuides[f.agency];
    const guideLink = guide ? h('p', { class: 'note' }, '안내 ', extLink(guide.url, guide.label)) : null;
    if (f.documentGroups.length === 0) {
      return [
        h('div', { class: 'callout callout--check' },
          h('p', { class: 'callout-title', text: '공고 기준 전체 목록 미확인' }),
          h('p', { text: f.documentsNote || '공고문에 필요 서류 목록이 없습니다.' })),
        guideLink
      ];
    }
    return [
      f.documentGroups.map(g => h('div', { class: 'stage' },
        h('p', { class: 'stage-name', text: g.stage }),
        h('ul', { class: 'bullets' }, g.items.map(item => h('li', { text: item }))))),
      guideLink
    ];
  }

  const DOC_GROUPS = { A: '온라인 입력·동의', B: '준비해서 제출할 서류', C: '발급·확인 단계' };
  const tagFor = d => h('span', { class: 'tag tag--' + d.status, text: d.status === 'official' ? '공고·안내 명시' : '일반 요구' });

  function checkRow(f, id, scope, onChange) {
    const d = data.docs[id];
    const input = h('input', { type: 'checkbox', id: `chk-${scope}-${f.id}-${id}` });
    input.checked = !!(checks[f.id] && checks[f.id][id]);
    input.addEventListener('change', () => {
      checks[f.id] = Object.assign({}, checks[f.id], { [id]: input.checked });
      PF.store.set('checks', checks);
      onChange();
    });
    const extras = [];
    if (d.where) extras.push(extLink(d.where.url, d.where.label));
    return h('li', { class: 'check' },
      input,
      h('div', { class: 'check-body' },
        h('label', { for: input.id, class: 'check-name' }, h('span', { text: d.name }), tagFor(d)),
        h('p', { class: 'check-desc', text: d.desc }),
        extras.length || (d.forms && d.forms.length)
          ? h('div', { class: 'check-links' }, extras, (d.forms || []).map(fid => PF.formButtons(PF.formById(fid), true)))
          : null));
  }

  function csvFor(f) {
    const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [['자금', '서류', '구분', '준비 여부', '설명'].map(esc).join(',')];
    f.docs.forEach(id => {
      const d = data.docs[id];
      if (!d) return;
      lines.push([f.name, d.name, d.status === 'official' ? '공고·안내 명시' : '일반 요구', checks[f.id] && checks[f.id][id] ? '완료' : '미완료', d.desc].map(esc).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }
  PF.checklistCsv = csvFor;

  function checklist(f, scope) {
    const progress = h('p', { class: 'progress' });
    const update = () => {
      const done = f.docs.filter(id => checks[f.id] && checks[f.id][id]).length;
      progress.textContent = `서류 준비 ${done} / ${f.docs.length}`;
    };
    const groups = Object.keys(DOC_GROUPS).map(g => {
      const ids = f.docs.filter(id => data.docs[id] && data.docs[id].group === g);
      return ids.length
        ? h('div', { class: 'doc-set' }, h('p', { class: 'stage-name', text: DOC_GROUPS[g] }),
          h('ul', { class: 'checklist' }, ids.map(id => checkRow(f, id, scope, update))))
        : null;
    });
    update();
    return [
      h('p', { class: 'note', text: '"일반 요구" 서류는 자금·창구에 따라 달라질 수 있습니다. 신청 화면(또는 상담 후 안내)의 필수 표시가 최종 기준입니다.' }),
      progress,
      groups,
      h('div', { class: 'btn-row' },
        PF.fileButton({
          label: '체크리스트 CSV 내려받기',
          getFile: () => ({ filename: `${f.id}-checklist.csv`, data: csvFor(f) })
        }))
    ];
  }

  /* ---------- render ---------- */

  const STATUS_LABEL = { fit: '입력 기준 충족', check: '확인 필요', no: '해당 없음' };
  PF.STATUS_LABEL = STATUS_LABEL;

  /**
   * @param {HTMLElement} pane
   * @param {object|null} f
   * @param {{reasons?: object[], status?: string, backLabel?: string, emptyText?: string}} [opts]
   */
  PF.renderDetail = function (pane, f, opts) {
    const o = opts || {};
    PF.clear(pane);
    if (!f) {
      pane.appendChild(h('p', { class: 'note', text: o.emptyText || '목록에서 자금을 선택하면 조건, 필요 서류, 원문 링크를 볼 수 있습니다.' }));
      return;
    }
    const titleId = pane.id + '-title';
    pane.setAttribute('aria-labelledby', titleId);
    const apply = data.meta.applyUrls.find(a => a.agency === f.agency);
    const excluded = f.agencyId === 'kosmes' && !f.targets.includes('소상공인');

    pane.appendChild(h('div', { class: 'detail-bar' },
      h('button', { type: 'button', class: 'back', text: o.backLabel || '← 목록으로', onclick: () => PF.sheet.close() })));

    pane.appendChild(h('header', { class: 'detail-head' },
      h('p', { class: 'detail-meta' }, PF.badge(f), h('span', { text: f.group }), PF.flagsFor(f),
        o.status ? h('span', { class: 'status status--' + o.status, text: STATUS_LABEL[o.status] }) : null),
      h('h2', { id: titleId, tabindex: '-1', text: f.name }),
      h('p', { class: 'targets' }, f.targets.map(t => h('span', { class: 'target-chip', text: t })))));

    pane.appendChild(h('dl', { class: 'kpis' },
      h('div', { class: 'kpi' }, h('dt', { text: '한도' }), h('dd', {}, PF.valueNode(f.limit, f.unconfirmed.limit))),
      h('div', { class: 'kpi' }, h('dt', { text: '금리' }), h('dd', {}, PF.valueNode(f.rate, f.unconfirmed.rate))),
      h('div', { class: 'kpi' }, h('dt', { text: '기간(거치)' }), h('dd', {}, PF.valueNode(f.term, f.unconfirmed.term)))));

    if (f.basisNote) {
      pane.appendChild(h('div', { class: 'callout callout--legacy' }, h('p', { class: 'callout-title', text: '이전 공고 기준' }), h('p', { text: f.basisNote })));
    }
    f.conflicts.forEach(c => {
      pane.appendChild(h('div', { class: 'callout callout--check' },
        h('p', { class: 'callout-title', text: `${c.label} 값이 엇갈립니다` }),
        h('p', { text: c.text }),
        h('ul', { class: 'bullets' }, c.values.map(v => h('li', { text: `${v.source}: ${v.value}` })))));
    });
    if (f.changeMemo) {
      pane.appendChild(h('div', { class: 'callout callout--change' },
        h('p', { class: 'callout-title', text: '최초 공고 대비 변경' }),
        h('p', { text: f.changeMemo })));
    }

    if (o.reasons) {
      pane.appendChild(section('내 정보 기준 진단', PF.reasonList(o.reasons),
        h('p', { class: 'note', text: '입력값 기반의 1차 점검입니다. 예외 규정을 모두 반영하지 못하며 심사 결과를 보장하지 않습니다.' })));
    }

    pane.appendChild(section('신청 대상',
      h('p', { text: f.conditions }),
      excluded ? h('p', { class: 'note', text: '소상공인은 원칙적으로 융자제한 대상입니다. 제조업·혁신성장분야 영위 등은 예외입니다.' }) : null,
      f.legacyTargets.length
        ? h('details', { class: 'fold', open: f.source === 'legacy' },
          h('summary', { text: '요건 상세 (이전 정리본)' }),
          h('ul', { class: 'bullets' }, f.legacyTargets.map(t => h('li', { text: t }))))
        : null,
      f.notes.length
        ? h('details', { class: 'fold' }, h('summary', { text: `참고 ${f.notes.length}건` }), h('ul', { class: 'bullets' }, f.notes.map(t => h('li', { text: t }))))
        : null,
      h('dl', { class: 'meta-list' },
        h('dt', { text: '대출 방식' }), h('dd', { text: f.method }),
        f.uses.length ? h('dt', { text: '용도' }) : null, f.uses.length ? h('dd', { text: f.uses.join(' · ') }) : null)));

    pane.appendChild(section('신청 절차', h('ol', { class: 'steps' }, steps(f).map(s => h('li', { text: s })))));

    pane.appendChild(section('공고·안내 기준 서류', officialDocuments(f)));
    pane.appendChild(section('서류 준비 체크리스트', checklist(f, pane.id)));

    pane.appendChild(section('신청과 원문',
      h('div', { class: 'btn-row' },
        apply ? extLink(apply.url, apply.label, 'btn btn--primary') : null,
        extLink(f.pdfUrl, '공고문 원문 PDF', 'btn btn--secondary'),
        h('button', {
          type: 'button',
          class: 'btn btn--secondary',
          text: '이 자금으로 사업계획서 초안 작성',
          onclick: () => PF.nav.toDraft(f.id)
        })),
      f.formNote ? h('p', { class: 'note', text: f.formNote }) : null));

    pane.appendChild(section('출처',
      h('p', { class: 'src' }, f.baseNotice, ' ', f.pages ? h('span', { class: 'mono', text: f.pages }) : null, f.pages ? ' · ' : null, extLink(f.noticeUrl, '공고 원문 페이지'))));
  };
}());
