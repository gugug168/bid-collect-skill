<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="bid-collect-skill：跨省公开招投标信息采集，保留来源与阶段边界。">
</p>

面向公共资源交易平台的可审计采集技能。它区分代码适配、当前可达与本次验证，不把缺失或受限伪装成成功。

## 一眼看懂

| 价值 | 真实证据 |
| --- | --- |
| 跨省公开招投标信息采集，保留来源与阶段边界。 | 32 个平台适配 · A / B 阶段 · 官方详情链接 |

## 从这里开始

```text
node scripts/self-test.cjs
```

## 完整说明

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
- 提交前请确保双副本一致且 `node --check` 通过。

## 代理

部分省 HTTPS TLS 失败需改 HTTP 兜底；联网采集经 `HTTPS_PROXY=http://127.0.0.1:7897`（本地代理，非仓库内容）。
