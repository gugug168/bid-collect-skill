# 贡献指南（CONTRIBUTING）

本仓库是 **collect-bid-notices** 技能本体，供多 AI 协作者（Codex / Claude Code / WorkBuddy）与人类共同维护。目标是把 32 省招投标公告/中标采集器的 B 阶段（中标候选 / 中标结果 / 合同公示）逐步补全、修字段噪声、补新省适配。

## 1. 仓库结构（关键文件）

| 路径 | 作用 |
|---|---|
| `scripts/province-collect.cjs` | 主采集器，32 省 adapter + B 阶段 `stages` 框架 |
| `scripts/ygp-collect.cjs` | 粤公平（广东省）独立采集器 |
| `reference/FAMILY_INDEX.md` | **B 阶段事实总账**（§3.1 行级状态表，PR 必须同步更新） |
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

## 3. 如何新增 / 修正一个省的 B 阶段

1. **真机枚举，禁止臆造端点。** 用浏览器/页面 JS 逆向拿到真实栏目码或接口：
   - EPoint 标准族：搜"中标候选人公示"读返回记录的栏目码反查。
   - bespoke REST 族：挖前端 `app.js` / `*.viewmodel.js` / 真实接口路径。
   - HTML/SSR 族：查列表页 sibling 栏目路径（如 `001002002003`）或 `categoryNum`。
   - TRS 引擎族：查 `channelId` / 检索式隔离。
2. **端到端验证**：`node province-collect.cjs -p <省> --stage <candidate|result|contract> --limit 3 --no-detail --no-xlsx`，确认返回**正确类型**的标题与详情 URL。
3. **写回 `stages`**：在对应 adapter 加
   ```javascript
   stages: {
     candidate: { type: "中标候选人", <省专属参数> },
     result:    { type: "中标结果",   <省专属参数> },
     contract:  { type: "合同公示",   <省专属参数> }, // 源站有才配
   }
   ```
4. **诚实分类**：源站无独立栏目 / 栏目未发布 / 栏目不存在 → **一律不配**该 stage，不要填占位或猜端点。在 `FAMILY_INDEX.md §3.1` 对应行注明原因。
5. **同步更新 `reference/FAMILY_INDEX.md` §3.1** 该行状态（`⏳ 待枚举` → `✅ 已枚举` 或 `⚠️ 诚实不配`）。

## 4. 测试要求（PR 必过）

- [ ] `node --check scripts/province-collect.cjs` 通过
- [ ] 改动省已做 `--stage` 端到端烟测，返回正确类型标题
- [ ] 双副本 `diff -q` IDENTICAL（如你在项目侧也改了）
- [ ] `FAMILY_INDEX.md §3.1` 对应行已更新
- [ ] 不引入臆造端点 / 不删诚实不配标注

## 5. Issue / PR 规范

- **Issue**：报某省 B 阶段栏目码缺失、字段噪声、新省适配需求；请附省名、族别（EPoint/bespoke/HTML/TRS）、复现命令。
- **PR**：
  - 标题：`feat/fix(<省或模块>): <一句话>`（如 `feat(yunnan): 补 contract 阶段 getContractList`）。
  - 正文列改动点 + 端到端验证输出片段 + `FAMILY_INDEX` 变更。
  - 单 PR 聚焦一省或一类修复，避免巨型混合提交。
- 合并前需通过本指南 §4 全部检查。

## 6. 当前开放任务（供认领）

- 上海：列表 JS/AJAX 渲染（`res[i].PROJECT_NAME` 模板），需逆向其列表接口后配 B 阶段。
- TRS 引擎族：jilin / liaoning / neimenggu 的 B 阶段 channelId 枚举。
- 受限/特殊省 best-effort + 26 省 md 注记 + 总表刷新。
