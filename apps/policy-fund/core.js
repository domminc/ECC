/* Shared helpers: DOM builder, storage, links, clipboard and file saving. Everything else hangs off window.PF. */
(function () {
  'use strict';

  const PF = (window.PF = window.PF || {});
  PF.data = window.POLICY_FUND_DATA;
  PF.$ = id => document.getElementById(id);
  PF.wide = window.matchMedia('(min-width: 720px)');

  function h(tag, attrs, ...children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = true;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    children.flat(Infinity).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  PF.h = h;
  PF.clear = el => {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  };
  PF.uniq = list => list.filter((v, i) => list.indexOf(v) === i);
  PF.extLink = function (url, label, cls) {
    if (!/^https:\/\//.test(url || '')) return null;
    return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: cls }, label, h('span', { class: 'ext', 'aria-hidden': 'true', text: '\u2197' }));
  };

  /* Per-viewer convenience storage. Always optional: a blocked or throwing store must not break the page. */
  PF.store = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem('pfund.' + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        if (value === null) window.localStorage.removeItem('pfund.' + key);
        else window.localStorage.setItem('pfund.' + key, JSON.stringify(value));
      } catch (_err) { /* storage unavailable */ }
    }
  };

  PF.today = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  PF.copyText = function (text, btn) {
    const original = btn.textContent;
    const done = msg => {
      btn.textContent = msg;
      setTimeout(() => { btn.textContent = original; }, 1500);
    };
    const fallback = () => {
      const ta = h('textarea', { style: 'position:fixed;opacity:0;top:0', 'aria-hidden': 'true', tabindex: '-1' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done('복사됨');
      } catch (_err) {
        done('직접 선택해 복사하세요');
      }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done('복사됨'), fallback);
    else fallback();
  };

  /*
   * File saving. On a normal page a download link works. Inside the Claude artifact viewer plain download links are
   * blocked, so the viewer's "downloads" capability is used instead (it asks the viewer to confirm each save).
   * mode: 'anchor' = normal page, 'claude' = viewer capability granted, 'none' = viewer without file saving.
   */
  const framed = typeof window.claude === 'object' && window.claude !== null && typeof window.claude.use === 'function';
  let mode = 'anchor';
  let cap = null;
  const ready = framed
    ? Promise.resolve()
      .then(() => window.claude.use('downloads'))
      .then(c => {
        cap = c;
        mode = c ? 'claude' : 'none';
      }, () => { mode = 'none'; })
    : Promise.resolve();

  function embeddedBytes(path) {
    const b64 = window.PF_FORM_FILES && window.PF_FORM_FILES[path];
    if (!b64) return null;
    const bin = window.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function anchorSave(filename, href) {
    const a = h('a', { href, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** @param {{filename: string, data?: string|Uint8Array|Blob, href?: string}} file */
  async function saveFile(file) {
    await ready;
    if (mode === 'none') return 'unavailable';
    try {
      if (mode === 'claude') {
        const data = file.data !== undefined ? file.data : embeddedBytes(file.href);
        if (data === null || data === undefined) return 'unavailable';
        await cap.save({ filename: file.filename, data });
        return 'saved';
      }
      if (file.data === undefined && file.href) {
        anchorSave(file.filename, file.href);
        return 'started';
      }
      const blob = file.data instanceof Blob ? file.data : new Blob([file.data]);
      const url = URL.createObjectURL(blob);
      anchorSave(file.filename, url);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return 'started';
    } catch (err) {
      const code = err && err.code;
      if (code === 'declined') return 'declined';
      if (code === 'rate_limited') return 'busy';
      return 'unavailable';
    }
  }
  PF.save = { file: saveFile, ready, mode: () => mode };

  const SAVE_MSG = {
    saved: '저장했습니다.',
    started: '내려받기를 시작했습니다.',
    declined: '저장을 취소했습니다.',
    busy: '다른 저장 확인이 열려 있습니다. 잠시 후 다시 눌러 주세요.',
    unavailable: '이 화면에서는 파일을 저장할 수 없습니다. 전체 텍스트 복사나 저장소의 apps/policy-fund 폴더를 이용하세요.'
  };

  /** A button that saves a file and reports the outcome next to itself. `getFile` may build the file lazily. */
  PF.fileButton = function (opts) {
    const status = h('span', { class: 'file-status', role: 'status' });
    let timer = 0;
    const btn = h('button', { type: 'button', class: opts.className || 'btn btn--secondary', text: opts.label });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      clearTimeout(timer);
      let result = 'unavailable';
      try {
        result = await saveFile(await opts.getFile());
      } catch (_err) {
        result = 'unavailable';
      }
      btn.disabled = false;
      status.textContent = SAVE_MSG[result] || '';
      status.className = 'file-status' + (result === 'unavailable' || result === 'busy' ? ' is-warn' : '');
      timer = setTimeout(() => { status.textContent = ''; }, 6000);
    });
    return h('span', { class: 'file-btn' }, btn, status);
  };

  PF.fundById = id => (PF.data ? PF.data.funds.find(f => f.id === id) || null : null);
  PF.formById = id => (PF.data ? PF.data.forms.find(f => f.id === id) || null : null);

  /** Form file buttons (blank form + sample) for a form id from the data. */
  PF.formButtons = function (form, compact) {
    const mk = (v, label, secondary) => PF.fileButton({
      label,
      className: 'btn ' + (secondary ? 'btn--secondary' : 'btn--primary') + (compact ? ' btn--small' : ''),
      getFile: () => ({ filename: v.name, href: v.file })
    });
    return [mk(form.blank, compact ? form.title + ' 양식' : '빈 양식', compact), form.sample ? mk(form.sample, '작성예시', true) : null];
  };
}());
