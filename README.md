# bid-collect-skill（招投标公告 / 中标采集技能）

WorkBuddy 技能：跨省公共资源交易平台招投标数据采集器。覆盖 **32 个省/市级交易平台**，按「家族」逆向适配，采集招标公告及其中标候选 / 中标结果 / 合同公示（B 阶段）三类扩展信息。

## 能力现状（2026-08-15）

- **A 阶段（招标公告）**：27 省厚字段已打通可重复采集（owner / 控制价 / 开标 / 资质 / 中标人等 18–20 项），5 省受限（山东/河南/广西/广东/陕西，环境或鉴权限制）。
- **B 阶段（中标候选 / 结果 / 合同）**：已完成多族枚举，详见 [`reference/FAMILY_INDEX.md`](reference/FAMILY_INDEX.md) §3 / §3.1。

### B 阶段已落地家族（截至本提交）

| 家族 | 已验证省份 | 阶段覆盖 |
|---|---|---|
| EPoint 标准 | 江苏/浙江/海南/四川/新疆兵团 | candidate/result(+合同) |
| EPoint 自定义 | 宁夏/青海/新疆/江西 | candidate/result(+合同) |
| bespoke REST | 贵州/云南/天津（result:湖北；诚实不配:湖南/湖北候选+合同/贵州·福建合同） | 见 FAMILY_INDEX §3.1 |
| HTML SSR | 河北/重庆（candidate+result） | 上海因 JS 渲染 SPA 诚实 defer |

> **诚实纪律**：源站无独立栏目 / 栏目未发布 / 栏目不存在 → 一律不配对应 stage，绝不臆造端点。

## 架构

- `scripts/province-collect.cjs` —— 主采集器（CLI：`node province-collect.cjs -p <adapter> [--stage candidate|result|contract] -k 管网 --detail -d 120 --csv`）。
- `scripts/ygp-collect.cjs` —— 广东粤公平（ygp）独立 API 采集器。
- `scripts/domains-31.csv` —— 31 省交易平台权威域名清单。
- `reference/FAMILY_INDEX.md` —— 家族索引与 32 省逐省状态总账（B 阶段事实来源）。
- `reference/*.md` —— 各省适配注记（前端 JS 逆向结论、栏目码、坑）。
- `SKILL.md` —— 技能使用说明与调度协议。

## 标标通兼容输出

```bash
node scripts/province-collect.cjs -p anhui -d 30 --limit 20 --detail \
  --xlsx-layout biaobiaotong16 --out out/anhui.xlsx
```

`biaobiaotong16` 固定生成 `房建市政 / 水利 / 公路 / 其他项目` 4 个 sheet，并严格使用参考工作簿的 16 列顺序；工作簿内置表头样式、列宽、自动换行、首行冻结和筛选。中标候选人等 B 阶段的扩展字段请使用默认 `full29` 或 CSV，避免为了兼容 16 列而丢失中标人、得分、排名等信息。

## 城市/区县筛选

```bash
node scripts/province-collect.cjs -p hainan -c "海口,文昌" -k 管网 -d 30 --detail --out out/hainan-city.xlsx
```

`-c, --city` 支持城市或区县简称、全称及逗号 OR。由于各省服务端的行政区字段不统一，采集器在客户端对平台地区、标题和提取地点做匹配；留空或传入 `全省` 表示不过滤。

## 提交前验证

```bash
node --check scripts/province-collect.cjs
node scripts/self-test.cjs
```

GitHub Actions 会对每个 PR 自动运行以上离线回归；真实站点 smoke test 仍需本地执行并在 PR 中记录采样时间和条数。

## 本地开发双副本纪律

技能副本（`~/.workbuddy/skills/collect-bid-notices/`）与项目工作副本（`E:/工程项目/_工具脚本/bid-collect/`）**必须保持一致**：

```bash
# 编辑后同步 + 校验
cp province-collect.cjs <skill>/scripts/province-collect.cjs
node --check province-collect.cjs && node --check <skill>/scripts/province-collect.cjs
diff -q province-collect.cjs <skill>/scripts/province-collect.cjs   # 须 IDENTICAL
```

## 协作（Codex / Claude Code）

本仓库用于多 AI 协作完善：
- **Issue**：报告某省 B 阶段栏目码缺失 / 字段抽取噪声 / 新省适配需求。
- **PR**：新增省份 `stages` 配置、修复 `list`/`parse` 函数、补充 `reference/*.md` 注记。
- 提交前请确保双副本一致，且语法检查与 `scripts/self-test.cjs` 全部通过。

## 代理

部分省 HTTPS TLS 失败需改 HTTP 兜底；联网采集经 `HTTPS_PROXY=http://127.0.0.1:7897`（本地代理，非仓库内容）。
