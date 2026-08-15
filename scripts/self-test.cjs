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

test("32 个 adapter 均已注册", () => {
  assert.equal(Object.keys(M.ADAPTERS).length, 32);
});

test("中文省名覆盖全部 adapter", () => {
  const covered = new Set(Object.values(M.PROV_ALIAS));
  const missing = Object.keys(M.ADAPTERS).filter((key) => !covered.has(key));
  assert.deepEqual(missing, []);
});

test("已配置阶段都有类型和可执行路由", () => {
  const routeKeys = ["cats", "listUrl", "noticeType", "gcjsEndpoint", "jsgcEndpoint", "GGTYPE", "channelId", "unionCondition", "iType", "iTypes", "noticeTypeName", "searchword"]; // TRS 族客户端路由（jilin/nmg/liaoning 2026-08-15 B 阶段）
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
