# 武汉市采集参考（城市级 · 静态 CMS 查询）

> 数据源 adapter：`wuhan` · kind=`wuhan` · 验证状态：**✅ VERIFIED_RECORD（2026-08-21 A3）**

## 机制

官方栏目：https://ggzyfw.wuhan.gov.cn/whggzy/jygkgy/index.jhtml 。正式列表调用 `/whggzy/queryContent[-N]-jygk.jspx`，锁 `channelId=160`，支持标题、开始和结束日期。页内按日期/来源/标题去重，并通过详情“资格审查方式”排除资格预审记录。

## 验证结论

详情静态表格精确提供招标登记编号、主体、地点、方式、工期、评标办法和 `bidOpenTime`。投资额只进预算，不冒充控制价；招标文件需 CA 时附件留空。

## 2026-08-21 A3 project18 结论

管网3条与道路监理1条均由干净代码复测。17字段终态为 VL=3、VD=8、ND=3、R=3，无 `FIELD_UNVERIFIED`。本批详情未独立披露 scale、funding、controlPrice；保证金、满分和文件直链按交易系统受限收口。机器证据：`reference/evidence/a3-city-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 武汉 -k 管网 -d 30 --stage zb --limit 3 --out out/wuhan.xlsx --csv
```

## 诚实限制

官方栏目名含“招标/资格预审”，但本 adapter 按用户范围只输出资格后审招标公告。

## 2026-08-23 生产详情复测

东湖高新区市政供水管网初步设计公告的“其他要求”是平台已隔离的完整资格区块，现由武汉精确路径保留至最后一条社保要求，不再在300/400字处停止。fixture：`evidence/production-detail-completeness-v1.json`。
