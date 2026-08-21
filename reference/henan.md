# 河南省采集参考

> adapter：`henan` · kind=`epoint` · 验证状态：**✅ VERIFIED_RECORD（无关键词样本）** · 最后验证：2026-08-21（A2 project18 clean evidence）

## 机制

官方入口：[河南省公共资源交易平台](https://hnsggzyjy.henan.gov.cn)。EPoint 招标公告详情页可公开回读；招标文件下载通过验证码网关，静态采集不绕过。

## A2 project18 结论

管网关键词30天和90天窗口无记录，365天深页出现 TLS 传输失败；这不等于平台失败。按既定规则执行一次无关键词复扫，取得郑州松苑提升改造真实招标公告并在干净代码上逐字段核对。已修复无复选框的分标段企业业绩只返回标题问题，现保留一、二标段完整金额门槛。

17字段终态为 VL=4、VD=10、R=3，无 `FIELD_UNVERIFIED`。保证金、评标办法和满分位于验证码附件，保持空值并记录 `ATTACHMENT_CAPTCHA_REQUIRED`；不降低公告 `VERIFIED_RECORD` 状态。

机器证据：`reference/evidence/a2-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p henan -d 30 --stage zb --limit 1 --xlsx-layout project18 --attach --csv -o out/henan.xlsx
```

无关键词样本只证明 adapter 字段能力，不得冒充“管网”关键词命中结果。
