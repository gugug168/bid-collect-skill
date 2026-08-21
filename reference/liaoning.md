# 辽宁省采集参考

> adapter：`liaoning` · kind=`ln` · 验证状态：**✅ VERIFIED_RECORD** · 最后验证：2026-08-21（A2 project18 clean evidence）

## 机制

官方入口：[辽宁省公共资源交易网](https://ggzy.ln.gov.cn)。TRS `was5/web/search` 列表锁定工程建设招标公告，详情走官方 HTML。`perpage` 必须不高于20；发布机构名不得冒充项目地区。

## A2 project18 结论

雨污分流工程及跨市高速机电监理各1条通过干净代码复测。已修复 `公共资源交易部` 污染地区、`2.1项目概况` 污染招标范围、代码式条目污染业绩和“为540天”前缀。17字段终态为 VL=3、VD=8、ND=3、R=3，无 `FIELD_UNVERIFIED`。本批没有可独立确认的 scope、performance、controlPrice；保证金、满分和文件直链按受限收口。

机器证据：`reference/evidence/a2-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p liaoning -k 管网 -d 30 --stage zb --limit 3 --xlsx-layout project18 --attach --csv -o out/liaoning.xlsx
```

只验收 `zb`；空字段与解析失败必须分开记录。
