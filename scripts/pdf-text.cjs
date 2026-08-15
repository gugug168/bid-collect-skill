/**
 * pdf-text.cjs — 零依赖 PDF 文本提取（Node 内置 zlib）
 *
 * 适用：文本型 PDF（含 /Font + /ToUnicode CMap 的 CID 中文 PDF）
 * 不适用：纯扫描件（无文本层，需 OCR）— 会返回空串，调用方须诚实留空
 *
 * 原理：
 *   1. 扫描所有 `stream ... endstream`（正确跳过 endstream 干扰），FlateDecode 解压
 *   2. 内容流里解析 BT..ET 文本块的 Tj / TJ / ' / " 算子
 *   3. hex 串 <XXXX> 按 2 字节 CID 查 ToUnicode CMap（bfchar/bfrange）还原中文
 *   4. 依据 Td / TD / T-star 的换行位移插入换行，尽量还原版面行结构
 */
const zlib = require("zlib");

/** 取出 PDF 里所有 stream（含对象号与字典，用于判断 FlateDecode / 归属字体） */
function extractStreams(raw) {
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(raw))) {
    // 排除 "endstream" 中的 stream
    if (m.index >= 3 && raw.slice(m.index - 3, m.index) === "end") continue;
    const st = m.index + m[0].length;
    const e = raw.indexOf("endstream", st);
    if (e < 0) continue;
    const objAt = raw.lastIndexOf("obj", m.index);
    const dict = objAt > -1 ? raw.slice(objAt, m.index) : "";
    // 回溯对象号: "12 0 obj"
    let objNum = -1;
    if (objAt > -1) {
      const head = raw.slice(Math.max(0, objAt - 24), objAt);
      const hm = head.match(/(\d+)\s+\d+\s*$/);
      if (hm) objNum = parseInt(hm[1], 10);
    }
    out.push({ start: st, end: e, dict, objNum });
    re.lastIndex = e + 9;
  }
  return out;
}

/**
 * 建立「页面资源字体名 → {ToUnicode CMap, 编码字宽}」映射
 *
 * 两件事必须按字体分别记录，缺一不可：
 * 1) CMap 分表：同一个 CID 在不同字体含义不同，合并成单表会串字（如 嘉→‹、服务→服⃑）。
 * 2) 编码字宽：Type0/Identity-H 是「2 字节一个字」，而 TrueType/Type1 + WinAnsiEncoding
 *    是「1 字节一个字」。二者混排是中文公文 PDF 的常态 —— 汉字走 Type0，数字/字母走
 *    简单字体。旧版本只登记「有 ToUnicode」的字体，导致简单字体既拿不到自己的编码宽度、
 *    又被套用了别的字体合并出的 fallbackCMap，于是：
 *      浙江温州公告 " 300" 的字节 20 33 30 30 被两两拼成 CID 2033/3030 → 输出「″〰」。
 *    工期列因此出现「″〰 日历天」这类假数据 —— 比留空更危险，必须按字体宽度解码。
 */
function buildFontMaps(raw, cmapByObj) {
  const fontObjInfo = new Map();     // 字体对象号 → {cmap, twoByte}
  for (const m of raw.matchAll(/(\d+)\s+\d+\s+obj([\s\S]{0,2000}?)endobj/g)) {
    const objNum = parseInt(m[1], 10);
    const body = m[2];
    const um = body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    const cm = um ? (cmapByObj.get(parseInt(um[1], 10)) || null) : null;
    // Type0 是唯一的复合字体类型，其 Identity-H/V 编码固定 2 字节；其余皆按 1 字节
    const isFont = /\/Type\s*\/Font/.test(body);
    const twoByte = /\/Subtype\s*\/Type0/.test(body) || /\/Encoding\s*\/Identity-[HV]/.test(body);
    if (cm || isFont) fontObjInfo.set(objNum, { cmap: cm, twoByte });
  }
  const nameToFont = new Map();      // 资源名(如 /FAAACG 或 /F1) → {cmap, twoByte}
  for (const fm of raw.matchAll(/\/Font\s*<<([\s\S]{0,4000}?)>>/g)) {
    for (const e of fm[1].matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const info = fontObjInfo.get(parseInt(e[2], 10));
      if (info) nameToFont.set(e[1], info);
    }
  }
  return nameToFont;
}

function inflate(buf) {
  const tries = [
    () => zlib.inflateSync(buf),
    () => zlib.inflateRawSync(buf),
    () => zlib.unzipSync(buf),
    () => zlib.inflateSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
    () => zlib.inflateRawSync(buf, { finishFlush: zlib.constants.Z_SYNC_FLUSH }),
  ];
  for (const f of tries) { try { const r = f(); if (r && r.length) return r; } catch (_) { } }
  return null;
}

/** 解析 ToUnicode CMap → Map<cidHex, unicodeStr> */
function parseCMap(text) {
  const map = new Map();
  const hex2str = (h) => {
    let s = "";
    for (let i = 0; i + 3 < h.length + 1; i += 4) {
      const cu = parseInt(h.slice(i, i + 4), 16);
      if (!isNaN(cu)) s += String.fromCharCode(cu);
    }
    return s;
  };
  // bfchar: <src> <dst>
  for (const blk of text.match(/beginbfchar([\s\S]*?)endbfchar/g) || []) {
    for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(m[1].toUpperCase().padStart(4, "0"), hex2str(m[2]));
    }
  }
  // bfrange: <lo> <hi> <dstStart>  |  <lo> <hi> [<d1> <d2> ...]
  for (const blk of text.match(/beginbfrange([\s\S]*?)endbfrange/g) || []) {
    for (const m of blk.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4]) {
        const base = parseInt(m[4], 16);
        for (let c = lo; c <= hi && c - lo < 65536; c++) {
          map.set(c.toString(16).toUpperCase().padStart(4, "0"), String.fromCharCode(base + (c - lo)));
        }
      } else if (m[5]) {
        const arr = [...m[5].matchAll(/<([0-9A-Fa-f]+)>/g)].map(x => hex2str(x[1]));
        for (let c = lo; c <= hi && c - lo < arr.length; c++) {
          map.set(c.toString(16).toUpperCase().padStart(4, "0"), arr[c - lo]);
        }
      }
    }
  }
  return map;
}

/** 解析 PDF 字面字符串 (....) 的转义 */
function decodeLiteral(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const n = s[++i];
      // 注意：必须还原为「真实字节」，不能近似成空格。
      // CID 双字节流里 \b=0x08、\f=0x0C 常作为高位字节出现（如「嘉」= 0x0C39 写作 \f9），
      // 若转成 0x20 会把 CID 篡改成 0x2039，查表落空 → 输出乱码「‹」。
      if (n === "n") out += "\n";
      else if (n === "r") out += "\r";
      else if (n === "t") out += "\t";
      else if (n === "b") out += "\b";
      else if (n === "f") out += "\f";
      else if (n >= "0" && n <= "7") {
        let oct = n;
        while (oct.length < 3 && s[i + 1] >= "0" && s[i + 1] <= "7") oct += s[++i];
        out += String.fromCharCode(parseInt(oct, 8));
      } else out += n;
    } else out += c;
  }
  return out;
}

/** 字面串字节 → 文本。2 字节字体(Identity-H)按 2 字节查 ToUnicode 表；1 字节字体原样返回 */
function literalToText(rawStr, cmap, twoByte) {
  const bytes = decodeLiteral(rawStr);
  // 1 字节字体（WinAnsi/Standard）：字节即字符，直接返回；
  // 绝不能拿别的字体的 CMap 去查，否则数字会被翻成中日韩兼容区符号。
  if (!twoByte || !cmap || cmap.size === 0) return bytes;
  let out = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = ((bytes.charCodeAt(i) & 0xff) << 8 | (bytes.charCodeAt(i + 1) & 0xff))
      .toString(16).toUpperCase().padStart(4, "0");
    if (cmap.has(code)) out += cmap.get(code);
    else {
      const n = parseInt(code, 16);
      if (n >= 0x20 && n <= 0xFFFD) out += String.fromCharCode(n);
    }
  }
  if (bytes.length % 2 === 1) {
    const c = bytes.charCodeAt(bytes.length - 1);
    if (c >= 0x20) out += String.fromCharCode(c);
  }
  return out;
}

/** 从内容流文本提取可读文本（跟踪 Tf 切换字体，逐字体查各自 CMap） */
function contentToText(content, nameToFont, fallbackCMap, cidMode) {
  const lines = [];
  let cur = "";
  let cmap = fallbackCMap;
  // 当前字体是否 2 字节编码。未在资源字典里找到该字体时，退回文档级推断 cidMode。
  let twoByte = cidMode;
  const pushLine = () => { if (cur.trim()) lines.push(cur.trim()); cur = ""; };

  // 逐 token 扫描 BT..ET
  //
  // ⚠ 正则灾难性回溯（浙江缙云公告实测：253KB 内容流导致进程死循环 16 分钟不返回）
  // 原写法 \[((?:[^\[\]]|\\[\s\S])*)\]\s*TJ 里，[^\[\]] 同样能吃掉反斜杠，
  // 与 \\[\s\S] 分支产生「同一段文本的多种切分方式」→ 找不到收尾的 ] TJ 时按指数级回溯。
  // 修正：从否定字符类里排除反斜杠（[^\[\]\\]），令两个分支互斥、匹配路径唯一 → 线性时间。
  const re = /(BT|ET|T\*|(-?[\d.]+)\s+(-?[\d.]+)\s+(Td|TD)|<([0-9A-Fa-f\s]*)>\s*Tj|\(((?:\\[\s\S]|[^\\)])*)\)\s*Tj|\[((?:[^\[\]\\]|\\[\s\S])*)\]\s*TJ|\(((?:\\[\s\S]|[^\\)])*)\)\s*'|\(((?:\\[\s\S]|[^\\)])*)\)\s*"|\/([^\s/\[\]<>()]+)\s+([\d.]+)\s+Tf)/g;
  // 当前字号（Tf 的第二个操作数）。与 Td 位移同处「未缩放文本空间」，
  // 因此 dx/fontSize 这个比值不受 Tm 缩放影响 —— 这是判空格唯一可靠的量纲。
  let fontSize = 0;
  let m;
  // 兜底闸门：即便日后再遇到未知的病态版式，也必须能退出（宁可少提取，不可挂死整省采集）
  const deadline = Date.now() + 8000;
  let guard = 0;
  while ((m = re.exec(content))) {
    if ((++guard & 1023) === 0 && Date.now() > deadline) {
      lines.push("[提取超时截断]");
      break;
    }
    const tok = m[1];
    if (m[10] !== undefined) {                       // 字体切换
      const info = nameToFont.get(m[10]);
      if (info) {
        twoByte = info.twoByte;
        // 1 字节字体没有自己的 ToUnicode 时，宁可不查表（按 WinAnsi 直出），
        // 也绝不套用 fallbackCMap —— 那是别的字体的 CID 表，只会产出乱码。
        cmap = info.cmap || (info.twoByte ? fallbackCMap : null);
      } else {
        twoByte = cidMode;
        cmap = fallbackCMap;
      }
      const fs = Math.abs(parseFloat(m[11]));
      if (fs > 0) fontSize = fs;
      continue;
    }
    if (tok === "BT" || tok === "ET" || tok === "T*") { pushLine(); continue; }
    if (m[4] === "Td" || m[4] === "TD") {
      const dy = parseFloat(m[3]);
      const dx = parseFloat(m[2]);
      if (Math.abs(dy) > 0.5) pushLine();      // 纵向位移 = 换行
      // ⚠ 横向位移判空格：绝不能用写死的绝对阈值。
      // 浙江武义县公告实测：Tm 缩放 0.05 + Tf 240（实际 12pt），每个汉字单独一条 TD，
      // dx≈240~283，在旧规则 dx>8 下 732 次位移 100% 被判成空格 →「武 义 县 泉 溪 镇」，
      // 导致「招标人」「施工」「资质」等关键词全部匹配不到，被误读成「公告没写」。
      // 正解：与当前字号比。一个整字宽的推进 dx≈fontSize，真正的词间空隙才会明显超出。
      else if (dx > (fontSize > 0 ? fontSize * 1.3 : 8)) cur += " ";
      continue;
    }
    if (m[5] !== undefined) { cur += hexToText(m[5], cmap, twoByte); continue; }            // <..> Tj
    if (m[6] !== undefined) { cur += literalToText(m[6], cmap, twoByte); continue; }        // (..) Tj
    if (m[7] !== undefined) {                                                               // [..] TJ
      for (const p of m[7].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\[\s\S]|[^\\)])*)\)|(-?[\d.]+)/g)) {
        if (p[1] !== undefined) cur += hexToText(p[1], cmap, twoByte);
        else if (p[2] !== undefined) cur += literalToText(p[2], cmap, twoByte);
        else if (p[3] !== undefined && parseFloat(p[3]) < -180) cur += " ";
      }
      continue;
    }
    if (m[8] !== undefined) { pushLine(); cur += literalToText(m[8], cmap, twoByte); continue; }
    if (m[9] !== undefined) { pushLine(); cur += literalToText(m[9], cmap, twoByte); continue; }
  }
  pushLine();
  return lines.join("\n");
}

function hexToText(hex, cmap, twoByte) {
  const h = hex.replace(/\s+/g, "").toUpperCase();
  let out = "";
  if (!twoByte) {
    // 1 字节字体：每 2 个十六进制位一个字符。ToUnicode（若有）的源码点是单字节，
    // parseCMap 已统一 padStart 到 4 位，故查表键要补零。无表则按 Latin-1/ASCII 直出。
    for (let i = 0; i < h.length; i += 2) {
      const code = h.slice(i, i + 2).padEnd(2, "0");
      const b = parseInt(code, 16);
      if (isNaN(b)) continue;
      const key = code.padStart(4, "0");
      if (cmap && cmap.has(key)) out += cmap.get(key);
      else if (b >= 0x20) out += String.fromCharCode(b);
    }
    return out;
  }
  for (let i = 0; i + 1 < h.length; i += 4) {
    let code = h.slice(i, i + 4);
    if (code.length < 4) code = code.padEnd(4, "0");
    if (cmap && cmap.has(code)) out += cmap.get(code);
    else {
      const n = parseInt(code, 16);
      // 无 CMap：CID 常见等于 Unicode（少数情况），可读才收
      if (n >= 0x20 && n <= 0xFFFD) out += String.fromCharCode(n);
    }
  }
  return out;
}

/**
 * 文档级兜底：识别并修复「逐字空格」版式。
 *
 * 背景：contentToText 已按「dx 与字号之比」判空格，能挡住逐字 Td/TD 的版式。
 * 但仍有排版器改用 Tm 逐字定位（本提取器不解析 Tm），届时空格会从别处漏进来。
 * 这类缺陷极其隐蔽 —— 文本"看着能读"，但「招标人」实为「招 标 人」，
 * 关键词全部匹配不到，会被误判成「公告没写该字段」，直接污染数据真实性。
 *
 * 判据：统计相邻汉字对中「中间恰好隔一个空格」的比例。正常中文正文该比例极低
 * （<10%）；逐字空格版式则接近 100%。超过 60% 才动手，避免误伤正常文本。
 */
function fixPerGlyphSpacing(text) {
  if (!text) return text;
  const spaced = (text.match(/[\u4e00-\u9fa5] [\u4e00-\u9fa5]/g) || []).length;
  const tight = (text.match(/[\u4e00-\u9fa5][\u4e00-\u9fa5]/g) || []).length;
  const total = spaced + tight;
  if (total < 50 || spaced / total < 0.6) return text;
  // 命中：把「单个空格分隔的相邻非空白字符」全部并拢（汉字/数字/字母/标点通吃），
  // 因为这种版式下整篇都是逐字符空格，连「0 5 7 9 - 8 9」也一样被拆散。
  let out = text;
  for (let i = 0; i < 3; i++) out = out.replace(/(\S) (?=\S)/g, "$1");
  return out;
}

/**
 * 丢弃「不可读噪声行」。
 *
 * 来源：电子签章 / 印章图形 / 嵌入字体子集等二进制对象流里可能恰好含 Tj/TJ 字节，
 * 被内容流筛选误收（杭州缙云公告实测：正文末尾多出 70 字「䥬ĒḘ猁ሉొ᠁琘…」）。
 * 这些行不影响字段抽取（都在正文之后），但会污染文本、干扰人工核验。
 *
 * 判据：可读字符（汉字/ASCII 可打印/常用中文标点/全角符号）占比。
 * 正常中文行接近 100%，纯数字或纯英文行也是 100%，唯有二进制噪声会低于 50%。
 */
function dropNoiseLines(text) {
  const READABLE = /[\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF\u2010-\u2027\u00B0\u2103\u33A1\s]|[\x20-\x7E]/;
  return text.split("\n").filter(line => {
    const s = line.trim();
    if (s.length < 8) return true;                  // 短行不判（"电 话："这类被拆开的标签）
    let ok = 0;
    for (const ch of s) if (READABLE.test(ch)) ok++;
    return ok / s.length >= 0.5;
  }).join("\n");
}

/**
 * 主入口：Buffer(PDF) → 纯文本
 * @returns {{text:string, pages:number, hasTextLayer:boolean, note:string}}
 */
function pdfToText(buffer) {
  const raw = buffer.toString("latin1");
  if (!raw.startsWith("%PDF")) return { text: "", pages: 0, hasTextLayer: false, note: "非 PDF 文件" };

  const streams = extractStreams(raw);
  const decoded = [];
  for (const s of streams) {
    const data = Buffer.from(raw.slice(s.start, s.end), "latin1");
    // 关键：ToUnicode CMap 常为「无 /Filter 的明文流」，不能强行 inflate（否则整表丢失 → 全乱码）
    if (/\/Filter/.test(s.dict)) {
      const inf = inflate(data);
      if (inf) { decoded.push({ ...s, text: inf.toString("latin1") }); continue; }
    }
    decoded.push({ ...s, text: data.toString("latin1") });
  }

  // 按对象号收集 ToUnicode CMap
  const cmapByObj = new Map();
  const merged = new Map();
  for (const d of decoded) {
    if (/beginbfchar|beginbfrange/.test(d.text)) {
      const t = parseCMap(d.text);
      if (d.objNum > -1) cmapByObj.set(d.objNum, t);
      for (const [k, v] of t) if (!merged.has(k)) merged.set(k, v);
    }
  }
  // 资源名 → {该字体专属 CMap, 编码字宽}（避免跨字体串字 + 避免 1 字节字体被按 2 字节读）
  const nameToFont = buildFontMaps(raw, cmapByObj);

  // 文档级兜底：仅当某字体不在资源字典里时才用。Identity-H = 双字节 CID 编码
  const cidMode = /Identity-H/.test(raw) && merged.size > 0;

  // 内容流 = 含文本算子的流
  const chunks = [];
  for (const d of decoded) {
    if (/\bBT\b[\s\S]*?\bET\b/.test(d.text) || /\bTj\b|\bTJ\b/.test(d.text)) {
      const t = contentToText(d.text, nameToFont, merged, cidMode);
      if (t.trim()) chunks.push(t);
    }
  }
  let text = chunks.join("\n").replace(/\u0000/g, "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  text = dropNoiseLines(text);
  text = fixPerGlyphSpacing(text);

  const hasTextLayer = /[\u4e00-\u9fa5]{4,}/.test(text) || text.length > 200;
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
  return {
    text: hasTextLayer ? text : "",
    pages,
    hasTextLayer,
    note: hasTextLayer ? "文本型 PDF，已提取" : "无文本层（疑似扫描件），需 OCR，按诚实政策留空",
  };
}

module.exports = { pdfToText };

// CLI 自测: node pdf-text.cjs <url|file>
if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    if (!arg) { console.log("用法: node pdf-text.cjs <url|本地文件>"); process.exit(1); }
    let buf;
    if (/^https?:/i.test(arg)) {
      require("dns").setDefaultResultOrder("ipv4first");
      const r = await fetch(encodeURI(arg), { headers: { "User-Agent": "Mozilla/5.0 Chrome/120.0" } });
      buf = Buffer.from(await r.arrayBuffer());
      console.log("HTTP", r.status, buf.length, "bytes");
    } else buf = require("fs").readFileSync(arg);
    const r = pdfToText(buf);
    console.log("pages:", r.pages, "hasTextLayer:", r.hasTextLayer, "|", r.note);
    console.log("字数:", r.text.length);
    console.log("=".repeat(60));
    console.log(r.text.slice(0, Number(process.argv[3] || 3000)));
  })();
}
