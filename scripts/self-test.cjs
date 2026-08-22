"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const M = require(path.join(__dirname, "province-collect.cjs"));
const SKILL_ROOT = process.env.BID_COLLECT_SKILL_ROOT ? path.resolve(process.env.BID_COLLECT_SKILL_ROOT) : path.join(__dirname, "..");
const CAP = require(path.join(SKILL_ROOT, "scripts", "project18-capabilities.cjs"));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("SKILL.md frontmatter 只使用 Codex 支持的顶层键", () => {
  const skill = fs.readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
  const fm = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, "缺少 YAML frontmatter");
  const keys = fm[1].split(/\r?\n/).filter((line) => /^[A-Za-z][\w-]*:/.test(line)).map((line) => line.split(":", 1)[0]);
  const allowed = new Set(["name", "description", "license", "allowed-tools", "metadata"]);
  assert.deepEqual(keys.filter((key) => !allowed.has(key)), []);
});

test("62 个 adapter 均已注册（32 省级 + 30 城市级）", () => {
  assert.equal(Object.keys(M.ADAPTERS).length, 62);
});

test("SKILL.md adapter 清单与代码完全一致", () => {
  const skill = fs.readFileSync(path.join(SKILL_ROOT, "SKILL.md"), "utf8");
  const block = skill.match(/## 62 个 adapter[\s\S]*?```text\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(block, "SKILL.md 缺少 62 个 adapter 清单");
  const listed = block[1].trim().split(/\s+/);
  assert.deepEqual([...new Set(listed)].sort(), Object.keys(M.ADAPTERS).sort());
});

test("中文省名覆盖全部 adapter", () => {
  const covered = new Set(Object.values(M.PROV_ALIAS));
  const missing = Object.keys(M.ADAPTERS).filter((key) => !covered.has(key));
  assert.deepEqual(missing, []);
});

test("62 个 adapter 均有可执行的官方 reference", () => {
  for (const adapter of Object.keys(M.ADAPTERS)) {
    const file = path.join(SKILL_ROOT, "reference", `${adapter}.md`);
    assert.ok(fs.existsSync(file), `${adapter} 缺少 reference`);
    const text = fs.readFileSync(file, "utf8");
    assert.match(text, /^## 机制\s*$/m, `${adapter} 缺少机制说明`);
    assert.match(text, /验证状态：/, `${adapter} 缺少验证状态`);
    assert.match(text, /https?:\/\//, `${adapter} 缺少官方 URL 证据`);
    assert.match(text, /^## 可重复采集命令\s*$/m, `${adapter} 缺少复采命令`);
  }
});

test("招标公告实时状态总账覆盖全部 62 个 adapter", () => {
  const file = path.join(SKILL_ROOT, "reference", "ZB_LIVE_STATUS_2026-08-15.md");
  assert.ok(fs.existsSync(file), "缺少招标公告实时状态总账");
  const text = fs.readFileSync(file, "utf8");
  const rows = [...text.matchAll(/^\| ([a-z][a-z0-9]+) \|/gm)].map((m) => m[1]).filter((adapter) => M.ADAPTERS[adapter]);
  assert.equal(new Set(rows).size, 62);
  assert.deepEqual([...new Set(rows)].sort(), Object.keys(M.ADAPTERS).sort());
  assert.match(text, /`VERIFIED_RECORD`：56 个/);
  assert.match(text, /`CONNECTED_NO_RECENT_DATA`：5 个/);
  assert.match(text, /`FAILED`：1 个/);
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

test("最高限价公式不借专业暂估价，分裂小数仍取合同估算价", () => {
  const text = "最高投标限价为B。上述方法五最高投标限价和评标价均应扣除专业工程暂估价（含税金）后参与计算；应扣除的专业工程暂估价为87200.00元。工程合同估算价（万元）：606 . 2 2 万元。";
  const got = M.grabMoneyWan(text, ["招标控制价", "控制价", "最高投标限价", "合同估算价"]);
  assert.equal(got, "606.22");
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

test("徐州使用官方 EPoint new API，避免静态分页年度断层", () => {
  const ad = M.ADAPTERS.xuzhou;
  assert.equal(ad.kind, "epointX");
  assert.equal(ad.apiPath, "/inteligentsearchnew/rest/esinteligentsearch/getFullTextDataNew");
  assert.deepEqual(ad.cats, ["003001001"]);
  const body = ad.makeBody(0, "管网", "003001001");
  assert.equal(body.cnum, "002");
  assert.equal(body.wd, "管网");
  assert.equal(body.condition[0].equal, "003001001");
});

test("潍坊锁招标公告栏目、零基分页响应并清理重发标题 HTML", () => {
  const ad = M.ADAPTERS.weifang;
  assert.equal(ad.categoryNum, "007001001");
  assert.equal(ad.keepScheme, true);
  assert.equal(ad.keepPort, true);
  const got = M.parseWeifangList({ custom: { infodata: [{
    customtitle: '<font color="red">[重发公告]</font> 寿光市供水管网工程招标公告',
    infodate: "2026-07-09 10:00:00", infourl: "/wfggzy/jyxx/007001/007001001/a.html", projectno: "JSGC-SG-1",
  }] } }, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].title, "[重发公告] 寿光市供水管网工程招标公告");
  assert.equal(got[0].cityHint, "寿光市");
  assert.match(got[0].url, /^http:\/\/ggzy\.weifang\.gov\.cn:8082\//);
  assert.throws(() => M.parseWeifangList({ status: { text: "操作成功" } }, ad), /invalid response structure/);
});

test("青岛 SSR 招标公告列表与结构化详情字段锁定", () => {
  const ad = M.ADAPTERS.qingdao;
  const html = `<tr><td class="box_td"><a href="/TradeDetals-ZtbShow/1-5021-0-0-0/g" title="新区老旧排水管网提升改造工程">[西海岸][公开] 新区老旧排水管网提升改造工程</a></td><td>2026-08-17</td></tr>`;
  const got = M.parseQingdaoHtml(html, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].cityHint, "西海岸");
  assert.match(got[0].url, /TradeDetals-ZtbShow\/1-5021-0-0-0\/g$/);
  const detail = M.qingdaoDetail(ad, `<div class="tle">新区老旧排水管网提升改造工程招标公告</div><table>
    <tr><td class="bg"><strong>工程造价：</strong></td><td>66042741.73元</td></tr>
    <tr><td class="bg"><strong>本项目总投资额：</strong></td><td>188510000元</td></tr>
    <tr><td class="bg"><strong>招标单位：</strong></td><td>青岛市城市管理局</td></tr>
    <tr><td class="bg"><strong>工程地点:</strong></td><td>西海岸新区</td></tr></table>`, got[0]);
  assert.equal(detail.controlPrice, "6604.274173");
  assert.equal(detail.budget, "18851");
  assert.equal(detail.owner, "青岛市城市管理局");
  assert.equal(detail.projectSite, "西海岸新区");
  assert.equal(detail.duration, "");
});

test("深圳列表严格只收 noticeTypeName=招标公告，保留官方地区和业务链接", () => {
  const ad = M.ADAPTERS.shenzhen;
  const got = M.parseShenzhenList({ data: { content: [{
    id: 20584564, channelId: 2851, noticeTypeName: "招标公告", noticeTitle: "深汕高中园项目智能化工程",
    releaseTime: "2026-08-18 18:00:00", areaName: "深汕特别合作区", tenderer: "深圳市建筑工务署",
    proxyComName: "深圳交易咨询公司", bidSectionNumber: "A001",
  }, { id: 2, channelId: 2851, noticeTypeName: "截标信息", rank1NoticeTypeName: "招标公告", noticeTitle: "错误阶段" }] } }, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].cityHint, "深汕特别合作区");
  assert.equal(got[0].owner, "深圳市建筑工务署");
  assert.match(got[0].url, /contentId=20584564&channelId=2851$/);
  assert.equal(M.exactMoneyWan("2369.89万元"), "2369.89");
  assert.equal(M.exactMoneyWan("66042741.73元"), "6604.274173");
  assert.equal(M.parseShenzhenList({ data: { content: [{ id: 3, channelId: 2851, noticeTypeName: "招标公告", noticeTitle: "某项目资格预审公告", releaseTime: "2026-08-18" }] } }, ad).length, 0);
});

test("A3 城市结构化详情拒绝金额尾噪声、评审模板、空标签与跨章节资质", () => {
  assert.equal(M.cleanA3ScopeAmountTail("施工图及工程量清单范围内全部施工。 12833928.83"), "施工图及工程量清单范围内全部施工。");
  assert.equal(M.cleanA3ScopeAmountTail("道路、排水及绿化工程。本次招标建安工程造价22427185元。"), "道路、排水及绿化工程。");
  assert.equal(M.cleanQingdaoPerformance("企业业绩评审、获得奖项评审、项目管理班子成员配备情况评审", ""), "");
  assert.equal(M.cleanQingdaoPerformance("", "本项目资格审查阶段无业绩要求。"), "不要求");
  assert.equal(M.cleanNanjingQualification("具有建筑垃圾运输资格。4.招标文件的获取"), "具有建筑垃圾运输资格。");
  assert.equal(M.cleanNanjingQualification("具有工程设计综合甲级资质。业绩要求：承担过涉铁工程设计项目。"), "具有工程设计综合甲级资质。");
  assert.deepEqual(M.shenzhenProjectContent({}), { scale: "", scope: "" });
  assert.deepEqual(M.shenzhenProjectContent({ "本次招标面积": "12000平方米", "本次招标内容": "施工图范围内全部施工" }), { scale: "12000平方米", scope: "施工图范围内全部施工" });
  assert.equal(M.qualitativeFullScore("定性评审法"), "不适用（定性评审）");
  assert.equal(M.qualitativeFullScore("综合评估法"), "");
  assert.equal(M.ningboExactDuration("施工期的现场配合服务等"), "");
  assert.equal(M.ningboExactDuration("工期要求：总工期为270日历天"), "270日历天");

  const jinan = M.jinanDetail("<p>1.项目名称:示例</p><p>4.计划工期:240</p><p>5.质量要求:合格</p><p>1、本次招标要求潜在投标人应当同时具备工程勘察乙级和工程设计甲级资质，具备承担本项目的能力。</p><p>2、投标人拟派项目负责人须注册。</p><p>4、业绩要求：投标人承担过单项合同100万元以上类似工程。</p><p>5、信誉要求：良好。</p>", { title: "济南示例招标公告", url: "https://example.invalid/jinan" }, "");
  assert.equal(jinan.duration, "240");
  assert.match(jinan.qualification, /工程勘察乙级/);
  assert.doesNotMatch(jinan.qualification, /投标人拟派/);
  assert.match(jinan.performance, /100万元/);

  const zhongshan = M.zhongshanDetail("<table><tr><td>投标资格能力要求</td><td>工程勘察综合甲级资质；工程设计市政行业甲级资质</td></tr></table>", { title: "中山示例招标公告", url: "https://example.invalid/zs" }, "");
  assert.match(zhongshan.qualification, /工程勘察综合甲级/);
});

test("B1 关键词与项目内容守卫拒绝非招标阶段、章节标题和零控制价串值", () => {
  assert.equal(M.ADAPTERS.changzhou.keywordClient, true);
  assert.equal(M.ADAPTERS.anyang.itemAllowed({ title: "市政管网改造工程竞争性磋商公告" }), false);
  assert.equal(M.ADAPTERS.anyang.itemAllowed({ title: "市政管网改造工程招标公告" }), true);
  assert.equal(M.extractProjectContent("", "招标范围：2.1标段概况", "招标范围：2.1标段概况").scope, "");
  assert.equal(M.extractProjectContent("", "招标范围：2.1标段名称：设计", "招标范围：2.1标段名称：设计").scope, "");
  assert.equal(M.extractProjectContent("", "招标范围：2.1标段名称", "招标范围：2.1标段名称").scope, "");
  assert.equal(M.extractProjectContent("", "建设规模：/，建设地点：衢州市", "建设规模：/，建设地点：衢州市").scale, "");
  const section = M.extractProjectContent("", "2.2 招标范围：新建DN1500管道18公里及附属设施。\n2.3 施工工期：300日历天", "");
  assert.match(section.scope, /DN1500管道18公里/);
  assert.doesNotMatch(section.scope, /施工工期/);
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.changzhou, { city: "社渚污水处理厂", title: "配套管网工程" }), "常州市");
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.changzhou, { city: "大唐至金花河南（华城路路南）", title: "热力管网桩号5101工程" }), "常州市");
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.changzhou, { city: "常州市新北区新桥街道秀水河路11号", title: "科创中心设计" }), "常州市");
  const cleanScope = M.extractProjectContent("", "招标范围：新建DN1500管道18公里，其中，□建筑面积㎡。本次招标建安工程造价704万元。", "");
  assert.equal(cleanScope.scope, "新建DN1500管道18公里");
  const perfNoise = M.extractDetail({}, "<p>业绩要求：的企业或者项目负责人仅可选1项</p>", { title: "示例招标公告", url: "https://example.invalid/b1" }, "");
  assert.equal(perfNoise.performance, "");
  const perf = M.extractDetail({}, "<p>具有与本工程相类似项目的设计业绩：自2023年1月1日以来，承担过管道长度700m以上且DN1400以上的给水工程设计项目。证明材料需提供中标通知书和合同。</p>", { title: "江苏设计招标公告", url: "https://example.invalid/js" }, "");
  assert.match(perf.performance, /管道长度700m以上/);
  assert.doesNotMatch(perf.performance, /证明材料需提供/);
  const serviceScope = M.extractProjectContent("", "2.6设计及相关服务范围：本次招标包括初步设计、施工图设计及后续服务。", "");
  assert.match(serviceScope.scope, /初步设计/);
  assert.equal(M.extractProjectContent("", "发包内容：合同估算价（万元）", "发包内容：合同估算价（万元）").scope, "");
  const qual = M.extractDetail({}, "<p>资质要求：1.资质等级及范围：2.项目负责人资质类别和等级：3.本次招标不接受联合体投标。4.其它要求：企业要求：具有市政公用工程施工总承包一级资质。四、投标1.投标截止时间：2026年9月1日。</p>", { title: "浙江工程招标公告", url: "https://example.invalid/qual" }, "");
  assert.match(qual.qualification, /市政公用工程施工总承包一级/);
  assert.doesNotMatch(qual.qualification, /投标截止时间/);
  const zero = M.extractDetail({}, "<p>工程概算38624万元，其中建安工程造价30632万元。</p><p>本次招标建安工程造价0.0000万元。</p>", { title: "浙江供水工程招标公告", url: "https://example.invalid/zj" }, "");
  assert.equal(zero.controlPrice, "");
});

test("B2 拒绝标段划分、未勾选业绩模板与引用式规模", () => {
  const scope = M.extractProjectContent("", "招标范围：以工程量清单范围内全部内容为准2.5标段划分：共八个标段", "");
  assert.equal(scope.scope, "以工程量清单范围内全部内容为准");
  const template = M.extractDetail({}, "<p>业绩要求：□近年（ 年 月 日至投标截止时间，不少于3年）不少于（1至3个）个类似项目</p>", { title: "四川工程招标公告", url: "https://example.invalid/sc" }, "");
  assert.equal(template.performance, "");
  const multi = M.extractDetail({}, "<p>业绩要求：（本项为多选）</p>", { title: "四川EPC招标公告", url: "https://example.invalid/sc2" }, "");
  assert.equal(multi.performance, "");
  assert.equal(M.extractProjectContent("", "建设规模：同施工五、六标段的建设规模", "").scale, "");
  assert.equal(M.extractProjectContent("", "招标范围：供货期（天）", "").scope, "");
  assert.equal(M.extractProjectContent("", "招标范围：1.招标项目所在实施地区：新疆生产建设兵团·一师", "").scope, "");
  const luoyangScope = M.extractProjectContent("", "招标范围：项目规划红线内所有设计。2.4最高投标限价：170万元 2.5服务期限：25日历天", "");
  assert.equal(luoyangScope.scope, "项目规划红线内所有设计。");
  assert.equal(M.extractProjectContent("", "建设规模：1;道路硬化24301平方米", "").scale, "道路硬化24301平方米");
  const funding = M.extractDetail({}, "<p>资金来源：为市财政资金35%，企业自筹65%，项目已具备招标条件，现公开招标</p>", { title: "郑州供水工程招标公告", url: "https://example.invalid/zz" }, "");
  assert.equal(funding.funding, "市财政资金35%，企业自筹65%");
});

test("B3 拒绝非招标采购、标段章节和项目名字段污染", () => {
  assert.equal(M.isStrictZbTitle("雨污管网在线监测项目竞争性磋商采购公告"), false);
  assert.equal(M.isStrictZbTitle("供水管网建设项目公开招标公告"), true);
  assert.equal(M.grabConsortium("本项目是否接受联合体谈判：否"), "不接受");
  assert.equal(M.grabConsortium("本项目是否接受联合体投标：是"), "接受");
  assert.equal(M.extractProjectContent("", "建设规模：1.项目名称：污水处理厂劳务分包", "").scale, "");
  assert.equal(M.extractProjectContent("", "招标范围：2.5.1施工标段：", "").scope, "");
  assert.equal(M.extractProjectContent("", "招标范围：2.5.1施工标段：繁荣广场等17个片区施工", "").scope, "繁荣广场等17个片区施工");
  assert.equal(M.extractProjectContent("", "招标范围：该项目位于寿光市城区，该工程概况", "").scope, "");
  assert.equal(M.extractProjectContent("", "招标范围：2.3招标工程标段划分及计划工期：本次招标工程共划分1个标段", "").scope, "");
  const duration = M.extractDetail({}, "<p>计划工期：本次招标工程共划分1个标段，各标段划分及工期要求如下。计划工期:140.0天</p>", { title: "青海排水工程招标公告", url: "https://example.invalid/qh" }, "");
  assert.equal(duration.duration, "140.0天");
  const funding = M.extractDetail({}, "<p>资金来源：：国债资金和自有资金</p>", { title: "潍坊供热工程招标公告", url: "https://example.invalid/wf" }, "");
  assert.equal(funding.funding, "国债资金和自有资金");
  const qual = M.extractDetail({}, "<p>资质要求：市政公用工程施工总承包三级资质，/业绩，并在人员、设备方面具备能力</p>", { title: "青海供水工程招标公告", url: "https://example.invalid/qh2" }, "");
  assert.doesNotMatch(qual.qualification, /[\/／]?业绩/);
  assert.equal(M.ADAPTERS.wuxi.detailReject.test("第一章 资格预审公告 6.资格预审文件的获取"), true);
  const performance = M.extractDetail({}, "<p>类似工程认定标准：企业自2021年8月21日以来承担过单项合同金额不低于3700万元且管径不低于DN1000的市政管线工程。类似工程业绩必须同时提供中标通知书和合同。</p>", { title: "无锡管网工程招标公告", url: "https://example.invalid/wx" }, "");
  assert.match(performance.performance, /3700万元/);
  assert.doesNotMatch(performance.performance, /必须同时提供/);
  const yichang = M.extractDetail({}, "<p>2.5计划监理与相关服务期：施工阶段监理服务期为项目实际施工工期的基础上增加90日历天（协助前期施工准备），保修阶段监理服务期为单项工程竣工验收合格后2年。</p><p>三、投标人资格要求</p><p>3.1 具有有效法人营业执照。</p><p>3.2 投标人具备市政公用工程施工总承包三级及以上资质。</p><p>联合体中不同且分工相同的成员组成的联合体投标人，以联合体成员中资质等级较低者确定资质等级。</p>", { title: "监理招标公告", url: "https://example.invalid/yc" }, "");
  assert.match(yichang.duration, /^施工阶段监理服务期为项目实际施工工期的基础上增加90日历天/);
  assert.match(yichang.qualification, /市政公用工程施工总承包三级及以上资质/);
  assert.doesNotMatch(yichang.qualification, /联合体成员中资质等级/);
  const qinghai = M.extractProjectContent("", "2.1 项目概况\n建设地点：青海省西宁市\n招标范围：河湖系统治理及配套设施。\n经评审的最低投标价法一般适用于工程规模较小、技术含量较低，或者招标人对技术、性能没有特殊要求的招标项目。", "2.1 项目概况 建设地点：青海省西宁市 招标范围：河湖系统治理及配套设施。 经评审的最低投标价法一般适用于工程规模较小、技术含量较低，或者招标人对技术、性能没有特殊要求的招标项目。");
  assert.equal(qinghai.scale, "");
  assert.equal(qinghai.scope, "河湖系统治理及配套设施。");
});

test("洛阳与郑州复用标准 EPoint 并锁定城市招标公告边界", () => {
  assert.equal(M.ADAPTERS.luoyang.kind, "epoint");
  assert.equal(M.ADAPTERS.luoyang.keepScheme, true);
  assert.equal(M.ADAPTERS.luoyang.cnum, "001");
  assert.deepEqual(M.ADAPTERS.luoyang.cats, ["003001002"]);
  assert.equal(M.ADAPTERS.zhengzhou.kind, "epoint");
  assert.equal(M.ADAPTERS.zhengzhou.cnum, "012");
  assert.deepEqual(M.ADAPTERS.zhengzhou.cats, ["004001"]);
  assert.equal(M.ADAPTERS.zhengzhou.itemAllowed({ title: "郑汴路供水管网改造EPC总承包" }), true);
  assert.equal(M.ADAPTERS.zhengzhou.itemAllowed({ title: "郑汴路供水管网改造招标计划" }), false);
  assert.equal(M.PROV_ALIAS.洛阳, "luoyang");
  assert.equal(M.PROV_ALIAS.郑州, "zhengzhou");
});

test("洛阳未勾选业绩模板与郑州明确联合体声明按语义优先", () => {
  const ly = M.extractDetail(M.ADAPTERS.luoyang,
    "<p>□类似项目业绩要求：自以来□承接过/□完成过业绩</p>",
    { title: "[暗标]汝阳县地下污水管网建设项目", url: "http://example.invalid/ly" }, "");
  assert.equal(ly.performance, "不要求");
  const zz = M.extractDetail(M.ADAPTERS.zhengzhou,
    "<p>本次招标接受联合体投标。联合体各方不得再单独参加或者组成其他联合体参加本项目投标。</p>",
    { title: "郑州市供水管网工程", url: "https://example.invalid/zz" }, "");
  assert.equal(zz.consortium, "接受");
  assert.equal(M.extractKnownArea("[暗标]汝阳县地下污水管网建设项目"), "汝阳县");
  const zzPerf = M.extractDetail(M.ADAPTERS.zhengzhou,
    "<p>3.3.1 企业类似工程业绩</p><p>□不要求类似工程业绩；</p><p>☑要求，投标人自2023年1月1日以来至少具有一项单项合同额不低于2000万元的雨水管网改造工程业绩。</p><p>3.3.2 项目经理类似工程业绩</p><p>☑不要求类似工程业绩；</p>",
    { title: "郑州市雨水管网工程", url: "https://example.invalid/zz2" }, "");
  assert.match(zzPerf.performance, /2000万元/);
  assert.doesNotMatch(zzPerf.performance, /^3\.3\.1 企业类似工程业绩$/);
});

test("绵阳静态列表与多阶段关系只选择 001001 招标公告", () => {
  const ad = M.ADAPTERS.mianyang;
  const html = `<li class="infor-list"><a class="infor-con" href="/myggzy/projectInfo.html?infoid=6c724d2a-aeb6-480d-856e-4cb771bf456e&amp;categorynum=001001"><span class="infor-time">2026-08-17</span><p class="infor-text text-overflow"><font>[公路工程施工]</font>平武县农村公路项目招标公告<font>[标书发售未开始]</font></p></a></li>`;
  const listed = M.parseMianyangHtml(html, ad);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "平武县农村公路项目招标公告");
  assert.equal(listed[0].cityHint, "平武县");
  const payload = { custom: JSON.stringify([
    { categorynum: "001005", infoid: "other", urlpath: "/jsgc/001005/result.html", title: "候选" },
    { categorynum: "001001", infoid: listed[0].infoid, urlpath: "/jsgc/001001/20260817/6c724d2a-aeb6-480d-856e-4cb771bf456e.html", realtitle: "[公路工程施工]平武县农村公路项目招标公告[标书正在发售]", infodate: "2026-08-17" },
  ]) };
  const resolved = M.parseMianyangRelations(payload, listed[0], ad);
  assert.equal(resolved.title, "平武县农村公路项目招标公告");
  assert.match(resolved.url, /\/myggzy\/jsgc\/001001\/20260817\//);
  assert.throws(() => M.parseMianyangRelations({ custom: "[]" }, listed[0], ad), /relation missing/);
});

test("秦皇岛招标栏目拒绝资格预审和变更记录", () => {
  const ad = M.ADAPTERS.qinhuangdao;
  const html = [
    ["供水管道更新改造项目D标段招标公告", "a"],
    ["某项目资格预审公告", "b"],
    ["某项目招标公告变更", "c"],
  ].map(([title, id]) => `<li class="ewb-com-item"><div><a href="/qhdggzy/jydt/001003/001003001/20260818/${id}.html">${title}</a></div><span>2026-08-18</span></li>`).join("");
  const got = ad.parse(html);
  assert.equal(got.length, 1);
  assert.equal(got[0].title, "供水管道更新改造项目D标段招标公告");
  assert.equal(got[0].cityHint, "秦皇岛市");
});

test("南通 EWB 列表严格锁阶段、剔除作废并清理新标记", () => {
  const ad = M.ADAPTERS.nantong;
  const common = { GGTYPE: "招标公告", categoryname: "招标公告/资审公告", JYLX: "建设工程", JYFS: "公开招标", XIAQUNAME: "启东市", infodate: "2026-08-04" };
  const got = M.parseNantongPayload({ Table: [
    { ...common, title2: "<span>[新]</span>启东市污水管网监理招标公告", infourl: "/jyxx/003001/003001001/a.html" },
    { ...common, title2: "某工程招标公告<font>[已作废]</font>", infourl: "/jyxx/003001/003001001/b.html" },
    { ...common, GGTYPE: "中标结果", title2: "错误阶段", infourl: "/jyxx/003001/003001001/c.html" },
    { ...common, categoryname: "其他公告", title2: "错误栏目", infourl: "/jyxx/003001/003001001/d.html" },
  ] }, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].title, "启东市污水管网监理招标公告");
  assert.equal(got[0].cityHint, "启东市");
  assert.equal(got[0].method, "公开招标");
  assert.match(got[0].url, /^https:\/\/ggzyjy\.nantong\.gov\.cn\//);
  assert.equal(ad.normalizeTitle("[新]启东项目"), "启东项目");
  const detail = M.extractDetail(ad,
    "<p>逾期送达的投标文件，招标人不予受理。</p><p>十三、联系方式</p><p>招标人</p><p>南通市通州区三余镇人民政府</p><p>招标代理机构</p><p>江苏某公司</p><p>重难点分析（8分）</p>",
    { title: "通州湾污水管网勘察设计公告", url: "https://example.invalid/nt" }, "");
  assert.equal(detail.owner, "南通市通州区三余镇人民政府");
  assert.equal(detail.performance, "");
  const detail2 = M.extractDetail(ad, "<p>本项目招标人为 启东市城市水处理有限公司。</p>",
    { title: "启东污水管网监理公告", url: "https://example.invalid/nt2" }, "");
  assert.equal(detail2.owner, "启东市城市水处理有限公司");
});

test("南京 webdb 在 status.error 时仍解析 custom，并拒绝澄清与资审", () => {
  const ad = M.ADAPTERS.nanjing;
  const payload = { status: { state: "error" }, custom: JSON.stringify({ Table: [
    { GongGaoName: "(六合分中心) 供水管网工程总承包招标公告", GongGaoFBDate: "2026-08-12", href: "/njweb/fjsz/068001/068001002/a.html", BiaoDuanNO: "NJ-001", HeTongGuSuanPrice: "7488" },
    { GongGaoName: "某项目澄清修改公告", GongGaoFBDate: "2026-08-12", href: "/b.html" },
    { GongGaoName: "某项目方案设计资审公告", GongGaoFBDate: "2026-08-12", href: "/c.html" },
  ] }) };
  const got = M.parseNanjingPayload(payload, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].cityHint, "六合区");
  assert.equal(got[0].projectCode, "NJ-001");
  assert.equal(got[0].controlPrice, "7488");
  assert.deepEqual(ad.categoryNums, ["068001001", "068001002"]);
  assert.equal(M.PROV_ALIAS.南京, "nanjing");
});

test("惠州官方 JSONP 严格过滤状态、映射地区并规范代理 URL", () => {
  const ad = M.ADAPTERS.huizhou;
  const rows = [
    { title: "惠州市排水<em>管网</em>改造工程【监理】招标公告", pub_time: "2026-07-31", post_url: "http://zyjy--huizhou--gov--cn--salt.proxy.huizhou.gov.cn:80/ggfw/jyxx/jsgc/zbzgysgg/szx/content/post_1.html", post_type: "normal", is_abolished: 0, is_expired: 0, category: 31261 },
    { title: "作废管网工程招标公告", pub_time: "2026-07-31", post_url: "http://zyjy.huizhou.gov.cn/x", post_type: "normal", is_abolished: 1, is_expired: 0, category: 31261 },
    { title: "错误栏目管网工程招标公告", pub_time: "2026-07-31", post_url: "http://zyjy.huizhou.gov.cn/y", post_type: "normal", is_abolished: 0, is_expired: 0, category: 999 },
  ];
  const got = M.parseHuizhouSearchJsonp(`__bid(${JSON.stringify({ results: rows })})`, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].cityHint, "惠州市");
  assert.equal(got[0].url, "https://zyjy.huizhou.gov.cn/ggfw/jyxx/jsgc/zbzgysgg/szx/content/post_1.html");
  assert.equal(ad.normalizeTitle(got[0].title), "惠州市排水管网改造工程招标公告");
});

test("中山 node58 拒绝补充公告，地区固定并按公式末值取控制价", () => {
  const ad = M.ADAPTERS.zhongshan;
  const got = M.parseZhongshanPayload({ data: { rows: [
    { arab01: "1", arab02: "58", arab04: "坦洲镇物流北路道路建设工程", arab32: "2026-08-17 17:30:00", arab37: "0" },
    { arab01: "2", arab02: "58", arab04: "某工程补充公告", arab32: "2026-08-17 17:30:00", arab37: "1" },
    { arab01: "3", arab02: "59", arab04: "错误节点", arab32: "2026-08-17 17:30:00", arab37: "0" },
  ] } }, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].cityHint, "中山市");
  assert.equal(M.zhongshanControlPrice("最高投标限价（投标报价上限值）130245770.07×（1-10%）=117221193.06元 是否接受联合体投标 否", {}), "11722.119306");
  const detail = M.zhongshanDetail("<table><tr><td>招标项目 实施 （交货） 地点</td><td>中山市坦洲镇</td></tr><tr><td>工期（交货期）</td><td>570日历天</td></tr></table><p>本次投标总价最高投标限价为53609696.39元</p>", got[0], "");
  assert.equal(detail.projectSite, "中山市坦洲镇");
  assert.equal(detail.duration, "570日历天");
  assert.equal(detail.controlPrice, "5360.969639");
  assert.equal(detail.docLink, "");
});

test("济南 search.do 保留 isnew 并用 table_one 精确覆盖详情主体", () => {
  const ad = M.ADAPTERS.jinan;
  const html = `<ul><li><span class="span1">[市本级]</span><a onclick="showview('ABC123',1,'招标公告')" title='济南供热管网工程招标公告'>x</a><span class="span2">2026-08-18</span></li><li><span class="span1">[历城区]</span><a onclick="showview('9988',0,'招标公告')" title='历城区道路工程招标公告'>x</a><span class="span2">2026-08-17</span></li><li><span class="span1">[市本级]</span><a onclick="showview('BAD',1,'招标公告')" title='管网工程中标候选人公示'>x</a><span class="span2">2026-08-16</span></li></ul>`;
  const got = M.parseJinanPayload({ success: true, params: { str: html } }, ad);
  assert.equal(got.length, 2);
  assert.match(got[0].url, /isnew=1/);
  assert.match(got[1].url, /isnew=0/);
  const detail = M.jinanDetail(`<div class="tle">济南管网工程招标公告</div><table><tr><td>项目编号：</td><td>JN-1</td></tr><tr><td>工程地点：</td><td>济南市</td></tr><tr><td>合同估算价：</td><td>1011万元</td></tr><tr><td>招标单位：</td><td>济南热力集团有限公司</td></tr><tr><td>招标代理单位：</td><td>瀚景项目管理有限公司</td></tr><tr><td>招标单位联系人：</td><td>孙经理</td></tr><tr><td>招标单位联系电话：</td><td>0531-86106573</td></tr></table><p>投标文件的提交截止时间：2026年9月10日09时00分</p>`, got[0], "");
  assert.equal(detail.owner, "济南热力集团有限公司");
  assert.equal(detail.agency, "瀚景项目管理有限公司");
  assert.equal(detail.controlPrice, "1011");
  assert.equal(detail.bidOpen, "2026-09-10 09:00");
});

test("武汉列表页内去重并由结构化详情精确映射字段", () => {
  const ad = M.ADAPTERS.wuhan;
  const block = (id, title, type = "招标/资格预审公告") => `<li onclick="window.location='http://ggzyfw.wuhan.gov.cn:80/whggzy/jygkgy/${id}.jhtml'"><p class="name">${title}</p><div><p><span>信息来源：</span><span>市级</span></p><p><span>信息类型：</span><span>${type}</span></p><p><span>发布时间：</span><span>2026-08-18</span></p></div></li>`;
  const got = M.parseWuhanHtml(block("1", "武汉供水管网工程") + block("2", "武汉供水管网工程") + block("3", "武汉供水管网工程延期公告"), ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].cityHint, "武汉市");
  assert.match(got[0].url, /^https:\/\/ggzyfw\.wuhan\.gov\.cn/);
  const detail = M.wuhanDetail(ad, `<input type="hidden" id="bidOpenTime" value="2026-09-10 09:29:00"><table><tr><td>招标登记编号：</td><td>WH-1</td></tr><tr><td>招标项目名称：</td><td>武汉供水管网工程</td></tr><tr><td>招标人（盖章）：</td><td>武汉建设有限公司</td></tr><tr><td>招标代理机构：</td><td>湖北代理有限公司</td></tr><tr><td>工程地点：</td><td>武汉市</td></tr><tr><td>计划工期（日历天）：</td><td>30</td></tr><tr><td>评标办法：</td><td>综合评估法</td></tr><tr><td>本次招标工程投资额(万元)：</td><td>227</td></tr><tr><td>其他要求：</td><td>本次招标不接受联合体投标。</td></tr></table>`, got[0]);
  assert.equal(detail.bidOpen, "2026-09-10 09:29");
  assert.equal(detail.duration, "30日历天");
  assert.equal(detail.controlPrice, "");
  assert.equal(detail.budget, "227");
  assert.equal(detail.owner, "武汉建设有限公司");
  assert.equal(detail.consortium, "不接受");
});

test("烟台只允许官方招标/采购公告栏目，拒绝中标结果和合同", () => {
  const ad = M.ADAPTERS.yantai;
  assert.deepEqual(ad.cats, ["003001003", "003002002"]);
  assert.equal(M.isAllowedSdWrapRecord(ad, { categorynum: "003001003", title: "供热管网工程招标公告" }), true);
  assert.equal(M.isAllowedSdWrapRecord(ad, { categorynum: "003002002", title: "管网设备公开招标公告" }), true);
  assert.equal(M.isAllowedSdWrapRecord(ad, { categorynum: "003001011", title: "管网工程中标结果公告" }), false);
  assert.equal(M.isAllowedSdWrapRecord(ad, { categorynum: "003002006", title: "地下管网项目采购合同" }), false);
});

test("B4 临沂锁定招标公告栏目且合肥平台标题不冒充地区", () => {
  const linyi = M.ADAPTERS.linyi;
  assert.deepEqual(linyi.cats, ["012001001", "012002001"]);
  assert.equal(M.isAllowedSdWrapRecord(linyi, { categorynum: "012001001", title: "地下管网工程招标公告" }), true);
  assert.equal(M.isAllowedSdWrapRecord(linyi, { categorynum: "012002001", title: "设备公开招标公告" }), true);
  assert.equal(M.isAllowedSdWrapRecord(linyi, { categorynum: "012002006", title: "道路排水管网项目合同" }), false);
  assert.equal(M.isAllowedSdWrapRecord(linyi, { categorynum: "012002003", title: "中标结果公告" }), false);
  assert.equal(M.isAllowedSdWrapRecord(linyi, { categorynum: "012001009", title: "排水管网招标计划" }), false);
  assert.equal(linyi.itemAllowed({ title: "污水管网竞争性磋商公告" }), false);
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.hefei, { city: "全国公共资源交易平台（安徽省", title: "合肥市平台项目招标公告" }), "合肥市");
  assert.equal(M.isHefeiCityRecord({ categorynum: "002001001", title: "望江县南部片区城市污水管网及经开区排水管网更新改造项目招标公告" }), false);
  assert.equal(M.isHefeiCityRecord({ categorynum: "002001001", title: "合肥经开区排水管网更新改造项目招标公告" }), true);
  const noQual = M.extractDetail({}, "<p>3.1.1 投标人资质要求：无。3.1.2 投标人业绩要求：自2021年以来具有信息化项目业绩。</p>", { title: "合肥平台项目招标公告", url: "https://example.invalid/hf" }, "");
  assert.equal(noQual.qualification, "不要求");
  assert.equal(M.extractProjectContent("", "项目规模：平邑生活污水管网建设和运行维护项目(一期) 2.4合同预算价：13175.765465万元", "").scale, "平邑生活污水管网建设和运行维护项目(一期)");
  assert.equal(M.extractProjectContent("", "项目规模：平邑县西部老城区供热管网提升及低本工程为平邑县西部老城区供热管网提升及低碳节能系统改造项目（一期），改造供热面积约140万平方米", "").scale, "本工程为平邑县西部老城区供热管网提升及低碳节能系统改造项目（一期），改造供热面积约140万平方米");
});

test("C1 阶段与模板守卫并配置广西官方动态PDF", () => {
  assert.equal(M.classifyErr(new TypeError("fetch failed")), "conn");
  assert.equal(M.isStrictZbTitle("体育公园施工最高投标限价公示"), false);
  assert.equal(M.isStrictZbTitle("安泽县工人文化宫项目招标控制价"), false);
  const bj = M.extractDetail({}, "<p>工期：间，拟派总监理工程师不可以同时担任其他建设工程总监理工程师</p><p>资质要求：履行合同的能力，包括资质</p>", { title: "北京监理招标公告", url: "https://example.invalid/bj" }, "");
  assert.equal(bj.duration, "");
  assert.equal(bj.qualification, "");
  assert.equal(M.extractProjectContent("", "招标范围：2.1项目规模：中阳县综合管网更新改造工程", "").scope, "");
  assert.equal(M.grabQualification("本次招标要求投标人须具备如下资质、，并具有供货能力", ""), "");
  assert.equal(M.cleanQualificationOutput("本次招标要求投标人须具备如下资质、 业绩，并具有供货能力。"), "");
  assert.equal(typeof M.ADAPTERS.guangxi.pdfResolver, "function");
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.shandong, { city: "城区", title: "定陶城区供水管网漏损治理工程招标公告" }), "定陶区");
});

test("遵义只接收 announcement=交易公告，拒绝答疑澄清和更正", () => {
  assert.equal(M.isZunyiTenderRecord({ announcement: "交易公告", docTitle: "管网工程（二次）招标公告" }), true);
  assert.equal(M.isZunyiTenderRecord({ announcement: "变更公告（澄清与答疑）", docTitle: "管网工程答疑澄清文件" }), false);
  assert.equal(M.isZunyiTenderRecord({ announcement: "变更公告（澄清与答疑）", docTitle: "管网工程更正公告" }), false);
  assert.equal(M.isZunyiTenderRecord({ announcement: "中标候选人公示", docTitle: "管网工程中标候选人公示" }), false);
});

test("烟台代理机构优先联系方式落款，不把应急/查询条款当机构名", () => {
  const engineering = M.extractDetail(M.ADAPTERS.yantai,
    "<p>招标代理机构应在1小时内核实并启动应急流程。</p><p>8.联系方式 招标人：烟台市热力有限公司 招标代理：山东阳光正大建设项目管理有限公司 地址：烟台市莱山区</p>",
    { title: "x", url: "https://example.invalid/yt1" }, "");
  assert.equal(engineering.agency, "山东阳光正大建设项目管理有限公司");
  const procurement = M.extractDetail(M.ADAPTERS.yantai,
    "<p>无不良信用信息记录（采购人、采购代理机构负责查询）</p><p>2.采购代理机构信息 名 称：山东万信项目管理有限公司 地 址：烟台市莱山区</p>",
    { title: "x", url: "https://example.invalid/yt2" }, "");
  assert.equal(procurement.agency, "山东万信项目管理有限公司");
});

test("批准文号只取项目审批语境，拒绝平台政策通知编号", () => {
  const falseHit = M.extractDetail(M.ADAPTERS.yantai,
    "<p>根据《关于进一步加快推进工程建设项目远程异地评标相关工作的通知》（烟发改公管[2026]110号），本项目采用远程评标。</p>",
    { title: "x", url: "https://example.invalid/yt3" }, "");
  assert.equal(falseHit.approval, "");
  const trueHit = M.extractDetail(M.ADAPTERS.yantai,
    "<p>本招标项目排水管网工程已由某县发展改革局批复某发改审〔2026〕18号批准建设。</p>",
    { title: "x", url: "https://example.invalid/yt4" }, "");
  assert.equal(trueHit.approval, "某发改审〔2026〕18号");
});

test("业绩要求斜杠表示明确不要求，不跨入下一条款", () => {
  const out = M.extractDetail(M.ADAPTERS.yantai,
    "<p>3.4 业绩要求：/ 3.5 其他要求：无不良行为记录，须提供信用信息报告。</p>",
    { title: "x", url: "https://example.invalid/yt5" }, "");
  assert.equal(out.performance, "不要求");
});

test("烟台许可证型资质和响应文件提交截止时间可进入标标通16列", () => {
  const out = M.extractDetail(M.ADAPTERS.yantai,
    "<p>3.1 资质条件：本次招标要求投标人须具有有效的中华人民共和国特种设备生产许可证，许可子项目须包含锅炉安装B级及以上。</p><p>响应文件提交截止时间：2026年8月17日14点30分</p>",
    { title: "x", url: "https://example.invalid/yt6" }, "");
  assert.match(out.qualification, /特种设备生产许可证/);
  assert.equal(out.bidOpen, "2026-08-17 14:30");
});

test("合肥详情优先 ArticleTite，不让正文答疑 h1 覆盖招标公告标题", () => {
  const html = '<meta name="ArticleTite" content="巢湖市污水管网建设工程设计招标公告"><h1>现对本项目投标人提问回复补充答疑如下：</h1>';
  assert.equal(M.extractNoticeTitle(html, "列表招标公告"), "巢湖市污水管网建设工程设计招标公告");
});

test("合肥城市真实性守卫拒绝平台承载的异地项目", () => {
  assert.equal(M.isHefeiCityRecord({ categorynum: "002001001", title: "新站区淮海大道排口及管网整治工程招标公告" }), true);
  assert.equal(M.isHefeiCityRecord({ categorynum: "002001001", title: "巢湖市污水管网建设工程设计招标公告" }), true);
  assert.equal(M.isHefeiCityRecord({ categorynum: "002001001", title: "铜陵市城区排水管网改造工程招标公告" }), false);
  assert.equal(M.isHefeiCityRecord({ categorynum: "002001003", title: "合肥市管网工程中标结果公告" }), false);
});

test("温州锁主站招标公告栏目并识别无扩展名 PDF 详情", () => {
  const ad = M.ADAPTERS.wenzhou;
  assert.equal(ad.kind, "wenzhou");
  assert.equal(ad.pageId, "1229696276");
  assert.match(ad.referer, /col1229696276/);
  const html = '<li class="cf"><a href="/col/col1229696276/art/2026/art_a.html"><i></i>瑞安市污水管网工程</a><span>2026-08-07</span></li>';
  assert.deepEqual(M.parseWenzhouCmsList(html, ad), [{
    url: "https://ggzyjy-eweb.wenzhou.gov.cn/col/col1229696276/art/2026/art_a.html",
    title: "瑞安市污水管网工程", date: "2026-08-07", cityHint: "瑞安市",
  }]);
  const endpoint = "https://ggzyjy-e.wenzhou.gov.cn:8443/TPFrame/wzdownAttach4WebAction.action?cmd=download&amp;AttachGuid=abc";
  assert.equal(M.findEmbeddedPdfHref(`<a id="pdfshow" data-value="${endpoint}">公告.pdf</a>`), endpoint.replace("&amp;", "&"));
  const detail = M.extractDetail(ad,
    '<p>招标人：温州市自来水有限公司</p>',
    { title: "温州市区供水管网漏损治理工程", url: "https://example.invalid/wz" },
    "8.联系方式 招 标 人：温州市自来水有限公司 联 系 人：董先生 电 话：15888207635 招标代理机构：温州建设集团建筑设计院有限公司 地 址：温州市鹿城区");
  assert.equal(detail.contact, "董先生");
  assert.equal(detail.agency, "温州建设集团建筑设计院有限公司");
});

test("宁波访客 token、招标公告栏目与官方 SPA 详情路由锁定", () => {
  const ad = M.ADAPTERS.ningbo;
  assert.equal(ad.channel, "020105");
  assert.equal(ad.keepPort, true);
  const tok = M.ningboVisitorToken(new Date("2026-08-18T10:46:18.000Z"));
  assert.equal(Buffer.from(Buffer.from(tok, "base64").toString("utf8"), "base64").toString("utf8"), "2026-08-18 18:46:18");
  const got = M.parseNingboList({ list: [{
    channel: "020105", article_ID: 9437011, project_ID: "p1", project_NO: "A3301",
    title: "奉化主城区地下管网改造工程项目招标公告", publish_START_TIME: "2026-07-24 15:20:24", area_SHORT_NAME: "奉化",
  }, { channel: "020106", article_ID: 1, project_ID: "p2", title: "澄清公告", publish_START_TIME: "2026-07-24" }] }, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].cityHint, "奉化区");
  assert.match(got[0].url, /^https:\/\/jyxt\.zwb\.ningbo\.gov\.cn:4011\/website\/announcementDetails\?/);
  assert.equal(M.ningboSegmentControlPrice(
    "Ⅰ标段范围：施工及保修，建安工程造价约10419025元；Ⅱ标段范围：施工及保修，建安工程造价约10944202元。"),
  "Ⅰ标段1041.9025；Ⅱ标段1094.4202");
});

test("嘉兴 JPaas 招标公告栏目与 wb-data-list 模板锁定", () => {
  const ad = M.ADAPTERS.jiaxing;
  assert.equal(ad.pageId, "1229743509");
  assert.equal(ad.clientFilterOnly, true);
  const html = `<li class="wb-data-list"><div class="wb-data-infor"><a href="/col/col1229743509/art/2026/art_demo.html">嘉兴经济技术开发区老旧供水管网改造项目</a></div><span class="wb-data-date">2026-08-10</span></li>`;
  const got = M.parseJiaxingCmsList(html, ad);
  assert.equal(got.length, 1);
  assert.equal(got[0].date, "2026-08-10");
  assert.equal(got[0].title, "嘉兴经济技术开发区老旧供水管网改造项目");
  assert.equal(got[0].cityHint, "嘉兴市");
  assert.equal(got[0].url, "https://jxszwsjb.jiaxing.gov.cn/col/col1229743509/art/2026/art_demo.html");
});

test("参数默认 zb 与标标通16列，并保留已配置阶段", () => {
  const args = M.parseArgs(["-p", "anhui"]);
  assert.equal(args.stage, "zb");
  assert.equal(args.xlsxLayout, "biaobiaotong16");
  assert.equal(M.parseArgs(["-p", "anhui", "--stage", "candidate"]).stage, "candidate");
});

test("公开文档保留阶段选择并明确本 PR 只验收 zb", () => {
  const root = SKILL_ROOT;
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
  assert.equal(M.PROJECT18_HEADER.length, 18);
  assert.equal(M.CSV_HEADER.length, 37); // 2026-08-15 +tenderType（标的量纲标记）
  assert.deepEqual(M.BIAOBIAOTONG_HEADER, ["序号", "项目地点", "开标时间", "项目名称", "资金来源", "工期", "资质要求", "业绩要求", "控制价万元", "保证金万元", "评标办法", "联合体", "满分标准", "链接", "招标文件", "备注"]);
  assert.deepEqual(M.PROJECT18_HEADER, ["序号", "项目地点", "开标时间", "项目名称", "建设规模", "招标范围", "资金来源", "工期", "资质要求", "业绩要求", "控制价万元", "保证金万元", "评标办法", "联合体", "满分标准", "链接", "招标文件", "备注"]);
});

test("project18 固定四个 sheet、映射项目内容且有专用列宽", () => {
  const sheets = M.buildXlsxSheets([{ sheet: "房建市政", city: "珠海市", projectSite: "珠海市香洲区", title: "老旧小区改造", scale: "改造17个小区", scope: "施工图及清单内全部施工", url: "https://example.invalid/1" }], { layout: "project18" });
  assert.deepEqual(sheets.map((s) => s.name), ["房建市政", "水利", "公路", "其他项目"]);
  for (const sheet of sheets) assert.equal(sheet.rows[0].length, 18);
  assert.equal(sheets[0].rows[1][1], "珠海市香洲区");
  assert.equal(sheets[0].rows[1][4], "改造17个小区");
  assert.equal(sheets[0].rows[1][5], "施工图及清单内全部施工");
  assert.equal(M.xlsxColumnWidths(18).length, 18);
  assert.equal(M.xlsxColumnWidths(18)[4], 48);
  assert.equal(M.xlsxColumnWidths(18)[5], 42);
  assert.equal(M.parseArgs(["-p", "广东", "--xlsx-layout", "project18"]).xlsxLayout, "project18");
  assert.equal(M.parseArgs(["-p", "广东"]).xlsxLayout, "biaobiaotong16");
});

test("项目内容按结构化标签分离规模与本次招标范围", () => {
  const combined = `本项目包括17个老旧小区改造，红线面积约131385㎡，整治面积约75064.60㎡，包括道路、给排水和照明整治。具体招标内容包括施工图纸及工程量清单范围内的全部施工；招标人有权对建设内容进行增减，中标人不得有异议。`;
  const html = `<table><tr><th>招标范围及规模</th><td>${combined}</td></tr><tr><th>招标内容</th><td>${combined}</td></tr></table>`;
  const out = M.extractProjectContent(html, M.htmlToText(html), M.flatten(M.htmlToText(html)));
  assert.match(out.scale, /17个老旧小区/);
  assert.match(out.scale, /131385㎡/);
  assert.match(out.scope, /施工图纸及工程量清单/);
  assert.doesNotMatch(out.scope, /中标人不得有异议/);
  assert.equal(out.note, "PROJECT_CONTENT_SPLIT_AT:具体招标内容包括");
});

test("项目内容拒绝法律尾句并保守处理歧义标签", () => {
  const tail = `<table><tr><th>建设规模</th><td>进行增减，中标人不得有异议</td></tr></table>`;
  assert.equal(M.extractProjectContent(tail, M.htmlToText(tail), M.flatten(M.htmlToText(tail))).scale, "");
  const scaleHtml = `<table><tr><th>项目概况</th><td>新建污水管601米、工作井4座，设计规模5万立方米/日。</td></tr></table>`;
  const scaleOut = M.extractProjectContent(scaleHtml, M.htmlToText(scaleHtml), M.flatten(M.htmlToText(scaleHtml)));
  assert.match(scaleOut.scale, /污水管601米/);
  const scopeHtml = `<table><tr><th>建设内容</th><td>本次招标为施工图纸及工程量清单范围内的全部施工。</td></tr></table>`;
  const scopeOut = M.extractProjectContent(scopeHtml, M.htmlToText(scopeHtml), M.flatten(M.htmlToText(scopeHtml)));
  assert.match(scopeOut.scope, /本次招标/);
  const plant = `<table><tr><th>招标范围及规模</th><td>1.工程规模：新建一座设计规模5万m³/d的水质净化厂。2.招标内容：包括施工图设计、BIM及施工配合服务。</td></tr></table>`;
  const plantOut = M.extractProjectContent(plant, M.htmlToText(plant), M.flatten(M.htmlToText(plant)));
  assert.match(plantOut.scale, /5万m³\/d/);
  assert.match(plantOut.scope, /施工图设计/);
});

test("广东 siteCode 定向覆盖地级市与区县，未知词诚实回退全省", () => {
  assert.deepEqual(M.resolveYgpCityTargets({ city: "广州" }).map((x) => x.code), ["440100"]);
  assert.deepEqual(M.resolveYgpCityTargets({ city: "香洲" }).map((x) => x.code), ["440400"]);
  assert.deepEqual(M.resolveYgpCityTargets({ city: "广州,珠海" }).map((x) => x.code), ["440100", "440400"]);
  assert.equal(M.resolveYgpCityTargets({ city: "不存在地区" }).length, 21);
});

test("广东 3C14 列表只留正常招标公告并构造官方详情链接", () => {
  const base = {
    edition: "v3", noticeSecondType: "A", noticeSecondTypeDesc: "工程建设", projectType: "A02", projectTypeName: "市政",
    regionCode: "440400", regionName: "珠海市", siteCode: "440400", siteName: "珠海市", projectCode: "E4404000001006053001",
    tradingProcess: "3C14", noticeNature: "正常公告", publishDate: "20260819143220", pubServicePlat: "珠海市公共资源交易中心一体化平台",
  };
  const rows = [
    { ...base, noticeId: "normal-1", noticeTitle: "隆城花园老旧小区整治工程招标公告" },
    { ...base, noticeId: "change-1", noticeNature: "更正公告", noticeTitle: "某项目补充公告" },
    { ...base, noticeId: "pre-1", noticeTitle: "某项目资格预审公告" },
    { ...base, noticeId: "result-1", tradingProcess: "3C52", noticeTitle: "某项目中标结果" },
  ];
  const got = M.parseYgpListRows(rows, M.ADAPTERS.guangdong);
  assert.equal(got.length, 1);
  assert.equal(got[0].title, "隆城花园老旧小区整治工程招标公告");
  assert.match(got[0].url, /#\/new\/jygg\/v3\/A\?/);
  assert.match(got[0].url, /noticeId=normal-1/);
  assert.equal(M.buildYgpDetailUrl({ ...base, noticeId: "" }), "");
});

test("广东详情解析精确字段并选取正式招标文件", () => {
  assert.equal(M.parseYgpJsonText("2049752546398429185"), "2049752546398429185");
  const row = {
    edition: "v3", noticeSecondType: "A", noticeSecondTypeDesc: "工程建设", projectType: "A02", regionCode: "440400", siteCode: "440400",
    noticeId: "detail-1", projectCode: "E4404000001006053001", tradingProcess: "3C14", noticeTitle: "隆城花园老旧小区整治工程招标公告", projectOwner: "珠海市香洲区吉大街道办事处",
  };
  const richtext = `<table><tr><th>工期（交货期）</th><td>360个日历天</td></tr><tr><th>招标项目实施（交货）地点</th><td>珠海市香洲区</td></tr><tr><th>资金来源</th><td>全部使用财政性资金</td></tr><tr><th>招标范围及规模</th><td>改造17个小区，整治面积75064.60㎡。具体招标内容包括施工图纸及清单范围内全部施工。</td></tr></table>`;
  const data = { title: row.noticeTitle, tradingNoticeColumnModelList: [
    { richtext, noticeFileBOList: null },
    { richtext: "", noticeFileBOList: [
      { fileName: "公告盖章文件.pdf", rowGuid: "notice", flowId: "1" },
      { fileName: "正式招标文件.pdf", rowGuid: "pdf", flowId: "2" },
      { fileName: "正式招标文件.docx", rowGuid: "docx", flowId: "3" },
    ] },
  ] };
  const out = M.parseYgpDetailPayload(data, row, M.ADAPTERS.guangdong, { title: row.noticeTitle, url: M.buildYgpDetailUrl(row) });
  assert.equal(out.projectSite, "珠海市香洲区");
  assert.equal(out.duration, "360个日历天");
  assert.match(out.scale, /75064.60㎡/);
  assert.match(out.scope, /施工图纸及清单/);
  assert.equal(out._ygpAttachment.fileName, "正式招标文件.pdf");
  assert.match(out.docLink, /\/pdf\?2$/);
});

test("广东招标文件补抽区分保证金、现行评标办法与定性满分", () => {
  const zhuhai = M.extractYgpAttachmentFields("投标保证金金额 ■ [500000]元。 本项目采用定性评审项目，评标内容为经济标、技术标。");
  assert.equal(zhuhai.bond, "50");
  assert.equal(zhuhai.evaluation, "定性评审（经济标、技术标）");
  assert.equal(zhuhai.fullScore, "不适用（定性评审）");
  const tancun = M.extractYgpAttachmentFields("本项目不要求投标人递交投标保证金。第三章 评标办法（综合评估法）。投标人总得分满分为100分。");
  assert.equal(tancun.bond, 0);
  assert.equal(tancun.evaluation, "综合评估法");
  assert.equal(tancun.fullScore, "100");
  const kemu = M.extractYgpAttachmentFields("原文：本次评标采用综合评估法。条款号：1 现文：本项目采用评定分离办法，其中评标阶段采用“有限数量制”评标法。投标人总得分（最高100.5分）。");
  assert.equal(kemu.evaluation, "评定分离（有限数量制评标法）");
  assert.equal(kemu.fullScore, "100.5");
});

test("标标通兼容版固定生成 4 个 sheet 和 16 列", () => {
  const sheets = M.buildXlsxSheets([{ sheet: "水利", title: "管网项目", url: "https://example.invalid/1" }], { layout: "biaobiaotong16" });
  assert.deepEqual(sheets.map((s) => s.name), ["房建市政", "水利", "公路", "其他项目"]);
  for (const sheet of sheets) assert.equal(sheet.rows[0].length, 16);
  assert.equal(sheets[1].rows[1].length, 16);
});

test("房建市政分类覆盖学校与老旧街区项目", () => {
  assert.equal(M.classifySheet("徐州市侯集高级中学致远楼抗震加固工程"), "房建市政");
  assert.equal(M.classifySheet("贾汪区老矿片区老旧街区改造提升工程"), "房建市政");
});

test("未勾选的江苏 3.4.1 模板不误报为业绩要求", () => {
  const html = "<p>3.4资格审查可选条件： □3.4.1 □企业 □项目负责人 承担过类似工程；类似工程认定标准：企业或者项目负责人 年 月 日以来承担过类似工程（类似工程设置要求为：1、类似工程业绩的企业或者项目负责人仅可选1项；）</p>";
  const out = M.extractDetail(M.ADAPTERS.xuzhou, html, { title: "某校舍工程", url: "https://example.invalid/xz" }, "");
  assert.equal(out.performance, "不要求");
});

test("XLSX 写入器包含样式、列宽、冻结首行和筛选", () => {
  const file = path.join(os.tmpdir(), `bid-collect-self-test-${process.pid}.xlsx`);
  try {
    M.writeXlsx(file, M.buildXlsxSheets([{ sheet: "其他项目", title: "测试项目", qualification: "长字段".repeat(80), url: "https://example.invalid/1" }], { layout: "biaobiaotong16" }));
    const raw = fs.readFileSync(file).toString("utf8");
    assert.match(raw, /xl\/styles\.xml/);
    assert.match(raw, /state="frozen"/);
    assert.match(raw, /<cols>/);
    assert.match(raw, /<autoFilter /);
    assert.match(raw, /ht="(?:[5-9][0-9]|[1-2][0-9]{2}|300)"/);
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

test("地区硬字段优先精确行政区并诚实回退到 adapter 管辖区", () => {
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.liaoning, { city: "", projectSite: "", title: "新开发银行贷款辽宁省鞍山市南沙河雨污分流工程" }), "鞍山市");
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.beijing, { city: "", projectSite: "", title: "首开集团供热管网改造项目" }), "北京市");
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.shanghai, { city: "奉贤区", projectSite: "", title: "项目" }), "奉贤区");
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.guangxi, { city: "", projectSite: "", title: "广西新柳邕市场给水管网改造" }), "广西壮族自治区");
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
  assert.throws(() => M.resolveOutputPaths({ out: "out/anyang.csv", xlsx: true }), /仅支持 \.xlsx 或 \.md/);
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
  assert.match(report.code_commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof report.code_dirty, "boolean");
  const sourced = M.buildRunReport("shandong", { name: "测试源" }, [{ title: "公告", date: "2026-08-15", url: "https://official.example/1" }], { province: "shandong", days: 30, detail: false });
  assert.equal(sourced.source.base, "https://official.example");
  const failed = M.buildRunReport("guangdong", M.ADAPTERS.guangdong, [], { province: "guangdong", days: 30, detail: false }, { errors: [{ code: "FATAL" }], signals: { rate_limits: [{ status: 429 }] } });
  assert.equal(failed.status, "FAILED");
});

test("run-report v1 追加17字段 field_stats 且来源不污染业务记录", () => {
  const filled = {
    date: "2026-08-20", city: "珠海市", title: "示例招标公告", url: "https://official.example/1",
    scale: "改造面积1000平方米", bond: 0, docLink: "https://official.example/file.pdf",
  };
  M.markFieldSource(filled, "publishDate", "list");
  M.markFieldSource(filled, "region", "list");
  M.markFieldSource(filled, "title", "list");
  M.markFieldSource(filled, "url", "list");
  M.markFieldSource(filled, "scale", "detail");
  M.markFieldSource(filled, "bond", "attachment");
  M.markFieldSource(filled, "docLink", "detail");
  assert.doesNotMatch(JSON.stringify(filled), /_fieldSources/);
  const report = M.buildRunReport("guangdong", M.ADAPTERS.guangdong, [filled, {}], { province: "guangdong", days: 30, detail: true });
  assert.equal(report.schema_version, "bid-collect.run-report.v1");
  assert.deepEqual(M.PROJECT18_AUDIT_FIELDS, ["publishDate", "region", "bidOpen", "title", "scale", "scope", "funding", "duration", "qualification", "performance", "controlPrice", "bond", "evaluation", "consortium", "fullScore", "url", "docLink"]);
  assert.equal(Object.keys(report.field_stats).length, 17);
  assert.deepEqual(report.field_stats.publishDate, { samples: 2, filled: 1, empty: 1, provisional: true, sources: { list: 1, detail: 0, attachment: 0 } });
  assert.deepEqual(report.field_stats.scale, { samples: 2, filled: 1, empty: 1, provisional: true, sources: { list: 0, detail: 1, attachment: 0 } });
  assert.deepEqual(report.field_stats.bond, { samples: 2, filled: 1, empty: 1, provisional: true, sources: { list: 0, detail: 0, attachment: 1 } });
});

test("project18 能力真相源覆盖62×17并锁定干净证据", () => {
  const file = path.join(SKILL_ROOT, "PROJECT18_CAPABILITIES.json");
  assert.ok(fs.existsSync(file));
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const validation = CAP.validateCapabilities(doc);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.adapter_count, 62);
  assert.equal(validation.field_count, 17);
  assert.equal(validation.cells, 1054);
  assert.equal(validation.unverified, 323);
  assert.equal(CAP.projectionMatches(doc), true);
  for (const adapter of ["guangdong", "hunan", "hubei", "guizhou", "yunnan", "neimenggu", "tianjin", "jilin",
    "anhui", "xizang", "gansu", "liaoning", "fujian", "chongqing", "henan",
    "qingdao", "wuhan", "jinan", "ningbo", "zhongshan", "nanjing", "shenzhen",
    "jiangsu", "zhejiang", "hainan", "heilongjiang", "anyang", "changzhou",
    "luoyang", "zhengzhou", "sichuan", "xinjiangbt", "xuzhou", "ningxia",
    "xinjiang", "jiangxi", "qinghai", "yichang", "weifang", "wuxi",
    "hefei", "linyi", "yantai"]) {
    for (const field of doc.audited_fields) assert.notEqual(doc.adapters[adapter].fields[field].status, "FIELD_UNVERIFIED", `${adapter}.${field}`);
  }
  for (const evidence of Object.values(doc.evidence)) assert.equal(evidence.code_dirty, false);
});

test("脏证据不能支撑已验证字段且完整门禁拒绝未验收矩阵", () => {
  const doc = CAP.createInitialCapabilities();
  doc.evidence[doc.adapters.guangdong.fields.title.evidence_id].code_dirty = true;
  const dirty = CAP.validateCapabilities(doc);
  assert.equal(dirty.ok, false);
  assert.ok(dirty.errors.some((error) => /dirty evidence/.test(error)));
  const incomplete = CAP.validateCapabilities(CAP.createInitialCapabilities(), { requireComplete: true });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.errors.some((error) => /FIELD_UNVERIFIED/.test(error)));
});

test("能力 evidence 支持按状态分组更新且拒绝重复字段", () => {
  const doc = CAP.createInitialCapabilities();
  const evidenceId = "fixture:test-grouped";
  const fixture = {
    evidence: { [evidenceId]: { kind: "fixture", path: "reference/evidence/guangdong-project18-gold.json", code_commit: "91877ccf73f0d5b1f10f200c9ee0c216c5ae77d2", code_dirty: false } },
    capability_updates: {
      hunan: { evidence_id: evidenceId, verified_at: "2026-08-21T22:00:00+08:00", statuses: { FIELD_VERIFIED_LIST: ["title", "url"], FIELD_NOT_DISCLOSED: ["fullScore"] } },
    },
  };
  CAP.applyEvidenceUpdates(doc, fixture);
  assert.equal(doc.adapters.hunan.fields.title.status, "FIELD_VERIFIED_LIST");
  assert.equal(doc.adapters.hunan.fields.fullScore.status, "FIELD_NOT_DISCLOSED");
  const duplicated = JSON.parse(JSON.stringify(fixture));
  duplicated.capability_updates.hunan.statuses.FIELD_VERIFIED_DETAIL = ["title"];
  assert.throws(() => CAP.applyEvidenceUpdates(CAP.createInitialCapabilities(), duplicated), /duplicate grouped field/);
});

test("详情标题覆盖列表层截断值", () => {
  assert.equal(M.extractNoticeTitle('<p class="article-title">长江沿线无为市镇区污水管网提升改造项目二标段(姚沟镇)招标公告</p>', "项目..."), "长江沿线无为市镇区污水管网提升改造项目二标段(姚沟镇)招标公告");
  assert.equal(M.extractNoticeTitle('<title>招标公告</title>', "项目..."), "项目...");
});

test("A1 zb 阶段拒绝资审变更终止结果且天津平台名不覆盖项目标题", () => {
  assert.equal(M.isStrictZbTitle("永顺县老城区公共供水管网漏损治理项目招标公告"), true);
  for (const title of [
    "某项目终止公告",
    "某项目更正公示",
    "某项目资审文件公告",
    "某项目中标结果公示",
  ]) assert.equal(M.isStrictZbTitle(title), false, title);
  assert.equal(M.extractNoticeTitle('<h1>全国公共资源交易平台（天津市）</h1>', "天津市某道路工程招标公告"), "天津市某道路工程招标公告");
  assert.equal(M.ADAPTERS.neimenggu.noticeTypeName, "招标公告");
});

test("A1 项目内容精确标签优先、UUID尾噪声清理且明确免保证金写0", () => {
  const project = M.extractProjectContent("", "建设规模：改造DN300-DN1000排水管网12km，最终以施工图为准。 41cfeba6-13f6-417c-8885-00e007f650b0\n项目概况：改造部分支管。\n招标范围：完成施工图设计、采购及施工。", "");
  assert.match(project.scale, /12km/);
  assert.doesNotMatch(project.scale, /41cfeba6/);
  assert.match(project.scope, /完成施工图设计/);
  const adjacentUuid = M.extractProjectContent("", "建设规模：新建排水管14.03km66eedd5e-5fbb-494f-982c-0151b6c248db。", "");
  assert.equal(adjacentUuid.scale, "新建排水管14.03km");
  const hubei = M.extractProjectContent("", "2. 项目概况与招标范围 2.1 项目名称：电缆采购 2.2 项目概况：项目位于产业园，总建筑面积约5.8万㎡，总投资约3亿元，规划年产高白玻璃砂100万吨。 2.4 招标范围：本次采购全厂电力电缆和控制电缆。", "");
  assert.match(hubei.scale, /5\.8万㎡/);
  assert.match(hubei.scope, /本次采购全厂电力电缆/);
  const hubeiExact = M.extractProjectContent("", "2.项目概况与招标范围 2.1标段编号：YAA010079 2.2本标段工程的主要建设内容：对一楼产品推广展览中心进行装饰装修，包含电气、暖通、消防等配套工程。", "");
  assert.match(hubeiExact.scale, /装饰装修/);
  assert.equal(hubeiExact.scope, "");
  const noBond = M.extractDetail({}, "<p>本项目不收取投标保证金。</p>", { title: "示例招标公告", url: "https://example.invalid/a1" }, "");
  assert.equal(noBond.bond, 0);
  const school = M.extractProjectContent("", "项目基本情况：建设学校风雨长廊254米、地面硬化3100平方米。", "");
  assert.match(school.scale, /254米/);
  const badName = M.extractProjectContent("", "项目概况：2.1 招标项目或标段名称：某燃气项目。", "");
  assert.equal(badName.scale, "");
  const cleanScope = M.extractProjectContent("", "招标范围：工程量清单所示全部工程 3．投标人资格要求3.1具备水利资质。", "");
  assert.doesNotMatch(cleanScope.scope, /投标人资格要求/);
  const taxonomy = M.extractProjectContent("", "招标范围：工程-工程施工-市政工程-排水工程;工程-工程施工-市政工程-给水工程。", "");
  assert.equal(taxonomy.scope, "");
});

test("A1 天津精确建设规模与实际招标范围优先且评定分离不冒充评标办法", () => {
  const html = `<h1>全国公共资源交易平台（天津市）</h1>
    <p>建设规模为 97.966公里。</p>
    <p>2、项目概况与招标范围</p><p>2.1 项目概况：改造DN25-DN300庭院管网共计3.69公里。</p>
    <p>2.3 标段划分与招标范围：共分 1 个标段。本次招标标段为：一标段：标段名称：示例（施工） 招标范围: 改造庭院管网、换热站及智慧化设备设施，具体内容详见工程量清单及施工图纸中全部内容。本标段最高投标限价为43479833元。</p>
    <p>本项目采用“评定分离”的方式评审。</p>`;
  const out = M.extractDetail(M.ADAPTERS.tianjin, html, { title: "天津市某道路工程招标公告", url: "https://example.invalid/tj" }, "");
  assert.equal(out.title, "天津市某道路工程招标公告");
  assert.equal(out.scale, "97.966公里");
  assert.match(out.scope, /改造庭院管网/);
  assert.doesNotMatch(out.scope, /^共分\s*1\s*个标段/);
  assert.equal(out.evaluation, "");
  assert.equal(M.grabEvaluation("评标办法： 公告状态：正常"), "");
});

test("A1 贵州附件 GUID 使用官方 preview 路由而非不存在的根路径", () => {
  assert.equal(
    M.guizhouAttachmentUrl(M.ADAPTERS.guizhou, "4bd65f98-0997-4fa2-8d4a-7e7a2635ab02"),
    "http://ztb.guizhou.gov.cn/api/upload/preview/4bd65f98-0997-4fa2-8d4a-7e7a2635ab02",
  );
  assert.equal(M.attachmentStatusFromNote("不支持的附件类型（非 PDF/Word/Zip）"), "ATTACHMENT_UNSUPPORTED");
  assert.equal(M.attachmentStatusFromNote("附件下载需验证码(captcha)网关"), "ATTACHMENT_CAPTCHA_REQUIRED");
  assert.equal(M.attachmentStatusFromNote("附件下载失败:HTTP 404"), "ATTACHMENT_DOWNLOAD_FAILED");
  for (const adapter of ["guizhou", "yunnan", "neimenggu"]) {
    assert.deepEqual(M.ADAPTERS[adapter].attachmentFields, ["controlPrice", "budget", "bond", "scale", "scope", "evaluation", "fullScore"]);
  }
});

test("A2 安徽保证金账户不冒充金额且HTML引号实体正确解码", () => {
  const account = M.extractDetail({}, "<p>13.投标保证金账户 户名：某中心 子账号1：187252403508 开户银行：中国银行</p>", { title: "公告", url: "https://example.invalid/ah" }, "");
  assert.equal(account.bond, "");
  const amount = M.extractDetail({}, "<p>投标保证金金额：3万元</p>", { title: "公告", url: "https://example.invalid/ah2" }, "");
  assert.equal(amount.bond, "3");
  assert.equal(M.htmlToText("杜集&ldquo;五七&rdquo;干校&mdash;修缮"), "杜集“五七”干校—修缮");
});

test("A2 工程概况精确归scale且名称标签不污染scope", () => {
  const out = M.extractProjectContent("", "2.项目概况与招标范围 工程概况：主要对中心城区排水管网雨污分流改造，新建管道总长约126千米。 2.1工程名称：某高速公路项目。", "");
  assert.match(out.scale, /126千米/);
  assert.equal(out.scope, "");
  const heading = M.extractProjectContent("", "招标范围：2.1项目概况", "招标范围：2.1项目概况");
  assert.equal(heading.scope, "");
});

test("A2 福建详情签名响应映射结构化字段和公告正文", () => {
  const meta = { BaseInfo: { NOTICE_NAME: "福建某管网监理招标公告", TENDER_PROJECT_CODE: "E3501", AREANAME: "沙县", BID_OPEN_TIME: "2026-09-04 09:00:00", CONTRACT_RECKON_PRICE: 11.66, TENDERER_NAME: "某建设局", TENDER_AGENCY_NAME: "某代理公司", LIMITE_TIME: "365" } };
  const content = { Contents: "<p>建设规模：改造供水管网12公里。</p><p>招标范围：施工全过程监理服务。</p><p>招标控制价：11.66万元。</p>", Attachment: [{ Url: "/download/file.pdf" }] };
  const out = M.mapFjDetailPayload(meta, content, { title: "列表标题", url: "https://ggzyfw.fujian.gov.cn/#/business/detail" }, M.ADAPTERS.fujian);
  assert.equal(out.title, "福建某管网监理招标公告");
  assert.equal(out.projectCode, "E3501");
  assert.equal(out.bidOpen, "2026-09-04 09:00");
  assert.equal(out.controlPrice, "11.66");
  assert.equal(out.duration, "365日历天");
  assert.match(out.scale, /12公里/);
  assert.match(out.scope, /监理服务/);
  assert.equal(out.docLink, "https://ggzyfw.fujian.gov.cn/download/file.pdf");
});

test("A2 福建金额单位、零工期、业绩空值与包含关系scope均诚实处理", () => {
  const html = [
    "<p>工程建设规模：本项目供电容量3600KVA，建安投资约494万元。</p>",
    "<p>招标范围和内容：本项目供电容量3600KVA，建安投资约494万元。本项目所涉及的正式用电及配套设施，包括但不限于施工安装、系统调试和送电手续。</p>",
    "<p>用于确定类似工程业绩的相关数据：无；</p>",
    "<p>招标控制价：17522440元。</p>",
    "<p>工期要求：总工期为90个日历天。</p>",
  ].join("");
  const meta = { BaseInfo: { PRICE_UNIT: "0", CONTRACT_RECKON_PRICE: 17522440, LIMITE_TIME: "0" } };
  const out = M.mapFjDetailPayload(meta, { Contents: html }, { title: "福建施工公告", url: "https://example.invalid/fj" }, M.ADAPTERS.fujian);
  assert.equal(out.controlPrice, "1752.244");
  assert.equal(out.duration, "90个日历天");
  assert.equal(out.performance, "不要求");
  assert.match(out.scope, /正式用电及配套设施/);

  const pending = M.mapFjDetailPayload(
    { BaseInfo: { PRICE_UNIT: "0", CONTRACT_RECKON_PRICE: 4940000, LIMITE_TIME: "60" } },
    { Contents: "<p>工程建设规模：供电容量3600KVA，建安投资约494万元。</p><p>招标控制价：（招标人最迟应在投标截止时间10日前发布）元。</p>" },
    { title: "控制价待发布公告", url: "https://example.invalid/fj-pending" },
    M.ADAPTERS.fujian,
  );
  assert.equal(pending.controlPrice, "");
});

test("A2 辽宁发布机构不冒充地区、甘肃行政代码转人读地区", () => {
  assert.equal(M.resolveRecordRegion(M.ADAPTERS.liaoning, { city: "公共资源交易部", title: "跨市高速公路项目" }), "辽宁省");
  assert.equal(M.normalizeGsCityName("620101"), "兰州市");
  assert.equal(M.normalizeGsCityName("永登县"), "永登县");
  const detail = M.extractDetail({}, "<p>资金来源：来源于一般债券资金</p><p>工期：为540天</p><p>类似工程业绩：QSJD-1</p>", { title: "测试公告", url: "https://example.invalid/a2" }, "");
  assert.equal(detail.funding, "一般债券资金");
  assert.equal(detail.duration, "540天");
  assert.equal(detail.performance, "");
});

test("A2 河南无复选框的分标段企业业绩提取完整条款", () => {
  const html = "<p>3.3业绩要求：3.3.1企业类似工程业绩：一标段：投标人自2023年1月1日以来已完成单项合同金额1300万元及以上的类似装饰装修工程业绩一项。二标段：投标人已完成单项合同金额1100万元及以上的类似工程业绩一项。</p><p>3.3.2项目经理类似工程业绩：另有要求。</p>";
  const out = M.extractDetail({}, html, { title: "河南装修工程招标公告", url: "https://example.invalid/henan" }, "");
  assert.match(out.performance, /一标段/);
  assert.match(out.performance, /1300万元/);
  assert.match(out.performance, /二标段/);
  assert.doesNotMatch(out.performance, /项目经理类似工程业绩/);
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
  const out3 = M.extractDetail(M.ADAPTERS.mianyang,
    "<p>工期其他：施工图纸及工程量清单范围内所有工程施工</p>",
    { title: "农村公路项目", url: "https://example.invalid/my" }, "");
  assert.equal(out3.duration, "");             // 招标范围不是工期，源页无时间值时留空
  const out4 = M.extractDetail(M.ADAPTERS.mianyang,
    "<p>招标范围及标段划分、计划工期</p><p>☑其他：施工图纸及工程量清单范围内所有工程施工。</p><p>2.2.3 计划工期 施工标段：工期180日历天。</p>",
    { title: "农村公路项目", url: "https://example.invalid/my2" }, "");
  assert.equal(out4.duration, "180日历天");
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
