#!/usr/bin/env node
/**
 * 粤公平（广东省公共资源交易平台）招标公告采集器
 * 零依赖 · 纯 HTTP · 无需浏览器
 *
 * 数据源: POST https://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items
 * (详情正文/附件需 SPA 内部交易环节码，列表接口不暴露，本采集器不覆盖，见 SKILL.md)
 *
 * 粤公平对高频访问会返回 HTTP 429。本脚本内置防护：
 *   1) 每次请求前礼貌延迟（--delay，默认 350ms；0=关闭）
 *   2) 429/5xx 指数退避重试，且尊重服务端 Retry-After 头
 *   3) 连续限流自动降速（自适应提升间隔）
 *   4) 某组合重试耗尽仍失败 → 标注"数据不完整"并以退出码 2 告警
 */

const fs = require('fs');
const path = require('path');

const API = 'https://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items';

const CITIES = {
  '省级': '440000', '广州': '440100', '韶关': '440200', '深圳': '440300',
  '珠海': '440400', '汕头': '440500', '佛山': '440600', '江门': '440700',
  '湛江': '440800', '茂名': '440900', '肇庆': '441200', '惠州': '441300',
  '梅州': '441400', '汕尾': '441500', '河源': '441600', '阳江': '441700',
  '清远': '441800', '东莞': '441900', '中山': '442000', '潮州': '445100',
  '揭阳': '445200', '云浮': '445300',
};

const CATEGORIES = {
  'A': '工程建设', 'B': '土地矿业', 'C': '国有资产', 'D': '政府采购',
  'R': '中介服务', 'L': '用能权', 'M': '涉法涉诉资产', 'S': '海洋资源', 'Z': '其他交易',
};

function parseArgs(argv) {
  const a = {
    keyword: '', city: '珠海', category: 'A', days: 30, exclude: '', limit: 200,
    out: '', json: false, csv: false, quiet: false, delay: 350, retries: 6,
    state: '', all: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--keyword' || k === '-k') a.keyword = next();
    else if (k === '--city' || k === '-c') a.city = next();
    else if (k === '--category' || k === '--cat') a.category = next();
    else if (k === '--days' || k === '-d') a.days = parseInt(next(), 10);
    else if (k === '--exclude' || k === '-x') a.exclude = next();
    else if (k === '--limit' || k === '-l') a.limit = parseInt(next(), 10);
    else if (k === '--out' || k === '-o') a.out = next();
    else if (k === '--delay') a.delay = parseInt(next(), 10);
    else if (k === '--retries') a.retries = parseInt(next(), 10);
    else if (k === '--state') a.state = next();
    else if (k === '--json') a.json = true;
    else if (k === '--csv') a.csv = true;
    else if (k === '--all') a.all = true;
    else if (k === '--quiet' || k === '-q') a.quiet = true;
    else if (k === '--help' || k === '-h') { usage(); process.exit(0); }
  }
  return a;
}

function usage() {
  console.log(`
粤公平招标采集器

用法:
  node ygp-collect.cjs -k "管网,污水" -c 珠海 -d 30

参数:
  -k, --keyword   关键词，逗号分隔多个（OR 关系）；留空=不限
  -c, --city      城市，逗号分隔多个，或 "全省"（默认: 珠海）
  --cat           类别 A工程建设 B土地矿业 C国有资产 D政府采购 R中介服务（默认: A）
  -d, --days      近 N 天（默认: 30）
  -x, --exclude   排除词，逗号分隔
  -l, --limit     最多返回条数（默认: 200）
  -o, --out       输出 Markdown 文件路径
      --json      同时输出 JSON
      --csv       同时输出 CSV
      --state     状态文件路径（记录已见 docId，用于监控只出新公告）
      --all       配合 --state 仍输出全部（默认仅输出新公告）
      --delay     请求前延迟毫秒（默认: 350；设为 0 关闭，限流严重时调大）
      --retries   429/5xx 重试次数（默认: 6）
  -q, --quiet     只输出结果，不打印进度

城市: ${Object.keys(CITIES).join(' ')}
`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 自适应延迟：被限流时自动提升，下次请求前生效
let effectiveDelay = 350;

// ---------- 核心请求（含退避重试 + Retry-After + 自适应降速） ----------
async function requestWithRetry({ keyword, siteCode, secondType, pageNo, pageSize = 50, delay, retries, log }) {
  if (delay > 0) await sleep(delay);
  const body = {
    type: 'trading-type', openConvert: false,
    keyword: keyword || '',
    siteCode,
    secondType,
    tradingProcess: '', thirdType: '[]', projectType: '',
    publishStartTime: '', publishEndTime: '',
    pageNo, pageSize,
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://ygp.gdzwfw.gov.cn/',
          'Accept': 'application/json, text/plain, */*',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastErr = e;
      const wait = Math.min(8000, 500 * 2 ** attempt);
      log(`     网络异常，退避 ${wait}ms 后重试 (${attempt + 1}/${retries + 1})`);
      await sleep(wait);
      continue;
    }
    if (res.ok) {
      const j = await res.json();
      if (j.errcode !== 0) throw new Error(`API errcode=${j.errcode} ${j.errmsg}`);
      return j.data;
    }
    if (res.status === 429) {
      // 尊重 Retry-After；否则指数退避；并自适应降速
      const ra = res.headers.get('retry-after');
      let wait = Math.min(15000, 500 * 2 ** attempt);
      if (ra && !isNaN(parseInt(ra, 10))) wait = Math.min(60000, parseInt(ra, 10) * 1000);
      if (wait > effectiveDelay) effectiveDelay = Math.min(60000, wait);
      log(`     限流 429，退避 ${wait}ms 后重试 (${attempt + 1}/${retries + 1})${ra ? ' [Retry-After=' + ra + ']' : ''}`);
      lastErr = new Error('HTTP 429 限流');
      await sleep(wait);
      continue;
    }
    if (res.status >= 500) {
      const wait = Math.min(8000, 500 * 2 ** attempt);
      log(`     服务端 ${res.status}，退避 ${wait}ms 后重试 (${attempt + 1}/${retries + 1})`);
      lastErr = new Error(`HTTP ${res.status}`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status}`);
  }
  throw new Error(`重试耗尽: ${lastErr ? lastErr.message : '未知'}`);
}

function parseDate(s) {
  if (!s || s.length < 8) return null;
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8),
    +(s.slice(8, 10) || 0), +(s.slice(10, 12) || 0));
}
function fmtDate(s) {
  if (!s || s.length < 8) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// ---------- 采集一个 (城市 × 类别 × 关键词) 组合 ----------
async function collectOne({ keyword, cityName, siteCode, cat, cutoff, maxPages = 20, delay, retries, log, label }) {
  const out = [];
  let stop = false;
  let incomplete = false;
  for (let pageNo = 1; pageNo <= maxPages && !stop; pageNo++) {
    let data;
    try {
      data = await requestWithRetry({ keyword, siteCode, secondType: cat, pageNo, delay, retries, log });
    } catch (e) {
      log(`   ✗ ${label} 第${pageNo}页失败(重试耗尽): ${e.message}`);
      incomplete = true;
      break;
    }
    const rows = data.pageData || [];
    if (rows.length === 0) break;
    for (const r of rows) {
      const d = parseDate(r.publishDate);
      if (cutoff && d && d < cutoff) { stop = true; break; }   // 倒序，超期即停
      out.push({
        title: r.noticeTitle,
        date: fmtDate(r.publishDate),
        dateRaw: r.publishDate,
        city: r.regionName || cityName,
        category: r.noticeSecondTypeDesc || CATEGORIES[cat],
        projectType: r.projectTypeName || '',
        stage: r.noticeThirdTypeDesc || '',
        owner: r.projectOwner || '',
        projectCode: r.projectCode || '',
        platform: r.pubServicePlat || '',
        docId: r.docId,
        noticeId: r.noticeId,
        matchedKeyword: keyword || '(不限)',
      });
    }
    if (rows.length < 50) break;
  }
  return { rows: out, incomplete };
}

// ---------- CSV 转义 ----------
function csvCell(s) {
  const v = (s == null ? '' : String(s));
  return '"' + v.replace(/"/g, '""') + '"';
}

// ---------- 主流程 ----------
(async () => {
  const args = parseArgs(process.argv);
  effectiveDelay = args.delay;
  const log = args.quiet ? () => {} : (s) => console.log(s);

  const keywords = args.keyword ? args.keyword.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [''];
  const excludes = args.exclude ? args.exclude.split(/[,，]/).map(s => s.trim()).filter(Boolean) : [];
  const cats = args.category.split(/[,，]/).map(s => s.trim().toUpperCase()).filter(Boolean);

  let cityNames;
  if (/全省|全部|all/i.test(args.city)) cityNames = Object.keys(CITIES);
  else cityNames = args.city.split(/[,，]/).map(s => s.trim().replace(/市$/, '')).filter(Boolean);

  const badCity = cityNames.filter(c => !CITIES[c]);
  if (badCity.length) { console.error('未知城市: ' + badCity.join(',') + '\n可选: ' + Object.keys(CITIES).join(' ')); process.exit(1); }
  const badCat = cats.filter(c => !CATEGORIES[c]);
  if (badCat.length) { console.error('未知类别: ' + badCat.join(',')); process.exit(1); }

  const cutoff = args.days > 0 ? new Date(Date.now() - args.days * 86400000) : null;

  // 加载已见状态（监控模式）
  let seen = new Set();
  if (args.state && fs.existsSync(args.state)) {
    try {
      const s = JSON.parse(fs.readFileSync(args.state, 'utf8'));
      (s.seen || []).forEach(x => seen.add(x));
      log(`已加载状态: ${seen.size} 条已见记录`);
    } catch (e) { log('状态文件读取失败，按全新运行: ' + e.message); }
  }

  log(`采集范围: ${cityNames.join('/')} × ${cats.map(c => CATEGORIES[c]).join('/')} × [${keywords.map(k => k || '不限').join(',')}] 近${args.days}天`);
  log(`限流防护: 初始延迟 ${args.delay}ms · 重试 ${args.retries} 次 · 自适应降速开`);
  const t0 = Date.now();

  const all = [];
  const incompleteCombos = [];
  for (const cityName of cityNames) {
    for (const cat of cats) {
      for (const kw of keywords) {
        const label = `${cityName} · ${CATEGORIES[cat]} · "${kw || '不限'}"`;
        const { rows, incomplete } = await collectOne({ keyword: kw, cityName, siteCode: CITIES[cityName], cat, cutoff, delay: effectiveDelay, retries: args.retries, log, label });
        if (incomplete) incompleteCombos.push(label);
        log(`   ${label} → ${rows.length} 条${incomplete ? ' (数据不完整!)' : ''}`);
        all.push(...rows);
      }
    }
  }

  // 去重 + 排除词 + 排序 + 截断
  const dedupSeen = new Set();
  let result = [];
  for (const r of all) {
    if (dedupSeen.has(r.docId)) continue;
    dedupSeen.add(r.docId);
    if (excludes.some(x => r.title.includes(x))) continue;
    result.push(r);
  }
  result.sort((a, b) => (b.dateRaw || '').localeCompare(a.dateRaw || ''));

  // 监控 diff：仅新公告
  let output = result;
  let newCount = result.length;
  if (args.state) {
    const isNew = r => !seen.has(r.docId);
    newCount = result.filter(isNew).length;
    if (!args.all) output = result.filter(isNew);
    log(`监控比对: 本次 ${result.length} 条，其中新公告 ${newCount} 条，已见 ${result.length - newCount} 条`);
  }

  const truncated = output.length > args.limit;
  output = output.slice(0, args.limit);

  const cost = ((Date.now() - t0) / 1000).toFixed(1);
  log(`\n输出 ${output.length} 条${truncated ? '（已截断至 ' + args.limit + '）' : ''}，耗时 ${cost}s`);

  // 回写状态
  if (args.state) {
    const union = new Set(seen);
    result.forEach(r => union.add(r.docId));
    const stateObj = { lastRun: new Date().toISOString(), seen: [...union] };
    try {
      fs.mkdirSync(path.dirname(path.resolve(args.state)), { recursive: true });
      fs.writeFileSync(args.state, JSON.stringify(stateObj, null, 2), 'utf8');
    } catch (e) { log('状态文件写入失败: ' + e.message); }
  }

  // ---------- 输出 ----------
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`# 招标公告采集报告 · ${today}`);
  lines.push('');
  lines.push(`- 范围：${cityNames.join('、')} × ${cats.map(c => CATEGORIES[c]).join('、')}`);
  lines.push(`- 关键词：${keywords.map(k => k || '不限').join('、')}${excludes.length ? ' ｜ 排除：' + excludes.join('、') : ''}`);
  lines.push(`- 时间：近 ${args.days} 天  ｜  输出 ${output.length} 条  ｜  耗时 ${cost}s`);
  lines.push(`- 数据源：粤公平 广东省公共资源交易平台`);
  if (args.state && !args.all) lines.push(`- 监控：新公告 ${newCount} 条（已过滤已见）`);
  if (incompleteCombos.length) {
    lines.push(`- ⚠️ 数据不完整：以下组合因限流/网络重试耗尽未采集完整（建议调大 --delay 或分城市运行）：`);
    for (const c of incompleteCombos) lines.push(`  - ${c}`);
  }
  lines.push('');

  const byStage = {};
  for (const r of output) (byStage[r.stage || '其他'] ||= []).push(r);
  for (const [stage, rows] of Object.entries(byStage)) {
    lines.push(`## ${stage}（${rows.length}）`);
    lines.push('');
    lines.push('| 日期 | 地区 | 类型 | 项目名称 | 业主单位 |');
    lines.push('|---|---|---|---|---|');
    for (const r of rows) {
      const t = r.title.replace(/\|/g, '｜');
      const o = (r.owner || '—').replace(/\|/g, '｜');
      lines.push(`| ${r.date} | ${r.city} | ${r.projectType || '—'} | ${t} | ${o} |`);
    }
    lines.push('');
  }
  const md = lines.join('\n');

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, md, 'utf8');
    log(`报告已写入: ${args.out}`);
    if (args.json) {
      const jp = args.out.replace(/\.md$/i, '') + '.json';
      fs.writeFileSync(jp, JSON.stringify(output, null, 2), 'utf8');
      log(`JSON 已写入: ${jp}`);
    }
    if (args.csv) {
      const cp = args.out.replace(/\.md$/i, '') + '.csv';
      const header = ['date', 'city', 'category', 'projectType', 'stage', 'title', 'owner', 'projectCode', 'platform', 'docId', 'noticeId', 'matchedKeyword'];
      const crows = [header.map(csvCell).join(',')];
      for (const r of output) crows.push([r.date, r.city, r.category, r.projectType, r.stage, r.title, r.owner, r.projectCode, r.platform, r.docId, r.noticeId, r.matchedKeyword].map(csvCell).join(','));
      fs.writeFileSync(cp, '﻿' + crows.join('\n'), 'utf8'); // BOM 便于 Excel 中文
      log(`CSV 已写入: ${cp}`);
    }
  } else {
    console.log('\n' + md);
    if (args.json) {
      console.log('\n' + JSON.stringify(output, null, 2));
    }
  }

  if (incompleteCombos.length) {
    log(`\n⚠️ 注意：${incompleteCombos.length} 个组合数据不完整，退出码 2。`);
    process.exit(2);
  }
})().catch(e => { console.error('FATAL: ' + e.message); process.exit(1); });
