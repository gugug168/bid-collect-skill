# 湖北省 采集参考

> 数据源 adapter：`hubei` · kind=`hb` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-21（A1 project18 clean evidence）

## 机制
bespoke `hbDetail`：`jsgcZbggDetail?guid=` 取结构化详情。

## 2026-08-21 A1 project18 结论
管网与非管网公告均以官方详情回源；明确“不收取投标保证金”写合法值 `0`，“主要建设内容”归入 scale。17字段终态为 VL=4、VD=11、R=2，无 `FIELD_UNVERIFIED`。满分和招标文件仅在交易系统文件中，按受限收口。机器证据见 `reference/evidence/a1-structured-project18-20260821.json`。

## 2026-08-14 验证结论
✅ **厚字段已打通**：`--detail` 触发后，owner/agency/controlPrice/funding/bidOpen/duration/qualification/consortium/contact/phone/docLink 等稳定抽取（2026-08-14 实测 18/20 列 100% 命中，缺失列即上方"诚实留空"字段，非失败）。 2026-08 前期实测：owner/控制价/开标/资质/联合体/docLink 全命中。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p hubei -k 管网 --detail -d 120 --csv -o out/hubei.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
