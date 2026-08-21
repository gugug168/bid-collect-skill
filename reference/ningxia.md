# 宁夏回族自治区 采集参考

> 数据源 adapter：`ningxia` · kind=`epointX` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-22（B2 project18 clean evidence）

## 机制
EPoint 自定义 `/interface_wz/.../getFullTextDataNew`，pn=offset。

## 2026-08-14 验证结论
✅ **厚字段已打通**：`--detail` 触发后，owner/agency/controlPrice/funding/bidOpen/duration/qualification/consortium/contact/phone/docLink 等稳定抽取（2026-08-14 实测 18/20 列 100% 命中，缺失列即上方"诚实留空"字段，非失败）。 2026-08-14 矩阵实测 10 条管网 18/20 全命中。

## 2026-08-22 B2 project18 结论

管网3条及乡村基础设施1条通过；scope 在 `2.5标段划分` 前截断，资金前缀和规模序号已清理。17字段终态为 VL=4、VD=8、ND=2、R=3，无 `FIELD_UNVERIFIED`。机器证据：`reference/evidence/b2-epoint-project18-20260822.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p ningxia -k 管网 --detail -d 120 --csv -o out/ningxia.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 银川 --limit 2 --detail` 返回 2/2 条记录（银川经开区工业蒸…项目）；city 列为行政区码（640100/640000），筛词经标题列命中。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
