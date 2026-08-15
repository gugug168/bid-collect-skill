"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const M = require(path.join(__dirname, "province-collect.cjs"));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test("32 个 adapter 均已注册", () => {
  assert.equal(Object.keys(M.ADAPTERS).length, 32);
});

test("中文省名覆盖全部 32 个 adapter", () => {
  const covered = new Set(Object.values(M.PROV_ALIAS));
  const missing = Object.keys(M.ADAPTERS).filter((key) => !covered.has(key));
  assert.deepEqual(missing, []);
});

test("已配置阶段都有类型和可执行路由", () => {
  const routeKeys = ["cats", "listUrl", "noticeType", "gcjsEndpoint", "jsgcEndpoint", "GGTYPE", "channelId", "unionCondition"];
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

test("XLSX 与 CSV schema 由代码常量锁定", () => {
  assert.equal(M.XLSX_HEADER.length, 29);
  assert.equal(M.CSV_HEADER.length, 36);
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

test("中标人噪声留空，表格第一名可识别", () => {
  const noisy = M.extractWinDetail({}, "<p>中标人：公示-</p>", { url: "https://example.invalid/1" }, "");
  assert.equal(noisy.winner, "");
  const valid = M.extractWinDetail({}, "<p>第1名 测试建设有限公司</p><p>中标价：123.45万元</p>", { url: "https://example.invalid/2" }, "");
  assert.equal(valid.winner, "测试建设有限公司");
  assert.equal(valid.winPrice, "123.45");
});

test("输出清洗不把合法 0 当缺失", () => {
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
