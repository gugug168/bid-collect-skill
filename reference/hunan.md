# 湖南省 采集参考

> 数据源 adapter：`hunan` · kind=`hn` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-21（A1 project18 clean evidence）

## 机制
bespoke `hnDetail`：tradeApi 交易 API + 结构化详情接口（标杆实现）。

## 2026-08-21 A1 project18 结论
管网3条+学校项目1条均为 `VERIFIED_RECORD`、`code_dirty=false`。阶段守卫剔除终止/资审/结果；17字段终态为 VL=3、VD=11、R=3，无 `FIELD_UNVERIFIED`。保证金金额、满分和文件直链需交易系统，按 `FIELD_RESTRICTED` 收口。机器证据见 `reference/evidence/a1-structured-project18-20260821.json`。

## 2026-08-14 验证结论
历史基线：结构化详情可稳定提供项目内容、资金、工期、资质、业绩、控制价、评标办法和联合体；文件直链并非公开字段，以 A1 能力矩阵为准。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p hunan -k 管网 --detail -d 120 --csv -o out/hunan.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
