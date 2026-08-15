#!/usr/bin/env node
/**
 * EPoint(国泰新点)智能搜索接口 指纹批量探测
 * 目的：验证"EPoint 同构复用扩省"这条路的真实杠杆有多大。
 *      江苏/浙江/海南已证实同构（同一 kind，仅栏目编码不同）。
 *      如果多数省级平台也是 EPoint 系，扩省成本 ≈ 探编码，而非重写 adapter。
 *
 * 判据：POST {base}/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew
 *      返回 JSON 且含 result.records[] → EPOINT 确认
 *
 * 2026-08-11 由 WorkBuddy 写入
 */
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
const https = require("https");
const http = require("http");
const { URL } = require("url");

// 省级公共资源交易平台候选 —— 从权威清单 domains-31.csv 读取
// （来源：中国招标投标公共服务平台·发布媒介名单）。
// 读取全部 31 省+兵团；已适配省（鲁苏浙琼皖）标记但不重复适配，仍参与探测以核对。
const fs = require("fs");
const ADAPTED = new Set(["山东", "江苏", "浙江", "海南", "安徽"]);
function shortCn(cn) {
  return cn.replace(/(维吾尔|壮族|回族)?自治区$/, "").replace(/(省|市|特别行政区|兵团)$/, "").trim() || cn;
}
function normBase(u) {
  if (!/^https?:\/\//.test(u)) u = "https://" + u;
  return u.replace(/\/+$/, "");
}
const CANDIDATES = [];
try {
  const lines = fs.readFileSync("domains-31.csv", "utf8").split(/\r?\n/).filter(Boolean);
  const hdr = lines[0].split(",");
  const iCn = hdr.indexOf("地区"), iUrl = hdr.indexOf("网址");
  for (const ln of lines.slice(1)) {
    const c = ln.split(",");
    const cn = (c[iCn] || "").trim(), url = (c[iUrl] || "").trim();
    if (!url) continue;
    let host;
    try { host = new URL(url.includes("://") ? url : "https://" + url).host; }
    catch { continue; }
    if (!/^[\w.-]+\.[a-z]{2,}(:\d+)?$/i.test(host)) continue;   // 仅合法主机（含子域），不再误杀带路径/尾斜杠的 URL
    const base = normBase(url.includes("://") ? url : "https://" + url);
    CANDIDATES.push({ key: cn, cn, base, adapted: ADAPTED.has(shortCn(cn)) });
  }
} catch (e) {
  console.error("读取 domains-31.csv 失败:", e.message);
  process.exit(1);
}
console.error("候选总数（含已适配5省）:", CANDIDATES.length);

const EP_PATH = "/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew";

function req(urlStr, { method = "GET", body = null, timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch { return resolve({ err: "BAD_URL" }); }
    const mod = u.protocol === "http:" ? http : https;
    const opt = {
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        Accept: method === "POST" ? "application/json, text/plain, */*" : "text/html,*/*",
      },
      rejectUnauthorized: false,   // 沙箱代理证书拦截，需绕
      timeout,
    };
    if (body) {
      opt.headers["Content-Type"] = "application/json";
      opt.headers["Content-Length"] = Buffer.byteLength(body);
    }
    const r = mod.request(u, opt, (res) => {
      const chunks = [];
      let len = 0;
      res.on("data", (c) => { chunks.push(c); len += c.length; if (len > 300000) res.destroy(); });
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    r.on("error", (e) => resolve({ err: String(e.code || e.message).slice(0, 22) }));
    r.on("timeout", () => { r.destroy(); resolve({ err: "TIMEOUT" }); });
    if (body) r.write(body);
    r.end();
  });
}

function epointPayload() {
  return JSON.stringify({
    token: "", pn: 0, rn: 5, sdt: "", edt: "", wd: "管网", inc_wd: "", exc_wd: "",
    fields: "title", cnum: "001", sort: "{}", ssort: "title", cl: 200, terminal: "",
    condition: [], time: null, highlights: "title", statistics: null, unionCondition: null,
    accuracy: "", noParticiple: "0", searchRange: null, isBusiness: "1",
  });
}

(async () => {
  console.log("EPoint 指纹批量探测 · " + new Date().toISOString().slice(0, 19).replace("T", " "));
  console.log("判据: POST " + EP_PATH + " → JSON 含 result.records[]\n");

  const rows = [];
  const CONC = 6;
  for (let i = 0; i < CANDIDATES.length; i += CONC) {
    const batch = CANDIDATES.slice(i, i + CONC).map(async ({ key, cn, base, adapted }) => {
      // 1) 首页可达性
      const home = await req(base, { timeout: 10000 });
      const reach = home.err ? `✗ ${home.err}` : `✓ ${home.status}`;
      // 2) EPoint 接口指纹
      let fp = "-", note = "";
      if (!home.err) {
        const ep = await req(base + EP_PATH, { method: "POST", body: epointPayload(), timeout: 14000 });
        if (ep.err) { fp = "✗ " + ep.err; }
        else if (ep.status === 200 && /"result"/.test(ep.body) && /"records"/.test(ep.body)) {
          fp = "★ EPOINT";
          const m = ep.body.match(/"totalcount"\s*:\s*"?(\d+)/i);
          note = m ? `命中 ${m[1]} 条` : "结构匹配";
        } else if (ep.status === 200 && /<html/i.test(ep.body)) { fp = "非EPoint(HTML)"; }
        else { fp = `HTTP ${ep.status}`; }
        // 3) 首页 HTML 兜底指纹（有些省改了接口路径但仍是 EPoint 内核）
        if (!fp.startsWith("★") && /epoint|inteligentsearch|国泰新点/i.test(home.body || "")) {
          note = "首页含epoint特征(路径可能变体)";
        }
      }
      // 已适配省：已知交易端为 EPoint 同构；若门户未暴露接口，诚实标注而非误判
      if (adapted && !fp.startsWith("★") && !/epoint特征/.test(note)) {
        note = (note ? note + " · " : "") + "已适配同构(交易端EPoint，门户未暴露接口)";
      }
      rows.push({ key, cn, base, reach, fp, note, adapted });
    });
    await Promise.all(batch);
    process.stderr.write(`  ...已探 ${Math.min(i + CONC, CANDIDATES.length)}/${CANDIDATES.length}\n`);
  }

  rows.sort((a, b) => (b.fp.startsWith("★") ? 1 : 0) - (a.fp.startsWith("★") ? 1 : 0));
  console.log("| 省 | 平台 | 首页 | EPoint指纹 | 备注 |");
  console.log("|---|---|---|---|---|");
  for (const r of rows) console.log(`| ${r.cn}${r.adapted ? " ✅" : ""} | ${r.base.replace(/^https?:\/\//, "")} | ${r.reach} | ${r.fp} | ${r.note} |`);

  const ep = rows.filter((r) => r.fp.startsWith("★"));
  const hint = rows.filter((r) => !r.fp.startsWith("★") && /epoint特征/.test(r.note));
  const adaptedKnown = rows.filter((r) => r.adapted);
  const dead = rows.filter((r) => r.reach.startsWith("✗"));
  console.log(`\n汇总: 候选 ${rows.length} · EPoint接口直击 ${ep.length} · 疑似EPoint ${hint.length} · 已适配同构 ${adaptedKnown.length} · 首页不可达 ${dead.length}`);
  if (ep.length) console.log("EPoint 接口直击: " + ep.map((r) => r.cn).join("、"));
  if (hint.length) console.log("疑似 EPoint(首页特征): " + hint.map((r) => r.cn).join("、"));
  console.log("\n⚠ 重要说明：本清单域名来自「中国招标投标公共服务平台·发布媒介名单」，多数为省级『招标投标公共服务/发布』门户，");
  console.log("   其 EPoint 交易内核往往部署在同级 ggzy 交易子域（如 江苏交易端 jsggzy.jszwfw.gov.cn ≠ 发布端 jszbtb.com）。");
  console.log("   故门户 URL 探得「非EPoint」不等于该省交易系统非 EPoint；确证需逐省以交易端域名实测（见逐省适配步骤）。");
})();
