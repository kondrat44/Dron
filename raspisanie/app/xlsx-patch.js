/* Writes edits back into the ORIGINAL .xlsx: only touched cells/merges change, everything else stays byte-for-byte. */
window.XlsxPatch = (() => {
  /* ---------- zip ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function stream(u8, kind, method) {
    const s = new Blob([u8]).stream().pipeThrough(new kind(method));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  function readZip(buf) {
    const u8 = new Uint8Array(buf),
      dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--)
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw Error("Файл не является книгой .xlsx");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw Error("Повреждён архив .xlsx");
      const method = dv.getUint16(p + 10, true),
        crc = dv.getUint32(p + 16, true),
        csize = dv.getUint32(p + 20, true),
        usize = dv.getUint32(p + 24, true),
        nlen = dv.getUint16(p + 28, true),
        xlen = dv.getUint16(p + 30, true),
        clen = dv.getUint16(p + 32, true),
        off = dv.getUint32(p + 42, true),
        nameBytes = u8.subarray(p + 46, p + 46 + nlen),
        name = new TextDecoder().decode(nameBytes);
      const lx = dv.getUint16(off + 28, true) + dv.getUint16(off + 26, true);
      const data = u8.subarray(off + 30 + lx, off + 30 + lx + csize);
      entries.push({ name, nameBytes, method, crc, csize, usize, data, time: dv.getUint32(p + 12, true) });
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  }
  async function text(entry) {
    const raw = entry.method === 0 ? entry.data : await stream(entry.data, DecompressionStream, "deflate-raw");
    return new TextDecoder().decode(raw);
  }
  async function writeZip(entries) {
    const parts = [],
      central = [];
    let offset = 0;
    for (const e of entries) {
      if (e.newText != null) {
        const raw = new TextEncoder().encode(e.newText);
        e.crc = crc32(raw);
        e.usize = raw.length;
        e.data = await stream(raw, CompressionStream, "deflate-raw");
        e.method = 8;
        e.csize = e.data.length;
      }
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);
      h.setUint16(8, e.method, true);
      h.setUint32(10, e.time, true);
      h.setUint32(14, e.crc, true);
      h.setUint32(18, e.csize, true);
      h.setUint32(22, e.usize, true);
      h.setUint16(26, e.nameBytes.length, true);
      parts.push(new Uint8Array(h.buffer), e.nameBytes, e.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, e.method, true);
      c.setUint32(12, e.time, true);
      c.setUint32(16, e.crc, true);
      c.setUint32(20, e.csize, true);
      c.setUint32(24, e.usize, true);
      c.setUint16(28, e.nameBytes.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), e.nameBytes);
      offset += 30 + e.nameBytes.length + e.data.length;
    }
    const csize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, csize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  }

  /* ---------- cells ---------- */
  const colName = (c) => {
    let s = "";
    for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
    return s;
  };
  const addr = (r, c) => colName(c) + r;
  const parseAddr = (a) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a);
    let c = 0;
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    return { r: Number(m[2]), c };
  };
  const parseRange = (ref) => {
    const [a, b = a] = ref.split(":");
    const x = parseAddr(a),
      y = parseAddr(b);
    return { r1: x.r, c1: x.c, r2: y.r, c2: y.c };
  };

  class Sheet {
    constructor(xml) {
      this.xml = xml;
      this.dirtyRows = new Set();
      this.mergesDirty = false;
      this.decl = (/^<\?xml[^>]*\?>/.exec(xml) || [""])[0];
      this.doc = new DOMParser().parseFromString(xml, "application/xml");
      if (this.doc.getElementsByTagNameNS("*", "parsererror").length) throw Error("Не удалось разобрать лист Excel");
      this.ns = this.doc.documentElement.namespaceURI;
      this.data = this.doc.getElementsByTagNameNS(this.ns, "sheetData")[0];
      this.rows = new Map();
      this.orig = new Map();
      for (const row of this.data.children) {
        this.rows.set(Number(row.getAttribute("r")), row);
        this.orig.set(Number(row.getAttribute("r")), new XMLSerializer().serializeToString(row));
      }
      this.dirty = false;
    }
    el(name) {
      const pre = this.doc.documentElement.prefix;
      return this.doc.createElementNS(this.ns, pre ? pre + ":" + name : name);
    }
    row(r, create) {
      let row = this.rows.get(r);
      if (row || !create) return row;
      row = this.el("row");
      row.setAttribute("r", r);
      const next = [...this.rows.keys()].filter((k) => k > r).sort((a, b) => a - b)[0];
      this.data.insertBefore(row, next ? this.rows.get(next) : null);
      this.rows.set(r, row);
      return row;
    }
    cell(r, c, create) {
      const row = this.row(r, create);
      if (!row) return null;
      const a = addr(r, c);
      let before = null;
      for (const x of row.children) {
        const xa = x.getAttribute("r");
        if (xa === a) return x;
        if (!before && parseAddr(xa).c > c) before = x;
      }
      if (!create) return null;
      const cell = this.el("c");
      cell.setAttribute("r", a);
      row.insertBefore(cell, before);
      row.removeAttribute("spans");
      this.dirtyRows.add(r);
      return cell;
    }
    clearValue(cell) {
      if (!cell.children.length && !cell.hasAttribute("t")) return;
      for (const k of [...cell.children]) cell.removeChild(k);
      cell.removeAttribute("t");
      this.dirtyRows.add(parseAddr(cell.getAttribute("r")).r);
    }
    setValue(r, c, v) {
      const cell = this.cell(r, c, true);
      this.clearValue(cell);
      v = String(v ?? "").trim();
      this.dirtyRows.add(r);
      if (v !== "") {
        if (/^\d{1,9}$/.test(v)) {
          const x = this.el("v");
          x.textContent = String(Number(v));
          cell.appendChild(x);
        } else {
          cell.setAttribute("t", "inlineStr");
          const is = this.el("is"),
            t = this.el("t");
          t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
          t.textContent = v;
          is.appendChild(t);
          cell.appendChild(is);
        }
      }
      this.dirty = true;
    }
    hasValue(r, c) {
      const cell = this.cell(r, c, false);
      return !!cell && [...cell.children].some((k) => k.localName === "v" || k.localName === "is");
    }
    mergesNode(create) {
      let m = this.doc.getElementsByTagNameNS(this.ns, "mergeCells")[0];
      if (!m && create) {
        m = this.el("mergeCells");
        this.data.parentNode.insertBefore(m, this.data.nextSibling);
      }
      return m;
    }
    merges() {
      const m = this.mergesNode(false);
      return m ? [...m.children].map((x) => ({ node: x, ...parseRange(x.getAttribute("ref")) })) : [];
    }
    /* copy of a rectangle: cell nodes (with style) and merges fully inside it */
    capture(r, c, h, w) {
      const cells = [];
      for (let i = 0; i < h; i++)
        for (let j = 0; j < w; j++) {
          const x = this.cell(r + i, c + j, false);
          cells.push({ i, j, node: x ? x.cloneNode(true) : null });
        }
      const merges = this.merges()
        .filter((m) => m.r1 >= r && m.r2 < r + h && m.c1 >= c && m.c2 < c + w)
        .map((m) => ({ r1: m.r1 - r, c1: m.c1 - c, r2: m.r2 - r, c2: m.c2 - c }));
      return { cells, merges, h, w };
    }
    clearRect(r, c, h, w) {
      for (let i = 0; i < h; i++)
        for (let j = 0; j < w; j++) {
          const x = this.cell(r + i, c + j, false);
          if (x) this.clearValue(x);
        }
      for (const m of this.merges())
        if (m.r1 < r + h && m.r2 >= r && m.c1 < c + w && m.c2 >= c) {
          m.node.parentNode.removeChild(m.node);
          this.mergesDirty = true;
        }
      this.dirty = true;
    }
    paste(piece, r, c) {
      for (const { i, j, node } of piece.cells) {
        if (!node) continue;
        const target = this.cell(r + i, c + j, true),
          copy = node.cloneNode(true);
        copy.setAttribute("r", addr(r + i, c + j));
        if (new XMLSerializer().serializeToString(copy) !== new XMLSerializer().serializeToString(target))
          this.dirtyRows.add(r + i);
        target.parentNode.replaceChild(copy, target);
      }
      if (piece.merges.length) {
        const host = this.mergesNode(true);
        for (const m of piece.merges) {
          const x = this.el("mergeCell");
          x.setAttribute("ref", addr(r + m.r1, c + m.c1) + ":" + addr(r + m.r2, c + m.c2));
          host.appendChild(x);
          this.mergesDirty = true;
        }
      }
      this.dirty = true;
    }
    /* Пишем только изменённые строки и объединения; весь остальной текст листа остаётся байт в байт. */
    toString() {
      const ser = (node) =>
        new XMLSerializer().serializeToString(node).replace(/\s+xmlns(:[\w.-]+)?="[^"]*"/g, "");
      const merges = this.mergesNode(false);
      /* исходные строки сравниваются с текущими: неизменившиеся не трогаем */
      const spans = [];
      const re = /<((?:[\w.-]+:)?row)\b([^>]*?)(\/>|>[\s\S]*?<\/\1>)/g;
      let m;
      const dataStart = this.xml.search(/<(?:[\w.-]+:)?sheetData\b/);
      re.lastIndex = Math.max(0, dataStart);
      const seen = new Set();
      while ((m = re.exec(this.xml))) {
        const r = Number((/\br="(\d+)"/.exec(m[2]) || [])[1]);
        if (!r) continue;
        seen.add(r);
        if (
          this.dirtyRows.has(r) &&
          new XMLSerializer().serializeToString(this.rows.get(r)) !== this.orig.get(r)
        )
          spans.push([m.index, m.index + m[0].length, ser(this.rows.get(r))]);
      }
      /* новые строки, которых не было в файле, вставляем перед следующей существующей */
      for (const r of this.dirtyRows)
        if (!seen.has(r)) {
          const next = [...seen].filter((k) => k > r).sort((a, b) => a - b)[0];
          let at;
          if (next) {
            const mm = new RegExp('<(?:[\\w.-]+:)?row\\b[^>]*\\br="' + next + '"').exec(this.xml.slice(dataStart));
            at = dataStart + mm.index;
          } else at = this.xml.search(/<\/(?:[\w.-]+:)?sheetData>/);
          spans.push([at, at, ser(this.rows.get(r))]);
        }
      if (this.mergesDirty) {
        /* объединения: исходный порядок сохраняется, новые дописываются в конец */
        const now = merges ? [...merges.children].map((x) => x.getAttribute("ref")) : [];
        const old = /<((?:[\w.-]+:)?mergeCells)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(this.xml);
        const oldRefs = old ? [...(old[3] || "").matchAll(/\bref="([^"]+)"/g)].map((x) => x[1]) : [];
        const keep = new Set(now);
        const order = [...oldRefs.filter((r) => keep.has(r)), ...now.filter((r) => !oldRefs.includes(r))];
        const unchanged = order.length === oldRefs.length && order.every((r, k) => r === oldRefs[k]);
        if (!unchanged) {
          const tag = old ? old[1] : (this.doc.documentElement.prefix ? this.doc.documentElement.prefix + ":" : "") + "mergeCells";
          const item = tag.replace(/mergeCells$/, "mergeCell");
          const attrs = old ? old[2].replace(/\bcount="\d+"/, 'count="' + order.length + '"') : ' count="' + order.length + '"';
          const text = order.length
            ? "<" + tag + attrs + ">" + order.map((r) => "<" + item + ' ref="' + r + '"/>').join("") + "</" + tag + ">"
            : "";
          if (old) spans.push([old.index, old.index + old[0].length, text]);
          else if (text) {
            const end = /<\/(?:[\w.-]+:)?sheetData>/.exec(this.xml);
            spans.push([end.index + end[0].length, end.index + end[0].length, text]);
          }
        }
      }
      spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let out = "",
        pos = 0;
      for (const [a, b, t] of spans) {
        out += this.xml.slice(pos, a) + t;
        pos = b;
      }
      return out + this.xml.slice(pos);
    }
  }

  async function open(bytes) {
    const entries = readZip(bytes);
    const get = (n) => entries.find((e) => e.name === n);
    const wbXml = await text(get("xl/workbook.xml")),
      relXml = await text(get("xl/_rels/workbook.xml.rels"));
    const dp = new DOMParser(),
      wbDoc = dp.parseFromString(wbXml, "application/xml"),
      relDoc = dp.parseFromString(relXml, "application/xml");
    const rels = {};
    for (const r of relDoc.getElementsByTagNameNS("*", "Relationship")) rels[r.getAttribute("Id")] = r.getAttribute("Target");
    const paths = {};
    for (const s of wbDoc.getElementsByTagNameNS("*", "sheet")) {
      const id =
        s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || s.getAttribute("r:id");
      let t = rels[id];
      t = t.startsWith("/") ? t.slice(1) : "xl/" + t;
      paths[s.getAttribute("name")] = t.replace(/\/\.\//g, "/");
    }
    const sheets = {};
    return {
      entries,
      async sheet(name) {
        if (!paths[name]) throw Error(`В исходном файле нет листа «${name}»`);
        if (!sheets[name]) sheets[name] = new Sheet(await text(get(paths[name])));
        return sheets[name];
      },
      async save() {
        for (const [name, sh] of Object.entries(sheets))
          if (sh.dirty) {
            const t = sh.toString();
            if (t !== sh.xml) get(paths[name]).newText = t;
          }
        return writeZip(entries);
      },
    };
  }
  return { open, parseAddr, addr };
})();
