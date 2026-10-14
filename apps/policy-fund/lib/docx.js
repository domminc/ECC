/**
 * 의존성 없는 .docx 생성기.
 * draft.js 의 build() 결과({title, subtitle, sections})를 Word 문서(OOXML)로 만들어 Uint8Array 로 돌려준다.
 * ZIP 은 압축 없이(stored) 묶는다. 브라우저와 Node 모두에서 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PF_DOCX = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FONT = '맑은 고딕';
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const PAGE_W = 11906;
  const MARGIN = 1134;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const NOTICE = '본 문서는 신청 준비용 초안이며 공식 서식이 아닙니다. 노란 표시의 【작성 필요】 항목은 직접 채워야 합니다. 실제 신청은 해당 기관의 온라인 시스템에서 입력·제출하세요.';

  /* ---------- ZIP (stored) ---------- */
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((Math.max(now.getFullYear(), 1980) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      locals.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      centrals.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const centralSize = centrals.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    const parts = locals.concat(centrals, [new Uint8Array(end.buffer)]);
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    parts.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  /* ---------- OOXML 조각 ---------- */
  // XML 1.0 에서 허용되지 않는 제어문자는 버린다 (탭·줄바꿈은 유지)
  const stripInvalid = (s) => Array.from(String(s)).filter((ch) => {
    const c = ch.codePointAt(0);
    return c >= 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
  }).join('');
  const esc = (s) => stripInvalid(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function run(text, o) {
    const opt = o || {};
    const rpr = (opt.bold ? '<w:b/>' : '') + (opt.italic ? '<w:i/>' : '')
      + (opt.color ? `<w:color w:val="${opt.color}"/>` : '') + (opt.size ? `<w:sz w:val="${opt.size}"/>` : '')
      + (opt.highlight ? `<w:highlight w:val="${opt.highlight}"/>` : '');
    const pieces = String(text).split('\n').map((t) => `<w:t xml:space="preserve">${esc(t)}</w:t>`).join('<w:br/>');
    return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}${pieces}</w:r>`;
  }

  /** 【작성 필요: …】 구간은 노란 형광펜으로 표시한다 */
  function runs(text, base) {
    return String(text).split(/(【작성 필요[^】]*】)/).filter((s) => s !== '')
      .map((s) => (s.startsWith('【작성 필요') ? run(s, Object.assign({}, base, { highlight: 'yellow' })) : run(s, base))).join('');
  }

  function para(inner, o) {
    const opt = o || {};
    const ppr = (opt.style ? `<w:pStyle w:val="${opt.style}"/>` : '') + (opt.keepNext ? '<w:keepNext/>' : '')
      + (opt.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${opt.shade}"/>` : '')
      + (opt.after !== undefined ? `<w:spacing w:before="${opt.before || 0}" w:after="${opt.after}"/>` : '');
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
  }

  function cell(text, width, o) {
    const opt = o || {};
    const tcpr = `<w:tcW w:w="${width}" w:type="dxa"/>${opt.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${opt.fill}"/>` : ''}`;
    return `<w:tc><w:tcPr>${tcpr}</w:tcPr>${para(runs(text, { bold: opt.bold, size: 20 }), { after: 0 })}</w:tc>`;
  }

  function table(widths, header, rows, labelCol) {
    const total = widths.reduce((a, b) => a + b, 0);
    const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="888888"/>`).join('');
    let xml = `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders>`
      + '<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>'
      + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
    if (header) {
      xml += `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${header.map((h, i) => cell(h, widths[i], { bold: true, fill: 'DCE6F1' })).join('')}</w:tr>`;
    }
    rows.forEach((r) => {
      xml += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map((c, i) => (labelCol && i === 0
        ? cell(c, widths[i], { bold: true, fill: 'DCE6F1' }) : cell(c, widths[i]))).join('')}</w:tr>`;
    });
    return `${xml}</w:tbl>` + para('', { after: 60 });
  }

  function equalWidths(n) {
    const w = Math.floor(CONTENT_W / n);
    const out = Array(n).fill(w);
    out[n - 1] += CONTENT_W - w * n;
    return out;
  }

  function blockXml(b) {
    if (b.type === 'h') return para(run(b.text, { bold: true, color: '1F4E79' }), { style: 'Heading2', keepNext: true });
    if (b.type === 'p') {
      const prefix = b.auto ? run('자동 계산  ', { bold: true, color: '1F4E79', size: 18 }) : '';
      return para(prefix + runs(b.text), { after: 80 });
    }
    if (b.type === 'kv') return table([2400, CONTENT_W - 2400], null, b.rows.map((r) => [r[0], r[1]]), true);
    if (b.type === 'table') return table(equalWidths(b.header.length), b.header, b.rows, false);
    return '';
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>`
    + `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${FONT}"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="40"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="26"/></w:rPr></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4E79"/><w:sz w:val="22"/></w:rPr></w:style>'
    + '</w:styles>';

  function documentXml(doc) {
    let body = para(run(doc.title), { style: 'Title' }) + para(run(doc.subtitle, { color: '595959' }), { after: 120 })
      + para(run(NOTICE, { size: 19, color: '404040' }), { shade: 'EEF3F8', after: 160 });
    doc.sections.forEach((s) => {
      body += para(run(s.title), { style: 'Heading1' }) + s.blocks.map(blockXml).join('');
    });
    const sect = `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="16838"/><w:pgMar w:top="1021" w:right="${MARGIN}" w:bottom="1021" w:left="${MARGIN}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  }

  const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const coreXml = (title) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    + 'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${esc(title)}</dc:title><dc:creator>정책자금 한눈에 보기</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`;

  function buildDocx(doc) {
    const enc = new TextEncoder();
    return zipStore([
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
      { name: 'docProps/core.xml', data: enc.encode(coreXml(`${doc.title} - ${doc.subtitle}`)) },
      { name: 'word/document.xml', data: enc.encode(documentXml(doc)) },
      { name: 'word/styles.xml', data: enc.encode(STYLES) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(DOC_RELS) },
    ]);
  }

  return { buildDocx, zipStore, crc32, MIME };
});
