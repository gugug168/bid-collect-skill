# 西藏自治区采集参考

> adapter：`xizang` · kind=`xz` · 验证状态：**✅ VERIFIED_RECORD** · 最后验证：2026-08-21（A2 project18 clean evidence）

## 机制

官方入口：[西藏自治区公共资源交易网](https://ggzy.xizang.gov.cn)。Jeecms 公告列表；详情由 `xizangDetail` 先从官方壳页取得真实 `projectCode`，再调用 `personalitySearch/initDetailbyProjectCode`。

## A2 project18 结论

管网3条及水塘改造1条均通过干净代码实时复测。建设规模、招标范围、资金、工期、资质、控制价与联合体按详情证据抽取；“来源于一般债券资金”已规范为事实值。17字段终态为 VL=4、VD=8、ND=1、R=4，无 `FIELD_UNVERIFIED`。本批公告未披露企业业绩；保证金、评标办法、满分和文件直链按受限收口。

机器证据：`reference/evidence/a2-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p xizang -k 管网 -d 30 --stage zb --limit 3 --xlsx-layout project18 --attach --csv -o out/xizang.xlsx
```

只验收 `zb` 招标公告；不根据空值推断源站不存在该事实。
