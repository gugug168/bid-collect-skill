#!/usr/bin/env node
// province-collect.cjs — 省级公共资源交易平台采集器（零依赖 node fetch + HTML 解析）
// 与粤公平 ygp-collect.cjs 共享：限流防护 + 输出格式；差异：省级平台是服务端渲染 HTML，需正则提取公告链接。
// 升级 v2 (Goal v1)：进详情页抓厚字段（对标标标通）+ 输出标标通 xlsx（房建市政/水利/公路/其他 分 sheet）。
// 用法:
//   node province-collect.cjs -p shandong -k 管网 -d 30 --stage zb --delay 800 [--csv] [--xlsx] [--out file] [--limit N]
//   node province-collect.cjs -p shandong -d 30 --out shandong-all.xlsx   # 自动出 xlsx+md+csv
//   node province-collect.cjs -p shandong -d 30 --no-detail                # 只抓列表层，不进详情页
require("dns").setDefaultResultOrder("ipv4first");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
const { pdfToText } = require(path.join(__dirname, "pdf-text.cjs"));

// ---- 统一 HTTP 传输层（Node fetch 为主，curl 兜底，失败分类 + 可选 HTTP 回退）----
// 背景（2026-08-12 实测）：本沙箱 Node 自带 OpenSSL 对部分省级站点证书报 ERR_SSL_BAD_ECPOINT 直接握手失败；
// 而系统 curl 走代理能正常握手大部分站点，但少数站点（冀/吉等）经代理 HTTPS 仍握手失败（schannel），
// 直连又无外网。故：先 Node fetch，命中 TLS/连接类失败自动改 curl；curl 失败也不抛错，而是
// 返回带 klass 分类的结构化结果，便于上层诚实判断"环境 TLS 限制"还是"站点真不可达"，绝不臆断"跑不通"。
// robustFetch 额外提供 HTTP 兜底：HTTPS 传输失败时自动重试 http:// 同路径，捕捉"仅 https 握手失败但 http 可达"的站点。
// 注意：模块内 `fetch(...)` 经 `const fetch = httpFetch` 遮蔽，全部自动获得 curl 兜底（保持原 10 省行为不变）。
const _nodeFetch = globalThis.fetch;

// 把传输层错误归类为可读类型，便于上层区分「环境限制 / 站点问题 / 偶发」
function classifyErr(e) {
  const s = String((e && e.message) || e || "");
  const cause = String((e && e.cause && (e.cause.code || e.cause.message)) || "");
  const full = (s + " " + cause).toLowerCase();
  if (/schannel|handshake|ssl|tls|ecpoint|wrong_version|unexpected_eof|certificate|self.signed|unable_to_verify|depth_zero/.test(full)) return "tls";
  if (/getaddrinfo|enotfound|dns/.test(full)) return "dns";
  if (/etimedout|timeout/.test(full)) return "timeout";
  if (/econnrefused|econnreset|proxy|tunnel|aborted|10053|10054/.test(full)) return "conn";
  return "other";
}

function _curlResp(status, bodyBuf, extra = {}) {
  const b = bodyBuf || Buffer.alloc(0);
  const response = {
    status,
    ok: status >= 200 && status < 400,
    headers: { get: (k) => (String(k).toLowerCase() === "content-length" ? (extra.contentLength || null) : null) },
    async text() { return b.toString("utf8"); },
    async arrayBuffer() { return b; },
    async json() { return JSON.parse(b.toString("utf8")); },
    klass: extra.klass || (status >= 200 && status < 400 ? "ok" : "http"),
    transport: extra.transport || (status ? "node" : "unknown"),
    scheme: extra.scheme || "",
    err: extra.err || null,
    notes: extra.notes || "",
    httpsBlocked: !!extra.httpsBlocked,
    httpsError: extra.httpsError || null,
    triedHttp: !!extra.triedHttp,
  };
  const run = global.__RUN_REPORT;
  if (run) {
    if (status === 401 || status === 403) run.auth_walls.push({ status, klass: response.klass });
    else if (status === 429) run.rate_limits.push({ status, klass: response.klass });
    else if (status === 0 || status >= 500) run.transport_errors.push({ status, klass: response.klass });
  }
  return response;
}

// curl 兜底：执行级失败（TLS 握手/schannel/超时）一律返回带 klass 的结构化结果，绝不抛错。
function curlFetch(url, opts = {}) {
  const timeout = Math.max(1, Math.ceil((opts.timeout || 30000) / 1000));
  const args = ["-sS", "-L", "--max-time", String(timeout), "-w", "\n%{http_code}", "-o", "-"];
  if (opts.method && String(opts.method).toUpperCase() !== "GET") args.push("-X", String(opts.method).toUpperCase());
  for (const [k, v] of Object.entries(opts.headers || {})) args.push("-H", `${k}: ${v}`);
  if (opts.body != null) args.push("--data-binary", "@-");
  return new Promise((resolve) => {
    const child = execFile("curl", args.concat(url), { maxBuffer: 512 * 1024 * 1024, encoding: "buffer" }, (err, stdout) => {
      if (err) {
        return resolve(_curlResp(0, Buffer.alloc(0), { klass: classifyErr(err), transport: "curl", err: String(err.message || err), notes: "curl 子进程失败" }));
      }
      const nl = stdout.lastIndexOf(0x0a);
      const status = parseInt((nl >= 0 ? stdout.slice(nl + 1) : stdout).toString("utf8").trim(), 10) || 0;
      const body = nl >= 0 ? stdout.slice(0, nl) : Buffer.alloc(0);
      resolve(_curlResp(status, body, { klass: "ok", transport: "curl" }));
    });
    if (opts.body != null) { try { child.stdin.write(opts.body); } catch (_) {} child.stdin.end(); }
  });
}

async function httpFetch(url, opts = {}) {
  const o = Object.assign({ redirect: "follow" }, opts);
  try {
    const r = await _nodeFetch(url, o);
    if (r.status >= 200 && r.status < 400) {
      const buf = Buffer.from(await r.arrayBuffer());
      // 代理对部分主机返回「200 但空 body」，curl 却能拿到真实内容（新疆 EPoint 实测）：
      // 空体 2xx 视为须 curl 兜底，否则下游 JSON.parse 会静默失败、误判为"无端点"。
      if (buf.length === 0) {
        console.error(`[httpFetch] Node fetch 返回空 body(${r.status})，改走 curl 重试: ${String(url).slice(0, 70)}`);
        const c = await curlFetch(url, o);
        if (c.status) return c;
        return _curlResp(0, Buffer.alloc(0), { klass: c.klass || "conn", transport: "curl", scheme: "https", err: c.err });
      }
      // 成功且有体：返回带真实 content-length 的 wrapper，保留 .headers.get 等能力
      return _curlResp(r.status, buf, { klass: "ok", transport: "node", contentLength: Number(r.headers.get("content-length") || 0) });
    }
    return r; // 非 2xx（如 404）：原样返回真实 Response，交给上层按状态码处理
  } catch (e) {
    const klass = classifyErr(e);
    if (klass !== "other") {
      console.error(`[httpFetch] Node fetch 失败(${klass}: ${String(e && e.message || "").slice(0, 50)}), 改走 curl 重试: ${String(url).slice(0, 70)}`);
      const c = await curlFetch(url, o);
      if (c.status) return c;                 // curl 拿到真实 HTTP 响应（含 404 等）
      // curl 也失败 → 返回带 klass 的结构化结果（非 Response，但含 klass/err 供上层诚实判断）
      return _curlResp(0, Buffer.alloc(0), { klass, transport: "curl", scheme: "https", err: c.err || String(e.message || "") });
    }
    throw e;
  }
}

// robustFetch：HTTPS 传输失败（status===0，即无 HTTP 响应）时自动重试 http:// 同路径。
// 用于探测模式，捕捉"仅 https 经代理握手失败、但 http 可达"的站点。
// 真实采集路径默认不启用 HTTP 回退（保持已验证 10 省行为不变），仅探测模式受益。
async function robustFetch(url, opts = {}) {
  const r = await httpFetch(url, opts);
  // body 统一经 arrayBuffer() 取：兼容真实 Response 与 _curlResp（二者都实现了 arrayBuffer）。
  const bodyOf = async (resp) => {
    if (resp.body instanceof Buffer) return resp.body;
    try { return Buffer.from(await resp.arrayBuffer()); } catch { return Buffer.alloc(0); }
  };
  if (r.status === 0 && /^https:/i.test(url) && opts.tryHttp !== false) {
    const httpUrl = url.replace(/^https:/i, "http:");
    console.error(`[robustFetch] https 传输失败，重试 http:// : ${httpUrl.slice(0, 70)}`);
    const h = await httpFetch(httpUrl, Object.assign({}, opts, { tryHttp: false }));
    const hb = await bodyOf(h);
    // 关键诚实信号：原 https 在本环境根本传不过去（代理 TLS/连接失败），http 兜底拿到的 502/HTML
    // 只是"主机在线但内容错误"，不能据此判定"站点无 EPoint"。标记 httpsBlocked 供上层诚实归类 ENV_LIMIT。
    return _curlResp(h.status, hb, {
      klass: h.klass || (h.status ? "ok" : "tls"), transport: "curl", scheme: "http",
      triedHttp: true, httpsBlocked: true, httpsError: r.err || r.klass || "https传输失败",
      err: h.err, notes: "https(status0)→http",
    });
  }
  const body = await bodyOf(r);
  return _curlResp(r.status, body, {
    klass: r.klass || (r.status ? "ok" : "other"),
    transport: r.transport || "node", scheme: "https", err: r.err || null,
  });
}
// 关键：用 httpFetch 遮蔽模块内的全局 fetch，使下方所有 fetch(...) 自动获得 curl 兜底（保持 10 省行为不变）。
const fetch = httpFetch;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- 省级平台 adapter 注册表（每省一个，定义列表URL + 解析规则 + 可选详情解析）----
// 广东（粤公平）逐地市循环用的唯一城市真相源（省级 440000 返回 0，须逐地市）。
const GD_CITY_TARGETS = [
  ["广州市","440100"],["韶关市","440200"],["深圳市","440300"],["珠海市","440400"],["汕头市","440500"],
  ["佛山市","440600"],["江门市","440700"],["湛江市","440800"],["茂名市","440900"],["肇庆市","441200"],
  ["惠州市","441300"],["梅州市","441400"],["汕尾市","441500"],["河源市","441600"],["阳江市","441700"],
  ["清远市","441800"],["东莞市","441900"],["中山市","442000"],["潮州市","445100"],["揭阳市","445200"],["云浮市","445300"],
].map(([name, code]) => ({ name, code }));
const GD_CITIES = GD_CITY_TARGETS.map((x) => x.code);

// 北京 中标/结果/合同 栏目列表解析：与招标公告栏目（divtitlejy+list-times1）不同，
// 中标栏目列表项用 class="jylist" + class="list-times2"，故单列一个宽容解析（同时兼容两种 class）。
function beijingWinParse(html) {
  const items = [];
  const re = /<a [^>]*href="(\/jyxx[A-Za-z]+\/20\d{6}\/\d+\.html)"[^>]*title="([^"]*)"[\s\S]*?class="list-times[12]"[^>]*>\s*<p[^>]*>([0-9-]+)<\/p>/g;
  let m;
  while ((m = re.exec(html))) {
    const url = "https://ggzyfw.beijing.gov.cn" + m[1];
    const title = m[2].replace(/\s+/g, " ").trim();
    if (title.length < 4) continue;
    items.push({ url, title, date: m[3] });
  }
  return items;
}

const ADAPTERS = {
  shandong: {
    name: "山东省公共资源交易中心",
    verified: true, // 已在本环境实测跑通
    base: "https://ggzyjy.shandong.gov.cn",
    // channelId=78 = 建设工程交易公开（含招标/中标/评标）
    // 翻页机制：Jeecms 按路径分页 queryContent_{N}-jyxxgk.jspx（POST 表单提交，GET 等效），N=页码
    listUrl: (page) => `https://ggzyjy.shandong.gov.cn/queryContent_${page}-jyxxgk.jspx?channelId=78&pageNo=1`,
    parse(html) {
      const items = [];
      // 每个列表项是 <li> 块，内部同时含 jhtml 详情链接与 <div class="list-times">日期
      const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(html))) {
        const block = li[1];
        const aRe = /<a[^>]+href=["'](https?:\/\/ggzyjy\.shandong\.gov\.cn:?\d*\/[^\"']+\.jhtml)["'][^>]*>([\s\S]*?)<\/a>/i;
        const am = block.match(aRe);
        if (!am) continue;
        const url = am[1];
        const title = am[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (title.length < 4) continue;
        const dm = block.match(/(\d{4}-\d{2}-\d{2})/);
        items.push({ url, title, date: dm ? dm[1] : "" });
      }
      return items;
    },
    // ---- B 阶段（2026-08-15 枚举）：山东 Jeecms channelId：候选=149(中标候选人公示)/结果=87(交易结果公告·中标结果)；合同=78 混合源(按"信息分类:合同公示"过滤) ----
    stages: {
      candidate: { type: "中标候选人", listUrl: (p) => `https://ggzyjy.shandong.gov.cn/queryContent_${p}-jyxxgk.jspx?channelId=149&pageNo=1` },
      result:    { type: "中标结果",   listUrl: (p) => `https://ggzyjy.shandong.gov.cn/queryContent_${p}-jyxxgk.jspx?channelId=87&pageNo=1` },
      contract:  { type: "合同公示",   listUrl: (p) => `https://ggzyjy.shandong.gov.cn/queryContent_${p}-jyxxgk.jspx?channelId=78&pageNo=1`,
        parse(html) {
          const items = [];
          const liRe = /<li\b[^>]*>([\s\S]*?)<[/]li>/gi;
          let li;
          while ((li = liRe.exec(html))) {
            const block = li[1];
            if (!/合同公示/.test(block)) continue;
            const am = block.match(/<a[^>]+href=["'](https?:[/][/]ggzyjy[.]shandong[.]gov[.]cn[^"']+[.]jhtml)["'][^>]*>([\s\S]*?)<[/]a>/i);
            if (!am) continue;
            const url = am[1];
            const title = am[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            if (title.length < 4) continue;
            const dm = block.match(/(\d{4}-\d{2}-\d{2})/);
            items.push({ url, title, date: dm ? dm[1] : "" });
          }
          return items;
        },
      },
    },
  },
  // 后续省在此追加 adapter 即可（listUrl + parse + 可选 detail），框架自动复用。
  // ===== EPoint（国泰新点）智能搜索接口系 =====
  // 特征：POST /inteligentsearch/rest/esinteligentsearch/getFullTextDataNew，返回 result.records[]
  // 优势：服务端关键词检索(wd)、自带城市字段(zhuanzai)、分页稳定(pn/rn)，无需逆向 HTML 列表
  // 实测命中：江苏、浙江、海南（2026-08-09 全国 32 站点探测，见 epoint-all.log）
  jiangsu: {
    name: "江苏省公共资源交易平台",
    verified: true,
    kind: "epoint",
    base: "http://jsggzy.jszwfw.gov.cn",
    referer: "http://jsggzy.jszwfw.gov.cn/jyxx/tradeInfonew.html?type=jsgc",
    keepScheme: true, // 实测 https 握手失败，仅 http 可达
    cats: ["003001001"], // 建设工程-招标公告/资审公告
    defaultType: "招标公告",
    // ---- B 阶段（Goal v2 · 2026-08-15 枚举）：江苏 EPoint 栏目码实测
    // candidate=003001007(中标候选人公示) / result=003001008(中标结果公告)；合同公示栏目(003004006)仅测试条目→不配
    stages: {
      candidate: { type: "中标候选人", cats: ["003001007"] },
      result:    { type: "中标结果", cats: ["003001008"] },
    },
  },
  zhejiang: {
    name: "浙江省公共资源交易服务平台",
    verified: true,
    kind: "epoint",
    base: "https://ggzy.zj.gov.cn",
    referer: "https://ggzy.zj.gov.cn/jyxxgk/002001/002001001/list.html",
    cats: ["002001001"], // 工程建设-招标公告
    sortField: "webdate", // 浙江无 infodatepx 字段，必须按 webdate 排序，否则返回按相关度排的老公告
    defaultType: "招标公告",
    // ---- B 阶段（Goal v2 · 2026-08-15 枚举）：浙江 EPoint 栏目码实测
    // candidate=002001004(中标候选人公示) / result=002001005(中标结果公示) / contract=002002004(合同公示，在002002分支)
    // 注：002001003=开标记录(非中标候选，曾盲配陷阱)
    stages: {
      candidate: { type: "中标候选人", cats: ["002001004"] },
      result:    { type: "中标结果", cats: ["002001005"] },
      contract:  { type: "合同公示", cats: ["002002004"] },
    },
  },
  hainan: {
    name: "海南省公共资源交易服务平台",
    verified: true,
    kind: "epoint",
    base: "https://ggzy.hainan.gov.cn",
    referer: "https://ggzy.hainan.gov.cn/jyxx/003001/003001002/",
    // 栏目编码与江苏/浙江**不同**（2026-08-10 实测枚举 003001001~010）：
    //   003001001 招标计划(10541) / 003001002 招标公告(31763) / 003001003 资格预审公告(161)
    //   003001004 变更 / 005 中标候选人 / 006 中标 / 007 异常 / 008~010 空
    // 原配置误用 003001001，采到的是"招标计划公告"而非招标公告。
    cats: ["003001002", "003001003"],
    // 海南与浙江同样**无 infodatepx 字段**，用默认排序会返回 2022 年老公告，
    // 近 N 天过滤后结果为 0（本次 bug 现场：-d 30 采到 0 条却不报错）。
    sortField: "webdate",
    pdfBody: false, // 详情页 HTML 即完整正文（实测 3000+ 字，无 PDF 附件），无需走 PDF 通道
    defaultType: "招标公告",
    // ---- B 阶段（Goal v2 · 2026-08-15 枚举）：海南 EPoint 栏目码实测
    // candidate=003001005(中标候选人公示) / result=003001006(中标结果公示) / contract=003002005(合同公示，在003002分支)
    stages: {
      candidate: { type: "中标候选人", cats: ["003001005"] },
      result:    { type: "中标结果", cats: ["003001006"] },
      contract:  { type: "合同公示", cats: ["003002005"] },
    },
  },
  // ===== 黑龙江（2026-08-12 实测新增 · EPoint 同构）=====
  // 关键差异：该实例顶级栏目号 cnum 必须为 "003"（默认 "001" 返回 0 条）；
  // 字段用 webdate/infodate（无 infodatepx），故 sortField=webdate；
  // 列表层含 招标/中标/变更 混合（categoryname 标注），type 由 inferType 按标题归类，不强行标"招标公告"。
  heilongjiang: {
    name: "黑龙江省公共资源交易网",
    verified: true, // 2026-08-14 修正：cnum=003 实为「政府采购」，改 002=工程建设(27万条)；且服务端 wd 检索全坏(任何关键词均 0)，改用 keywordClient 拉全量类目后客户端按标题过滤
    kind: "epoint",
    base: "https://ggzyjyw.hlj.gov.cn",
    referer: "https://ggzyjyw.hlj.gov.cn/jyfwdt/003002/003002002/list.html",
    cnum: "002", // ★ 工程建设信息（277517 条）；003=政府采购、001=空，均非建设
    cats: null, // 不锁栏目，按关键词(broad)全量检索；total 字段仅回显 rn（EPoint 怪癖），靠分页至空判止
    keywordClient: true, // ★ 黑龙江服务端 wd 检索失效（管网/工程/招标均返回 0），改拉全量类目后在 crawlRound 按标题客户端过滤
    sortField: "webdate", // 无 infodatepx 字段，按 webdate 排序才能近 N 天正确截断
    defaultType: "", // 混合类型，交由 inferType 按标题判定
    // ---- B 阶段（Goal v1）：黑龙江工程建设 中标候选人 = categorynum 003002001002（003001招标/002候选/006评标/007合同(test)）。
    // 该实例未单列"中标结果"栏目（中标候选人公示已含中标人/中标价），故仅配 candidate。
    stages: {
      candidate: { type: "中标候选人", cats: ["003002001002"] },
    },
  },
  // ===== 苏州（城市级 · 2026-08-16 V5 批次3 接入 · 静态 SSR webBuilder）=====
  // ggzy.suzhou.gov.cn：webBuilder 4.4 站，列表为 SSR 静态 HTML（页内 {{}} 是 mustache 隐藏模板行，
  // 真实数据行同在 HTML——勿被模板行误判为 JS 壳，2026-08-16 浏览器 DOM 与 curl 双证）。
  // 锁 003001001 子栏目（建设工程-招标公告）避开 003001 大类混型（提前公示/定标结果）；
  // 分页 ?pageIndex=N（1-based）。详情为静态页 /jyxx/003001/003001001/<日期>/<uuid>.html。
  suzhou: {
    name: "苏州市公共资源交易平台（城市级·静态 SSR）",
    verified: true, // 2026-08-16 实测：子栏目 4 条正式公告，标题/日期/静态链接齐
    base: "https://ggzy.suzhou.gov.cn",
    clientFilterOnly: true, // 无服务端关键词
    defaultType: "招标公告",
    listUrl: (page) => `https://ggzy.suzhou.gov.cn/jyxx/003001/003001001/tradeInfo.html?pageIndex=${page}`,
    parse(html) {
      const out = [];
      const re = /<tr class="ewb-trade-tr">[\s\S]*?<a\s+href="(\/jyxx\/[^"]+)"[^>]*title="([^"]+)"[\s\S]*?<\/tr>/g;
      let m;
      while ((m = re.exec(html))) {
        if (m[1].includes("{{")) continue;                       // mustache 模板行
        const tds = [];
        const row = m[0];
        const tdRe = /<td class="ewb-trade-td">\s*([\s\S]*?)\s*<\/td>/g;
        let td;
        while ((td = tdRe.exec(row))) tds.push(td[1].replace(/<[^>]+>/g, "").trim());
        const date = (tds.find(x => /(?:19|20)\d{2}-\d{2}-\d{2}/.test(x)) || "").match(/(?:19|20)\d{2}-\d{2}-\d{2}/)[0];
        const city = tds.find(x => x && !/^\d+$/.test(x) && !/(?:19|20)\d{2}-\d{2}-\d{2}/.test(x) && x !== m[2]) || "";
        out.push({ title: m[2], url: m[1].startsWith("http") ? m[1] : "https://ggzy.suzhou.gov.cn" + m[1], date, cityHint: city.slice(0, 12) });  // href 为站内相对路径，拼绝对
      }
      return out;
    },
  },
  // ===== 徐州（城市级 · 2026-08-18 接入 · EPoint new API + SSR 首页）=====
  // SSR 首页可直接取到 12 条，但静态 2.html 会跳到 2025-07，真正的当前分页由官网 list.js
  // POST /inteligentsearchnew/... 加载。必须走该 API，否则会漏掉首页与旧静态页之间约一年的公告。
  xuzhou: {
    name: "徐州市公共资源交易网（城市级·EPoint new API）",
    verified: true, // 2026-08-18 官方 API 实测：wd=管网 totalcount=370，返回真实详情链接
    kind: "epointX",
    base: "https://ggzy.zwb.xz.gov.cn",
    referer: "https://ggzy.zwb.xz.gov.cn/jyxx/003001/003001001/list.html",
    apiPath: "/inteligentsearchnew/rest/esinteligentsearch/getFullTextDataNew",
    cats: ["003001001"],
    rn: 12,
    defaultType: "招标公告",
    makeBody(pn, wd, cat) {
      return {
        token: "", pn, rn: String(this.rn || 12), sdt: "", edt: "",
        wd: wd || "", inc_wd: "", exc_wd: "", fields: "title",
        cnum: "002", sort: JSON.stringify({ webdate: "0" }), ssort: "title", cl: 300, terminal: "",
        condition: [{ fieldName: "categorynum", isLike: true, likeType: 2, equal: cat || "003001001" }],
        time: null, highlights: "title", statistics: null, unionCondition: null,
        accuracy: "", noParticiple: "0", searchRange: null, isBusiness: "1",
      };
    },
  },
  // ===== 安阳（城市级 · 2026-08-16 实测新增 · 标准 EPoint 范本）=====
  // 安阳市公共资源交易中心 = 独立站点 + 标准 EPoint getFullTextDataNew（与兰州/江苏同构）。
  // 实测：默认请求体 POST 返回 total=96504 条真实标讯（样本「安阳市第六中学改造工程-中标结果公告」）。
  // 省本级（河南）feed 已聚合安阳，但城市门户可独立直采——本 adapter 作为「城市级 adapter」接入范本：
  //   证明地级市独立站只要走标准 EPoint，即可零定制套用 epointList/epointPost 复用现有管线。
  anyang: {
    name: "安阳市公共资源交易中心（城市级·标准 EPoint 范本）",
    verified: true, // 2026-08-16 实测：POST getFullTextDataNew 返回 96504 条真实标讯
    kind: "epoint",
    base: "https://ggzy.anyang.gov.cn",
    referer: "https://ggzy.anyang.gov.cn/",
    // 安阳记录**无 infodatepx 字段**（同浙江/海南），默认 sort 失效→老记录在前→被 days 截止滤光。
    // 必须按 webdate 排序才能近 N 天正确截断（实测 sort:{webdate:0}=最新在前，{webdate:1}=最旧在前）。
    sortField: "webdate",
    // 2026-08-16 官方接口实测锁定 zb 栏目：001001002=工程建设招标公告，001002002=政府采购公告。
    // 不能留空：全量搜索会混入 001001004 评标结果、001001005 中标结果和 001001001 招标计划。
    // collectProvince 会将多栏目拆轮采集，避免 EPoint 同字段多 condition 仅首项生效的静默漏采。
    cats: ["001001002", "001002002"],
    // 用户验收只包含招标公告；政府采购栏目中的磋商/谈判/询价并非“招标”，必须拒绝。
    itemAllowed: (item) => !/(?:竞争性磋商|竞争性谈判|询价|单一来源)/.test(String(item && item.title || "")),
    defaultType: "招标公告",
  },
  // ===== 常州（城市级 · 2026-08-16 V5 全量测试探测新增 · 标准 EPoint 同构）=====
  // Goal v5 独立市级平台探测命中：ggzy.changzhou.gov.cn 对标准 getFullTextDataNew 返回 records（total=54479）。
  // 栏目为 12 位深层级（区别于安阳 9 位）：001001001 前缀 = 工程建设招标公告大类，末 3 位是标的类型
  // 子码——001 施工(total 1192)/002 监理设计(309)/004 设备采购(95)，均为 zb 范畴；
  // 锁前缀（contains）全量隔离 001006 产权交易（湖塘镇商铺租赁类）与 005 其他交易。
  // 真机证据：test-logs/v5-fulltest-2026-08-16/（栏目语义逐码验证 + 30 天窗口 VERIFIED_RECORD）。
  changzhou: {
    name: "常州市公共资源交易中心（城市级·标准 EPoint）",
    verified: true, // 2026-08-16 实测：total=54479；-k 管网 -d 30 真实公告 VERIFIED_RECORD
    kind: "epoint",
    base: "https://ggzy.changzhou.gov.cn",
    referer: "https://ggzy.changzhou.gov.cn/",
    sortField: "webdate", // 探针实测 webdate 排序最新在前（同安阳）
    cats: ["001001001"], // contains 前缀：工程建设招标公告全部子类（施工/监理设计/采购）
    omitFields: true,    // 常州实例对 fields 投影参数敏感：传入即静默返空（2026-08-16 二分定位实测）
    keywordClient: true, // 该实例服务端 wd 会返回无关键词记录，必须在标题层二次过滤
    defaultType: "招标公告",
  },
  // ===== 城市扩展批次（2026-08-18）：洛阳/郑州复用标准 EPoint =====
  luoyang: {
    name: "洛阳市公共资源交易中心（城市级·标准 EPoint）",
    verified: true,
    kind: "epoint",
    base: "http://lyggzyjy.ly.gov.cn",
    referer: "http://lyggzyjy.ly.gov.cn/jyxx/transaction.html",
    keepScheme: true, // 官方站当前仅 HTTP 稳定，HTTPS 握手失败
    cnum: "001",
    cats: ["003001002"], // 工程建设-招标公告
    sortField: "webdate",
    cityName: "洛阳市",
    defaultType: "招标公告",
  },
  zhengzhou: {
    name: "郑州市公共资源交易中心（城市级·标准 EPoint）",
    verified: true,
    kind: "epoint",
    base: "https://zzggzy.zhengzhou.gov.cn",
    referer: "https://zzggzy.zhengzhou.gov.cn/jsgc/004001/subpage.html",
    cnum: "012",
    cats: ["004001"],
    sortField: "webdate",
    cityName: "郑州市",
    // 官方 004001 栏目偶有“招标计划”混入；只做负面阶段守卫，不要求标题必须带“招标公告”。
    itemAllowed: (item) => !/(招标计划|采购意向)/.test(String(item && item.title || "")),
    defaultType: "招标公告",
  },
  // 绵阳列表是静态 HTML，但详情先落到 projectInfo 壳页，须经公开关系接口解析真实公告 URL。
  mianyang: {
    name: "绵阳市公共资源交易服务中心（城市级·静态列表+关系接口）",
    verified: true,
    kind: "mianyang",
    base: "https://ggzy.my.gov.cn",
    referer: "https://ggzy.my.gov.cn/myggzy/jsgc/001001/moreinfojyxx.html",
    listUrl: (page) => page === 1
      ? "https://ggzy.my.gov.cn/myggzy/jsgc/001001/moreinfojyxx.html"
      : `https://ggzy.my.gov.cn/myggzy/jsgc/001001/${page}.html`,
    categoryNum: "001001",
    clientFilterOnly: true,
    pdfBody: false, // 公告正文为完整 HTML；附件下载端点另有验证码，不能冒充公开直链
    attachmentBrowserRequired: true,
    cityName: "绵阳市",
    defaultType: "招标公告",
  },
  qinhuangdao: {
    name: "秦皇岛市公共资源交易网（城市级·静态 HTML）",
    verified: true,
    kind: "qinhuangdao",
    base: "https://www.qhdggzy.cn",
    clientFilterOnly: true,
    cityName: "秦皇岛市",
    defaultType: "招标公告",
    listUrl: (page) => page === 1
      ? "https://www.qhdggzy.cn/qhdggzy/jydt/001003/001003001/moreinfo.html"
      : `https://www.qhdggzy.cn/qhdggzy/jydt/001003/001003001/${page}.html`,
    parse(html) {
      const out = [];
      for (const block of String(html || "").match(/<li\b[^>]*class=["'][^"']*ewb-com-item[^"']*["'][^>]*>[\s\S]*?<\/li>/gi) || []) {
        const am = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        const dm = block.match(/(?:19|20)\d{2}-\d{2}-\d{2}/);
        if (!am || !dm) continue;
        const title = htmlToText(am[2]).trim();
        if (!title || /(资格预审|资审公告|变更|澄清|答疑|中标|成交|结果|合同|终止|流标|废标)/.test(title)) continue;
        out.push({ url: toAbs(am[1], this.base), title, date: dm[0], cityHint: "秦皇岛市" });
      }
      return out;
    },
  },
  nantong: {
    name: "南通市公共资源交易网（城市级·EWB-FRONT）",
    verified: true,
    kind: "nantong",
    base: "https://ggzyjy.nantong.gov.cn",
    referer: "https://ggzyjy.nantong.gov.cn/jyxx/003001/003001001/tradeInfo.html",
    siteGuid: "7eb5f7f1-9041-43ad-8e13-8fcb82ea831a",
    categoryNum: "003001001",
    rn: 15,
    clientFilterOnly: true, // 官方 title 参数当前不生效，拉栏目后客户端按关键词过滤
    cityName: "南通市",
    normalizeTitle: (title) => String(title || "").replace(/^\[新\]\s*/, "").trim(),
    defaultType: "招标公告",
  },
  // ===== 城市扩展第二批（2026-08-18）：南京/惠州/中山/济南/武汉 =====
  nanjing: {
    name: "南京市公共资源交易平台（城市级·webdb）",
    verified: true,
    kind: "nanjing",
    base: "https://njggzy.nanjing.gov.cn",
    referer: "https://njggzy.nanjing.gov.cn/njweb/fjsz/buildService1.html",
    categoryNums: ["068001001", "068001002"], // 服务类 + 工程类，均需标题阶段复核
    rn: 10,
    clientFilterOnly: true,
    cityName: "南京市",
    detail: nanjingDetail,
    defaultType: "招标公告",
  },
  huizhou: {
    name: "惠州市公共资源交易中心（城市级·静态政府站）",
    verified: true,
    kind: "huizhou",
    base: "https://zyjy.huizhou.gov.cn",
    referer: "https://zyjy.huizhou.gov.cn/ggfw/jyxx/jsgc/zbzgysgg/",
    categoryIds: ["31261", "31263", "31264", "31265", "31266", "31267", "31268", "36676"],
    clientFilterOnly: false,
    cityName: "惠州市",
    normalizeTitle: (title) => String(title || "").replace(/【(?:施工|监理|试验检测|勘察设计|工程总承包|设备材料|其他)】/g, "").trim(),
    detail: huizhouDetail,
    defaultType: "招标公告",
  },
  zhongshan: {
    name: "中山市公共资源交易平台（城市级·pageList API）",
    verified: true,
    kind: "zhongshan",
    base: "https://www.zsjypt.cn",
    referer: "https://www.zsjypt.cn/subItem/58",
    nodeId: "58",
    rn: 15,
    clientFilterOnly: false,
    pdfBody: false,
    cityName: "中山市",
    detail: zhongshanDetail,
    defaultType: "招标公告",
  },
  jinan: {
    name: "济南公共资源交易中心（城市级·建设工程 search.do）",
    verified: true,
    kind: "jinan",
    base: "https://jnggzy.jinan.gov.cn",
    referer: "https://jnggzy.jinan.gov.cn/jnggzyztb/front/noticelist.do?type=0&xuanxiang=1&area=",
    rn: 15,
    clientFilterOnly: true,
    cityName: "济南市",
    detail: jinanDetail,
    defaultType: "招标公告",
  },
  wuhan: {
    name: "武汉市公共资源交易电子服务系统（城市级·静态 CMS）",
    verified: true,
    kind: "wuhan",
    base: "https://ggzyfw.wuhan.gov.cn",
    referer: "https://ggzyfw.wuhan.gov.cn/whggzy/jygkgy/index.jhtml",
    clientFilterOnly: false, // 官方 queryContent 支持标题和日期窗口
    cityName: "武汉市",
    defaultType: "招标公告",
  },
  // ===== Goal v5 批次2：8 个城市级 adapter（2026-08-16 侦察真机验证接入；端点证据见各 reference 页）=====
  yichang: {
    name: "宜昌公共资源交易电子服务系统（城市级·EpointWebBuilder 变体）",
    verified: true, // 2026-08-16 侦察验证：getSecInfoListYzm total=4348，-k 管网 3 条真实公告
    kind: "yichang",
    base: "https://ggzy.sc.yichang.gov.cn",
    referer: "https://ggzy.sc.yichang.gov.cn/jyxx/003001/003001002/trade_info.html",
    siteGuid: "7eb5f7f1-9041-43ad-8e13-8fcb82ea831a",
    categoryNum: "003001002", // 工程建设-招标公告（003001004 中标候选人/003001005 中标结果）
    rn: 20,
    defaultType: "招标公告",
  },
  // ===== 潍坊（城市级 · 2026-08-18 接入 · EpointWebBuilder 变体）=====
  // 官方列表页虽然混排多个阶段，但 getSecInfoListYzm 可锁 007001001=招标（资格预审）公告。
  // 与宜昌同族但参数名大小写及页码语义不同：潍坊必须 pageIndex/pageSize，且首页为 0。
  weifang: {
    name: "潍坊市公共资源交易中心（城市级·EpointWebBuilder 变体）",
    verified: true, // 2026-08-18 静态官方 API 实测：90 天“管网”13 条
    kind: "weifang",
    base: "http://ggzy.weifang.gov.cn:8082",
    referer: "http://ggzy.weifang.gov.cn:8082/wfggzy/jyxx/007001/trade.html?nowid=007001001",
    siteGuid: "7eb5f7f1-9041-43ad-8e13-8fcb82ea831a",
    categoryNum: "007001001",
    rn: 20,
    keepScheme: true,
    keepPort: true,
    defaultType: "招标公告",
  },
  // ===== 青岛（城市级 · 2026-08-18 接入 · ASP.NET MVC SSR）=====
  // 0-0-0 路径由官方导航明确标作工程建设“招标公告”；ProjectName 和 Time 为官网表单参数。
  // 轻量 PartialZTBNew 不支持真实分页，只作探针，不用于正式采集。
  qingdao: {
    name: "青岛市公共资源交易电子服务系统（城市级·ASP.NET MVC SSR）",
    verified: true, // 2026-08-18 官方列表、详情与当前真实公告复核
    kind: "qingdao",
    base: "https://ggzy.qingdao.gov.cn",
    referer: "https://ggzy.qingdao.gov.cn/Tradeinfo-GGGSList/0-0-0",
    rn: 10,
    clientFilterOnly: true,
    defaultType: "招标公告",
  },
  // ===== 深圳（城市级 · 2026-08-18 接入 · CMS trade API）=====
  // 官网当前 fields/title/jsgcProjectType 服务端筛选会静默返空；按日期切片取全量后，
  // 客户端严格锁 noticeTypeName=招标公告，再做关键词/地区过滤。详情同样走公开 CMS API。
  shenzhen: {
    name: "深圳公共资源交易中心（城市级·CMS trade API）",
    verified: true, // 2026-08-18 无登录、无 token 的官方列表/详情 API 实测
    kind: "shenzhen",
    base: "https://new.szggzy.com",
    referer: "https://new.szggzy.com/mobile/jygg/list.html?id=jsgc",
    channelId: 2851,
    rn: 50,
    clientFilterOnly: true,
    defaultType: "招标公告",
  },
  linyi: {
    name: "临沂市公共资源交易中心（城市级·EPoint 双层包装）",
    verified: true, // 2026-08-16 侦察验证：wd=管网 total=153339
    kind: "sdwrap",
    base: "https://ggzyjy.linyi.gov.cn",
    referer: "https://ggzyjy.linyi.gov.cn/jyxx/trade_info.html",
    defaultType: "招标公告",
  },
  yantai: {
    name: "烟台市公共资源交易中心（城市级·EPoint 双层包装）",
    verified: true, // 2026-08-16 侦察验证：wd=管网 total=217958
    kind: "sdwrap",
    base: "https://ggzyjy.yantai.gov.cn",
    referer: "https://ggzyjy.yantai.gov.cn/",
    // 官方接口 2026-08-18 实测：003001003=工程建设招标公告，003002002=政府采购公告。
    // 原全站搜索会混入 003001011 中标结果、003002006 采购合同等非 zb 阶段记录。
    cats: ["003001003", "003002002"],
    allowedCategoryNums: ["003001003", "003002002"],
    defaultType: "招标公告",
  },
  hefei: {
    name: "全国公共资源交易平台（安徽省·合肥市）（城市级·webBuilder Service）",
    verified: true, // 2026-08-18 官方 engineer2.js 逆向 + 实时“管网”公告验证
    kind: "hefei",
    base: "https://ggzy.hefei.gov.cn",
    referer: "https://ggzy.hefei.gov.cn/jyxx/002001/engineer2.html",
    siteGuid: "7eb5f7f1-9041-43ad-8e13-8fcb82ea831a",
    categoryNum: "002001001", // 官方 JS cateStr：招标公告
    defaultType: "招标公告",
  },
  // ===== 温州（城市级 · 2026-08-18 接入 · JPaas CMS AuthorizedRead）=====
  // 主站 col1229696276 明确标注「招标公告」，列表由 AuthorizedRead/unitbuild.js 调用
  // /api-gateway/jpaas-publish-server/front/page/build/unit 匿名生成；详情正文为官方 PDF。
  // 注意：col1229666813 是瑞安分网旧栏目，不代表温州市主站，不能据此声称全市覆盖。
  wenzhou: {
    name: "温州市公共资源交易网（城市级·JPaas CMS）",
    verified: true, // 2026-08-18 官方主站栏目 + CMS 接口 + PDF 详情实时验证
    kind: "wenzhou",
    base: "https://ggzyjy-eweb.wenzhou.gov.cn",
    referer: "https://ggzyjy-eweb.wenzhou.gov.cn/col/col1229696276/index.html",
    pageId: "1229696276", // 温州市主站 工程建设-招标公告（非答疑/候选/结果）
    webId: "3819",
    tplSetId: "u6TkEPbH8M7PmFoLKwDnZ",
    tagId: "资料list",
    rn: 10,
    clientFilterOnly: true, // CMS unit 接口无可靠标题检索参数，按发布日期分页后客户端过滤
    defaultType: "招标公告",
  },
  // ===== 宁波（城市级 · 2026-08-18 接入 · SPA websiteapi）=====
  // 官方前端不是账号认证：登录页在滑块通过后，以当前北京时间字符串双层 Base64 生成临时访客 token。
  // 携该 token 可匿名访问 /websiteapi；getCmsType 实测 020105=工程建设-招标公告。
  ningbo: {
    name: "宁波市公共资源交易电子服务系统（城市级·websiteapi）",
    verified: true, // 2026-08-18 官方前端 token 逻辑 + 020105 栏目 + articleList/getArticle 实时验证
    kind: "ningbo",
    base: "https://jyxt.zwb.ningbo.gov.cn:4011",
    referer: "https://jyxt.zwb.ningbo.gov.cn:4011/website/construction",
    channel: "020105", // getCmsType(pcode=0201) 官方返回 type_name=招标公告
    projectType: "A",  // 工程建设全部行业
    rn: 12,
    keepPort: true,     // 官方服务只在 :4011；normUrl 不得剥端口
    defaultType: "招标公告",
  },
  // ===== 嘉兴（城市级 · 2026-08-18 接入 · JPaas CMS AuthorizedRead）=====
  // 建设工程 col1229743509 页面 meta 明确 ColumnName=招标公告；列表使用 JPaas unitbuild 匿名生成。
  // 与温州同属 JPaas，但列表项 class 是 wb-data-list（温州为 cf），须单独解析，不能假设模板同构。
  jiaxing: {
    name: "嘉兴市公共资源交易网（城市级·JPaas CMS）",
    verified: true, // 2026-08-18 官方栏目、unitbuild 接口与当前真实公告验证
    kind: "jiaxing",
    base: "https://jxszwsjb.jiaxing.gov.cn",
    referer: "https://jxszwsjb.jiaxing.gov.cn/col/col1229743509/index.html",
    pageId: "1229743509", // 建设工程-招标公告
    webId: "3856",
    tplSetId: "qs3Pt5ZSPt8UZss6yAknP",
    tagId: "信息list",
    rn: 18,
    clientFilterOnly: true,
    defaultType: "招标公告",
  },
  wuxi: {
    name: "无锡市公共资源交易中心（城市级·webBuilder AJAX）",
    verified: true, // 2026-08-16 侦察验证：chanId=53051 total=7180
    kind: "wuxi",
    base: "https://ggzyjy.wuxi.gov.cn",
    referer: "https://ggzyjy.wuxi.gov.cn/wxsggzyjyzxzl/jyxx/jsgc/zbgg/gcl/index.shtml",
    chanId: "53051", // 建设工程-招标公告-工程类栏目
    clientFilterOnly: true, // 无服务端关键词参数
    defaultType: "招标公告",
  },
  quanzhou: {
    name: "泉州市公共资源交易中心（城市级·Java .do）",
    verified: true, // 2026-08-16 侦察验证：total=8982；全站搜索"管网"命中 2684
    kind: "quanzhou",
    base: "http://ggzyjy.quanzhou.gov.cn", // 全站 http（内部链接均 http）
    referer: "http://ggzyjy.quanzhou.gov.cn/project/projectList.do?centerId=-1",
    keepScheme: true, // 保 http（normUrl 默认强制 https）
    clientFilterOnly: true, // projName 服务端过滤实测无效
    defaultType: "招标公告",
  },
  yueyang: {
    name: "岳阳市公共资源交易中心（城市级·静态 CMS·GBK）",
    verified: true, // 2026-08-16 侦察验证：招标公告栏目约 5700 条（285 页×20）
    kind: "yueyang",
    base: "https://ggzy.yueyang.gov.cn",
    gbkDetail: true, // 详情页 charset=gb2312：UTF-8 解码乱码致厚字段全空（实测），走 TextDecoder("gbk")
    clientFilterOnly: true, // 无服务端关键词
    defaultType: "招标公告",
  },
  zunyi: {
    name: "遵义市公共资源交易（城市级·贵州省平台视角过滤）",
    verified: true, // 2026-08-16 侦察验证：docSourceName=遵义市+管网 total=1982
    kind: "zunyi",
    base: "https://ggzy.guizhou.gov.cn", // 数据源=省平台（市站本体为 TRS SSR 通知栏）
    defaultType: "招标公告",
  },
  yibin: {
    name: "宜宾市公共资源交易中心（城市级·筑龙 SPA 网关）",
    verified: true, // 2026-08-16 侦察验证：xinXi_LeiXing=102 total=7952，管网命中 266
    kind: "yibin",
    base: "https://ggzy.yibin.gov.cn",
    allowNoUrl: true, // 详情为 SPA hash 路由无直链（部分记录带 gongGao_URL 外链则用之），列表层诚实不伪造
    defaultType: "招标公告",
  },
  // ===== 定西（城市级 · 2026-08-16 实测新增 · 标准 EPoint · infodate 排序变体）=====
  // 定西市公共资源交易中心 = 独立站点 + 标准 EPoint getFullTextDataNew（端点与 Anyang/兰州同构，kind=epoint 复用 epointList/epointPost，零定制）。
  // 实测（沙箱可达，200）：默认请求体 POST 返回 total=4621 条真实标讯；cats=["004"] 隔离交易类 3875 条（剔除 009 新闻中心/030 业务动态）。
  // 范本外覆盖点（本 adapter 验证的三件事）：
  //   ① 该实例**无 infodatepx/webdate/infodateformat** 字段，日期仅在 infodate 列。
  //      webdate/infodatepx 排序静默失效 → 返回 2018 年老记录在前 → 被 days 截止滤光得 0 条；
  //      必须 sortField:"infodate"（{infodate:0}=最新在前 / {infodate:1}=最旧在前，已实测）。这是继 infodatepx/webdate/showdate 后的**第 4 种** sortField。
  //   ② epointList 日期回退链 infodateformat||infodatepx||webdate||infodate 已含 infodate → 零代码改动即可正确读日期。
  //   ③ 分类体系与兰州(002001001)不同，categorynum 前缀 contains "004" 隔离标讯（likeType:2 实测生效），与 Lanzhou unionCondition 范式并列。
  // ⚠ 真实局限（诚实标注，不做近期来源）：该门户最新数据停在 2023-04-23，2024/2025/2026 全库 0 条 → days:30 实跑返回 0；
  //   仅证明"可达城市级 EPoint + infodate 排序变体"可接入，覆盖第 4 种 sortField。
  dingxi: {
    name: "定西市公共资源交易中心（城市级·标准 EPoint·infodate 排序变体）",
    verified: true, // 2026-08-16 实测：POST getFullTextDataNew total=4621；cats=004 隔离交易类 3875 条；最新数据 2023-04-23
    kind: "epoint",
    base: "https://ggzy.dingxi.gov.cn",
    referer: "https://ggzy.dingxi.gov.cn/",
    // 定西实例无 infodatepx/webdate，日期在 infodate 列；webdate/infodatepx 排序失效→2018 老记录在前。须 infodate 排序（第 4 种 sortField）。
    sortField: "infodate",
    cats: ["004"], // categorynum 前缀 contains 004 = 交易类，隔离 009 新闻/030 业务动态，仅取标讯
    defaultType: "招标公告",
  },
  // ===== 广东（粤公平 · 2026-08-12 集成 · 独立 API，非 EPoint）=====
  // 数据源: POST https://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items （SPA 内部接口）
  // 官方前端公开详情接口：singleNode + detail；附件元数据来自 noticeFileBOList。
  // 限流防护: 内置 429/5xx 指数退避 + 自适应降速；验证码只记录，不绕过。
  guangdong: {
    name: "广东省公共资源交易平台（粤公平）",
    verified: true,
    kind: "ygp",
    cities: GD_CITIES,
    cityCodes: GD_CITY_TARGETS,
    category: "A", // A=工程建设
    tradingProcess: "3C14", // 招标公告、资格预审公告；zb 再以公告性质+标题守卫剔除资审/更正
    defaultType: "招标公告",
    attachmentFields: ["controlPrice", "budget", "bond", "scale", "scope", "evaluation", "fullScore"],
    // ---- B 阶段（2026-08-15 深挖）：粤公平 trading-type 用 tradingProcess 隔离：候选=3C51(中标候选人公示,5798条)/结果=3C52(中标结果,3814条)；
    //   3C53~3C60 实测均 0 条 → 无独立合同公示栏目，诚实不配 contract；列表 row 无 winner/winPrice（详情需 SPA 内部码）→ 诚实空；
    //   owner/partyA 改取 row.projectOwner（原映射漏该字段致招标人恒空）。 ----
    stages: {
      candidate: { type: "中标候选人", tradingProcess: "3C51" },
      result:    { type: "中标结果",   tradingProcess: "3C52" },
    },
  },
  // ===== 河南（真公告接口 · 2026-08-15 修正）=====
  // 修正：原 adapter 误走 EPoint 全文档案库索引(cnum=001 返回文件名，linkurl 恒空)，不适用公告页级采集。
  // 现改真公告数据源：POST /EpointWebBuilder/rest/frontAppCustomAction/getPageInfoListNewYzm
  // 参数：siteGuid(固定) / categoryNum(栏目码, stage 覆盖) / xiaqucode(4100=全省) / pageIndex / pageSize
  // 返回 custom.infodata[].{title, infourl, infodate}，infourl 为真实详情链接（B 阶段 5 省枚举之一）
  henan: {
    name: "河南省公共资源交易（工程建设公告）",
    verified: true, // 2026-08-15 修正：原 adapter 误走档案库索引(cnum=001 返回文件名)，现改真公告接口 getPageInfoListNewYzm
    kind: "henanNotice", // 真公告数据源（epointList 档案库索引不适用）
    base: "https://hnsggzyjy.henan.gov.cn",
    referer: "https://hnsggzyjy.henan.gov.cn/",
    siteGuid: "7eb5f7f1-9041-43ad-8e13-8fcb82ea831a", // 真公告接口固定 siteGuid
    xiaqucode: "4100", // 省级（河南全省）
    rn: 8, // 验证码网关：前 6 页(pageSize=8→48条)免验证，深翻页受限
    categoryNum: "002001001", // 工程建设-招标公告(默认 ZB)
    defaultType: "招标公告",
    // ---- B 阶段（2026-08-15 枚举·真公告接口）：候选=002001003(评标结果公示/中标候选人公示)/结果=002001006(中标结果公告)；工程建设无独立合同栏目→不配 contract ----
    stages: {
      candidate: { type: "中标候选人", categoryNum: "002001003" },
      result:    { type: "中标结果",   categoryNum: "002001006" },
    },
  },
  anhui: {
    name: "安徽省公共资源交易中心",
    verified: true, // 2026-08-14 复核：原 listUrl 带 time=1（今天过滤）把 2161 页压成 1 页；去掉后恢复全量
    kind: "ah", // 详情正文为 jQuery AJAX 分块加载（/jsgc/newDetailSub），需 bespoke ahDetail
    base: "https://ggzy.ah.gov.cn",
    // 建设工程列表：表单翻页，隐藏字段 currentPage（pagination() 函数提交 #search1）
    // 注意：time=1 = 仅今天，会漏掉历史；tenderProjectType=1 = 建设工程
    listUrl: (page) => `https://ggzy.ah.gov.cn/jsgc/list?tenderProjectType=1&bulletinNature=1&currentPage=${page}`,
    parse(html) {
      const items = [];
      const liRe = /<li class=["']list-item["'][^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(html))) {
        const block = li[1];
        const am = block.match(/<a[^>]+href=["']([^"']*\/jsgc\/newDetail\?guid=[^"']+)["'][^>]*>/i);
        if (!am) continue;
        const url = "https://ggzy.ah.gov.cn" + am[1];
        const area = (block.match(/class=["']area[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [,""])[1].replace(/<[^>]+>/g, " ").trim();
        const titleAll = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        // 列表 <li> 文本含日期 span，去 area 后仍残留「… 2026-08-14」尾巴（2026-08-15 实测 23/23），剥离之
        const title = ((titleAll.replace(area, "").trim()).replace(/\s*\d{4}-\d{2}-\d{2}\s*$/, "").trim()) || titleAll;
        const dm = block.match(/(\d{4}-\d{2}-\d{2})/);
        items.push({ url, title: (area + " " + title).trim(), date: dm ? dm[1] : "" });
      }
      return items;
    },
    // ---- B 阶段（Goal v1）：中标候选人(bn=2)/中标结果(bn=3)；bn=4 实际为城市筛选器非合同公告，故不配 contract ----
    stages: {
      candidate: { type: "中标候选人", listUrl: (page) => `https://ggzy.ah.gov.cn/jsgc/list?tenderProjectType=1&bulletinNature=2&currentPage=${page}` },
      result:    { type: "中标结果", listUrl: (page) => `https://ggzy.ah.gov.cn/jsgc/list?tenderProjectType=1&bulletinNature=3&currentPage=${page}` },
    },
  },
  // ===== 缺口二·同构族批量适配（2026-08-11 指纹 v3 直击 EPoint 接口，复用 epoint 框架）=====
  sichuan: {
    name: "四川省公共资源交易信息网",
    verified: true, // 2026-08-11 r2 实测：65 条/30 docLink/2 金额命中(南江县龙池河管网 控制价3000万·概算4547.59万·保证金0.8万)，误抓清零
    kind: "epoint",
    base: "https://ggzyjy.sc.gov.cn",
    referer: "https://ggzyjy.sc.gov.cn/jyxx/002001/002001001/",
    cats: ["003001002", "002001001"], // 建设工程-招标公告 / 工程建设-招标公告(均实测有管网命中)
    sortField: "webdate",
    defaultType: "招标公告",
    // ---- B 阶段（Goal v2 · 2026-08-15 枚举）：四川 EPoint 栏目码实测（全在 00200100x 分支）
    // candidate=002001006(中标候选人公示) / result=002001008(中标结果公示) / contract=002001007(合同公示)
    stages: {
      candidate: { type: "中标候选人", cats: ["002001006"] },
      result:    { type: "中标结果", cats: ["002001008"] },
      contract:  { type: "合同公示", cats: ["002001007"] },
    },
  },
  xinjiangbt: {
    name: "新疆生产建设兵团公共资源交易中心",
    verified: true, // 2026-08-12 端到端验证：EPoint API 直击可用(cat 004xxx)，公路13条真实列表+详情页全200
    // 诚实留空已证伪漏抓：抽 10 条招标公告，controlPrice/bond/budget 全 0，每条均只含政策模板段
    // 「电子保函缴纳投标保证金…」(无具体金额数字)；docLink=0 系招标文件需CA登录领 .BTTF 网关制。
    // grabMoneyWan 正确拒绝无数字模板段＝诚实行为，非代码缺陷。
    kind: "epoint",
    base: "https://ggzy.xjbt.gov.cn",
    referer: "https://ggzy.xjbt.gov.cn/jygk/004001/004001001/",
    // 新疆兵团分类编码为 004xxx（与苏浙琼的 003xxx 不同）：
    //   004001001001 招标公告(1341) / 004001001002 资格预审 / 004001002xxx 中标候选·结果·澄清
    cats: ["004001001001"], // 建设工程-招标公告
    sortField: "webdate",
    keywordClient: true, // 该实例 wd 服务端关键词检索失效，改拉全量后按标题客户端过滤
    defaultType: "招标公告",
    // ---- B 阶段（Goal v2 · 2026-08-15 枚举）：新疆兵团 EPoint 栏目码实测
    // candidate=004001002003(中标候选人公示) / result=004001003004(中标结果公告，在003分支)；合同公示未探到真实栏目→不配
    stages: {
      candidate: { type: "中标候选人", cats: ["004001002003"] },
      result:    { type: "中标结果", cats: ["004001003004"] },
    },
  },
  // ===== 2026-08-13 bespoke 逆向·批次 D（藏陕甘青宁新）=====
  // 西藏：Jeecms 服务端渲染列表，curl + 正则即可（HTML_SCRAPE，零鉴权）
  xizang: {
    name: "西藏自治区公共资源交易平台",
    verified: true, // 2026-08-13 bespoke 实测：jyxxgcgg.jhtml SSR 列表返回真实标题+日期，无登录/无 token
    kind: "xizang", // 详情正文 AJAX 加载（/personalitySearch/initDetailbyProjectCode），需 bespoke xizangDetail
    base: "https://ggzy.xizang.gov.cn",
    listUrl: (page) => page === 1
      ? "https://ggzy.xizang.gov.cn/jyxxgcgg.jhtml"
      : `https://ggzy.xizang.gov.cn/jyxxgcgg_${page}.jhtml`,
    defaultType: "招标公告", // 招标公告栏目(3541)；总览 jyxxgc.jhtml(3540) 混合类型
    parse(html) {
      const items = [];
      const re = /window\.open\('(\/jyxx[a-z]+\/\d+\.jhtml)'\)"[^>]*>\s*<span[^>]*>\s*<\/span>\s*<span[^>]*>([^<]+)<\/span>\s*<\/p>\s*<p>(\d{4}-\d{2}-\d{2})<\/p>/g;
      let m;
      while ((m = re.exec(html))) {
        const url = "https://ggzy.xizang.gov.cn" + m[1];
        const title = m[2].replace(/\s+/g, " ").trim();
        const date = m[3];
        if (title.length < 4) continue;
        items.push({ url, title, date });
      }
      return items;
    },
    // ---- B 阶段（Goal v1）：中标候选人 = jyxxgchxr（与招标公告 jyxxgcgg 同源解析）；
    // 中标结果 = jyxxgcjg（该栏目疑似 AJAX 渲染，SSR 列表可能为空，属诚实空，不伪造）。
    stages: {
      candidate: { type: "中标候选人", listUrl: (page) => page === 1 ? "https://ggzy.xizang.gov.cn/jyxxgchxr.jhtml" : `https://ggzy.xizang.gov.cn/jyxxgchxr_${page}.jhtml` },
      result:    { type: "中标结果", listUrl: (page) => page === 1 ? "https://ggzy.xizang.gov.cn/jyxxgcjg.jhtml" : `https://ggzy.xizang.gov.cn/jyxxgcjg_${page}.jhtml` },
    },
  },
  // 陕西：Vue SPA 定制 JSON 接口（仅最新 10 条，http 可达；搜索/详情需图形验证码）
  shaanxi: {
    name: "陕西省采购与招标公共服务平台（sntba）",
    verified: true, // 2026-08-13 bespoke 实测：/home-api/home/notice/list-es 匿名返回真实标题+日期（受限：仅最新10条、翻页被忽略）
    kind: "sntba",
    base: "http://www.sntba.com", // https 被代理 TLS 拦截，仅 http 可达
    keywordBlind: true, // 服务端无关键词检索（搜索需图形验证码）、仅最新 10 条 → 无法按"管网"过滤，正常采集该源对管网关键词返回 0（诚实，不污染报告）
    defaultType: "招标公告",
    allowNoUrl: true, // 列表接口不暴露详情 URL（详情需验证码），列表层诚实不抓详情
  },
  // 宁夏：自定义新点路径 /interface_wz/，匿名可用，pn=offset，sort 为 JSON 字符串
  ningxia: {
    name: "宁夏回族自治区公共资源交易网",
    verified: true, // 2026-08-13 bespoke 实测：/interface_wz/rest/esinteligentsearch/getFullTextDataNew 返回真实管网记录
    kind: "epointX",
    base: "https://ggzyjy.fzggw.nx.gov.cn",
    apiPath: "/interface_wz/rest/esinteligentsearch/getFullTextDataNew",
    referer: "https://ggzyjy.fzggw.nx.gov.cn/",
    cats: ["001001001001"], // 工程建设-招标公告
    rn: 10,
    makeBody(pn, wd, cat) {
      return {
        token: "", pn, rn: String(this.rn), wd, fields: "title", cnum: "",
        sort: '{"webdate":"0","id":"0"}', cl: 10000,
        condition: [{ fieldName: "categorynum", equal: cat, notEqual: null, equalList: null, notEqualList: null, isLike: true, likeType: 2 }],
        unionCondition: [], time: null, noWd: false, isBusiness: "1",
      };
    },
    defaultType: "招标公告",
    // B 阶段栏目码（2026-08-14 epointX 探针实测：关键词反查 + 单码验证，全部读真实返回标题确认）
    stages: {
      candidate: { type: "中标候选人", cats: ["001001001004"] }, // 工程建设-中标候选人公示
      result:    { type: "中标结果", cats: ["001001001003"] }, // 工程建设-中标结果公示
      contract:  { type: "合同公示", cats: ["001001001006"] }, // 工程建设-合同信息公示
    },
  },
  // 新疆（本级）：自定义新点路径 /inteligentsearchnew/，匿名可用，pn=offset（标准 /EpointWebBuilder/ 路径 401）
  xinjiang: {
    name: "新疆维吾尔自治区公共资源交易网",
    verified: true, // 2026-08-13 bespoke 实测：/inteligentsearchnew/rest/esinteligentsearch/getFullTextDataNew 返回真实管网记录（title 含<em>高亮需 strip）
    kind: "epointX",
    base: "https://ggzy.xinjiang.gov.cn",
    apiPath: "/inteligentsearchnew/rest/esinteligentsearch/getFullTextDataNew",
    referer: "https://ggzy.xinjiang.gov.cn/",
    cats: ["001001001"], // 工程建设-招标公告
    rn: 10,
    makeBody(pn, wd, cat) {
      return {
        token: "", pn, rn: String(this.rn), wd, inc_wd: "", exc_wd: "",
        fields: "title;projectnum;projectname", cnum: "",
        sort: '{"webdate":"0"}', ssort: "title", cl: 200,
        condition: JSON.stringify([{ equal: cat, equalList: null, fieldName: "categorynum", notEqual: null, notEqualList: null }]),
        time: null, highlights: "title", statistics: null, unionCondition: null,
        accuracy: "100", noParticiple: "0", searchRange: null,
      };
    },
    defaultType: "招标公告",
    // B 阶段栏目码（2026-08-14 epointX 探针实测：多关键词反查 + 单码验证，全部读真实返回标题确认）
    stages: {
      candidate: { type: "中标候选人", cats: ["001001004"] }, // 工程建设-中标候选人公示
      result:    { type: "中标结果", cats: ["001001005"] },   // 工程建设-中标结果公示
      // 合同：新疆工程建设未单独发布合同公示栏目（关键词/单码扫描均未探到 00100100x 合同类）→ 不配 contract（诚实）
    },
  },
  // ===== 2026-08-13 bespoke 逆向·批次 C（湘桂+渝黔滇）+ 批次 B（赣闽鄂+吉 共 4）=====
  // 以下 9 省均经 bespoke 逆向实测：公开可达、免登录/token，返回真实标题+日期。
  // 诚实约定：列表接口"无关键词搜索参数"的省标 clientFilterOnly（采集时按标题客户端过滤）；
  // verify 阶段对其免关键词，仅验证"端点返回真实记录"（与 shaanxi keywordBlind 同机制，不污染真实采集）。
  // 江西：主站公开 EPoint 接口，但路径为 /XZinterface/ 而非标准 /inteligentsearch/
  jiangxi: {
    name: "江西省公共资源交易网（主站公开检索）",
    verified: true, // 2026-08-13 bespoke 实测：/XZinterface/rest/esinteligentsearch/getFullTextDataNew 免登录返回真实记录
    kind: "epointX",
    base: "https://ggzy.jiangxi.gov.cn",
    apiPath: "/XZinterface/rest/esinteligentsearch/getFullTextDataNew",
    referer: "https://ggzy.jiangxi.gov.cn/jyxx/trade.html?catetype=jygg",
    cats: null, // 由 makeBody 用全量 equalList（各交易公告品目），单轮全量拉取
    rn: 10,
    keywordClient: true, // 该实例 noWd:true（服务端忽略 wd），拉全量后按标题客户端过滤
    clientFilterOnly: true, // verify 免关键词：端点返回真实记录即可，采集时按标题客户端过滤
    defaultType: "招标公告",
    makeBody(pn, wd, cat) {
      const equalList = ["002001001","002002002","002003001","002004001","002005001","002006001","002007001","002008001","002009001","002010001","002011001","002013001","002015001","002016001","002017001","002021001","002019001","002018001","002020001"];
      return {
        token: "", pn, rn: String(this.rn), sdt: "", edt: "",
        wd: "", inc_wd: "", exc_wd: "", fields: "", cnum: "",
        sort: '{"webdate":"0","id":"0"}', ssort: "", cl: 500, terminal: "",
        condition: [{ equal: null, equalList, fieldName: "categorynum", notEqual: null, notEqualList: null }],
        time: null, highlights: "", statistics: null, unionCondition: null,
        accuracy: "", noParticiple: "1", searchRange: null, noWd: true,
      };
    },
    // B 阶段栏目码（2026-08-14 epointX 探针实测：江西 noWd 无法关键词检索，故 hypothesized 单码 + equalList 覆盖验证，
    // 读真实返回标题确认；002001002=答疑 003=招标文件 004=中标候选人 005=中标结果 006=招标计划 007+=空）
    // 注意：江西 makeBody 忽略 cat（固定 equalList 全量招标公告），故每个 stage 覆写 makeBody 锁定单码。
    stages: {
      candidate: {
        type: "中标候选人",
        cats: ["002001004"],
        makeBody(pn, wd, cat) {
          return {
            token: "", pn, rn: String(this.rn), sdt: "", edt: "",
            wd: "", inc_wd: "", exc_wd: "", fields: "", cnum: "",
            sort: '{"webdate":"0","id":"0"}', ssort: "", cl: 500, terminal: "",
            condition: [{ equal: null, equalList: ["002001004"], fieldName: "categorynum", notEqual: null, notEqualList: null }],
            time: null, highlights: "", statistics: null, unionCondition: null,
            accuracy: "", noParticiple: "1", searchRange: null, noWd: true,
          };
        },
      },
      result: {
        type: "中标结果",
        cats: ["002001005"],
        makeBody(pn, wd, cat) {
          return {
            token: "", pn, rn: String(this.rn), sdt: "", edt: "",
            wd: "", inc_wd: "", exc_wd: "", fields: "", cnum: "",
            sort: '{"webdate":"0","id":"0"}', ssort: "", cl: 500, terminal: "",
            condition: [{ equal: null, equalList: ["002001005"], fieldName: "categorynum", notEqual: null, notEqualList: null }],
            time: null, highlights: "", statistics: null, unionCondition: null,
            accuracy: "", noParticiple: "1", searchRange: null, noWd: true,
          };
        },
      },
      // 合同：江西工程建设未单独发布合同公示栏目（00200100x 仅至 006=招标计划，007+ 为空）→ 不配 contract（诚实）
    },
  },
  // 湖南：湖南省公共资源交易服务平台（Vite SPA，真实工程建设招标公告源）
  // 原 adapter 误指"湖南省招标投标监管网"的"通知公告"栏目（非招标公告、源站限流），2026-08-14 复核纠正。
  hunan: {
    name: "湖南省公共资源交易服务平台·工程建设招标公告",
    verified: true, // 2026-08-14 bespoke 实测：GET /tradeApi/constructionTender/listByFile?notice=0&tenderProjectType=CONSTRUCTION&current=N&size=M 返回真实工程建设招标公告(标题+日期)
    kind: "hn",
    base: "https://www.hnsggzy.com", // 生产交易 API 基址 = base + /tradeApi（https 可达，无需 cookie）
    apiPath: "/tradeApi/constructionTender/listByFile", // getTradeList：服务端按 notice=0 过滤招标/资审公告
    notice: "0",                 // 招标/资审公告（服务端 notice 过滤，返回纯 ZHAOBIAO_NOTICE）
    tenderProjectType: "CONSTRUCTION", // 工程建设子列（去掉则取全省各行业：total≈64890）
    rn: 20,                      // 每页条数 → size
    clientFilterOnly: true,  // 服务端按 notice/tenderProjectType 过滤"公告类型"；关键词(管网等)仍由 crawlRound 客户端按标题过滤（与 html 等 bespoke kind 一致）
    defaultType: "招标公告",
    // B 阶段（2026-08-15 深挖）：listByFile 用 notice 隔离阶段（实测映射）：
    //   notice=2=ZHONGBIAOHXR_NOTICE(中标候选人公示,25319条) / notice=3=ZHONGBIAO_NOTICE(中标结果公示,23590条)；
    //   notice=0 招标/1 变更/4·5 暂停/7 澄清/8 plan/9·10 终止/11 重新招标；合同公示不在 notice 0-11 → 诚实不配 contract。
    //   详情复用 hnDetail（constructionTender/getBySectionId + constructionNotice/getBySectionId）取 招标人/控制价等；
    //   中标人/中标价需中标公示正文，constructionNotice/getBySectionId 对本 section 仅回招标/澄清（中标公示未并入）→ winner/winPrice 诚实空。
    stages: {
      candidate: { type: "中标候选人公示", notice: "2" },
      result:    { type: "中标结果公示",   notice: "3" },
    },
  },
  // 广西：招标投标公共服务平台 HTML 列表服务端渲染（http://zbtb.gxi.gov.cn:9000）
  guangxi: {
    name: "广西壮族自治区招标投标公共服务平台",
    verified: true, // 2026-08-13 bespoke 实测：bulletinList.html 服务端渲染返回真实招标公告(标题+日期)
    kind: "html",
    base: "http://zbtb.gxi.gov.cn:9000", // https 本环境 TLS 握手失败，仅 http:9000 可达
    keepScheme: true, keepPort: true, // 保留 http 与非标端口 9000
    listUrl: (page) => `http://zbtb.gxi.gov.cn:9000/xxfbcms/category/bulletinList.html?categoryId=88&page=${page}&dates=300`,
    clientFilterOnly: true, // 无服务端关键词检索，采集时按标题客户端过滤
    defaultType: "招标公告",
    // ---- B 阶段（2026-08-15 枚举）：广西 zbtb 栏目 categoryId：候选=91(中标候选人公示)/结果=90(中标结果公示)；无独立合同公示栏目→不配 contract ----
    stages: {
      candidate: { type: "中标候选人", listUrl: (page) => `http://zbtb.gxi.gov.cn:9000/xxfbcms/category/bulletinList.html?categoryId=91&page=${page}&dates=300` },
      result:    { type: "中标结果",   listUrl: (page) => `http://zbtb.gxi.gov.cn:9000/xxfbcms/category/bulletinList.html?categoryId=90&page=${page}&dates=300` },
    },
    parse(html) {
      const items = [];
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let tr;
      while ((tr = trRe.exec(html))) {
        const block = tr[1];
        const am = block.match(/href="javascript:urlOpen\('([^']+)'\)"[^>]*title="([^"]*)"[^>]*>([^<]*)<\/a>/i);
        if (!am) continue;
        const url = am[1];
        const title = (am[2] || am[3] || "").replace(/\s+/g, " ").trim();
        if (title.length < 4) continue;
        const idm = block.match(/id="(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?)"/);
        const dm = block.match(/(\d{4}-\d{2}-\d{2})(?:\s+\d{2}:\d{2}:\d{2})?/);
        const date = idm ? idm[1].slice(0, 10) : (dm ? dm[1] : "");
        items.push({ url, title, date });
      }
      return items;
    },
  },
  // 重庆：Nuxt SSR 站点 /trade/014001 服务端直出（Cloudflare 偶发 521，需浏览器 UA + 重试）
  chongqing: {
    name: "重庆市公共资源交易中心",
    verified: true, // 2026-08-15 复测：沙箱代理直连 /trade/014001?categoryNum=014001001 返回 HTTP 200 + 真实招标公告（此前 Cloudflare 521 为瞬时/出口问题，现已可达）
    // envLimited 已解除（2026-08-15 复测）
    kind: "cq",
    base: "https://www.cqggzy.com",
    listUrl: (page) => `https://www.cqggzy.com/trade/014001?categoryNum=014001001&date=all&pageNum=${page}`,
    clientFilterOnly: true, // 无服务端关键词检索，采集时按标题客户端过滤
    defaultType: "招标公告",
    // ---- B 阶段（Goal v2 · 2026-08-15 真机枚举 014001 栏目树）：001=招标公告 002=答疑补遗 003=中标候选人公示 004=中标结果公示 005=办事指南（无独立合同公示栏目→诚实不配 contract）----
    stages: {
      candidate: { type: "中标候选人", listUrl: (page) => `https://www.cqggzy.com/trade/014001?categoryNum=014001003&date=all&pageNum=${page}` },
      result:    { type: "中标结果",   listUrl: (page) => `https://www.cqggzy.com/trade/014001?categoryNum=014001004&date=all&pageNum=${page}` },
    },
    parse(html) {
      const items = [];
      const re = /href="(\/trade\/014001\/[^"]+)"[^>]*>([^<]+)<\/a><\/div>\s*(\d{4}-\d{2}-\d{2})/g;
      let m;
      while ((m = re.exec(html))) {
        const url = "https://www.cqggzy.com" + m[1];
        const title = m[2].replace(/\s+/g, " ").trim();
        if (title.length < 4) continue;
        items.push({ url, title, date: m[3] });
      }
      return items;
    },
  },
  // 贵州：Knockout SPA 后端 JSON GET /api/trade/search（http://ztb.guizhou.gov.cn，region 须 5200）
  guizhou: {
    name: "贵州省招标投标公共服务平台",
    verified: true, // 2026-08-13 bespoke 实测：/api/trade/search 免登录返回真实招标公告(标题+日期)，支持关键词
    kind: "gz",
    base: "http://ztb.guizhou.gov.cn", // https 本环境 TLS 握手失败，仅 http 可达
    keepScheme: true,
    region: "5200", // 必须 5200（"不限"），region=all 返回 0
    prjType: "A", // 工程建设（A01 招标公告 / A03 中标候选人 / A04 中标结果 均须 prjType=A）
    noticeType: "A01", // 招标公告（2026-08-14 复核：affiche 实为「招标计划」，A01 才是招标公告）
    rn: 10,
    attachmentFields: ["controlPrice", "budget", "bond", "scale", "scope", "evaluation", "fullScore"],
    defaultType: "招标公告", // 服务端关键词检索（args 参数），无需客户端过滤
    // B 阶段（2026-08-14 真机枚举 vm/tradeviewmodel.js + /api/trade/search 验证）：
    //   candidate=A03 中标候选人公示、result=A04 中标结果公示；
    //   contract=A04.2 合同公示（前端已注释、接口返回 0 → 诚实不配）
    stages: {
      candidate: { type: "中标候选人", noticeType: "A03" },
      result:    { type: "中标结果",   noticeType: "A04" },
    },
  },
  // 云南：Vue SPA 后端 REST POST JSON /jyzyCenter/jyInfo/gcjs/getZbggList（https 正常）
  yunnan: {
    name: "云南省公共资源交易信息网",
    verified: true, // 2026-08-13 bespoke 实测：getZbggList 免登录返回真实工程建设招标公告(标题+日期)
    kind: "yn",
    base: "https://ggzy.yn.gov.cn",
    rn: 10,
    clientFilterOnly: true, // 列表接口无关键词参数，采集时按标题客户端过滤
    allowNoUrl: true, // B 阶段端点字段仍可能没有详情 URL；zb 阶段由 guid 构造官方 findZbggByGuid 链接
    attachmentFields: ["controlPrice", "budget", "bond", "scale", "scope", "evaluation", "fullScore"],
    defaultType: "招标公告",
    // B 阶段（2026-08-14 真机枚举 app.js gcjs/*List + 记录结构验证）：
    //   candidate=getZbwjygsList(tenderProjectName/publishTime)、result=getZbJgGgList(bulletinname/bulletinissuetime)、contract=getContractList(contractName/gongshiTime)
    stages: {
      candidate: { type: "中标候选人", gcjsEndpoint: "getZbwjygsList", titleField: "tenderProjectName", dateField: "publishTime" },
      result:    { type: "中标结果",   gcjsEndpoint: "getZbJgGgList",   titleField: "bulletinname",      dateField: "bulletinissuetime" },
      contract:  { type: "合同公示",   gcjsEndpoint: "getContractList",  titleField: "contractName",     dateField: "gongshiTime" },
    },
  },
  // 湖北：EpointWebBuilder 风格但列表走自建 /jyxxAjax/ JSON（POST form，无关键词，仅 area 过滤）
  hubei: {
    name: "湖北省公共资源交易（定制 /jyxxAjax/ 接口）",
    verified: true, // 2026-08-13 bespoke 实测：/jyxxAjax/jsgcZbgg 免登录返回真实建设工程招标公告(标题+日期)
    kind: "hb",
    base: "https://www.hbggzyfwpt.cn",
    rn: 100, // 该接口 pageNum 被忽略，pageSize 上限拉取（实测 100 条）
    clientFilterOnly: true, // 列表接口无关键词搜索参数，采集时按标题客户端过滤
    defaultType: "招标公告",
    // B 阶段（2026-08-14 真机枚举 jyxx 栏目页）：工程建设栏目仅含 招标公告/评标结果公示/中标结果公示，
    //   无独立「中标候选人公示」与「合同公告」栏目 → 仅配 result=jsgcZbjggs（标题 bulletName/日期 bulletinIssueTime）
    stages: {
      result: { type: "中标结果", jsgcEndpoint: "jsgcZbjggs" },
    },
  },
  // 吉林：TRS WAS 全文检索 JSONP 接口 /was5/web/search（channelid=237687）
  jilin: {
    name: "吉林省公共资源交易公共服务平台",
    verified: true, // 2026-08-13 bespoke 实测：was5/web/search JSONP 免登录返回真实公告(标题+日期)
    kind: "jl",
    base: "https://www.jl.gov.cn/ggzy",
    channelId: 237687,
    rn: 50, // 混合栏目(66万+条)，招标公告仅占~2.5%；调大每页样本量，crawlRound 跨页累加到 limit（避免连续2页空提前 break）
    clientFilterOnly: true, // 按 iType 过滤招标公告 + 采集时按标题客户端过滤关键词
    allowNoUrl: true, // docpuburl 可能为相对/空，列表层诚实不伪造详情 URL
    defaultType: "招标公告",
    // B 阶段（2026-08-15 真机枚举 TRS WAS）：全站唯一有效 channelId=237687（巨型混合栏目，66 万+ 条），
    //   服务端 iType='…' 检索式恒返回 0（不可服务端隔离）→ 改客户端按 iType 字段过滤。
    //   ZB 基线检索式 iType='招标公告' 原返回 0（已废），jlList 改为拉全量后客户端按 iType 过滤。
    stages: {
      candidate: { type: "中标候选人", iType: "中标候选人公示" },
      result:    { type: "中标结果",   iTypes: ["中标结果公告", "中标公告"] }, // 工程建设用前者、政府采购用后者
      contract:  { type: "合同公示",   iType: "合同公示" },
    },
  },
  // 福建：Vue SPA 后端 /FwPortalApi/Trade/TradeInfo，需 MD5 签名 + AES-256-CBC 解密
  fujian: {
    name: "福建省公共资源交易电子公共服务平台",
    verified: true, // 2026-08-13 bespoke 实测：签名+AES 解密成功，返回真实招标公告(标题+日期)
    kind: "fj",
    base: "https://ggzyfw.fujian.gov.cn",
    rn: 10,
    clientFilterOnly: true, // 端点无关键词参数，采集时按标题客户端过滤
    allowNoUrl: true, // 详情走 /FwPortalApi/Trade/TradeInfoDetail?M_ID=（结构已知但前端路由未全确认），列表层诚实不强制详情
    defaultType: "招标公告",
    // B 阶段（2026-08-14 真机枚举 GGTYPE）：1=招标公告、4=中标候选人公示、5=中标结果公告；
    //   GGTYPE 3/6/7+ 均返回 0 → 无独立合同公告栏目（诚实不配 contract）
    stages: {
      candidate: { type: "中标候选人", GGTYPE: "4" },
      result:    { type: "中标结果",   GGTYPE: "5" },
    },
  },
  // ===== 2026-08-13 bespoke 逆向·批次 A（京津冀晋冀） =====
  // 北京/山西/河北：JEECMS / Hanweb / WebBuilder 静态 HTML 栏目页，服务端渲染、免登录、无关键词参数 → clientFilterOnly
  beijing: {
    name: "北京市公共资源交易服务平台",
    verified: true, // 2026-08-14 复核：原 jyxxgcjszzgg 是「工程建设终止公告」栏目（无控制价/开标），已改指 jyxxggjtbyqs「工程建设·招标公告」栏目
    kind: "html",
    base: "https://ggzyfw.beijing.gov.cn",
    listUrl: (page) => `https://ggzyfw.beijing.gov.cn/jyxxggjtbyqs/${page === 1 ? "index" : "index_" + page}.html`,
    clientFilterOnly: true, // 栏目含多类型公告，无服务端类型过滤，采集时按标题客户端过滤
    defaultType: "招标公告",
    parse(html) {
      const items = [];
      const re = /<a [^>]*href="(\/jyxxggjtbyqs\/20\d{6}\/\d+\.html)"[^>]*title="([^"]*)"[^>]*class="divtitlejy"[\s\S]*?list-times1[^>]*>\s*<p[^>]*>([0-9-]+)<\/p>/g;
      let m;
      while ((m = re.exec(html))) {
        const url = "https://ggzyfw.beijing.gov.cn" + m[1];
        const title = m[2].replace(/\s+/g, " ").trim();
        if (title.length < 4) continue;
        items.push({ url, title, date: m[3] });
      }
      return items;
    },
    // ---- B 阶段（Goal v1）：中标/合同 各子栏目，列表结构同源（仅栏目路径与类型不同）----
    stages: {
      candidate: { type: "中标候选人", listUrl: (page) => `https://ggzyfw.beijing.gov.cn/jyxxzbhxrgs/${page === 1 ? "index" : "index_" + page}.html`, parse: beijingWinParse },
      result:    { type: "中标结果", listUrl: (page) => `https://ggzyfw.beijing.gov.cn/jyxxzbjggg/${page === 1 ? "index" : "index_" + page}.html`, parse: beijingWinParse },
      contract:  { type: "合同公示", listUrl: (page) => `https://ggzyfw.beijing.gov.cn/jyxxgcjshtgs/${page === 1 ? "index" : "index_" + page}.html`, parse: beijingWinParse },
    },
  },
  // 天津：JEECMS JSON POST /content/pageContent（ggzy.zwfwb.tj.gov.cn，免登录；title 关键词失效→clientFilterOnly）
  tianjin: {
    name: "天津市公共资源交易平台",
    verified: true, // 2026-08-13 bespoke 实测：/content/pageContent 免登录返回真实招标公告(标题+毫秒时间戳)，totalElements≈75627
    kind: "tj",
    base: "https://ggzy.zwfwb.tj.gov.cn",
    channelId: "82322", // 工程建设-招标公告
    rn: 10,
    clientFilterOnly: true, // 服务端 title 关键词返回 0（失效），采集时按标题客户端过滤
    detail: tianjinDetail,
    defaultType: "招标公告",
    // B 阶段（2026-08-14 真机枚举 jyxxgcjs.jhtml 栏目 channelId）：82323=中标结果公示、82324=中标候选人公示、82325=合同信息公示
    stages: {
      candidate: { type: "中标候选人", channelId: "82324" },
      result:    { type: "中标结果",   channelId: "82323" },
      contract:  { type: "合同公示",   channelId: "82325" },
    },
  },
  // 山西：Hanweb 静态栏目页 /f/new/notice/list/11（招标公告，6345 页，免登录无鉴权）
  shanxi: {
    name: "山西省招标投标公共服务平台",
    verified: true, // 2026-08-13 bespoke 实测：/f/new/notice/list/11 表格化返回真实招标公告(标题+类型+日期)
    kind: "html",
    base: "https://www.sxbid.com.cn",
    listUrl: (page) => page === 1
      ? "https://www.sxbid.com.cn/f/new/notice/list/11"
      : `https://www.sxbid.com.cn/f/new/notice/list/11?pageNo=${page}`,
    clientFilterOnly: true, // 列表页仅 pageNo 参数，无关键词检索，采集时按标题客户端过滤
    defaultType: "招标公告",
    parse(html) {
      const items = [];
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let tr;
      while ((tr = trRe.exec(html))) {
        const block = tr[1];
        const am = block.match(/<a[^>]+href="(\/f\/new\/notice\/[12]\/[0-9a-f]+)"[^>]*title="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!am) continue;
        const url = "https://www.sxbid.com.cn" + am[1];
        const title = (am[2] || am[3] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (title.length < 4) continue;
        const dm = block.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dm ? dm[1] : "";
        items.push({ url, title, date });
      }
      return items;
    },
    // ---- B 阶段（Goal v1）：中标候选人/结果 栏目（11=招标公告 12=中标候选 13=中标结果 14=变更）----
    stages: {
      candidate: { type: "中标候选人", listUrl: (page) => page === 1 ? "https://www.sxbid.com.cn/f/new/notice/list/12" : `https://www.sxbid.com.cn/f/new/notice/list/12?pageNo=${page}` },
      result:    { type: "中标结果", listUrl: (page) => page === 1 ? "https://www.sxbid.com.cn/f/new/notice/list/13" : `https://www.sxbid.com.cn/f/new/notice/list/13?pageNo=${page}` },
    },
  },
  // 河北：WebBuilder 静态栏目页（镜像 szj.hebei.gov.cn，原 hebeieb/ggzy.hebei 本环境代理阻断）
  // 注：静态分页仅前 99 页（~1287 条）有直接文件；深页无静态文件，需 EPoint 路兜底（已在证据标注）
  hebei: {
    name: "河北省公共资源交易中心（镜像 szj.hebei.gov.cn）",
    verified: true, // 2026-08-13 bespoke 实测：/hbjyzx/jydt/.../001002002001/jyxxList.html 返回真实招标公告(标题+日期)
    kind: "html",
    base: "https://szj.hebei.gov.cn",
    listUrl: (page) => page === 1
      ? "https://szj.hebei.gov.cn/hbjyzx/jydt/001002/001002002/001002002001/jyxxList.html"
      : `https://szj.hebei.gov.cn/hbjyzx/jydt/001002/001002002/001002002001/${page}.html`,
    clientFilterOnly: true, // 列表页仅分页参数，无关键词检索，采集时按标题客户端过滤
    defaultType: "招标公告",
    // ---- B 阶段（Goal v2 · 2026-08-15 真机枚举 001002002 栏目树）：001=招标公告 002=变更公告 003=中标候选人公示 004=中标结果公告（005/006 空，无独立合同公示栏目→诚实不配 contract）----
    stages: {
      candidate: { type: "中标候选人", listUrl: (page) => page === 1
        ? "https://szj.hebei.gov.cn/hbjyzx/jydt/001002/001002002/001002002003/jyxxList.html"
        : `https://szj.hebei.gov.cn/hbjyzx/jydt/001002/001002002/001002002003/${page}.html` },
      result:    { type: "中标结果",   listUrl: (page) => page === 1
        ? "https://szj.hebei.gov.cn/hbjyzx/jydt/001002/001002002/001002002004/jyxxList.html"
        : `https://szj.hebei.gov.cn/hbjyzx/jydt/001002/001002002/001002002004/${page}.html` },
    },
    parse(html) {
      const items = [];
      const liRe = /<li[^>]*class="ewb-com-item"[^>]*>([\s\S]*?)<\/li>/gi;
      let li;
      while ((li = liRe.exec(html))) {
        const block = li[1];
        // 实测：<a> 无 title 属性，标题即链接文本；日期在 li 内独立 <span class="r"> 中
        const am = block.match(/<a[^>]*href="(\/hbjyzx\/jydt\/001002\/001002002\/00100200200\d\/[^"]+\.html)"[^>]*>([\s\S]*?)<\/a>/i);
        if (!am) continue;
        const url = "https://szj.hebei.gov.cn" + am[1];
        const title = (am[2] || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (title.length < 4) continue;
        const dm = block.match(/(\d{4}-\d{2}-\d{2})/);
        const date = dm ? dm[1] : "";
        items.push({ url, title, date });
      }
      return items;
    },
  },
  // 内蒙古：TRS 全文检索 REST GET（注意与 auth 网关的 getPublishResourceDealList 区分：后者恒返空 data:[]，本端点 searchPublishResource 服务端关键词过滤返回真实记录）
  neimenggu: {
    name: "内蒙古自治区公共资源交易网",
    verified: true, // 2026-08-13 bespoke 实测：/trssearch/openSearch/searchPublishResource 服务端 noticeName 关键词检索返回真实记录(管网=25034，空=1245445)；transactionTypeCode=engineering_construction 用 index_24 详情
    kind: "nmg",
    base: "https://ggzyjy.nmg.gov.cn",
    rn: 10,
    noticeTypeName: "招标公告", // 默认 zb 必须服务端隔离；空值会混入更正、中标结果与合同
    attachmentFields: ["controlPrice", "budget", "bond", "scale", "scope", "evaluation", "fullScore"],
    defaultType: "招标公告", // 服务端关键词检索（noticeName 参数），无需客户端过滤
    // B 阶段（2026-08-15 真机枚举 /trssearch/openSearch/searchPublishResource）：noticeTypeName 隔离栏目；
    //   candidate=中标候选人公示、result=中标结果公告(站点无"中标结果公示"，字面=0)、contract=合同公示。
    //   注：nmgList 原硬编码 noticeTypeName 为空 → 已改为读 ad.noticeTypeName（stages 覆盖生效）
    stages: {
      candidate: { type: "中标候选人", noticeTypeName: "中标候选人公示" },
      result:    { type: "中标结果",   noticeTypeName: "中标结果公告" },
      contract:  { type: "合同公示",   noticeTypeName: "合同公示" },
    },
  },
  // 辽宁：TRS WAS 全文检索 GET /was5/web/search（与吉林同款引擎，但字段/参数/检索式不同，独立 lnList）
  liaoning: {
    name: "辽宁省公共资源交易中心（工程建设·招标公告）",
    verified: true, // 2026-08-13 bespoke 实测：was5/web/search 免登录返回真实公告(标题+日期+详情URL)，DOCCHANNEL='149559' 隔离 2555 条省本级招标公告
    kind: "ln",
    base: "https://ggzy.ln.gov.cn",
    channelId: 219677, // 工程建设母栏目
    searchword: "DOCCHANNEL='149559'", // 服务端隔离「招标公告」(2555 条，CHNLNAME 全为 招标公告)
    rn: 15, // 必须 ≤20；perpage≥25 触发「公共资源」反爬 HTML 占位页
    clientFilterOnly: true, // 列表接口不支持中文关键词全文检索(recordnum=0)，关键词走客户端过滤
    allowNoUrl: false, // DOCPUBURL 为绝对 URL，已实测 200 可达
    defaultType: "招标公告",
    // B 阶段（2026-08-15 真机枚举 TRS WAS）：母栏目 channelId=219677 固定，仅 DOCCHANNEL 隔离；
    //   candidate=149561(中标候选人公示)、result=149562(中标结果公告)；合同=Y164624 走独立 layui 后端非 TRS → 诚实不配 contract
    stages: {
      candidate: { type: "中标候选人", searchword: "DOCCHANNEL='149561'" },
      result:    { type: "中标结果",   searchword: "DOCCHANNEL='149562'" },
    },
  },

  // 甘肃：省本级 ggzyjy.gansu.gov.cn 全路径 WAF 412（AUTH_WALL，curl-only 不可取）；
  // 兰州市级门户 lzggzyjy.lanzhou.gov.cn 公开可用，标准 EPoint /inteligentsearch/rest/esinteligentsearch/getFullTextDataNew（unionCondition 过滤 002001001/014001001）
  gansu: {
    name: "甘肃省公共资源交易（兰州市门户·省本级 WAF 412 不可取）",
    verified: true, // 2026-08-14 bespoke 复探实测：lzggzyjy.lanzhou.gov.cn POST getFullTextDataNew 返回真实招标公告(totalcount=6942)；省本级 412 AUTH_WALL
    kind: "gs",
    base: "https://lzggzyjy.lanzhou.gov.cn",
    apiPath: "/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew",
    rn: 15,
    referer: "https://lzggzyjy.lanzhou.gov.cn/jygk/002001/002001001/list.html",
    keywordClient: true, // wd 服务端检索失效，拉全量分类后客户端按标题过滤
    clientFilterOnly: true,
    defaultType: "招标公告",
    unionCondition: [
      { fieldName: "categorynum", isLike: true, likeType: 2, equal: "002001001" },
      { fieldName: "categorynum", isLike: true, likeType: 2, equal: "014001001" },
    ],
    makeBody(pn, wd, cat) {
      return {
        token: "", pn, rn: String(this.rn), sdt: "", edt: "", wd: wd || "", inc_wd: "", exc_wd: "",
        fields: "title;categorynum;zhuanzai;webdate", cnum: "001",
        sort: '{"webdate":"0"}', ssort: "title", cl: 10000, terminal: "",
        condition: [], time: [], highlights: "title", statistics: null,
        unionCondition: this.unionCondition,
        accuracy: "", noParticiple: "0", searchRange: null, isBusiness: "1",
      };
    },
    // ---- B 阶段（Goal v1）：兰州门户 中标候选人 = categorynum 002001003 / 014001003（002001001=招标公告）。
    // 该实例未单列"中标结果"栏目（中标候选人公示已含中标人/中标价），故仅配 candidate。
    stages: {
      candidate: { type: "中标候选人", unionCondition: [
        { fieldName: "categorynum", isLike: true, likeType: 2, equal: "002001003" },
        { fieldName: "categorynum", isLike: true, likeType: 2, equal: "014001003" },
      ] },
    },
  },

  // 上海：建设工程·招标公告（JEECMS 服务端渲染 HTML 列表，SSR + 正则，零鉴权）
  shanghai: {
    name: "上海市公共资源交易平台（工程建设·招标公告）",
    verified: true, // 2026-08-14 bespoke 实测：/jyxxgcgg?cExt=&isIndex=y SSR 列表返回真实标题+日期，分页 &pageNo=N 有效，无登录/无 token
    kind: "html",
    base: "https://www.shggzy.com",
    listUrl: (page) => page === 1
      ? "https://www.shggzy.com/jyxxgcgg?cExt=&isIndex=y"
      : `https://www.shggzy.com/jyxxgcgg?cExt=&isIndex=y&pageNo=${page}`,
    clientFilterOnly: true, // 列表端点无生效的服务端关键词参数；按关键词 client 过滤
    defaultType: "招标公告", // /jyxxgcgg 即建设工程·招标公告子栏目（channelId=29）
    // ---- B 阶段（2026-08-15 枚举·逆向 queryContents.jhtml）：候选 channelId=32(中标候选人公示)/结果 channelId=33(中标结果公示)；无独立合同公示栏目→不配 contract ----
    stages: {
      candidate: { type: "中标候选人公示", listUrl: (page) => "https://www.shggzy.com/search/queryContents.jhtml?channelId=32&inDates=4000" + (page > 1 ? "&pageNo=" + page : "") },
      result:    { type: "中标结果公示", listUrl: (page) => "https://www.shggzy.com/search/queryContents.jhtml?channelId=33&inDates=4000" + (page > 1 ? "&pageNo=" + page : "") },
    },
    parse(html) {
      const items = [];
      const liRe = /<li[^>]*onclick="window\.open\('(\/jyxxgc[a-z]+\/\d+\?cExt=&isIndex=)[^']*'\)"[^>]*>([\s\S]*?)<\/li>/g;
      let m;
      while ((m = liRe.exec(html))) {
        const url = ("https://www.shggzy.com" + m[1]).replace("isIndex=", "isIndex=y");
        const block = m[2];
        const t = block.match(/<span[^>]*class="cs-span2"[^>]*>\s*([\s\S]*?)\s*<\/span>/);
        const d = block.match(/<span>(\d{4}-\d{2}-\d{2})<\/span>/);
        const title = t ? t[1].replace(/\s+/g, " ").trim() : "";
        const date = d ? d[1] : "";
        if (title.length < 4) continue;
        items.push({ url, title, date });
      }
      return items;
    },
  },

  // 青海：webBuilder 站点，但根路径 /inteligentsearch/rest/inteligentSearch/getFullTextData 匿名可用（2026-08-13 初探误判 AUTH_WALL 已推翻）
  qinghai: {
    name: "青海省公共资源交易网（工程建设·招标公告）",
    verified: true, // 2026-08-14 复探实测：匿名 POST 返回真实"管网"记录 totalcount=1670（cat 001001001 全量 73630），详情页服务端渲染 200
    kind: "epointX",
    base: "https://www.qhggzyjy.gov.cn",
    apiPath: "/inteligentsearch/rest/inteligentSearch/getFullTextData",
    referer: "https://www.qhggzyjy.gov.cn/ggzy/jyxx/001001/001001001/transinfo_list.html",
    cats: ["001001001"], // 工程建设-招标公告（面包屑实证）
    rn: 20,
    sortField: "showdate", // 该实例无 webdate 字段，用 showdate 排序，webdate 排序会失效
    makeBody(pn, wd, cat) {
      return {
        token: "", pn, rn: String(this.rn), sdt: "", edt: "",
        wd: wd || "", inc_wd: "", exc_wd: "",
        fields: "title",
        cnum: "001;002;003;004;005;006;007;008;009;010", // ★ 全量 10 地区子站；用默认"001"只剩 42 条(格尔木)静默丢 97.5%
        sort: '{"showdate":"0"}', ssort: "title", cl: 200, terminal: "",
        condition: [{ fieldName: "categorynum", isLike: true, likeType: 2, equal: cat }],
        time: null, highlights: "title", statistics: null, unionCondition: null,
        accuracy: "100", noParticiple: "0", searchRange: null,
        isBusiness: "1", // ★ 恒传：无关键词时缺此字段服务端静默返回 0
      };
    },
    defaultType: "招标公告",
    // B 阶段栏目码（2026-08-14 epointX 探针实测：多关键词反查 + 单码验证，全部读真实返回标题确认）
    stages: {
      candidate: { type: "中标候选人", cats: ["001001005"] },             // 工程建设-中标候选人公示
      result:    { type: "中标通知书公示", cats: ["001001006"] },        // 工程建设-标后结果（中标通知书公示，含中标结果）
      contract:  { type: "合同公告", cats: ["001001010"] },              // 工程建设-合同公告
    },
  },
};

// ---- 详情页厚字段提取（通用，各省可 override）----
// 注意：alternation 从左到右首选，长词必须排在短词前面（"建设资金来自"要先于"建设资金"）。
// 2026-08-11 江苏实测补入资金类变体：原文「招标人为东海县新农村农业投资开发有限公司，建设资金
// 来自自筹资金」——表里只有"资金来源"，匹配不到"建设资金来自"，招标人被拖出一条尾巴。
const STOP_LABELS = "资质要求|资质等级|资质条件|业绩要求|业绩条件|企业业绩|评标办法|评标方法|评审办法|工期|计划工期|建设工期|建设资金来自|建设资金|资金来自|资金来源|所需资金|出资比例|招标人|建设单位|业主单位|采购人|采购代理|采购单位|投标保证金|保证金|控制价|招标控制价|最高投标限价|最高限价|开标时间|开标日期|代理机构|联系人|电话|备注|附件|招标文件|发布时间|监督部门|监督";

function htmlToText(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<\s*br\s*\/?>/gi, "\n")
          .replace(/<\/(tr|p|div|li|h[1-6]|section|dt|dd)>/gi, "\n")
          .replace(/<\/(td|th)>/gi, "\t")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&ldquo;|&#8220;/gi, "“").replace(/&rdquo;|&#8221;/gi, "”")
          .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&mdash;|&#8212;/gi, "—")
          .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// 在纯文本中按标签抓取其后的值
// v3 修正（2026-08-09 实测江苏详情页发现）：原实现要求停止标签必须在行首 (?=\n\s*STOP)，
// 但真实公告标签多为行内（如 "3.1投标人资质类别和等级：施工资质条件：…"），
// 500 字窗口内匹配不到行首标签就整体失败返回空 → 厚字段大面积漏抓。
// 现改为：优先"标签：值"紧邻模式（截到换行/句号/下一个行内标签），再回退宽松单行模式。
function cleanVal(s) {
  return String(s).trim()
    .replace(/\s+/g, " ")
    .replace(/^[:：、\s]+/, "")
    // 清理 <a> 转文本后的 markdown 残留 [文字](链接。
    // 2026-08-11 江苏实测修正：原来无条件删开头 "["，会误伤原文自带的方括号 ——
    //   「[施工总承包·市政公用工程·市政公用工程一级](含)以上」→ 删首括号后剩孤立 "]"。
    // 现在只在括号后确实跟着 URL（或被截断的"]("）时才认定是链接残留。
    .replace(/^\[([^\]]*)\]\((?:https?:\/\/|www\.|\/)[^)]*\)?/i, "$1")
    .replace(/^\[([^\]]*)\]\($/, "$1")
    // 值中回指标签名（如"自筹资金（资金来源），项目建设采用…"）→ 在回指处截断，丢掉后面的无关文字
    .replace(/[（(](?:资金来源|项目名称|标段名称|批文名称及编号|以下简称|招标人)[）)][\s\S]*$/, "")
    .replace(/[\s:：,，、]+$/, "")
    .slice(0, 400);
}

// 值是否有信息量：过滤 "/"、纯标点、以及过短残片（如只抓到"施工"/"条件"）
function isMeaningful(v, minLen) {
  if (!v) return false;
  // 以收尾标点开头 → 典型的倒装/截断误抓（如"资金来源"命中"建设资金来自X（资金来源）"的右括号后文）
  if (/^[）)，,。；;、]/.test(v)) return false;
  // 以"止"开头 → 命中了"至投标截止时间止，…"这类条款而非字段值
  if (/^止[，,]/.test(v)) return false;
  const bare = v.replace(/[\s:：\/\\\-—－。，,、;；()（）\[\]]/g, "");
  if (!bare) return false;
  if (/^(无|不限|详见招标文件|见招标文件)$/.test(bare)) return true; // 明确表述，属有效信息
  return bare.length >= (minLen || 4);
}

// 日期时间专用提取：只接受真实日期格式，抓不到就留空（防止把条款文字塞进"开标时间"）
// 统一规范化输出 "YYYY-MM-DD HH:MM"，避免 "2026-08-249:00:00" 这类粘连
// v4（2026-08-09 浙江 PDF 实测）：PDF 转文本后版式碎裂，日期常被拆成多行
//   例「投标文件递交的截止时间（投标截止时间，下同）为\n2026\n年\n9\n月\n9\n日\n14\n时\n30\n分」
//   故标签与日期之间由 [^\n] 放宽为 [\s\S]（窗口仍限 40 字，不会跨到远处日期）
function grabDateTime(text, labels) {
  const D = "((?:19|20)\\d{2})\\s*[-年/\\.]\\s*(\\d{1,2})\\s*[-月/\\.]\\s*(\\d{1,2})\\s*日?";
  const T = "(?:\\s*(\\d{1,2})\\s*[:：时点]\\s*(\\d{1,2})(?:\\s*[:：分]\\s*\\d{1,2})?)?";   // 2026-08-16 V5：+「点」（江西「09 点 30 分」实测）
  const pad = n => String(n).padStart(2, "0");
  for (const lab of labels) {
    // 2026-08-16 V5（江西实测）：HTML 剥标签后关键词被插空格「提交 响应 文件截止时间」——
    // 标签用 labRe 编译容字间空白，日期/时间分量已各自容 \s*。
    const m = text.match(new RegExp(labRe(lab) + "[\\s\\S]{0,40}?" + D + T, "i"));
    if (!m) continue;
    let s = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if (m[4] != null) s += ` ${pad(m[4])}:${pad(m[5] || 0)}`;
    return s;
  }
  return "";
}

// 评标办法：优先识别标准办法名词，避免抓到"5.1、评标入围"这类章节残片
function grabEvaluation(text) {
  const methods = [
    "智能筛查合理价格法", "经评审的最低投标价法", "合理低价中标法", "综合评估法",
    "最低投标价法", "合理低价法", "综合评分法", "性价比法", "双信封",
    "抽签", "票决", "直接摇号",
  ];
  const methodRe = methods.map(labRe).join("|");
  // 先看“评标办法/方法/评审办法”的标签邻域。安徽公告可能先写“评定分离”的定标机制，
  // 后写真正的“评标办法采用智能筛查合理价格法”；全篇取首个术语会把两件事混为一谈。
  const labeled = text.match(new RegExp("(?:评标办法|评标方法|评审办法)[\\s\\S]{0,40}?(" + methodRe + ")"));
  if (labeled) return labeled[1].replace(/\s+/g, "");
  const raw = grab(text, ["评标办法", "评标方法", "评审办法"], 4);
  if (raw) {
    const hit = methods.find((name) => raw.replace(/\s+/g, "").includes(name));
    if (hit) return hit;
    return "";
  }
  // 无标签时按“评标方法优先、定标机制靠后”的语义顺序找，而不是按正文出现顺序找。
  // 2026-08-16 V5 取证回访修正（江苏实测误抽）：原文「5.1是否评定分离： 否 5.2本次招标采用 综合评估法」
  // ——"是否评定分离：否"的否定语境被当评标办法返回"评定分离"。先剥否定语境再匹配。
  const stripped = text.replace(/是否\s*评定分离\s*[:：]?\s*否/g, "");
  return methods.find((name) => stripped.replace(/\s+/g, "").includes(name)) || "";
}

// 联合体：标标通该列只关心"接受/不接受"，规范化为二值，识别不到才留空
function grabConsortium(text) {
  // v4：复选框式表述（浙江 PDF 常见）「本次招标（R接受/□不接受）联合体投标」
  // R/☑/√/■/⊠ = 已勾选，□ = 未勾选。必须先判勾选，否则关键词规则会先命中"不接受"而判反。
  const cb = text.match(/[（(]\s*([R☑√■⊠□])\s*接受\s*[\/／、]\s*([R☑√■⊠□])\s*不接受\s*[）)]/);
  if (cb) {
    if (/[R☑√■⊠]/.test(cb[1])) return "接受";
    if (/[R☑√■⊠]/.test(cb[2])) return "不接受";
  }
  const cb2 = text.match(/([R☑√■⊠□])\s*接受[\s\S]{0,6}?([R☑√■⊠□])\s*不接受/);
  if (cb2) {
    if (/[R☑√■⊠]/.test(cb2[1])) return "接受";
    if (/[R☑√■⊠]/.test(cb2[2])) return "不接受";
  }
  // 明确声明优先于后文的联合体成员约束。郑州公告常见：
  // “本次招标接受联合体投标……联合体各方不得再单独或组成其他联合体参加投标”。
  // 后一句是参与规则，不是否定本次接受联合体。
  const explicit = text.match(/本次招标\s*(不接受|接受)\s*联合体投标/);
  if (explicit) return explicit[1] === "不接受" ? "不接受" : "接受";
  // 窗口不再排除换行（2026-08-10 海南实测）：原文「本次招标 不接受 联合体投标。」在 HTML 里
  // "不接受"与"联合体投标"分处两个块级元素，htmlToText 后中间是 \n，
  // 旧的 [^。\n] 窗口一遇换行就断，导致标准句式反而抓不到（畅博南洋悦城等 2 条实测漏抓）。
  // 仍以句号收口 + 12 字窗口约束，跨行不会跨到无关句子。
  if (/(不接受|不允许|不得|禁止)[^。]{0,12}联合体/.test(text)) return "不接受";
  if (/联合体[^。]{0,12}(不得|不予|不接受|不允许)/.test(text)) return "不接受";
  if (/(接受|允许|可以|同意)[^。]{0,12}联合体/.test(text)) return "接受";
  if (/联合体[^。\n]{0,8}(投标的|参与投标)/.test(text)) return "接受";
  // 资质条款里的「…由具有相应资质的设计单位和施工单位组成联合体」也是明确许可联合体
  // （海南定安县龙门水厂 EPC 实测）。否定规则已在前面拦截，此处不会把"不得组成联合体"判反。
  if (/(组成|结成|组建)联合体/.test(text)) return "接受";
  return "";
}

/**
 * 标签 → 「字间容空白」的正则源码。
 *
 * 中文公文 PDF 常把双字/三字标签按栏宽两端对齐，字与字之间插入真实空格：
 *   温州公告实测「联 系 人： 张一南」「招 标 人： 温州市公用佳源环境水务有限公司」「电 话： …」
 * 直接用 "联系人" 去匹配必然落空 —— 这会被误读成「公告没写联系人」，属于假的"诚实留空"。
 * 因此所有标签统一编译成 联\s*系\s*人 形式。
 */
function labRe(lab) {
  return lab.split("").map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*");
}

/**
 * 并列子句截断：值里混进了**下一个字段**的内容时，从子句边界砍掉。
 *
 * 浙江公告首段是一长串"…为…，…为…"的流水句，且值与值之间只用中文逗号分隔、没有冒号，
 * 所以 grab 模式1/1b 的「停止标签 + 冒号」前瞻完全不触发，模式2 又只按 。；\n 截断：
 *   原文「，招标人为 温州市公用佳源环境水务有限公司 ，委托代理机构\n为 宁波国际…」
 *   → 招标人抓成 "温州市公用佳源环境水务有限公司 ，委托代理机构"（把下一字段的标签当成了公司名尾巴）
 *   原文「，建设资金来自 财政性资金 ，出资比例为 …，项目业主为 …」
 *   → 资金来源抓成 "财政性资金 ，出资比例为 财政性资金比例:100.00% ，项目业主为 杭州滨江水务有"
 *
 * 只在「逗号/分号 + (可选 委托/受托/受) + 停止标签」这一严格句式下截断，不做裸标签匹配：
 * 裸匹配会误伤正常长句（如业绩要求里的"□3.8（招标人需要增加的…）"，其前是空格+括号，不命中）。
 */
// 可选前缀里必须带"招标"（2026-08-10 海南实测）：
//   原文「…，招标人为定安县清源水资源管理有限公司，招标代理机构为广州穗科建设管理有限公司。」
//   STOP_LABELS 有"代理机构"却没有"招标代理机构"，`，招标代理机构` 匹配不上，
//   于是招标人抓成 "定安县清源水资源管理有限公司，招标代理机构为广州穗科建设管理有限公司"。
// 注：加"招标"不会误伤"，招标人为X" —— 正则回溯时可选前缀取空即可整体命中 STOP 里的"招标人"。
const CLAUSE_STOP = new RegExp("[，,;；]\\s*(?:委托|受托|受|招标)?\\s*(?:" + STOP_LABELS + "|项目业主|行政监督部门)");
function trimAtClause(v) {
  if (!v) return v;
  const m = v.match(CLAUSE_STOP);
  if (m && m.index >= 2) return v.slice(0, m.index).replace(/[\s，,、;；:：]+$/, "");
  return v;
}

function grab(text, labels, minLen) {
  const cands = [];
  for (const lab0 of labels) {
    const lab = labRe(lab0);
    // 模式1：标签 + 冒号 + 值
    let m = text.match(new RegExp(
      lab + "\\s*[:：]\\s*([^\\n]{1,300}?)(?=\\n|。|；|$|(?:" + STOP_LABELS + ")\\s*[:：])", "i"));
    if (m) { const v = trimAtClause(cleanVal(m[1])); if (isMeaningful(v, minLen)) return v; if (v) cands.push(v); }
    // 模式1b（PDF 版式专用）：值被硬换行拆成多行。
    //   实例（缙云公告）「3.1投标人资质类别和等级：\n具有\n市政公用\n工程施工总承包\n叁\n级\n及以上资质…；」
    //   只看单行会取到"具有"两字 → 判为无意义 → 退化到用短标签"投标人资质"误抓出标签碎片"类别和等级"。
    //   故从冒号后连续取，直到：分号/句号、空行、下一编号条款(3.2)、复选框(☑□£R)、或下一个停止标签。
    m = text.match(new RegExp(
      lab + "\\s*[:：]\\s*([\\s\\S]{2,400}?)(?=[；;。]|\\n\\s*\\n|\\n\\s*(?:[☑□£]|\\d+\\.\\d)|(?:" + STOP_LABELS + ")\\s*[:：]|$)", "i"));
    if (m) {
      const v = trimAtClause(cleanVal(m[1].replace(/[\r\n]+/g, "")));   // 中文断行处不补空格，直接拼接
      if (isMeaningful(v, minLen)) return v; if (v) cands.push(v);
    }
    // 模式2：标签后直接跟值（无冒号），仅取同一行、截到句号
    m = text.match(new RegExp(lab + "\\s*([^\\n。；]{2,200})", "i"));
    if (m) { const v = trimAtClause(cleanVal(m[1])); if (isMeaningful(v, minLen)) return v; if (v) cands.push(v); }
  }
  // 所有标签都只抓到残片时取最长的（总比空好），但仍要求非纯符号
  const best = cands.sort((a, b) => b.length - a.length)[0] || "";
  return isMeaningful(best, 2) ? best : "";
}

// 金额专用提取（统一换算成"万元"）：必须在标签邻域内命中"数字+金额单位"才算数。
// 严禁把条款描述当金额 —— 例「投标保证金不予退还」无数字 → 不命中，留空。
// v4：PDF 版式里金额常独占一行（「本次招标概算价控制价约\n9598.3458\n万元」），故放宽为 [\s\S]
function grabMoneyWan(text, labels) {
  for (const lab of labels) {
    // 2026-08-16 V5（无锡实测）：标签自带括号单位「工程合同估算价（万元）： 298.0」——
    // 数字通道要求单位紧跟数字而失配；中文兜底更把「（万」当数字"万"+「元」当单位，
    // 输出 1 万元的错值。先剥掉标签近邻的括号单位并记住量纲，两通道在剥后文本上跑；
    // 数字通道仍失配时按括号量纲换算标签后首个数字。
    const unitM = text.match(new RegExp(lab + "[（(]\\s*(百万元|万元|元)\\s*[)）]", "i"));
    const bracketUnit = unitM ? unitM[1] : "";
    const rawMoneyText = bracketUnit ? text.replace(new RegExp(lab + "[（(]\\s*(?:百万元|万元|元)\\s*[)）]", "gi"), lab) : text;
    // webBuilder 富文本会把一个小数拆成多个 span，转纯文本后形成「606 . 2 2 万元」。
    // 只在明确的小数点形态内合并最多 7 位小数，避免全局删除数字间空格造成串号。
    const moneyText = rawMoneyText.replace(/(\d)\s*[.．]\s*(\d(?:\s*\d){0,6})(?=\s*(?:万元|万|元|[；;，,。:：）)]|$))/g,
      (_, intLast, decimals) => intLast + "." + decimals.replace(/\s+/g, ""));
    // 数字与单位之间允许杂散点/空格（2026-08-10 海南实测）：
    //   琼海地灾治理公告原文「最高投标限价（或招标控制价): 9313711.85.元」——金额后多打了一个点。
    //   原正则要求 `数字\s*单位`，遇到 "85.元" 直接失配 → 控制价被当成"公告未载"漏掉。
    const re = new RegExp(lab + "[\\s\\S]{0,60}?([0-9][0-9,，]*(?:[.．][0-9]+)?)[\\s.．、]{0,3}(万元|万|元)", "gi");
    let m;
    while ((m = re.exec(moneyText))) {
      const between = m[0].slice(lab.length, Math.max(lab.length, m[0].lastIndexOf(m[1])));
      // 「最高投标限价按评标价计算……应扣除专业工程暂估价 87200 元」中的 87200
      // 属于暂估价，不是最高限价。标签与数字之间出现另一个金额主体时拒绝跨标签借值。
      if (/(?:专业工程)?暂估价|评标价|投标报价|中标价|合同价|概算价|工程造价|预算金额/.test(between)) continue;
      const num = parseFloat(m[1].replace(/[,，]/g, ""));
      if (!isFinite(num) || num <= 0) continue;
      const wan = m[2] === "元" ? num / 10000 : num;
      if (wan <= 0 || wan > 1e8) continue; // 明显异常值丢弃
      return String(Math.round(wan * 10000) / 10000);
    }
    // 中文大写金额兜底：公告常写“投标保证金人民币叁万元整”。数字通道必须先跑，
    // 这里仅在同一标签的近邻中识别标准中文数字，避免把远处其他金额误配过来。
    const cnRe = new RegExp(lab + "[\\s\\S]{0,40}?([零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億]+)\\s*(万元|万|元)", "i");
    const cm = moneyText.match(cnRe);
    if (cm) {
      const num = chineseNumberToNumber(cm[1]);
      if (Number.isFinite(num) && num > 0) {
        const wan = cm[2] === "元" ? num / 10000 : num;
        if (wan > 0 && wan <= 1e8) return String(Math.round(wan * 10000) / 10000);
      }
    }
    // 括号量纲兜底：「估算价（万元）： 298.0」剥单位后数字通道无单位跟随 → 按括号量纲换算标签后首个数字
    if (bracketUnit) {
      const bm = moneyText.match(new RegExp(lab + "[\\s\\S]{0,30}?([0-9][0-9,，]*(?:[.．][0-9]+)?)", "i"));
      if (bm) {
        const num = parseFloat(bm[1].replace(/[,，]/g, ""));
        if (Number.isFinite(num) && num > 0) {
          const wan = bracketUnit === "万元" ? num : bracketUnit === "百万元" ? num * 100 : num / 10000;
          if (wan > 0 && wan <= 1e8) return String(Math.round(wan * 10000) / 10000);
        }
      }
    }
    // 无单位大数兜底（2026-08-16 V5 海南实测）：「最高投标限价（或招标控制价): 6924677.31」行尾无任何单位
    // ——标签后 30 字内首个 ≥10000 的纯数字且其后 3 字内无 万/元/分（排除"3年得2分"类）→ 按元换算。
    // 数字下限 10000 保证元量级合理（万元口径的公告数字通常 <10000 或自带单位）。
    const nm = moneyText.match(new RegExp(lab + "[\\s\\S]{0,30}?([0-9][0-9,，]{3,15}(?:[.．][0-9]+)?)", "i"));
    if (nm) {
      const after = moneyText.slice(nm.index + nm[0].length, nm.index + nm[0].length + 3);
      if (!/[万元分]/.test(after)) {
        const num = parseFloat(nm[1].replace(/[,，]/g, ""));
        if (Number.isFinite(num) && num >= 10000) {
          const wan = num / 10000;
          if (wan > 0 && wan <= 1e8) return String(Math.round(wan * 10000) / 10000);
        }
      }
    }
  }
  return "";
}

function chineseNumberToNumber(raw) {
  const digits = { 零: 0, 〇: 0, 一: 1, 壹: 1, 二: 2, 两: 2, 贰: 2, 三: 3, 叁: 3, 四: 4, 肆: 4, 五: 5, 伍: 5, 六: 6, 陆: 6, 七: 7, 柒: 7, 八: 8, 捌: 8, 九: 9, 玖: 9 };
  const units = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000, 万: 10000, 萬: 10000, 亿: 100000000, 億: 100000000 };
  let total = 0, section = 0, number = 0;
  for (const ch of String(raw || "")) {
    if (Object.prototype.hasOwnProperty.call(digits, ch)) { number = digits[ch]; continue; }
    const unit = units[ch];
    if (!unit) return Number.NaN;
    if (unit < 10000) section += (number || 1) * unit;
    else { section += number; total += (section || 1) * unit; section = 0; }
    number = 0;
  }
  return total + section + number;
}

/**
 * 工程概算 / 投资估算（万元）—— 独立于「招标控制价」的另一个事实。
 *
 * ⚠ 为什么必须分列，不能合并：概算/估算是**立项阶段的投资规模**，招标控制价是**本次招标的
 * 报价上限**，二者含义、口径、金额都不同（浙江嵊州公告：概算 2121.93 万元，全文无控制价）。
 * 把概算填进控制价列＝伪造数据。浙江 20 条里 14 条只写概算不写控制价，只能如实分开记录。
 *
 * 窗口收紧到 12 字（grabMoneyWan 默认 60 字过宽）：德清监理公告写「工程概算总投资/万元，
 * 其中建安工程造价147485716元」，宽窗口会越过"/万元"抓到建安造价 14748 万元 —— 张冠李戴。
 */
function grabBondWan(text) {
  const raw = String(text || "");
  if (/(?:本项目|本标段)?\s*(?:不收取|无需|不要求|免收|不缴纳|无需缴纳)\s*(?:投标)?保证金|(?:投标)?保证金\s*(?:为|金额为)?\s*0(?:\.0+)?\s*(?:元|万元|万)?/.test(raw)) return 0;
  const explicit = raw.match(/(?:投标)?保证金(?:金额|数额)?[\s\S]{0,100}?(?:\d+(?:\.\d+)?|[零〇一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億元整]+)\s*(?:万元|万|元)/);
  if (!explicit) return "";
  return grabMoneyWan(explicit[0], ["投标保证金", "保证金"]);
}

function grabBudgetWan(text) {
  for (const lab of ["工程概算", "项目概算投资", "概算投资", "概算总投资", "投资估算", "概算",
    "项目预算", "工程预算", "预算金额", "投资预算", "建设预算", "预算价"]) {
    // 字符类里排除「元」：窗口一旦跨过一个金额单位，后面的数字就属于**另一笔钱**了。
    //   德清监理公告：「工程概算总投资 / 万元，其中建安工程造价 147485716 元」
    //   概算栏原文写的是"/"（＝未填），若允许跨过"万元"就会把建安造价 14748.57 万当成概算 —— 造假。
    //   排除后「概算总投资」右侧第 4 字即是"元"，正则不成立 → 如实留空。
    const re = new RegExp(lab + "[^0-9\\n元]{0,12}?([0-9][0-9,，]*(?:[.．][0-9]+)?)[\\s.．、]{0,3}(万元|万|元)", "g");
    let m;
    while ((m = re.exec(text))) {
      const num = parseFloat(m[1].replace(/[,，]/g, ""));
      if (!isFinite(num) || num <= 0) continue;
      const wan = m[2] === "元" ? num / 10000 : num;
      if (wan <= 0 || wan > 1e8) continue;
      return String(Math.round(wan * 10000) / 10000);
    }
  }
  return "";
}

// 业绩要求：正常标签抓不到时，再判"复选框式资格条款"（浙江 PDF 常见）
//   「□ 3.4 自 / 年 / 月 / 日以来完成过 / 业绩；」 → □/£ 未勾选 = 招标人明确不要求业绩 → 记"不要求"
//   「R 3.4 自 2021 年…完成过 …业绩」        → R/☑ 已勾选 = 取该条全文
// 注意："不要求"是对复选框状态的如实读取，与"没抓到"（留空）语义不同，不可混用。
/**
 * 业绩条款被「同名子标签」切碎的修复（2026-08-11 江苏实测）。
 *
 * 原文：「3.4资格审查可选条件：入围业绩要求：（1）企业准入业绩要求：无（2）项目负责人业绩要求：无□3.4.1…」
 * 标签通道从"入围业绩要求："取值，但窗口内又撞上 STOP_LABELS 里的"业绩要求"，
 * 于是在第一个子项处就截断 → 抓出「（1）企业准入」这种半截标题（真实答案是两项都"无"）。
 * 特征很好认：值以 (1)/（1）/1、这类**列表编号开头** —— 正常业绩条款不会这么起头。
 * 命中特征时改走整段抽取：取到下一个条款编号（□3.4.1 / 3.5）为止，保留内部子标签。
 */
const PERF_TRUNC = /^[（(]\s*\d+\s*[）)]|^\d+\s*[、.]/;

function grabPerfClause(flat) {
  const m = flat.match(/(?:入围业绩要求|业绩要求|业绩条件|类似工程业绩)\s*[:：]/);
  if (!m) return "";
  const start = m.index + m[0].length;
  const seg = flat.slice(start, start + 400).split(/(?:[□☑☒✓√■¨£R]\s*)?\d+\.\d+(?:\.\d+)?/)[0];
  return cleanVal(seg.replace(/[\r\n]+/g, "")).replace(/[□☑☒✓√■¨£；;，,、\s]+$/, "");
}

function grabPerformance(text, flat) {
  // 江苏建设工程通用模板会保留未勾选的 3.4.1「承担过类似工程」整段说明，说明文字本身又含
  // 「类似工程业绩的企业……」；若直接从“业绩”标签抓，会把模板说明误报成真实业绩要求。
  // 先读复选框状态：明确未勾选 = 不要求；只有勾选时才继续抽取具体条款。
  const perfCheckbox = text.match(/([R☑√■⊠□£])\s*3\s*\.\s*4\s*\.\s*1[\s\S]{0,120}?承担过类似工程/);
  if (perfCheckbox && /[□£]/.test(perfCheckbox[1])) return "不要求";
  const namedCheckbox = text.match(/([R☑√■⊠□£])\s*类似项目业绩要求\s*[:：]/);
  if (namedCheckbox && /[□£]/.test(namedCheckbox[1])) return "不要求";
  // 郑州模板把“企业类似工程业绩”和“项目经理类似工程业绩”拆成两组复选框。
  // 只读取企业组中已勾选的“要求/不要求”，不能把小标题本身写进业务表。
  const enterpriseSection = text.match(/企业类似工程业绩([\s\S]{0,900}?)(?=(?:\d+\s*\.\s*\d+\s*\.\s*\d+\s*)?项目经理类似工程业绩|$)/);
  if (enterpriseSection) {
    const seg = enterpriseSection[1];
    const checkedReq = seg.match(/[R☑√■⊠þ]\s*要求\s*[,，：:]?\s*([\s\S]*?)(?=\n\s*(?:说明|类似工程业绩具体要求|\d+\s*\.\s*\d+\s*\.\s*\d+)|$)/);
    if (checkedReq) {
      const clause = cleanVal(checkedReq[1].replace(/[\r\n]+/g, " "));
      if (isMeaningful(clause, 4)) return clause;
    }
    if (/[R☑√■⊠þ]\s*不要求类似工程业绩/.test(seg)) return "不要求";
    // 河南等公告不用复选框，标题后直接给出分标段企业业绩条款。
    // 只在出现合同金额/完成业绩等强语义时采用，避免再次返回光杆小标题。
    const directClause = cleanVal(seg.replace(/^\s*[:：]\s*/, "").replace(/[\r\n]+/g, " "));
    if (isMeaningful(directClause, 12) && /合同金额|完成的?.{0,20}(?:工程)?业绩|业绩一项|验收时间/.test(directClause)) return directClause.slice(0, 500);
  }
  // 烟台工程公告的明确空值形态：「3.4 业绩要求：/ 3.5 其他要求」。
  // 斜杠不是缺失，而是发布方明确表示无业绩要求；须在宽松 grab 跨入 3.5 前截住。
  if (/(?:业绩要求|业绩条件|企业业绩)\s*[:：]\s*[\/／]\s*(?=\d+\.\d|[。；;\n]|$)/.test(text)) return "不要求";
  const directSimilar = text.match(/具有与本工程相类似项目的(?:设计|施工|监理)?业绩\s*[:：]\s*([\s\S]{10,700}?)(?=类似业绩证明材料|证明材料需提供|\n\s*3\s*\.\s*4\s*\.\s*2)/);
  if (directSimilar) return cleanVal(directSimilar[1].replace(/[\r\n]+/g, " ")).slice(0, 500);
  // 福建施工公告模板把答案放在“用于确定类似工程业绩的相关数据”后。
  // 明确写“无”或“/”就是不要求，不能把标签尾巴“的相关数据”当成业绩事实。
  if (/用于确定类似工程业绩的相关数据\s*[:：]\s*(?:无|[\/／])(?=\s|[（(；;。]|$)/.test(text)) return "不要求";
  // "以下业绩"：海南 G98 环岛高速检测公告写「2.投标人需同时具备以下业绩：2021年1月1日至…」，
  // 标签既不是"业绩要求"也不是"业绩条件"，原标签表全落空 → 真实业绩条款被当成"未载"。
  const v = grab(text, ["入围业绩要求", "业绩要求", "业绩条件", "企业业绩", "类似工程业绩", "以下业绩", "类似业绩"]);
  if (v && PERF_TRUNC.test(v) && flat) {
    const c = grabPerfClause(flat);
    if (c && c.length > v.length) return c;   // 整段更完整才替换，避免无谓改动
  }
  if (v
    && !/^[（(]?\s*\d+(?:\.\d+)?\s*分\s*[）)]?$/.test(v)
    && !/^(?:的企业(?:或者|或)项目负责人[\s\S]*|的相关数据(?:\s*[:：]\s*(?:无|[\/／]))?|(?:\d+(?:\.\d+)+\s*)?企业类似工程业绩|[A-Z]{1,8}(?:[-_]\d+)?)$/i.test(v.trim())) return v;
  let i = -1;
  while ((i = text.indexOf("业绩", i + 1)) >= 0) {
    const before = text.slice(Math.max(0, i - 120), i);
    const m = before.match(/([R☑√■⊠□£])(?![\s\S]*[R☑√■⊠□£])([\s\S]*)$/);
    if (!m) continue;
    if (/[R☑√■⊠]/.test(m[1])) {
      const line = cleanVal((m[2] + text.slice(i, i + 60)).replace(/\n/g, " "));
      if (isMeaningful(line, 4)) return line;
    } else {
      return "不要求";
    }
  }
  return "";
}

// 电话专用：必须命中"数字串"才算数，避免把"联系方式详见招标文件"这类条款当电话。
// 兼容 PDF 版式的"联系电话：\n0573-83677762"（标签与值被换行拆开）。
//
// ⚠ 不可用「窗口内出现关键词就排除」的粗暴规则。嘉兴公告实测反例：
//   招标人「嘉兴经济【技术】开发区建设投资集团」→ 命中"技术"被误排除；
//   代理机构「嘉兴经投工程【咨询】服务有限公司」→ 命中"咨询"被误排除。
//   结果两个真实联系电话全被丢掉，字段假性留空。
// 正解：按「就近角色」判定 —— 取号码前 120 字内**最后出现**的角色标记，
//       它才是这个号码真正的归属方；公司名里的字眼不构成角色标记。
const PHONE_ROLE_BAD = /(行政监督|监督部门|监督机构|监督电话|投诉|举报|技术支持|客服|服务热线|咨询电话|注册咨询|平台咨询|系统热线|运维|CA\s*锁|CA\s*证书)/g;
const PHONE_ROLE_GOOD = /(联系人|招标人|招标代理机构|代理机构|投标人|项目负责人|联系方式|采购人)/g;
function lastMatchIndex(s, re) {
  re.lastIndex = 0;
  let idx = -1, m;
  while ((m = re.exec(s))) idx = m.index;
  return idx;
}
function grabPhone(text) {
  // 标签本身也可能被 PDF 硬换行拆开（"电\n话："），故用 电\s*话
  const re = /(联系电话|电\s*话|Tel|手\s*机)\s*[:：]?\s*((?:\d[\d\-－()（）\s]{5,26})|(?:1[3-9]\d{9}))/gi;
  const good = [], plain = [];
  let m;
  while ((m = re.exec(text))) {
    // 号码可能被换行拆开（缙云"40099800\n00"），先去掉所有空白
    let v = m[2].replace(/[（）()\s]/g, "").replace(/－/g, "-").replace(/-+$/, "").trim();
    // PDF 里号码常与后文粘连（嘉兴"0573-83633117"+"2026"→16 位）：按标准号码模式截前缀
    const norm = v.match(/^(1[3-9]\d{9})/) || v.match(/^(\d{3,4}-\d{7,8})/) || v.match(/^(\d{7,8})/);
    if (norm) v = norm[1];
    const digits = v.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 12) continue;
    const near = text.slice(Math.max(0, m.index - 120), m.index);
    const badAt = lastMatchIndex(near, PHONE_ROLE_BAD);
    const goodAt = lastMatchIndex(near, PHONE_ROLE_GOOD);
    if (badAt > goodAt) continue;              // 最近的角色是监督/投诉/客服 → 非项目联系电话
    (goodAt >= 0 ? good : plain).push(v);
  }
  return good[0] || plain[0] || "";
}

// ---- 扁平化兜底通道 ----
// PDF 版式的换行是「排版换行」不是「语义换行」，会把标签本身都劈开，实测（武义县公告）：
//   资金来源 → "建设资金来\n自\n自筹"      标签"建设资金来自"被拆断，任何标签匹配都失败
//   开标时间 → "为\n202\n6\n年\n9\n月"     连年份数字都被拆开，日期正则无法成立
// 中文没有词间空格，把换行直接抹掉再匹配是安全的。仅作为「主通道失败后」的兜底，
// 且用比 grab 模式2 更保守的截断（遇逗号/句号/分号即止），避免扁平化后一路吃到几百字噪声。
function flatten(text) {
  return text.replace(/[ \t]*\n[ \t]*/g, "");
}
function grabFlat(flat, labels, minLen) {
  for (const lab of labels) {
    const m = flat.match(new RegExp(labRe(lab) + "\\s*[:：]?\\s*([^\\n，,。；;]{2,120})", "i"));
    if (m) { const v = trimAtClause(cleanVal(m[1])); if (isMeaningful(v, minLen)) return v; }
  }
  return "";
}

/**
 * 逐标签「主通道 → 扁平通道」。
 *
 * ⚠ 不能写成 grab(全部标签) || grabFlat(全部标签)：标签表是按**特异性降序**排的，
 * 若让所有标签先跑完主通道，一个泛标签在主通道抓到的残值，会挡住特异标签在扁平通道的正解。
 * 嵊州公告实测：正文「建设资金\n来自\n自有资金」
 *   旧序：主通道"建设资金来自"取到 "自有资金" 前被换行截断 → 失败；退到泛标签"建设资金" → 取到 "来自" ✅返回（错）
 *   新序：标签"建设资金来自" 主通道失败 → 立刻走扁平通道 → "自有资金" ✅（对）
 */
function grabBoth(text, flat, labels, minLen) {
  for (const lab of labels) {
    const a = grab(text, [lab], minLen);
    const b = grabFlat(flat, [lab], minLen);
    // 主通道值恰好是扁平通道值的**前缀** ⇒ 主通道被 PDF 硬换行拦腰截断了，取扁平版本。
    //   缙云公告「招标人为\n缙云\n县东渡镇人民政府\n，…」→ 主通道 "缙云"，扁平 "缙云县东渡镇人民政府"
    //   温州公告「建设资金来自 自有资\n金;银行贷款 ，…」→ 主通道 "自有资"，扁平 "自有资金;银行贷款"
    // 只认前缀关系，不做"谁长取谁"：后者会让扁平通道的越界长句盖掉主通道的精确值。
    // 但"前缀"还不够：扁平化把换行全抹了，若原文靠换行分隔字段（「…有限公司\n地 址：\n…\n联 系 人：\n卢旭」），
    // 扁平通道会一路吃穿好几个字段，而它同样以主通道值开头。两道保险把这种越界挡掉：
    //   ① 延长部分不得超过 12 字 —— 补一个被拆断的词尾是短距离行为，吃穿字段是长距离行为；
    //   ② 延长部分不得含冒号 —— 出现冒号即证明已经越过下一个字段的标签。
    if (a && b) {
      const na = a.replace(/\s/g, ""), nb = b.replace(/\s/g, "");
      const grown = nb.length - na.length;
      if (grown > 0 && grown <= 12 && nb.startsWith(na) && !/[:：]/.test(b)) return b;
      return a;
    }
    if (a || b) return a || b;
  }
  return "";
}

// 机构名被 PDF 硬换行拦腰截断（武义县公告："招标代理机构：浙江明众工程管理有限公\n司"）
// → 单行取值得到"…有限公"，少一个字。用扁平化文本向后补至完整机构后缀为止。
const ORG_SUFFIX = /(有限责任公司|股份有限公司|有限公司|公司|集团|中心|管理局|建设局|人民政府|政府|委员会|管委会|办事处|指挥部|组织|合作社|事务所|研究院|设计院|院|局|厂|站|所|处|部)$/;
function completeOrgName(v, flat) {
  if (!v || ORG_SUFFIX.test(v)) return v;
  const i = flat.indexOf(v);
  if (i < 0) return v;
  for (let k = 1; k <= 5; k++) {
    const ext = flat.slice(i + v.length, i + v.length + k);
    if (!/^[\u4e00-\u9fa5]+$/.test(ext)) break;
    if (ORG_SUFFIX.test(v + ext)) return v + ext;
  }
  return v;
}

// 资质要求：部分公告不写"资质：xxx"，而是条款式「☑3.1 具备 市政公用工程施工总承包叁级及以上 资质；」
// 标签匹配全部失效，需按"具备/具有 … 资质"的句式反向捕获。
const QUAL_LABELS = ["资质类别和等级", "投标人资质", "资质要求", "资质等级", "资质条件", "资格条件", "设计资质", "施工资质", "资质情况"];
const SITE_LABELS = ["项目地点", "建设地点", "工程地点"];
// 2026-08-16 V5（烟台实测）：山东系城市站「信息来源： 招远市 发布时间：…」承载行政区，
// 但值后紧跟"发布时间"会被 grabBoth 模式2 拖进值里——故不走标签表，走 extractDetail 里的专项短值正则。
// 开标/投标截止：顺序＝特异性降序，泛标签「开标」必须垫底，否则会被"远程不见面开标模式"等条款抢先。
// 2026-08-11 江苏 r4 全量回源核验（diag-js-open.cjs，17 条空缺逐条看原文）暴露 3 类真实漏抓：
//   A 资格预审公告：「7.1资格预审申请文件递交截止时间为：2026年08月17日09时00分」 ×7 条
//   B 南京宁易新模板：「5.1 投标文件递交截止时间 ：2026-09-01 09:20:00」        ×3 条
//   C 南通模板：      「1、投标递交截止时间为：2026年8月17日9时30分」            ×2 条
// 原列表只有「投标截止时间」，中间插了"文件递交"就整体失配 → 12/17 条本可抓却留空。
const OPEN_LABELS = [
  "开标时间", "开标日期",
  // 同一件事有两种词序，都出现在真实公告里，必须都列：
  //   「资格预审申请文件递交截止时间为：…」（多数）
  //   「递交资格预审申请文件截止时间(申请截止时间，下同)为 …」（江都区标段，r6 核验剩余 1 条漏抓）
  "资格预审申请文件递交截止时间", "递交资格预审申请文件截止时间",
  "资格预审申请文件递交截止", "递交资格预审申请文件截止", "申请文件递交截止时间",
  "投标文件递交截止时间", "投标文件递交的截止时间", "递交投标文件截止时间",
  "投标递交截止时间", "投标文件提交止时间",
  // 2026-08-16 V5 取证回访补词（江西竞争性磋商/遵义实测原文）：
  //   江西「四、提交 响应 文件截止时间、 磋商 时间…2026年08月27日 09点30分」（政采磋商措辞）
  //   遵义「投标文件上传递交的截止时间为 北京时间2026年09月07日 09时30分」
  "提交响应文件截止时间", "磋商时间", "上传递交的截止时间",
  "响应文件提交截止时间",
  "投标截止时间", "递交截止时间",
  "开标",
];
// 资金来源及比例 必须排在 资金来源 之前：安徽公告栏目名即「资金来源及比例：政府性资金100%」，
// 先匹配短标签会把「及比例：政府性资金100%」当值抓出（2026-08-15 实测 23/23 条全部带此脏前缀）
const FUND_LABELS = ["资金来源及比例", "建设资金来自", "资金来自", "资金来源为", "资金来源", "建设资金", "所需资金", "出资比例"];
// 勘察设计/监理/服务类标段通篇没有"工期"二字，写成「2.5 勘察设计服务期限： 210 日历天」。
// 首轮 75 条核验实测漏抓 2 条（上虞区管网勘察设计、缙云产业园配套勘察设计），必须把服务期类标签补齐。
// 顺序＝特异性降序：先试最长最专的，避免"工期"这种泛标签抢先命中无关条款。
// 2026-08-11 江苏 r4 核验补：代建/代理类标段写「3.5 服务周期：自合同签订之日起至…」，"服务周期"未覆盖 → 2 条漏抓。
// ⚠ 但"服务周期"必须排在"工期"**之后**：灌云智慧化项目实测，评分条款里也有这四个字
//   「…投标人承诺系统运维服务周期和硬件质保在3年基础上增加1年得2分」，
//   放在"工期"前会抢先命中评分条款，把原本正确的"3年"污染成一整句评分描述（r5 回归实测退化）。
// 上海等平台用「建设周期/设计周期」而非「工期」（2026-08-15 上海实测：详情页写
// "设计周期：20日历天 建设周期：240日历天"，原 DUR_LABELS 无此标签 → 工期全空/误抓导航脏值）。
const DUR_LABELS = ["勘察设计服务期限", "设计服务期限", "服务期限", "计划工期", "建设工期", "建设周期", "设计周期", "工期", "服务周期", "服务期",
  // 2026-08-16 V5 取证回访补词（江西政采公告）：「合同履行期限： 自合同签订生效之日起 45 天内完成…」
  // ——政采/磋商类公告以"合同履行期限"表达工期/服务期。放泛标签后（垫底层，防服务合同外误抓）。
  "合同履行期限"];
const OWNER_LABELS = ["采购人名称", "采购人", "采购单位", "招标人为", "招标人", "建设单位", "业主单位"];
// 2026-08-16 Goal v3 回源核查新增：平台操作指引不是招标人（黑龙江"/招标代理机构在交易平台点击保证金退回申请"实测）
const OWNER_GARBAGE = /^[\/／]|点击|退回申请|操作指引|数字证书|不予受理|不得|应当|须|需/;
function grabOwnerGuarded(text, flat) {
  // 联系方式表中的完整机构名优先。避免正文先出现“逾期送达的投标文件，招标人不予受理”，
  // 把“不予受理”当成招标人（南通设计公告实测）。
  const ownerOrg = String(text || "").match(/招标人(?:信息)?\s*(?:名\s*称)?\s*(?:为|是|[:：])?\s*([^\n。；;]{2,100}?(?:人民政府|委员会|管理局|管理所|事业发展中心|服务中心|学校|医院|研究院|有限责任公司|股份有限公司|有限公司|集团|公司|中心|局|所|院))(?=\s|$)/);
  if (ownerOrg) return cleanVal(ownerOrg[1]);
  for (const lab of OWNER_LABELS) {
    const o = completeOrgName(grabBoth(text, flat, [lab]), flat);
    if (o && !OWNER_GARBAGE.test(o)) return o.replace(/^[为是：:\s]+/, "").trim();   // 噪声候选跳过，试下一标签；全噪声则诚实留空
  }
  return "";
}
const AGENCY_LABELS = ["招标代理机构", "采购代理机构", "代理机构为", "代理机构", "招标代理"];
const AGENCY_ORG = /(?:有限责任公司|有限公司|股份公司|集团公司|集团|公司|事务所|研究院|咨询中心|招标中心|服务中心)/;
const AGENCY_GARBAGE = /^(?:应|须|需|负责|点击|登录|查询|在|于)|应在|负责查询|操作指引|应急流程/;
function grabAgencyGuarded(text, flat) {
  const sources = [text, flat].filter(Boolean);
  const patterns = [
    /(?:招标|采购|委托)?\s*代理机构(?:信息)?\s*(?:名\s*称)?\s*[:：为]\s*([^\n。；;]{2,140})/g,
    /招标代理\s*[:：]\s*([^\n。；;]{2,140})/g,
  ];
  for (const source of sources) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(source))) {
        let v = completeOrgName(trimAtClause(cleanVal(m[1])), flat);
        // 取本行最末机构后缀，避免「温州建设集团建筑设计院有限公司」在较早出现的
        // “集团”处被非贪婪匹配截成「温州建设集团」。
        const org = v && v.match(new RegExp("^.{1,100}" + AGENCY_ORG.source));
        if (org) v = org[0];
        if (v && AGENCY_ORG.test(v) && !AGENCY_GARBAGE.test(v)) return v.slice(0, 100);
      }
    }
  }
  // 兼容旧公告的非标准版式，但必须经过机构名和噪声双重校验。
  const fallback = completeOrgName(grabBoth(text, flat, AGENCY_LABELS), flat);
  return fallback && AGENCY_ORG.test(fallback) && !AGENCY_GARBAGE.test(fallback) ? fallback : "";
}
const CONTACT_LABELS = ["联系人", "项目联系人", "联系人员"];
function grabContactGuarded(text, flat) {
  let value = grabBoth(text, flat, CONTACT_LABELS, 2);
  if (!value) return "";
  // PDF 常把标签拆成「联 系 人」「电 话」。grab 的跨行兜底会把电话乃至下一机构
  // 一并接到姓名后；按容空白的下一个字段标签截断，只保留真实联系人。
  const stop = ["电话", "手机", "招标代理机构", "采购代理机构", "代理机构", "地址", "邮编"]
    .map(labRe).join("|");
  value = value.replace(new RegExp("(?:" + stop + ")[\\s\\S]*$"), "");
  value = cleanVal(value).replace(/\s+/g, "").trim();
  if (!value || value.length > 30 || /\d{5,}/.test(value)) return "";
  return value;
}
// 工期：监理/服务类公告通篇没有"工期"二字，写成表单勾选式（浙江德清滨海燃气监理实测）：
//   2.3计划监理服务期：
//   □ 个日历天，从 年 月 日起，至 年 月 日止。
//   ☑ 从招标人书面确认监理单位进场后 500 个日历天（施工期）及间歇期和质量缺陷期等监理服务。
// 若只按标签取「冒号后第一段」，拿到的是**未勾选**的空白选项"个日历天，从年月日起"——那是假数据。
// 必须遍历各选项段，只认带勾选标记且含「数字+时间单位」的那一段。
const DUR_UNIT = /\d+\s*(?:个日历天|日历天|个工作日|工作日|天|个月|月|年)/;
const CHECKED = /[☑☒✓√■⊠]/;         // 已勾选；□/£/¨ 为未勾选
// 值里出现"得N分/加分/扣分/每增加"＝抓到的是**评标办法评分条款**，不是工期本身。
// 2026-08-11 江苏灌云实测：「运维服务周期和硬件质保在3年基础上增加1年得2分」被当成工期。
// 命中即弃用该标签、继续试下一个更泛但更准的标签（如"工期"）。
const DUR_SCORE_NOISE = /得\s*\d+(?:\.\d+)?\s*分|得分|加分|扣分|每增加|每延长/;
// 2026-08-16 Goal v3 回源核查新增：EPoint 表格拼接串（黑龙江"（天）监理费上限（万元）SZJL0504…2026年10月31日43537.62"、
// 兵团"（天） E6699004… 第四师G218…"）内日期"2026年"会被 DUR_UNIT 误判为"N 年工期"；海南出现"要求：总工期或计划开工日期为"
// 截断句。拒收特征：以（天）开头 / 含（万元）/ 含字母+长数字编号 / 以"为""："等截断词收尾。
const DUR_GARBAGE = /^[(（]\s*天[)）]|[（(]\s*万元\s*[)）]|[A-Za-z]\d{6,}|[为：:]\s*$/;
const DUR_SCOPE_NOISE = /工程量清单|施工图|图纸|招标范围|范围内所有工程|所有工程施工|工作内容/;

function grabDuration(text, flat) {
  const durClean = (s) => cleanVal(String(s)
    .replace(/^\s*要求\s*[:：]\s*/, "")
    .replace(/^\s*总工期\s*为\s*(?=\d)/, "")
    .replace(/^\s*(?:为|共)\s*(?=\d)/, ""));  // 重庆"要求：270日历天"、辽宁"为540天"剥前缀
  // 单位判定前剔除日期串（"2026年10月31日"里的"年"不是工期单位）
  const durUnitHit = (s) => DUR_UNIT.test(String(s).replace(/(?:19|20)\d{2}\s*年(?:\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?)?/g, ""));
  // 先取紧邻“计划工期/工期”的数字时间值，避开复合标题“招标范围及标段划分、计划工期”
  // 后面尚有大量复选框时，兜底扫描会把“☑其他：施工图纸……”错当工期（绵阳公路公告实测）。
  const directRe = /(?:计划工期|总工期|工期)\s*(?:要求\s*)?[:：]?\s*(?:为\s*)?(\d+\s*(?:个日历天|日历天|个工作日|工作日|天|个月|月|年))/g;
  let direct;
  while ((direct = directRe.exec(text))) {
    const candidate = durClean(direct[1]);
    const neighborhood = text.slice(direct.index, direct.index + 100);
    if (durUnitHit(candidate) && !DUR_SCORE_NOISE.test(neighborhood)) return candidate;
  }
  let v = "";
  for (const lab of DUR_LABELS) {              // 逐标签取值，等价于原 grabBoth(整列表)，但可对单个候选做质检
    const raw = grabBoth(text, flat, [lab]);
    if (!raw) continue;
    const one = durClean(raw);
    if (DUR_SCORE_NOISE.test(one) || DUR_GARBAGE.test(one)) continue;   // 评分条款/表格拼接串 → 换下一个标签
    if (!durUnitHit(one) && DUR_SCOPE_NOISE.test(one)) continue;         // 抓到招标范围/施工内容，不是工期
    if (!v) v = one;                           // 记住首个非噪声值作为兜底
    if (durUnitHit(one)) return one;           // 自带天/月/年数字 → 立即可信
  }
  const m = flat.match(/(?:计划监理服务期|监理服务期|服务期限|服务期|计划工期|建设工期|工期)\s*[:：]?([\s\S]{0,400})/);
  if (m) {
    for (const seg of m[1].split(/(?=[☑☒✓√■⊠□£¨])/)) {
      if (!CHECKED.test(seg[0] || "")) continue;                 // 跳过未勾选项
      if (!durUnitHit(seg)) continue;                            // 跳过勾了但没写天数的
      const one = durClean(seg.replace(/^[☑☒✓√■⊠]\s*/, "").split(/[。；;]/)[0]);
      if (isMeaningful(one, 4) && !DUR_GARBAGE.test(one)) return one.slice(0, 60);
    }
  }
  return v || "";                                // 主通道虽无数字，也好过留空（如"详见招标文件"）
}

/**
 * 资质值的"像不像资质"校验。
 *
 * 标签"资质等级"会命中联合体条款：「由同一专业的单位组成的联合体，按照资质等级较低的单位确定
 * 资质等级」→ 抓出 "较低的单位确定"，字数够、看着像句话，实则是**评标规则**不是投标人资质要求。
 * 嘉兴 EPC 公告（zj1）实测就栽在这里。真资质必然带资质名或等级词，用它当准入闸。
 */
// "详见招标文件"是公告的真实写法，属有效记录（诚实记录原文，好过去抓条款残句）
const QUAL_OK = /(?:资质|许可证|甲级|乙级|丙级|[一二三四五六七八九壹贰叁肆伍]级|总承包|专业承包|详见招标文件|见招标文件)/;

/**
 * 条款残句黑名单（2026-08-10 海南实测补强）。
 *
 * QUAL_OK 只查"含不含资质词"，但联合体条款切出来的碎片**本身就含"资质等级"四个字**，
 * 照样能骗过闸门：
 *   原文「由同一专业的单位组成的联合体，按照资质等级较低的单位确定资质等级」
 *   → 标签"资质等级"命中 → 抓出 "较低的单位确定资质等级" → QUAL_OK 放行 → 假值入库
 *   （海南定安县龙门水厂监理公告实测；该公告全文压根没写投标人资质要求，正解是留空）
 * 特征：以连接词/形容词起头的半截句，或含"确定资质等级""的单位确定"这类评标规则用语。
 */
const QUAL_BAD = /^(?:较低|较高|和|或|由|按|应|须|需|的)|确定资质等级|的单位确定|承担连带责任|各方均应/;

/**
 * 资质条款「整条」抽取（2026-08-10 浙江回归实测补强）。
 *
 * 短语式抽取（标签通道 / "具备…资质"兜底）在**多项资质**公告上会残缺：
 *   缙云地下管网设计：原文「☑3.1具备以下设计资质中的其中一种资质：（1）工程设计综合甲级；
 *     （2）市政行业设计乙级及以上；（3）市政行业（道路/给水/排水）设计乙级及以上」
 *     → 短语通道只抓到分包条款里的"相应设计资质"（错项）
 *   武义污水零直排 EPC：原文「3.1须同时具备下列①、②要求：①工程设计综合甲级…②市政公用
 *     工程施工总承包三级及以上资质」→ 短语通道截断在第①项，丢掉施工资质（投标人据此会误判能否投）
 *
 * 正解：在「投标人资格要求」段内按条款编号（3.1/☑3.1/□3.2）切单元，取第一个含资质且已勾选的
 * 整条。未勾选项（□/£/¨ 开头）必须跳过，否则抓到的是空白选项。
 * 注意排除「拟派项目负责人资格要求」段——那是人员证书要求不是企业资质。
 */
const QUAL_SEG = /(?<!负责人|技术人员|项目经理)(?:投标人资格要求|投标人资格条件|投标人的资格要求|资格要求|资格条件)\s*[:：]?/;

function grabQualClause(flat) {
  const m = flat.match(QUAL_SEG);
  if (!m) return "";
  const start = m.index + m[0].length;
  const body = flat.slice(start, start + 1500);
  // 按条款编号切单元；lookahead 保留编号本身，便于识别勾选标记
  for (const u of body.split(/(?=(?:[□☑☒✓√■¨£]\s*)?\d\.\d+)/)) {
    if (!/资质/.test(u)) continue;
    if (/^\s*[□£¨]/.test(u)) continue;                        // 未勾选条款 → 是空白选项，跳过
    let v = u.replace(/^(?:[□☑☒✓√■¨£]\s*)?\d\.\d+\s*/, "");  // 去掉本条编号
    v = v.replace(/[□☑☒✓√■¨£]?\s*\d\.\d+[\s\S]*$/, "");      // 掐掉粘连的下一条
    v = cleanVal(v.replace(/[\r\n]+/g, "")).replace(/[；;，,、\s]+$/, "");
    // 整条常以标签自身起头（江苏「投标人资质类别和等级：施工资质条件：…」），剥掉避免字段里重复标签
    v = v.replace(/^(?:投标人)?资质(?:类别和?等级|要求|条件)\s*[:：]\s*/, "");
    if (v.length > 300) v = v.slice(0, 300);
    if (v && QUAL_OK.test(v) && !QUAL_BAD.test(v) && isMeaningful(v, 8)) return v;
  }
  return "";
}

// 资质信息量计数：用于在"整条"与"短语"之间择优（谁覆盖的资质项多用谁）
function countQual(s) {
  return (String(s || "").match(/资质|许可证|甲级|乙级|丙级|[一二三四五六七八九壹贰叁肆伍]级/g) || []).length;
}

function grabQualification(text, flat) {
  // 天津等公告把企业资格写成「本次招标要求投标人具有：一标段: 资质:市政…一级及以上，资格:…」。
  // 通用标签会在“投标人具有”处过早截断；先取紧邻“资质:”的值，且仍用资质闸门避免把人员资格写入企业资质。
  const tenderMatch = text.match(/本次招标要求投标人具有[\s\S]{0,120}?(?:资质|资格)\s*[:：]\s*([^\n，,；;]{4,160})/);
  if (tenderMatch) {
    const tenderValue = cleanVal(tenderMatch[1]).replace(/\s+/g, " ").trim();
    if (QUAL_OK.test(tenderValue) && !QUAL_BAD.test(tenderValue)) return tenderValue;
  }
  let phrase = "";
  // 逐标签取值 + 逐标签校验：不能等 grabBoth 跑完整个标签表，
  // 否则泛标签抓到的假值会直接返回，后面更特异的"设计资质/施工资质"根本没机会上场。
  for (const lab of QUAL_LABELS) {
    const one = grabBoth(text, flat, [lab]);
    if (one && QUAL_OK.test(one) && !QUAL_BAD.test(one)) { phrase = one; break; }
  }
  // 兜底：部分公告不写"资质：xxx"，只有条款式「☑3.1 具备 市政公用工程施工总承包叁级及以上 资质；」
  if (!phrase) {
    const m = text.match(/(?:具备|具有|持有)\s*([^。；;]{4,100}?)资质/);
    if (m) {
      const v2 = cleanVal(m[1].replace(/[\r\n]+/g, "")) + "资质";
      if (isMeaningful(v2, 6) && !QUAL_BAD.test(v2)) phrase = v2;
    }
  }
  // shanghai 等平台写成「资质要求： 设计资质要求 第一条 市政行业排水工程专业资质甲级 以上…」，
  // grabBoth 主通道只取到子标签（"设计资质要求"）就因前缀增长上限(12字)回退；此处若 phrase 仅是裸子标签，
  // 从 flat 续抓其后正文（遇句末/分号/220字为止，并截断到下一字段标签前）补全，避免只留一个无内容标签。
  // 仅对"裸标签"触发，其他省已拿到完整短语的不受影响；QUAL_OK/QUAL_BAD/countQual 三重把关防回归。
  if (phrase) {
    const bare = phrase.replace(/\s/g, "");
    if (/^(?:设计|施工|监理|勘察|供货|货物|投标)?资质要求?$/.test(bare)) {
      const esc = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const em = flat.match(new RegExp(esc + "\\s*[:：]?\\s*([^。；;]{4,220})"));
      if (em) {
        let ev = cleanVal(em[1]).replace(/\s+/g, " ").trim();
        ev = ev.replace(/(项目负责人|项目经理|其他要求|是否接受联合体|投标有效期|招标文件获取).*$/, "").trim();
        if (ev && QUAL_OK.test(ev) && !QUAL_BAD.test(ev) && countQual(ev) >= countQual(phrase)) {
          phrase = (phrase + " " + ev).replace(/\s+/g, " ");
        }
      }
    }
  }
  // 整条 vs 短语择优：仅当整条覆盖的资质项**更多**才替换。
  // 平手时保留短语（如"水利水电工程施工总承包叁级及以上资质"比整句更干净），避免无谓改动。
  const clause = grabQualClause(flat);
  if (clause && countQual(clause) > countQual(phrase)) return clause;
  return phrase;
}

function numFrom(s) {
  if (!s) return "";
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : "";
}

// ---- A阶段(2026-08-14) 新增公告内字段抽取：项目编号/招标方式/建设规模/招标范围/批准文号/项目经理 ----
// 调研证据（北京/山西/黑龙江/安徽/西藏 5 省真实详情页）：这些字段 90%+ 公告正文都有，但此前通用 extractDetail 不抽。
const CODE_LABELS = ["项目编号", "招标项目编号", "标段编号", "交易项目编号", "项目代码", "招标编号", "标段号", "招标项目代码", "采购项目编号", "项目序号"];
const METHOD_LABELS = ["招标方式", "招标组织形式", "采购方式", "发包方式"];
const SCALE_LABELS = ["本标段工程的主要建设内容", "主要建设内容", "本次招标规模", "建设规模", "工程规模", "项目规模", "工程概况"];
const SCOPE_LABELS = ["本标段招标范围", "标段招标范围", "设计及相关服务范围", "监理及相关服务范围", "招标范围和内容", "招标范围", "招标内容及范围", "招标内容"];
const AMBIGUOUS_PROJECT_LABELS = ["建设内容", "项目概况", "项目基本情况"];
const COMBINED_PROJECT_LABEL = /^(?:招标范围及规模|招标范围和规模|建设规模及招标范围|项目概况及招标范围)$/;
const APPROVAL_LABELS = ["批准文号", "审批文号", "核准文号", "备案号", "项目批准文号", "立项批复", "可研批复"];
const MANAGER_LABELS = ["项目经理", "项目负责人", "项目总负责人", "总监理工程师"];

// 批准文号（批复/核准/备案文号）：形如 双发改审【2024】17号 / 湘发改投资〔2023〕456号 / X发改函〔2023〕N号
// 与 APPROVAL_LABELS 互补：源文常把"可行性研究报告的批复"与文号连写且无冒号（"…可行性研究报告的批复双发改审【2024】17号（批文名称及编号）批准建设"），
// grabBoth 的"标签+冒号+值"模式失配；此处按"机关+发改/住建/…+审/函/批+年号"专属形态直接捕获。
// 湖南实测：14 条里"批准"出现 6 次、"备案"7 次，但旧 APPROVAL_LABELS 仅抓到 1 条 → 本函数把批准/备案文号整体提取。
function grabApprovalNo(text) {
  if (!text) return "";
  const re = /[^的批复告经由据已现该\s，,。；;：:（）()【】\[\]]{1,6}(?:发改|住建|交通|水利|审批|核准|备案|资规|自然|规划|财政|生态环境|农业农村)[^的批复告经由据已现该\s，,。；;：:（）()【】\[\]号]{0,5}?(?:\[|【|〔)?\d{4}(?:\]|】|〕)?第?\d*号/g;
  let best = "";
  let m;
  while ((m = re.exec(text))) {
    const v = m[0].replace(/\s+/g, ""); // 整段匹配即文号（正则无捕获组）
    // 只认项目立项/审批语境。平台政策通知（如“远程异地评标通知 烟发改公管…”、
    // “政府采购信用承诺制通知”）虽然长得像文号，却不是当前项目批准文号。
    const ctx = text.slice(Math.max(0, m.index - 100), Math.min(text.length, re.lastIndex + 100));
    if (!/(?:项目|工程|可行性研究报告|初步设计)[\s\S]{0,80}?(?:批复|批准建设|审批|核准|备案|立项)|(?:批复|批准建设|审批|核准|备案|立项)[\s\S]{0,80}?(?:项目|工程|可行性研究报告|初步设计)/.test(ctx)) continue;
    if (v.length > best.length) best = v; // 取最长（最完整的文号）
  }
  return best;
}

// 项目编号：必须是"像编号"的串（字母+数字+少数分隔符，长度≥5），否则可能是正文里的随机句子
const CODE_OK = /^[A-Za-z0-9][A-Za-z0-9\-_／/.]{4,}$/;
function grabProjectCode(text, flat) {
  // 公示标题常写成“（招标编号：X460...）”。先走紧邻标签的编号专用通道，
  // 避免通用 grab 被括号或后续正文截断后判成非编号。
  const direct = text.match(/(?:招标项目编号|招标编号|项目编号|交易项目编号|采购项目编号)\s*[:：]\s*([A-Za-z0-9][A-Za-z0-9\-_／/.]{4,})/);
  if (direct && CODE_OK.test(direct[1])) return direct[1].slice(0, 60);
  let v = grabBoth(text, flat, CODE_LABELS, 4);
  if (!v) return "";
  // 去标签前缀 + 首尾括号/空白（山西写"（招标项目编号： E14…001 ）"，尾括号会废掉 CODE_OK）
  v = v.replace(/^(?:项目|招标|标段|交易|采购)?(?:编号|代码|号|项目代码)\s*[:：]?\s*/, "").trim();
  v = v.replace(/^[（(]\s*/, "").replace(/[）)）\s]+$/, "");
  if (!CODE_OK.test(v) || /详见|为准|附件|系统|暂无/.test(v)) return "";
  return v.slice(0, 60);
}

// 招标方式归一化：只认含 公开/邀请/竞争/磋商/谈判/询价 的表述，避免抓到无关句
const METHOD_OK = /(公开|邀请|竞争性|磋商|谈判|询价|单一来源|招标)/;
function grabMethod(text, flat) {
  const v = grabBoth(text, flat, METHOD_LABELS, 2);
  if (v && METHOD_OK.test(v)) return v.replace(/^[为是：:\s]+/, "").trim().slice(0, 30);
  // 兜底：北京等写法"现进行公开招标"无"招标方式："标签，靠短语补
  const m = text.match(/(公开招标|邀请招标|委托招标|公开招标（委托招标）)/);
  if (m) return m[1];
  return "";
}

// 标签泄漏拦截：scale/scope 易抓到"建设规模与招标范围"这类复合标题的尾巴（"和招标范围"），
// 或抓到标签名本身（"招标内容与范围"）。去掉标签词后仍等于/只剩标签 → 诚实留空。
const LABEL_LEAK = /^(?:与|及|和|的)?(?:招标|建设|项目|工程|本工程|本次)?(?:内容|概况|范围|规模|地点|编号|标段)[:：]?/;
function grabScopeLike(text, flat, labels, minLen) {
  let v = grabBoth(text, flat, labels, minLen);
  if (!v) return "";
  v = v.trim();
  // 循环剥离复合标题尾巴（"建设规模与招标范围"→"与招标范围"→""），grabBoth 取值可能带前导空格需先 trim
  for (let i = 0; i < 3; i++) {
    const next = v.replace(LABEL_LEAK, "").replace(/^[与及和、，,的]+/, "").trim();
    if (next === v) break;
    v = next;
  }
  if (!v || labels.includes(v) || v.length < 4) return "";
  return v.slice(0, 200);
}
function grabProjectValueAll(text, flat, labels, prefer) {
  const candidates = [];
  // 招标范围常由“项目基本事实一句 + 本次招标独有内容一句”组成。若在第一个句号就截断，
  // 会只剩与 scale 相同的前缀，随后被包含关系去重成空。原始正文有换行边界时额外保留整行候选；
  // cleanProjectContent 仍负责在下一编号章节处截断，避免越界吞入资格/控制价等后文。
  if (prefer === "scope") {
    for (const label of labels) {
      const lineRe = new RegExp(labRe(label) + "\\s*[:：]\\s*([^\\n]{4,600})", "gi");
      let lineMatch;
      while ((lineMatch = lineRe.exec(String(text || "")))) {
        const value = cleanProjectContent(lineMatch[1]);
        if (value) candidates.push({ value, score: 1100 + Math.min(value.length, 300) });
      }
    }
  }
  for (const source of [String(text || ""), String(flat || "")]) {
    for (const label of labels) {
      const re = new RegExp(labRe(label) + "\\s*[:：]\\s*([\\s\\S]{4,600}?)(?=\\n\\s*(?:\\d+(?:\\.\\d+)+|[一二三四五六七八九十]+[、.])|[。；;]|$)", "gi");
      let match;
      while ((match = re.exec(source))) {
        const value = cleanProjectContent(match[1]);
        if (!value || value.length < 4) continue;
        let score = Math.min(value.length, 300);
        if (prefer === "scale") score += PROJECT_SCALE_SIGNAL.test(value) ? 1000 : 0;
        if (prefer === "scale" && PROJECT_SCOPE_STRONG_SIGNAL.test(value)) score -= 500;
        if (prefer === "scope") score += PROJECT_SCOPE_SIGNAL.test(value) ? 1000 : 0;
        candidates.push({ value, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
  return candidates[0] && candidates[0].value || grabScopeLike(text, flat, labels, 2);
}
function grabScale(text, flat) { return grabScopeLike(text, flat, SCALE_LABELS, 2); }
function grabScope(text, flat) { return grabScopeLike(text, flat, SCOPE_LABELS, 2); }

// 项目内容必须区分两个事实：scale=整个项目建设什么/规模多大，scope=本次招标承包什么。
// 优先结构化表格精确标签；合并字段只有命中可靠分界词才拆，不能拆时只进 scope 并留机器信号。
const PROJECT_TAIL_ONLY = /^(?:招标人有权|建设内容.*?增减|进行增减|中标人不得有异议|以(?:施工图纸|工程量清单|招标文件).*为准|详见附件)[\s\S]*$/;
const PROJECT_SCOPE_STRONG_SIGNAL = /本次招标|具体招标内容|招标范围|施工图纸|工程量清单|包括但不限于|施工总承包|工程总承包|设计服务|监理服务|采购内容|服务内容|全过程/;
const PROJECT_SCOPE_SIGNAL = /本次招标|具体招标内容|招标范围|施工图纸|工程量清单|包括但不限于|^包括|施工总承包|工程总承包|设计服务|监理服务|采购内容|服务内容|全过程/;
const PROJECT_SCALE_SIGNAL = /\d[\d,.]*\s*(?:m²|㎡|万m²|万㎡|平方米|万平方米|m³\/d|m3\/d|立方米\/日|公里|km|米|m|座|栋|层|处|个|套|户|吨|万吨|MW|kV|千伏)|[一二三四五六七八九十]+(?:项|座|栋|处)|新建|改建|扩建|整治面积|红线面积|设计规模|建设规模|道路工程|管网改造/;
const PROJECT_SPLIT_MARKERS = ["具体招标内容包括", "具体招标内容", "本次招标内容", "本次招标范围", "本次招标", "2.招标内容：", "2、招标内容：", "招标内容：", "招标范围为", "招标范围包括"];

function cleanProjectContent(value) {
  let v = String(value || "").replace(/^[\s\[【]+|[\s\]】]+$/g, "").replace(/\s+/g, " ").trim();
  v = v.replace(/^为\s*/, "").trim();
  // 云南等结构化详情会把记录 GUID 拼在建设规模正文尾部；仅清理独立 UUID 尾段，不碰项目编号正文。
  v = v.replace(/(?<![0-9a-f])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "").trim();
  if (!v || PROJECT_TAIL_ONLY.test(v)) return "";
  if (/^(?:(?:\d+(?:\.\d+)*)[、.．]?\s*)?(?:投资规模|建设规模|工程规模|项目规模|项目概况|工程概况|标段概况|标段名称|项目编号|招标编号|标段编号|交易编号)$/.test(v)) return "";
  if (/^(?:\d+(?:\.\d+)+\s*)?(?:(?:招标)?项目(?:或标段)?名称|标段名称|工程名称)\s*[:：]/.test(v)) return "";
  if (/^(?:\d+(?:\.\d+)+\s*)?(?:工程建设地点|建设地点|项目地点)\s*[:：]/.test(v)) return "";
  if (/^[\/／]\s*[，,；;]?\s*(?:工程建设地点|建设地点|项目地点)\s*[:：]/.test(v)) return "";
  if (/^(?:工程|服务|货物)-/.test(v) && (v.match(/-/g) || []).length >= 2) return "";
  if (/^[A-Za-z]{2,}[A-Za-z0-9_.\-/]{4,}$/.test(v)) return "";
  // 仅删除有实质正文后的法律保留尾句，不删除正文中的“以清单为准”等必要描述。
  const tail = v.search(/[。；;，,]\s*(?:招标人有权|建设内容.*?增减|中标人不得有异议)/);
  if (tail >= 12) v = v.slice(0, tail + 1).trim();
  const nextSection = v.search(/(?:(?:\d+(?:\.\d+)*)[、.．]\s*|\s+)(?:投标人|申请人|供应商)资格要求/);
  if (nextSection >= 4) v = v.slice(0, nextSection).trim();
  const numberedSection = v.search(/\s*\d+\.\d+\.?\s*(?:工程建设地点|工程建设规模|招标范围和内容|招标范围|建筑安装工程费|招标控制价|工期要求|质量要求)\s*[:：]/);
  if (numberedSection >= 4) v = v.slice(0, numberedSection).trim();
  const tenderAmountTail = v.search(/\s*[，,；;]?\s*(?:其中\s*[，,]?\s*□?\s*建筑面积|本次招标建安工程造价)/);
  if (tenderAmountTail >= 4) v = v.slice(0, tenderAmountTail).trim();
  return v.slice(0, 500);
}

function splitCombinedProjectContent(value) {
  const v = cleanProjectContent(value);
  if (!v) return null;
  for (const marker of PROJECT_SPLIT_MARKERS) {
    const i = v.indexOf(marker);
    if (i < 10) continue;
    const scale = cleanProjectContent(v.slice(0, i));
    const scope = cleanProjectContent(v.slice(i));
    if (scale && scope) return { scale, scope, marker };
  }
  return null;
}

function tableProjectFields(html) {
  const out = { scale: "", scope: "", ambiguous: [], combined: "" };
  for (const rows of tableRows(html || "")) {
    for (const row of rows) {
      for (let i = 0; i < row.length - 1; i++) {
        const label = String(row[i] || "").replace(/[：:]$/, "").replace(/\s+/g, "").trim();
        const value = cleanProjectContent(row[i + 1]);
        if (!label || !value) continue;
        if (!out.scale && SCALE_LABELS.includes(label)) out.scale = value;
        else if (!out.scope && SCOPE_LABELS.includes(label)) out.scope = value;
        else if (!out.combined && COMBINED_PROJECT_LABEL.test(label)) out.combined = value;
        else if (AMBIGUOUS_PROJECT_LABELS.includes(label)) out.ambiguous.push({ label, value });
      }
    }
  }
  return out;
}

function extractProjectContent(html, text, flat) {
  const structured = tableProjectFields(html);
  let scale = structured.scale;
  let scope = structured.scope;
  let scaleExact = !!structured.scale;
  let note = "";

  const combined = structured.combined;
  if (combined && (!scale || !scope)) {
    const split = splitCombinedProjectContent(combined);
    if (split) {
      if (!scale) scale = split.scale;
      const normScope = String(scope || "").replace(/[\s，,。；;]/g, "");
      const normCombined = combined.replace(/[\s，,。；;]/g, "");
      const normScale = split.scale.replace(/[\s，,。；;]/g, "");
      if (!scope || normScope === normCombined || normScope.includes(normScale)) scope = split.scope;
      note = `PROJECT_CONTENT_SPLIT_AT:${split.marker}`;
    } else {
      if (!scope) scope = combined;
      note = "PROJECT_CONTENT_COMBINED_UNSPLIT";
    }
  }

  for (const { value } of structured.ambiguous) {
    if (scale && scope) break;
    const split = splitCombinedProjectContent(value);
    if (split) {
      if (!scale) scale = split.scale;
      if (!scope) scope = split.scope;
      note = note || `PROJECT_CONTENT_SPLIT_AT:${split.marker}`;
      continue;
    }
    const hasScale = PROJECT_SCALE_SIGNAL.test(value);
    const hasScope = PROJECT_SCOPE_SIGNAL.test(value);
    const strongScope = PROJECT_SCOPE_STRONG_SIGNAL.test(value);
    if (hasScale && !strongScope && !scale) scale = value;
    else if (hasScope && !hasScale && !scope) scope = value;
    else if (strongScope && !scope) { scope = value; note = note || "PROJECT_CONTENT_COMBINED_UNSPLIT"; }
  }

  // 正文中的精确标签仍优先于“项目概况/建设内容”等歧义标签。
  // 天津实测同时出现“建设规模为97.966公里”和“项目概况：改造3.69公里”，必须保留前者为 scale。
  if (!scale) {
    scale = grabProjectValueAll(text, flat, SCALE_LABELS, "scale");
    if (scale) scaleExact = true;
  }
  if (!scope) {
    const numberedScope = String(text || "").match(/(?:^|\n)\s*2\s*\.\s*2\s*招标范围\s*[:：]\s*([\s\S]{4,1800}?)(?=\n\s*2\s*\.\s*3\s*)/m)?.[1] || "";
    scope = cleanProjectContent(numberedScope) || grabProjectValueAll(text, flat, SCOPE_LABELS, "scope");
  }

  if (!scale || !scope) {
    const ambiguous = grabProjectValueAll(text, flat, AMBIGUOUS_PROJECT_LABELS, "ambiguous");
    if (ambiguous) {
      const split = splitCombinedProjectContent(ambiguous);
      if (split) {
        if (!scale) scale = split.scale;
        if (!scope) scope = split.scope;
        note = note || `PROJECT_CONTENT_SPLIT_AT:${split.marker}`;
      } else {
        const hasScale = PROJECT_SCALE_SIGNAL.test(ambiguous);
        const hasScope = PROJECT_SCOPE_SIGNAL.test(ambiguous);
        const strongScope = PROJECT_SCOPE_STRONG_SIGNAL.test(ambiguous);
        if (hasScale && !strongScope && !scale) scale = ambiguous;
        else if (hasScope && !scale && !scope) scope = ambiguous;
        else if (strongScope && !scope && !scale) { scope = ambiguous; note = note || "PROJECT_CONTENT_COMBINED_UNSPLIT"; }
      }
    }
  }

  scale = cleanProjectContent(scale);
  scope = cleanProjectContent(scope);
  if (scale && scope && /本标段工程的主要建设内容/.test(scope) && scope.includes(scale)) scope = "";
  if (scale && scope) {
    const a = scale.replace(/[\s，,。；;]/g, "");
    const b = scope.replace(/[\s，,。；;]/g, "");
    if (a === b || b.includes(a)) {
      if (scaleExact && b.includes(a) && b !== a) {
        const remainder = cleanProjectContent(scope.replace(scale, "").replace(/^[，,。；;、\s]+/, ""));
        if (remainder && remainder.length >= 12 && PROJECT_SCOPE_STRONG_SIGNAL.test(remainder)) {
          scope = remainder;
          note = note || "PROJECT_CONTENT_SCOPE_DEDUPED";
        } else {
          scope = "";
          note = note || "PROJECT_CONTENT_DUPLICATE_TO_SCALE";
        }
      }
      else if (scaleExact) { scope = ""; note = note || "PROJECT_CONTENT_DUPLICATE_TO_SCALE"; }
      else { scale = ""; note = note || "PROJECT_CONTENT_DUPLICATE_TO_SCOPE"; }
    }
    else if (a.includes(b)) { scope = ""; note = note || "PROJECT_CONTENT_DUPLICATE_TO_SCALE"; }
  }
  return { scale, scope, note };
}

// 项目经理/项目负责人：只要姓名（2-5 汉字），截掉其后资质/证书/注册等条款，避免整段资质被当姓名
const MGR_BAD = /^(要求|为|等|详见|姓名|信息|如下|证书|资格|条件|情况|说明|通知|公告|文件|单位|人员)$|(中标|价格|开标|投标|金额|评定分离)/;
function grabManager(text, flat) {
  let v = grabBoth(text, flat, MANAGER_LABELS, 2);
  if (!v) return "";
  v = v.replace(/[（(][\s\S]*$/, "").replace(/(?:须|应|需)?具备[\s\S]*$/, "").replace(/的[\s\S]*$/, "").trim();
  if (!/^[一-龥·]{2,5}$/.test(v) || MGR_BAD.test(v)) return "";
  return v.slice(0, 10);
}

// 满分标准：原只认"满分标准"标签，漏掉"总分为XX分/满分XX分/评分满分"。2026-08-14 补强。
function grabFullScore(text, flat) {
  const direct = grab(text, ["满分标准", "评分满分", "满分分值"]);
  if (direct) return trimAtClause(direct).slice(0, 30);
  // "总分为 100 分" / "满分 100 分" / "最高 100 分"
  const m = text.match(/(?:总分|满分|最高分)\s*(?:为|：|:)?\s*(\d+(?:\.\d+)?)\s*分/);
  if (m) return m[1] + "分";
  return "";
}

// ---- 从详情 HTML 提取厚字段；优先各省 adapter.detail()，否则通用提取
// pdfText：当省平台正文是 PDF 附件时（如浙江），由 maybePdfText() 提取后并入正文一起匹配
function extractNoticeTitle(html, fallback = "") {
  const raw = String(html || "");
  const candidates = [
    // 合肥等 webBuilder 详情页把真实公告标题放在 meta ArticleTite（平台历史拼写），
    // 正文内的 <h1> 可能只是答疑段落标题，不能优先于页面元数据。
    raw.match(/<meta\b[^>]*name=["']ArticleTit(?:e|le)["'][^>]*content=["']([^"']+)/i),
    raw.match(/class=["'][^"']*article-title[^"']*["'][^>]*>([\s\S]*?)<\//i),
    raw.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i),
    raw.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i),
  ];
  for (const m of candidates) {
    const value = htmlToText(m && m[1] || "").replace(/\s+/g, " ").trim();
    if (value && value.length > 4
      && !/^(?:招标公告|公告|公示|详情)$/.test(value)
      && !/^(?:全国公共资源交易平台(?:（[^）]+）)?|[^]{0,30}公共资源交易(?:平台|中心|网))$/.test(value)) return value;
  }
  return String(fallback || "").trim();
}

// `zb` 阶段只接受真正的招标公告。部分官方“招标公告”接口会混入资审、变更、终止和结果；
// 仅在默认 zb 路径启用，candidate/result/contract 阶段不得继承此过滤。
function isStrictZbTitle(title) {
  const text = String(title || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return !/(?:资格预审(?:文件|公告)?|资审文件公告|预审结果|答疑|澄清|更正|变更|补充公告|终止公告|暂停公告|流标|废标|中标(?:候选人|结果|公告|公示)|成交(?:公告|结果|公示)|评标结果|合同(?:公告|公示))/.test(text);
}

function extractDetail(ad, html, item, pdfText) {
  if (ad.detail && typeof ad.detail === "function") return ad.detail(html, item, pdfText);
  const text = pdfText ? (htmlToText(html) + "\n" + pdfText) : htmlToText(html);
  const flat = flatten(text);   // 兜底通道，见 flatten() 注释
  const projectContent = extractProjectContent(html, text, flat);
  // 金额走严格模式：邻域必须有数字+单位，否则留空（不把"保证金不予退还"这类条款当金额）
  // 合同估算价放最后兜底：安徽公告无"控制价/最高限价"栏目，价款披露就是「N、合同估算价：5000038.66元」
  // （2026-08-15 对标标标通实测：安徽 23 条控制价填充率 43%→补此标签后可近满额；标标通控制价列即取此值）。
  // 语义上它是估算口径，但为安徽公告唯一价款字段，按标标通口径入控制价列；严格口径用户可看 budget 列。
  const explicitTenderConstructionZero = /本次招标建安工程造价\s*0(?:\.0+)?\s*万元/.test(text);
  const controlWan = explicitTenderConstructionZero ? "" : grabMoneyWan(text, ["招标控制价", "控制价", "最高投标限价", "最高限价", "预算金额", "预算价", "合同估算价",
    // 2026-08-16 V5 取证回访补词（重庆/青海/海南实测原文）：
    //   重庆「本次招标项目合同估算金额： 2964.95 万元」「总投资金额： 4095.29 万元」
    //   青海「标段估算价:1930.29万元」——复合词形态，原词族未覆盖
    "合同估算金额", "估算金额", "总投资金额", "标段估算价",
    // 2026-08-16 V5 attach 实测（浙江 PDF 已进管线 budget=680 却 CP 空）：浙江公告 PDF 写
    // 「本次招标建安工程造价 595.9142 万元」——建安工程造价即标段报价上限口径（安徽合同估算价同例，按标标通口径入列）
    "建安工程造价", "建安工程费"]);
  const bondWan = grabBondWan(text);
  const docLink = grabDocLink(html, item.url);
  return {
    title: extractNoticeTitle(html, item && item.title),
    projectSite: grabBoth(text, flat, SITE_LABELS) || (text.match(/信息来源\s*[：:]\s*(\S{2,12}?)(?:\s|发布)/) || ["", ""])[1],
    // 2026-08-16 V5（烟台实测）：山东系城市站「信息来源： 招远市 发布时间：…」——专项短值提取防"发布时间"尾随污染
    // 主通道用原文（保留换行边界更精准），失败再走扁平化文本
    bidOpen: grabDateTime(text, OPEN_LABELS) || grabDateTime(flat, OPEN_LABELS),
    // 倒装标签放前面：江苏为"建设资金来自自筹资金（资金来源）"，若先匹配"资金来源"会抓到右括号后文
    // "建设资金" 兜底：缙云公告写成「建设资金\n通过争取上级补助及县财政统筹安排」，无"来源/来自"字样
    // 扁平化兜底 minLen=2：武义县公告资金来源就是"自筹"两个字，属完整有效答案
    funding: grabBoth(text, flat, FUND_LABELS, 2).replace(/^(?:来源于|来自|于)(?=.{2})/, ""),
    duration: grabDuration(text, flat),
    // v4 增补：浙江 PDF 用「①设计资质：… ②施工资质：…」「资格条件：」表述，无"资质要求"字样
    qualification: grabQualification(text, flat),
    performance: grabPerformance(text, flat),
    controlPrice: controlWan,
    // 概算/估算单独记录，绝不冒充控制价（见 grabBudgetWan 注释）
    budget: grabBudgetWan(flat),
    bond: bondWan,
    evaluation: grabEvaluation(text),
    consortium: grabConsortium(text),
    fullScore: grabFullScore(text, flat),
    projectCode: grabProjectCode(text, flat),
    method: grabMethod(text, flat),
    scale: projectContent.scale,
    scope: projectContent.scope,
    _projectContentNote: projectContent.note,
    approval: grabApprovalNo(text) || grabBoth(text, flat, APPROVAL_LABELS, 2),
    manager: grabManager(text, flat),
    owner: grabOwnerGuarded(text, flat),
    // 代理机构：带"招标/采购"前缀的完整标签优先 —— PDF 正文里"委托代理机构为\n嘉兴经投工程咨询\n服务有限公司"
    // 的公司名被换行拆成两段，只有落款处"招标代理机构：…"是整行完整值。
    agency: grabAgencyGuarded(text, flat),
    // 联系人姓名常仅 2~3 字（"孙先生"），需把 minLen 放宽到 2，否则被 isMeaningful 默认阈值 4 过滤掉
    contact: grabContactGuarded(text, flat),
    phone: grabPhone(text),
    docLink,
  };
}

function tianjinDetail(html, item, pdfText) {
  const out = extractDetail({}, html, item, pdfText);
  if (out.evaluation === "评定分离") out.evaluation = "";
  const text = htmlToText(html);
  const scope = text.match(/本次招标标段为[\s\S]{0,400}?招标范围\s*[:：]\s*([\s\S]{20,1400}?)(?=本标段最高投标限价|\n\s*2\.4|计划工期要求)/);
  if (scope) out.scope = cleanProjectContent(scope[1]);
  return out;
}

// ---- B 阶段（Goal v1）：中标/合同 阶段详情抽取 ----
// 中标候选人公示：排名/中标候选人/投标报价/工期/得分（表格多行）；中标结果公告：中标人/中标价/项目负责人/工期。
// 合同公告：甲方/乙方/合同金额/签订日期。通用通道复用 grab*/flatten（与 extractDetail 同池），源页无即留空，绝不伪造。
const WINNER_LABELS = ["中标人", "中标单位", "成交供应商", "成交人", "拟定中标人", "第一中标候选人", "中标候选人", "承包人", "供应商", "乙方"];
const WIN_PRICE_LABELS = ["中标价", "中标金额", "中标总价", "中标总报价", "成交金额", "成交价", "合同价", "投标报价"];
const WIN_SCORE_LABELS = ["综合得分", "评标得分", "总得分", "得分", "评标总分"];
const PARTY_A_LABELS = ["招标人", "发包人", "甲方", "采购人", "建设单位", "业主"];
// 中标人抽取：先标签邻域（grabBoth），再补两类兜底，最后防污染清洗。
// 兜底 A（表格型，如青海「第1名 青海博众建设工程有限公司 / 完全响应 20025727.250元」）：
//   中标候选人公示常把 winner 放在「第N名」后的单元格，表头是"中标候选人名称"而非"中标人"，标签邻域法抓不到。
// 兜底 B（句式型，如江西「确定中国建筑第八工程局有限公司&…（联合体）为中标人」）：
//   "中标人"作句末谓语（「…为中标人」），标签在前值在后，标签邻域法也抓不到。
const ORG_TAIL = "有限公司|股份公司|公司|研究院|事务所|委员会|政府|集团|中心|大学|学校|医院|企业|合伙|局|院|所|队|站|（联合体）";
function grabWinnerTable(text) {
  const m = text.match(new RegExp("第\\s*[一二三四五六七八九十\\d]+\\s*名\\s*([一-龥·&（(][^/\\n，,。；）)]{2,40}?(?:" + ORG_TAIL + "))"));
  return m ? m[1].trim() : "";
}
function grabWinnerWeiZhongBiaoRen(text) {
  const m = text.match(/(?:确定|经评标委员会.*?推荐|根据.*?定标结果确定)\s*([^为]{2,60}?)\s*为中标人/);
  return m ? m[1].trim() : "";
}
function cleanWinnerRaw(v) {
  if (!v) return "";
  v = v.replace(/^(?:名称|名\s*称|单位名称|供应商名称|中标人名称|成交人名称)\s*[:：]\s*/, "");
  v = v.replace(/^(?:第[一二三]中标候选人|中标候选人|中标人|中标单位|成交人|成交供应商|拟定中标人|承包人|供应商|乙方)\s*[:：]?\s*/, "");
  v = v.replace(/[\s，,、]+\s*(?:得分|评分结果|评分|得分结果)\s*[:：]?\s*[\d.]+.*$/i, "");
  v = v.replace(/[（(][\s\S]*$/, "").replace(/\n[\s\S]*/, "").replace(/\s{2,}.*$/, "");
  const head = v.trim();
  // 栏目后缀词 / 占位符 / 引导语 → 视为无真实中标人，诚实留空（不污染报告）
  if (/^(?:公示|公告|结果|信息|详情|内容|如下|名单|候选人|中标候选人公示|中标结果公示)/.test(head)) return "";
  if (/业绩查询|查询网址|详见|查看详情|点击查看|见附件|点击此处|登录查看|详见附件|扫描二维码/.test(head)) return "";
  return head.slice(0, 60);
}
function grabWinner(text, flat) {
  let v = cleanWinnerRaw(grabBoth(text, flat, WINNER_LABELS, 2));
  if (!v) v = grabWinnerTable(text);
  if (!v) v = grabWinnerWeiZhongBiaoRen(text);
  if (!v) return "";
  // 机构名（含 公司/局/院/所/政府/集团/中心/大学/医院/企业/研究院）或 2-5 字人名
  if (/公司|局|院|所|政府|集团|中心|委员会|大学|学校|医院|有限|合伙|企业|研究院|事务所/.test(v) || /^[一-龥·]{2,5}$/.test(v)) return v.slice(0, 60);
  return v.slice(0, 60);
}
function grabScore(text, flat) {
  const v = grabBoth(text, flat, WIN_SCORE_LABELS, 1);
  if (!v) return "";
  const m = v.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : "";
}
function grabRank(text) {
  const m = text.match(/(?:第\s*)([一二三四五六七八九十\d]+)(?:\s*名|中标候选人)/);
  return m ? m[1] : "";
}
function tableRows(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(html || ""))) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tm[1]))) {
      const cells = [];
      const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) cells.push(htmlToText(cm[1]).replace(/\s+/g, " ").trim());
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function tableColumn(headers, patterns) {
  return headers.findIndex((h) => patterns.some((p) => p.test(h)));
}

function tableMoneyWan(value, header) {
  const n = parseFloat(String(value || "").replace(/[,，\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "";
  // 2026-08-16 V4A：\b万\b 在中文/全角括号旁失效（表头「投标报价(万)」被判为元 ÷1e4，
  // 中标价缩小 10000 倍——实测 950 → "0.095"）。表头语境「万」即单位（无"万分"类表头），
  // 直接判万元；换算后 <0.01 万（百元级"中标价"）视为单位误判嫌疑，留空不造假。
  const wan = /万元|万/.test(header || "") ? n : n / 10000;
  if (wan < 0.01) return "";
  return String(Math.round(wan * 10000) / 10000);
}

function extractCandidateTables(html) {
  let basic = {}, manager = "";
  for (const rows of tableRows(html)) {
    // 中标候选人排序：浙江 SSR 页表头是「中标候选人排序 | 投标人 | 投标报价…」（无"名称"二字），
    // 原锚点 /中标候选人名称|候选人名称/ 整表跳过 → winner 全空（2026-08-15 岱山实测复现）
    const hi = rows.findIndex((row) => row.some((c) => /中标候选人名称|候选人名称|中标候选人排序/.test(c)));
    if (hi < 0) continue;
    const headers = rows[hi];
    const winnerI = tableColumn(headers, [/中标候选人名称/, /候选人名称/, /投标人名称/, /投标人/]); // 光杆"投标人"=浙江列头
    const priceI = tableColumn(headers, [/投标.*报价/, /中标价/, /报价/]);
    const durationI = tableColumn(headers, [/工期/, /交货期/, /服务期/]);
    const scoreI = tableColumn(headers, [/评标结果/, /综合得分/, /评审得分/, /得分/]);
    const rankI = tableColumn(headers, [/排序/, /排名/, /名次/, /序号/]);
    const managerI = tableColumn(headers, [/项目负责人名称/, /项目经理/, /项目负责人/]);
    const dataRows = rows.slice(hi + 1).filter((r) => r.some((c) => String(c || "").trim()));
    // 2026-08-16 V4A 兜底：无排序列的候选表（表头「中标候选人名称|投标报价(万)」）原谓词要求
    // 首列=1/第一/一，而第 0 列是候选人名称永不命中 → 整表静默跳过降级文本启发。单数据行表无排序歧义，直接采纳。
    const row = dataRows.find((r) => {
      const rank = rankI >= 0 ? r[rankI] : r[0];
      return /^(?:1|第一|一)$/.test(String(rank || "").trim()) && winnerI >= 0 && r[winnerI];
    }) || (rankI < 0 && dataRows.length === 1 && winnerI >= 0 && dataRows[0][winnerI] ? dataRows[0] : undefined);
    if (!row) continue;
    // 2026-08-16 V4A：manager 跨表守卫——多标段页（管网项目高发）第二张**带价格列**的候选表会覆盖
    // 第一张表的中标人配套经理，拼出「中标人A标段+经理B标段」假数据（实测复现）。
    // 放行**纯补充表**（无价格/工期/得分列，且 winner 与已采一致——浙江「排序表+项目经理表」两表结构）。
    if (managerI >= 0 && row[managerI] && (!basic.winner || (!(priceI >= 0 || durationI >= 0 || scoreI >= 0) && cleanWinnerRaw(row[winnerI]) === basic.winner))) {
      manager = row[managerI].trim();
    }
    if (!basic.winner && (priceI >= 0 || durationI >= 0 || scoreI >= 0)) {
      basic = {
        rank: rankI >= 0 ? row[rankI] : "1",
        winner: cleanWinnerRaw(row[winnerI]),
        winPrice: priceI >= 0 ? tableMoneyWan(row[priceI], headers[priceI]) : "",
        duration: durationI >= 0 ? row[durationI] : "",
        winScore: scoreI >= 0 ? (String(row[scoreI]).match(/\d+(?:\.\d+)?/) || [""])[0] : "",
      };
    }
  }
  return { ...basic, winManager: manager };
}

// 合同主体行常见「采购人(甲方)：××」「供应商(乙方)：××」——角色括号后缀插在标签与值之间，
// 通用 grab 的标签→值间隙匹配会失败（海南合同公示 2026-08-15 实测：乙方整条丢失、甲方带"(甲方)："残leak）。
// 专用通道按角色词定位，值再走 org 完形/校验；失败回退通用路径。
function grabPartyByRole(text, roleWord) {
  const re = new RegExp("[（(]" + roleWord + "[）)]\\s*[:：]?\\s*([^\\n，。;；]{4,60})", "");
  const m = String(text || "").match(re);
  if (!m) return "";
  let v = m[1].trim();
  // 值区用空格分隔无标点（海南合同公示实测），在下一段字段词（地址：/联系方式：/法定代表人：…）处截断
  v = v.split(/\s+(?=(?:地址|联系方式|法定代表人|电话|联系人|传真|邮编|开户行|账号|户名|乙方|甲方|名称)[（(]?[^\s：]{0,8}[）)]?\s*[:：])/)[0];
  return completeOrgName(v, text);
}

function extractWinDetail(ad, html, item, pdfText) {
  if (ad && ad.winDetail && typeof ad.winDetail === "function") return ad.winDetail(html, item, pdfText);
  const text = pdfText ? (htmlToText(html) + "\n" + pdfText) : htmlToText(html);
  const flat = flatten(text);
  const winPrice = grabMoneyWan(text, WIN_PRICE_LABELS) || grabMoneyWan(flat, WIN_PRICE_LABELS);
  const stage = (ad && ad.stageKey) || (item && item.stage) || "";
  const table = stage === "candidate" ? extractCandidateTables(html) : {};
  const winner = table.winner || grabWinner(text, flat);
  const out = {
    winner,
    winPrice: table.winPrice || winPrice,
    winManager: table.winManager || grabManager(text, flat),
    duration: table.duration || grabDuration(text, flat),
    winScore: table.winScore || grabScore(text, flat),
    rank: table.rank || grabRank(text),
    contractAmount: stage === "contract" ? (grabMoneyWan(text, ["合同金额", "合同价", "合同总价", "签约合同价", "合同估算价"]) || grabMoneyWan(flat, ["合同金额", "合同价", "合同总价", "签约合同价"])) : "",
    partyA: grabPartyByRole(text, "甲方") || completeOrgName(grabBoth(text, flat, PARTY_A_LABELS), flat),
    partyB: (stage === "contract" ? grabPartyByRole(text, "乙方") : "") || winner,
    projectCode: grabProjectCode(text, flat),
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, cleanOutputCell(v)]));
}

function toAbs(href, base) {
  try { return new URL(href, base).href; } catch { return href; }
}

// 2026-08-11 缺口一·docLink 重写：旧逻辑只认「<a href 以 .pdf/.docx/.zip/.rar 结尾 且 文字含 招标/文件/附件/下载/采购>」，
// 漏掉 EPoint 等平台把附件放在 id="fujian" 容器内、href 是 JS 下载端点（无扩展名）的情况 → docLink 仅 1%。
// 新逻辑：① 优先在附件容器内找 <a>；② 全文找文字命中关键词的任意链接（含 JS 端点）；
// ③ 选优：带文件扩展名 > 文字强命中"招标文件/采购文件/附件" > 任意文字命中；都不命中则诚实留空（不误抓随机链接）。
function grabDocLink(html, baseUrl) {
  let baseHost = "";
  try { baseHost = new URL(baseUrl).host.toLowerCase(); } catch {}
  const sameHost = (u) => {
    try {
      const h = new URL(u).host.toLowerCase();
      if (!h) return false;
      return h === baseHost || h.endsWith("." + baseHost) || baseHost.endsWith("." + h);
    } catch { return false; }
  };
  const SE_HOST = /(baidu|google|sogou|so\.com|bing|360|qq\.com|yahoo|sina|taobao|weibo)/i;
  const FILE_EXT = /\.(pdf|docx?|zip|rar|7z)(\?|#|$)/i;
  const out = [];
  // JPaas PDF 壳页（温州等）用 #pdfshow[data-value] 指向真正公告正文；它比同页的
  // 公平竞争审查表等附件更接近“招标公告正文”，必须优先。
  const embedded = findEmbeddedPdfHref(html);
  if (embedded) return toAbs(embedded, baseUrl);
  const push = (href, text) => {
    if (!href) return;
    if (/^\s*(#|javascript:|mailto:)/i.test(href)) return;
    const abs = toAbs(href, baseUrl);
    const t = String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (FILE_EXT.test(abs)) { out.push({ href: abs, text: t }); return; }        // 文件直链：跨域也接受
    if (baseHost && sameHost(abs)) { out.push({ href: abs, text: t }); return; } // 同平台 JS 下载端点
    if (/招标文件|采购文件|附件/i.test(t) && !SE_HOST.test(abs)) out.push({ href: abs, text: t }); // 跨域但文字强命中且非搜索引擎
  };
  // ① 附件容器（EPoint 标准 id="fujian"；或 class 含 attach/file/enclosure/招标文件/附件）
  const cm = html.match(/<(div|ul|table|tbody)[^>]*(?:id|class)=["'][^"']*(?:fujian|attach|file|enclosure|招标文件|附件)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (cm) {
    const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(cm[2]))) push(m[1], m[2]);
  }
  // ② 全文：文字命中关键词的任意 <a>（含 JS 下载端点、无扩展名）
  const re2 = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m2;
  while ((m2 = re2.exec(html))) {
    if (/招标|文件|附件|下载|采购文件/i.test(m2[2])) push(m2[1], m2[2]);
  }
  // ③ EPoint 标准附件端点（覆盖 onclick 形态 B：href=javascript:void(0) 但
  //    onclick="ztbfjyz('/EpointWebBuilder/.../downloadztbattach?attachGuid=...')"）
  //    形态 A 的 downloadZtbAttach.jspx?attachGuid= 多已被 ①② 同平台分支收录，此处兜底/去重
  const seen = new Set();
  const epLinks = [];
  const epRe = /['"]([^'"]*(?:downloadztbattach|downloadZtbAttach)(?:\.jspx)?[^'"]*attachGuid=[0-9a-zA-Z]+[^'"]*)['"]/gi;
  let em;
  while ((em = epRe.exec(html))) {
    const abs = toAbs(em[1], baseUrl);
    if (baseHost && !sameHost(abs)) continue;   // 仅同平台，防外链误抓
    if (seen.has(abs)) continue;
    seen.add(abs); epLinks.push(abs);
  }
  if (epLinks.length) return epLinks[0];        // 优先 EPoint 规范附件端点（形态 A/B 通吃）
  if (!out.length) return "";
  const ext = out.find(l => FILE_EXT.test(l.href));
  if (ext) return ext.href;
  const strong = out.find(l => /招标文件|采购文件|附件/i.test(l.text));
  if (strong) return strong.href;
  // 退而求其次：仅当该链接确像附件（含 attach/download 端点或 attachGuid）才退，
  // 否则诚实留空——避免把详情页/导航链接（如 transactionInfo.html）误当附件抓取
  const plausible = out.find(l => /attach|download|attachguid/i.test(l.href) || FILE_EXT.test(l.href));
  if (plausible) return plausible.href;
  return "";
}

// URL 归一化：默认强制 https、去掉显式端口（沙箱里 http:80 / :443 常连不通）
// 例外：adapter 显式声明 keepScheme 时保留原协议（如江苏 https 不可达、只有 http 通）
function normUrl(u, ad) {
  if (ad && ad.keepPort) return String(u); // 保留非标准端口（如湖南:8282 / 广西:9000），normUrl 默认会剥端口
  let s = String(u).replace(/:\d{2,5}(?=\/)/g, "");
  if (ad && ad.keepScheme) return s;
  return s.replace(/^http:\/\//i, "https://");
}

// ---- EPoint 智能搜索接口（JSON POST）----
const EPOINT_API = "/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew";

// 注意：各省 EPoint 实例的字段名不统一（实测）
//   江苏：日期 infodateformat / infodatepx，城市 zhuanzai
//   浙江：日期 webdate，区县 infod，**无** infodatepx —— 用默认 sort 会导致排序失效、返回 2018 年的老公告
// 故排序字段由 adapter 用 sortField 指定，字段读取则做多字段回退。
function epointParam(kw, pn, rn, cats, sortField, cnum) {
  return {
    token: "", pn, rn: String(rn), sdt: "", edt: "",
    wd: kw || "", inc_wd: "", exc_wd: "",
    fields: "title;zhuanzainew;categorynum;zhuanzai;webdate",
    cnum: cnum || "001", sort: JSON.stringify({ [sortField || "infodatepx"]: "0" }), ssort: "title", cl: 200, terminal: "",
    condition: (cats && cats.length)
      ? cats.map(c => ({ fieldName: "categorynum", isLike: true, likeType: 2, equal: c }))
      : null,
    time: null, highlights: "title", statistics: null,
    unionCondition: null, opCondition: null, opType: 0,
    accuracy: "", noParticiple: "1", searchRange: null, isBusiness: "1",
  };
}

async function epointPost(ad, body, delay = 500) {
  let wait = delay;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(ad.base + EPOINT_API, {
        signal: ctl.signal, method: "POST",
        headers: {
          "User-Agent": UA_STR,
          "Content-Type": "application/json;charset=utf-8",
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Referer": ad.referer || (ad.base + "/"),
        },
        body: JSON.stringify(body), redirect: "follow",
      });
      if (r.status === 429) {
        // 2026-08-16 V4A：429 进全局节流闸门（原版仅本函数退避封顶 8s，不与 requestWithRetry 的
        // 全局闸门联动，EPoint 族 adapter 的 429 处理是最弱一环）。Retry-After 优先。
        const ra = parseRetryAfterMs(r, "") || 0;
        bumpThrottle(Math.max(ra, wait * 2));
        throw new Error("HTTP 429" + (ra ? " (Retry-After " + ra + "ms)" : ""));
      }
      if (r.status >= 500) throw new Error("HTTP " + r.status);
      const txt = Buffer.from(await r.arrayBuffer()).toString("utf8");
      return JSON.parse(txt);
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(wait); wait = Math.min(wait * 2, 8000);
    } finally { clearTimeout(timer); }
  }
}

/**
 * EPoint 地区字段择优（2026-08-10 海南实测新增）。
 *
 * 各省实例把"地区"塞在不同字段，且同一字段语义还会串台：
 *   江苏：zhuanzai = 城市名（可用）
 *   浙江：infod   = 区县名（可用）
 *   海南：zhuanzai = **发布平台名**（"省机器管服务平台"），xiaquname 才是行政区（定安县/三亚市）
 * 原实现 `r.zhuanzai || r.fieldvalue || r.infod` 在海南会把"省机器管服务平台"当地区写进报表。
 *
 * 规则：① 含"平台/中心/网/系统"字样的一律不是地区，跳过；
 *      ② 省级名（"海南省"）信息量太低，降级为 weak，让标题提取（extractCity）先上，抓不到再兜底。
 */
const NOT_A_REGION = /(平台|中心|网站|系统|交易网|政府网|服务网|门户)/;
function pickCity(r) {
  const cands = [r.zhuanzai, r.xiaquname, r.fieldvalue, r.infod];
  let weak = "";
  for (const c of cands) {
    const v = String(c || "").trim();
    if (!v || NOT_A_REGION.test(v)) continue;
    if (/^.{2,4}(省|自治区|市)$/.test(v) && /省|自治区/.test(v)) { weak = weak || v; continue; }
    return { city: v, weak };
  }
  return { city: "", weak };
}

// EPoint 分页取列表 → 统一 item 结构（字段做多来源回退，兼容各省实例差异）
async function epointList(ad, page, args, catsOverride) {
  const rn = 20;
  const cats = catsOverride || ad.cats;
  const body = epointParam(args.keyword, (page - 1) * rn, rn, cats, ad.sortField, ad.cnum);
  if (ad.keywordClient) body.wd = "";   // 该实例 wd 服务端检索失效，改拉全量分类后在 crawlRound 按标题客户端过滤
  // 2026-08-16 V5（常州实测）：部分 EPoint 实例对 fields 投影参数敏感——传入即静默返空
  //（total None/records 0，与"无数据"不可区分）；omitFields 开关删除该参数，返回全量字段（解析链不变）。
  if (ad.omitFields) delete body.fields;
  const j = await epointPost(ad, body, args.delay);
  const recs = (j && j.result && j.result.records) || [];
  return recs.map(r => {
    const rawDate = r.infodateformat || r.infodatepx || r.webdate || r.infodate || "";
    const m = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
    const c = pickCity(r);
    const title = String(r.titlenew || r.title || "").replace(/<\/?em[^>]*>/gi, "").trim();
    const titleArea = c.city === "市辖区"
      ? extractKnownArea(title.replace(/^\[[^\]]+\]\s*/, ""))
      : "";
    return {
      // R4 诚实守卫：linkurl 解析后若坍缩成站点根(base)自身，视为"无有效详情链接"→ 强制留空，
      // 杜绝"全量记录 url 等于同一 base"的去重坍缩 bug（河南曾因此 74 条被并成 1 条）。
      url: (r.linkurl && toAbs(r.linkurl, ad.base) !== ad.base) ? toAbs(r.linkurl, ad.base) : "",
      title,
      date: m ? m[0] : "",
      cityHint: (c.city && c.city !== "市辖区") ? c.city : titleArea,
      cityWeak: c.weak || ad.cityName || "",
      summary: r.content || "",
    };
  }).filter(x => (ad.allowNoUrl ? x.title : (x.url && x.title)));
}

// ---- 自定义新点路径 EPoint（宁夏 /interface_wz/、新疆 /inteligentsearchnew/）----
// 与标准 EPoint 同内核，但：① 端点路径非标准（ad.apiPath）；② 匿名可用（标准 /EpointWebBuilder/ 路径常 401）；
// ③ pn 语义=offset（(page-1)*rn）；④ sort 必须为 JSON 字符串；⑤ 请求体由 ad.makeBody 按省定制。
async function epointXPost(ad, body, delay = 500) {
  let wait = delay;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      const r = await fetch(ad.base + ad.apiPath, {
        signal: ctl.signal, method: "POST",
        headers: {
          "User-Agent": UA_STR,
          "Content-Type": "application/json;charset=utf-8",
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Referer": ad.referer || (ad.base + "/"),
        },
        body: JSON.stringify(body), redirect: "follow",
      });
      if (r.status === 429) {
        // 2026-08-16 V4A：同 epointPost——429 进全局节流闸门，Retry-After 优先
        const ra = parseRetryAfterMs(r, "") || 0;
        bumpThrottle(Math.max(ra, wait * 2));
        throw new Error("HTTP 429" + (ra ? " (Retry-After " + ra + "ms)" : ""));
      }
      if (r.status >= 500) throw new Error("HTTP " + r.status);
      const txt = Buffer.from(await r.arrayBuffer()).toString("utf8");
      return JSON.parse(txt);
    } catch (e) {
      if (attempt === 4) throw e;
      await sleep(wait); wait = Math.min(wait * 2, 8000);
    } finally { clearTimeout(timer); }
  }
}

async function epointXList(ad, page, args, catsOverride) {
  const cat = (Array.isArray(catsOverride) ? catsOverride[0] : (catsOverride || "")) || "";
  const rn = ad.rn || 10;
  const pn = (page - 1) * rn;
  const wd = (ad.keywordClient ? "" : (args.keyword || ""));
  const body = ad.makeBody(pn, wd, cat);
  const j = await epointXPost(ad, body, args.delay);
  const recs = (j && j.result && j.result.records) || [];
  return recs.map(r => {
    const rawDate = r.webdate || r.infodateformat || r.infodatepx || r.infodate || "";
    const m = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
    const c = pickCity(r);
    return {
      url: (r.linkurl && toAbs(r.linkurl, ad.base) !== ad.base) ? toAbs(r.linkurl, ad.base) : "",
      title: String(r.title || r.titlenew || "").replace(/<\/?em[^>]*>/gi, "").trim(),
      date: m ? m[0] : "",
      cityHint: c.city,
      cityWeak: c.weak,
      summary: r.content || "",
    };
  }).filter(x => (ad.allowNoUrl ? x.title : (x.url && x.title)));
}

// ---- 陕西 sntba 定制 JSON 接口（仅最新 10 条，翻页被服务端忽略，关键词需验证码故本地过滤）----
async function sntbaList(ad, page, args) {
  const url = `${ad.base}/home-api/home/notice/list-es?current=${page}&size=10`;
  let r;
  try {
    r = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" },
    });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  const txt = Buffer.from(await r.arrayBuffer()).toString("utf8");
  let j; try { j = JSON.parse(txt); } catch (_) { return []; }
  if (!j || j.code !== 0 || !j.data || !Array.isArray(j.data.list)) return [];
  return j.data.list.map(it => {
    const d = it.publishDate ? new Date(Number(it.publishDate)) : null;
    const date = (d && !isNaN(d.getTime())) ? d.toISOString().slice(0, 10) : "";
    return { url: "", title: String(it.title || "").replace(/\s+/g, " ").trim(), date };
  });
}

// =================== bespoke 逆向批次 fetch（C 批 5 省 + B 批 4 省）===================
// 各端点均为 2026-08-13 bespoke 逆向实测：公开可达、免登录/token，返回真实标题+日期。
// 统一规约：fetch 经 httpFetch 遮蔽（自带 curl 兜底）；2xx 返回 _curlResp（含 .json()），
// 非 2xx 返回真实 Response；status===0 表示传输失败。

// ---- 湖南（湖南省公共资源交易服务平台）：交易 API GET /constructionTender/listByFile ----
// 服务端按 notice=0 过滤招标/资审公告；current/size 为 MyBatis-Plus 分页（非 page/pageSize）。
// 详情为 SPA hash 路由（含 bidSectionId），collectProvince 仅列表层使用，详情层非必须。
function hnNoticeType2Stage(t) {
  if (!t) return "招标公告";
  if (/ZHONGBIAOHXR/.test(t)) return "中标候选人公示";
  if (/ZHONGBIAO/.test(t)) return "中标结果公示";
  if (/ZHAOBIAO/.test(t)) return "招标公告";
  if (/ZIGE|SHENCHA|QUALIF/.test(t)) return "资格审查";
  if (/BIANGENG|CHANGE/.test(t)) return "变更公告";
  if (/RESULT/.test(t)) return "中标公告";
  return "招标公告";
}

async function hnList(ad, page, args) {
  const size = ad.rn || 20;
  const current = Math.max(1, page | 0);
  const qs = new URLSearchParams();
  qs.set("notice", ad.notice || "0");
  if (ad.tenderProjectType) qs.set("tenderProjectType", ad.tenderProjectType);
  qs.set("current", String(current));
  qs.set("size", String(size));
  const url = `${ad.base}${ad.apiPath || "/tradeApi/constructionTender/listByFile"}?${qs.toString()}`;
  let r;
  try {
    r = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": UA_STR,
        "Accept": "application/json, text/plain, */*",
        "Referer": ad.base + "/",
      },
    });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  let j; try { j = await r.json(); } catch (_) { return []; }
  const data = (j && j.code === 200 && j.data) ? j.data : {};
  const arr = Array.isArray(data.records) ? data.records : [];
  return arr.map(it => {
    const title = String(it.bidSectionName || it.tenderProjectName || "").replace(/\s+/g, " ").trim();
    const date = String(it.noticeSendTime || "").slice(0, 10);
    const bidSectionId = it.bidSectionId || "";
    const regionCode = it.regionCode || "";
    const url2 = bidSectionId
      ? `${ad.base}/#/resources/transactionDetail/construction?bidSectionId=${encodeURIComponent(bidSectionId)}&regionCode=${encodeURIComponent(regionCode)}`
      : "";
    return {
      url: url2, title, date,
      bidSectionId,
      cityHint: it.name || "",
      stageHint: hnNoticeType2Stage(it.noticeType),
    };
  }).filter(x => x.title && (ad.stageKey || isStrictZbTitle(x.title)));
}

// ---- 湖南：详情走结构化 JSON 接口（非 SPA 渲染）----
// listByFile 列表层不含招标人/控制价/资质等厚字段；真实数据在：
//   /tradeApi/constructionTender/getBySectionId?sectionId=<bidSectionId>  → 招标人/代理/控制价/项目编号/资金来源/评标办法/地区
//   /tradeApi/constructionNotice/getBySectionId?sectionId=<bidSectionId> → 开标时间/投标截止/招标文件获取时间 + noticeContent(HTML 正文，含保证金/资质/工期/联系人)
// 两接口均公开、无需 token；bidSectionId 来自列表层。
async function hnDetail(ad, item) {
  const bidSectionId = item.bidSectionId
    || (item.url && /bidSectionId=([^&]+)/.test(item.url) ? decodeURIComponent(RegExp.$1) : "");
  if (!bidSectionId) return {};
  const hd = { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" };
  const get = async (p) => {
    try {
      const r = await fetch(`${ad.base}${p}`, { method: "GET", headers: hd });
      if (!r || r.status !== 200) return null;
      const j = await r.json().catch(() => null);
      return (j && j.code === 200 && j.data) ? j.data : null;
    } catch { return null; }
  };
  const d = await get(`/tradeApi/constructionTender/getBySectionId?sectionId=${encodeURIComponent(bidSectionId)}`) || {};
  const ct = d.constructionTender || {};
  const cp = d.constructionProject || {};
  const secArr = d.constructionSectionList;
  const sec = (Array.isArray(secArr) ? (secArr.find(s => s.id === bidSectionId) || secArr[0]) : secArr) || {};
  const nd = await get(`/tradeApi/constructionNotice/getBySectionId?sectionId=${encodeURIComponent(bidSectionId)}`) || {};
  const notice = (nd.noticeList && nd.noticeList[0]) || {};
  // 自由文本字段（保证金/资质/工期/联系人/电话）从公告 HTML 正文抽，复用通用解析器
  const df = notice.noticeContent ? extractDetail(ad, notice.noticeContent, item, "") : {};
  const out = { ...df };
  if (ct.tendererName || ct.ownerName) out.owner = ct.tendererName || ct.ownerName;
  if (ct.tenderAgencyName) out.agency = ct.tenderAgencyName;
  if (ct.tenderProjectCode || cp.projectCode) out.projectCode = ct.tenderProjectCode || cp.projectCode;
  if (ct.tenderMode) out.tenderMode = ct.tenderMode;
  if (cp.regionCode) { out.projectSite = cp.regionCode; out.city = cp.regionCode.replace(/^[^·]*·/, ""); }
  if (cp.fundSource) out.funding = cp.fundSource;
  if (sec.tenderControlPrice != null && sec.tenderControlPrice !== "") out.controlPrice = String(sec.tenderControlPrice);
  if (sec.bidSectionNo) out.bidSectionNo = sec.bidSectionNo;
  if (sec.pingbiaobfName) out.evaluation = sec.pingbiaobfName;
  if (notice.bidOpeningTimeStart) out.bidOpen = String(notice.bidOpeningTimeStart).slice(0, 16);
  if (notice.bulletinName) out.type = notice.bulletinName;
  if (notice.noticeSendTime) out.date = String(notice.noticeSendTime).slice(0, 10);
  return out;
}

// ---- 云南：详情走结构化 JSON 接口（列表 guid → findZbggByGuid）----
// 列表层已构造 url = /ynggfwpt-home-api/.../findZbggByGuid?guid=<guid>，此处直接取该 guid 调接口。
// 返回 value 对象含 bulletincontent(HTML 正文，含招标人/代理/控制价/保证金/资质/工期/联系人) +
//   结构化字段 bidopentime(YYYYMMDDHHmmss)/tenderdocdeadline/qualType/tenderprojectcode/bidsectioncodes。
async function ynDetail(ad, item) {
  const guid = item.guid
    || (item.url && /[?&]guid=([^&]+)/.test(item.url) ? decodeURIComponent(RegExp.$1) : "");
  if (!guid) return {};
  const url = `${ad.base}/ynggfwpt-home-api/jyzyCenter/jyInfo/gcjs/findZbggByGuid?guid=${encodeURIComponent(guid)}`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" } });
  } catch (e) { return {}; }
  if (!r || r.status !== 200) return {};
  const j = await r.json().catch(() => null);
  const d = (j && String(j.code) === "1" && j.value) ? j.value : {};
  if (!d || !d.bulletincontent) return {};
  const df = extractDetail(ad, d.bulletincontent, item, "");
  const out = { ...df };
  if (d.tenderprojectcode) out.projectCode = String(d.tenderprojectcode);
  if (d.bidsectioncodes) out.bidSectionNo = String(d.bidsectioncodes).replace(/,/g, ";");
  if (d.bidopentime) {
    const m = String(d.bidopentime).match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/);
    if (m) out.bidOpen = `${m[1]}-${m[2]}-${m[3]}` + (m[4] ? ` ${m[4]}:${m[5] || "00"}` : "");
  }
  if (d.qualType && !out.qualification) out.qualification = d.qualType;
  if (d.bulletinname) out.type = d.bulletinname;
  if (d.bulletinissuetime) out.date = String(d.bulletinissuetime).slice(0, 10);
  return out;
}

// ---- 湖北：详情走结构化 JSON 接口（列表 guid → /jyxxAjax/jsgcZbggDetail）----
// 列表层 url = /jyxx/jsgcZbggDetail?guid=<guid>（含 guid）；真实详情 JSON 在 /jyxxAjax/ 同路径。
// 返回 { tender: { bulletinContent(HTML table), tenderProjectCode, bidSectionCode, bulletinName, regionCode, ... } }。
async function hbDetail(ad, item) {
  const guid = (item.url && /[?&]guid=([^&]+)/.test(item.url)) ? decodeURIComponent(RegExp.$1) : "";
  if (!guid) return {};
  const url = `${ad.base}/jyxxAjax/jsgcZbggDetail?guid=${encodeURIComponent(guid)}`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" } });
  } catch (e) { return {}; }
  if (!r || r.status !== 200) return {};
  const j = await r.json().catch(() => null);
  const t = (j && j.tender) ? j.tender : {};
  if (!t.bulletinContent) return {};
  const df = extractDetail(ad, t.bulletinContent, item, "");
  const out = { ...df };
  if (t.tenderProjectCode || t.projectCode) out.projectCode = t.tenderProjectCode || t.projectCode;
  if (t.bidSectionCode) out.bidSectionNo = t.bidSectionCode;
  if (t.bulletinName) out.type = t.bulletinName;
  if (t.bulletinIssueTime) out.date = String(t.bulletinIssueTime).slice(0, 10);
  return out;
}

// ---- 贵州：详情走结构化 JSON 接口（列表 id → /api/trade/detail）----
// 列表层 url = /trade/bulletin/?id=<id>（含 id）；真实详情 JSON 在 /api/trade/detail?id=<id>。
// 返回扁平对象 { Title, Content(HTML 正文), UploadFile, PdfFile, ContractDoc, OtherNoticefile, RegionCode, PublishDate, ... }。
async function gzDetail(ad, item) {
  const id = (item.url && /[?&]id=(\d+)/.test(item.url)) ? RegExp.$1 : "";
  if (!id) return {};
  const url = `${ad.base}/api/trade/detail?id=${encodeURIComponent(id)}`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" } });
  } catch (e) { return {}; }
  if (!r || r.status !== 200) return {};
  const d = await r.json().catch(() => null);
  if (!d || !d.Content) return {};
  const df = extractDetail(ad, d.Content, item, "");
  const out = { ...df };
  const att = [d.UploadFile, d.PdfFile, d.ContractDoc, d.OtherNoticefile]
    .filter(Boolean).map(s => String(s).trim()).filter(Boolean);
  if (att.length) {
    const first = att[0];
    out.docLink = guizhouAttachmentUrl(ad, first);
  }
  if (d.PublishDate) out.date = String(d.PublishDate).slice(0, 10);
  return out;
}

function guizhouAttachmentUrl(ad, value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${String(ad && ad.base || "").replace(/\/$/, "")}/api/upload/preview/${encodeURIComponent(raw.replace(/^\//, ""))}`;
}

// ---- 内蒙古：详情走结构化 JSON 接口（列表 sourceDataKey → getPublishResourceDealContent）----
// 返回 data.dealContent：noticeContent 为完整公告 HTML 正文，可喂 extractDetail；
// 另直给 projectCode/regionName/bidSectionCodes/noticeSendTime/noticeTypeName/bidOpeningTime/file。
// 注意：bidOpeningTime 在"招标计划"等记录上是 1970 脏值，仅当非 1970 才采用。
async function nmgDetail(ad, item) {
  const key = item.sourceDataKey
    || (item.url && /[?&]id=([^&]+)/.test(item.url) ? decodeURIComponent(RegExp.$1) : "");
  if (!key) return {};
  const url = `${ad.base}/trssearch/openSearch/getPublishResourceDealContent?sourceDataKey=${encodeURIComponent(key)}`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" } });
  } catch (e) { return {}; }
  if (!r || r.status !== 200) return {};
  const j = await r.json().catch(() => null);
  const dc = (j && j.data && j.data.dealContent) ? j.data.dealContent : {};
  if (!dc || !dc.noticeContent) return {};
  const df = extractDetail(ad, dc.noticeContent, item, "");
  const out = { ...df };
  if (dc.projectCode || dc.tenderProjectCode) out.projectCode = String(dc.projectCode || dc.tenderProjectCode);
  if (dc.bidSectionCodes) out.bidSectionNo = String(dc.bidSectionCodes);
  if (dc.regionName) out.city = String(dc.regionName);
  if (dc.noticeTypeName) out.type = String(dc.noticeTypeName);
  if (dc.noticeSendTime) out.date = String(dc.noticeSendTime).slice(0, 10);
  // bidOpeningTime 部分记录是 1970 脏值，仅当非 1970 才用
  if (dc.bidOpeningTime && !/^1970/.test(dc.bidOpeningTime)) out.bidOpen = String(dc.bidOpeningTime).slice(0, 16);
  if (dc.file) {
    const f = String(dc.file).trim();
    if (f) out.docLink = /^https?:\/\//i.test(f) ? f : (ad.base.replace(/\/$/, "") + "/" + f.replace(/^\//, ""));
  }
  return out;
}

// ---- 甘肃（兰州市门户 lzggzyjy.lanzhou.gov.cn）：双分支详情 ----
//   /xqfzx/014001/ 详情页是 SSR，通用 extractDetail 已可用，直接走 HTML；
//   /jygk/002001/ 详情页是 mustache SPA（wholeProcessDetail.js 驱动，正文未渲染），
//   必须走 /EpointWebBuilder/BulletinWebServer.action?cmd=getallprocessdetailInfonew 结构化接口。
//   验证（probe-trs-epointx.md §3）：CSV 里 docLink 的 %7B%7Bdownloadurl%7D%7D 即 {{downloadurl}}
//   未渲染模板，证明该分支为 SPA；接口实测 200，custom 需二次 JSON.parse，status.state 不可信（恒 "error"）。
function gsParseCustom(custom) {
  if (!custom) return null;
  if (typeof custom === "object") return custom;
  try { return JSON.parse(custom); } catch (e) { return null; }
}
function gsMapRecord(r) {
  const out = {};
  const pick = (v) => (v == null ? "" : String(v).trim());
  const owner = pick(r.jianshedanwei) || pick(r.yongdino);
  if (owner) out.owner = owner;
  const agency = pick(r.dailidanweiname);
  if (agency) out.agency = agency;
  const pc = pick(r.projectno);
  if (pc) out.projectCode = pc;
  const budget = pick(r.touzigusuan); // 单位已是万元
  if (budget) out.budget = budget;
  const funding = pick(r.zijinlaiyuan);
  if (funding) out.funding = funding;
  const contact = pick(r.daililianxiren) || pick(r.jiafalianxiren);
  if (contact) out.contact = contact;
  const phone = pick(r.daililianxirentel) || pick(r.jiafalianxirentel);
  if (phone) out.phone = phone;
  const type = pick(r.zhaobiaofangshi) || pick(r.zhaobiaotype);
  if (type) out.type = type;
  const ps = pick(r.projectsizedetail);
  if (ps) out.projectSite = ps;
  const city = pick(r.xiaqucode);
  if (city) out.city = city;
  const controlPrice = pick(r.controlprice);
  if (controlPrice) out.controlPrice = controlPrice;
  const bidOpen = pick(r.applyenddate);
  if (bidOpen) out.bidOpen = bidOpen.slice(0, 16);
  const dl = pick(r.downloadurl);
  if (dl && !/^https?:\/\//i.test(dl) && !/downloadurl/.test(dl)) {
    out.docLink = dl.startsWith("/") ? (r.__base || "") + dl : dl;
  } else if (dl && /^https?:\/\//i.test(dl)) {
    out.docLink = dl; // 覆盖通用抽取可能写进的 {{downloadurl}} 脏值
  }
  return out;
}
async function gsDetail(ad, item) {
  const base = (ad.base || "").replace(/\/$/, "");
  // SSR 分支：详情页本身含渲染好的正文，通用抽取器即可
  if (item.url && /\/014001\//.test(item.url)) {
    const html = await requestWithRetry(item.url, 0);
    return extractDetail(ad, html, item, "");
  }
  // mustache SPA 分支：从详情页 url 取 infoid（uuid）
  const m = item.url && item.url.match(/\/([0-9a-zA-Z-]{8,})\.html?$/i);
  const infoId = m ? m[1] : "";
  if (!infoId) return {};
  const jx = `${base}/EpointWebBuilder/BulletinWebServer.action`;
  const hdrs = { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": item.url };
  // 1) 取流程步骤，拿到 zishentype（资格预审类型）供 detail 接口使用
  let zishenType = "";
  try {
    const r1 = await fetch(`${jx}?cmd=getAllProcessStepnew&infoid=${encodeURIComponent(infoId)}`, { method: "GET", headers: hdrs });
    if (r1 && r1.status === 200) {
      const j1 = await r1.json().catch(() => null);
      const c1 = gsParseCustom(j1 && j1.custom);
      const ret1 = (c1 && Array.isArray(c1.ret)) ? c1.ret : [];
      const first = ret1[0] || {};
      zishenType = first.zishentype ? String(first.zishentype) : "";
    }
  } catch (e) { /* 缺 zishentype 也能继续 */ }
  // 2) 并发 strStep=1（招标人/代理/投资/资金/联系人）、strStep=3（控制价/开标/文件）
  const merged = {};
  await Promise.all([1, 3].map(async (strStep) => {
    try {
      const u = `${jx}?cmd=getallprocessdetailInfonew&infoid=${encodeURIComponent(infoId)}&strStep=${strStep}&Zhaobiaotype=${encodeURIComponent(zishenType)}&gonggaoguid=${encodeURIComponent(infoId)}`;
      const r = await fetch(u, { method: "GET", headers: hdrs });
      if (!r || r.status !== 200) return;
      const j = await r.json().catch(() => null);
      if (!j || !j.custom) return; // 不可信 status.state（恒 "error"）
      const c = gsParseCustom(j.custom);
      if (!c || !Array.isArray(c.ret) || !c.ret.length) return;
      const r0 = c.ret[0];
      if (r0 && typeof r0 === "object") { r0.__base = base; Object.assign(merged, r0); }
    } catch (e) { /* 单步失败不影响其他步 */ }
  }));
  if (!Object.keys(merged).length) return {};
  return gsMapRecord(merged);
}

// ---- 安徽：详情正文 jQuery AJAX 分块加载（/jsgc/newDetailSub），壳页为空需 POST 拿 HTML 片段 ----
// 安徽详情正文由 jQuery AJAX 分块加载（/jsgc/newDetailSub），壳页为空；此 helper 取回 AJAX 正文 HTML。
// zb 与 win(中标/合同) 阶段共用同一正文体，仅抽取字段不同。
async function anhuiWinHtml(ad, item) {
  const m = item.url && item.url.match(/guid=([^&]+)/i);
  const guid = m ? decodeURIComponent(m[1]) : "";
  if (!guid) return "";
  const bn = (item.url && /bulletinNature=(\d+)/i.test(item.url)) ? RegExp.$1 : "1";
  const typeMap = { "1": "tender", "2": "pbjg", "3": "zbjg" };
  const type = typeMap[bn] || "tender";
  const body = `type=${encodeURIComponent(type)}&bulletinNature=${encodeURIComponent(bn)}&guid=${encodeURIComponent(guid)}&statusGuid=`;
  let r;
  try {
    r = await fetch(`https://ggzy.ah.gov.cn/jsgc/newDetailSub`, {
      method: "POST",
      headers: { "User-Agent": UA_STR, "Content-Type": "application/x-www-form-urlencoded", "Accept": "text/html, */*", "X-Requested-With": "XMLHttpRequest", "Referer": item.url },
      body,
    });
  } catch (e) { return ""; }
  if (!r || r.status !== 200) return "";
  const html = await r.text().catch(() => "");
  if (!html) return "";
  if (global.__RESEARCH) fs.appendFileSync(`test-logs/_research_${ad.key || "anhui"}.txt`, `\n===== ${item.url} | ${item.title} =====\n${htmlToText(html)}\n`);
  return html;
}
async function anhuiDetail(ad, item) {
  const html = await anhuiWinHtml(ad, item);
  if (!html) return {};
  return extractDetail(ad, html, item, "");
}

// ---- 西藏：详情正文由 Jeecms AJAX 加载（personalitySearch/initDetailbyProjectCode），壳页为「暂无相关数据」需 POST 取正文 ----
async function xizangWinHtml(ad, item) {
  // 壳页硬编码真实 projectCode（如 S1407003401017644001），文章 ID 并非 projectCode，必须从壳页取
  const shellHtml = await requestWithRetry(item.url, 0).catch(() => "");
  const pcM = shellHtml.match(/var\s+pc\s*=\s*['"]([^'"]+)['"]/i);
  const pc = pcM ? pcM[1] : "";
  const pm = item.url && item.url.match(/ggzy\.xizang\.gov\.cn\/([a-z]+)\/\d+\.jhtml/i);
  const path = pm ? pm[1] : "jyxxgcgg"; // 栏目路径（jyxxgcgg=招标公告，jyxxgchxr=候选，jyxxgcjg=结果），随子栏目变化
  if (!pc) return "";
  let r;
  try {
    r = await fetch("https://ggzy.xizang.gov.cn/personalitySearch/initDetailbyProjectCode", {
      method: "POST",
      headers: { "User-Agent": UA_STR, "Content-Type": "application/json", "Accept": "application/json, text/plain, */*", "Referer": item.url },
      body: JSON.stringify({ projectCode: pc, path, sId: 22 }),
    });
  } catch (e) { return ""; }
  if (!r || r.status !== 200) return "";
  const j = await r.json().catch(() => null);
  if (!j || String(j.code) !== "200") return "";
  const listData = (j.data && j.data.listData) || [];
  const html = (listData[0] && listData[0].txt) || j.txt || "";
  if (!html) return "";
  if (global.__RESEARCH) fs.appendFileSync(`test-logs/_research_${ad.key || "xizang"}.txt`, `\n===== ${item.url} | ${item.title} =====\n${htmlToText(html)}\n`);
  return html;
}
async function xizangDetail(ad, item) {
  const html = await xizangWinHtml(ad, item);
  if (!html) return {};
  return extractDetail(ad, html, item, "");
}

// ---- 天津：JEECMS JSON POST /content/pageContent ----
async function tjList(ad, page, args) {
  const url = `${ad.base}/content/pageContent`;
  const body = {
    pageNo: page, count: ad.rn || 10, orderBy: "27", isNew: true,
    title: "", projectType: "", areaNo: "", inDate: "", tenderProjectCode: "",
    channelIds: [ad.channelId || "82322"], timeBegin: "", timeEnd: "",
  };
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA_STR, "Content-Type": "application/json;charset=UTF-8", "Accept": "application/json, text/javascript, */*", "Referer": ad.base + "/jyxxgcjs.jhtml" },
      body: JSON.stringify(body),
    });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  let j; try { j = await r.json(); } catch (_) { return []; }
  const arr = (j && Array.isArray(j.content)) ? j.content : [];
  return arr.map(it => {
    const ts = Number(it.releaseTime) || 0;
    const ms = ts < 1e12 ? ts * 1000 : ts; // 兼容秒/毫秒
    const d = new Date(ms);
    const date = isNaN(d) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const url2 = it.url ? (it.url.startsWith("http") ? it.url : ad.base + it.url) : "";
    return { url: url2, title: String(it.title || "").replace(/\s+/g, " ").trim(), date };
  }).filter(x => x.title);
}

// ---- 内蒙古：TRS 全文检索 REST GET /trssearch/openSearch/searchPublishResource ----
async function nmgList(ad, page, args) {
  const kw = args.keyword ? encodeURIComponent(args.keyword) : "";
  const url = `${ad.base}/trssearch/openSearch/searchPublishResource?noticeName=${kw}&projectCode=&pageSize=${ad.rn || 10}&pageNum=${page}&noticeTypeName=${encodeURIComponent(ad.noticeTypeName || "")}&platformCode=&regionCode=&startTime=&endTime=&transactionTypeName=&industriesTypeName=`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/searchapp-iframe-zzq/" } });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  let j; try { j = await r.json(); } catch (_) { return []; }
  const data = (j && j.data && typeof j.data === "object") ? j.data : null;
  const arr = (data && Array.isArray(data.data)) ? data.data : [];
  return arr.map(it => {
    const isEng = String(it.transactionTypeCode || "") === "engineering_construction";
    const url2 = `${ad.base}/jyxx/index_${isEng ? "24" : "39"}.html?id=${it.sourceDataKey}`;
    const title = String(it.noticeName || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const date = String(it.noticeSendTime || "").slice(0, 10);
    return { url: url2, title, date, sourceDataKey: String(it.sourceDataKey || "").trim(), noticeTypeName: String(it.noticeTypeName || "").trim() };
  }).filter(x => x.title && (ad.stageKey
    ? (!ad.noticeTypeName || x.noticeTypeName === ad.noticeTypeName)
    : ((!ad.noticeTypeName || x.noticeTypeName === ad.noticeTypeName) && isStrictZbTitle(x.title))));
}

// ---- 辽宁：TRS WAS 全文检索 GET（与吉林同款引擎 /was5/web/search）----
async function lnList(ad, page, args) {
  const searchword = ad.searchword || "DOCCHANNEL='149559'";
  const url = `${ad.base}/was5/web/search?channelid=${ad.channelId || 219677}&page=${page}&perpage=${ad.rn || 15}&searchword=${encodeURIComponent(searchword)}`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "*/*", "Referer": ad.base + "/" } });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  const txt = Buffer.from(await r.arrayBuffer()).toString("utf8");
  let j; try { j = JSON.parse(txt); } catch (_) { return []; }  // 辽宁返回纯 JSON（无 JSONP 包裹）
  const arr = (j && Array.isArray(j.datas)) ? j.datas : [];
  return arr.map(it => ({
    url: String(it.DOCPUBURL || "").trim(),
    title: String(it.DOCTITLE || "").replace(/\s+/g, " ").trim(),
    date: String(it.DOCRELTIME || "").slice(0, 10),
  })).filter(x => x.title);
}

// ---- 甘肃（兰州市门户）：标准 EPoint getFullTextDataNew，unionCondition 过滤 002001001/014001001（省本级 WAF 412 不可取）----
function normalizeGsCityName(value) {
  const raw = String(value || "").trim();
  return /^6201\d{2}$/.test(raw) ? "兰州市" : raw;
}

async function gsList(ad, page, args) {
  const rn = ad.rn || 15;
  const pn = (page - 1) * rn;
  const wd = (ad.keywordClient ? "" : (args.keyword || ""));
  const body = ad.makeBody(pn, wd, "");
  const j = await epointXPost(ad, body, args.delay);
  const recs = (j && j.result && j.result.records) || [];
  return recs.map(r => {
    const rawDate = r.webdate || r.infodateformat || r.infodatepx || r.infodate || "";
    const m = String(rawDate).match(/(\d{4})-(\d{2})-(\d{2})/);
    return {
      url: (r.linkurl && toAbs(r.linkurl, ad.base) !== ad.base) ? toAbs(r.linkurl, ad.base) : "",
      title: String(r.title || r.titlenew || "").replace(/<\/?em[^>]*>/gi, "").trim(),
      date: m ? m[0] : "",
      // 兰州市门户部分记录只返回 620101 等行政代码；业务表地区必须是人读行政区，不能直接输出代码。
      cityHint: normalizeGsCityName(r.cityname),
      summary: r.content || "",
    };
  }).filter(x => (ad.allowNoUrl ? x.title : (x.url && x.title)));
}

// ---- 贵州：Knockout SPA 后端 JSON GET（支持关键词 args 参数）----
async function gzList(ad, page, args) {
  const kw = args.keyword ? encodeURIComponent(args.keyword) : "";
  const url = `${ad.base}/api/trade/search?pubDate=all&pubType=all&region=${ad.region || "5200"}&industry=all&prjType=${ad.prjType || "all"}&noticeType=${ad.noticeType || "affiche"}&noticeClassify=all&pageIndex=${page}&args=${kw}`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" } });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  let j; try { j = await r.json(); } catch (_) { return []; }
  const arr = (j && Array.isArray(j.data)) ? j.data : [];
  return arr.map(it => {
    const date = String(it.PubDate || "").slice(0, 10);
    const url2 = `${ad.base}/trade/bulletin/?id=${it.Id}`;
    return { url: url2, title: String(it.Title || "").replace(/\s+/g, " ").trim(), date };
  }).filter(x => x.title);
}

// ---- 云南：Vue SPA 后端 REST POST JSON（B 阶段经 ad.gcjsEndpoint / titleField / dateField 切换）----
async function ynList(ad, page, args) {
  const endpoint = ad.gcjsEndpoint || "getZbggList";
  const url = `${ad.base}/ynggfwpt-home-api/jyzyCenter/jyInfo/gcjs/${endpoint}`;
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA_STR, "Content-Type": "application/json", "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" },
      body: JSON.stringify({ pageNum: page, pageSize: ad.rn || 10 }),
    });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  let j; try { j = await r.json(); } catch (_) { return []; }
  const arr = (j && j.code === "1" && j.value && Array.isArray(j.value.list)) ? j.value.list : [];
  const titleField = ad.titleField || "bulletinname";
  const dateField = ad.dateField || "bulletinissuetime";
  return arr.map(it => {
    // 招标公告阶段的列表记录明确给出 guid，可由官方 findZbggByGuid 详情接口形成可回源链接；
    // B 阶段仍沿用各自端点/字段，未确认时保持 allowNoUrl 的诚实边界。
    const guid = String(it.guid || it.jyGuid || "").trim();
    const url2 = endpoint === "getZbggList" && guid
      ? `${ad.base}/ynggfwpt-home-api/jyzyCenter/jyInfo/gcjs/findZbggByGuid?guid=${encodeURIComponent(guid)}`
      : "";
    const title = String(it[titleField] || "").replace(/\s+/g, " ").trim();
    const date = String(it[dateField] || "").slice(0, 10);
    const cityHint = it.areaName || it.region || "";
    return { url: url2, guid, cityHint, title, date };
  }).filter(x => x.title);
}

// ---- 湖北：/jyxxAjax/ POST form（B 阶段经 ad.jsgcEndpoint 切换栏目，列表键为 ${endpoint}List）----
async function hbList(ad, page, args) {
  const endpoint = ad.jsgcEndpoint || "jsgcZbgg";
  const url = `${ad.base}/jyxxAjax/${endpoint}`;
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA_STR, "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" },
      body: `pageSize=${ad.rn || 100}&area=`,
    });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  let j; try { j = await r.json(); } catch (_) { return []; }
  const listKey = endpoint + "List"; // jsgcZbgg→jsgcZbggList；jsgcZbjggs→jsgcZbjggsList
  const arr = (j && Array.isArray(j[listKey])) ? j[listKey] : [];
  return arr.map(it => {
    const raw = String(it.bulletinIssueTime || "");
    let date = "";
    if (/^\d{8}/.test(raw)) date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;       // YYYYMMDDHHmmss
    else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) date = raw.slice(0, 10);                                // 2026-08-14（B 阶段 jsgcZbjggs 格式）
    const guid = it.tenderBulletinGuid || it.guid || "";
    const url2 = guid ? `${ad.base}/jyxx/${endpoint}Detail?guid=${guid}` : "";
    return { url: url2, title: String(it.bulletinName || "").replace(/\s+/g, " ").trim(), date };
  }).filter(x => x.title && (ad.stageKey || isStrictZbTitle(x.title)));
}

// ---- 吉林：TRS WAS 全文检索 JSONP GET ----
async function jlList(ad, page, args) {
  const searchword = "modal<>3 and gtitle<>'' and gtitle<>'null'";
  const url = `https://was.jl.gov.cn/was5/web/search?channelid=${ad.channelId || 237687}&page=${page}&prepage=${ad.rn || 10}&searchword=${encodeURIComponent(searchword)}&callback=result`;
  let r;
  try {
    r = await fetch(url, { method: "GET", headers: { "User-Agent": UA_STR, "Accept": "*/*", "Referer": "https://www.jl.gov.cn/ggzy/" } });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  const txt = Buffer.from(await r.arrayBuffer()).toString("utf8");
  const m = txt.match(/\(?\s*(\{[\s\S]*\})\s*\)?\s*;?\s*$/);
  if (!m) return [];
  let j; try { j = JSON.parse(m[1]); } catch (_) { return []; }
  const arr = (j && Array.isArray(j.datas)) ? j.datas : [];
  const want = ad.iTypes || [ad.iType || "招标公告"];
  return arr.map(it => {
    const date = String(it.timestamp || "").replace(/\./g, "-").slice(0, 10);
    const url2 = it.docpuburl ? (it.docpuburl.startsWith("http") ? it.docpuburl : "http://www.jl.gov.cn/ggzy" + it.docpuburl) : "";
    return { url: url2, title: String(it.title || "").replace(/\s+/g, " ").trim(), date, iType: String(it.iType || "") };
  }).filter(x => x.title && want.includes(x.iType));
}

// ---- 福建：/FwPortalApi/Trade/TradeInfo（MD5 签名 + AES-256-CBC 解密）----
const fjCrypto = (() => {
  const crypto = require("crypto");
  const SALT = "B3978D054A72A7002063637CCDF6B2E5";
  const AES_KEY = "EB444973714E4A40876CE66BE45D5930";
  const AES_IV = "B5A8904209931867";
  const byUpper = (a, b) => String(a).toUpperCase() < String(b).toUpperCase() ? -1 : (String(a).toUpperCase() > String(b).toUpperCase() ? 1 : 0);
  function canonical(obj) {
    return Object.keys(obj).sort(byUpper).map(k => {
      const v = obj[k];
      if (v && (v instanceof Object || Array.isArray(v))) return k + JSON.stringify(v);
      return k + v;
    }).join("");
  }
  function sign(obj) {
    const clean = {};
    for (const k of Object.keys(obj)) if (obj[k] !== "" && obj[k] !== undefined && obj[k] !== null) clean[k] = obj[k];
    return crypto.createHash("md5").update(SALT + canonical(clean)).digest("hex").toLowerCase();
  }
  function decrypt(b64) {
    const d = crypto.createDecipheriv("aes-256-cbc", Buffer.from(AES_KEY, "utf8"), Buffer.from(AES_IV, "utf8"));
    let out = d.update(b64, "base64", "utf8"); out += d.final("utf8"); return out;
  }
  return { sign, decrypt };
})();
async function fjSignedPost(ad, endpoint, payload) {
  const body = { ...payload, ts: Date.now() };
  let r;
  try {
    r = await fetch(`${ad.base}/FwPortalApi/Trade/${endpoint}`, {
      method: "POST",
      headers: { "User-Agent": UA_STR, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", "portal-sign": fjCrypto.sign(body), "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" },
      body: JSON.stringify(body),
    });
  } catch { return null; }
  if (!r || r.status !== 200) return null;
  const json = await r.json().catch(() => null);
  if (!json || json.State !== "200" || !json.Data) return null;
  try { return JSON.parse(fjCrypto.decrypt(json.Data)); }
  catch {
    if (global.__RUN_REPORT) global.__RUN_REPORT.errors.push({ code: "FJ_DECRYPT_FAIL", message: `福建${endpoint}解密失败` });
    return null;
  }
}
async function fjList(ad, page, args) {
  const url = `${ad.base}/FwPortalApi/Trade/TradeInfo`;
  const body = { GGTYPE: ad.GGTYPE || "1", pageNo: page, pageSize: ad.rn || 10, ts: Date.now() };
  const sign = fjCrypto.sign(body);
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA_STR, "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", "portal-sign": sign, "Accept": "application/json, text/plain, */*", "Referer": ad.base + "/" },
      body: JSON.stringify(body),
    });
  } catch (e) { return []; }
  if (!r || r.status === 0 || r.status === 429 || r.status >= 500) return [];
  let j; try { j = await r.json(); } catch (_) { return []; }
  if (!j || j.State !== "200") return [];
  // 2026-08-16 V4A：解密/解析失败≠无数据——密钥轮换时原版静默 []，输出与"该省无标讯"不可区分
  //（违背诚实纪律）。显式记 run-report errors，空窗口可归因。
  let plain; try { plain = fjCrypto.decrypt(j.Data); } catch (_) {
    if (global.__RUN_REPORT) global.__RUN_REPORT.errors.push({ code: "FJ_DECRYPT_FAIL", message: "福建门户解密失败——签名/密钥疑似轮换，需从前端 JS 重取（见 FAMILY_INDEX fj 条目）" });
    return [];
  }
  let obj; try { obj = JSON.parse(plain); } catch (_) { return []; }
  const arr = (obj && Array.isArray(obj.Table)) ? obj.Table : [];
  return arr.map(it => {
    const date = String(it.TM || it.TM1 || it.M_TM || "").slice(0, 10);
    const title = String(it.NAME || "").replace(/\s+/g, " ").trim();
    const url2 = `${ad.base}/#/business/detail?name=${encodeURIComponent(title)}&cid=${encodeURIComponent(it.M_ID)}&type=GCJS`;
    return { url: url2, M_ID: String(it.M_ID || ""), title, date };
  }).filter(x => x.title);
}

function mapFjDetailPayload(meta, content, item, ad) {
  const html = content && (content.Contents || content.Detail) || "";
  const out = html ? extractDetail({}, html, item, "") : {};
  const base = meta.BaseInfo || {};
  if (base.NOTICE_NAME || base.TENDER_PROJECT_NAME) out.title = base.NOTICE_NAME || base.TENDER_PROJECT_NAME;
  if (base.TENDER_PROJECT_CODE) out.projectCode = String(base.TENDER_PROJECT_CODE);
  if (base.AREANAME) out.city = String(base.AREANAME);
  if (base.BID_OPEN_TIME) out.bidOpen = String(base.BID_OPEN_TIME).slice(0, 16);
  // CONTRACT_RECKON_PRICE 是“合同估算价”，PRICE_UNIT=0 为元、1 为万元。
  // 它不能在公告明确“控制价后续发布”时冒充控制价；只有正文已抽到价款事实时才作结构化校正。
  // 正文存在精确“招标控制价+数字+单位”时保留正文的精确值，避免 1449.0961 被结构化四舍五入为 1449.1。
  const contractAmount = Number(base.CONTRACT_RECKON_PRICE);
  const contractWan = Number.isFinite(contractAmount) && contractAmount > 0
    ? String(Number(((String(base.PRICE_UNIT) === "0" ? contractAmount / 10000 : contractAmount)).toFixed(6)))
    : "";
  const detailText = htmlToText(html);
  const hasExplicitControlPrice = /招标控制价[\s\S]{0,100}?\d+(?:\.\d+)?\s*(?:万元|万|元)/.test(detailText);
  const controlPriceDeferred = /招标控制价[\s\S]{0,120}?(?:最迟应|另行|后续)[\s\S]{0,60}?发布/.test(detailText);
  if (controlPriceDeferred) out.controlPrice = "";
  else if (contractWan && out.controlPrice && !hasExplicitControlPrice) out.controlPrice = contractWan;
  if (base.TENDERER_NAME) out.owner = String(base.TENDERER_NAME);
  if (base.TENDER_AGENCY_NAME) out.agency = String(base.TENDER_AGENCY_NAME);
  if (Number(base.LIMITE_TIME) > 0) out.duration = `${Number(base.LIMITE_TIME)}日历天`;
  if (content && Array.isArray(content.Attachment) && content.Attachment[0]) {
    const file = content.Attachment[0];
    const link = file.Url || file.URL || file.url || file.FileUrl || "";
    if (link) out.docLink = toAbs(String(link), ad.base);
  }
  return out;
}

async function fjDetail(ad, item) {
  const id = item.M_ID || (item.url && /[?&]cid=([^&]+)/.test(item.url) ? decodeURIComponent(RegExp.$1) : "");
  if (!id) return {};
  const meta = await fjSignedPost(ad, "TradeInfoDetail", { name: item.title || "", cid: Number(id) || id, type: "GCJS" });
  if (!meta) return {};
  const nodes = Array.isArray(meta.Nodes) ? meta.Nodes.flatMap((node) => Array.isArray(node.Children) ? node.Children : []) : [];
  const notice = nodes.find((node) => /招标公告/.test(String(node.Title || ""))) || nodes[0];
  const content = notice ? await fjSignedPost(ad, "TradeInfoContent", { type: notice.Type, m_id: notice.M_ID }) : null;
  return mapFjDetailPayload(meta, content, item, ad);
}

// ---- 重庆：Nuxt SSR /trade/014001（Cloudflare 偶发 521，需完整浏览器 UA + 重试）----
const CQ_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
async function cqFetch(url, delay = 500) {
  let wait = delay;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 30000);
      try {
        const r = await fetch(url, {
          headers: { "User-Agent": CQ_BROWSER_UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "zh-CN,zh;q=0.9" },
          signal: c.signal, redirect: "follow",
        });
        if (r.status === 521 || r.status === 429 || r.status >= 500) { await sleep(wait); wait = Math.min(wait * 2, 8000); continue; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.text();
      } finally { clearTimeout(t); }
    } catch (e) {
      if (attempt === 14) throw e;
      await sleep(wait); wait = Math.min(wait * 2, 8000);
    }
  }
  throw new Error("cq retry exhausted");
}
async function cqList(ad, page, args) {
  let html;
  try { html = await cqFetch(ad.listUrl(page), args.delay); }
  catch (e) { console.error("[cq] fetch FAIL", e.message); return []; }
  return ad.parse(html);
}

// =================== R2 端点自动探测模式 ===================
// 给定候选 base 列表，自动试 cnum 001-004（含 http 兜底），定位返回 JSON records[] 的 EPoint 端点。
// 同时识别「已定位但需登录」(401/403) 与「环境 TLS 限制」(status 0 / klass=tls)，诚实分类，绝不臆断跑不通。
// base 形如 https://host 或 https://host/ctx（ctx 可含 TPBidder/EpointWebBuilder/hbggfwpt 等子上下文）。
const PROBE_TARGETS = {
  beijing:   ["https://ggzyfw.beijing.gov.cn", "https://zhjy.bcactc.com"],
  tianjin:   ["http://60.28.163.169", "https://60.28.163.169"],
  hebei:     ["https://ggzy.hebei.gov.cn/hbggfwpt", "http://ggzy.hebei.gov.cn/hbggfwpt", "https://www.hebeieb.com.cn"],
  shanxi:    ["https://www.sxbid.com.cn", "http://www.sxbid.com.cn"],
  neimenggu: ["https://ggzyjy.nmg.gov.cn/TPBidder", "https://ggzyjy.nmg.gov.cn/EpointWebBuilder", "https://ggzyjy.nmg.gov.cn"],
  liaoning:  ["http://www.lntb.gov.cn", "https://www.lntb.gov.cn"],
  gansu:     ["https://ggzyjy.gansu.gov.cn", "http://ggzyjy.gansu.gov.cn"],
  // 注：jilin/fujian/jiangxi/hubei/hunan/guangxi/chongqing/guizhou/yunnan 已 bespoke 逆向并建 adapter，移出待探列表
  qinghai:   ["https://www.qhdzzbfw.gov.cn/TPBidder", "https://www.qhdzzbfw.gov.cn/fwpt"],
};

async function epointProbeOne(base, kw) {
  const url = base.replace(/\/+$/, "") + EPOINT_API;
  let lastKlass = "";
  for (const cnum of ["001", "002", "003", "004"]) {
    const body = JSON.stringify({
      token: "", pn: 1, rn: "10", wd: kw || "", cnum,
      sort: JSON.stringify({ infodatepx: "0" }), cl: 200,
    });
    const r = await robustFetch(url, {
      method: "POST", tryHttp: true, timeout: 25000,
      headers: {
        "User-Agent": "Mozilla/5.0", "Content-Type": "application/json;charset=utf-8",
        "X-Requested-With": "XMLHttpRequest", "Referer": base + "/",
      },
      body,
    });
    if (r.status === 0) { lastKlass = r.klass || "tls"; continue; } // 传输失败 → 试下一 base
    // 本环境 https 被代理 TLS 拦截（http 兜底才拿到响应）→ 诚实标记为环境限制，不误判"站点无 EPoint"
    if (r.httpsBlocked) { lastKlass = "tls"; return { hit: false, httpsBlocked: true, base, klass: "tls" }; }
    let j = null;
    try { j = await r.json(); } catch { continue; }               // 非 JSON（HTML 占位）→ 路径错
    if (j && j.result && Array.isArray(j.result.records) && j.result.records.length) {
      return { hit: true, base, cnum, scheme: r.scheme, count: j.result.records.length, klass: r.klass };
    }
    // 已定位但需登录：EPoint 返回 {"status":{"code":401,...}} 或裸 401/403
    if ((j && j.status && (j.status.code === 401 || j.status.code === 403)) || r.status === 401 || r.status === 403) {
      return { hit: false, authWall: true, base, cnum, scheme: r.scheme, statusText: (j && j.status && j.status.text) || ("HTTP " + r.status) };
    }
  }
  return { hit: false, base, klass: lastKlass };
}

async function probeProvince(prov, kw = "管网") {
  const targets = PROBE_TARGETS[prov];
  if (!targets) return { province: prov, error: "无探测目标（该省已 verified 或不在待探列表）" };
  const out = { province: prov, keyword: kw, tried: [], hits: [], authWalls: [], envLimits: [], _httpsBlocked: false };
  for (const base of targets) {
    const res = await epointProbeOne(base, kw);
    out.tried.push(base);
    if (res.hit) out.hits.push(res);
    else if (res.authWall) out.authWalls.push(res);
    else if (res.klass === "tls" || res.klass === "conn" || res.klass === "dns") out.envLimits.push({ base, klass: res.klass });
    if (res.httpsBlocked) out._httpsBlocked = true;
  }
  // 凡出现「https 在本环境传不过去、靠 http 兜底才拿到响应」的省，诚实归为 ENV_LIMIT（代理 TLS 限制），
  // 绝不能因 http 拿到了 502 就误判"站点无 EPoint"。
  if (out._httpsBlocked && out.envLimits.length === 0) out.envLimits.push({ base: targets[0], klass: "tls" });
  out.conclusion = out.hits.length ? "HIT"
    : (out.authWalls.length ? "AUTH_WALL" : (out.envLimits.length ? "ENV_LIMIT" : "NO_EPOINT"));
  return out;
}

// =================== R3 verified 门禁 ===================
// 端到端实测：跑通后必须真实返回非空标题+日期的记录，否则拒绝标 verified（防"看着像通了"）。
// 同时做 R4 诚实守卫：检出 url 坍缩成站点根的情况并警告（伪造风险）。
async function verifyProvince(prov, kw = "管网", days = 365) {
  const pkey = ADAPTERS[prov] ? prov : (PROV_ALIAS[prov] || prov);
  const adRef = ADAPTERS[pkey];
  const blind = adRef && (adRef.keywordBlind || adRef.clientFilterOnly);
  const effKw = blind ? "" : kw; // 关键词盲源/客户端过滤源：验证时免关键词，改测"端点是否返回真实记录"
  const args = { province: prov, keyword: effKw, days, delay: 500, limit: 20, detail: false, csv: false, xlsx: false, out: "", cat: "" };
  const { ad, result } = await collectProvince(prov, args);
  const baseNorm = normUrl(ad.base, ad);
  const collapse = result.filter(r => r.url && r.url === baseNorm).length;
  const realOnes = result.filter(r => r.title && r.date);
  const passed = realOnes.length > 0 && collapse === 0;
  return {
    province: prov, adapter: ad && ad.name,
    total: result.length, realRecords: realOnes.length, collapseWarned: collapse, passed,
    keywordBlind: !!(adRef && adRef.keywordBlind),
    clientFilterOnly: !!(adRef && adRef.clientFilterOnly),
    reason: passed ? (effKw === "" ? "PASS(免关键词验证：端点返回真实记录，采集时按标题客户端过滤)" : "PASS") : (result.length === 0 ? "FAIL: 0 条记录" : (collapse ? "FAIL: 检测到 url 坍缩成站点根（伪造风险）" : "FAIL: 记录缺标题/日期")),
  };
}

function resolveProbeKey(prov) {
  if (PROBE_TARGETS[prov]) return prov;
  // 21 个待探省份的中文别名（与 PROBE_TARGETS 键对应）
  const PROBE_ALIAS = {
    北京: "beijing", 天津: "tianjin", 河北: "hebei", 山西: "shanxi", 内蒙古: "neimenggu",
    辽宁: "liaoning", 吉林: "jilin", 福建: "fujian", 江西: "jiangxi", 湖北: "hubei",
    湖南: "hunan", 广西: "guangxi", 重庆: "chongqing", 贵州: "guizhou", 云南: "yunnan",
    西藏: "xizang", 陕西: "shaanxi", 甘肃: "gansu", 青海: "qinghai", 宁夏: "ningxia", 新疆: "xinjiang",
  };
  return PROBE_ALIAS[prov] || (PROV_ALIAS[prov] || null);
}

// =================== R6 证据自动化 ===================
// 每次探测/验证自动落盘 test-logs/，便于审计与"逐省取证"留痕，杜绝口头结论无据。
const EVIDENCE_DIR = path.join(__dirname, "test-logs");
function tsStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function ensureEvidenceDir() { try { fs.mkdirSync(EVIDENCE_DIR, { recursive: true }); } catch (_) {} }
function conclusionNote(c) {
  return ({
    HIT: "✅ 命中公开 EPoint 端点（可建 adapter）",
    AUTH_WALL: "🔒 端点已定位但需登录/CA/WAF（公开范围不可取，诚实未 verified）",
    ENV_LIMIT: "⚠️ 本环境传输受限（代理 HTTPS 握手失败/无直连外网），待他网复测，严禁判跑不通",
    NO_EPOINT: "🟡 未在候选域名定位到公开 EPoint 端点（定制 SPA 或需 bespoke 逆向，R5 范畴）",
  })[c] || c;
}
function writeProbeEvidence(rep) {
  ensureEvidenceDir();
  const prov = rep.province;
  const file = path.join(EVIDENCE_DIR, `probe-${prov}.md`);
  const L = [];
  L.push(`# 探测证据：${prov}`);
  L.push(`\n- 时间：${tsStamp()}`);
  L.push(`- 关键词：${rep.keyword || "管网"}`);
  L.push(`- 结论：**${rep.conclusion}** — ${conclusionNote(rep.conclusion)}`);
  L.push(`\n## 尝试的候选域名/上下文`);
  for (const b of (rep.tried || [])) L.push(`- ${b}`);
  if (rep.hits && rep.hits.length) {
    L.push(`\n## ✅ 命中端点`);
    for (const h of rep.hits) L.push(`- base=${h.base} | cnum=${h.cnum} | scheme=${h.scheme} | 示例条数=${h.count}`);
  }
  if (rep.authWalls && rep.authWalls.length) {
    L.push(`\n## 🔒 登录墙（端点已定位）`);
    for (const a of rep.authWalls) L.push(`- base=${a.base} | cnum=${a.cnum} | 返回：${a.statusText}`);
  }
  if (rep.envLimits && rep.envLimits.length) {
    L.push(`\n## ⚠️ 环境传输受限`);
    for (const e of rep.envLimits) L.push(`- base=${e.base} | klass=${e.klass}`);
  }
  if (rep.error) L.push(`\n> 说明：${rep.error}`);
  L.push(`\n---\n*本证据由 \`--probe\` 自动生成，符合"逐省取证、有证据不造假"纪律。*`);
  fs.writeFileSync(file, L.join("\n"), "utf8");
  // 汇总表（去重更新同一省的最新结论行）
  const sumFile = path.join(EVIDENCE_DIR, "probe-summary.md");
  const row = `- ${tsStamp()} | ${prov} | ${rep.conclusion} | hits=${rep.hits ? rep.hits.length : 0} auth=${rep.authWalls ? rep.authWalls.length : 0} env=${rep.envLimits ? rep.envLimits.length : 0}`;
  let prev = "";
  try { prev = fs.readFileSync(sumFile, "utf8"); } catch (_) {}
  if (!prev.includes(`| ${prov} |`)) fs.appendFileSync(sumFile, (prev ? "" : `# 探测汇总（自动）\n\n`) + row + "\n");
  else fs.writeFileSync(sumFile, prev.split("\n").map((l) => l.includes(`| ${prov} |`) ? row : l).join("\n"));
  return file;
}
async function probeAllEvidence(kw = "管网") {
  ensureEvidenceDir();
  const keys = Object.keys(PROBE_TARGETS);
  const summary = [];
  for (const k of keys) {
    const rep = await probeProvince(k, kw);
    const f = writeProbeEvidence(rep);
    summary.push({ province: k, conclusion: rep.conclusion, file: f });
    console.error(`[probe-all] ${k} → ${rep.conclusion} (证据: ${f})`);
  }
  return summary;
}

// ---- 广东（粤公平）列表接口（独立 API，非 EPoint）----
// POST https://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items
// 详情正文走官方 singleNode/detail 公开接口；限流 429/5xx 指数退避 + 自适应降速。
// 注意：粤公平 siteCode="440000"(省级) 实际返回 0，"全省"需逐地市循环（广州/深圳/珠海…各自有效）。
const YGP_API = "https://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items";
let _ygpDelay = 350;
// 粤公平列表 row 结构化字段映射。
// 列表 row 只先填其明确提供的薄字段；详情精确标签随后非空覆盖。键不存在则留空，绝不猜测。
function mapYgpRow(rr) {
  if (!rr || typeof rr !== "object") return {};
  const g = (...keys) => {
    for (const k of keys) {
      const v = rr[k];
      if (v != null && String(v).trim() && !/^[\s\-]+$/.test(String(v))) return String(v).trim();
    }
    return "";
  };
  return {
    projectCode: g("projectCode", "tenderProjectCode", "projCode", "项目编号", "noticeProjectCode"),
    owner:       g("projectOwner", "tendererName", "ownerName", "招标人", "tenderName", "bidderName"),
    partyA:      g("projectOwner", "tendererName", "招标人", "ownerName"),
    agency:     g("tenderAgencyName", "agencyName", "招标代理", "agentName"),
    controlPrice: g("controlPrice", "tenderControlPrice", "controlprice", "招标控制价", "maxPrice"),
    budget:     g("budget", "totalInvest", "概算", "估算", "investAmount"),
    bond:       g("bond", "bidBond", "保证金", "margin"),
    funding:    g("fundSource", "funding", "资金来源"),
    duration:   g("duration", "工期", "servicePeriod", "timeLimit"),
    bidOpen:    g("bidOpenTime", "openTime", "开标时间", "bidOpeningTime", "openDate"),
    manager:    g("manager", "projectManager", "项目经理", "projectLeader"),
    contact:    g("contact", "linkman", "联系人", "contactName"),
    phone:      g("contactPhone", "phone", "联系电话", "tel"),
    method:     g("tenderMode", "method", "招标方式", "bidMethod"),
    evaluation: g("evalMethod", "evaluation", "评标办法", "evaluateMethod"),
  };
}

// ---- 河南真公告接口（2026-08-15 修正）：原 epointList 走档案库索引(cnum=001 返回文件名)，不适用真公告 ----
// 真公告数据源：POST /EpointWebBuilder/rest/frontAppCustomAction/getPageInfoListNewYzm
// 参数(form)：siteGuid(固定) / categoryNum(栏目码, stage 覆盖) / xiaqucode(4100=全省) / pageIndex / pageSize
// 响应：custom.infodata[].{title, infourl, infodate}
async function henanNoticeList(ad, page, args) {
  const targets = resolveCityTargets(ad, args);
  if (!targets) {
    // 默认全省：单页，crawlRound 负责翻页（保持 MAX_PAGE=200 能力）
    return henanFetchPage(ad, ad.xiaqucode || "4100", page - 1, args);
  }
  if (page > 1) return []; // 循环模式已在 page1 聚合完毕，避免 crawlRound 重复取
  const all = [];
  for (const t of targets) {
    for (let pg = 0; pg < 30; pg++) {
      if (pg) await sleep(args.delay || 500);   // 循环模式页间节流（PR 审查补：原版无页间等待，激活前必须补，防连打）
      const recs = await henanFetchPage(ad, t.code, pg, args);
      if (!recs.length) break;
      all.push(...recs);
      if (recs.length < (ad.rn || 8)) break;
    }
    if (hasReachedLimit(all.length, args)) break;
    await sleep(args.delay || 500);             // 城市间节流
  }
  return all;
}

async function henanFetchPage(ad, xiaqucode, pageIndex, args) {
  const pageSize = ad.rn || 8;
  const categoryNum = ad.categoryNum || "002001001";
  const body = new URLSearchParams({
    siteGuid: ad.siteGuid || "7eb5f7f1-9041-43ad-8e13-8fcb82ea831a",
    categoryNum,
    xiaqucode: String(xiaqucode),
    pageIndex: String(pageIndex),
    pageSize: String(pageSize),
  });
  const r = await fetch(ad.base + "/EpointWebBuilder/rest/frontAppCustomAction/getPageInfoListNewYzm", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": UA_STR, "Referer": ad.referer || (ad.base + "/") },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("henan notice HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const arr = (j && j.custom && Array.isArray(j.custom.infodata)) ? j.custom.infodata : [];
  return arr.map(it => {
    const raw = String(it.infodate || "");
    const m = raw.match(/(\d{4}-\d{2}-\d{2})/);
    const url = it.infourl ? toAbs(it.infourl, ad.base) : "";
    return {
      url,
      title: String(it.title || "").replace(/<\/?em[^>]*>/gi, "").trim(),
      date: m ? m[1] : "",
    };
  }).filter(x => x.title);
}


// ===== Goal v5 城市级批次2（2026-08-16 侦察接入：宜昌/临沂/烟台/无锡/泉州/岳阳/遵义/宜宾）=====
// 端点情报来自四路侦察 agent 真机验证（CITY_PLATFORMS.md）；九江市级平台已下线（归江西省平台）不接。

// 宜昌：EpointWebBuilder 变体（secaction/getSecInfoListYzm，与河南 frontAppCustomAction 同族不同端点；content=服务端关键词）
async function yichangList(ad, page, args) {
  const body = new URLSearchParams({
    siteGuid: ad.siteGuid, categoryNum: ad.categoryNum, content: args.keyword || "",
    pageindex: String(page), pagesize: String(ad.rn || 20), YZM: "", ImgGuid: "", startdate: "", enddate: "", xiqucode: "", projectjiaoyitypeex: "",
  });
  const r = await fetch(ad.base + "/EpointWebBuilder/rest/secaction/getSecInfoListYzm", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": UA_STR, "Referer": ad.referer || (ad.base + "/"), "X-Requested-With": "XMLHttpRequest" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("yichang HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const arr = (j && j.custom && Array.isArray(j.custom.infodata)) ? j.custom.infodata : [];
  return arr.map(it => {
    const m = String(it.infodate || "").match(/(\d{4}-\d{2}-\d{2})/);
    return { url: it.infourl ? toAbs(String(it.infourl), ad.base) : "", title: String(it.title || "").trim(), date: m ? m[1] : "" };
  }).filter(x => x.title);
}

function localYmd(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseWeifangList(payload, ad) {
  const j = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!j || !j.custom || !Array.isArray(j.custom.infodata)) throw new Error("weifang invalid response structure");
  return j.custom.infodata.map(it => {
    const title = htmlToText(String(it.customtitle || it.title || "")).trim();
    const date = String(it.infodate || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
    const district = ["潍城区", "寒亭区", "坊子区", "奎文区", "临朐县", "昌乐县", "青州市", "诸城市", "寿光市", "安丘市", "高密市", "昌邑市"].find(x => title.includes(x));
    return {
      url: it.infourl ? toAbs(String(it.infourl), ad.base) : "",
      title, date,
      cityHint: district || extractKnownArea(title) || extractCity(title) || "潍坊市",
      projectCode: String(it.projectno || "").trim(),
    };
  }).filter(x => x.title && x.date && x.url);
}

function parseMianyangHtml(html, ad) {
  const out = [];
  for (const block of String(html || "").match(/<li\b[^>]*class=["'][^"']*infor-list[^"']*["'][^>]*>[\s\S]*?<\/li>/gi) || []) {
    const am = block.match(/<a\b[^>]*class=["'][^"']*infor-con[^"']*["'][^>]*href=["']([^"']*projectInfo\.html\?[^"']+)["']/i);
    const tm = block.match(/<p\b[^>]*class=["'][^"']*infor-text[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    const dm = block.match(/(?:19|20)\d{2}-\d{2}-\d{2}/);
    if (!am || !tm || !dm) continue;
    const href = am[1].replace(/&amp;/gi, "&");
    const infoid = href.match(/[?&]infoid=([0-9a-f-]{36})/i)?.[1] || "";
    const title = htmlToText(tm[1])
      .replace(/^\[[^\]]+\]/, "")
      .replace(/\[(?:标书[^\]]*|已结束|已流标|已终止)\]\s*$/, "")
      .trim();
    if (!infoid || !title) continue;
    out.push({ infoid, title, date: dm[0], cityHint: extractKnownArea(title) || ad.cityName || "绵阳市" });
  }
  return out;
}

function parseMianyangRelations(payload, item, ad) {
  const outer = typeof payload === "string" ? JSON.parse(payload) : payload;
  const rels = typeof outer.custom === "string" ? JSON.parse(outer.custom) : outer.custom;
  if (!Array.isArray(rels)) throw new Error("mianyang invalid relation response");
  const rel = rels.find(x => String(x.categorynum || "") === ad.categoryNum && String(x.infoid || "") === item.infoid);
  if (!rel || !rel.urlpath) throw new Error(`mianyang relation missing for ${item.infoid}`);
  const path = "/myggzy" + String(rel.urlpath);
  return {
    ...item,
    url: toAbs(path, ad.base),
    title: htmlToText(String(rel.realtitle || rel.title || item.title))
      .replace(/^\[[^\]]+\]/, "")
      .replace(/\[(?:标书[^\]]*|已结束|已流标|已终止)\]\s*$/, "")
      .trim(),
    date: String(rel.infodate || item.date).match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0] || item.date,
  };
}

async function mianyangList(ad, page, args) {
  const html = await requestWithRetry(ad.listUrl(page), args.delay);
  const listed = parseMianyangHtml(html, ad)
    .filter(x => !args.keyword || x.title.includes(args.keyword));
  const out = [];
  for (const item of listed) {
    const qs = new URLSearchParams({ cmd: "getInfolistNew", infoid: item.infoid });
    const payload = await requestWithRetry(`${ad.base}/EpointWebBuilder/getinfobyrelationguidaction.action?${qs.toString()}`, args.delay);
    const resolved = parseMianyangRelations(payload, item, ad);
    if (resolved) out.push(resolved);
  }
  return out;
}

async function qinhuangdaoList(ad, page, args) {
  // 官网静态页 1..6 连续覆盖当前记录；第 7 页开始跳到 2021 旧档，完整深翻进入验证码接口。
  // 不把该断层误报成“无公告”：确需翻到第 7 页时记录浏览器墙，由 run-report 标 BROWSER_REQUIRED。
  if (page > 6) {
    if (args._run && !args._run.auth_walls.some(x => x.code === "QHD_CAPTCHA_AFTER_PAGE_6")) {
      args._run.auth_walls.push({ status: 403, code: "QHD_CAPTCHA_AFTER_PAGE_6", page });
    }
    return [];
  }
  const html = await requestWithRetry(ad.listUrl(page), args.delay);
  return ad.parse(html);
}

function parseNantongPayload(payload, ad) {
  const j = typeof payload === "string" ? JSON.parse(payload) : payload;
  if (!j || !Array.isArray(j.Table)) throw new Error("nantong invalid response structure");
  return j.Table.map(it => {
    const rawTitle = htmlToText(String(it.title2 || it.title || ""));
    const title = rawTitle.replace(/^\[新\]\s*/, "").replace(/\[已作废\]\s*$/, "").trim();
    const date = String(it.infodate || "").match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0] || "";
    return {
      url: it.infourl ? toAbs(String(it.infourl), ad.base) : "",
      title, date,
      cityHint: String(it.XIAQUNAME || ad.cityName || "南通市").trim(),
      method: String(it.JYFS || "").trim(),
      _void: /\[已作废\]/.test(rawTitle),
      _stage: String(it.GGTYPE || it.categoryname || "").trim(),
      _categoryName: String(it.categoryname || "").trim(),
      _tradeType: String(it.JYLX || "").trim(),
    };
  }).filter(x => x.title && x.date && x.url && !x._void
    && x._stage === "招标公告"
    && x._categoryName === "招标公告/资审公告"
    && x._tradeType === "建设工程");
}

async function nantongList(ad, page, args) {
  const params = {
    siteGuid: ad.siteGuid,
    categorymum: ad.categoryNum, // 官方参数名即 categorymum（保留其拼写）
    pageIndex: Math.max(0, page - 1),
    pageSize: ad.rn || 15,
    searchTitle: "", // 官方 searchTitle 中文检索静默返 0，必须客户端过滤
    diqu: "",
    startdate: "",
    enddate: "",
  };
  const body = new URLSearchParams({ params: JSON.stringify(params) });
  const r = await fetch(ad.base + "/EWB-FRONT/rest/infolist/getJyInfoList", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA_STR, "Referer": ad.referer, "X-Requested-With": "XMLHttpRequest" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("nantong HTTP " + r.status);
  return parseNantongPayload(await r.text(), ad);
}

const SECOND_BATCH_NON_ZB = /(资格预审公告|资审公告|澄清|修改公告|变更公告|延期公告|答疑|补充公告|中标|成交|结果公示|合同公告|终止公告|流标|废标)/;

function parseLabelTable(html) {
  const fields = {};
  for (const row of String(html || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(m => htmlToText(m[1]).replace(/^[　\s]+|[　\s]+$/g, ""));
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const key = cells[i].replace(/[：:]\s*$/, "").trim();
      const value = cells[i + 1].trim();
      if (key && key.length <= 50 && value && !fields[key]) fields[key] = value;
    }
  }
  return fields;
}

function looseField(fields, ...names) {
  const entries = Object.entries(fields || {});
  for (const name of names) {
    const wanted = String(name).replace(/\s+/g, "");
    const hit = entries.find(([key]) => String(key).replace(/\s+/g, "") === wanted);
    if (hit) return hit[1];
  }
  return "";
}

function structuredMoneyWan(value) {
  const raw = String(value || "").replace(/[,，\s]/g, "");
  const m = raw.match(/(\d+(?:\.\d+)?)/);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return "";
  if (/万元/.test(raw)) return String(Number(n.toFixed(6)));
  if (/(?:人民币)?元/.test(raw)) return String(Number((n / 10000).toFixed(6)));
  return String(Number(n.toFixed(6))); // 结构化字段标签本身已注明“万元”时使用
}

function stripSealNoise(value) {
  return String(value || "").replace(/&&&[^&]+&&&/g, "").replace(/^[为是：:\s]+/, "").trim();
}

function cleanNanjingQualification(value) {
  return String(value || "")
    .replace(/\s*业绩要求\s*[:：][\s\S]*$/i, "")
    .replace(/\s*\d+\s*[.、．]\s*招标文件的获取[\s\S]*$/i, "")
    .trim();
}

function nanjingDetail(html, item, pdfText) {
  const out = extractDetail({}, html, item, pdfText);
  for (const key of ["owner", "agency", "contact", "manager"]) out[key] = stripSealNoise(out[key]);
  out.qualification = cleanNanjingQualification(out.qualification);
  return out;
}

function jinanDetail(html, item, pdfText) {
  const out = extractDetail({}, html, item, pdfText);
  const f = parseLabelTable(html);
  const detailText = htmlToText(html);
  const title = htmlToText(String(html).match(/<div\b[^>]*class=["'][^"']*\btle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "").trim();
  if (title) out.title = title;
  out.projectCode = f["项目编号"] || out.projectCode || "";
  out.projectSite = f["工程地点"] || out.projectSite || "";
  out.funding = f["资金来源"] || out.funding || "";
  out.budget = f["计划批文总投资额"] ? structuredMoneyWan(f["计划批文总投资额"]) : (out.budget || "");
  out.controlPrice = f["合同估算价"] ? structuredMoneyWan(f["合同估算价"]) : (out.controlPrice || "");
  out.scale = f["工程规模"] || out.scale || "";
  out.approval = f["计划文号"] || out.approval || "";
  out.owner = stripSealNoise(f["招标单位"] || f["建设单位"] || "");
  out.agency = stripSealNoise(f["招标代理单位"] || "");
  out.contact = stripSealNoise(f["招标单位联系人"] || f["建设单位联系人"] || "");
  out.phone = String(f["招标单位联系电话"] || f["建设单位联系电话"] || "").trim();
  const duration = detailText.match(/(?:^|\n)\s*\d+\s*[.、．]\s*计划工期\s*[:：]\s*(\d+(?:\.\d+)?)/m)?.[1] || "";
  if (duration) out.duration = duration;
  const qualification = detailText.match(/(?:^|\n)\s*1\s*[.、．]\s*(本次招标要求潜在投标人[\s\S]{10,1000}?)(?=\n\s*2\s*[.、．]\s*投标人拟派)/m)?.[1] || "";
  out.qualification = qualification
    ? cleanVal(qualification.replace(/[\r\n]+/g, " ")).slice(0, 500)
    : cleanNanjingQualification(out.qualification);
  const performance = detailText.match(/(?:^|\n)\s*\d+\s*[.、．]\s*业绩要求\s*[:：]\s*([\s\S]{4,1200}?)(?=\n\s*\d+\s*[.、．]\s*(?:信誉|联合体|其他)要求)/m)?.[1] || "";
  if (performance) out.performance = cleanVal(performance.replace(/[\r\n]+/g, " ")).slice(0, 500);
  out.bidOpen = out.bidOpen || grabDateTime(detailText, ["投标文件的提交截止时间", "投标截止时间", "开标时间"]);
  return out;
}

function wuhanDetail(ad, html, item) {
  const f = parseLabelTable(html);
  const other = String(f["其他要求"] || "");
  const bidOpen = String(html).match(/id\s*=\s*["']bidOpenTime["'][^>]*value\s*=\s*["']([^"']+)/i)?.[1] || "";
  const durationValue = String(f["计划工期（日历天）"] || "").match(/\d+(?:\.\d+)?/)?.[0] || "";
  return {
    title: f["招标项目名称"] || item.title,
    projectCode: f["招标登记编号"] || "",
    projectSite: f["工程地点"] || "",
    bidOpen: bidOpen ? bidOpen.slice(0, 16) : "",
    funding: "",
    duration: durationValue ? `${durationValue}日历天` : "",
    qualification: grabQualification(other, flatten(other)),
    performance: grabPerformance(other, flatten(other)),
    controlPrice: "",
    budget: structuredMoneyWan(f["本次招标工程投资额(万元)"] || f["投资总额（万元）"] || ""),
    bond: "",
    evaluation: grabEvaluation(String(f["评标办法"] || "")),
    consortium: grabConsortium(other),
    fullScore: "",
    approval: f["立项批准文号"] || "",
    method: f["招标方式"] || "",
    scale: "",
    scope: f["招标内容说明"] || f["招标内容"] || "",
    owner: stripSealNoise(f["招标人（盖章）"] || ""),
    agency: stripSealNoise(f["招标代理机构"] || ""),
    manager: "",
    contact: stripSealNoise(f["招标人联系人"] || ""),
    phone: String(f["招标联系电话"] || "").trim(),
    docLink: "",
  };
}

function nanjingArea(title) {
  const value = String(title || "");
  const maps = [
    ["江宁", "江宁区"], ["浦口", "浦口区"], ["六合", "六合区"],
    ["溧水", "溧水区"], ["高淳", "高淳区"], ["江北新区", "江北新区"],
  ];
  const hit = maps.find(([key]) => value.includes(key));
  return hit ? hit[1] : "南京市";
}

function parseNanjingPayload(payload, ad) {
  const outer = typeof payload === "string" ? JSON.parse(payload) : payload;
  const inner = typeof outer.custom === "string" ? JSON.parse(outer.custom) : outer.custom;
  if (!inner || !Array.isArray(inner.Table)) throw new Error("nanjing invalid response structure");
  return inner.Table.map(it => {
    const title = htmlToText(String(it.GongGaoName || it.title || "")).trim();
    const date = String(it.GongGaoFBDate || it.GongGaoStartDate || "").match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0] || "";
    const rawPrice = String(it.HeTongGuSuanPrice || it.FaBaoPrice || "").replace(/,/g, "").trim();
    return {
      title,
      date,
      url: it.href ? toAbs(String(it.href), ad.base) : "",
      cityHint: nanjingArea(title),
      projectCode: String(it.BiaoDuanNO || "").trim(),
      controlPrice: /^\d+(?:\.\d+)?$/.test(rawPrice) ? rawPrice : "",
    };
  }).filter(x => x.title && x.date && x.url && /招标公告/.test(x.title) && !SECOND_BATCH_NON_ZB.test(x.title));
}

async function nanjingList(ad, page, args) {
  const out = [];
  for (const categorynum of ad.categoryNums || []) {
    const body = new URLSearchParams({
      categorynum,
      keyword: args.keyword || "",
      pageIndex: String(Math.max(1, page)),
      pageSize: String(ad.rn || 10),
      startprice: "", endprice: "", startdate: "", enddate: "", bdbh: "", bdmc: "",
    });
    const r = await fetch(ad.base + "/webdb_njggzy/fjszListAction.action?cmd=getInfolist", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA_STR, "Referer": ad.referer, "X-Requested-With": "XMLHttpRequest" },
      body: body.toString(),
    });
    if (!r.ok) throw new Error("nanjing HTTP " + r.status);
    out.push(...parseNanjingPayload(await r.text(), ad));
  }
  return out;
}

function normalizeHuizhouUrl(href) {
  const value = String(href || "").replace(/&amp;/gi, "&");
  return value.replace(/^https?:\/\/zyjy--huizhou--gov--cn--[^./]+\.proxy\.huizhou\.gov\.cn(?::80)?/i, "https://zyjy.huizhou.gov.cn");
}

function huizhouDetail(html, item, pdfText) {
  const out = extractDetail({}, html, item, pdfText);
  const f = parseLabelTable(html);
  out.projectSite = looseField(f, "招标项目实施（交货）地点", "项目实施（交货）地点") || out.projectSite || "";
  out.duration = looseField(f, "工期（交货期）", "工期") || out.duration || "";
  const limit = f["最高投标限价（投标报价上限值）"] || f["最高投标限价"] || f["投标报价上限值"] || "";
  if (limit) out.controlPrice = structuredMoneyWan(limit);
  if (out.docLink && !/\/projectInit\/viewPdf\?id=/i.test(out.docLink)) out.docLink = "";
  return out;
}

function parseHuizhouHtml(html, ad) {
  const out = [];
  for (const row of String(html || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    const am = row.match(/<a\b[^>]*href=["']([^"']*\/ggfw\/jyxx\/jsgc\/zbzgysgg\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const dm = row.match(/(?:19|20)\d{2}-\d{2}-\d{2}/);
    if (!am || !dm) continue;
    const title = htmlToText(am[2]).trim();
    if (!title || SECOND_BATCH_NON_ZB.test(title)) continue;
    const area = title.match(/【([^】]{2,20})】/)?.[1] || extractKnownArea(title) || ad.cityName;
    out.push({ title, date: dm[0], url: normalizeHuizhouUrl(am[1]), cityHint: area });
  }
  return out;
}

function parseHuizhouSearchJsonp(payload, ad) {
  const raw = String(payload || "").trim();
  const jsonText = raw.match(/^[^(]+\(([\s\S]*)\)\s*;?$/)?.[1] || raw;
  const j = JSON.parse(jsonText);
  const rows = Array.isArray(j.results) ? j.results : [];
  const categoryArea = {
    "31261": "惠州市", "31263": "惠阳区", "31264": "惠东县", "31265": "仲恺区",
    "31266": "博罗县", "31267": "大亚湾区", "31268": "龙门县", "36676": "惠城区",
  };
  return rows.map(it => {
    const title = htmlToText(String(it.title || "")).trim();
    const date = String(it.pub_time || "").match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0] || "";
    const url = normalizeHuizhouUrl(it.post_url || it.url || "");
    const bracketArea = title.match(/【([^】]{2,20})】/)?.[1] || "";
    return {
      title, date, url,
      cityHint: categoryArea[String(it.category || "")] || (/(?:施工|监理|试验检测|勘察设计|工程总承包|设备材料|其他)$/.test(bracketArea) ? "" : bracketArea) || extractKnownArea(title) || ad.cityName,
      _normal: String(it.post_type || "") === "normal",
      _abolished: Number(it.is_abolished || 0) === 1,
      _expired: Number(it.is_expired || 0) === 1,
      _category: String(it.category || ""),
    };
  }).filter(x => x.title && x.date && x.url && x._normal && !x._abolished && !x._expired
    && (ad.categoryIds || []).includes(x._category)
    && /招标公告/.test(x.title) && !SECOND_BATCH_NON_ZB.test(x.title));
}

async function huizhouList(ad, page, args) {
  const out = [];
  for (const categoryId of ad.categoryIds || []) {
    const qs = new URLSearchParams({
      text: args.keyword ? `'${args.keyword}'` : "", category_id: categoryId,
      position: "title", order: "1", page: String(Math.max(1, page)),
      pagesize: "20", callback: "__bid",
    });
    const payload = await requestWithRetry(`https://search.gd.gov.cn/jsonp/site/752376?${qs.toString()}`, args.delay);
    out.push(...parseHuizhouSearchJsonp(payload, ad).filter(item => !args.keyword || item.title.includes(args.keyword)));
  }
  const seen = new Set();
  return out.filter(item => !seen.has(item.url) && seen.add(item.url));
}

function parseZhongshanPayload(payload, ad) {
  const j = typeof payload === "string" ? JSON.parse(payload) : payload;
  const rows = j && j.data && Array.isArray(j.data.rows) ? j.data.rows : null;
  if (!rows) throw new Error("zhongshan invalid response structure");
  return rows.map(it => {
    const title = htmlToText(String(it.arab04 || "")).trim();
    const date = String(it.arab32 || it.arab25 || "").match(/(?:19|20)\d{2}-\d{2}-\d{2}/)?.[0] || "";
    return {
      title, date,
      url: it.arab01 ? `${ad.base}/artical/${ad.nodeId}/${it.arab01}` : "",
      cityHint: ad.cityName,
      _nodeId: String(it.arab02 || ""),
      _supplement: String(it.arab37 || "") === "1",
    };
  }).filter(x => x.title && x.date && x.url && x._nodeId === String(ad.nodeId) && !x._supplement && !SECOND_BATCH_NON_ZB.test(x.title));
}

function zhongshanControlPrice(text, fields) {
  const normalized = String(text || "").replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
  const direct = normalized.match(/本次投标总价最高投标限价为\s*(\d+(?:\.\d+)?)\s*(万元|元)/);
  if (direct) return direct[2] === "万元" ? String(Number(direct[1])) : String(Number((Number(direct[1]) / 10000).toFixed(6)));
  const section = normalized.match(/最高投标限价[\s\S]*?(?=是否接受联合体投标|投标资格能力要求|$)/)?.[0] || "";
  const fieldKey = Object.keys(fields || {}).find(key => /最高投标限价/.test(key));
  const formula = (section || String(fieldKey ? fields[fieldKey] : "")).replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
  const amounts = [...formula.matchAll(/(\d+(?:\.\d+)?)\s*(万元|元)/g)];
  if (!amounts.length) return "";
  const last = amounts[amounts.length - 1];
  return last[2] === "万元" ? String(Number(last[1])) : String(Number((Number(last[1]) / 10000).toFixed(6)));
}

function zhongshanDetail(html, item, pdfText) {
  const out = extractDetail({}, html, item, pdfText);
  const f = parseLabelTable(html);
  const text = htmlToText(html);
  out.projectSite = looseField(f, "招标项目实施（交货）地点", "项目实施（交货）地点");
  out.duration = looseField(f, "工期（交货期）", "工期");
  const qualification = looseField(f, "投标资格能力要求", "投标人资格要求", "投标资格能力要求（包括但不限于资质人员、业绩等要求）");
  if (qualification) out.qualification = qualification.slice(0, 500);
  out.controlPrice = zhongshanControlPrice(text, f) || out.controlPrice || "";
  out.docLink = "";
  out._attachNote = "招标文件下载需验证码，静态采集不绕过";
  return out;
}

async function zhongshanList(ad, page, args) {
  const body = new URLSearchParams({ nodeId: ad.nodeId, offset: String(Math.max(1, page)), limit: String(ad.rn || 15), gjz: args.keyword || "" });
  const r = await fetch(ad.base + "/pageList", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA_STR, "Referer": ad.referer, "X-Requested-With": "XMLHttpRequest" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("zhongshan HTTP " + r.status);
  return parseZhongshanPayload(await r.text(), ad);
}

function parseJinanPayload(payload, ad) {
  const j = typeof payload === "string" ? JSON.parse(payload) : payload;
  const html = j && j.success && j.params ? String(j.params.str || "") : "";
  if (!html) throw new Error("jinan invalid response structure");
  const out = [];
  for (const block of html.match(/<li\b[\s\S]*?<\/li>/gi) || []) {
    const area = block.match(/class=["']span1["'][^>]*>\s*\[([^\]]+)\]/i)?.[1] || "";
    const action = block.match(/showview\(\s*["']([A-Za-z0-9-]+)["']\s*,\s*([01])\s*,\s*["']([^"']+)["']/i);
    const title = htmlToText(block.match(/\btitle=["']([^"']+)["']/i)?.[1] || "").trim();
    const date = block.match(/class=["']span2["'][^>]*>\s*((?:19|20)\d{2}-\d{2}-\d{2})/i)?.[1] || "";
    if (!action || action[3] !== "招标公告" || !title || !date || SECOND_BATCH_NON_ZB.test(title)) continue;
    const cityHint = !area || area === "市本级" ? ad.cityName : area;
    const qs = new URLSearchParams({ iid: action[1], isnew: action[2], xuanxiang: "招标公告" });
    out.push({ title, date, cityHint, url: `${ad.base}/jnggzyztb/front/showNotice.do?${qs.toString()}` });
  }
  return out;
}

async function jinanList(ad, page, args) {
  const body = new URLSearchParams({ area: "", type: "0", xuanxiang: "招标公告", subheading: "", pagenum: String(Math.max(1, page)) });
  const r = await fetch(ad.base + "/jnggzyztb/front/search.do", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA_STR, "Referer": ad.referer, "X-Requested-With": "XMLHttpRequest" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("jinan HTTP " + r.status);
  const listed = parseJinanPayload(await r.text(), ad)
    .filter(item => !args.keyword || item.title.includes(args.keyword));
  const out = [];
  for (const item of listed) {
    const detailHtml = await requestWithRetry(item.url, args.delay);
    const detailTitle = jinanDetail(detailHtml, item, "").title || item.title;
    if (SECOND_BATCH_NON_ZB.test(detailTitle)) continue;
    out.push({ ...item, title: detailTitle, _detailHtml: detailHtml });
  }
  return out;
}

function parseWuhanHtml(html, ad) {
  const out = [];
  const seen = new Set();
  for (const block of String(html || "").match(/<li\b[^>]*onclick="[^"]*jygkgy\/\d+\.jhtml[^"]*"[^>]*>[\s\S]*?<\/li>/gi) || []) {
    const href = block.match(/https?:\/\/ggzyfw\.wuhan\.gov\.cn(?::80)?(\/whggzy\/jygkgy\/\d+\.jhtml)/i)?.[1] || "";
    const title = htmlToText(block.match(/<p\b[^>]*class=["']name["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || "").trim();
    const type = block.match(/信息类型：\s*<\/span>\s*<span[^>]*>([^<]+)</i)?.[1]?.trim() || "";
    const date = block.match(/发布时间：\s*<\/span>\s*<span[^>]*>\s*((?:19|20)\d{2}-\d{2}-\d{2})/i)?.[1] || "";
    const area = block.match(/信息来源：\s*<\/span>\s*<span[^>]*>([^<]+)</i)?.[1]?.trim() || "";
    if (!href || !title || !date || type !== "招标/资格预审公告" || SECOND_BATCH_NON_ZB.test(title)) continue;
    const key = `${date}|${area}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, date, cityHint: !area || area === "市级" ? ad.cityName : area, cityWeak: ad.cityName, url: ad.base + href });
  }
  return out;
}

async function wuhanList(ad, page, args) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  start.setDate(start.getDate() - Math.max(0, Number(args.days || 30) - 1));
  const qs = new URLSearchParams({
    title: args.keyword || "", channelId: "160",
    beginTime: localYmd(start), endTime: localYmd(end),
  });
  const path = page === 1 ? "/whggzy/queryContent-jygk.jspx" : `/whggzy/queryContent_${page}-jygk.jspx`;
  const listed = parseWuhanHtml(await requestWithRetry(`${ad.base}${path}?${qs.toString()}`, args.delay), ad);
  const out = [];
  for (const item of listed) {
    const detailHtml = await requestWithRetry(item.url, args.delay);
    const fields = parseLabelTable(detailHtml);
    if (/资格预审/.test(String(fields["对投标人资格审查方式"] || ""))) continue;
    out.push({ ...item, _detailHtml: detailHtml });
  }
  return out;
}

async function weifangList(ad, page, args) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  start.setDate(start.getDate() - Math.max(0, Number(args.days || 30) - 1));
  const body = new URLSearchParams({
    siteGuid: ad.siteGuid, categoryNum: ad.categoryNum, content: args.keyword || "",
    startDate: localYmd(start), endDate: localYmd(end),
    pageIndex: String(Math.max(0, page - 1)), pageSize: String(ad.rn || 20),
    YZM: "", ImgGuid: "", zbfs: "", qyfw: "",
  });
  const r = await fetch(ad.base + "/EpointWebBuilder/rest/secaction/getSecInfoListYzm", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA_STR, "Referer": ad.referer, "X-Requested-With": "XMLHttpRequest" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("weifang HTTP " + r.status);
  return parseWeifangList(await r.text(), ad);
}

function parseQingdaoHtml(html, ad) {
  const out = [];
  for (const row of String(html || "").match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    const a = row.match(/href=["']([^"']*TradeDetals-ZtbShow[^"']*)["'][^>]*title=["']([^"']+)["']/i);
    const dm = row.match(/(?:19|20)\d{2}-\d{2}-\d{2}/);
    if (!a || !dm) continue;
    const rowText = htmlToText(row);
    const area = rowText.match(/\[\s*([^\]]{1,20})\s*\]/)?.[1] || "青岛市";
    out.push({
      url: toAbs(a[1], ad.base), title: htmlToText(a[2]).trim(), date: dm[0], cityHint: area,
    });
  }
  return out;
}

async function qingdaoList(ad, page, args) {
  const qs = new URLSearchParams({ pageIndex: String(Math.max(1, page)) });
  if (args.keyword) qs.set("ProjectName", args.keyword);
  const days = Number(args.days || 30);
  if (days <= 30) qs.set("Time", "30");
  else if (days <= 90) qs.set("Time", "90");
  else if (days <= 300) qs.set("Time", "300");
  const html = await requestWithRetry(`${ad.base}/Tradeinfo-GGGSList/0-0-0?${qs.toString()}`, args.delay);
  return parseQingdaoHtml(html, ad);
}

function parseStrongTableFields(html) {
  const out = {};
  const re = /<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const key = htmlToText(m[1]).replace(/[：:]\s*$/, "").trim();
    const value = htmlToText(m[2]).trim();
    if (key && value && !out[key]) out[key] = value;
  }
  return out;
}

function exactMoneyWan(value) {
  const raw = String(value || "");
  const n = Number((raw.match(/[\d,.]+/)?.[0] || "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return "";
  return String(Number((/万元/.test(raw) ? n : n / 10000).toFixed(6)));
}

function cleanA3ScopeAmountTail(value) {
  return String(value || "")
    .replace(/\s*(?:本次招标)?(?:建安工程造价|最高投标限价|招标控制价|控制价)\s*[:：为约]?[\s\d,.万元元]+[。；;]?\s*$/i, "")
    .replace(/\s+\d{6,}(?:\.\d+)?\s*$/, "")
    .trim();
}

function cleanQingdaoPerformance(value, text) {
  const raw = String(value || "").trim();
  const source = String(text || "");
  if (/(?:本项目)?资格审查阶段无业绩要求|(?:本项目|投标人)?不要求(?:企业|类似)?业绩/.test(source)) return "不要求";
  if (/评审|评分因素|获得奖项|项目管理班子/.test(raw)) return "";
  return raw;
}

function qingdaoDetail(ad, html, item) {
  const out = extractDetail(ad, html, item, "");
  const f = parseStrongTableFields(html);
  const detailText = htmlToText(html);
  const pageTitle = String(html || "").match(/<div[^>]*class=["'][^"']*\btle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (pageTitle) out.title = htmlToText(pageTitle).replace(/招标公告\s*$/, "").trim();
  if (f["工程地点"]) out.projectSite = f["工程地点"];
  if (f["资金来源"]) out.funding = [f["资金来源"], f["出资比例"]].filter(Boolean).join("；");
  if (f["工程造价"]) out.controlPrice = exactMoneyWan(f["工程造价"]);
  if (f["本项目总投资额"]) out.budget = exactMoneyWan(f["本项目总投资额"]);
  if (f["工程规模"]) out.scale = f["工程规模"];
  if (f["计划文号"]) out.approval = f["计划文号"];
  if (f["招标单位"]) out.owner = f["招标单位"];
  if (f["招标代理单位"]) out.agency = f["招标代理单位"];
  if (f["招标代理项目负责人"]) out.manager = f["招标代理项目负责人"];
  if (f["招标单位联系人"]) out.contact = f["招标单位联系人"];
  if (f["招标单位联系电话"]) out.phone = f["招标单位联系电话"];
  if (f["项目统一代码（编码）"]) out.projectCode = f["项目统一代码（编码）"];
  out.scope = cleanA3ScopeAmountTail(out.scope);
  out.performance = cleanQingdaoPerformance(out.performance, detailText);
  out.duration = f["工期"] || ""; // 无精确字段时不保留通用解析器从违约条款误抓的句子
  return out;
}

function parseShenzhenList(payload, ad) {
  const data = payload && payload.data;
  const arr = data && Array.isArray(data.content) ? data.content : [];
  return arr.filter(it => String(it.noticeTypeName || "") === "招标公告").map(it => {
    const contentId = String(it.contentId || it.id || "");
    return {
      url: `${ad.base}/jygg/details.html?contentId=${encodeURIComponent(contentId)}&channelId=${encodeURIComponent(it.channelId || ad.channelId)}`,
      title: String(it.noticeTitle || it.title || it.projectName || "").trim(),
      date: String(it.releaseTime || it.publishTime || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "",
      cityHint: String(it.areaName || it.projectRegion || "深圳市").trim(),
      contentId,
      projectCode: String(it.bidSectionNumber || it.projectCode || "").trim(),
      owner: String(it.tenderer || it.tenderer2 || "").trim(),
      agency: String(it.proxyComName || "").trim(),
    };
  }).filter(x => x.contentId && x.title && x.date && isStrictZbTitle(x.title));
}

async function shenzhenPage(ad, start, end, page) {
  const r = await fetch(ad.base + "/cms/api/v1/trade/content/page", {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "User-Agent": UA_STR, "Referer": ad.referer, "Accept": "application/json, text/plain, */*" },
    body: JSON.stringify({
      channelId: ad.channelId, fields: null, title: "",
      releaseTimeBegin: `${localYmd(start)} 00:00:00`, releaseTimeEnd: `${localYmd(end)} 23:59:59`,
      parentBusinessType: "", page, size: ad.rn || 50, siteId: 1, jsgcProjectType: "",
    }),
  });
  if (!r.ok) throw new Error("shenzhen list HTTP " + r.status);
  const j = JSON.parse(await r.text());
  if (!j || Number(j.code) !== 200 || !j.data || !Array.isArray(j.data.content)) throw new Error("shenzhen invalid response structure");
  return j;
}

function shenzhenTarget(items, args) {
  return items.filter(it => (!args.keyword || it.title.includes(args.keyword))
    && matchesCityFilter(args.city, [it.cityHint, it.title]));
}

async function shenzhenWindow(ad, start, end, args, remaining) {
  const first = await shenzhenPage(ad, start, end, 0);
  const total = Number(first.data.totalElements || 0);
  const span = Math.round((end - start) / 86400000);
  // 官方对宽窗口把 totalElements 截断为 1000；递归拆窗后再分页，不能把 1000 当完整总数。
  if (total >= 1000 && span >= 1) {
    const mid = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    mid.setDate(mid.getDate() + Math.floor(span / 2));
    const newerStart = new Date(mid.getFullYear(), mid.getMonth(), mid.getDate());
    newerStart.setDate(newerStart.getDate() + 1);
    const newer = await shenzhenWindow(ad, newerStart, end, args, remaining);
    if (newer.length >= remaining) return newer;
    const older = await shenzhenWindow(ad, start, mid, args, remaining - newer.length);
    return newer.concat(older);
  }
  const out = shenzhenTarget(parseShenzhenList(first, ad), args);
  const totalPages = Math.min(20, Number(first.data.totalPages || 0));
  for (let p = 1; p < totalPages && out.length < remaining; p++) {
    await sleep(args.delay || 500);
    out.push(...shenzhenTarget(parseShenzhenList(await shenzhenPage(ad, start, end, p), ad), args));
  }
  return out.slice(0, remaining);
}

async function shenzhenList(ad, page, args) {
  if (page > 1) return [];
  const today = new Date();
  const endBoundary = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const cutoff = new Date(endBoundary);
  cutoff.setDate(cutoff.getDate() - Math.max(0, Number(args.days || 30) - 1));
  const limit = Number(args.limit || 0) > 0 ? Number(args.limit) : Number.MAX_SAFE_INTEGER;
  const out = [], seen = new Set();
  let end = new Date(endBoundary);
  while (end >= cutoff && out.length < limit) {
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    if (start < cutoff) start.setTime(cutoff.getTime());
    const chunk = await shenzhenWindow(ad, start, end, args, limit - out.length);
    for (const it of chunk) {
      if (!seen.has(it.contentId)) { seen.add(it.contentId); out.push(it); }
    }
    end = new Date(start);
    end.setDate(end.getDate() - 1);
  }
  return out;
}

function parseBgTableFields(html) {
  const out = {};
  const re = /<td(?=[^>]*class=["'][^"']*\bbg\b[^"']*["'])[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const key = htmlToText(m[1]).replace(/[：:]\s*$/, "").trim();
    const value = htmlToText(m[2]).trim();
    if (key && value && !out[key]) out[key] = value;
  }
  return out;
}

function shenzhenProjectContent(fields) {
  return {
    scale: cleanProjectContent(fields && fields["本次招标面积"] || ""),
    scope: cleanProjectContent(fields && fields["本次招标内容"] || ""),
  };
}

function qualitativeFullScore(evaluation, current = "") {
  return current || (/定性评审/.test(String(evaluation || "")) ? "不适用（定性评审）" : "");
}

async function shenzhenDetail(ad, item) {
  const r = await fetch(`${ad.base}/cms/api/v1/trade/content/detail?contentId=${encodeURIComponent(item.contentId)}`, {
    headers: { "User-Agent": UA_STR, "Referer": item.url || ad.referer, "Accept": "application/json, text/plain, */*" },
  });
  if (!r.ok) throw new Error("shenzhen detail HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const d = j && Number(j.code) === 200 ? j.data : null;
  if (!d || !d.txt) throw new Error("shenzhen invalid detail structure");
  const noticeType = (Array.isArray(d.attrs) ? d.attrs : []).find(x => x.attrName === "jygg_gglxmc")?.attrValue;
  if (noticeType && noticeType !== "招标公告") throw new Error("shenzhen detail stage mismatch: " + noticeType);
  const out = extractDetail(ad, d.txt, item, "");
  const f = parseBgTableFields(d.txt);
  out.title = String(d.title || item.title || out.title || "").trim();
  if (item.owner) out.owner = item.owner;
  if (item.agency) out.agency = item.agency;
  if (item.projectCode) out.projectCode = item.projectCode;
  // 深圳表格把“本次招标内容/面积”的空单元格保留为标签；通用正文扫描会把下一个标签
  // “本次招标面积”误当 scope。项目内容只认这两个结构化单元格，空就是源页未披露。
  const projectContent = shenzhenProjectContent(f);
  out.scope = projectContent.scope;
  out.scale = projectContent.scale;
  if (f["工程地址"]) out.projectSite = f["工程地址"];
  if (f["投标文件递交截止时间"]) out.bidOpen = f["投标文件递交截止时间"].slice(0, 16);
  if (f["计划工期"]) out.duration = f["计划工期"];
  if (f["本次发包工程估价"]) out.controlPrice = exactMoneyWan(f["本次发包工程估价"]);
  if (f["计划总投资"]) out.budget = exactMoneyWan(f["计划总投资"]);
  if (f["投标保证金"]) out.bond = exactMoneyWan(f["投标保证金"]);
  if (f["拟采用评标方法"]) out.evaluation = f["拟采用评标方法"];
  out.fullScore = qualitativeFullScore(out.evaluation, out.fullScore);
  if (f["是否接受联合体投标"]) out.consortium = f["是否接受联合体投标"];
  if (f["投标人资质要求"] || f["其他资质要求"]) out.qualification = [f["投标人资质要求"], f["其他资质要求"]].filter(Boolean).join("；");
  if (f["投标申请人应当具有的同类工程经验要求"]) out.performance = /^(?:无|不要求)$/.test(f["投标申请人应当具有的同类工程经验要求"]) ? "不要求" : f["投标申请人应当具有的同类工程经验要求"];
  const doc = [...String(d.txt).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .find(m => /招标(?:公告|文件)/.test(htmlToText(m[2])) && /unified_download|\.pdf(?:$|[?&#])/i.test(m[1]));
  out.docLink = doc ? doc[1].replace(/&amp;/g, "&") : "";
  return out;
}

// 临沂/烟台共用：山东系 SSR 壳 + 标准 EPoint 后端，响应为 {code, content:"JSON字符串"} 双层包装（须二次 JSON.parse）
function isAllowedSdWrapRecord(ad, it) {
  if (!Array.isArray(ad.allowedCategoryNums) || !ad.allowedCategoryNums.length) return true;
  return ad.allowedCategoryNums.includes(String(it.categorynum || "").trim());
}

async function sdWrapList(ad, page, args, cats) {
  const rn = ad.rn || 20;
  const body = {
    token: "", pn: (page - 1) * rn, rn: String(rn), wd: args.keyword || "", cl: 200,
    sort: JSON.stringify({ webdate: "0", id: "0" }),
    condition: (cats && cats.length)
      ? [{ fieldName: "categorynum", isLike: true, likeType: 2, equal: cats[0] }]
      : null,
  };
  const r = await fetch(ad.base + EPOINT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=utf-8", "User-Agent": UA_STR, "Referer": ad.referer || (ad.base + "/") },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("sdwrap HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const inner = (typeof j.content === "string") ? JSON.parse(j.content) : j;   // 双层包装剥壳
  const recs = (inner && inner.result && inner.result.records) || [];
  return recs.filter(it => isAllowedSdWrapRecord(ad, it)).map(it => {
    const m = String(it.webdate || "").match(/(\d{4}-\d{2}-\d{2})/);
    return {
      url: it.linkurl ? toAbs(String(it.linkurl), ad.base) : "",
      title: htmlToText(String(it.titlenew || it.title || "")).trim(),
      date: m ? m[1] : "",
      cityHint: String(it.xiaquname || it.zhuanzai || "").trim(),
      categorynum: String(it.categorynum || "").trim(),
    };
  }).filter(x => x.title);
}

// 无锡：webBuilder 壳 + /info_open JSON（无服务端关键词 → clientFilterOnly）
async function wuxiList(ad, page, args) {
  const body = new URLSearchParams({ chanId: ad.chanId || "53051", jyly: "", pageIndex: String(page), pageSize: "20" });
  const r = await fetch(ad.base + "/info_open/searchPublicResource", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": UA_STR, "Referer": ad.referer || (ad.base + "/"), "X-Requested-With": "XMLHttpRequest" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error("wuxi HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const arr = (j && j.data && Array.isArray(j.data.data)) ? j.data.data : [];
  return arr.map(it => {
    const m = String(it.writeTime || "").match(/(\d{4}-\d{2}-\d{2})/);
    return { url: String(it.url || "").replace(/^http:/, "https:"), title: String(it.title || "").trim(), date: m ? m[1] : "" };
  }).filter(x => x.title);
}

// 泉州：Java .do（全站 http 协议；projName 服务端过滤实测无效 → clientFilterOnly；keepScheme 保 http）
async function quanzhouList(ad, page, args) {
  const r = await fetch(ad.base + "/project/getProjPage_project.do", {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "User-Agent": UA_STR, "Referer": ad.referer || (ad.base + "/"), "X-Requested-With": "XMLHttpRequest" },
    body: JSON.stringify({ pageIndex: page, pageSize: 10, classId: 0, centerId: 0, projNo: "", projName: "", ownerDeptName: "" }),
  });
  if (!r.ok) throw new Error("quanzhou HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const arr = (j && j.data && Array.isArray(j.data.dataList)) ? j.data.dataList : [];
  return arr.map(it => {
    const m = String(it.auditDate || "").match(/(\d{4}-\d{2}-\d{2})/);
    return { url: it.projId ? (ad.base + "/project/projectInfo.do?projId=" + it.projId) : "", title: String(it.projName || "").trim(), date: m ? m[1] : "" };
  }).filter(x => x.title);
}

// 岳阳：静态发布 CMS（GBK 编码；JSP pager.offset 分页；无服务端关键词 → clientFilterOnly）
async function yueyangList(ad, page, args) {
  const url = (page === 1)
    ? "https://ggzy.yueyang.gov.cn/56114/56125/56126/index.htm"
    : "https://ggzy.yueyang.gov.cn/ggzy/56114/56125/56126/index.jsp?pager.offset=" + ((page - 1) * 20) + "&pager.desc=false";
  const r = await fetch(url);
  if (!r.ok) throw new Error("yueyang HTTP " + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const html = new TextDecoder("gbk").decode(buf);   // 岳阳全站 GBK（Node full-icu 支持）
  const items = [];
  const liRe = /<li>[\s\S]*?<\/li>/g;
  const aRe = /<a[^>]*href='([^']+)'[^>]*title='([^']+)'[^>]*>/;
  const dRe = /(\d{4}-\d{2}-\d{2})/;
  let lm;
  while ((lm = liRe.exec(html))) {
    const am = lm[0].match(aRe);
    if (!am) continue;
    const dm = lm[0].match(dRe);
    items.push({ url: "https://ggzy.yueyang.gov.cn/56114/56125/56126/" + am[1], title: am[2].trim(), date: dm ? dm[1] : "" });
  }
  return items.filter(x => x.title);
}

// 遵义：贵州省平台 bespoke REST + docSourceName=遵义市 视角过滤（docRelTime=毫秒时间戳）
async function zunyiList(ad, page, args) {
  const r = await fetch("https://ggzy.guizhou.gov.cn/tradeInfo/es/list", {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", "User-Agent": UA_STR, "Referer": "https://ggzy.guizhou.gov.cn/xxfw/gcjs/" },
    body: JSON.stringify({ channelId: "5904475", pageNum: page, pageSize: 20, docSourceName: "遵义市", docTitle: args.keyword || "" }),
  });
  if (!r.ok) throw new Error("zunyi HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const arr = Array.isArray(j.list) ? j.list : [];
  return arr.filter(it => isZunyiTenderRecord(it)).map(it => {
    const d = it.docRelTime ? new Date(Number(it.docRelTime)).toISOString().slice(0, 10) : "";
    return { url: String(it.apiUrl || ""), title: String(it.docTitle || "").trim(), date: d };
  }).filter(x => x.title);
}

function isZunyiTenderRecord(it) {
  // channelId=5904475 是工程建设大类，announcement 才是官方阶段字段。
  // 只收“交易公告”；变更公告（澄清与答疑）、中标、合同、异常等均不属于本 Skill 的 zb 范围。
  return String(it && it.announcement || "").trim() === "交易公告";
}

// 合肥：官方 webBuilder Service。该中心同时承载少量省级集团异地项目，故不能仅凭来源站
// 就把每条都标成合肥；列表层必须再用项目标题中的合肥行政区实体做城市真实性守卫。
const HEFEI_AREA_RE = /合肥|肥东|肥西|长丰|庐江|巢湖|瑶海|庐阳|蜀山|包河|高新(?:区)?|经开(?:区)?|新站(?:区|高新区)?/;
function isHefeiCityRecord(it) {
  return String(it && it.categorynum || "") === "002001001" && HEFEI_AREA_RE.test(String(it && it.title || ""));
}

async function hefeiList(ad, page, args) {
  const qs = new URLSearchParams({
    pageIndex: String(page), pageSize: "20", siteguid: ad.siteGuid,
    Categorynum: ad.categoryNum, infoC: "", title: args.keyword || "",
    ggstartdate: "", ggenddate: "", zhaobiaofangshi: "", projectno: "", hangye: "", quyu: "",
  });
  const r = await fetch(ad.base + "/EpointWebBuilderService/hfggzyGetGgInfo.action?cmd=getinfojyxxlistZfcg&" + qs.toString(), {
    headers: { "User-Agent": UA_STR, "Referer": ad.referer, "X-Requested-With": "XMLHttpRequest" },
  });
  if (!r.ok) throw new Error("hefei HTTP " + r.status);
  const outer = JSON.parse(await r.text());
  const inner = typeof outer.custom === "string" ? JSON.parse(outer.custom) : outer.custom;
  const arr = inner && Array.isArray(inner.infoList) ? inner.infoList : [];
  return arr.filter(isHefeiCityRecord).map(it => {
    const date = String(it.infodate2 || it.infodate || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
    const day = date.replace(/-/g, "");
    return {
      url: it.infoid && day ? `${ad.base}/jyxx/002001/002001001/${day}/${it.infoid}.html` : "",
      title: String(it.title || "").trim(), date,
      cityHint: String(it.infod || "").trim(),
      projectCode: String(it.projectno || "").trim(),
      method: String(it.zhaobiaofangshi || "").trim(),
      categorynum: String(it.categorynum || "").trim(),
    };
  }).filter(x => x.title && x.url);
}

function parseWenzhouCmsList(html, ad) {
  const out = [];
  const liRe = /<li\b[^>]*class=["'][^"']*\bcf\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let lm;
  while ((lm = liRe.exec(String(html || "")))) {
    const am = lm[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const dm = lm[1].match(/(?:19|20)\d{2}-\d{2}-\d{2}/);
    if (!am || !dm) continue;
    const title = htmlToText(am[2]).replace(/^\s*[•·]\s*/, "").trim();
    if (title.length < 4) continue;
    const href = am[1].replace(/&amp;/gi, "&");
    out.push({
      url: toAbs(href, ad.base),
      title,
      date: dm[0],
      cityHint: extractKnownArea(title) || extractCity(title),
    });
  }
  return out;
}

function parseJiaxingCmsList(html, ad) {
  const out = [];
  const liRe = /<li\b[^>]*class=["'][^"']*\bwb-data-list\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let lm;
  while ((lm = liRe.exec(String(html || "")))) {
    const am = lm[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const dm = lm[1].match(/(?:19|20)\d{2}-\d{2}-\d{2}/);
    if (!am || !dm) continue;
    const title = htmlToText(am[2]).trim();
    if (title.length < 4) continue;
    out.push({
      url: toAbs(am[1].replace(/&amp;/gi, "&"), ad.base),
      title, date: dm[0],
      cityHint: extractKnownArea(title) || extractCity(title) || "嘉兴市",
    });
  }
  return out;
}

function ningboVisitorToken(at = new Date()) {
  // 官网 login chunk 的 getDate()：北京时间 `YYYY-MM-DD H:mm:ss` → Base64 → Base64。
  // 显式用 UTC+8，避免采集机不在中国时区时生成无效 token。
  const d = new Date(at.getTime() + 8 * 3600000);
  const pad = n => String(n).padStart(2, "0");
  const raw = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${d.getUTCHours()}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return Buffer.from(Buffer.from(raw, "utf8").toString("base64"), "utf8").toString("base64");
}

const NINGBO_AREA_NAME = {
  本级: "宁波市", 海曙: "海曙区", 江北: "江北区", 镇海: "镇海区", 北仑: "北仑区",
  鄞州: "鄞州区", 奉化: "奉化区", 余姚: "余姚市", 慈溪: "慈溪市", 宁海: "宁海县",
  象山: "象山县", 前湾: "前湾新区", 高新: "高新区",
};

function ningboHeaders(ad) {
  return {
    "Content-Type": "application/json;charset=UTF-8", "User-Agent": UA_STR,
    "Referer": ad.referer, "token": ningboVisitorToken(),
  };
}

function parseNingboList(payload, ad) {
  const arr = payload && Array.isArray(payload.list) ? payload.list : [];
  return arr.filter(it => String(it.channel || "") === ad.channel).map(it => {
    const title = String(it.title || "").trim();
    const date = String(it.publish_START_TIME || it.publishing_TIME || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
    const areaShort = String(it.area_SHORT_NAME || "").trim();
    const qs = new URLSearchParams({
      article_ID: String(it.article_ID || ""), code: String(it.channel || ad.channel),
      project_ID: String(it.project_ID || ""), project_NO: String(it.project_NO || ""),
      isShowTypeSteps: "true",
    });
    return {
      url: `${ad.base}/website/announcementDetails?${qs.toString()}`,
      title, date,
      cityHint: NINGBO_AREA_NAME[areaShort] || extractKnownArea(title) || (areaShort ? areaShort : "宁波市"),
      articleId: String(it.article_ID || ""), projectId: String(it.project_ID || ""),
      projectCode: String(it.project_NO || ""), channel: String(it.channel || ad.channel),
    };
  }).filter(x => x.title && x.date && x.articleId && x.projectId);
}

async function ningboList(ad, page, args) {
  const r = await fetch(ad.base + "/websiteapi/articleList", {
    method: "POST", headers: ningboHeaders(ad),
    body: JSON.stringify({
      PUBLISHING_TIME_BEGIN: "", PUBLISHING_TIME_END: "", AREA_CODE: "",
      PROJECT_TYPE_ID: ad.projectType, TITLE: args.keyword || "", CHANNEL: ad.channel,
      page, pagesize: ad.rn || 12,
    }),
  });
  if (!r.ok) throw new Error("ningbo articleList HTTP " + r.status);
  return parseNingboList(JSON.parse(await r.text()), ad);
}

function ningboFileUrl(ad, path) {
  const raw = String(path || "");
  const suffix = raw.includes("/profile") ? raw.split("/profile")[1] : raw;
  return suffix ? ad.base + "/prod-api/profile" + (suffix.startsWith("/") ? suffix : "/" + suffix) : "";
}

function ningboSegmentControlPrice(detailText) {
  const segmentCosts = [];
  for (const m of String(detailText || "").matchAll(/([ⅠⅡⅢⅣⅤⅥ一二三四五六]+标段)范围[:：][\s\S]{0,300}?建安工程造价约?\s*([\d,.]+)\s*元/g)) {
    const yuan = Number(String(m[2]).replace(/,/g, ""));
    if (Number.isFinite(yuan)) segmentCosts.push(`${m[1]}${Number((yuan / 10000).toFixed(6))}`);
  }
  return segmentCosts.length > 1 ? segmentCosts.join("；") : "";
}

function ningboExactDuration(detailText) {
  return String(detailText || "").match(/(?:计划工期|工期要求|总工期)\s*[:：]?\s*(?:为\s*)?(\d+(?:\.\d+)?\s*(?:个日历天|日历天|天|个月|月|年))/)?.[1] || "";
}

async function ningboDetail(ad, item) {
  const qs = new URLSearchParams({ projectid: item.projectId, channel: item.channel || ad.channel, articeid: item.articleId });
  const r = await fetch(ad.base + "/websiteapi/getArticle/?" + qs.toString(), { headers: ningboHeaders(ad) });
  if (!r.ok) throw new Error("ningbo getArticle HTTP " + r.status);
  const arr = JSON.parse(await r.text());
  const d = Array.isArray(arr) ? arr[0] : arr;
  if (!d || String(d.channel || "") !== ad.channel) throw new Error("ningbo detail channel mismatch");
  // 平台 content 内保留大量旧模板 HTML 注释；先删注释，避免未选中的资质/联合体/开标块污染抽取。
  const content = String(d.content || "").replace(/<!--[\s\S]*?-->/g, "");
  const out = extractDetail(ad, content, item, "");
  out.scope = cleanA3ScopeAmountTail(out.scope);
  const detailText = htmlToText(content);
  out.duration = ningboExactDuration(detailText);
  // 宁波多标段公告会在同一项目页逐段披露建安造价；只取首个数字会把其余标段静默丢失。
  // 单标段继续保持原数值形态，多标段才写成带标段名的可审计文本。
  const segmentControlPrice = ningboSegmentControlPrice(detailText);
  if (segmentControlPrice) out.controlPrice = segmentControlPrice;
  // 合并项目可能有多组资金来源；逐组保留，避免只报告第一个子项目。
  const fundingSources = [...detailText.matchAll(/建设资金来\s*自\s*([^，。；]{2,100})[，,]\s*出资比例/g)]
    .map(m => m[1].trim()).filter((v, i, a) => v && a.indexOf(v) === i);
  if (fundingSources.length > 1) out.funding = fundingSources.join("；");
  const files = Array.isArray(d.files) ? d.files : [];
  const tenderFile = files.find(f => /招标文件/.test(String(f.file_origin_name || "")))
    || files.find(f => /招标公告/.test(String(f.file_origin_name || "")));
  out.docLink = tenderFile ? ningboFileUrl(ad, tenderFile.file_path) : out.docLink;
  out.title = String(d.title || out.title || item.title).trim();
  out.owner = String(d.owner_NAME || out.owner || "").trim();
  out.projectCode = String(d.project_NO || out.projectCode || item.projectCode || "").trim();
  const areaCode = String(d.area_CODE || "");
  const codeName = { "330201":"宁波市", "330203":"海曙区", "330205":"江北区", "330211":"镇海区", "330206":"北仑区", "330212":"鄞州区", "330213":"奉化区", "330281":"余姚市", "330282":"慈溪市", "330226":"宁海县", "330225":"象山县", "330232":"前湾新区", "330231":"高新区" }[areaCode];
  if (!out.projectSite && codeName) out.projectSite = codeName;
  return out;
}

// 温州：JPaas CMS AuthorizedRead 匿名列表。pageId 锁定温州市主站「招标公告」，
// paramJson 只负责分页；关键词由 collectProvince 在客户端筛选，避免错误依赖未公开的搜索 schema。
async function wenzhouList(ad, page, args) {
  const qs = new URLSearchParams({
    parseType: "bulidstatic", webId: ad.webId, tplSetId: ad.tplSetId,
    pageType: "column", tagId: ad.tagId, editType: "null", pageId: ad.pageId,
    paramJson: JSON.stringify({ pageNo: page, pageSize: ad.rn || 10, search: JSON.stringify("") }),
  });
  const r = await fetch(ad.base + "/api-gateway/jpaas-publish-server/front/page/build/unit?" + qs.toString(), {
    headers: { "User-Agent": UA_STR, "Referer": ad.referer, "Accept": "application/json, text/plain, */*" },
  });
  if (!r.ok) throw new Error("wenzhou HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const html = j && j.success && j.data ? String(j.data.html || "") : "";
  if (!html) throw new Error("wenzhou CMS empty response");
  return parseWenzhouCmsList(html, ad);
}

async function jiaxingList(ad, page, args) {
  const qs = new URLSearchParams({
    parseType: "bulidstatic", webId: ad.webId, tplSetId: ad.tplSetId,
    pageType: "column", tagId: ad.tagId, editType: "null", pageId: ad.pageId,
    paramJson: JSON.stringify({ pageNo: page, pageSize: ad.rn || 18, search: JSON.stringify("") }),
  });
  const r = await fetch(ad.base + "/api-gateway/jpaas-publish-server/front/page/build/unit?" + qs.toString(), {
    headers: { "User-Agent": UA_STR, "Referer": ad.referer, "Accept": "application/json, text/plain, */*" },
  });
  if (!r.ok) throw new Error("jiaxing HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const html = j && j.success && j.data ? String(j.data.html || "") : "";
  if (!html) throw new Error("jiaxing CMS empty response");
  return parseJiaxingCmsList(html, ad);
}

// 宜宾：筑龙 SPA 统一网关 action RPC（xinXi_LeiXing=102 招标公告；详情为 SPA hash 无直链 → 部分 gongGao_URL 外链可用）
async function yibinList(ad, page, args) {
  const r = await fetch(ad.base + "/ggfwptwebapi/Web/service", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": UA_STR, "Referer": (ad.base + "/") },
    body: JSON.stringify({ action: "pageTongYong_SouSuo", title: args.keyword || "", pageIndex: page, pageSize: 20, xiangMu_LeiXing: null, xinXi_LeiXing: "102" }),
  });
  if (!r.ok) throw new Error("yibin HTTP " + r.status);
  const j = JSON.parse(await r.text());
  const arr = Array.isArray(j.data) ? j.data : [];
  return arr.map(it => {
    const m = String(it.publish_StartTime || "").match(/(\d{4}-\d{2}-\d{2})/);
    return { url: it.gongGao_URL ? String(it.gongGao_URL) : "", title: String(it.zhaoBiao_XiangMu_Name || "").trim(), date: m ? m[1] : "" };
  }).filter(x => x.title);
}

function ygpDateStamp(date, endOfDay) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, "0"), d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}${endOfDay ? "235959" : "000000"}`;
}

function buildYgpDetailUrl(rr) {
  const edition = String(rr && rr.edition || "").trim();
  const tradingType = String(rr && rr.noticeSecondType || "").trim();
  const noticeId = String(rr && rr.noticeId || "").trim();
  const projectCode = String(rr && rr.projectCode || "").trim();
  const bizCode = String(rr && rr.tradingProcess || "").trim();
  const siteCode = String(rr && (rr.regionCode || rr.siteCode) || "").trim();
  const classify = String(rr && rr.projectType || "").trim();
  if (!edition || !tradingType || !noticeId || !projectCode || !bizCode || !siteCode || !classify) return "";
  const q = new URLSearchParams({
    noticeId, projectCode, bizCode, siteCode,
    publishDate: String(rr.publishDate || ""),
    source: String(rr.pubServicePlat || "广东省公共资源交易平台"),
    titleDetails: String(rr.noticeSecondTypeDesc || "工程建设"),
    classify,
  });
  return `https://ygp.gdzwfw.gov.cn/ggzy-portal/#/new/jygg/${encodeURIComponent(edition)}/${encodeURIComponent(tradingType)}?${q.toString()}`;
}

function parseYgpListRows(rows, ad) {
  const all = [];
  for (const rr of Array.isArray(rows) ? rows : []) {
    const title = String(rr.noticeTitle || "").replace(/<\/?em[^>]*>/gi, "").trim();
    if (!title) continue;
    if (!ad.stageKey) {
      if (String(rr.tradingProcess || "") !== "3C14") continue;
      if (String(rr.noticeNature || "") !== "正常公告") continue;
      if (/资格预审|资审公告|补充公告|更正公告|澄清|答疑|延期|终止|流标|废标|中标候选|中标结果/.test(title)) continue;
    }
    const d = String(rr.publishDate || "");
    const date = d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "";
    all.push({
      url: buildYgpDetailUrl(rr),
      title,
      date,
      cityHint: rr.siteName || rr.regionName || "",
      cityWeak: rr.regionName || "",
      summary: "",
      _ygpRow: rr,
      ...mapYgpRow(rr),
    });
  }
  return all;
}

async function ygpFetchPage(siteCode, secondType, keyword, pn, tradingProcess, args, ad) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  start.setDate(start.getDate() - Math.max(0, Number(args.days || 30) - 1));
  const body = {
    type: "trading-type", openConvert: false,
    keyword: keyword || "",
    siteCode, secondType,
    tradingProcess: tradingProcess || "", thirdType: "[]", projectType: ad.projectType || "",
    publishStartTime: ygpDateStamp(start, false), publishEndTime: ygpDateStamp(end, true),
    pageNo: pn, pageSize: 50,
  };
  for (let attempt = 0; attempt <= 6; attempt++) {
    if (_ygpDelay > 0) await sleep(_ygpDelay);
    let r;
    try {
      r = await fetch(YGP_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA_STR, "Referer": "https://ygp.gdzwfw.gov.cn/", "Accept": "application/json, text/plain, */*" },
        body: JSON.stringify(body),
      });
    } catch (e) { if (attempt === 6) throw e; await sleep(Math.min(8000, 500 * 2 ** attempt)); continue; }
    if (r.status === 429) {
      // 粤公平 429 常伴 errmsg「访问频率过高，请60秒后重试」——务必按服务端冷却时长等待，
      // 否则 4s 封顶会反复撞墙（IP 级限流一旦触发需整段冷却，短间隔只会续期限流）。
      let cooldown = 60000;
      try {
        const b = await r.json().catch(() => null);
        if (b && b.errmsg) { const m = String(b.errmsg).match(/(\d+)\s*秒/); if (m) cooldown = Math.max(cooldown, parseInt(m[1], 10) * 1000); }
      } catch { /* 忽略解析失败 */ }
      if (cooldown > _ygpDelay) _ygpDelay = cooldown;
      if (global.__RUN_REPORT) global.__RUN_REPORT.rate_limits.push({ status: 429, cooldown_ms: cooldown, source: "ygp" });
      // 粤公平明确要求 60 秒级冷却时，本次 CLI 立即留下 FAILED sidecar，不在同一进程内
      // 连续等待/重打七次。后续独立运行由调度层决定，避免一次省级测试挂住数分钟并续期限流。
      console.error("[ygp] 429 限流 → 记录冷却 %dms，本次停止", cooldown);
      throw new Error(`HTTP 429（建议冷却 ${cooldown}ms 后再运行）`);
    }
    if (r.status >= 500) { if (attempt === 6) throw new Error("HTTP " + r.status); await sleep(Math.min(8000, 500 * 2 ** attempt)); continue; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const raw = typeof r.arrayBuffer === "function" ? Buffer.from(await r.arrayBuffer()).toString("utf8") : await r.text();
    const j = JSON.parse(raw);
    if (j.errcode !== 0) throw new Error("API errcode=" + j.errcode + " " + j.errmsg);
    if (_ygpDelay > 0) _ygpDelay = Math.max(0, Math.floor(_ygpDelay * 0.85)); // 成功后缓慢回落，避免单次抖动永久拖慢整轮
    return (j.data && j.data.pageData) || [];
  }
  return [];
}
async function ygpList(ad, page, args) {
  // 框架按 page 分页；粤公平"全省"需逐地市聚合，故 page1 一次性取回全部地市数据，page>1 返回空（防重复）
  if (page > 1) return [];
  const cities = resolveYgpCityTargets(args);
  const all = [];
  for (const city of cities) {
    for (let pn = 1; pn <= 20; pn++) {
      const rows = await ygpFetchPage(city.code, ad.category || "A", args.keyword || "", pn, ad.tradingProcess || "", args, ad);
      if (!rows.length) break;
      all.push(...parseYgpListRows(rows, ad));
      if (hasReachedLimit(all.length, args.limit)) return all;
      if (rows.length < 50) break;
    }
  }
  return all;
}

const YGP_DETAIL_API = "https://ygp.gdzwfw.gov.cn/ggzy-portal/center/apis/trading-notice/new";
const YGP_FILE_API = "https://ygp.gdzwfw.gov.cn/ggzy-portal/base/sys-file/download";

function unwrapYgpPayload(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "errcode")) {
    if (Number(value.errcode) !== 0) throw new Error(`YGP errcode=${value.errcode} ${value.errmsg || ""}`);
    return value.data;
  }
  return value;
}

function parseYgpJsonText(raw) {
  const text = String(raw || "").trim();
  if (/^\d{15,}$/.test(text)) return text; // nodeId 超过 JS safe integer，必须保留原始十进制字符串
  return unwrapYgpPayload(JSON.parse(text));
}

async function ygpGetJson(url, source = "ygp-detail") {
  if (_ygpDelay > 0) await sleep(Math.min(_ygpDelay, 3000));
  const r = await fetch(url, { headers: { "User-Agent": UA_STR, "Referer": "https://ygp.gdzwfw.gov.cn/", "Accept": "application/json, text/plain, */*" } });
  const raw = typeof r.arrayBuffer === "function" ? Buffer.from(await r.arrayBuffer()).toString("utf8") : await r.text();
  if (r.status === 429) {
    if (global.__RUN_REPORT) global.__RUN_REPORT.rate_limits.push({ status: 429, source });
    throw new Error(`${source} HTTP 429`);
  }
  if (!r.ok) throw new Error(`${source} HTTP ${r.status}`);
  return parseYgpJsonText(raw);
}

function ygpNormalizeHtml(html) {
  return String(html || "")
    .replace(/&#x0*d;|&#13;/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'");
}

function ygpTablePairs(html) {
  const out = {};
  for (const rows of tableRows(html || "")) {
    for (const row of rows) {
      for (let i = 0; i < row.length - 1; i++) {
        const label = String(row[i] || "").replace(/[：:]$/, "").replace(/\s+/g, "").trim();
        if (!label) continue;
        const value = String(row[i + 1] || "").replace(/\s+/g, " ").trim();
        if (value && !out[label]) out[label] = value;
      }
    }
  }
  return out;
}

function ygpPair(pairs, labels) {
  for (const label of labels) {
    if (pairs[label]) return pairs[label];
    const key = Object.keys(pairs).find((k) => k.includes(label));
    if (key && pairs[key]) return pairs[key];
  }
  return "";
}

function ygpFileExt(name) {
  return ((String(name || "").match(/\.(pdf|docx|doc|zip)$/i) || [])[1] || "").toLowerCase();
}

function selectYgpTenderAttachment(sections, row) {
  const files = (Array.isArray(sections) ? sections : []).flatMap((s) => Array.isArray(s.noticeFileBOList) ? s.noticeFileBOList : []);
  const candidates = files.filter((f) => /招标文件|采购文件/.test(String(f.fileName || "")) && ygpFileExt(f.fileName));
  const rank = { pdf: 0, docx: 1, doc: 2, zip: 3 };
  candidates.sort((a, b) => (rank[ygpFileExt(a.fileName)] ?? 9) - (rank[ygpFileExt(b.fileName)] ?? 9));
  const chosen = candidates[0];
  if (!chosen || !chosen.rowGuid) return { chosen: null, candidates: files.map((f) => ({ fileName: f.fileName || "", rowGuid: f.rowGuid || "", flowId: f.flowId || "" })) };
  const edition = String(row.edition || "v3");
  const flowId = String(chosen.flowId || "");
  const encoded = encodeURIComponent(String(chosen.rowGuid));
  return {
    chosen: {
      fileName: String(chosen.fileName || ""), rowGuid: String(chosen.rowGuid), flowId, edition,
      downloadUrl: `${YGP_FILE_API}/${encodeURIComponent(edition)}/${encoded}?${encodeURIComponent(flowId)}`,
      sizeUrl: `${YGP_FILE_API}/size/${encodeURIComponent(edition)}/${encoded}?${encodeURIComponent(flowId)}`,
      precheckUrl: `${YGP_FILE_API}/precheck/${encoded}`,
    },
    candidates: candidates.map((f) => ({ fileName: f.fileName || "", rowGuid: f.rowGuid || "", flowId: f.flowId || "", ext: ygpFileExt(f.fileName) })),
  };
}

function parseYgpDetailPayload(data, row, ad, item) {
  const sections = data && Array.isArray(data.tradingNoticeColumnModelList) ? data.tradingNoticeColumnModelList : [];
  const html = ygpNormalizeHtml(sections.map((s) => s.richtext || "").filter(Boolean).join("\n"));
  const generic = extractDetail(ad, html, item || { title: data && data.title || row.noticeTitle || "", url: buildYgpDetailUrl(row) }, "");
  const pairs = ygpTablePairs(html);
  const attachment = selectYgpTenderAttachment(sections, row);
  const out = {
    ...generic,
    title: String(data && data.title || generic.title || row.noticeTitle || "").trim(),
    projectCode: String(row.projectCode || generic.projectCode || ""),
    projectSite: ygpPair(pairs, ["招标项目实施（交货）地点", "工程地点", "建设地点"]) || generic.projectSite || "",
    bidOpen: ygpPair(pairs, ["开标时间", "投标文件截止时间"]) || generic.bidOpen || "",
    funding: ygpPair(pairs, ["资金来源"]) || generic.funding || "",
    duration: ygpPair(pairs, ["工期（交货期）", "计划工期", "工期"]) || generic.duration || "",
    qualification: ygpPair(pairs, ["投标人资格要求", "投标资格能力要求（包括但不限于资质人员、业绩等要求）"]) || generic.qualification || "",
    performance: ygpPair(pairs, ["投标人业绩要求", "业绩要求"]) || generic.performance || "",
    consortium: ygpPair(pairs, ["是否接受联合体投标"]) || generic.consortium || "",
    owner: String(row.projectOwner || ygpPair(pairs, ["招标人（异议受理部门）", "招标人"]) || generic.owner || ""),
    agency: ygpPair(pairs, ["招标代理机构"]) || generic.agency || "",
    contact: ygpPair(pairs, ["招标人联系人"]) || generic.contact || "",
    phone: ygpPair(pairs, ["联系电话"]) || generic.phone || "",
    docLink: attachment.chosen ? attachment.chosen.downloadUrl : (generic.docLink || ""),
    _ygpAttachment: attachment.chosen ? { ...attachment.chosen, noticeId: String(row.noticeId || ""), candidates: attachment.candidates } : null,
  };
  return out;
}

async function ygpDetail(ad, item, args) {
  const row = item && item._ygpRow;
  if (!row) return {};
  const single = new URL(`${YGP_DETAIL_API}/singleNode`);
  for (const [k, v] of Object.entries({ siteCode: row.regionCode || row.siteCode, tradingType: row.noticeSecondType, bizCode: row.tradingProcess, classify: row.projectType })) single.searchParams.set(k, String(v || ""));
  const nodeId = await ygpGetJson(single.href, "ygp-singleNode");
  if (!nodeId) throw new Error("ygp singleNode 为空");
  const detail = new URL(`${YGP_DETAIL_API}/detail`);
  for (const [k, v] of Object.entries({ nodeId, version: row.edition || "v3", tradingType: row.noticeSecondType, noticeId: row.noticeId, bizCode: row.tradingProcess, projectCode: row.projectCode, siteCode: row.regionCode || row.siteCode })) detail.searchParams.set(k, String(v || ""));
  const data = await ygpGetJson(detail.href, "ygp-detail");
  const out = parseYgpDetailPayload(data || {}, row, ad, item);
  if (out.title && item.title && normalizeArea(out.title) !== normalizeArea(item.title) && !out.title.includes(item.title) && !item.title.includes(out.title)) {
    throw new Error("ygp 详情标题与列表不一致");
  }
  return out;
}

// ---- 共享：限流防护（礼貌延迟 + 指数退避 + 429处理 + 全局自适应降速）----
const UA_STR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// 全局降速闸门：一旦任意请求撞 429，把后续所有请求的间隔抬到该值，并在连续成功后逐步回落。
// 避免「每请求各自退避、但下一请求又从最小延迟猛冲」导致的 429 尖峰（粤公平 IP 级限流尤其典型）。
let _throttleFloor = 0;
const THROTTLE_CEIL = 90000; // 封顶 90s，避免单省把整轮拖死
function bumpThrottle(ms) { _throttleFloor = Math.min(THROTTLE_CEIL, Math.max(_throttleFloor, Math.round(ms))); }
function relaxThrottle() { if (_throttleFloor > 0) _throttleFloor = Math.max(0, Math.floor(_throttleFloor * 0.75)); }

// 从 429 响应（Retry-After 头 或 响应体「N秒」）解析建议等待毫秒数
function parseRetryAfterMs(r, bodyText) {
  const h = r && r.headers && r.headers.get ? r.headers.get("retry-after") : null;
  if (h) { const n = parseInt(h, 10); if (!isNaN(n)) return n * 1000; }
  if (bodyText) { const m = bodyText.match(/(\d+)\s*秒/); if (m) return parseInt(m[1], 10) * 1000; }
  return 0;
}

async function requestWithRetry(url, delay = 500) {
  let wait = Math.max(delay, _throttleFloor);
  for (let attempt = 0; attempt < 6; attempt++) {
    if (_throttleFloor > 0) await sleep(_throttleFloor); // 全局降速闸门：每次请求前按当前 floor 等待
    try {
      console.error("[req] attempt", attempt, "fetch", url.slice(0, 70));
      const c = new AbortController();
      // 超时必须覆盖到「响应体读完」为止。早期版本在 await fetch() 后就 clearTimeout，
      // 结果服务端发完 header 再卡住 body 时会永久挂起（浙江实测卡死 16 分钟）。
      const t = setTimeout(() => c.abort(), 30000);
      try {
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: c.signal });
        console.error("[req] attempt", attempt, "status", r.status);
        if (r.status === 429) {
          const bodyText = await r.text().catch(() => "");
          const ra = parseRetryAfterMs(r, bodyText);
          const next = Math.max(ra, wait * 2);
          bumpThrottle(next);                                        // 抬升全局闸门
          wait = Math.min(THROTTLE_CEIL, next);
          console.error("[req] 429 限流 → 全局降速至 %dms (attempt %d)", wait, attempt);
          if (attempt === 5) throw new Error("HTTP 429 限流耗尽");
          continue;
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        relaxThrottle();
        return await r.text();
      } finally { clearTimeout(t); }
    } catch (e) {
      console.error("[req] attempt", attempt, "ERR", e && e.name, e && e.message);
      if (e.name === "AbortError") { bumpThrottle(Math.max(wait * 2, 5000)); await sleep(wait); wait = Math.min(THROTTLE_CEIL, wait * 2); continue; }
      if (attempt === 5) throw e;
      await sleep(wait); wait = Math.min(THROTTLE_CEIL, wait * 2);
    }
  }
  throw new Error("retry exhausted");
}

// ---- PDF 正文通道 ----
// 背景（浙江实测）：省平台详情页只有「项目名称/代码/监督机构」摘要表，真正公告正文是 PDF 附件。
// 因此 HTML 正文过薄时自动下载 PDF 并零依赖提取文本，作为厚字段来源；扫描件无文本层则返回空（诚实留空）。
const PDF_MAX_BYTES = 12 * 1024 * 1024;

async function fetchBuffer(url, delay = 500) {
  let wait = delay;
  // PDF 是「正文增强」而非必需项：失败可降级为 HTML-only，故重试预算比主请求更紧
  // （3 次 × 30s 上限 ≈ 95s，避免个别卡流附件拖垮整省采集节奏）
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const c = new AbortController();
      // 同 requestWithRetry：超时覆盖到 arrayBuffer() 读完为止，避免 body 卡流导致进程挂死
      const t = setTimeout(() => c.abort(), 30000);
      try {
        const r = await fetch(encodeURI(decodeURI(url)), { headers: { "User-Agent": UA_STR }, signal: c.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        const len = Number(r.headers.get("content-length") || 0);
        if (len > PDF_MAX_BYTES) throw new Error("PDF 过大 " + len);
        // 2026-08-16 V4A：content-length 预检对 curl 兜底路径（headers 恒空）与 chunked 响应失效——
        // 读出后按实际大小兜底判定，防 512MB maxBuffer 全量入内存。
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > PDF_MAX_BYTES) throw new Error("PDF 过大(实际) " + buf.length);
        return buf;
      } finally { clearTimeout(t); }
    } catch (e) {
      if (attempt === 2) throw e;
      await sleep(wait); wait = Math.min(wait * 2, 20000);
    }
  }
  throw new Error("retry exhausted");
}

// ---- 缺口一·附件补抽（招标文件内含控制价/概算/保证金）----
// 仅当 HTML 正文未载这些金额字段、且存在 docLink 时，下载附件并从附件正文补抽。
// 附件类型分流：PDF（pdfToText 提取）、docx/zip（零依赖解压 word/document.xml）、其余诚实留空。

// 极简 ZIP 条目扫描（不依赖第三方库）。仅处理本地头含正确 compSize 的常规 docx/zip；
// 遇数据描述符（compSize=0）即停，避免错位；ZIP64 不处理。失败按诚实政策留空。
function readZipEntries(buf) {
  const out = [];
  try {
    // 优先中央目录：真实招标 ZIP 常使用 data descriptor，本地头 compSize=0；中央目录仍有准确尺寸/偏移。
    let eocd = -1;
    for (let i = Math.max(0, buf.length - 0x10016); i <= buf.length - 22; i++) {
      if (buf.readUInt32LE(i) === 0x06054b50) eocd = i;
    }
    if (eocd >= 0) {
      const count = Math.min(buf.readUInt16LE(eocd + 10), 2000);
      let off = buf.readUInt32LE(eocd + 16);
      for (let n = 0; n < count && off + 46 <= buf.length && buf.readUInt32LE(off) === 0x02014b50; n++) {
        const method = buf.readUInt16LE(off + 10);
        const compSize = buf.readUInt32LE(off + 20);
        const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), commentLen = buf.readUInt16LE(off + 32);
        const localOff = buf.readUInt32LE(off + 42);
        const name = buf.slice(off + 46, off + 46 + nameLen).toString("utf8");
        if (localOff + 30 <= buf.length && buf.readUInt32LE(localOff) === 0x04034b50) {
          const localNameLen = buf.readUInt16LE(localOff + 26), localExtraLen = buf.readUInt16LE(localOff + 28);
          const dataOff = localOff + 30 + localNameLen + localExtraLen;
          if (compSize <= PDF_MAX_BYTES && dataOff + compSize <= buf.length) out.push({ name, method, data: buf.slice(dataOff, dataOff + compSize) });
        }
        off += 46 + nameLen + extraLen + commentLen;
      }
      if (out.length) return out;
    }

    // 兼容无中央目录的极简包。
    let off = 0;
    while (off + 4 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
      const method = buf.readUInt16LE(off + 8);
      const compSize = buf.readUInt32LE(off + 18);
      const nameLen = buf.readUInt16LE(off + 26);
      const extraLen = buf.readUInt16LE(off + 28);
      const name = buf.slice(off + 30, off + 30 + nameLen).toString("utf8");
      const dataOff = off + 30 + nameLen + extraLen;
      out.push({ name, method, data: buf.slice(dataOff, dataOff + compSize) });
      if (compSize === 0) break;
      off = dataOff + compSize;
    }
  } catch { }
  return out;
}

function inflateEntry(e) {
  if (e.method === 0) return e.data;
  // 2026-08-16 V4A：解压输出上限 64MB——zip 炸弹/异常 docx 可把几 KB 压缩流膨胀到 GB 级 OOM
  if (e.method === 8) {
    try { return zlib.inflateRawSync(e.data, { maxOutputLength: 64 * 1024 * 1024 }); } catch { return null; }
  }
  try { return zlib.inflateSync(e.data, { maxOutputLength: 64 * 1024 * 1024 }); } catch { return null; }
}

function extractFromZip(buf) {
  const entries = readZipEntries(buf);
  if (!entries.length) return { text: "", note: "Zip 解析失败/空" };
  const doc = entries.find((e) => /word\/document\.xml$/i.test(e.name));
  if (doc) {
    const bin = inflateEntry(doc);
    if (!bin) return { text: "", note: "docx 解压失败" };
    const text = bin.toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { text, note: "Word 文档，已提取文本" };
  }
  const pdf = entries.find((e) => /\.pdf$/i.test(e.name));
  if (pdf) {
    const bin = inflateEntry(pdf);
    if (bin) return parseAttachmentBuffer(Buffer.from(bin));
  }
  return { text: "", note: "Zip 内无可用文档（docx/pdf）" };
}

function parseAttachmentBuffer(buf, depth = 0) {
  if (!buf || !buf.length) return { text: "", note: "空附件" };
  if (depth > 3) return { text: "", note: "嵌套压缩超 3 层，停止解包" }; // 2026-08-16 V4A：递归深度上限
  const magic = buf.slice(0, 4).toString("latin1");
  if (magic === "%PDF") {
    const r = pdfToTextForAttachment(buf);
    return { text: r.text, note: r.note };
  }
  if (magic === "PK\x03\x04" || magic === "PK\x05\x06" || magic === "PK\x07\x08") {
    return extractFromZip(buf);
  }
  if (buf.slice(0, 2).toString("latin1") === "\x1f\x8b") {
    try { return parseAttachmentBuffer(zlib.gunzipSync(buf, { maxOutputLength: 64 * 1024 * 1024 }), depth + 1); } catch { }
  }
  return { text: "", note: "不支持的附件类型（非 PDF/Word/Zip），按诚实政策留空" };
}

function attachmentTextScore(text) {
  const s = String(text || "");
  const labels = (s.match(/投标保证金|保证金金额|评标办法|评标方法|定性评审|综合评估法|有限数量制|满分|总得分|招标范围|建设规模/g) || []).length;
  const common = (s.match(/招标文件|投标人|招标人|评标委员会/g) || []).length;
  return labels * 20 + Math.min(common, 50);
}

function pdfToTextForAttachment(buf) {
  const native = pdfToText(buf);
  // 珠海等 PDF 的复合字体会让零依赖提取器“有文本但关键标签乱码”。仅在标签分低时尝试本机可选 pdfplumber；
  // Python/模块不存在就无声回退，仍保持零配置可运行与诚实留空。
  if (attachmentTextScore(native.text) >= 60) return native;
  const temp = path.join(os.tmpdir(), `bid-collect-attach-${process.pid}-${Date.now()}.pdf`);
  try {
    fs.writeFileSync(temp, buf);
    const py = [
      "import sys,pdfplumber",
      "p=pdfplumber.open(sys.argv[1])",
      "print('\\n'.join((page.extract_text() or '') for page in p.pages))",
      "p.close()",
    ].join(";");
    const text = execFileSync("python", ["-X", "utf8", "-c", py, temp], { encoding: "utf8", timeout: 30000, maxBuffer: 64 * 1024 * 1024, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (text && attachmentTextScore(text) > attachmentTextScore(native.text)) return { text, pages: native.pages, hasTextLayer: true, note: "文本型 PDF，已用可选 pdfplumber 增强提取" };
  } catch { /* 可选增强不可用，保留零依赖结果 */ }
  finally { try { fs.unlinkSync(temp); } catch {} }
  return native;
}

// 附件取文：先 GET，若是文件直解；若是 EPoint 形态 B 的 JS 下载页（<form method=post>），
// 复现 form.submit() 向 form.action POST，再判返回体。验证码网关则诚实留空。
async function fetchAndParseAttachment(docLink, delay) {
  let buf;
  try { buf = await fetchBuffer(docLink, delay); }
  catch (e) { return { text: "", note: "附件下载失败:" + e.message }; }
  const magic = buf.slice(0, 4).toString("latin1");
  if (magic === "%PDF" || magic === "PK\x03\x04" || magic === "PK\x05\x06" || magic === "PK\x07\x08" || buf.slice(0, 2).toString("latin1") === "\x1f\x8b") {
    return parseAttachmentBuffer(buf);                 // 形态 A：直接文件
  }
  const h = buf.toString("utf8");
  if (/^\s*<!doctype|<html/i.test(h)) {                // HTML → 可能是 JS 下载页
    const act = h.match(/form\.action\s*=\s*["']([^"']+)["']/i)
             || h.match(/<form[^>]*action=["']([^"']+)["']/i);
    if (act) {
      const actionUrl = toAbs(act[1], docLink);
      try {
        const pr = await fetch(actionUrl, {
          method: "POST",
          headers: { "User-Agent": UA_STR, Referer: docLink, "Content-Type": "multipart/form-data; boundary=----wb" },
          body: "------wb--", redirect: "follow",
        });
        const pbuf = Buffer.from(await pr.arrayBuffer());
        const pm = pbuf.slice(0, 1).toString("latin1");
        if (pm === "%" || pm === "P") return parseAttachmentBuffer(pbuf);   // POST 后返回文件
        const ptxt = pbuf.toString("utf8");
        if (/验证码|verification|captcha/i.test(ptxt)) {
          return { text: "", note: "附件下载需验证码(captcha)网关，HTTP无法直接获取，按诚实政策留空" };
        }
        return { text: "", note: "附件为JS渲染下载页(form.submit)，HTTP无法直接解析，已留空" };
      } catch (e) {
        return { text: "", note: "附件JS下载页POST失败:" + e.message };
      }
    }
    return { text: "", note: "附件页为HTML非文件，无法直接解析，已留空" };
  }
  return parseAttachmentBuffer(buf);
}

function missingAttachmentField(rec, key) {
  return rec[key] === "" || rec[key] == null;
}

function attachmentSignal(args, rec, status, extra = {}) {
  const { writeNote = true, ...signalExtra } = extra;
  const signal = { notice_id: rec._ygpAttachment && rec._ygpAttachment.noticeId || "", title: rec.title || "", status, ...signalExtra };
  if (args._run && Array.isArray(args._run.attachments)) args._run.attachments.push(signal);
  if (writeNote) rec._attachNote = status;
  return signal;
}

function attachmentStatusFromNote(note) {
  const text = String(note || "");
  if (/验证码/.test(text)) return "ATTACHMENT_CAPTCHA_REQUIRED";
  if (/不支持的附件类型/.test(text)) return "ATTACHMENT_UNSUPPORTED";
  if (/下载失败|HTTP\s*[45]\d\d|POST失败/.test(text)) return "ATTACHMENT_DOWNLOAD_FAILED";
  return "ATTACHMENT_PARSE_FAILED";
}

function moneyWanFromAttachment(value) {
  const m = String(value || "").replace(/[,，\s]/g, "").match(/(\d+(?:\.\d+)?)(万元|万|元)/);
  if (!m) return "";
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Math.round((m[2] === "元" ? n / 10000 : n) * 10000) / 10000);
}

function extractYgpAttachmentFields(text) {
  const raw = String(text || "").replace(/\u0000/g, " ");
  const flat = flatten(raw);
  const current = [];
  const currentRe = /现文\s*[:：]\s*([\s\S]{1,2000}?)(?=条款号\s*[:：]|原文\s*[:：]|$)/g;
  let cm;
  while ((cm = currentRe.exec(raw))) current.push(cm[1]);
  const priority = current.join("\n") + "\n" + raw;
  const out = {};

  const noBond = /(?:本项目不要求(?:投标人)?递交投标保证金|本项目无投标保证金|■\s*不要求(?:投标保证金)?)/.test(priority);
  if (noBond) out.bond = 0;
  else {
    const bm = priority.match(/(?:投标保证金(?:金额)?|保证金金额)[\s\S]{0,120}?(?:■|☑)?\s*[\[【]?\s*(\d+(?:\.\d+)?)\s*[\]】]?\s*(万元|万|元)/);
    if (bm) out.bond = moneyWanFromAttachment(bm[1] + bm[2]);
  }

  let m = priority.match(/评标阶段采用[“\"]([^”\"]{2,30})[”\"]评标法/);
  if (m) out.evaluation = `评定分离（${m[1]}评标法）`;
  if (!out.evaluation && (m = priority.match(/本次评标采用\s*([^。；;]{2,30}?法)/))) out.evaluation = m[1].trim();
  if (!out.evaluation && (m = priority.match(/评标办法[（(]([^）)]{2,30}?法)[）)]/))) out.evaluation = m[1].trim();
  if (!out.evaluation && /采用定性评审项目|本项目采用定性评审/.test(priority)) {
    out.evaluation = /经济标[\s\S]{0,80}技术标|技术标[\s\S]{0,80}经济标/.test(priority) ? "定性评审（经济标、技术标）" : "定性评审";
  }

  if ((m = priority.match(/(?:最高|满分为|总得分满分为)\s*([0-9]+(?:\.[0-9]+)?)\s*分/))) out.fullScore = m[1];
  else if ((m = priority.match(/投标人总得分[（(]最高\s*([0-9]+(?:\.[0-9]+)?)\s*分[）)]/))) out.fullScore = m[1];
  else if (out.evaluation && out.evaluation.startsWith("定性评审") && /定性评审/.test(priority)) out.fullScore = "不适用（定性评审）";

  const project = extractProjectContent("", raw, flat);
  if (project.scale) out.scale = project.scale;
  if (project.scope) out.scope = project.scope;
  return out;
}

async function ygpAttachmentJson(url, args) {
  if (args.delay) await sleep(Math.min(args.delay, 3000));
  const r = await fetch(url, { headers: { "User-Agent": UA_STR, "Referer": "https://ygp.gdzwfw.gov.cn/", "Accept": "application/json" } });
  const raw = typeof r.arrayBuffer === "function" ? Buffer.from(await r.arrayBuffer()).toString("utf8") : await r.text();
  if (r.status === 429) return { ok: false, status: "ATTACHMENT_DAILY_LIMIT", message: "HTTP 429" };
  if (!r.ok) return { ok: false, status: "ATTACHMENT_DOWNLOAD_FAILED", message: `HTTP ${r.status}` };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, status: "ATTACHMENT_PARSE_FAILED", message: "非 JSON 响应" }; }
  if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "errcode") && Number(parsed.errcode) !== 0) {
    const message = String(parsed.errmsg || "");
    return { ok: false, status: /验证码/.test(message) ? "ATTACHMENT_CAPTCHA_REQUIRED" : /次数|上限/.test(message) ? "ATTACHMENT_DAILY_LIMIT" : "ATTACHMENT_DOWNLOAD_FAILED", message };
  }
  return { ok: true, data: unwrapYgpPayload(parsed) };
}

async function enrichYgpAttachment(rec, args, ad) {
  if (!args.attach || !rec._ygpAttachment || !rec.docLink) return;
  const file = rec._ygpAttachment;
  const sizeRep = await ygpAttachmentJson(file.sizeUrl, args);
  if (!sizeRep.ok) { attachmentSignal(args, rec, sizeRep.status, { file_name: file.fileName, message: sizeRep.message }); return; }
  const size = Number(sizeRep.data || 0);
  if (size > PDF_MAX_BYTES) { attachmentSignal(args, rec, "ATTACHMENT_TOO_LARGE", { file_name: file.fileName, size_bytes: size }); return; }
  const pre = await ygpAttachmentJson(file.precheckUrl, args);
  if (!pre.ok) { attachmentSignal(args, rec, pre.status, { file_name: file.fileName, size_bytes: size, message: pre.message }); return; }
  if (pre.data && (pre.data.needCaptcha || pre.data.allow === false)) {
    const status = Number(pre.data.count || 0) >= Number(pre.data.maxPerDay || Infinity) ? "ATTACHMENT_DAILY_LIMIT" : "ATTACHMENT_CAPTCHA_REQUIRED";
    attachmentSignal(args, rec, status, { file_name: file.fileName, size_bytes: size });
    return;
  }
  const parsed = await fetchAndParseAttachment(file.downloadUrl, args.delay);
  if (!parsed.text) { attachmentSignal(args, rec, /验证码/.test(parsed.note || "") ? "ATTACHMENT_CAPTCHA_REQUIRED" : "ATTACHMENT_PARSE_FAILED", { file_name: file.fileName, size_bytes: size, message: parsed.note || "" }); return; }
  const fields = extractYgpAttachmentFields(parsed.text);
  const filled = [];
  for (const key of ad.attachmentFields || []) {
    if (!missingAttachmentField(rec, key) || fields[key] === "" || fields[key] == null) continue;
    rec[key] = fields[key];
    markFieldSource(rec, key, "attachment");
    filled.push(key);
  }
  attachmentSignal(args, rec, filled.length ? "ATTACHMENT_ENRICHED" : "ATTACHMENT_NO_FIELDS", { file_name: file.fileName, size_bytes: size, fields: filled.join(",") });
}

async function enrichFromAttachment(rec, args, ad) {
  if (!args.attach) return;
  const configured = ad && Array.isArray(ad.attachmentFields) ? ad.attachmentFields : ["controlPrice", "budget", "bond"];
  const need = configured.filter((key) => missingAttachmentField(rec, key));
  if (!need.length) return;
  if (!rec.docLink) {
    attachmentSignal(args, rec, "ATTACHMENT_NO_LINK", { fields: need.join(","), writeNote: false });
    return;
  }
  if (rec._pdfNote) {
    attachmentSignal(args, rec, "ATTACHMENT_ALREADY_PARSED", { fields: need.join(","), file_url: rec.docLink, writeNote: false });
    return;                           // 浙江等 PDF 正文模式：money 已自 pdfText 抽取，勿重复下载
  }
  try {
    const { text, note } = await fetchAndParseAttachment(rec.docLink, args.delay);
    rec._attachNote = note;
    if (!text) {
      attachmentSignal(args, rec, attachmentStatusFromNote(note), { fields: need.join(","), file_url: rec.docLink, message: note || "", writeNote: false });
      // 诚实留空场景（验证码网关 / JS渲染下载页 / 不支持类型）也打印日志，便于审计"为何为空"
      if (note && /验证码|JS渲染|非文件|不支持/.test(note)) console.error("[attach] ⊘", note, "|", (rec.title || "").slice(0, 24));
      return;
    }
    // 只记录「真实补到的字段」，不夸大（此前用 need=补抽前为空的字段列表，会写成未补到的字段）
    const filled = [];
    if (!rec.controlPrice) { const v = grabMoneyWan(text, ["招标控制价", "控制价", "最高投标限价", "最高限价", "预算金额", "预算价", "合同估算价"]); if (v) { rec.controlPrice = v; markFieldSource(rec, "controlPrice", "attachment"); filled.push("controlPrice"); } }
    if (!rec.budget) { const v = grabBudgetWan(flatten(text)); if (v) { rec.budget = v; filled.push("budget"); } }
    if (!rec.bond) { const v = grabMoneyWan(text, ["投标保证金", "保证金"]); if (v) { rec.bond = v; markFieldSource(rec, "bond", "attachment"); filled.push("bond"); } }
    if (need.includes("scale") || need.includes("scope")) {
      const p = extractProjectContent("", text, flatten(text));
      if (need.includes("scale") && p.scale) { rec.scale = p.scale; markFieldSource(rec, "scale", "attachment"); filled.push("scale"); }
      if (need.includes("scope") && p.scope) { rec.scope = p.scope; markFieldSource(rec, "scope", "attachment"); filled.push("scope"); }
    }
    if (need.includes("evaluation")) { const v = grabEvaluation(text); if (v) { rec.evaluation = v; markFieldSource(rec, "evaluation", "attachment"); filled.push("evaluation"); } }
    if (need.includes("fullScore")) { const v = grabFullScore(text, flatten(text)); if (v) { rec.fullScore = v; markFieldSource(rec, "fullScore", "attachment"); filled.push("fullScore"); } }
    if (filled.length) {
      rec._attachNote = "已从附件补抽:" + filled.join("/");
      attachmentSignal(args, rec, "ATTACHMENT_ENRICHED", { fields: filled.join(","), file_url: rec.docLink, writeNote: false });
      console.error("[attach] ✓", rec._attachNote, "| 控制价:", rec.controlPrice || "-", "概算:", rec.budget || "-", "保证金:", rec.bond || "-", "|", (rec.title || "").slice(0, 24));
    } else attachmentSignal(args, rec, "ATTACHMENT_NO_FIELDS", { fields: need.join(","), file_url: rec.docLink, writeNote: false });
  } catch (e) {
    rec._attachNote = "附件下载/解析失败:" + (e && e.message);
    attachmentSignal(args, rec, "ATTACHMENT_DOWNLOAD_FAILED", { fields: need.join(","), file_url: rec.docLink, message: String(e && e.message || e), writeNote: false });
  }
}

/** HTML 正文薄 → 找 PDF 附件取正文。返回 {text, pdfUrl, note} */
async function maybePdfText(html, pageUrl, delay, minHtmlLen = 1200) {
  // pdfjs 内嵌 viewer：详情正文即 PDF（山西/广西等 SPA 站点，HTML 壳页虽含大量导航文本但公告正文在 PDF 内）。
  // 优先识别 pdfjs iframe，命中即走 PDF，不受下方「HTML 正文充足」早退影响（否则壳页导航文本会误判为「正文充足」而漏抓 PDF）。
  const ifr = html.match(/<iframe[^>]+src=["'][^"']*viewer\.html\?(?:[^"']*&)?file=([^"']+)/i)
          || html.match(/viewer\.html\?(?:[^"']*&)?file=([^"'\s]+)/i);
  if (ifr) {
    let pdfHref;
    try { pdfHref = decodeURIComponent(ifr[1]); } catch { pdfHref = ifr[1]; }
    const pdfUrl = toAbs(pdfHref, pageUrl);
    try {
      const buf = await fetchBuffer(pdfUrl, delay);
      const r = pdfToText(buf);
      if (r && r.text) return { text: r.text, pdfUrl, note: r.note };
      return { text: "", pdfUrl, note: "PDF 解析无文本（可能扫描件）: " + (r && r.note || "") };
    } catch (e) {
      return { text: "", pdfUrl, note: "PDF 下载/解析失败: " + e.message };
    }
  }
  // 温州 JPaas 详情页：iframe 的 src 初始为空，页面 JS 从 #pdfshow[data-value] 读取
  // 无 .pdf 后缀的官方下载端点后再拼入 viewer。必须在 HTML 长度早退前识别，否则导航文本
  // 会被误当成正文充足，16 列详情字段全部假空。
  const embeddedHref = findEmbeddedPdfHref(html);
  if (embeddedHref) {
    const pdfUrl = toAbs(embeddedHref, pageUrl);
    try {
      const buf = await fetchBuffer(pdfUrl, delay);
      const r = pdfToText(buf);
      if (r && r.text) return { text: r.text, pdfUrl, note: r.note };
      return { text: "", pdfUrl, note: "PDF 解析无文本（可能扫描件）: " + (r && r.note || "") };
    } catch (e) {
      return { text: "", pdfUrl, note: "PDF 下载/解析失败: " + e.message };
    }
  }
  const plain = htmlToText(html);
  if (plain.length >= minHtmlLen) return { text: "", pdfUrl: "", note: "HTML 正文充足，未走 PDF" };
  // 优先 id="fujian" 内的链接（EPoint 标准附件位），否则任意 .pdf
  let href = "";
  const fj = html.match(/id=["']fujian["'][^>]*>\s*<a[^>]+href=["']([^"']+)["']/i);
  if (fj) href = fj[1];
  if (!href) {
    const any = html.match(/href=["']([^"']+\.pdf)["']/i);
    if (any) href = any[1];
  }
  if (!href) return { text: "", pdfUrl: "", note: "无 PDF 附件，正文不可得" };
  const pdfUrl = toAbs(href, pageUrl);
  try {
    const buf = await fetchBuffer(pdfUrl, delay);
    const r = pdfToText(buf);
    return { text: r.text, pdfUrl, note: r.note };
  } catch (e) {
    return { text: "", pdfUrl, note: "PDF 下载/解析失败: " + e.message };
  }
}

function findEmbeddedPdfHref(html) {
  const raw = String(html || "");
  const tag = raw.match(/<[^>]+\bid=["']pdfshow["'][^>]*>/i)?.[0] || "";
  const href = tag.match(/\bdata-value=["']([^"']+)["']/i)?.[1] || "";
  return href.replace(/&amp;/gi, "&").trim();
}

// ---- 极简 xlsx 写入（零依赖：store-zip + inline strings）----
function crc32(buf) {
  let c, table = crc32.t || (crc32.t = (() => {
    const t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function colLetter(n) { let s = ""; n++; while (n > 0) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; }
function xmlEsc(s) { return String(s).replace(/[<>&'"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c])); }

function xlsxColumnWidths(count) {
  const full29 = [6, 12, 18, 40, 14, 16, 34, 34, 14, 14, 20, 10, 12, 14, 28, 28, 18, 12, 30, 28, 24, 30, 14, 14, 12, 8, 14, 26, 26];
  const compact16 = [6, 12, 18, 40, 14, 16, 34, 34, 14, 14, 20, 10, 12, 30, 28, 24];
  const project18 = [6, 14, 18, 40, 48, 42, 16, 16, 34, 28, 14, 14, 22, 12, 18, 30, 28, 28];
  return count === 16 ? compact16 : count === 18 ? project18 : full29.slice(0, count);
}

function xlsxRowHeight(row, widths) {
  let maxLines = 1;
  for (let i = 0; i < row.length; i++) {
    const value = row[i] == null ? "" : String(row[i]);
    if (!value) continue;
    const visualUnits = [...value].reduce((n, ch) => n + (/[^\x00-\xff]/.test(ch) ? 2 : 1), 0);
    const width = Math.max(6, Number(widths[i]) || 12);
    maxLines = Math.max(maxLines, value.split(/\r?\n/).length, Math.ceil(visualUnits / width));
  }
  return Math.max(42, Math.min(300, 8 + maxLines * 15));
}

function writeXlsx(path, sheets) {
  // sheets: [{name, rows:[[...]]}]
  const esc = xmlEsc;
  const sheetXml = sheets.map((sh, i) => {
    const widths = xlsxColumnWidths((sh.rows[0] || []).length);
    const widthXml = widths.map((width, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${width}" customWidth="1"/>`).join("");
    const rows = sh.rows.map((row, ri) => {
      const cells = row.map((val, ci) => {
        const ref = colLetter(ci) + (ri + 1);
        const v = val == null ? "" : String(val);
        return `<c r="${ref}" s="${ri === 0 ? 1 : 2}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      }).join("");
      const height = ri === 0 ? 30 : xlsxRowHeight(row, widths);
      return `<row r="${ri + 1}" ht="${height}" customHeight="1">${cells}</row>`;
    }).join("");
    const lastCol = colLetter(Math.max(0, (sh.rows[0] || []).length - 1));
    const lastRow = Math.max(1, sh.rows.length);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widthXml}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${lastCol}${lastRow}"/></worksheet>`;
  });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    sheetXml.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + `</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheets.map((sh, i) => `<sheet name="${esc(sh.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") + `</sheets></workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheetXml.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${sheetXml.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  // 打包 store-zip
  const files = [
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", wbRels],
    ["xl/styles.xml", styles],
    ...sheetXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ];
  const parts = [];
  let offset = 0;
  const central = [];
  for (const [name, data] of files) {
    const buf = Buffer.from(data, "utf8");
    const crc = crc32(buf);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(buf.length, 18); local.writeUInt32LE(buf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, buf);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(buf.length, 20); cd.writeUInt32LE(buf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + buf.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  fs.writeFileSync(path, Buffer.concat([...parts, centralBuf, end]));
}

// ---- 参数解析 ----
function parseArgs(argv) {
  const a = { keyword: "", province: "", city: "", days: 30, delay: 500, limit: 0, csv: false, xlsx: true, xlsxLayout: "biaobiaotong16", out: "", cat: "", detail: true, attach: false, probe: false, verify: false, dumpText: false, stage: "zb" };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "-p" || x === "--province") a.province = argv[++i];
    else if (x === "-k" || x === "--keyword") a.keyword = argv[++i];
    else if (x === "-c" || x === "--city") a.city = argv[++i] || "";
    else if (x === "-d" || x === "--days") a.days = parseInt(argv[++i], 10);
    else if (x === "--delay") a.delay = parseInt(argv[++i], 10);
    else if (x === "--limit") a.limit = parseInt(argv[++i], 10);
    else if (x === "--csv") a.csv = true;
    else if (x === "--xlsx") a.xlsx = true;
    else if (x === "--no-xlsx") a.xlsx = false;
    else if (x === "--xlsx-layout") a.xlsxLayout = argv[++i] || "biaobiaotong16";
    else if (x === "--no-detail") a.detail = false;
    else if (x === "--attach") a.attach = true;
    else if (x === "--probe") a.probe = true;
    else if (x === "--probe-all") a.probeAll = true;
    else if (x === "--verify") a.verify = true;
    else if (x === "-o" || x === "--out") a.out = argv[++i];
    else if (x === "--cat") a.cat = argv[++i];
    else if (x === "--stage") a.stage = argv[++i] || "zb";
    else if (x === "--dump-text") a.dumpText = true;
  }
  if (!["full29", "biaobiaotong16", "project18"].includes(a.xlsxLayout)) throw new Error(`--xlsx-layout 仅支持 full29、biaobiaotong16 或 project18，收到: ${a.xlsxLayout}`);
  // 2026-08-16 V4A：NaN 静默穿透防护——days=NaN 使日期截断失效翻满 200 页收 2018 年老公告；
  // delay=NaN 使 setTimeout(0) 礼貌延迟归零全速连打（hasReachedLimit 已有同款防御，此处补齐）。
  if (!Number.isFinite(a.days) || a.days <= 0) throw new Error(`--days 需为正整数，收到: ${a.days}`);
  if (!Number.isFinite(a.delay) || a.delay < 0) a.delay = 500;
  return a;
}

// 标的类型（量纲标记）：控制价列在「施工/EPC 标的价」与「监理/设计等服务费」两种量纲间混列
// （马鞍山例：EPC 控制价 12780万 vs 监理标控制价 166.15万 = 概算 12424.65万 × 1.34% 标准监理费率），
// 不标记类型就会错用口径（服务费当标的价）。标题无信号时诚实留空，不猜。
// 概算按费用类别的拆分（监理费份额）公告层普遍不披露，无法直接抽取——本列即替代解法。
function inferTenderType(title) {
  const t = String(title || "");
  // 监理须在 EPC 之前：EPC 项目的监理标（「…EPC（监理）」）是服务费量纲，判成 EPC总承包会当标的价错用
  if (/监理/.test(t)) return "监理";
  if (/EPC|工程总承包|设计采购施工|交钥匙/i.test(t)) return "EPC总承包";
  if (/全过程咨询/.test(t)) return "全过程咨询";
  if (/造价咨询|招标代理/.test(t)) return "造价咨询";
  if (/勘察设计/.test(t)) return "勘察设计";
  if (/设计(?!.*施工)/.test(t)) return "设计";
  if (/检测|监测/.test(t)) return "检测监测";
  if (/采购|设备|货物/.test(t)) return "货物采购";
  if (/施工|修缮|改造|修复|治理|新建|扩建/.test(t)) return "施工";
  return "";
}

function inferType(title) {
  if (/中标结果|中标公告|中标公示/.test(title)) return "中标结果";
  if (/中标候选人/.test(title)) return "中标候选人";
  if (/评标/.test(title)) return "评标";
  if (/招标|采购公告|磋商|谈判/.test(title)) return "招标公告";
  if (/更正|澄清|答疑|补充/.test(title)) return "更正";
  return "其他";
}

// 从标题的【】里提取城市（兼容 山东【省级】【青岛】 与 安徽【合肥市-庐江县-招标公告】 两种结构）
function extractCity(title) {
  const bs = title.match(/【([^】]+)】/g) || [];
  const TYPE_WORD = /招标|中标|评标|更正|省级|市级|县级|公告|公示|结果|候选|采购|竞争|磋商|谈判|补充|答疑|澄清/;
  for (const b of bs) {
    const segs = b.slice(1, -1).split("-").map(s => s.trim());
    for (const seg of segs) {
      if (seg && !TYPE_WORD.test(seg)) return seg;
    }
  }
  // 标题起首的行政区名（2026-08-10 海南实测新增）。
  // 海南标题不带【】标注，但绝大多数以区县名起头："昌江县县城规划区污水管网改造项目…"。
  // 此前只认【】格式，导致地区一律回落到 xiaquname 的"海南省"，报表里全省一个粒度、失去筛选价值。
  // 只匹配"起首"，避免把项目名中段的地名（如"崖州大道"）误当归属地。
  const NOT_A_PLACE = /关于|项目|工程|标段|标包|采购|服务|建设|改造|新建|扩建/;
  const m = title.match(/^([\u4e00-\u9fa5]{2,6}?(?:自治县|自治州|地区|市|县|区|旗|盟))/);
  if (m && !TYPE_WORD.test(m[1]) && !NOT_A_PLACE.test(m[1])) return m[1];
  return "";
}

function normalizeArea(value) {
  return String(value || "").replace(/\s+/g, "").replace(/(?:省|市|自治州|地区|盟|自治县|县|区|旗)$/u, "");
}

// 区/县 → 地级市 归一化种子（城市级深度 · 2026-08-16，静态待审数据）。
// 省级平台常只标区县（如“香洲区”），导致 `--city 珠海` 命中不了。此表让地级市↔区县双向归一。
// 仅做“增量匹配”：未列入的省/市不产生任何误匹配。共覆盖 31 省 + 4 直辖市全部地级市。
const PREFECTURE_DISTRICTS = {
  // ===== 北京 =====
  "北京": [
    "东城区", "西城区", "朝阳区", "丰台区", "石景山区", "海淀区", "门头沟区", "房山区", "通州区", "顺义区", "昌平区", "大兴区",
    "怀柔区", "平谷区", "密云区", "延庆区"
  ],
  // ===== 天津 =====
  "天津": [
    "和平区", "河东区", "河西区", "南开区", "河北区", "红桥区", "东丽区", "西青区", "津南区", "北辰区", "武清区", "宝坻区",
    "滨海新区", "宁河区", "静海区", "蓟州区"
  ],
  // ===== 上海 =====
  "上海": [
    "黄浦区", "徐汇区", "长宁区", "静安区", "普陀区", "虹口区", "杨浦区", "闵行区", "宝山区", "嘉定区", "浦东新区", "金山区",
    "松江区", "青浦区", "奉贤区", "崇明区"
  ],
  // ===== 重庆 =====
  "重庆": [
    "万州区", "涪陵区", "渝中区", "大渡口区", "江北区", "沙坪坝区", "九龙坡区", "南岸区", "北碚区", "綦江区", "大足区", "渝北区",
    "巴南区", "黔江区", "长寿区", "江津区", "合川区", "永川区", "南川区", "璧山区", "铜梁区", "潼南区", "荣昌区", "开州区",
    "梁平区", "武隆区", "城口县", "丰都县", "垫江县", "忠县", "云阳县", "奉节县", "巫山县", "巫溪县", "石柱土家族自治县", "秀山土家族苗族自治县",
    "酉阳土家族苗族自治县", "彭水苗族土家族自治县"
  ],
  // ===== 云南 =====
  "昆明": [
    "昆明市", "五华区", "盘龙区", "官渡区", "西山区", "东川区", "呈贡区", "晋宁区", "富民县", "宜良县", "石林彝族自治县", "嵩明县",
    "禄劝彝族苗族自治县", "寻甸回族彝族自治县", "安宁市", "市辖区"
  ],
  "曲靖": [
    "曲靖市", "麒麟区", "沾益区", "马龙区", "陆良县", "师宗县", "罗平县", "富源县", "会泽县", "宣威市", "市辖区"
  ],
  "玉溪": [
    "玉溪市", "红塔区", "江川区", "通海县", "华宁县", "易门县", "峨山彝族自治县", "新平彝族傣族自治县", "元江哈尼族彝族傣族自治县", "澄江市", "市辖区"
  ],
  "保山": [
    "保山市", "隆阳区", "施甸县", "龙陵县", "昌宁县", "腾冲市", "市辖区"
  ],
  "昭通": [
    "昭通市", "昭阳区", "鲁甸县", "巧家县", "盐津县", "大关县", "永善县", "绥江县", "镇雄县", "彝良县", "威信县", "水富市",
    "市辖区"
  ],
  "丽江": [
    "丽江市", "古城区", "玉龙纳西族自治县", "永胜县", "华坪县", "宁蒗彝族自治县", "市辖区"
  ],
  "普洱": [
    "普洱市", "思茅区", "宁洱哈尼族彝族自治县", "墨江哈尼族自治县", "景东彝族自治县", "景谷傣族彝族自治县", "镇沅彝族哈尼族拉祜族自治县", "江城哈尼族彝族自治县", "孟连傣族拉祜族佤族自治县", "澜沧拉祜族自治县", "西盟佤族自治县", "市辖区"
  ],
  "临沧": [
    "临沧市", "临翔区", "凤庆县", "云县", "永德县", "镇康县", "双江拉祜族佤族布朗族傣族自治县", "耿马傣族佤族自治县", "沧源佤族自治县", "市辖区"
  ],
  "楚雄彝族": [
    "楚雄彝族自治州", "楚雄市", "双柏县", "牟定县", "南华县", "姚安县", "大姚县", "永仁县", "元谋县", "武定县", "禄丰县", "禄丰市"
  ],
  "红河": [
    "红河哈尼族彝族自治州", "个旧市", "开远市", "蒙自市", "弥勒市", "屏边苗族自治县", "建水县", "石屏县", "泸西县", "元阳县", "红河县", "金平苗族瑶族傣族自治县",
    "绿春县", "河口瑶族自治县"
  ],
  "文山": [
    "文山壮族苗族自治州", "文山市", "砚山县", "西畴县", "麻栗坡县", "马关县", "丘北县", "广南县", "富宁县"
  ],
  "西双版纳": [
    "西双版纳傣族自治州", "景洪市", "勐海县", "勐腊县"
  ],
  "大理": [
    "大理白族自治州", "大理市", "漾濞彝族自治县", "祥云县", "宾川县", "弥渡县", "南涧彝族自治县", "巍山彝族回族自治县", "永平县", "云龙县", "洱源县", "剑川县",
    "鹤庆县"
  ],
  "德宏": [
    "德宏傣族景颇族自治州", "瑞丽市", "芒市", "梁河县", "盈江县", "陇川县"
  ],
  "怒江": [
    "怒江傈僳族自治州", "泸水市", "福贡县", "贡山独龙族怒族自治县", "兰坪白族普米族自治县"
  ],
  "迪庆": [
    "迪庆藏族自治州", "香格里拉市", "德钦县", "维西傈僳族自治县"
  ],
  // ===== 内蒙古自治 =====
  "呼和浩特": [
    "呼和浩特市", "新城区", "回民区", "玉泉区", "赛罕区", "土默特左旗", "托克托县", "和林格尔县", "清水河县", "武川县", "市辖区", "呼和浩特经济技术开发区"
  ],
  "包头": [
    "包头市", "东河区", "昆都仑区", "青山区", "石拐区", "白云鄂博矿区", "九原区", "土默特右旗", "固阳县", "达尔罕茂明安联合旗", "市辖区", "包头稀土高新技术产业开发区"
  ],
  "乌海": [
    "乌海市", "海勃湾区", "海南区", "乌达区", "市辖区"
  ],
  "赤峰": [
    "赤峰市", "红山区", "元宝山区", "松山区", "阿鲁科尔沁旗", "巴林左旗", "巴林右旗", "林西县", "克什克腾旗", "翁牛特旗", "喀喇沁旗", "宁城县",
    "敖汉旗", "市辖区"
  ],
  "通辽": [
    "通辽市", "科尔沁区", "科尔沁左翼中旗", "科尔沁左翼后旗", "开鲁县", "库伦旗", "奈曼旗", "扎鲁特旗", "霍林郭勒市", "市辖区", "通辽经济技术开发区"
  ],
  "鄂尔多斯": [
    "鄂尔多斯市", "东胜区", "康巴什区", "达拉特旗", "准格尔旗", "鄂托克前旗", "鄂托克旗", "杭锦旗", "乌审旗", "伊金霍洛旗", "市辖区"
  ],
  "呼伦贝尔": [
    "呼伦贝尔市", "海拉尔区", "扎赉诺尔区", "阿荣旗", "莫力达瓦达斡尔族自治旗", "鄂伦春自治旗", "鄂温克族自治旗", "陈巴尔虎旗", "新巴尔虎左旗", "新巴尔虎右旗", "满洲里市", "牙克石市",
    "扎兰屯市", "额尔古纳市", "根河市", "市辖区"
  ],
  "巴彦淖尔": [
    "巴彦淖尔市", "临河区", "五原县", "磴口县", "乌拉特前旗", "乌拉特中旗", "乌拉特后旗", "杭锦后旗", "市辖区"
  ],
  "乌兰察布": [
    "乌兰察布市", "集宁区", "卓资县", "化德县", "商都县", "兴和县", "凉城县", "察哈尔右翼前旗", "察哈尔右翼中旗", "察哈尔右翼后旗", "四子王旗", "丰镇市",
    "市辖区"
  ],
  "兴安": [
    "兴安盟", "乌兰浩特市", "阿尔山市", "科尔沁右翼前旗", "科尔沁右翼中旗", "扎赉特旗", "突泉县"
  ],
  "锡林郭勒": [
    "锡林郭勒盟", "二连浩特市", "锡林浩特市", "阿巴嘎旗", "苏尼特左旗", "苏尼特右旗", "东乌珠穆沁旗", "西乌珠穆沁旗", "太仆寺旗", "镶黄旗", "正镶白旗", "正蓝旗",
    "多伦县", "乌拉盖管委会"
  ],
  "阿拉善": [
    "阿拉善盟", "阿拉善左旗", "阿拉善右旗", "额济纳旗", "内蒙古阿拉善高新技术产业开发区"
  ],
  // ===== 吉林 =====
  "长春": [
    "长春市", "南关区", "宽城区", "朝阳区", "二道区", "绿园区", "双阳区", "九台区", "农安县", "榆树市", "德惠市", "公主岭市",
    "市辖区", "长春经济技术开发区", "长春净月高新技术产业开发区", "长春高新技术产业开发区", "长春汽车经济技术开发区"
  ],
  "吉林": [
    "吉林市", "昌邑区", "龙潭区", "船营区", "丰满区", "永吉县", "蛟河市", "桦甸市", "舒兰市", "磐石市", "市辖区", "吉林经济开发区",
    "吉林高新技术产业开发区", "吉林中国新加坡食品区"
  ],
  "四平": [
    "四平市", "铁西区", "铁东区", "梨树县", "伊通满族自治县", "双辽市", "市辖区"
  ],
  "辽源": [
    "辽源市", "龙山区", "西安区", "东丰县", "东辽县", "市辖区"
  ],
  "通化": [
    "通化市", "东昌区", "二道江区", "通化县", "辉南县", "柳河县", "梅河口市", "集安市", "市辖区"
  ],
  "白山": [
    "白山市", "浑江区", "江源区", "抚松县", "靖宇县", "长白朝鲜族自治县", "临江市", "市辖区"
  ],
  "松原": [
    "松原市", "宁江区", "前郭尔罗斯蒙古族自治县", "长岭县", "乾安县", "扶余市", "市辖区", "吉林松原经济开发区"
  ],
  "白城": [
    "白城市", "洮北区", "镇赉县", "通榆县", "洮南市", "大安市", "市辖区", "吉林白城经济开发区"
  ],
  "延边": [
    "延边朝鲜族自治州", "延吉市", "图们市", "敦化市", "珲春市", "龙井市", "和龙市", "汪清县", "安图县"
  ],
  // ===== 四川 =====
  "成都": [
    "成都市", "锦江区", "青羊区", "金牛区", "武侯区", "成华区", "龙泉驿区", "青白江区", "新都区", "温江区", "双流区", "郫都区",
    "新津区", "金堂县", "大邑县", "蒲江县", "都江堰市", "彭州市", "邛崃市", "崇州市", "简阳市", "市辖区"
  ],
  "自贡": [
    "自贡市", "自流井区", "贡井区", "大安区", "沿滩区", "荣县", "富顺县", "市辖区"
  ],
  "攀枝花": [
    "攀枝花市", "东区", "西区", "仁和区", "米易县", "盐边县", "市辖区"
  ],
  "泸州": [
    "泸州市", "江阳区", "纳溪区", "龙马潭区", "泸县", "合江县", "叙永县", "古蔺县", "市辖区"
  ],
  "德阳": [
    "德阳市", "旌阳区", "罗江区", "中江县", "广汉市", "什邡市", "绵竹市", "市辖区"
  ],
  "绵阳": [
    "绵阳市", "涪城区", "游仙区", "安州区", "三台县", "盐亭县", "梓潼县", "北川羌族自治县", "平武县", "江油市", "市辖区"
  ],
  "广元": [
    "广元市", "利州区", "昭化区", "朝天区", "旺苍县", "青川县", "剑阁县", "苍溪县", "市辖区"
  ],
  "遂宁": [
    "遂宁市", "船山区", "安居区", "蓬溪县", "大英县", "射洪市", "市辖区"
  ],
  "内江": [
    "内江市", "市中区", "东兴区", "威远县", "资中县", "隆昌市", "市辖区", "内江经济开发区"
  ],
  "乐山": [
    "乐山市", "市中区", "沙湾区", "五通桥区", "金口河区", "犍为县", "井研县", "夹江县", "沐川县", "峨边彝族自治县", "马边彝族自治县", "峨眉山市",
    "市辖区"
  ],
  "南充": [
    "南充市", "顺庆区", "高坪区", "嘉陵区", "南部县", "营山县", "蓬安县", "仪陇县", "西充县", "阆中市", "市辖区"
  ],
  "眉山": [
    "眉山市", "东坡区", "彭山区", "仁寿县", "洪雅县", "丹棱县", "青神县", "市辖区"
  ],
  "宜宾": [
    "宜宾市", "翠屏区", "南溪区", "叙州区", "江安县", "长宁县", "高县", "珙县", "筠连县", "兴文县", "屏山县", "市辖区"
  ],
  "广安": [
    "广安市", "广安区", "前锋区", "岳池县", "武胜县", "邻水县", "华蓥市", "市辖区"
  ],
  "达州": [
    "达州市", "通川区", "达川区", "宣汉县", "开江县", "大竹县", "渠县", "万源市", "市辖区", "达州经济开发区"
  ],
  "雅安": [
    "雅安市", "雨城区", "名山区", "荥经县", "汉源县", "石棉县", "天全县", "芦山县", "宝兴县", "市辖区"
  ],
  "巴中": [
    "巴中市", "巴州区", "恩阳区", "通江县", "南江县", "平昌县", "市辖区", "巴中经济开发区"
  ],
  "资阳": [
    "资阳市", "雁江区", "安岳县", "乐至县", "市辖区"
  ],
  "阿坝藏族羌族": [
    "阿坝藏族羌族自治州", "马尔康市", "汶川县", "理县", "茂县", "松潘县", "九寨沟县", "金川县", "小金县", "黑水县", "壤塘县", "阿坝县",
    "若尔盖县", "红原县"
  ],
  "甘孜": [
    "甘孜藏族自治州", "康定市", "泸定县", "丹巴县", "九龙县", "雅江县", "道孚县", "炉霍县", "甘孜县", "新龙县", "德格县", "白玉县",
    "石渠县", "色达县", "理塘县", "巴塘县", "乡城县", "稻城县", "得荣县"
  ],
  "凉山彝族": [
    "凉山彝族自治州", "西昌市", "木里藏族自治县", "盐源县", "德昌县", "会理县", "会东县", "宁南县", "普格县", "布拖县", "金阳县", "昭觉县",
    "喜德县", "冕宁县", "越西县", "甘洛县", "美姑县", "雷波县", "会理市"
  ],
  // ===== 宁夏回族自治 =====
  "银川": [
    "银川市", "兴庆区", "西夏区", "金凤区", "永宁县", "贺兰县", "灵武市", "市辖区"
  ],
  "石嘴山": [
    "石嘴山市", "大武口区", "惠农区", "平罗县", "市辖区"
  ],
  "吴忠": [
    "吴忠市", "利通区", "红寺堡区", "盐池县", "同心县", "青铜峡市", "市辖区"
  ],
  "固原": [
    "固原市", "原州区", "西吉县", "隆德县", "泾源县", "彭阳县", "市辖区"
  ],
  "中卫": [
    "中卫市", "沙坡头区", "中宁县", "海原县", "市辖区"
  ],
  // ===== 安徽 =====
  "合肥": [
    "合肥市", "瑶海区", "庐阳区", "蜀山区", "包河区", "长丰县", "肥东县", "肥西县", "庐江县", "巢湖市", "市辖区", "合肥高新技术产业开发区",
    "合肥经济技术开发区", "合肥新站高新技术产业开发区"
  ],
  "芜湖": [
    "芜湖市", "镜湖区", "鸠江区", "弋江区", "湾沚区", "繁昌区", "南陵县", "无为市", "市辖区", "芜湖经济技术开发区", "安徽芜湖三山经济开发区"
  ],
  "蚌埠": [
    "蚌埠市", "龙子湖区", "蚌山区", "禹会区", "淮上区", "怀远县", "五河县", "固镇县", "市辖区", "蚌埠市高新技术开发区", "蚌埠市经济开发区"
  ],
  "淮南": [
    "淮南市", "大通区", "田家庵区", "谢家集区", "八公山区", "潘集区", "凤台县", "寿县", "市辖区"
  ],
  "马鞍山": [
    "马鞍山市", "花山区", "雨山区", "博望区", "当涂县", "含山县", "和县", "市辖区"
  ],
  "淮北": [
    "淮北市", "杜集区", "相山区", "烈山区", "濉溪县", "市辖区"
  ],
  "铜陵": [
    "铜陵市", "铜官区", "义安区", "郊区", "枞阳县", "市辖区"
  ],
  "安庆": [
    "安庆市", "迎江区", "大观区", "宜秀区", "怀宁县", "太湖县", "宿松县", "望江县", "岳西县", "桐城市", "潜山市", "市辖区",
    "安徽安庆经济开发区"
  ],
  "黄山": [
    "黄山市", "屯溪区", "黄山区", "徽州区", "歙县", "休宁县", "黟县", "祁门县", "市辖区"
  ],
  "滁州": [
    "滁州市", "琅琊区", "南谯区", "来安县", "全椒县", "定远县", "凤阳县", "天长市", "明光市", "市辖区", "中新苏滁高新技术产业开发区", "滁州经济技术开发区"
  ],
  "阜阳": [
    "阜阳市", "颍州区", "颍东区", "颍泉区", "临泉县", "太和县", "阜南县", "颍上县", "界首市", "市辖区", "阜阳合肥现代产业园区", "阜阳经济技术开发区"
  ],
  "宿州": [
    "宿州市", "埇桥区", "砀山县", "萧县", "灵璧县", "泗县", "市辖区", "宿州马鞍山现代产业园区", "宿州经济技术开发区"
  ],
  "六安": [
    "六安市", "金安区", "裕安区", "叶集区", "霍邱县", "舒城县", "金寨县", "霍山县", "市辖区"
  ],
  "亳州": [
    "亳州市", "谯城区", "涡阳县", "蒙城县", "利辛县", "市辖区"
  ],
  "池州": [
    "池州市", "贵池区", "东至县", "石台县", "青阳县", "市辖区"
  ],
  "宣城": [
    "宣城市", "宣州区", "郎溪县", "泾县", "绩溪县", "旌德县", "宁国市", "广德市", "市辖区", "宣城市经济开发区"
  ],
  // ===== 山东 =====
  "济南": [
    "济南市", "历下区", "市中区", "槐荫区", "天桥区", "历城区", "长清区", "章丘区", "济阳区", "莱芜区", "钢城区", "平阴县",
    "商河县", "市辖区", "济南高新技术产业开发区"
  ],
  "青岛": [
    "青岛市", "市南区", "市北区", "黄岛区", "崂山区", "李沧区", "城阳区", "即墨区", "胶州市", "平度市", "莱西市", "市辖区",
    "青岛高新技术产业开发区"
  ],
  "淄博": [
    "淄博市", "淄川区", "张店区", "博山区", "临淄区", "周村区", "桓台县", "高青县", "沂源县", "市辖区"
  ],
  "枣庄": [
    "枣庄市", "市中区", "薛城区", "峄城区", "台儿庄区", "山亭区", "滕州市", "市辖区"
  ],
  "东营": [
    "东营市", "东营区", "河口区", "垦利区", "利津县", "广饶县", "市辖区", "东营经济技术开发区", "东营港经济开发区"
  ],
  "烟台": [
    "烟台市", "芝罘区", "福山区", "牟平区", "莱山区", "蓬莱区", "龙口市", "莱阳市", "莱州市", "招远市", "栖霞市", "海阳市",
    "市辖区", "烟台高新技术产业开发区", "烟台经济技术开发区"
  ],
  "潍坊": [
    "潍坊市", "潍城区", "寒亭区", "坊子区", "奎文区", "临朐县", "昌乐县", "青州市", "诸城市", "寿光市", "安丘市", "高密市",
    "昌邑市", "市辖区", "潍坊滨海经济技术开发区"
  ],
  "济宁": [
    "济宁市", "任城区", "兖州区", "微山县", "鱼台县", "金乡县", "嘉祥县", "汶上县", "泗水县", "梁山县", "曲阜市", "邹城市",
    "市辖区", "济宁高新技术产业开发区"
  ],
  "泰安": [
    "泰安市", "泰山区", "岱岳区", "宁阳县", "东平县", "新泰市", "肥城市", "市辖区"
  ],
  "威海": [
    "威海市", "环翠区", "文登区", "荣成市", "乳山市", "市辖区", "威海火炬高技术产业开发区", "威海经济技术开发区", "威海临港经济技术开发区"
  ],
  "日照": [
    "日照市", "东港区", "岚山区", "五莲县", "莒县", "市辖区", "日照经济技术开发区"
  ],
  "临沂": [
    "临沂市", "兰山区", "罗庄区", "河东区", "沂南县", "郯城县", "沂水县", "兰陵县", "费县", "平邑县", "莒南县", "蒙阴县",
    "临沭县", "市辖区", "临沂高新技术产业开发区"
  ],
  "德州": [
    "德州市", "德城区", "陵城区", "宁津县", "庆云县", "临邑县", "齐河县", "平原县", "夏津县", "武城县", "乐陵市", "禹城市",
    "市辖区", "德州经济技术开发区", "德州运河经济开发区"
  ],
  "聊城": [
    "聊城市", "东昌府区", "茌平区", "阳谷县", "莘县", "东阿县", "冠县", "高唐县", "临清市", "市辖区"
  ],
  "滨州": [
    "滨州市", "滨城区", "沾化区", "惠民县", "阳信县", "无棣县", "博兴县", "邹平市", "市辖区"
  ],
  "菏泽": [
    "菏泽市", "牡丹区", "定陶区", "曹县", "单县", "成武县", "巨野县", "郓城县", "鄄城县", "东明县", "市辖区", "菏泽经济技术开发区",
    "菏泽高新技术开发区"
  ],
  // ===== 山西 =====
  "太原": [
    "太原市", "小店区", "迎泽区", "杏花岭区", "尖草坪区", "万柏林区", "晋源区", "清徐县", "阳曲县", "娄烦县", "古交市", "市辖区",
    "山西转型综合改革示范区"
  ],
  "大同": [
    "大同市", "新荣区", "平城区", "云冈区", "云州区", "阳高县", "天镇县", "广灵县", "灵丘县", "浑源县", "左云县", "市辖区",
    "山西大同经济开发区"
  ],
  "阳泉": [
    "阳泉市", "城区", "矿区", "郊区", "平定县", "盂县", "市辖区"
  ],
  "长治": [
    "长治市", "潞州区", "上党区", "屯留区", "潞城区", "襄垣县", "平顺县", "黎城县", "壶关县", "长子县", "武乡县", "沁县",
    "沁源县", "市辖区", "山西长治高新技术产业园区"
  ],
  "晋城": [
    "晋城市", "城区", "沁水县", "阳城县", "陵川县", "泽州县", "高平市", "市辖区"
  ],
  "朔州": [
    "朔州市", "朔城区", "平鲁区", "山阴县", "应县", "右玉县", "怀仁市", "市辖区", "山西朔州经济开发区"
  ],
  "晋中": [
    "晋中市", "榆次区", "太谷区", "榆社县", "左权县", "和顺县", "昔阳县", "寿阳县", "祁县", "平遥县", "灵石县", "介休市",
    "市辖区"
  ],
  "运城": [
    "运城市", "盐湖区", "临猗县", "万荣县", "闻喜县", "稷山县", "新绛县", "绛县", "垣曲县", "夏县", "平陆县", "芮城县",
    "永济市", "河津市", "市辖区"
  ],
  "忻州": [
    "忻州市", "忻府区", "定襄县", "五台县", "代县", "繁峙县", "宁武县", "静乐县", "神池县", "五寨县", "岢岚县", "河曲县",
    "保德县", "偏关县", "原平市", "市辖区", "五台山风景名胜区"
  ],
  "临汾": [
    "临汾市", "尧都区", "曲沃县", "翼城县", "襄汾县", "洪洞县", "古县", "安泽县", "浮山县", "吉县", "乡宁县", "大宁县",
    "隰县", "永和县", "蒲县", "汾西县", "侯马市", "霍州市", "市辖区"
  ],
  "吕梁": [
    "吕梁市", "离石区", "文水县", "交城县", "兴县", "临县", "柳林县", "石楼县", "岚县", "方山县", "中阳县", "交口县",
    "孝义市", "汾阳市", "市辖区"
  ],
  // ===== 广东 =====
  "广州": [
    "广州市", "荔湾区", "越秀区", "海珠区", "天河区", "白云区", "黄埔区", "番禺区", "花都区", "南沙区", "从化区", "增城区",
    "市辖区"
  ],
  "韶关": [
    "韶关市", "武江区", "浈江区", "曲江区", "始兴县", "仁化县", "翁源县", "乳源瑶族自治县", "新丰县", "乐昌市", "南雄市", "市辖区"
  ],
  "深圳": [
    "深圳市", "罗湖区", "福田区", "南山区", "宝安区", "龙岗区", "盐田区", "龙华区", "坪山区", "光明区", "市辖区"
  ],
  "珠海": [
    "珠海市", "香洲区", "斗门区", "金湾区", "市辖区"
  ],
  "汕头": [
    "汕头市", "龙湖区", "金平区", "濠江区", "潮阳区", "潮南区", "澄海区", "南澳县", "市辖区"
  ],
  "佛山": [
    "佛山市", "禅城区", "南海区", "顺德区", "三水区", "高明区", "市辖区"
  ],
  "江门": [
    "江门市", "蓬江区", "江海区", "新会区", "台山市", "开平市", "鹤山市", "恩平市", "市辖区"
  ],
  "湛江": [
    "湛江市", "赤坎区", "霞山区", "坡头区", "麻章区", "遂溪县", "徐闻县", "廉江市", "雷州市", "吴川市", "市辖区"
  ],
  "茂名": [
    "茂名市", "茂南区", "电白区", "高州市", "化州市", "信宜市", "市辖区"
  ],
  "肇庆": [
    "肇庆市", "端州区", "鼎湖区", "高要区", "广宁县", "怀集县", "封开县", "德庆县", "四会市", "市辖区"
  ],
  "惠州": [
    "惠州市", "惠城区", "惠阳区", "博罗县", "惠东县", "龙门县", "市辖区"
  ],
  "梅州": [
    "梅州市", "梅江区", "梅县区", "大埔县", "丰顺县", "五华县", "平远县", "蕉岭县", "兴宁市", "市辖区"
  ],
  "汕尾": [
    "汕尾市", "城区", "海丰县", "陆河县", "陆丰市", "市辖区"
  ],
  "河源": [
    "河源市", "源城区", "紫金县", "龙川县", "连平县", "和平县", "东源县", "市辖区"
  ],
  "阳江": [
    "阳江市", "江城区", "阳东区", "阳西县", "阳春市", "市辖区"
  ],
  "清远": [
    "清远市", "清城区", "清新区", "佛冈县", "阳山县", "连山壮族瑶族自治县", "连南瑶族自治县", "英德市", "连州市", "市辖区"
  ],
  "东莞": [
    "东莞市"
  ],
  "中山": [
    "中山市"
  ],
  "潮州": [
    "潮州市", "湘桥区", "潮安区", "饶平县", "市辖区"
  ],
  "揭阳": [
    "揭阳市", "榕城区", "揭东区", "揭西县", "惠来县", "普宁市", "市辖区"
  ],
  "云浮": [
    "云浮市", "云城区", "云安区", "新兴县", "郁南县", "罗定市", "市辖区"
  ],
  // ===== 广西壮族自治 =====
  "南宁": [
    "南宁市", "兴宁区", "青秀区", "江南区", "西乡塘区", "良庆区", "邕宁区", "武鸣区", "隆安县", "马山县", "上林县", "宾阳县",
    "横县", "市辖区", "横州市"
  ],
  "柳州": [
    "柳州市", "城中区", "鱼峰区", "柳南区", "柳北区", "柳江区", "柳城县", "鹿寨县", "融安县", "融水苗族自治县", "三江侗族自治县", "市辖区"
  ],
  "桂林": [
    "桂林市", "秀峰区", "叠彩区", "象山区", "七星区", "雁山区", "临桂区", "阳朔县", "灵川县", "全州县", "兴安县", "永福县",
    "灌阳县", "龙胜各族自治县", "资源县", "平乐县", "恭城瑶族自治县", "荔浦市", "市辖区"
  ],
  "梧州": [
    "梧州市", "万秀区", "长洲区", "龙圩区", "苍梧县", "藤县", "蒙山县", "岑溪市", "市辖区"
  ],
  "北海": [
    "北海市", "海城区", "银海区", "铁山港区", "合浦县", "市辖区"
  ],
  "防城港": [
    "防城港市", "港口区", "防城区", "上思县", "东兴市", "市辖区"
  ],
  "钦州": [
    "钦州市", "钦南区", "钦北区", "灵山县", "浦北县", "市辖区"
  ],
  "贵港": [
    "贵港市", "港北区", "港南区", "覃塘区", "平南县", "桂平市", "市辖区"
  ],
  "玉林": [
    "玉林市", "玉州区", "福绵区", "容县", "陆川县", "博白县", "兴业县", "北流市", "市辖区"
  ],
  "百色": [
    "百色市", "右江区", "田阳区", "田东县", "德保县", "那坡县", "凌云县", "乐业县", "田林县", "西林县", "隆林各族自治县", "靖西市",
    "平果市", "市辖区"
  ],
  "贺州": [
    "贺州市", "八步区", "平桂区", "昭平县", "钟山县", "富川瑶族自治县", "市辖区"
  ],
  "河池": [
    "河池市", "金城江区", "宜州区", "南丹县", "天峨县", "凤山县", "东兰县", "罗城仫佬族自治县", "环江毛南族自治县", "巴马瑶族自治县", "都安瑶族自治县", "大化瑶族自治县",
    "市辖区"
  ],
  "来宾": [
    "来宾市", "兴宾区", "忻城县", "象州县", "武宣县", "金秀瑶族自治县", "合山市", "市辖区"
  ],
  "崇左": [
    "崇左市", "江州区", "扶绥县", "宁明县", "龙州县", "大新县", "天等县", "凭祥市", "市辖区"
  ],
  // ===== 新疆维吾尔自治 =====
  "乌鲁木齐": [
    "乌鲁木齐市", "天山区", "沙依巴克区", "新市区", "水磨沟区", "头屯河区", "达坂城区", "米东区", "乌鲁木齐县", "市辖区"
  ],
  "克拉玛依": [
    "克拉玛依市", "独山子区", "克拉玛依区", "白碱滩区", "乌尔禾区", "市辖区"
  ],
  "吐鲁番": [
    "吐鲁番市", "高昌区", "鄯善县", "托克逊县"
  ],
  "哈密": [
    "哈密市", "伊州区", "巴里坤哈萨克自治县", "伊吾县"
  ],
  "昌吉": [
    "昌吉回族自治州", "昌吉市", "阜康市", "呼图壁县", "玛纳斯县", "奇台县", "吉木萨尔县", "木垒哈萨克自治县"
  ],
  "博尔塔拉": [
    "博尔塔拉蒙古自治州", "博乐市", "阿拉山口市", "精河县", "温泉县"
  ],
  "巴音郭楞": [
    "巴音郭楞蒙古自治州", "库尔勒市", "轮台县", "尉犁县", "若羌县", "且末县", "焉耆回族自治县", "和静县", "和硕县", "博湖县", "库尔勒经济技术开发区"
  ],
  "阿克苏": [
    "阿克苏地区", "阿克苏市", "库车市", "温宿县", "沙雅县", "新和县", "拜城县", "乌什县", "阿瓦提县", "柯坪县"
  ],
  "克孜勒苏": [
    "克孜勒苏柯尔克孜自治州", "阿图什市", "阿克陶县", "阿合奇县", "乌恰县"
  ],
  "喀什": [
    "喀什地区", "喀什市", "疏附县", "疏勒县", "英吉沙县", "泽普县", "莎车县", "叶城县", "麦盖提县", "岳普湖县", "伽师县", "巴楚县",
    "塔什库尔干塔吉克自治县"
  ],
  "和田": [
    "和田地区", "和田市", "和田县", "墨玉县", "皮山县", "洛浦县", "策勒县", "于田县", "民丰县"
  ],
  "伊犁": [
    "伊犁哈萨克自治州", "伊宁市", "奎屯市", "霍尔果斯市", "伊宁县", "察布查尔锡伯自治县", "霍城县", "巩留县", "新源县", "昭苏县", "特克斯县", "尼勒克县"
  ],
  "塔城": [
    "塔城地区", "塔城市", "乌苏市", "额敏县", "沙湾县", "托里县", "裕民县", "和布克赛尔蒙古自治县", "沙湾市"
  ],
  "阿勒泰": [
    "阿勒泰地区", "阿勒泰市", "布尔津县", "富蕴县", "福海县", "哈巴河县", "青河县", "吉木乃县"
  ],
  "新疆维吾尔自治区-自治区直辖县级行政区划": [
    "新疆维吾尔自治区-自治区直辖县级行政区划", "石河子市", "阿拉尔市", "图木舒克市", "五家渠市", "北屯市", "铁门关市", "双河市", "可克达拉市", "昆玉市", "胡杨河市", "新星市"
  ],
  // ===== 江苏 =====
  "南京": [
    "南京市", "玄武区", "秦淮区", "建邺区", "鼓楼区", "浦口区", "栖霞区", "雨花台区", "江宁区", "六合区", "溧水区", "高淳区",
    "市辖区"
  ],
  "无锡": [
    "无锡市", "锡山区", "惠山区", "滨湖区", "梁溪区", "新吴区", "江阴市", "宜兴市", "市辖区"
  ],
  "徐州": [
    "徐州市", "鼓楼区", "云龙区", "贾汪区", "泉山区", "铜山区", "丰县", "沛县", "睢宁县", "新沂市", "邳州市", "市辖区",
    "徐州经济技术开发区"
  ],
  "常州": [
    "常州市", "天宁区", "钟楼区", "新北区", "武进区", "金坛区", "溧阳市", "市辖区"
  ],
  "苏州": [
    "苏州市", "虎丘区", "吴中区", "相城区", "姑苏区", "吴江区", "常熟市", "张家港市", "昆山市", "太仓市", "市辖区", "苏州工业园区"
  ],
  "南通": [
    "南通市", "通州区", "崇川区", "海门区", "如东县", "启东市", "如皋市", "海安市", "市辖区", "南通经济技术开发区"
  ],
  "连云港": [
    "连云港市", "连云区", "海州区", "赣榆区", "东海县", "灌云县", "灌南县", "市辖区", "连云港经济技术开发区", "连云港高新技术产业开发区"
  ],
  "淮安": [
    "淮安市", "淮安区", "淮阴区", "清江浦区", "洪泽区", "涟水县", "盱眙县", "金湖县", "市辖区", "淮安经济技术开发区"
  ],
  "盐城": [
    "盐城市", "亭湖区", "盐都区", "大丰区", "响水县", "滨海县", "阜宁县", "射阳县", "建湖县", "东台市", "市辖区", "盐城经济技术开发区"
  ],
  "扬州": [
    "扬州市", "广陵区", "邗江区", "江都区", "宝应县", "仪征市", "高邮市", "市辖区", "扬州经济技术开发区"
  ],
  "镇江": [
    "镇江市", "京口区", "润州区", "丹徒区", "丹阳市", "扬中市", "句容市", "市辖区", "镇江新区"
  ],
  "泰州": [
    "泰州市", "海陵区", "高港区", "姜堰区", "兴化市", "靖江市", "泰兴市", "市辖区", "泰州医药高新技术产业开发区"
  ],
  "宿迁": [
    "宿迁市", "宿城区", "宿豫区", "沭阳县", "泗阳县", "泗洪县", "市辖区", "宿迁经济技术开发区"
  ],
  // ===== 江西 =====
  "南昌": [
    "南昌市", "东湖区", "西湖区", "青云谱区", "青山湖区", "新建区", "红谷滩区", "南昌县", "安义县", "进贤县", "市辖区"
  ],
  "景德镇": [
    "景德镇市", "昌江区", "珠山区", "浮梁县", "乐平市", "市辖区"
  ],
  "萍乡": [
    "萍乡市", "安源区", "湘东区", "莲花县", "上栗县", "芦溪县", "市辖区"
  ],
  "九江": [
    "九江市", "濂溪区", "浔阳区", "柴桑区", "武宁县", "修水县", "永修县", "德安县", "都昌县", "湖口县", "彭泽县", "瑞昌市",
    "共青城市", "庐山市", "市辖区"
  ],
  "新余": [
    "新余市", "渝水区", "分宜县", "市辖区"
  ],
  "鹰潭": [
    "鹰潭市", "月湖区", "余江区", "贵溪市", "市辖区"
  ],
  "赣州": [
    "赣州市", "章贡区", "南康区", "赣县区", "信丰县", "大余县", "上犹县", "崇义县", "安远县", "定南县", "全南县", "宁都县",
    "于都县", "兴国县", "会昌县", "寻乌县", "石城县", "瑞金市", "龙南市", "市辖区"
  ],
  "吉安": [
    "吉安市", "吉州区", "青原区", "吉安县", "吉水县", "峡江县", "新干县", "永丰县", "泰和县", "遂川县", "万安县", "安福县",
    "永新县", "井冈山市", "市辖区"
  ],
  "宜春": [
    "宜春市", "袁州区", "奉新县", "万载县", "上高县", "宜丰县", "靖安县", "铜鼓县", "丰城市", "樟树市", "高安市", "市辖区"
  ],
  "抚州": [
    "抚州市", "临川区", "东乡区", "南城县", "黎川县", "南丰县", "崇仁县", "乐安县", "宜黄县", "金溪县", "资溪县", "广昌县",
    "市辖区"
  ],
  "上饶": [
    "上饶市", "信州区", "广丰区", "广信区", "玉山县", "铅山县", "横峰县", "弋阳县", "余干县", "鄱阳县", "万年县", "婺源县",
    "德兴市", "市辖区"
  ],
  // ===== 河北 =====
  "石家庄": [
    "石家庄市", "长安区", "桥西区", "新华区", "井陉矿区", "裕华区", "藁城区", "鹿泉区", "栾城区", "井陉县", "正定县", "行唐县",
    "灵寿县", "高邑县", "深泽县", "赞皇县", "无极县", "平山县", "元氏县", "赵县", "辛集市", "晋州市", "新乐市", "市辖区",
    "石家庄高新技术产业开发区", "石家庄循环化工园区"
  ],
  "唐山": [
    "唐山市", "路南区", "路北区", "古冶区", "开平区", "丰南区", "丰润区", "曹妃甸区", "滦南县", "乐亭县", "迁西县", "玉田县",
    "遵化市", "迁安市", "滦州市", "市辖区", "河北唐山芦台经济开发区", "唐山市汉沽管理区", "唐山高新技术产业开发区", "河北唐山海港经济开发区"
  ],
  "秦皇岛": [
    "秦皇岛市", "海港区", "山海关区", "北戴河区", "抚宁区", "青龙满族自治县", "昌黎县", "卢龙县", "市辖区", "秦皇岛市经济技术开发区", "北戴河新区"
  ],
  "邯郸": [
    "邯郸市", "邯山区", "丛台区", "复兴区", "峰峰矿区", "肥乡区", "永年区", "临漳县", "成安县", "大名县", "涉县", "磁县",
    "邱县", "鸡泽县", "广平县", "馆陶县", "魏县", "曲周县", "武安市", "市辖区", "邯郸经济技术开发区", "邯郸冀南新区"
  ],
  "邢台": [
    "邢台市", "襄都区", "信都区", "任泽区", "南和区", "临城县", "内丘县", "柏乡县", "隆尧县", "宁晋县", "巨鹿县", "新河县",
    "广宗县", "平乡县", "威县", "清河县", "临西县", "南宫市", "沙河市", "市辖区", "河北邢台经济开发区"
  ],
  "保定": [
    "保定市", "竞秀区", "莲池区", "满城区", "清苑区", "徐水区", "涞水县", "阜平县", "定兴县", "唐县", "高阳县", "容城县",
    "涞源县", "望都县", "安新县", "易县", "曲阳县", "蠡县", "顺平县", "博野县", "雄县", "涿州市", "定州市", "安国市",
    "高碑店市", "市辖区", "保定高新技术产业开发区", "保定白沟新城"
  ],
  "张家口": [
    "张家口市", "桥东区", "桥西区", "宣化区", "下花园区", "万全区", "崇礼区", "张北县", "康保县", "沽源县", "尚义县", "蔚县",
    "阳原县", "怀安县", "怀来县", "涿鹿县", "赤城县", "市辖区", "张家口经济开发区", "张家口市察北管理区", "张家口市塞北管理区"
  ],
  "承德": [
    "承德市", "双桥区", "双滦区", "鹰手营子矿区", "承德县", "兴隆县", "滦平县", "隆化县", "丰宁满族自治县", "宽城满族自治县", "围场满族蒙古族自治县", "平泉市",
    "市辖区", "承德高新技术产业开发区"
  ],
  "沧州": [
    "沧州市", "新华区", "运河区", "沧县", "青县", "东光县", "海兴县", "盐山县", "肃宁县", "南皮县", "吴桥县", "献县",
    "孟村回族自治县", "泊头市", "任丘市", "黄骅市", "河间市", "市辖区", "河北沧州经济开发区", "沧州高新技术产业开发区", "沧州渤海新区"
  ],
  "廊坊": [
    "廊坊市", "安次区", "广阳区", "固安县", "永清县", "香河县", "大城县", "文安县", "大厂回族自治县", "霸州市", "三河市", "市辖区",
    "廊坊经济技术开发区"
  ],
  "衡水": [
    "衡水市", "桃城区", "冀州区", "枣强县", "武邑县", "武强县", "饶阳县", "安平县", "故城县", "景县", "阜城县", "深州市",
    "市辖区", "河北衡水高新技术产业开发区", "衡水滨湖新区"
  ],
  // ===== 河南 =====
  "郑州": [
    "郑州市", "中原区", "二七区", "管城回族区", "金水区", "上街区", "惠济区", "中牟县", "巩义市", "荥阳市", "新密市", "新郑市",
    "登封市", "市辖区", "郑州经济技术开发区", "郑州高新技术产业开发区", "郑州航空港经济综合实验区"
  ],
  "开封": [
    "开封市", "龙亭区", "顺河回族区", "鼓楼区", "禹王台区", "祥符区", "杞县", "通许县", "尉氏县", "兰考县", "市辖区"
  ],
  "洛阳": [
    "洛阳市", "老城区", "西工区", "瀍河回族区", "涧西区", "吉利区", "洛龙区", "孟津县", "新安县", "栾川县", "嵩县", "汝阳县",
    "宜阳县", "洛宁县", "伊川县", "偃师市", "市辖区", "偃师区", "孟津区", "洛阳高新技术产业开发区"
  ],
  "平顶山": [
    "平顶山市", "新华区", "卫东区", "石龙区", "湛河区", "宝丰县", "叶县", "鲁山县", "郏县", "舞钢市", "汝州市", "市辖区",
    "平顶山高新技术产业开发区", "平顶山市城乡一体化示范区"
  ],
  "安阳": [
    "安阳市", "文峰区", "北关区", "殷都区", "龙安区", "安阳县", "汤阴县", "滑县", "内黄县", "林州市", "市辖区", "安阳高新技术产业开发区"
  ],
  "鹤壁": [
    "鹤壁市", "鹤山区", "山城区", "淇滨区", "浚县", "淇县", "市辖区", "鹤壁经济技术开发区"
  ],
  "新乡": [
    "新乡市", "红旗区", "卫滨区", "凤泉区", "牧野区", "新乡县", "获嘉县", "原阳县", "延津县", "封丘县", "卫辉市", "辉县市",
    "长垣市", "市辖区", "新乡高新技术产业开发区", "新乡经济技术开发区", "新乡市平原城乡一体化示范区"
  ],
  "焦作": [
    "焦作市", "解放区", "中站区", "马村区", "山阳区", "修武县", "博爱县", "武陟县", "温县", "沁阳市", "孟州市", "市辖区",
    "焦作城乡一体化示范区"
  ],
  "濮阳": [
    "濮阳市", "华龙区", "清丰县", "南乐县", "范县", "台前县", "濮阳县", "市辖区", "河南濮阳工业园区", "濮阳经济技术开发区"
  ],
  "许昌": [
    "许昌市", "魏都区", "建安区", "鄢陵县", "襄城县", "禹州市", "长葛市", "市辖区", "许昌经济技术开发区"
  ],
  "漯河": [
    "漯河市", "源汇区", "郾城区", "召陵区", "舞阳县", "临颍县", "市辖区", "漯河经济技术开发区"
  ],
  "三门峡": [
    "三门峡市", "湖滨区", "陕州区", "渑池县", "卢氏县", "义马市", "灵宝市", "市辖区", "河南三门峡经济开发区"
  ],
  "南阳": [
    "南阳市", "宛城区", "卧龙区", "南召县", "方城县", "西峡县", "镇平县", "内乡县", "淅川县", "社旗县", "唐河县", "新野县",
    "桐柏县", "邓州市", "市辖区", "南阳高新技术产业开发区", "南阳市城乡一体化示范区"
  ],
  "商丘": [
    "商丘市", "梁园区", "睢阳区", "民权县", "睢县", "宁陵县", "柘城县", "虞城县", "夏邑县", "永城市", "市辖区", "豫东综合物流产业聚集区",
    "河南商丘经济开发区"
  ],
  "信阳": [
    "信阳市", "浉河区", "平桥区", "罗山县", "光山县", "新县", "商城县", "固始县", "潢川县", "淮滨县", "息县", "市辖区",
    "信阳高新技术产业开发区"
  ],
  "周口": [
    "周口市", "川汇区", "淮阳区", "扶沟县", "西华县", "商水县", "沈丘县", "郸城县", "太康县", "鹿邑县", "项城市", "市辖区",
    "河南周口经济开发区"
  ],
  "驻马店": [
    "驻马店市", "驿城区", "西平县", "上蔡县", "平舆县", "正阳县", "确山县", "泌阳县", "汝南县", "遂平县", "新蔡县", "市辖区",
    "河南驻马店经济开发区"
  ],
  "河南省-省直辖县级行政区划": [
    "河南省-省直辖县级行政区划", "济源市"
  ],
  // ===== 浙江 =====
  "杭州": [
    "杭州市", "上城区", "下城区", "江干区", "拱墅区", "西湖区", "滨江区", "萧山区", "余杭区", "富阳区", "临安区", "桐庐县",
    "淳安县", "建德市", "市辖区", "临平区", "钱塘区"
  ],
  "宁波": [
    "宁波市", "海曙区", "江北区", "北仑区", "镇海区", "鄞州区", "奉化区", "象山县", "宁海县", "余姚市", "慈溪市", "市辖区"
  ],
  "温州": [
    "温州市", "鹿城区", "龙湾区", "瓯海区", "洞头区", "永嘉县", "平阳县", "苍南县", "文成县", "泰顺县", "瑞安市", "乐清市",
    "龙港市", "市辖区", "温州经济技术开发区"
  ],
  "嘉兴": [
    "嘉兴市", "南湖区", "秀洲区", "嘉善县", "海盐县", "海宁市", "平湖市", "桐乡市", "市辖区"
  ],
  "湖州": [
    "湖州市", "吴兴区", "南浔区", "德清县", "长兴县", "安吉县", "市辖区"
  ],
  "绍兴": [
    "绍兴市", "越城区", "柯桥区", "上虞区", "新昌县", "诸暨市", "嵊州市", "市辖区"
  ],
  "金华": [
    "金华市", "婺城区", "金东区", "武义县", "浦江县", "磐安县", "兰溪市", "义乌市", "东阳市", "永康市", "市辖区"
  ],
  "衢州": [
    "衢州市", "柯城区", "衢江区", "常山县", "开化县", "龙游县", "江山市", "市辖区"
  ],
  "舟山": [
    "舟山市", "定海区", "普陀区", "岱山县", "嵊泗县", "市辖区"
  ],
  "台州": [
    "台州市", "椒江区", "黄岩区", "路桥区", "三门县", "天台县", "仙居县", "温岭市", "临海市", "玉环市", "市辖区"
  ],
  "丽水": [
    "丽水市", "莲都区", "青田县", "缙云县", "遂昌县", "松阳县", "云和县", "庆元县", "景宁畲族自治县", "龙泉市", "市辖区"
  ],
  // ===== 海南 =====
  "海口": [
    "海口市", "秀英区", "龙华区", "琼山区", "美兰区", "市辖区"
  ],
  "三亚": [
    "三亚市", "海棠区", "吉阳区", "天涯区", "崖州区", "市辖区"
  ],
  "三沙": [
    "三沙市", "西沙群岛", "南沙群岛", "中沙群岛的岛礁及其海域"
  ],
  "儋州": [
    "儋州市"
  ],
  "海南省-自治区直辖县级行政区划": [
    "海南省-自治区直辖县级行政区划", "五指山市", "琼海市", "文昌市", "万宁市", "东方市", "定安县", "屯昌县", "澄迈县", "临高县", "白沙黎族自治县", "昌江黎族自治县",
    "乐东黎族自治县", "陵水黎族自治县", "保亭黎族苗族自治县", "琼中黎族苗族自治县"
  ],
  // ===== 湖北 =====
  "武汉": [
    "武汉市", "江岸区", "江汉区", "硚口区", "汉阳区", "武昌区", "青山区", "洪山区", "东西湖区", "汉南区", "蔡甸区", "江夏区",
    "黄陂区", "新洲区", "市辖区"
  ],
  "黄石": [
    "黄石市", "黄石港区", "西塞山区", "下陆区", "铁山区", "阳新县", "大冶市", "市辖区"
  ],
  "十堰": [
    "十堰市", "茅箭区", "张湾区", "郧阳区", "郧西县", "竹山县", "竹溪县", "房县", "丹江口市", "市辖区"
  ],
  "宜昌": [
    "宜昌市", "西陵区", "伍家岗区", "点军区", "猇亭区", "夷陵区", "远安县", "兴山县", "秭归县", "长阳土家族自治县", "五峰土家族自治县", "宜都市",
    "当阳市", "枝江市", "市辖区"
  ],
  "襄阳": [
    "襄阳市", "襄城区", "樊城区", "襄州区", "南漳县", "谷城县", "保康县", "老河口市", "枣阳市", "宜城市", "市辖区"
  ],
  "鄂州": [
    "鄂州市", "梁子湖区", "华容区", "鄂城区", "市辖区"
  ],
  "荆门": [
    "荆门市", "东宝区", "掇刀区", "沙洋县", "钟祥市", "京山市", "市辖区"
  ],
  "孝感": [
    "孝感市", "孝南区", "孝昌县", "大悟县", "云梦县", "应城市", "安陆市", "汉川市", "市辖区"
  ],
  "荆州": [
    "荆州市", "沙市区", "荆州区", "公安县", "江陵县", "石首市", "洪湖市", "松滋市", "监利市", "市辖区", "荆州经济技术开发区"
  ],
  "黄冈": [
    "黄冈市", "黄州区", "团风县", "红安县", "罗田县", "英山县", "浠水县", "蕲春县", "黄梅县", "麻城市", "武穴市", "市辖区",
    "龙感湖管理区"
  ],
  "咸宁": [
    "咸宁市", "咸安区", "嘉鱼县", "通城县", "崇阳县", "通山县", "赤壁市", "市辖区"
  ],
  "随州": [
    "随州市", "曾都区", "随县", "广水市", "市辖区"
  ],
  "恩施": [
    "恩施土家族苗族自治州", "恩施市", "利川市", "建始县", "巴东县", "宣恩县", "咸丰县", "来凤县", "鹤峰县"
  ],
  "湖北省-自治区直辖县级行政区划": [
    "湖北省-自治区直辖县级行政区划", "仙桃市", "潜江市", "天门市", "神农架林区"
  ],
  // ===== 湖南 =====
  "长沙": [
    "长沙市", "芙蓉区", "天心区", "岳麓区", "开福区", "雨花区", "望城区", "长沙县", "浏阳市", "宁乡市", "市辖区"
  ],
  "株洲": [
    "株洲市", "荷塘区", "芦淞区", "石峰区", "天元区", "渌口区", "攸县", "茶陵县", "炎陵县", "醴陵市", "市辖区", "云龙示范区"
  ],
  "湘潭": [
    "湘潭市", "雨湖区", "岳塘区", "湘潭县", "湘乡市", "韶山市", "市辖区", "湖南湘潭高新技术产业园区", "湘潭昭山示范区", "湘潭九华示范区"
  ],
  "衡阳": [
    "衡阳市", "珠晖区", "雁峰区", "石鼓区", "蒸湘区", "南岳区", "衡阳县", "衡南县", "衡山县", "衡东县", "祁东县", "耒阳市",
    "常宁市", "市辖区", "衡阳综合保税区", "湖南衡阳高新技术产业园区", "湖南衡阳松木经济开发区"
  ],
  "邵阳": [
    "邵阳市", "双清区", "大祥区", "北塔区", "新邵县", "邵阳县", "隆回县", "洞口县", "绥宁县", "新宁县", "城步苗族自治县", "武冈市",
    "邵东市", "市辖区"
  ],
  "岳阳": [
    "岳阳市", "岳阳楼区", "云溪区", "君山区", "岳阳县", "华容县", "湘阴县", "平江县", "汨罗市", "临湘市", "市辖区", "岳阳市屈原管理区"
  ],
  "常德": [
    "常德市", "武陵区", "鼎城区", "安乡县", "汉寿县", "澧县", "临澧县", "桃源县", "石门县", "津市市", "市辖区", "常德市西洞庭管理区"
  ],
  "张家界": [
    "张家界市", "永定区", "武陵源区", "慈利县", "桑植县", "市辖区"
  ],
  "益阳": [
    "益阳市", "资阳区", "赫山区", "南县", "桃江县", "安化县", "沅江市", "市辖区", "益阳市大通湖管理区", "湖南益阳高新技术产业园区"
  ],
  "郴州": [
    "郴州市", "北湖区", "苏仙区", "桂阳县", "宜章县", "永兴县", "嘉禾县", "临武县", "汝城县", "桂东县", "安仁县", "资兴市",
    "市辖区"
  ],
  "永州": [
    "永州市", "零陵区", "冷水滩区", "祁阳县", "东安县", "双牌县", "道县", "江永县", "宁远县", "蓝山县", "新田县", "江华瑶族自治县",
    "市辖区", "永州经济技术开发区", "永州市回龙圩管理区", "祁阳市"
  ],
  "怀化": [
    "怀化市", "鹤城区", "中方县", "沅陵县", "辰溪县", "溆浦县", "会同县", "麻阳苗族自治县", "新晃侗族自治县", "芷江侗族自治县", "靖州苗族侗族自治县", "通道侗族自治县",
    "洪江市", "市辖区", "怀化市洪江管理区"
  ],
  "娄底": [
    "娄底市", "娄星区", "双峰县", "新化县", "冷水江市", "涟源市", "市辖区"
  ],
  "湘西": [
    "湘西土家族苗族自治州", "吉首市", "泸溪县", "凤凰县", "花垣县", "保靖县", "古丈县", "永顺县", "龙山县"
  ],
  // ===== 甘肃 =====
  "兰州": [
    "兰州市", "城关区", "七里河区", "西固区", "安宁区", "红古区", "永登县", "皋兰县", "榆中县", "市辖区", "兰州新区"
  ],
  "嘉峪关": [
    "嘉峪关市", "市辖区"
  ],
  "金昌": [
    "金昌市", "金川区", "永昌县", "市辖区"
  ],
  "白银": [
    "白银市", "白银区", "平川区", "靖远县", "会宁县", "景泰县", "市辖区"
  ],
  "天水": [
    "天水市", "秦州区", "麦积区", "清水县", "秦安县", "甘谷县", "武山县", "张家川回族自治县", "市辖区"
  ],
  "武威": [
    "武威市", "凉州区", "民勤县", "古浪县", "天祝藏族自治县", "市辖区"
  ],
  "张掖": [
    "张掖市", "甘州区", "肃南裕固族自治县", "民乐县", "临泽县", "高台县", "山丹县", "市辖区"
  ],
  "平凉": [
    "平凉市", "崆峒区", "泾川县", "灵台县", "崇信县", "庄浪县", "静宁县", "华亭市", "市辖区"
  ],
  "酒泉": [
    "酒泉市", "肃州区", "金塔县", "瓜州县", "肃北蒙古族自治县", "阿克塞哈萨克族自治县", "玉门市", "敦煌市", "市辖区"
  ],
  "庆阳": [
    "庆阳市", "西峰区", "庆城县", "环县", "华池县", "合水县", "正宁县", "宁县", "镇原县", "市辖区"
  ],
  "定西": [
    "定西市", "安定区", "通渭县", "陇西县", "渭源县", "临洮县", "漳县", "岷县", "市辖区"
  ],
  "陇南": [
    "陇南市", "武都区", "成县", "文县", "宕昌县", "康县", "西和县", "礼县", "徽县", "两当县", "市辖区"
  ],
  "临夏": [
    "临夏回族自治州", "临夏市", "临夏县", "康乐县", "永靖县", "广河县", "和政县", "东乡族自治县", "积石山保安族东乡族撒拉族自治县"
  ],
  "甘南": [
    "甘南藏族自治州", "合作市", "临潭县", "卓尼县", "舟曲县", "迭部县", "玛曲县", "碌曲县", "夏河县"
  ],
  // ===== 福建 =====
  "福州": [
    "福州市", "鼓楼区", "台江区", "仓山区", "马尾区", "晋安区", "长乐区", "闽侯县", "连江县", "罗源县", "闽清县", "永泰县",
    "平潭县", "福清市", "市辖区"
  ],
  "厦门": [
    "厦门市", "思明区", "海沧区", "湖里区", "集美区", "同安区", "翔安区", "市辖区"
  ],
  "莆田": [
    "莆田市", "城厢区", "涵江区", "荔城区", "秀屿区", "仙游县", "市辖区"
  ],
  "三明": [
    "三明市", "梅列区", "三元区", "明溪县", "清流县", "宁化县", "大田县", "尤溪县", "沙县", "将乐县", "泰宁县", "建宁县",
    "永安市", "市辖区", "沙县区"
  ],
  "泉州": [
    "泉州市", "鲤城区", "丰泽区", "洛江区", "泉港区", "惠安县", "安溪县", "永春县", "德化县", "金门县", "石狮市", "晋江市",
    "南安市", "市辖区"
  ],
  "漳州": [
    "漳州市", "芗城区", "龙文区", "云霄县", "漳浦县", "诏安县", "长泰县", "东山县", "南靖县", "平和县", "华安县", "龙海市",
    "市辖区", "龙海区", "长泰区"
  ],
  "南平": [
    "南平市", "延平区", "建阳区", "顺昌县", "浦城县", "光泽县", "松溪县", "政和县", "邵武市", "武夷山市", "建瓯市", "市辖区"
  ],
  "龙岩": [
    "龙岩市", "新罗区", "永定区", "长汀县", "上杭县", "武平县", "连城县", "漳平市", "市辖区"
  ],
  "宁德": [
    "宁德市", "蕉城区", "霞浦县", "古田县", "屏南县", "寿宁县", "周宁县", "柘荣县", "福安市", "福鼎市", "市辖区"
  ],
  // ===== 西藏自治 =====
  "拉萨": [
    "拉萨市", "城关区", "堆龙德庆区", "达孜区", "林周县", "当雄县", "尼木县", "曲水县", "墨竹工卡县", "市辖区", "格尔木藏青工业园区", "拉萨经济技术开发区",
    "西藏文化旅游创意园区", "达孜工业园区"
  ],
  "日喀则": [
    "日喀则市", "桑珠孜区", "南木林县", "江孜县", "定日县", "萨迦县", "拉孜县", "昂仁县", "谢通门县", "白朗县", "仁布县", "康马县",
    "定结县", "仲巴县", "亚东县", "吉隆县", "聂拉木县", "萨嘎县", "岗巴县"
  ],
  "昌都": [
    "昌都市", "卡若区", "江达县", "贡觉县", "类乌齐县", "丁青县", "察雅县", "八宿县", "左贡县", "芒康县", "洛隆县", "边坝县"
  ],
  "林芝": [
    "林芝市", "巴宜区", "工布江达县", "米林县", "墨脱县", "波密县", "察隅县", "朗县"
  ],
  "山南": [
    "山南市", "乃东区", "扎囊县", "贡嘎县", "桑日县", "琼结县", "曲松县", "措美县", "洛扎县", "加查县", "隆子县", "错那县",
    "浪卡子县", "市辖区"
  ],
  "那曲": [
    "那曲市", "色尼区", "嘉黎县", "比如县", "聂荣县", "安多县", "申扎县", "索县", "班戈县", "巴青县", "尼玛县", "双湖县"
  ],
  "阿里": [
    "阿里地区", "普兰县", "札达县", "噶尔县", "日土县", "革吉县", "改则县", "措勤县"
  ],
  // ===== 贵州 =====
  "贵阳": [
    "贵阳市", "南明区", "云岩区", "花溪区", "乌当区", "白云区", "观山湖区", "开阳县", "息烽县", "修文县", "清镇市", "市辖区"
  ],
  "六盘水": [
    "六盘水市", "钟山区", "六枝特区", "水城区", "盘州市"
  ],
  "遵义": [
    "遵义市", "红花岗区", "汇川区", "播州区", "桐梓县", "绥阳县", "正安县", "道真仡佬族苗族自治县", "务川仡佬族苗族自治县", "凤冈县", "湄潭县", "余庆县",
    "习水县", "赤水市", "仁怀市", "市辖区"
  ],
  "安顺": [
    "安顺市", "西秀区", "平坝区", "普定县", "镇宁布依族苗族自治县", "关岭布依族苗族自治县", "紫云苗族布依族自治县", "市辖区"
  ],
  "毕节": [
    "毕节市", "七星关区", "大方县", "黔西县", "金沙县", "织金县", "纳雍县", "威宁彝族回族苗族自治县", "赫章县", "市辖区", "黔西市"
  ],
  "铜仁": [
    "铜仁市", "碧江区", "万山区", "江口县", "玉屏侗族自治县", "石阡县", "思南县", "印江土家族苗族自治县", "德江县", "沿河土家族自治县", "松桃苗族自治县", "市辖区"
  ],
  "黔西南": [
    "黔西南布依族苗族自治州", "兴义市", "兴仁市", "普安县", "晴隆县", "贞丰县", "望谟县", "册亨县", "安龙县"
  ],
  "黔东南": [
    "黔东南苗族侗族自治州", "凯里市", "黄平县", "施秉县", "三穗县", "镇远县", "岑巩县", "天柱县", "锦屏县", "剑河县", "台江县", "黎平县",
    "榕江县", "从江县", "雷山县", "麻江县", "丹寨县"
  ],
  "黔南": [
    "黔南布依族苗族自治州", "都匀市", "福泉市", "荔波县", "贵定县", "瓮安县", "独山县", "平塘县", "罗甸县", "长顺县", "龙里县", "惠水县",
    "三都水族自治县"
  ],
  // ===== 辽宁 =====
  "沈阳": [
    "沈阳市", "和平区", "沈河区", "大东区", "皇姑区", "铁西区", "苏家屯区", "浑南区", "沈北新区", "于洪区", "辽中区", "康平县",
    "法库县", "新民市", "市辖区"
  ],
  "大连": [
    "大连市", "中山区", "西岗区", "沙河口区", "甘井子区", "旅顺口区", "金州区", "普兰店区", "长海县", "瓦房店市", "庄河市", "市辖区"
  ],
  "鞍山": [
    "鞍山市", "铁东区", "铁西区", "立山区", "千山区", "台安县", "岫岩满族自治县", "海城市", "市辖区"
  ],
  "抚顺": [
    "抚顺市", "新抚区", "东洲区", "望花区", "顺城区", "抚顺县", "新宾满族自治县", "清原满族自治县", "市辖区"
  ],
  "本溪": [
    "本溪市", "平山区", "溪湖区", "明山区", "南芬区", "本溪满族自治县", "桓仁满族自治县", "市辖区"
  ],
  "丹东": [
    "丹东市", "元宝区", "振兴区", "振安区", "宽甸满族自治县", "东港市", "凤城市", "市辖区"
  ],
  "锦州": [
    "锦州市", "古塔区", "凌河区", "太和区", "黑山县", "义县", "凌海市", "北镇市", "市辖区"
  ],
  "营口": [
    "营口市", "站前区", "西市区", "鲅鱼圈区", "老边区", "盖州市", "大石桥市", "市辖区"
  ],
  "阜新": [
    "阜新市", "海州区", "新邱区", "太平区", "清河门区", "细河区", "阜新蒙古族自治县", "彰武县", "市辖区"
  ],
  "辽阳": [
    "辽阳市", "白塔区", "文圣区", "宏伟区", "弓长岭区", "太子河区", "辽阳县", "灯塔市", "市辖区"
  ],
  "盘锦": [
    "盘锦市", "双台子区", "兴隆台区", "大洼区", "盘山县", "市辖区"
  ],
  "铁岭": [
    "铁岭市", "银州区", "清河区", "铁岭县", "西丰县", "昌图县", "调兵山市", "开原市", "市辖区"
  ],
  "朝阳": [
    "朝阳市", "双塔区", "龙城区", "朝阳县", "建平县", "喀喇沁左翼蒙古族自治县", "北票市", "凌源市", "市辖区"
  ],
  "葫芦岛": [
    "葫芦岛市", "连山区", "龙港区", "南票区", "绥中县", "建昌县", "兴城市", "市辖区"
  ],
  // ===== 陕西 =====
  "西安": [
    "西安市", "新城区", "碑林区", "莲湖区", "灞桥区", "未央区", "雁塔区", "阎良区", "临潼区", "长安区", "高陵区", "鄠邑区",
    "蓝田县", "周至县", "市辖区"
  ],
  "铜川": [
    "铜川市", "王益区", "印台区", "耀州区", "宜君县", "市辖区"
  ],
  "宝鸡": [
    "宝鸡市", "渭滨区", "金台区", "陈仓区", "凤翔县", "岐山县", "扶风县", "眉县", "陇县", "千阳县", "麟游县", "凤县",
    "太白县", "市辖区", "凤翔区"
  ],
  "咸阳": [
    "咸阳市", "秦都区", "杨陵区", "渭城区", "三原县", "泾阳县", "乾县", "礼泉县", "永寿县", "长武县", "旬邑县", "淳化县",
    "武功县", "兴平市", "彬州市", "市辖区"
  ],
  "渭南": [
    "渭南市", "临渭区", "华州区", "潼关县", "大荔县", "合阳县", "澄城县", "蒲城县", "白水县", "富平县", "韩城市", "华阴市",
    "市辖区"
  ],
  "延安": [
    "延安市", "宝塔区", "安塞区", "延长县", "延川县", "志丹县", "吴起县", "甘泉县", "富县", "洛川县", "宜川县", "黄龙县",
    "黄陵县", "子长市", "市辖区"
  ],
  "汉中": [
    "汉中市", "汉台区", "南郑区", "城固县", "洋县", "西乡县", "勉县", "宁强县", "略阳县", "镇巴县", "留坝县", "佛坪县",
    "市辖区"
  ],
  "榆林": [
    "榆林市", "榆阳区", "横山区", "府谷县", "靖边县", "定边县", "绥德县", "米脂县", "佳县", "吴堡县", "清涧县", "子洲县",
    "神木市", "市辖区"
  ],
  "安康": [
    "安康市", "汉滨区", "汉阴县", "石泉县", "宁陕县", "紫阳县", "岚皋县", "平利县", "镇坪县", "旬阳县", "白河县", "市辖区",
    "旬阳市"
  ],
  "商洛": [
    "商洛市", "商州区", "洛南县", "丹凤县", "商南县", "山阳县", "镇安县", "柞水县", "市辖区"
  ],
  // ===== 青海 =====
  "西宁": [
    "西宁市", "城东区", "城中区", "城西区", "城北区", "湟中区", "大通回族土族自治县", "湟源县", "市辖区"
  ],
  "海东": [
    "海东市", "乐都区", "平安区", "民和回族土族自治县", "互助土族自治县", "化隆回族自治县", "循化撒拉族自治县"
  ],
  "海北": [
    "海北藏族自治州", "门源回族自治县", "祁连县", "海晏县", "刚察县"
  ],
  "黄南": [
    "黄南藏族自治州", "同仁市", "尖扎县", "泽库县", "河南蒙古族自治县"
  ],
  "海南": [
    "海南藏族自治州", "共和县", "同德县", "贵德县", "兴海县", "贵南县"
  ],
  "果洛": [
    "果洛藏族自治州", "玛沁县", "班玛县", "甘德县", "达日县", "久治县", "玛多县"
  ],
  "玉树": [
    "玉树藏族自治州", "玉树市", "杂多县", "称多县", "治多县", "囊谦县", "曲麻莱县"
  ],
  "海西": [
    "海西蒙古族藏族自治州", "格尔木市", "德令哈市", "茫崖市", "乌兰县", "都兰县", "天峻县", "大柴旦行政委员会"
  ],
  // ===== 黑龙江 =====
  "哈尔滨": [
    "哈尔滨市", "道里区", "南岗区", "道外区", "平房区", "松北区", "香坊区", "呼兰区", "阿城区", "双城区", "依兰县", "方正县",
    "宾县", "巴彦县", "木兰县", "通河县", "延寿县", "尚志市", "五常市", "市辖区"
  ],
  "齐齐哈尔": [
    "齐齐哈尔市", "龙沙区", "建华区", "铁锋区", "昂昂溪区", "富拉尔基区", "碾子山区", "梅里斯达斡尔族区", "龙江县", "依安县", "泰来县", "甘南县",
    "富裕县", "克山县", "克东县", "拜泉县", "讷河市", "市辖区"
  ],
  "鸡西": [
    "鸡西市", "鸡冠区", "恒山区", "滴道区", "梨树区", "城子河区", "麻山区", "鸡东县", "虎林市", "密山市", "市辖区"
  ],
  "鹤岗": [
    "鹤岗市", "向阳区", "工农区", "南山区", "兴安区", "东山区", "兴山区", "萝北县", "绥滨县", "市辖区"
  ],
  "双鸭山": [
    "双鸭山市", "尖山区", "岭东区", "四方台区", "宝山区", "集贤县", "友谊县", "宝清县", "饶河县", "市辖区"
  ],
  "大庆": [
    "大庆市", "萨尔图区", "龙凤区", "让胡路区", "红岗区", "大同区", "肇州县", "肇源县", "林甸县", "杜尔伯特蒙古族自治县", "市辖区", "大庆高新技术产业开发区"
  ],
  "伊春": [
    "伊春市", "伊美区", "乌翠区", "友好区", "嘉荫县", "汤旺县", "丰林县", "大箐山县", "南岔县", "金林区", "铁力市", "市辖区"
  ],
  "佳木斯": [
    "佳木斯市", "向阳区", "前进区", "东风区", "郊区", "桦南县", "桦川县", "汤原县", "同江市", "富锦市", "抚远市", "市辖区"
  ],
  "七台河": [
    "七台河市", "新兴区", "桃山区", "茄子河区", "勃利县", "市辖区"
  ],
  "牡丹江": [
    "牡丹江市", "东安区", "阳明区", "爱民区", "西安区", "林口县", "绥芬河市", "海林市", "宁安市", "穆棱市", "东宁市", "市辖区",
    "牡丹江经济技术开发区"
  ],
  "黑河": [
    "黑河市", "爱辉区", "逊克县", "孙吴县", "北安市", "五大连池市", "嫩江市", "市辖区"
  ],
  "绥化": [
    "绥化市", "北林区", "望奎县", "兰西县", "青冈县", "庆安县", "明水县", "绥棱县", "安达市", "肇东市", "海伦市", "市辖区"
  ],
  "大兴安岭": [
    "大兴安岭地区", "漠河市", "呼玛县", "塔河县", "加格达奇区", "松岭区", "新林区", "呼中区"
  ],
};

// 同名区县不能在缺少省/地市上下文时猜归属。例如“城区”同时属于阳泉、晋城，
// “市中区”同时属于乐山、内江等城市。只允许全国唯一归属的区县参与地级市扩展；
// 重名区县仍可通过标题/地区字段中直接出现的地级市名称命中，避免以召回率换准确率。
const DISTRICT_PREFECTURE_OWNERS = new Map();
for (const [prefecture, districts] of Object.entries(PREFECTURE_DISTRICTS)) {
  for (const district of districts) {
    const key = normalizeArea(district);
    if (!key) continue;
    if (!DISTRICT_PREFECTURE_OWNERS.has(key)) DISTRICT_PREFECTURE_OWNERS.set(key, new Set());
    DISTRICT_PREFECTURE_OWNERS.get(key).add(prefecture);
  }
}
// 2026-08-16 V4A：自治州/地区全名别名索引——表键是短名（大理/红河/临夏…），用户按官方全名
//（如"大理白族自治州"）筛选时 normalizeArea 剥"自治州"后缀得"大理白族"，查表 miss
//（实测大理/红河/文山/德宏/怒江/迪庆/临夏 7 州失配，云南甘肃按全名筛静默 0 条）。
// 每键 districts[0]（州/市全名）剥后缀后作为附加键指向同一张表。
// ⚠ 必须放在 DISTRICT_PREFECTURE_OWNERS 构建之后：别名键若先入表，其区县会被 OWNERS 二次注册
//（owner 集={原市,别名} size=2），被下方唯一归属过滤整体误清（调试实测）。
for (const _p of Object.keys(PREFECTURE_DISTRICTS)) {
  const _full = normalizeArea((PREFECTURE_DISTRICTS[_p] || [])[0] || "");
  if (_full && _full !== _p && !PREFECTURE_DISTRICTS[_full]) PREFECTURE_DISTRICTS[_full] = PREFECTURE_DISTRICTS[_p];
}

const KNOWN_ADMIN_AREAS = [...new Set(Object.values(PREFECTURE_DISTRICTS).flat())]
  .filter((name) => name && name !== "市辖区")
  .sort((a, b) => b.length - a.length);

function extractKnownArea(text) {
  const compact = String(text || "").replace(/\s+/g, "");
  return KNOWN_ADMIN_AREAS.find((name) => compact.includes(name)) || "";
}

function jurisdictionFromAdapter(ad) {
  const name = String(ad && ad.name || "").trim();
  const m = name.match(/^(.{2,16}?(?:壮族自治区|维吾尔自治区|回族自治区|自治区|生产建设兵团|省|市))/);
  return m ? m[1] : "";
}

function resolveRecordRegion(ad, rec) {
  const listed = rec && String(rec.city || "").trim();
  // “公共资源交易部/中心”等是发布机构，不是项目地区。此时保守回退到 adapter 明确管辖区，
  // 避免跨多城市项目从标题中随意挑一个城市。
  if (listed && /公共资源交易(?:部|中心|平台|服务中心)|交易服务(?:部|中心)|招标投标管理/.test(listed)) return jurisdictionFromAdapter(ad);
  if (listed && !extractKnownArea(listed) && /(?:污水处理厂|水厂|医院|学校|研究院|项目|管道|管网|桩号)/.test(`${listed} ${rec && rec.title || ""}`)) return jurisdictionFromAdapter(ad);
  if (listed && !/^\d{6}$/.test(listed)) return listed;
  const fromText = extractKnownArea(`${rec && rec.projectSite || ""} ${rec && rec.title || ""}`);
  return fromText || jurisdictionFromAdapter(ad);
}

// 城市筛选是客户端 OR 过滤：不同平台的行政区字段不一致，故同时使用列表地区、标题和提取值。
// 不以“未命中”推断为不属于任何城市，只在用户明确给出 --city 时排除不匹配的记录。
// 增强（2026-08-16）：支持 地级市↔区县 双向归一——`--city 珠海` 命中其区县；`--city 香洲区` 命中珠海记录。
function matchesCityFilter(cityArg, candidates) {
  const filters = String(cityArg || "").split(/[,，、]/).map((s) => s.trim()).filter((s) => s && s !== "全省");
  if (!filters.length) return true;
  const fields = (candidates || []).map((value) => String(value || "").replace(/\s+/g, "")).filter(Boolean);
  return filters.some((filter) => {
    const nf = normalizeArea(filter);
    // 筛地级市（如"安阳"）→ 顺带命中其区县（林州市/滑县…）。
    // 2026-08-16 PR 审查修正两点：①"市辖区"是 281 个地级市共有的通用词，参与 includes 匹配会把
    // 全省任何"市辖区"记录误判属本市——排除；②原 prefOfFilter 把区县级筛词（如"林州"）反查放大为
    // 整个安阳市放行（实测 -c 林州 返回安阳市本级记录）——删除，筛区县只出区县（直接子串命中）。
    const targetDistricts = (PREFECTURE_DISTRICTS[nf] || PREFECTURE_DISTRICTS[filter] || []).filter((d) => {
      const owners = DISTRICT_PREFECTURE_OWNERS.get(normalizeArea(d));
      return d !== "市辖区" && owners && owners.size === 1;
    });
    return fields.some((field) => {
      const nfield = normalizeArea(field);
      if (field.includes(filter) || (nf && nfield.includes(nf))) return true;
      if (targetDistricts.some((d) => normalizeArea(d) === nfield || field.includes(d))) return true;
      return false;
    });
  });
}

// 服务端逐城市循环的目标解析（扩展① · 2026-08-15）：
// 现状（已真机实测，见 CITY_LOOP_AUDIT.md）：标准 EPoint(getFullTextDataNew) 忽略 xiaqucode；
// 河南 getPageInfoListNewYzm 仅认 4100(全省)/410000(混合子集)，逐地市 GB 码全部返回 0。
// 广东粤公平已验证 siteCode，故声明 cityCodes；其余未验证 adapter 仍保持惰性回落。
//   --city <本省内地市>  → 仅该地市（需 adapter 声明 cityCodes 才生效）
//   其余 → 返回 null，走默认单轮全省
function resolveCityTargets(ad, args) {
  if (!ad.cityCodes || !ad.cityCodes.length) return null;
  if (args.city && normalizeArea(args.city) === "全省") return null;
  if (args.city) {
    const want = normalizeArea(args.city);
    const exact = ad.cityCodes.find((c) => normalizeArea(c.name) === want);
    if (exact) return [exact];
    const part = ad.cityCodes.find((c) => c.name.includes(args.city) || args.city.includes(normalizeArea(c.name)));
    if (part) return [part];
  }
  return null;
}

function resolveYgpCityTargets(args) {
  if (!args.city || normalizeArea(args.city) === "全省") return GD_CITY_TARGETS;
  const targets = [];
  let fallback = false;
  for (const raw of args.city.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)) {
    const want = normalizeArea(raw);
    let found = GD_CITY_TARGETS.find((c) => normalizeArea(c.name) === want || normalizeArea(c.name).includes(want) || want.includes(normalizeArea(c.name)));
    if (!found) {
      const parents = [];
      for (const [pref, districts] of Object.entries(PREFECTURE_DISTRICTS)) {
        if (!districts.some((d) => normalizeArea(d) === want || normalizeArea(d).includes(want))) continue;
        const city = GD_CITY_TARGETS.find((c) => normalizeArea(c.name) === normalizeArea(pref));
        if (city) parents.push(city);
      }
      if (parents.length === 1) found = parents[0];
    }
    if (!found) { fallback = true; break; }
    if (!targets.some((x) => x.code === found.code)) targets.push(found);
  }
  if (fallback || !targets.length) {
    const run = global.__RUN_REPORT;
    if (run && Array.isArray(run.city_filters)) run.city_filters.push({ status: "CITY_SERVER_FILTER_FALLBACK", city: args.city });
    return GD_CITY_TARGETS;
  }
  return targets;
}

// 按项目性质分 sheet（对标标标通：房建市政/水利/公路/其他）
function classifySheet(title) {
  if (/公路|高速|国道|省道|桥梁|隧道|路基|路面|市政道路|道路工程/.test(title)) return "公路";
  if (/水利|水库|灌区|灌渠|河道|水系|防洪|水环境|饮水|供水|排水|污水|管网|水厂|泵站|治水/.test(title)) return "水利";
  if (/房建|建筑|市政|装修|绿化|景观|厂房|安置房|保障房|学校|中学|小学|幼儿园|医院|康养|街区|社区|消防|充电|公园|道路/.test(title)) return "房建市政";
  return "其他项目";
}

// 中文省名 → adapter 键。命令行里写 -p 浙江 比 -p zhejiang 自然，
// 且 SKILL 文档、日志、报告里通篇是中文省名，不做映射每次都要人肉翻译一遍。
const PROV_ALIAS = {
  北京: "beijing", 天津: "tianjin", 河北: "hebei", 山西: "shanxi", 内蒙古: "neimenggu",
  辽宁: "liaoning", 吉林: "jilin", 黑龙江: "heilongjiang", 上海: "shanghai", 江苏: "jiangsu",
  浙江: "zhejiang", 安徽: "anhui", 福建: "fujian", 江西: "jiangxi", 山东: "shandong",
  河南: "henan", 湖北: "hubei", 湖南: "hunan", 广东: "guangdong", 广西: "guangxi",
  海南: "hainan", 重庆: "chongqing", 四川: "sichuan", 贵州: "guizhou", 云南: "yunnan",
  西藏: "xizang", 陕西: "shaanxi", 甘肃: "gansu", 青海: "qinghai", 宁夏: "ningxia",
  新疆: "xinjiang",
  兵团: "xinjiangbt", 新疆兵团: "xinjiangbt",
  哈尔滨: "heilongjiang",
  安阳: "anyang", // 城市级 adapter 范本（河南安阳市平台，非省级）
  定西: "dingxi", // 城市级 adapter（甘肃定西市平台，infodate 排序变体；源站 2023-04 后停更）
  常州: "changzhou", // 城市级 adapter（江苏常州独立平台，标准 EPoint 同构）
  洛阳: "luoyang", 郑州: "zhengzhou", 绵阳: "mianyang", 秦皇岛: "qinhuangdao", 南通: "nantong",
  // 城市级扩展批次（2026-08-18）：仅官方独立入口，均锁定 zb 招标公告。
  南京: "nanjing", 惠州: "huizhou", 中山: "zhongshan", 济南: "jinan", 武汉: "wuhan",
  // 城市级扩展第二批（2026-08-18）：官方市级入口，严格过滤非 zb 阶段。
  苏州: "suzhou", // 城市级 adapter（江苏苏州独立平台，静态 SSR webBuilder）
  徐州: "xuzhou", // 城市级 adapter（江苏徐州独立平台，静态 SSR webBuilder）
  宜昌: "yichang", 临沂: "linyi", 烟台: "yantai", 无锡: "wuxi", 泉州: "quanzhou",
  岳阳: "yueyang", 遵义: "zunyi", 宜宾: "yibin", // 城市级批次2（Goal v5）
  合肥: "hefei", // 城市级 adapter（安徽合肥官方 webBuilder Service）
  温州: "wenzhou", // 城市级 adapter（浙江温州官方 JPaas CMS + PDF 详情）
  宁波: "ningbo", // 城市级 adapter（浙江宁波官方 websiteapi + 临时访客 token）
  嘉兴: "jiaxing", // 城市级 adapter（浙江嘉兴官方 JPaas CMS 建设工程招标公告）
  潍坊: "weifang", // 城市级 adapter（山东潍坊官方 EpointWebBuilder 招标公告接口）
  青岛: "qingdao", // 城市级 adapter（山东青岛官方 ASP.NET MVC 招标公告列表）
  深圳: "shenzhen", // 城市级 adapter（广东深圳官方 CMS trade API）
};

// project18 字段能力审计口径。字段来源只进入 run-report，不进入 XLSX/CSV/Markdown。
const PROJECT18_AUDIT_FIELDS = [
  "publishDate", "region", "bidOpen", "title", "scale", "scope", "funding", "duration",
  "qualification", "performance", "controlPrice", "bond", "evaluation", "consortium",
  "fullScore", "url", "docLink",
];
const LIST_AUDIT_FIELDS = new Set(["publishDate", "region", "title", "url"]);

function auditedFieldValue(rec, field) {
  if (!rec) return "";
  if (field === "publishDate") return rec.date;
  if (field === "region") return rec.city;
  return rec[field];
}

function isFilledFieldValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  const text = String(value).trim();
  return text !== "" && !/^(?:undefined|null|nan)$/i.test(text);
}

function ensureFieldSources(rec) {
  if (!rec._fieldSources) {
    Object.defineProperty(rec, "_fieldSources", { value: {}, enumerable: false, writable: true, configurable: true });
  }
  return rec._fieldSources;
}

function markFieldSource(rec, field, source) {
  if (!PROJECT18_AUDIT_FIELDS.includes(field) || !["list", "detail", "attachment"].includes(source)) return;
  if (!isFilledFieldValue(auditedFieldValue(rec, field))) return;
  ensureFieldSources(rec)[field] = source;
}

function captureAuditedFields(rec) {
  return Object.fromEntries(PROJECT18_AUDIT_FIELDS.map((field) => [field, auditedFieldValue(rec, field)]));
}

function initializeListFieldSources(rec) {
  for (const field of PROJECT18_AUDIT_FIELDS) {
    if (isFilledFieldValue(auditedFieldValue(rec, field))) markFieldSource(rec, field, "list");
  }
}

function markChangedDetailSources(rec, before) {
  const sources = ensureFieldSources(rec);
  for (const field of PROJECT18_AUDIT_FIELDS) {
    const value = auditedFieldValue(rec, field);
    if (!isFilledFieldValue(value) || sources[field] === "attachment") continue;
    if (!isFilledFieldValue(before[field]) || String(before[field]) !== String(value)) sources[field] = "detail";
  }
}

function buildFieldStats(rows, args = {}) {
  const records = Array.isArray(rows) ? rows : [];
  const stats = {};
  for (const field of PROJECT18_AUDIT_FIELDS) {
    const entry = { samples: records.length, filled: 0, empty: 0, provisional: records.length < 20, sources: { list: 0, detail: 0, attachment: 0 } };
    for (const rec of records) {
      const value = auditedFieldValue(rec, field);
      if (!isFilledFieldValue(value)) { entry.empty++; continue; }
      entry.filled++;
      const explicit = rec._fieldSources && rec._fieldSources[field];
      const source = ["list", "detail", "attachment"].includes(explicit)
        ? explicit
        : (LIST_AUDIT_FIELDS.has(field) || !args.detail ? "list" : "detail");
      entry.sources[source]++;
    }
    stats[field] = entry;
  }
  return stats;
}

async function collectProvince(prov0, args) {
  const prov = ADAPTERS[prov0] ? prov0 : (PROV_ALIAS[prov0] || prov0);
  let ad = ADAPTERS[prov];
  if (!ad) {
    const zh = Object.entries(PROV_ALIAS).filter(([, v]) => ADAPTERS[v]).map(([k]) => k).join("/");
    console.error("未知省份:", prov0, "| 已适配:", Object.keys(ADAPTERS).join(",") + "（中文亦可：" + zh + "）");
    process.exit(1);
  }
  // B 阶段（Goal v1）：--stage candidate|result|contract 改写列表端点/栏目/类型
  if (args.stage && args.stage !== "zb") {
    if (!ad.stages || !ad.stages[args.stage]) {
      const ok = ad.stages ? Object.keys(ad.stages).join("/") : "（无）";
      console.error(`✗ 省份 ${prov} 未配置阶段 "${args.stage}"。该省支持阶段：zb${ok !== "（无）" ? " / " + ok : ""}`);
      process.exit(2);
    }
    ad = Object.assign({}, ad, ad.stages[args.stage]);
    ad.stageKey = args.stage;
    ad.defaultType = (ad.stages[args.stage] && ad.stages[args.stage].type) || ad.defaultType;
    // makeBody 经 Object.assign 复制引用，调用时 this=ad，故 this.unionCondition 取 stage 覆盖值（兰州等依赖此）
    if (typeof ad.makeBody === "function") ad.makeBody = ad.makeBody.bind(ad);
  }
  // 2026-08-16 V4A：-c 传本省省名（如 -p hainan --city 海南）时，省名 token 会撞 PREFECTURE_DISTRICTS
  // 里青海"海南州"等地级市键（实测 -c 海南 把海南省记录滤成 0 条且不报错）——丢弃等于当前省名的 token。
  if (args.city) {
    const selfNames = Object.entries(PROV_ALIAS).filter(([, v]) => v === prov).map(([k]) => normalizeArea(k));
    const kept = args.city.split(/[,，、]/).map((s) => s.trim()).filter((t) => t && t !== "全省" && !selfNames.includes(normalizeArea(t)));
    args.city = kept.length ? kept.join(",") : "";
  }
  const cutoff = new Date(Date.now() - args.days * 86400000);
  const result = [];
  const seen = new Set();
  // EPoint 多栏目必须拆轮采集（2026-08-10 海南实测发现的框架级缺陷）：
  // condition 数组里多个 categorynum 条件**只有第一个生效**，既不是 AND 也不是 OR
  //   ["003001002","003001003"] → total 31763（= 002 全量，003 一条不进）
  //   ["003001003","003001002"] → total 161  （= 003 全量）
  //   opType 0/1 均无差异
  // 若直接把多栏目塞进一个 condition，后面的栏目会被**静默漏采**且无任何报错。
  // 江苏/浙江此前只配单栏目，故从未暴露此坑。
  const catRounds = ((ad.kind === "epoint" || ad.kind === "epointX" || ad.kind === "sdwrap") && Array.isArray(ad.cats) && ad.cats.length > 1)
    ? ad.cats.map(c => [c])
    : [ad.cats];
  for (const cats of catRounds) {
    if (catRounds.length > 1) console.error("[round] 栏目", cats.join(","));
    await crawlRound(ad, args, cats, cutoff, result, seen);
    if (hasReachedLimit(result.length, args.limit)) break;
  }
  return { ad, result };
}

// 单栏目一轮分页采集（结果与去重集由调用方跨轮共享）
async function crawlRound(ad, args, cats, cutoff, result, seen) {
  let page = 1;
  const MAX_PAGE = 200;
  let emptyPages = 0;
  while (page <= MAX_PAGE) {
    await sleep(args.delay);
    // 两种 adapter：epoint = JSON 接口分页；默认 = HTML 列表页正则解析
    let items;
    try {
    if (ad.kind === "epoint") {
      items = await epointList(ad, page, args, cats);
    } else if (ad.kind === "epointX") {
      items = await epointXList(ad, page, args, cats);
    } else if (ad.kind === "ygp") {
      items = await ygpList(ad, page, args);
    } else if (ad.kind === "sntba") {
      items = await sntbaList(ad, page, args);
    } else if (ad.kind === "hn") {
      items = await hnList(ad, page, args);
    } else if (ad.kind === "gz") {
      items = await gzList(ad, page, args);
    } else if (ad.kind === "yn") {
      items = await ynList(ad, page, args);
    } else if (ad.kind === "hb") {
      items = await hbList(ad, page, args);
    } else if (ad.kind === "jl") {
      items = await jlList(ad, page, args);
    } else if (ad.kind === "fj") {
      items = await fjList(ad, page, args);
    } else if (ad.kind === "cq") {
      items = await cqList(ad, page, args);
    } else if (ad.kind === "tj") {
      items = await tjList(ad, page, args);
    } else if (ad.kind === "nmg") {
      items = await nmgList(ad, page, args);
    } else if (ad.kind === "ln") {
      items = await lnList(ad, page, args);
    } else if (ad.kind === "gs") {
      items = await gsList(ad, page, args);
    } else if (ad.kind === "henanNotice") {
      items = await henanNoticeList(ad, page, args);
    } else if (ad.kind === "yichang") {
      items = await yichangList(ad, page, args);
    } else if (ad.kind === "weifang") {
      items = await weifangList(ad, page, args);
    } else if (ad.kind === "mianyang") {
      items = await mianyangList(ad, page, args);
    } else if (ad.kind === "qinhuangdao") {
      items = await qinhuangdaoList(ad, page, args);
    } else if (ad.kind === "nantong") {
      items = await nantongList(ad, page, args);
    } else if (ad.kind === "nanjing") {
      items = await nanjingList(ad, page, args);
    } else if (ad.kind === "huizhou") {
      items = await huizhouList(ad, page, args);
    } else if (ad.kind === "zhongshan") {
      items = await zhongshanList(ad, page, args);
    } else if (ad.kind === "jinan") {
      items = await jinanList(ad, page, args);
    } else if (ad.kind === "wuhan") {
      items = await wuhanList(ad, page, args);
    } else if (ad.kind === "qingdao") {
      items = await qingdaoList(ad, page, args);
    } else if (ad.kind === "shenzhen") {
      items = await shenzhenList(ad, page, args);
    } else if (ad.kind === "sdwrap") {
      items = await sdWrapList(ad, page, args, cats);
    } else if (ad.kind === "wuxi") {
      items = await wuxiList(ad, page, args);
    } else if (ad.kind === "quanzhou") {
      items = await quanzhouList(ad, page, args);
    } else if (ad.kind === "yueyang") {
      items = await yueyangList(ad, page, args);
    } else if (ad.kind === "zunyi") {
      items = await zunyiList(ad, page, args);
    } else if (ad.kind === "hefei") {
      items = await hefeiList(ad, page, args);
    } else if (ad.kind === "wenzhou") {
      items = await wenzhouList(ad, page, args);
    } else if (ad.kind === "ningbo") {
      items = await ningboList(ad, page, args);
    } else if (ad.kind === "jiaxing") {
      items = await jiaxingList(ad, page, args);
    } else if (ad.kind === "yibin") {
      items = await yibinList(ad, page, args);
    } else {
      const html = await requestWithRetry(ad.listUrl(page), args.delay);
      items = ad.parse(html);
    }
    } catch (e) {
      // 2026-08-16 V4A 兜底：epoint/epointX/ygp/henanNotice/HTML 默认路径的 list 是 throw 语义
      //（对照 jl/fj/tj/nmg/ln/gz/yn/hb/sntba/cq 十省 try-catch 返 []），原版一次网络故障会上抛
      // main FATAL exit(1)——整省已采结果全丢且 run-report 恰不落盘。现记错误停止翻页，
      // 保留已采记录（跨 catRounds 继续下一栏目），让输出与 run-report 正常落盘。
      if (args._run) args._run.errors.push({ code: "LIST_FETCH_FAIL", page, message: String(e && e.message || e).slice(0, 200) });
      break;
    }
    if (!items.length) { if (++emptyPages >= 2) break; page++; continue; }
    emptyPages = 0;
    let stop = false, newCount = 0;
    for (const it of items) {
      if (hasReachedLimit(result.length, args.limit)) { stop = true; break; }
      const item = { ...it, url: normUrl(it.url, ad) };
      const dkey = item.url || item.title; // 粤公平等列表层 url 为空 → 改以标题去重，否则 116 条全被当成同一条
      if (seen.has(dkey)) continue;
      seen.add(dkey); newCount++;
      if (ad.itemAllowed && !ad.itemAllowed(item)) continue;
      if (item.date) {
        const d = new Date(item.date + "T00:00:00");
        if (d < cutoff) { stop = true; break; }
      }
      // 非 epoint adapter 服务端不检索关键词 → 客户端按标题过滤；
      // epoint 一般依赖服务端 wd，但 keywordClient 实例 wd 失效 → 同样客户端过滤
      if (args.keyword && ((ad.kind !== "epoint" && ad.kind !== "epointX") || ad.keywordClient) && !item.title.includes(args.keyword)) continue;
      // 省级名(cityWeak)排在标题提取之后：标题里的"昌江县/屯昌县"比"海南省"有用得多
      const city = item.cityHint || extractCity(item.title) || item.cityWeak || "";
      if (!matchesCityFilter(args.city, [city, item.cityHint, item.cityWeak, item.title])) continue;
      // 归一化标题：去掉【】标注与发布渠道前缀（海南全省公告标题都带"（机器管招投标）"，
      // 那是发布通道标记不是项目名，留着会污染项目名列与去重比对）。原文仍可经 url 溯源。
      const normalizedTitle = item.title
        .replace(/【[^】]+】/g, "")
        .replace(/^[（(](?:机器管招投标|电子招投标|远程异地评标)[）)]\s*/, "")
        .trim();
      const cleanTitle = ad.normalizeTitle ? ad.normalizeTitle(normalizedTitle) : normalizedTitle;
      const rec = {
        // adapter 已按栏目/categorynum 锁定公告类型时直接采用，避免靠标题猜（江苏多数标题不含"招标公告"字样）
        date: item.date, city, type: item.stageHint || ad.defaultType || inferType(item.title),
        tenderType: inferTenderType(item.title),
        title: cleanTitle, url: item.url, owner: "", projectCode: "", method: "", scale: "", scope: "", approval: "", manager: "", _attachNote: "", _projectContentNote: "",
        projectSite: "", bidOpen: "", funding: "", duration: "",
        qualification: "", performance: "", controlPrice: "", budget: "", bond: "",
        evaluation: "", consortium: "", fullScore: "", docLink: "",
        agency: "", contact: "", phone: "",
        // B 阶段·中标/合同阶段字段（zb 阶段保持空，仅 win 阶段填充，诚实不伪造）
        winner: "", winPrice: "", winManager: "", winScore: "", rank: "", contractAmount: "", partyA: "", partyB: "",
        sheet: classifySheet(cleanTitle),
      };
      // 列表层已携带的结构化厚字段（粤公平 ygp 等列表接口直接给出，无详情页）优先填入；
      // 详情阶段仅在非空时覆盖（详情更权威）。避免「列表有数却被初始化空串洗掉」。
      for (const k of ["owner","projectCode","method","scale","scope","approval","manager","projectSite","bidOpen","funding","duration","qualification","performance","controlPrice","budget","bond","evaluation","consortium","fullScore","agency","contact","phone","docLink"]) {
        const v = item[k];
        if (v !== undefined && v !== null && String(v).trim() !== "") rec[k] = v;
      }
      initializeListFieldSources(rec);
      const beforeDetail = captureAuditedFields(rec);
      if (args.detail && item.url) {
        try {
          if (args.stage && args.stage !== "zb") {
            // B 阶段：中标/合同详情 → 通用抽取（中标人/中标价/项目负责人/工期/得分/合同）。
            // 安徽/西藏详情正文为 AJAX 分块加载，壳页为空，须走 bespoke AJAX 取正文（与 zb 阶段同机制）；
            // 其余省份详情页多为服务端渲染 HTML，走通用 fetch+extractWinDetail。
            let dhtml;
            if (ad.kind === "ah") dhtml = await anhuiWinHtml(ad, item);
            else if (ad.kind === "xizang") dhtml = await xizangWinHtml(ad, item);
            else dhtml = await requestWithRetry(item.url, args.delay);
            let pdfText = "";
            if (ad.pdfBody !== false) {
              const p = await maybePdfText(dhtml, item.url, args.delay);
              pdfText = p.text;
              if (p.pdfUrl && !/downloadurl|%7[Bb]|%7[Dd]|[\{\}]/i.test(p.pdfUrl)) { rec.docLink = p.pdfUrl; }
            }
            const df = extractWinDetail(ad, dhtml, item, pdfText);
            if (args.dumpText || global.__RESEARCH) { try { fs.appendFileSync(`test-logs/_research_${args.province}.txt`, `\n===== [${args.stage}] ${item.url} | ${item.title} =====\n${htmlToText(dhtml)}\n${pdfText}\n`); } catch (_) {} }
            for (const [k, v] of Object.entries(df)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
            if (rec.docLink && /downloadurl|%7[Bb]|%7[Dd]|[\{\}]/i.test(rec.docLink)) rec.docLink = "";
            rec.url = normUrl(item.url, ad);
          } else if (ad.kind === "ygp") {
            const dt = await ygpDetail(ad, item, args);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
            rec.url = item.url;
          } else if (ad.kind === "hn") {
            // 湖南详情走结构化 JSON 接口（列表 url 是 SPA hash 路由，HTML 渲染拿不到正文）
            const dt = await hnDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "fj") {
            const dt = await fjDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "yn") {
            const dt = await ynDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "hb") {
            const dt = await hbDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "gz") {
            const dt = await gzDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "nmg") {
            const dt = await nmgDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "gs") {
            const dt = await gsDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "ah") {
            // 安徽详情正文由 jQuery AJAX 分块加载（/jsgc/newDetailSub），壳页为空，POST 取 HTML 片段后走通用抽取
            const dt = await anhuiDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "xizang") {
            // 西藏详情正文由 Jeecms AJAX 加载（/personalitySearch/initDetailbyProjectCode），壳页「暂无相关数据」，POST 取正文 HTML
            const dt = await xizangDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "ningbo") {
            // 宁波详情是 websiteapi JSON；公开 SPA 路由只返回壳页，必须复用官网 getArticle 请求。
            const dt = await ningboDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "qingdao") {
            const dhtml = await requestWithRetry(item.url, args.delay);
            const dt = qingdaoDetail(ad, dhtml, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "shenzhen") {
            const dt = await shenzhenDetail(ad, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "jinan") {
            const dhtml = item._detailHtml || await requestWithRetry(item.url, args.delay);
            const dt = jinanDetail(dhtml, item, "");
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else if (ad.kind === "wuhan") {
            const dhtml = item._detailHtml || await requestWithRetry(item.url, args.delay);
            const dt = wuhanDetail(ad, dhtml, item);
            for (const [k, v] of Object.entries(dt)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
          } else {
            // 2026-08-16 V5 批次2：岳阳等静态 CMS 站点详情页为 GBK 编码（charset=gb2312），
            // requestWithRetry 的 r.text() 按 UTF-8 解码会乱码导致厚字段全空——
            // gbkDetail 标志走 arrayBuffer + TextDecoder("gbk")（Node full-icu 支持）。
            const dhtml = ad.gbkDetail
              ? new TextDecoder("gbk").decode(Buffer.from(await (await fetch(item.url)).arrayBuffer()))
              : await requestWithRetry(item.url, args.delay);
            // 正文可能在 PDF 附件里（浙江等）；HTML 够厚时此步直接跳过，不产生额外请求
            let pdfText = "";
            if (ad.pdfBody !== false) {
              const p = await maybePdfText(dhtml, item.url, args.delay);
              pdfText = p.text;
              if (p.pdfUrl && !/downloadurl|%7[Bb]|%7[Dd]|[\{\}]/i.test(p.pdfUrl)) { rec.docLink = p.pdfUrl; rec._pdfNote = p.note; }
              if (p.pdfUrl && !/downloadurl|%7[Bb]|%7[Dd]|[\{\}]/i.test(p.pdfUrl)) console.error("[pdf]", p.note, p.pdfUrl.slice(-40));
            }
            const df = extractDetail(ad, dhtml, item, pdfText);
            if (args.dumpText || global.__RESEARCH) { try { fs.appendFileSync(`test-logs/_research_${args.province}.txt`, `\n===== ${item.url} | ${item.title} =====\n${htmlToText(dhtml)}\n${pdfText}\n`); } catch (_) {} }
            // 详情抓到的字段仅在非空时覆盖，避免把列表层已有的城市/日期洗掉
            for (const [k, v] of Object.entries(df)) { if (v !== "" && v != null && v !== "undefined" && v !== "null" && !/[\{\}]|downloadurl|%7[Bb]|%7[Dd]/.test(String(v))) rec[k] = v; }
            // 详情页为未渲染 mustache SPA 时，docLink 会被写成 {{downloadurl}}（或 URL 编码 %7B%7Bdownloadurl%7D%7D）脏值，务必清掉
            if (rec.docLink && /downloadurl|%7[Bb]|%7[Dd]|[\{\}]/i.test(rec.docLink)) rec.docLink = "";
            // 仅当 projectSite 短且像地名时才回填 city（避免辽宁/上海实测中 projectSite 抓到
            // "位于鞍山市高新区，工程施工期为540天" 这类长句把 city 污染成项目概况）。
            if (!rec.city && df.projectSite && df.projectSite.length <= 20 && !/[，,。；;、\n\r]/.test(df.projectSite)) rec.city = df.projectSite;
            // 2026-08-16 V5 批次2（泉州实测）：详情页模板残留会把历史日期当开标时间抓出
            //（bidOpen=2021-09-10 而发布日期 2026-08-06，相差近 5 年）——开标早于发布日 1 年以上判脏丢弃。
            if (rec.bidOpen && item.date) {
              const bd = new Date(rec.bidOpen), pd = new Date(item.date);
              if (Number.isFinite(bd.getTime()) && Number.isFinite(pd.getTime()) && (pd.getTime() - bd.getTime()) > 366 * 86400000) rec.bidOpen = "";
            }
            rec.url = normUrl(df.detailUrl || item.url, ad);
          }
          // 列表标题可能被平台截断（例如安徽以省级列表返回省略号），详情正文标题优先；
          // 标题修正后同步重算标的类型和标标通 sheet，避免业务表保留截断标题。
          if (rec.title) {
            if (ad.normalizeTitle) rec.title = ad.normalizeTitle(rec.title);
            rec.tenderType = inferTenderType(rec.title) || rec.tenderType;
            rec.sheet = classifySheet(rec.title);
          }
          if (ad.attachmentBrowserRequired && rec.docLink) {
            rec.docLink = "";
            rec._attachNote = "招标文件下载需验证码，静态采集不绕过";
          }
          // 量纲兜底：标题不含"监理"但资质要求是监理资质的（如「含山县…项目EPC」实为其监理标，
          // 2026-08-15 实测：控制价 180万 vs 同项目 EPC 施工标 12780万，错判量纲会当标的价误用），
          // 以资质字段纠偏——监理综合资质/监理资质出现即必为监理标
          if (rec.tenderType !== "监理" && /监理(?:综合)?资质/.test(rec.qualification || "")) rec.tenderType = "监理";
          // 阶段守卫必须早于附件：被详情标题识别为资审/变更/结果的记录，不下载附件也不写 signals。
          if (!ad.stageKey && !isStrictZbTitle(rec.title)) continue;
          // 缺口一（统一出口）：HTML 未载控制价/概算/保证金时，从招标文件附件补抽。
          // 原先仅通用 HTML 分支调用；bespoke 详情分支（ah/xz/hn/yn/hb/gz/nmg/gs）的片段同样可能带附件，
          // 统一放在 try 尾部后全路径同享（--attach 门禁不变，docLink 为空/已解析过则安全 no-op）
          if (ad.kind === "ygp") await enrichYgpAttachment(rec, args, ad);
          else await enrichFromAttachment(rec, args, ad);
          if (rec._projectContentNote && args._run && Array.isArray(args._run.project_content)) {
            args._run.project_content.push({ title: rec.title, project_code: rec.projectCode || "", status: rec._projectContentNote });
          }
        } catch (e) {
          if (args._run) args._run.errors.push({ code: "DETAIL_FETCH_OR_PARSE", url: item.url, message: String(e && e.message || e) });
          console.error("[detail] FAIL", item.url.slice(0, 60), e.message);
        }
      }
      markChangedDetailSources(rec, beforeDetail);
      // 列表栏目锁定仍可能被详情阶段标题覆盖成资审/变更/终止/结果；入结果集前再做最终纯度守卫。
      if (!ad.stageKey && !isStrictZbTitle(rec.title)) continue;
      // 地区是业务表硬字段：优先保留列表/详情的精确区县，其次从已知行政区词表识别，
      // 最后只回退到该官方 adapter 的明确管辖区（省/市），不臆造更细粒度城市。
      rec.city = resolveRecordRegion(ad, rec);
      if (!rec._fieldSources.region) markFieldSource(rec, "region", "list");
      result.push(rec);
    }
    if (stop) break;
    if (hasReachedLimit(result.length, args.limit)) break;
    if (newCount === 0 && items.length > 0) break;
    page++;
  }
}

function buildMarkdown(prov, ad, result, args) {
  const lines = [];
  lines.push(`# ${ad.name} ${ad.defaultType || "交易公告"}采集报告（${args.detail ? "厚字段" : "列表层"}） · ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`- 省份：${prov}`);
  lines.push(`- 关键词：${args.keyword || "（不限）"}`);
  lines.push(`- 城市/区县：${args.city || "全省"}`);
  lines.push(`- 时间：近 ${args.days} 天  ｜  输出 ${result.length} 条  ｜  厚字段：${args.detail ? "是" : "否"}`);
  lines.push(`- 数据源：${ad.name}`);
  lines.push("");
  lines.push("| 日期 | 地区 | 类型 | 项目名称 | 控制价(万) | 保证金(万) | 资质 | 链接 |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const r of result) {
    lines.push(`| ${r.date} | ${r.city} | ${r.type} | ${r.title} | ${r.controlPrice || "-"} | ${r.bond || "-"} | ${(r.qualification || "-").slice(0, 20)} | [详情](${r.url}) |`);
  }
  return lines.join("\n");
}

// full29 保留采集器全部业务字段；biaobiaotong16 严格兼容参考工作簿；project18 面向项目判断。
const XLSX_HEADER = ["序号", "项目地点", "开标时间", "项目名称", "资金来源", "工期", "资质要求", "业绩要求", "控制价万元", "保证金万元", "评标办法", "联合体", "满分标准", "招标方式", "建设规模", "招标范围", "项目编号", "项目经理", "链接", "招标文件", "附件说明", "中标人", "中标价万元", "项目负责人", "中标得分", "排名", "合同金额万元", "招标人", "承包人"];
const BIAOBIAOTONG_HEADER = ["序号", "项目地点", "开标时间", "项目名称", "资金来源", "工期", "资质要求", "业绩要求", "控制价万元", "保证金万元", "评标办法", "联合体", "满分标准", "链接", "招标文件", "备注"];
const PROJECT18_HEADER = ["序号", "项目地点", "开标时间", "项目名称", "建设规模", "招标范围", "资金来源", "工期", "资质要求", "业绩要求", "控制价万元", "保证金万元", "评标办法", "联合体", "满分标准", "链接", "招标文件", "备注"];
const CSV_HEADER = ["date", "city", "type", "tenderType", "title", "url", "projectCode", "method", "scale", "scope", "approval", "manager", "owner", "agency", "bidOpen", "duration", "controlPrice", "budget", "bond", "funding", "qualification", "performance", "evaluation", "consortium", "fullScore", "contact", "phone", "docLink", "_attachNote", "winner", "winPrice", "winManager", "winScore", "rank", "contractAmount", "partyA", "partyB"];

function cleanOutputCell(value) {
  if (value == null) return "";
  if (typeof value === "number" && !Number.isFinite(value)) return "";
  const s = String(value).trim();
  if (/^(?:undefined|null|nan)$/i.test(s)) return "";
  if (/downloadurl|%7[Bb]|%7[Dd]|[{}]/i.test(s)) return "";
  return value;
}

function hasReachedLimit(count, limit) {
  const n = Number(limit) || 0;
  return n > 0 && count >= n;
}

function buildXlsxSheets(result, options) {
  const layout = (options && options.layout) || "full29";
  if (!["full29", "biaobiaotong16", "project18"].includes(layout)) throw new Error(`未知 XLSX layout: ${layout}`);
  const groups = { "房建市政": [], "水利": [], "公路": [], "其他项目": [] };
  for (const r of result) {
    const key = groups[r.sheet] ? r.sheet : "其他项目";
    groups[key].push(r);
  }
  const sheets = [];
  for (const name of ["房建市政", "水利", "公路", "其他项目"]) {
    const rows = groups[name];
    if (!rows.length && layout === "full29") continue;
    const header = layout === "biaobiaotong16" ? BIAOBIAOTONG_HEADER : layout === "project18" ? PROJECT18_HEADER : XLSX_HEADER;
    const data = rows.map((r, i) => (layout === "biaobiaotong16" ? [
      i + 1, r.city || r.projectSite || "", r.bidOpen || "", r.title, r.funding || "",
      r.duration || "", r.qualification || "", r.performance || "", r.controlPrice || "",
      r.bond || "", r.evaluation || "", r.consortium || "", r.fullScore || "", r.url,
      r.docLink || "", r._attachNote || "",
    ] : layout === "project18" ? [
      i + 1, r.projectSite || r.city || "", r.bidOpen || "", r.title, r.scale || "", r.scope || "",
      r.funding || "", r.duration || "", r.qualification || "", r.performance || "", r.controlPrice || "",
      r.bond || "", r.evaluation || "", r.consortium || "", r.fullScore || "", r.url,
      r.docLink || "", r._attachNote || r._projectContentNote || "",
    ] : [
      i + 1, r.city || r.projectSite || "", r.bidOpen || "", r.title, r.funding || "",
      r.duration || "", r.qualification || "", r.performance || "", r.controlPrice || "",
      r.bond || "", r.evaluation || "", r.consortium || "", r.fullScore || "",
      r.method || "", r.scale || "", r.scope || "", r.projectCode || "", r.manager || "", r.url, r.docLink || "", r._attachNote || "",
      r.winner || "", r.winPrice || "", r.winManager || "", r.winScore || "", r.rank || "", r.contractAmount || "", r.partyA || "", r.partyB || "",
    ]).map(cleanOutputCell));
    sheets.push({ name, rows: [header, ...data] });
  }
  if (!sheets.length) sheets.push({ name: "其他项目", rows: [layout === "biaobiaotong16" ? BIAOBIAOTONG_HEADER : layout === "project18" ? PROJECT18_HEADER : XLSX_HEADER] });
  return sheets;
}

function csvCell(s) { return `"${String(cleanOutputCell(s)).replace(/"/g, '""')}"`; }

function ensureParentDir(filePath) {
  const parent = path.dirname(path.resolve(filePath));
  fs.mkdirSync(parent, { recursive: true });
  return parent;
}

// 机器侧运行回执：不污染业务 XLSX/CSV，明确区分真实记录、空窗口和程序失败。
// 交通/解析函数中部分历史分支会把单页异常降级为空数组，因此 errors 只记录本次调用已显式观测到的错误；
// 空结果仍不得冒充 FAILED，报告会保留 status_reason 供后续逐省复核。
function classifyRunStatus(result, errors = [], signals = {}) {
  const real = (result || []).filter((r) => r && r.title && r.date && r.url);
  if (real.length) return "VERIFIED_RECORD";
  if ((signals.auth_walls || []).length) return "BROWSER_REQUIRED";
  if (errors.length || (signals.rate_limits || []).length || (signals.transport_errors || []).length) return "FAILED";
  if ((result || []).length) return "FAILED";
  return "CONNECTED_NO_RECENT_DATA";
}

function resolveCodeCommit() {
  if (process.env.BID_COLLECT_COMMIT) return process.env.BID_COLLECT_COMMIT;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim() || null;
  } catch (_) {
    return null;
  }
}

function resolveCodeDirty() {
  try {
    return !!execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=no"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch (_) {
    return null;
  }
}

function buildRunReport(prov, ad, result, args, meta = {}) {
  const rows = Array.isArray(result) ? result : [];
  const errors = Array.isArray(meta.errors) ? meta.errors : [];
  const signals = meta.signals || {};
  const real = rows.filter((r) => r && r.title && r.date && r.url);
  const status = classifyRunStatus(rows, errors, signals);
  let sourceBase = ad && ad.base || "";
  if (!sourceBase && real[0] && real[0].url) {
    try { sourceBase = new URL(real[0].url).origin; } catch (_) { /* 保持空值 */ }
  }
  return {
    schema_version: "bid-collect.run-report.v1",
    snapshot_at: new Date().toISOString(),
    status,
    status_reason: status === "VERIFIED_RECORD"
      ? "至少一条记录同时具备标题、日期和官方详情链接"
      : status === "CONNECTED_NO_RECENT_DATA"
        ? "本次窗口未形成可核对的标题+日期+链接记录；空结果不等同于采集失败"
        : status === "BROWSER_REQUIRED"
          ? "官方端点返回鉴权/登录限制，静态方式不可用，需人工浏览器处理"
          : "返回记录但硬字段不完整，或观测到程序错误/外部限流/传输异常，详见 counts、errors 与 signals",
    province: prov,
    adapter: Object.keys(ADAPTERS).find((k) => ADAPTERS[k] === ad) || prov,
    source: { name: ad && ad.name || "", base: sourceBase },
    args: {
      province: args.province,
      city: args.city || "",
      keyword: args.keyword || "",
      days: args.days,
      stage: args.stage || "zb",
      detail: !!args.detail,
      limit: args.limit || 0,
      xlsx_layout: args.xlsxLayout || "biaobiaotong16",
    },
    counts: { total: rows.length, verified_records: real.length },
    field_stats: buildFieldStats(rows, args),
    output: meta.output || null,
    code_commit: resolveCodeCommit(),
    code_dirty: resolveCodeDirty(),
    signals,
    errors,
  };
}

function writeRunReport(outputPath, report) {
  if (!outputPath) return null;
  const abs = path.resolve(outputPath);
  const sidecar = abs.replace(/\.(?:xlsx|md|csv)$/i, "") + ".run-report.json";
  ensureParentDir(sidecar);
  fs.writeFileSync(sidecar, JSON.stringify(report, null, 2) + "\n", "utf8");
  return sidecar;
}

function resolveOutputPaths(args) {
  const ext = path.extname(args.out || "").toLowerCase();
  if (ext !== ".xlsx" && ext !== ".md") {
    throw new Error("--out 仅支持 .xlsx 或 .md；需要 CSV 时请同时传 --csv");
  }
  let mdPath = args.out;
  let xlsxPath = null;
  if (args.out.toLowerCase().endsWith(".xlsx")) {
    mdPath = args.out.replace(/\.xlsx$/i, ".md");
    if (args.xlsx) xlsxPath = args.out;
  } else if (args.xlsx) {
    xlsxPath = args.out.replace(/\.md$/i, ".xlsx");
  }
  return { mdPath, xlsxPath };
}

// 仅作为 CLI 直接运行时执行；被 require 时只导出函数，便于离线单测提取器
 if (require.main === module) (async () => {
 try {
  let ad, result; // 2026-08-16 V4A：提升到 try 外——FATAL 补写需要（原版 catch 访问不到已采结果）
  const args = parseArgs(process.argv.slice(2));
  args._run = { errors: [], auth_walls: [], rate_limits: [], transport_errors: [], attachments: [], project_content: [], city_filters: [] };
  global.__RUN_REPORT = args._run;
  global.__RESEARCH = !!args.dumpText;
  if (!args.province && !args.probeAll) { console.error("用法: node province-collect.cjs -p <省份> [-c 城市/区县[,城市]] -k <关键词> -d <天数> [--stage zb|candidate|result|contract] [--delay 800] [--csv] [--xlsx|--no-xlsx] [--xlsx-layout full29|biaobiaotong16|project18] [--no-detail] [--out 文件] [--limit N] [--probe] [--probe-all] [--verify]"); process.exit(1); }
  // R2 探测模式：自动试 cnum 001-004 + TPBidder/EpointWebBuilder 子上下文 + http 兜底，定位 EPoint 端点
  if (args.probeAll) {
    const summary = await probeAllEvidence(args.keyword || "管网");
    const counts = summary.reduce((a, s) => ((a[s.conclusion] = (a[s.conclusion] || 0) + 1), a), {});
    console.log(JSON.stringify({ total: summary.length, byConclusion: counts, details: summary }, null, 2));
    process.exit(0);
  }
  if (args.probe) {
    const key = resolveProbeKey(args.province);
    if (!key) { console.error("未知/无需探测省份:", args.province); process.exit(1); }
    const rep = await probeProvince(key, args.keyword || "管网");
    const ef = writeProbeEvidence(rep);
    console.log(JSON.stringify(rep, null, 2));
    console.error("📁 证据已落盘:", ef);
    process.exit(0);
  }
  // R3 verified 门禁：端到端实测，真实返回非空标题+日期记录才 PASS，否则拒绝标 verified
  if (args.verify) {
    const v = await verifyProvince(args.province, args.keyword || "管网", args.days);
    console.log(JSON.stringify(v, null, 2));
    console.error(v.passed ? "✅ VERIFY PASS" : "❌ VERIFY FAIL: " + v.reason);
    process.exit(v.passed ? 0 : 2);
  }
  console.error(`=== ${args.province} ${args.keyword || "(不限)"} 近${args.days}天 ${args.detail ? "(厚字段)" : "(列表层)"} ===`);
  ({ ad, result } = await collectProvince(args.province, args));
  console.error(`采集 ${result.length} 条`);
  const md = buildMarkdown(args.province, ad, result, args);
  if (args.out) {
    const { mdPath, xlsxPath } = resolveOutputPaths(args);
    let csvPath = null;
    ensureParentDir(mdPath);
    fs.writeFileSync(mdPath, md);
    if (args.xlsx && xlsxPath) {
      writeXlsx(xlsxPath, buildXlsxSheets(result, { layout: args.xlsxLayout }));
      console.error("XLSX:", xlsxPath);
    }
    if (args.csv) {
      csvPath = mdPath.replace(/\.md$/i, ".csv");
      // CSV 是本工具自有格式，比标标通 16 列兼容版更全：额外带招标人/代理机构/联系人/电话/项目编号等
      // budget（工程概算/投资估算）独立成列：它与 controlPrice 是两个不同事实，
      // 合并即造假。标标通 16 列无此项，故只落在 CSV，不进兼容版 XLSX。
      const rows = result.map(r => CSV_HEADER.map(h => csvCell(r[h])).join(","));
      fs.writeFileSync(csvPath, "﻿" + [CSV_HEADER.join(","), ...rows].join("\n"));
      console.error("CSV:", csvPath);
    }
    const reportPath = writeRunReport(xlsxPath || mdPath, buildRunReport(args.province, ad, result, args, {
      errors: args._run.errors,
      signals: { auth_walls: args._run.auth_walls, rate_limits: args._run.rate_limits, transport_errors: args._run.transport_errors, attachments: args._run.attachments, project_content: args._run.project_content, city_filters: args._run.city_filters },
      output: { markdown: mdPath, xlsx: xlsxPath, csv: csvPath },
    }));
    if (reportPath) console.error("运行报告:", reportPath);
    console.error("报告:", mdPath);
  } else {
    console.log(md);
  }
 } catch (e) {
  if (typeof args !== "undefined" && args && args._run) args._run.errors.push({ code: "FATAL", message: String(e && e.message || e) });
  // 2026-08-16 V4A 补写：原版 FATAL 直接 exit(1)——恰在最需要机器回执的时刻 run-report 不落盘、
  // 已采结果全丢。现在尽力保全：有已采结果且指定了 --out 时，补写 markdown 与 run-report（FAILED）。
  try {
    if (typeof args !== "undefined" && args && args.out) {
      const safeResult = Array.isArray(result) ? result : [];
      const provKey = ADAPTERS[args.province] ? args.province : (PROV_ALIAS[args.province] || args.province);
      const safeAd = ad || ADAPTERS[provKey];
      if (!safeAd) throw new Error("无法解析 adapter，不能生成失败回执");
      const { mdPath } = resolveOutputPaths(args);
      ensureParentDir(mdPath);
      fs.writeFileSync(mdPath, buildMarkdown(args.province, safeAd, safeResult, args));
      writeRunReport(mdPath, buildRunReport(args.province, safeAd, safeResult, args, {
        errors: args._run.errors,
        signals: { auth_walls: args._run.auth_walls, rate_limits: args._run.rate_limits, transport_errors: args._run.transport_errors, attachments: args._run.attachments, project_content: args._run.project_content, city_filters: args._run.city_filters },
        output: { markdown: mdPath, xlsx: null, csv: null },
      }));
      console.error("FATAL 补写: 已采 " + safeResult.length + " 条与 run-report 保全至", mdPath);
    }
  } catch (_) { /* 补写失败不掩盖原始错误 */ }
  console.error("FATAL:", e && (e.stack || e.message) || e);
  process.exit(1);
 }
})();


module.exports = { ADAPTERS, PROV_ALIAS, PROJECT18_AUDIT_FIELDS, XLSX_HEADER, BIAOBIAOTONG_HEADER, PROJECT18_HEADER, CSV_HEADER, parseArgs, inferTenderType, classifySheet, cleanOutputCell, hasReachedLimit, chineseNumberToNumber, extractCandidateTables, ensureParentDir, normalizeArea, matchesCityFilter, resolveCityTargets, resolveYgpCityTargets, extractKnownArea, jurisdictionFromAdapter, resolveRecordRegion, extractNoticeTitle, isStrictZbTitle, extractDetail, extractProjectContent, auditedFieldValue, isFilledFieldValue, ensureFieldSources, markFieldSource, buildFieldStats, xlsxColumnWidths, buildYgpDetailUrl, parseYgpListRows, unwrapYgpPayload, parseYgpJsonText, selectYgpTenderAttachment, parseYgpDetailPayload, extractYgpAttachmentFields, attachmentStatusFromNote, extractWinDetail, grabWinner, grabProjectCode, grab, grabDateTime, grabMoneyWan, grabEvaluation, grabConsortium, grabQualification, grabQualClause, htmlToText, flatten, maybePdfText, findEmbeddedPdfHref, fetchBuffer, parseAttachmentBuffer, enrichFromAttachment, collectProvince, buildXlsxSheets, writeXlsx, buildMarkdown, classifyRunStatus, resolveCodeCommit, resolveCodeDirty, buildRunReport, writeRunReport, resolveOutputPaths, EPOINT_API, PROBE_TARGETS, epointProbeOne, probeProvince, verifyProvince, resolveProbeKey, robustFetch, classifyErr, curlFetch, httpFetch, writeProbeEvidence, probeAllEvidence, ynDetail, hbDetail, gzDetail, guizhouAttachmentUrl, nmgDetail, gsDetail, gsMapRecord, gsParseCustom, anhuiDetail, xizangDetail, conclusionNote, isAllowedSdWrapRecord, isZunyiTenderRecord, isHefeiCityRecord, parseWenzhouCmsList, parseJiaxingCmsList, ningboVisitorToken, parseNingboList, ningboSegmentControlPrice, ningboExactDuration, parseWeifangList, parseMianyangHtml, parseMianyangRelations, parseNantongPayload, parseNanjingPayload, cleanNanjingQualification, nanjingDetail, parseHuizhouHtml, parseHuizhouSearchJsonp, normalizeHuizhouUrl, huizhouDetail, parseZhongshanPayload, zhongshanControlPrice, zhongshanDetail, parseJinanPayload, jinanDetail, parseWuhanHtml, wuhanDetail, parseQingdaoHtml, parseStrongTableFields, cleanA3ScopeAmountTail, cleanQingdaoPerformance, qingdaoDetail, parseShenzhenList, parseBgTableFields, shenzhenProjectContent, qualitativeFullScore, exactMoneyWan,
  hnList, hnDetail, gzList, ynList, hbList, jlList, fjList, fjDetail, mapFjDetailPayload, cqList, tjList, nmgList, lnList, normalizeGsCityName, gsList };
