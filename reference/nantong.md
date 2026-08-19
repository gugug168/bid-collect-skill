# 南通市采集参考（城市级 · EWB-FRONT）

> 数据源 adapter：`nantong` · kind=`nantong` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18）**

## 机制

官方入口：https://ggzyjy.nantong.gov.cn/jyxx/003001/003001001/tradeInfo.html 。POST `/EWB-FRONT/rest/infolist/getJyInfoList`，表单字段为 `params=<JSON>`；关键参数 `categorymum=003001001`（官方拼写）、`pageIndex` 零基、`pageSize=15`。官方 `searchTitle` 中文检索会假空，因此固定空值后客户端过滤。

## 验证结论

严格锁 `GGTYPE=招标公告`、`categoryname=招标公告/资审公告`、`JYLX=建设工程`，剔除 `[已作废]` 并清理 `[新]`。真实详情可提取地点、开标、资金、工期、资质、业绩、控制价、评标办法、联合体和招标文件链接。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 南通 -k 管网 -d 30 --stage zb --limit 3 --out out/nantong.xlsx --csv
```

## 诚实限制

源页未公开保证金金额或满分时保持空白；不得因栏目码正确而保留作废记录。
