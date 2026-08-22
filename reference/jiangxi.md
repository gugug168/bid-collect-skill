# 江西省 采集参考

> 数据源 adapter：`jiangxi` · kind=`epointX` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-22（B3 project18 实时复测）

## 机制
EPoint 自定义 `/XZinterface/.../getFullTextDataNew`，`noWd:true` 拉全量后客户端过滤。

## 2026-08-14 验证结论
✅ **厚字段已打通**：`--detail` 触发后，owner/agency/controlPrice/funding/bidOpen/duration/qualification/consortium/contact/phone/docLink 等稳定抽取（2026-08-14 实测 18/20 列 100% 命中，缺失列即上方"诚实留空"字段，非失败）。 政府采购口径数据质量，已用采购人词表增强（OWNER_LABELS 补"采购人名称/采购单位"）覆盖。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p jiangxi -k 管网 --detail -d 120 --csv -o out/jiangxi.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 信丰 --limit 2 --detail` 返回 2/2 条 `信丰县` 记录（[信丰县]江西日成…项目）；city 列与标题【】双源含筛词。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 2026-08-22 project18 复测

30天“管网”命中3条，另核对1条非管网招标公告；竞争性谈判等非招标采购已由阶段守卫剔除。招标文件下载验证码不绕过，保证金与满分以受限终态记录。字段证据见 `evidence/b3-epointx-project18-20260822.json`。

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
