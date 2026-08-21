# 重庆市采集参考

> adapter：`chongqing` · kind=`cq` · 验证状态：**✅ VERIFIED_RECORD** · 最后验证：2026-08-21（A2 project18 clean evidence）

## 机制

官方入口：[重庆市公共资源交易网](https://www.cqggzy.com)。Nuxt SSR 列表与详情同源 HTML，详情采用浏览器 UA 和有限退避处理偶发 521/5xx。

## A2 project18 结论

管网3条及滨岸公园提升1条均通过干净代码复测。project18 的建设规模与招标范围能分别保留完整官方事实，长段 scope 不再被首句截断。17字段终态为 VL=4、VD=9、ND=1、R=3，无 `FIELD_UNVERIFIED`。本批未披露独立企业业绩；保证金、满分和文件直链按受限收口。

机器证据：`reference/evidence/a2-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p chongqing -k 管网 -d 30 --stage zb --limit 3 --xlsx-layout project18 --attach --csv -o out/chongqing.xlsx
```

只验收 `zb`；出现限流或网关错误时停止扩窗并查看 run-report。
