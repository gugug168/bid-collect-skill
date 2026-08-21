# 洛阳市采集参考（城市级 · 标准 EPoint）

> 数据源 adapter：`luoyang` · kind=`epoint` · 验证状态：**✅ VERIFIED_RECORD（2026-08-22 B2）**

## 机制

官方入口：http://lyggzyjy.ly.gov.cn/jyxx/transaction.html 。匿名 POST `/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew`，`cnum=001`、`categorynum=003001002`、`sort=webdate desc`。官方 HTTPS 当前证书握手失败，必须保留 HTTP。只采工程建设招标公告，不把政府采购磋商、询价扩入本批口径。

## 验证结论

关键词“管网”实时返回真实公告和静态详情；标题、日期、官方链接、地区硬字段齐。`xiaquname=市辖区` 时先从标题识别汝阳县等区县，再回退洛阳市。未勾选“类似项目业绩要求”的模板按“不要求”处理。

## 2026-08-22 B2 project18 结论

管网2条及医院设计1条通过干净代码复测；scope 不再吞入最高限价和服务期限。17字段终态为 VL=4、VD=10、R=3，无 `FIELD_UNVERIFIED`。保证金、评标办法和满分位于验证码附件。机器证据：`reference/evidence/b2-epoint-project18-20260822.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 洛阳 -k 管网 -d 30 --stage zb --limit 3 --out out/luoyang.xlsx --csv
```

## 诚实限制

只声明 `003001002` 工程招标公告；源页没有的 16 列字段留空。
