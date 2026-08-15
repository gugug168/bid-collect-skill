# 贡献指南（CONTRIBUTING）

本仓库是 **collect-bid-notices** 技能本体，供多 AI 协作者（Codex / Claude Code / WorkBuddy）与人类共同维护。当前公开目标是 32 个官方平台的招标公告（`zb`）采集、城市入口、标标通 16 列输出和可审计失败状态。

## 1. 仓库结构（关键文件）

| 路径 | 作用 |
|---|---|
| `scripts/province-collect.cjs` | 主采集器，32 省 adapter、招标公告列表/详情和状态 sidecar |
| `scripts/ygp-collect.cjs` | 粤公平（广东省）独立采集器 |
| `reference/ZB_LIVE_STATUS_2026-08-15.md` | 32 省招标公告实时状态快照 |
| `reference/CITY_ENTRY_INDEX.md` | 城市/区县入口口径与已实测样本 |
| `reference/*.md` | 各省适配注记（域名、栏目码、字段映射、坑点） |
| `SKILL.md` | 技能入口说明 |

## 2. 双副本开发纪律（不可跳过）

技能副本（`~/.workbuddy/skills/collect-bid-notices/`）与项目工作副本（`E:/工程项目/_工具脚本/bid-collect/`）是**镜像关系**。改 `province-collect.cjs` 后必须：

```bash
# 1) 语法校验（双副本都要过）
node --check province-collect.cjs

# 2) 同步到对侧副本（改哪边就 cp 到另一边）
cp province-collect.cjs "<对侧路径>/province-collect.cjs"

# 3) 确认两副本字节一致
diff -q province-collect.cjs "<对侧路径>/province-collect.cjs"   # 必须输出 IDENTICAL
```

任何修改都须保证 `node --check` 通过且 `diff -q` 一致，否则视为未完成。

## 3. 如何新增 / 修正一个省的招标公告入口

1. **真机核对，禁止臆造端点。** 只使用政府或官方公共资源交易平台；第三方页面只能帮助发现入口，不能作为最终证据。
2. **按 30→90→365 天测试**：找到 1–3 条真实公告即停止扩大；空结果逐级扩大；接口错误、429、登录墙或解析失败必须落入 sidecar 状态。
3. **硬字段门禁**：每条 `VERIFIED_RECORD` 必须同时有标题、日期和官方详情 URL；缺任一项记 `FAILED`，不得拼造链接。
4. **城市筛选**：优先使用官方返回的地区字段、标题和项目地点客户端匹配；区县只有源页真实出现时才算覆盖，不自行补造代码。
5. **同步更新**：对应 `reference/<adapter>.md`、`CITY_ENTRY_INDEX.md` 和 `ZB_LIVE_STATUS_2026-08-15.md`，并保留 snapshot、来源、数量和失败原因。

## 4. 测试要求（PR 必过）

- [ ] `node --check scripts/province-collect.cjs` 通过
- [ ] 改动省已做 `zb` 端到端烟测，返回真实标题、日期和官方 URL
- [ ] 双副本 `diff -q` IDENTICAL（如你在项目侧也改了）
- [ ] 对应 reference、城市入口和实时状态快照已更新
- [ ] 不引入臆造端点 / 不删诚实不配标注

## 5. Issue / PR 规范

- **Issue**：报告某省招标公告入口、城市筛选、字段噪声或状态误判；请附省名、族别（EPoint/bespoke/HTML/TRS）、复现命令和 sidecar。
- **PR**：
  - 标题：`feat/fix(<省或模块>): <一句话>`。
  - 正文列改动点 + 端到端验证输出片段 + reference/状态快照变更。
  - 单 PR 聚焦一省或一类修复，避免巨型混合提交。
- 合并前需通过本指南 §4 全部检查。

## 6. 当前开放任务（供认领）

- 广东：官方粤公平 429 冷却后重新进行低频招标公告复测。
- 受限/特殊省：依据实时 sidecar 做差异化修复，不把空结果写成失败或成功。
- 持续补充官方城市/区县入口实测样本，未验证范围保持 `UNVERIFIED`。
