# 海南省 采集参考

> 数据源 adapter：`hainan` · kind=`epoint` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-22（B1 project18 clean evidence）

## 机制
EPoint 标准；地区字段择优（xiaquname 才是行政区，zhuanzai 是发布平台名须跳过）。

## 2026-08-14 验证结论
✅ **厚字段已打通**：`--detail` 触发后，owner/agency/controlPrice/funding/bidOpen/duration/qualification/consortium/contact/phone/docLink 等稳定抽取（2026-08-14 实测 18/20 列 100% 命中，缺失列即上方"诚实留空"字段，非失败）。 2026-08-14 矩阵实测 20 条管网 18/20 全命中。

## 2026-08-22 B1 project18 结论

管网3条及河道疏浚1条均通过；验证码附件与公告状态分离。17字段终态为 VL=3、VD=12、ND=1、R=1，无 `FIELD_UNVERIFIED`。本批未披露独立企业业绩，满分细则因验证码文件受限。机器证据：`reference/evidence/b1-epoint-project18-20260822.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p hainan -k 管网 --detail -d 120 --csv -o out/hainan.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 定安 --limit 2 --detail` 返回 2/2 条 `定安县` 记录；命中记录的 city 列直接含筛词。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

已配置并验证：候选 `003001005`、结果 `003001006`、合同 `003002005`。

2026-08-15 真实候选人 smoke test（近 30 天，`--limit 3 --detail`）：严格返回 3 条；项目编号/第一中标候选人/投标报价/工期/得分/排名/项目负责人/招标人均 3/3 有效。候选人历史业绩中的合同金额不再写入当前 `contractAmount`。

```bash
node scripts/province-collect.cjs -p hainan --stage candidate -d 30 --limit 3 --detail --csv --out out/hainan-candidate.xlsx
```

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
