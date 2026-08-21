# 福建省采集参考

> adapter：`fujian` · kind=`fj` · 验证状态：**✅ VERIFIED_RECORD** · 最后验证：2026-08-21（A2 project18 clean evidence）

## 机制

官方入口：[福建省公共资源交易电子公共服务平台](https://ggzyfw.fujian.gov.cn)。列表与详情均调用公开 API，按官网 `portal-sign` 签名并解密响应。`fjDetail` 先取 `TradeInfoDetail`，再按公告节点读取 `TradeInfoContent`；业务链接使用官网 `#/business/detail?name=...&cid=...&type=GCJS` 路由。

## A2 project18 结论

管网3条及学校用电工程1条均为 `VERIFIED_RECORD`、`code_dirty=false`。已修复旧 GET 壳页不可用、`PRICE_UNIT=0` 元转万元、`LIMITE_TIME=0` 覆盖真实工期、模板业绩脏值、包含关系导致 scope 丢失，以及“控制价后续发布”被合同估算价污染。17字段终态为 VL=3、VD=11、R=3，无 `FIELD_UNVERIFIED`。

金样复核：安溪项目控制价 `1752.244` 万元、工期90日历天；学校项目控制价因公告明确待发布而留空，不把494万元投资额冒充控制价。详情 API 未给公开文件直链，评标办法、满分和招标文件按受限收口。

机器证据：`reference/evidence/a2-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p fujian -k 管网 -d 30 --stage zb --limit 3 --xlsx-layout project18 --attach --csv -o out/fujian.xlsx
```

只验收 `zb`；结构化字段不能覆盖正文中更精确的明确标签事实。
