# 安徽省采集参考

> adapter：`anhui` · kind=`ah` · 验证状态：**✅ VERIFIED_RECORD** · 最后验证：2026-08-21（A2 project18 clean evidence）

## 机制

官方入口：[安徽省公共资源交易监管网](https://ggzy.ah.gov.cn)。列表锁定工程建设正常招标公告；详情由 `anhuiDetail` POST `/jsgc/newDetailSub` 获取官方分块 HTML。`--attach` 只在官方公开文件可达时补缺，当前样本均无公开文件直链。

## A2 project18 结论

管网3条及文物修缮1条均为 `VERIFIED_RECORD`、`code_dirty=false`。已修复保证金账户子账号冒充金额、HTML 引号实体及工程概况归类问题。17字段终态为 VL=3、VD=12、R=2，无 `FIELD_UNVERIFIED`；评分总分和招标文件因无公开直链按受限收口。

机器证据：`reference/evidence/a2-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p anhui -k 管网 -d 30 --stage zb --limit 3 --xlsx-layout project18 --attach --csv -o out/anhui.xlsx
```

只验收 `zb` 招标公告；源页未披露或文件受限时保持空值并查看 run-report。
