(function () {
  'use strict';

  var data = window.POLICY_FUND_DATA;
  var state = { q: '', agency: '', target: '', group: '', selected: null };
  var el = function (id) { return document.getElementById(id); };

  function node(tag, props, children) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'text') n.textContent = props[k];
      else if (k === 'class') n.className = props[k];
      else n.setAttribute(k, props[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function safeLink(url, label, cls) {
    if (!/^https:\/\//.test(url)) return null;
    return node('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: cls || '', text: label });
  }

  function add(parent, child) {
    if (child) parent.appendChild(child);
  }

  function uniq(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }

  function matches(f) {
    if (state.agency && f.agency !== state.agency) return false;
    if (state.target && f.targets.indexOf(state.target) < 0) return false;
    if (state.group && f.group !== state.group) return false;
    if (state.q) {
      var hay = (f.name + ' ' + f.conditions + ' ' + f.group).toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
    }
    return true;
  }

  function renderChips(containerId, values, key) {
    var box = el(containerId);
    box.textContent = '';
    ['전체'].concat(values).forEach(function (v) {
      var value = v === '전체' ? '' : v;
      var b = node('button', { type: 'button', class: 'chip', text: v });
      b.setAttribute('aria-pressed', String(state[key] === value));
      b.addEventListener('click', function () {
        state[key] = value;
        renderChips(containerId, values, key);
        renderList();
      });
      box.appendChild(b);
    });
  }

  function valueNode(text, unconfirmed) {
    if (!unconfirmed) return document.createTextNode(text);
    return node('span', { class: 'tag warn', text: '공고문 확인 필요' });
  }

  function renderList() {
    var list = el('fund-list');
    var items = data.funds.filter(matches);
    list.textContent = '';
    items.forEach(function (f) {
      var btn = node('button', { type: 'button', class: 'fund-card' }, [
        node('span', { class: 'name', text: f.name }),
        node('span', { class: 'meta' }, [
          node('span', { class: 'tag', text: f.agency }),
          node('span', { text: f.group }),
          node('span', {}, [document.createTextNode('한도 '), valueNode(f.limit, f.unconfirmed.limit)]),
          node('span', {}, [document.createTextNode('금리 '), valueNode(f.rate, f.unconfirmed.rate)])
        ])
      ]);
      if (state.selected === f.id) btn.setAttribute('aria-current', 'true');
      btn.addEventListener('click', function () { state.selected = f.id; renderList(); renderDetail(f); });
      list.appendChild(node('li', {}, [btn]));
    });
    el('count').textContent = '총 ' + items.length + '건 (전체 ' + data.funds.length + '건)';
    el('empty').hidden = items.length > 0;
  }

  function row(dl, label, content) {
    dl.appendChild(node('dt', { text: label }));
    dl.appendChild(node('dd', {}, [content]));
  }

  function renderDetail(f) {
    var pane = el('detail');
    pane.textContent = '';
    var dl = node('dl');
    row(dl, '대상', document.createTextNode(f.targets.join(', ') + (f.agency === '중진공' && f.targets.indexOf('소상공인') < 0 ? ' (소상공인은 원칙적으로 제외)' : '')));
    row(dl, '한도', valueNode(f.limit, f.unconfirmed.limit));
    row(dl, '금리', valueNode(f.rate, f.unconfirmed.rate));
    row(dl, '대출기간(거치)', valueNode(f.term, f.unconfirmed.term));
    row(dl, '방식', document.createTextNode(f.method));

    var docs = node('div');
    if (f.documents.length) {
      var ul = node('ul');
      f.documents.forEach(function (d) { ul.appendChild(node('li', { text: d })); });
      docs.appendChild(ul);
    } else {
      docs.appendChild(node('span', { class: 'tag warn', text: '공고문 확인 필요' }));
    }
    if (f.documentsNote) docs.appendChild(node('p', { class: 'muted', text: f.documentsNote }));

    var forms = node('div', { class: 'btn-row' });
    f.forms.forEach(function (form) { add(forms, safeLink(form.url, form.label, 'btn')); });
    add(forms, safeLink(f.pdfUrl, '공고문 원문 PDF 내려받기', 'btn'));
    var formNote = f.forms.length ? null : node('p', { class: 'muted', text: '공식 서류 양식·샘플 링크는 아직 확인되지 않았습니다. 공고문과 기관 안내를 확인하세요.' });

    pane.appendChild(node('span', { class: 'tag', text: f.agencyFull + ' · ' + f.group }));
    pane.appendChild(node('h2', { text: f.name }));
    pane.appendChild(dl);
    pane.appendChild(node('h3', { text: '신청 조건' }));
    pane.appendChild(node('p', { text: f.conditions }));
    pane.appendChild(node('h3', { text: '필요 서류' }));
    pane.appendChild(docs);
    pane.appendChild(node('h3', { text: '서류 양식·샘플 내려받기' }));
    pane.appendChild(forms);
    add(pane, formNote);
    pane.appendChild(node('h3', { text: '출처' }));
    pane.appendChild(node('p', {}, [
      document.createTextNode('공고문 ' + f.pages + ' · '),
      safeLink(f.noticeUrl, '기업마당 공고 원문')
    ]));
    if (window.matchMedia('(max-width: 800px)').matches) pane.scrollIntoView({ behavior: 'smooth' });
  }

  function init() {
    if (!data || !data.funds) {
      el('count').textContent = '데이터를 불러오지 못했습니다.';
      return;
    }
    document.title = data.meta.title;
    el('page-title').textContent = data.meta.title;
    el('as-of').textContent = '기준일 ' + data.meta.asOf + ' · ' + data.meta.basis;
    data.meta.caveats.forEach(function (c) { el('caveats').appendChild(node('li', { text: c })); });

    var foot = el('apply-links');
    foot.appendChild(document.createTextNode('신청: '));
    data.meta.applyUrls.forEach(function (a, i) {
      if (i) foot.appendChild(document.createTextNode(' · '));
      add(foot, safeLink(a.url, a.label));
    });

    renderChips('agency-chips', uniq(data.funds.map(function (f) { return f.agency; })), 'agency');
    renderChips('target-chips', ['소상공인', '중소기업'], 'target');

    var sel = el('group');
    sel.appendChild(node('option', { value: '', text: '전체' }));
    uniq(data.funds.map(function (f) { return f.group; })).forEach(function (g) {
      sel.appendChild(node('option', { value: g, text: g }));
    });
    sel.addEventListener('change', function () { state.group = sel.value; renderList(); });
    el('q').addEventListener('input', function (e) { state.q = e.target.value.trim(); renderList(); });

    renderList();
  }

  init();
})();
