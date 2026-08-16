# 天津市 采集参考

> 数据源 adapter：`tianjin` · kind=`tj` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-15（全量实测矩阵 + 单省复测 + 城市筛选）

## 机制
JEECMS：`POST /content/pageContent` 取详情 HTML 片段。

## 2026-08-14 验证结论
✅ **开箱即用**：bespoke tjDetail，2026-08-14 矩阵实测 10 条管网 18/20 全命中（含 owner/控制价/开标/资质/docLink）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p tianjin -k 管网 --detail -d 120 --csv -o out/tianjin.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 宝坻 --limit 2 --no-detail` 返回 2/2 条记录（天津市宝坻区京津新城管网…项目，标题含筛词）；`--detail` 模式下站点 title（「全国公共资源交易平台（天津市）」）会覆盖列表标题、projectSite 回填 city，城市验证用 `--no-detail` 列表层口径。（2026-08-16 重跑，替代 08-15 滨海旧记录）

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
