"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const M = require(path.join(__dirname, "province-collect.cjs"));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("SKILL.md frontmatter 只使用 Codex 支持的顶层键", () => {
  const skill = fs.readFileSync(path.join(__dirname, "..", "SKILL.md"), "utf8");
  const fm = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, "缺少 YAML frontmatter");
  const keys = fm[1].split(/\r?\n/).filter((line) => /^[A-Za-z][\w-]*:/.test(line)).map((line) => line.split(":", 1)[0]);
  const allowed = new Set(["name", "description", "license", "allowed-tools", "metadata"]);
  assert.deepEqual(keys.filter((key) => !allowed.has(key)), []);
});

test("43 个 adapter 均已注册（32 省级 + 11 城市级）", () => {
  assert.equal(Object.keys(M.ADAPTERS).length, 43);   // 2026-08-16 V5 批次2：+8 城（宜昌/临沂/烟台/无锡/泉州/岳阳/遵义/宜宾）
});

test("中文省名覆盖全部 adapter", () => {
  const covered = new Set(Object.values(M.PROV_ALIAS));
  const missing = Object.keys(M.ADAPTERS).filter((key) => !covered.has(key));
  assert.deepEqual(missing, []);
});

test("32 个 adapter 均有可执行的官方 reference", () => {
  for (const adapter of Object.keys(M.ADAPTERS)) {
    const file = path.join(__dirname, "..", "reference", `${adapter}.md`);
    assert.ok(fs.existsSync(file), `${adapter} 缺少 reference`);
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /^## 机制\s*$/m, `${adapter} 缺少机制说明`);
    assert.match(text, /验证状态：/, `${adapter} 缺少验证状态`);
    assert.match(text, /https?:\/\//, `${adapter} 缺少官方 URL 证据`);
    assert.match(text, /^## 可重复采集命令\s*$/m, `${adapter} 缺少复采命令`);
  }
});

test("招标公告实时状态总账覆盖全部 43 个 adapter", () => {
  const file = path.join(__dirname, "..", "reference", "ZB_LIVE_STATUS_2026-08-15.md");
  assert.ok(fs.existsSync(file), "缺少招标公告实时状态总账");
  const text = fs.readFileSync(file, "utf8");
  const rows = [...text.matchAll(/^\| ([a-z][a-z0-9]+) \|/gm)].map((m) => m[1]).filter((adapter) => M.ADAPTERS[adapter]);
  assert.equal(new Set(rows).size, 43);
  assert.deepEqual([...new Set(rows)].sort(), Object.keys(M.ADAPTERS).sort());
  assert.match(text, /`VERIFIED_RECORD`：35 个/);
  assert.match(text, /`CONNECTED_NO_RECENT_DATA`：6 个/);
  assert.match(text, /`FAILED`：2 个/);
});

// 2026-08-16 V5 逐列取证回访：9 处漏抽修复（江西/遵义/海南/重庆/青海/烟台/江苏实测原文形态）
test("取证回访：政采措辞的开标/工期与复合词控制价", () => {
  const o = M.extractDetail(M.ADAPTERS.jiangxi,
    "<p>四、提交 响应 文件截止时间、 磋商 时间和地点 2026 年 08 月 27 日 09 点 30 分（北京时间）</p><p>合同履行期限： 自合同签订生效之日起 45 天内完成</p>",
    { title: "x", url: "https://example.invalid/jx" }, "");
  assert.equal(o.bidOpen, "2026-08-27 09:30");   // 字间空格 + 「点」时间词
  assert.ok(o.duration.includes("45 天内完成"));    // 「合同履行期限」垫底标签（前缀保留完整语义）
  assert.equal(M.grabMoneyWan("本次招标项目合同估算金额： 2964.95 万元", ["合同估算金额", "估算金额", "总投资金额", "标段估算价"]), "2964.95");
  assert.equal(M.grabMoneyWan("标段估算价:1930.29万元", ["标段估算价"]), "1930.29");
  assert.equal(M.grabMoneyWan("最高投标限价（或招标控制价): 6924677.31", ["最高投标限价", "控制价"]), "692.4677"); // 行尾无单位按元
});
test("取证回访：否定语境评标办法与信息来源地点", () => {
  assert.equal(M.grabEvaluation("5.1是否评定分离： 否 5.2本次招标采用 综合评估法"), "综合评估法");
  assert.equal(M.extractDetail(M.ADAPTERS.yantai, "<p>信息来源： 招远市 发布时间：2026-08-14</p>", { title: "x", url: "https://example.invalid/yt" }, "").projectSite, "招远市");
});

// 2026-08-16 V5 批次2 详情加固：括号单位金额 + GBK 详情 + 脏开标守卫（无锡/岳阳/泉州实测）
test("标签自带括号单位的金额可正确提取且中文兜底不误配", () => {
  // 无锡实测形态：原版中文兜底把「（万」当数字输出 1 万元的错值
  assert.equal(M.grabMoneyWan("2.6 工程合同估算价（万元）： 298.0 2.7 单位工程", ["合同估算价", "估算价"]), "298");
  assert.equal(M.grabMoneyWan("控制价（元）：15000", ["控制价"]), "1.5");
  // 回归：数字+单位与中文大写两通道不受影响
  assert.equal(M.grabMoneyWan("最高投标限价: 9313711.85.元", ["最高投标限价"]), "931.3712");
  assert.equal(M.grabMoneyWan("投标保证金：人民币叁万元整", ["投标保证金"]), "3");
});
test("开标时间早于发布日期1年以上判脏丢弃（泉州模板残留形态）", () => {
  const out = M.extractDetail(M.ADAPTERS.quanzhou,
    "<p>开标时间：2021-09-10 09:30</p><p>招标人：某公司</p>",
    { title: "南安管网", url: "https://example.invalid/q", date: "2026-08-06" }, "");
  assert.equal(out.bidOpen, "2021-09-10 09:30");   // extractDetail 层不判（无列表日期上下文）
  assert.equal(M.ADAPTERS.yueyang.gbkDetail, true); // 岳阳详情走 GBK 解码开关
});

test("常州城市级 adapter 配置锁定（omitFields 实例差异 + 栏目前缀）", () => {
  assert.equal(M.ADAPTERS.changzhou.omitFields, true);          // fields 投影参数传入即静默返空（实测二分定位）
  assert.deepEqual(M.ADAPTERS.changzhou.cats, ["001001001"]);   // 工程建设招标公告大类 contains 前缀
  assert.equal(M.ADAPTERS.changzhou.sortField, "webdate");
});

test("参数默认 zb 与标标通16列，并保留已配置阶段", () => {
  const args = M.parseArgs(["-p", "anhui"]);
  assert.equal(args.stage, "zb");
  assert.equal(args.xlsxLayout, "biaobiaotong16");
  assert.equal(M.parseArgs(["-p", "anhui", "--stage", "candidate"]).stage, "candidate");
});

test("公开文档保留阶段选择并明确本 PR 只验收 zb", () => {
  const root = path.join(__dirname, "..");
  const skill = fs.readFileSync(path.join(root, "SKILL.md"), "utf8");
  const family = fs.readFileSync(path.join(root, "reference", "FAMILY_INDEX.md"), "utf8");
  assert.match(skill, /--stage candidate/);
  assert.match(skill, /全国状态总账与分层验收只覆盖 `zb`/);
  assert.match(family, /B 阶段/);
  assert.match(family, /--stage contract/);
});

test("已配置阶段都有类型和可执行路由", () => {
  const routeKeys = ["cats", "listUrl", "noticeType", "gcjsEndpoint", "jsgcEndpoint", "GGTYPE", "channelId", "unionCondition", "iType", "iTypes", "noticeTypeName", "searchword", "tradingProcess", "categoryNum", "notice"]; // 含 TRS、粤公平、河南与湖南 B 阶段客户端路由
  for (const [adapterName, adapter] of Object.entries(M.ADAPTERS)) {
    for (const [stageName, stage] of Object.entries(adapter.stages || {})) {
      assert.ok(["candidate", "result", "contract"].includes(stageName), `${adapterName}.${stageName} 非法`);
      assert.ok(stage && typeof stage === "object", `${adapterName}.${stageName} 不是对象`);
      assert.ok(stage.type, `${adapterName}.${stageName} 缺 type`);
      assert.ok(routeKeys.some((key) => stage[key] !== undefined), `${adapterName}.${stageName} 缺路由选择器`);
      const merged = Object.assign({}, adapter, stage);
      assert.ok(merged.kind || merged.list || merged.listUrl || merged.cats, `${adapterName}.${stageName} 合并后不可执行`);
    }
  }
});

test("full29、biaobiaotong16 与 CSV schema 锁定", () => {
  assert.equal(M.XLSX_HEADER.length, 29);
  assert.equal(M.BIAOBIAOTONG_HEADER.length, 16);
  assert.equal(M.CSV_HEADER.length, 37); // 2026-08-15 +tenderType（标的量纲标记）
  assert.deepEqual(M.BIAOBIAOTONG_HEADER, ["序号", "项目地点", "开标时间", "项目名称", "资金来源", "工期", "资质要求", "业绩要求", "控制价万元", "保证金万元", "评标办法", "联合体", "满分标准", "链接", "招标文件", "备注"]);
});

test("标标通兼容版固定生成 4 个 sheet 和 16 列", () => {
  const sheets = M.buildXlsxSheets([{ sheet: "水利", title: "管网项目", url: "https://example.invalid/1" }], { layout: "biaobiaotong16" });
  assert.deepEqual(sheets.map((s) => s.name), ["房建市政", "水利", "公路", "其他项目"]);
  for (const sheet of sheets) assert.equal(sheet.rows[0].length, 16);
  assert.equal(sheets[1].rows[1].length, 16);
});

test("XLSX 写入器包含样式、列宽、冻结首行和筛选", () => {
  const file = path.join(os.tmpdir(), `bid-collect-self-test-${process.pid}.xlsx`);
  try {
    M.writeXlsx(file, M.buildXlsxSheets([{ sheet: "其他项目", title: "测试项目", url: "https://example.invalid/1" }], { layout: "biaobiaotong16" }));
    const raw = fs.readFileSync(file).toString("utf8");
    assert.match(raw, /xl\/styles\.xml/);
    assert.match(raw, /state="frozen"/);
    assert.match(raw, /<cols>/);
    assert.match(raw, /<autoFilter /);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test("输出清洗保留合法 0，移除脏哨兵", () => {
  assert.equal(M.cleanOutputCell(undefined), "");
  assert.equal(M.cleanOutputCell("undefined"), "");
  assert.equal(M.cleanOutputCell(Number.NaN), "");
  assert.equal(M.cleanOutputCell("{{downloadurl}}"), "");
  assert.equal(M.cleanOutputCell(0), 0);
});

test("--limit 是页内硬上限", () => {
  assert.equal(M.hasReachedLimit(0, 1), false);
  assert.equal(M.hasReachedLimit(1, 1), true);
  assert.equal(M.hasReachedLimit(20, 1), true);
  assert.equal(M.hasReachedLimit(20, 0), false);
});

test("城市/区县筛选支持简称、全称和逗号 OR", () => {
  assert.equal(M.matchesCityFilter("", ["海口市", "海口项目"]), true);
  assert.equal(M.matchesCityFilter("全省", ["海口市"]), true);
  assert.equal(M.matchesCityFilter("海口", ["海口市", "项目标题"]), true);
  assert.equal(M.matchesCityFilter("涡阳", ["涡阳县", "项目标题"]), true);
  assert.equal(M.matchesCityFilter("三亚,海口", ["海口市", "项目标题"]), true);
  assert.equal(M.matchesCityFilter("三亚、海口", ["海口市", "项目标题"]), true);
  assert.equal(M.matchesCityFilter("三亚", ["海口市", "项目标题"]), false);
});

// 2026-08-16 PR #4 审查修正的归一语义（实测 -c 林州 曾被放大为整市放行；"市辖区"跨市误命中）
test("地级市↔区县归一不放大区县筛词且市辖区不跨市误命中", () => {
  // 筛地级市"安阳"→ 命中其区县记录（林州市）
  assert.equal(M.matchesCityFilter("安阳", ["林州市管网项目"]), true);
  // 筛区县"林州"→ 不放行安阳市本级记录（直接子串才命中）
  assert.equal(M.matchesCityFilter("林州", ["安阳市西片区雨水管网更新改造工程"]), false);
  assert.equal(M.matchesCityFilter("林州", ["林州市城区道路综合管网工程"]), true);
  // "市辖区"是 281 市通用词：筛"郑州"不得命中外市的"市辖区"记录
  assert.equal(M.matchesCityFilter("郑州", ["市辖区"]), false);
  assert.equal(M.matchesCityFilter("郑州", ["中牟县", "项目标题"]), true);
});

test("重名区县不跨地级市误命中", () => {
  assert.equal(M.matchesCityFilter("阳泉", ["晋城市城区某项目"]), false);
  assert.equal(M.matchesCityFilter("乐山", ["内江市市中区某项目"]), false);
  // 唯一归属区县仍可扩展到地级市，避免把全部区县归一能力一刀切掉。
  assert.equal(M.matchesCityFilter("郑州", ["中牟县管网项目"]), true);
});

test("安阳 zb 只采工程招标与政府采购公告栏目", () => {
  assert.deepEqual(M.ADAPTERS.anyang.cats, ["001001002", "001002002"]);
  assert.equal(M.ADAPTERS.anyang.defaultType, "招标公告");
  assert.ok(!M.ADAPTERS.anyang.cats.includes("001001004")); // 评标结果
  assert.ok(!M.ADAPTERS.anyang.cats.includes("001001005")); // 中标结果
});

test("无 XLSX 模式的 sidecar 不声明不存在的 XLSX", () => {
  assert.deepEqual(M.resolveOutputPaths({ out: "out/anyang.md", xlsx: false }), { mdPath: "out/anyang.md", xlsxPath: null });
  assert.deepEqual(M.resolveOutputPaths({ out: "out/anyang.xlsx", xlsx: false }), { mdPath: "out/anyang.md", xlsxPath: null });
  assert.match(M.buildMarkdown("anyang", M.ADAPTERS.anyang, [], { keyword: "", city: "", days: 30, detail: false }), /采集报告（列表层）/);
});

test("未验证 cityCodes 时服务端城市循环保持惰性", () => {
  assert.equal(M.resolveCityTargets(M.ADAPTERS.henan, { city: "郑州" }), null);
  const ad = { cityCodes: [{ name: "郑州市", code: "410100" }, { name: "洛阳市", code: "410300" }] };
  assert.deepEqual(M.resolveCityTargets(ad, { city: "郑州" }), [ad.cityCodes[0]]);
  assert.equal(M.resolveCityTargets(ad, { city: "" }), null);
});

test("标段式资质字段不截断在标签前缀", () => {
  const text = "3.1 本次招标要求投标人具有：一标段: 资质:市政公用工程施工总承包一级及以上，资格:企业营业执照有效。";
  assert.equal(M.grabQualification(text, text), "市政公用工程施工总承包一级及以上");
});

test("中文大写保证金换算成万元", () => {
  assert.equal(M.grabMoneyWan("投标保证金：人民币叁万元整", ["投标保证金"]), "3");
  assert.equal(M.grabMoneyWan("保证金人民币壹拾贰万伍仟元整", ["保证金"]), "12.5");
});

test("评标办法优先标签语义，不被定标机制抢占", () => {
  const text = "本项目采用评定分离方式定标。评标办法采用智能筛查合理价格法。";
  assert.equal(M.grabEvaluation(text), "智能筛查合理价格法");
});

test("括号式招标编号可提取", () => {
  assert.equal(M.grabProjectCode("项目中标候选人公示（招标编号：X4600002901005541001）", ""), "X4600002901005541001");
});

test("候选人表格提取第一名且不把历史业绩合同额当当前合同额", () => {
  const html = `
    <p>招标项目编号：X4600002901005541001</p><p>招标人：文昌市教育局</p>
    <table><tr><th>排序</th><th>中标候选人名称</th><th>投标总报价（元）</th><th>质量</th><th>工期/交货期</th><th>评标结果</th></tr>
      <tr><td>1</td><td>南宁昊冠住宅建筑有限责任公司;广西建工集团第二建筑工程有限责任公司</td><td>28973241.64</td><td>合格</td><td>425</td><td>93.63</td></tr></table>
    <table><tr><th>序号</th><th>中标候选人名称</th><th>项目负责人名称</th><th>相关证书</th></tr>
      <tr><td>1</td><td>南宁昊冠住宅建筑有限责任公司;广西建工集团第二建筑工程有限责任公司</td><td>古志强</td><td>证书</td></tr></table>
    <p>候选人历史业绩合同金额：8000万元</p>`;
  const out = M.extractWinDetail({ stageKey: "candidate" }, html, { url: "https://example.invalid/2" }, "");
  assert.equal(out.winner, "南宁昊冠住宅建筑有限责任公司;广西建工集团第二建筑工程有限责任公司");
  assert.equal(out.winPrice, "2897.3242");
  assert.equal(out.duration, "425");
  assert.equal(out.winScore, "93.63");
  assert.equal(out.rank, "1");
  assert.equal(out.winManager, "古志强");
  assert.equal(out.projectCode, "X4600002901005541001");
  assert.equal(out.contractAmount, "");
});

test("合同阶段仍提取真实合同金额", () => {
  const out = M.extractWinDetail({ stageKey: "contract" }, "<p>合同金额：123.45万元</p>", { url: "https://example.invalid/3" }, "");
  assert.equal(out.contractAmount, "123.45");
});

test("输出清洗不把合法 0 当缺失", () => {
  assert.equal(M.cleanOutputCell(undefined), "");
  assert.equal(M.cleanOutputCell("undefined"), "");
  assert.equal(M.cleanOutputCell(Number.NaN), "");
  assert.equal(M.cleanOutputCell("{{downloadurl}}"), "");
  assert.equal(M.cleanOutputCell(0), 0);
});

test("中文省名覆盖全部 32 个 adapter", () => {
  const covered = new Set(Object.values(M.PROV_ALIAS));
  const missing = Object.keys(M.ADAPTERS).filter((key) => !covered.has(key));
  assert.deepEqual(missing, []);
});

test("中标人噪声留空，表格第一名可识别", () => {
  const noisy = M.extractWinDetail({}, "<p>中标人：公示-</p>", { url: "https://example.invalid/1" }, "");
  assert.equal(noisy.winner, "");
  const valid = M.extractWinDetail({}, "<p>第1名 测试建设有限公司</p><p>中标价：123.45万元</p>", { url: "https://example.invalid/2" }, "");
  assert.equal(valid.winner, "测试建设有限公司");
  assert.equal(valid.winPrice, "123.45");
});

test("XLSX 与 CSV schema 由代码常量锁定", () => {
  assert.equal(M.XLSX_HEADER.length, 29);
  assert.equal(M.CSV_HEADER.length, 37); // 2026-08-15 +tenderType（标的量纲标记）
  assert.equal(new Set(M.XLSX_HEADER).size, M.XLSX_HEADER.length);
  assert.equal(new Set(M.CSV_HEADER).size, M.CSV_HEADER.length);
});

test("运行报告区分真实记录、空窗口与失败", () => {
  assert.equal(M.classifyRunStatus([{ title: "公告", date: "2026-08-15", url: "https://example.invalid/1" }]), "VERIFIED_RECORD");
  assert.equal(M.classifyRunStatus([]), "CONNECTED_NO_RECENT_DATA");
  assert.equal(M.classifyRunStatus([], [{ code: "HTTP", message: "timeout" }]), "FAILED");
  assert.equal(M.classifyRunStatus([], [], { auth_walls: [{ status: 403 }] }), "BROWSER_REQUIRED");
  assert.equal(M.classifyRunStatus([{ title: "公告", date: "2026-08-15", url: "" }]), "FAILED");
  const report = M.buildRunReport("anhui", M.ADAPTERS.anhui, [], { province: "anhui", city: "", keyword: "", days: 30, stage: "zb", detail: false, limit: 1, xlsxLayout: "biaobiaotong16" });
  assert.equal(report.schema_version, "bid-collect.run-report.v1");
  assert.equal(report.status, "CONNECTED_NO_RECENT_DATA");
  assert.equal(report.counts.total, 0);
  assert.match(report.status_reason, /空结果/);
});

test("详情标题覆盖列表层截断值", () => {
  assert.equal(M.extractNoticeTitle('<p class="article-title">长江沿线无为市镇区污水管网提升改造项目二标段(姚沟镇)招标公告</p>', "项目..."), "长江沿线无为市镇区污水管网提升改造项目二标段(姚沟镇)招标公告");
  assert.equal(M.extractNoticeTitle('<title>招标公告</title>', "项目..."), "项目...");
});

test("XLSX 行宽与 schema 一致且脏哨兵不出现在单元格", () => {
  const sheets = M.buildXlsxSheets([{
    sheet: "其他项目",
    city: "undefined",
    bidOpen: null,
    title: "示例项目",
    funding: Number.NaN,
    url: "https://example.invalid/item/1",
    docLink: "%7B%7Bdownloadurl%7D%7D",
    partyB: "null",
  }]);
  assert.equal(sheets.length, 1);
  assert.deepEqual(sheets[0].rows[0], M.XLSX_HEADER);
  assert.equal(sheets[0].rows[1].length, M.XLSX_HEADER.length);
  assert.ok(!sheets[0].rows[1].some((value) => /^(?:undefined|null|nan)$/i.test(String(value))));
  assert.ok(!sheets[0].rows[1].some((value) => /downloadurl|%7[Bb]|%7[Dd]|[{}]/i.test(String(value))));
});

// 由 Cowork 补：标的类型（量纲标记）抽取
test("标的类型按标题量纲标记", () => {
  assert.equal(M.inferTenderType ? M.inferTenderType("马鞍山市城区市政污水管网提质增效工程（二期）监理") : "", "监理");
  assert.equal(M.inferTenderType("含山县污水管网提升改造项目EPC"), "EPC总承包");
  assert.equal(M.inferTenderType("含山县污水管网提升改造项目EPC（监理）"), "监理"); // EPC监理标=服务费量纲
  assert.equal(M.inferTenderType("某管网改造工程施工"), "施工");
  assert.equal(M.inferTenderType("污水泵站设备采购"), "货物采购");
  assert.equal(M.inferTenderType("水质检测服务采购"), "检测监测"); // 检测服务采购=检测监测类，比货物采购更精确
  assert.equal(M.inferTenderType("某某项目"), "");
});


// 由 Cowork 补：浙江「中标候选人排序|投标人」表头（复刻 2026-08-15 岱山真实页面结构：rowspan/colspan 嵌套表头）
test("浙江候选人表头(投标人列头)可解析第一名", () => {
  const html = '<table>' +
    '<tr><td rowspan="2">中标候选人排序</td><td rowspan="2">投标人</td><td rowspan="2">投标报价</td><td rowspan="2">工期（或服务期、交货期）</td><td rowspan="2">质量承诺</td><td colspan="3">项目负责人</td><td rowspan="2">中标候选人响应招标文件的资格能力条件</td></tr>' +
    '<tr><td>姓名</td><td>相关证书名称及编号</td><td>个人业绩</td></tr>' +
    '<tr><td>1</td><td>浙江舟山成盛建设有限公司</td><td>91,238,540.00元</td><td>526天</td><td>合格</td><td>林珊</td><td>无</td><td>无</td><td>无</td></tr>' +
    '</table>';
  const out = M.extractCandidateTables(html);
  assert.equal(out.winner, "浙江舟山成盛建设有限公司");
  assert.equal(out.winPrice, "9123.854");
  assert.equal(out.rank, "1");
  assert.ok(String(out.duration).includes("526"));
});

// 由 Cowork 补：合同主体角色括号后缀（海南真实表述）
test("合同主体(甲方)/(乙方)角色后缀可抽取", () => {
  const text = '五、合同主体 采购人(甲方)：海口市琼山区水务局 地址：海南省海口市 联系方式：0898-65915889 供应商(乙方)：中粤建设集团（海南）有限公司 法定代表人：王天焕';
  const out = M.extractWinDetail({ stageKey: "contract" }, "<p>" + text + "</p>", { url: "https://example.invalid/9" }, "");
  assert.equal(out.partyA, "海口市琼山区水务局");
  assert.equal(out.partyB, "中粤建设集团（海南）有限公司");
});

// 2026-08-16 Goal v3 回源核查补充：EPoint 表格拼接串与平台操作指引拒收（黑龙江/兵团/重庆/海南实测）
test("工期抽取拒绝表格拼接串且日期不误判为年单位", () => {
  const out1 = M.extractDetail(M.ADAPTERS.heilongjiang,
    "<p>2.3 计划工期 （天）监理费上限（万元）SZJL0504G250715001001002 黑龙江省大庆市 2025年08月22日 2026年10月31日 435 37.62</p>",
    { title: "供水管网改造（监理）", url: "https://example.invalid/a" }, "");
  assert.equal(out1.duration, "");   // 表格拼接串拒收，诚实留空
  const out2 = M.extractDetail(M.ADAPTERS.chongqing,
    "<p>2.5 工期要求： 270 日历天。缺陷责任期要求： 24 个月</p>",
    { title: "污水厂配套管网", url: "https://example.invalid/b" }, "");
  assert.equal(out2.duration, "270 日历天");   // "要求："前缀剥离后保留工期值
});
test("招标人抽取拒绝平台操作指引文本", () => {
  const out = M.extractDetail(M.ADAPTERS.heilongjiang,
    "<p>七、其他说明 招标人/招标代理机构在交易平台点击保证金退回申请。</p>",
    { title: "供水管网改造", url: "https://example.invalid/c" }, "");
  assert.equal(out.owner, "");   // 指引文本不是招标人，诚实留空
});

// 2026-08-16 Goal V4A 数据正确性修复固化（审计实测复现，见 _THICK_FIELD_AUDIT / 优化路线图）
test("中标价表头(万)不再缩小万倍且百元级留空", () => {
  const html = `<table>
    <tr><th>中标候选人名称</th><th>投标报价(万)</th><th>排序</th></tr>
    <tr><td>某某建设工程有限公司</td><td>950</td><td>1</td></tr></table>`;
  const out = M.extractWinDetail({ stageKey: "candidate" }, html, { url: "https://example.invalid/v4a1" }, "");
  assert.equal(out.winPrice, "950");   // 原版 \b万\b 失效 → "0.095"（缩小 10000 倍）
  const html2 = `<table>
    <tr><th>中标候选人名称</th><th>投标报价（元）</th><th>排序</th></tr>
    <tr><td>某某建设工程有限公司</td><td>28973241.64</td><td>1</td></tr></table>`;
  assert.equal(M.extractWinDetail({ stageKey: "candidate" }, html2, { url: "https://example.invalid/v4a2" }, "").winPrice, "2897.3242");
});
test("多标段页项目经理不被第二张带价表覆盖", () => {
  const html = `<table>
    <tr><th>中标候选人名称</th><th>投标报价(万元)</th><th>项目负责人</th><th>排序</th></tr>
    <tr><td>一标段甲公司</td><td>1200</td><td>张三</td><td>1</td></tr></table>
    <table>
    <tr><th>中标候选人名称</th><th>投标报价(万元)</th><th>项目负责人</th><th>排序</th></tr>
    <tr><td>二标段乙公司</td><td>800</td><td>李四</td><td>1</td></tr></table>`;
  const out = M.extractWinDetail({ stageKey: "candidate" }, html, { url: "https://example.invalid/v4a3" }, "");
  assert.equal(out.winner, "一标段甲公司");
  assert.equal(out.winManager, "张三");   // 原版被第二张表覆盖为"李四"（跨标段错配）
});
test("无排序列的单行候选表直接采纳", () => {
  const html = `<table>
    <tr><th>中标候选人名称</th><th>投标报价(万元)</th></tr>
    <tr><td>某某建设有限公司</td><td>950</td></tr></table>`;
  const out = M.extractWinDetail({ stageKey: "candidate" }, html, { url: "https://example.invalid/v4a4" }, "");
  assert.equal(out.winner, "某某建设有限公司");   // 原版整表跳过静默降级
  assert.equal(out.winPrice, "950");
});
test("自治州官方全名可筛到下辖市", () => {
  assert.equal(M.matchesCityFilter("大理白族自治州", ["大理市某管网项目"]), true);   // 原版 7 州全失配
  assert.equal(M.matchesCityFilter("红河哈尼族彝族自治州", ["个旧市供水工程"]), true);
  assert.equal(M.matchesCityFilter("临夏回族自治州", ["临夏市污水管网"]), true);
});
test("--days 非数字显式报错而非静默翻满 200 页", () => {
  assert.throws(() => M.parseArgs(["-p", "anhui", "-d", "abc"]), /--days/);   // parseInt("abc")=NaN → 原版静默穿透
  assert.equal(M.parseArgs(["-p", "anhui", "--delay", "abc"]).delay, 500);    // delay NaN 回落默认，礼貌延迟不失守
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 1;
  }
}
console.log(`SELF_TEST ${passed}/${tests.length} passed`);
