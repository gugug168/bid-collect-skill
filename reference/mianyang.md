# 绵阳市采集参考（城市级 · 静态列表+关系接口）

## 2026-08-22 C2 project18

管网3条、非管网1条通过；未勾选业绩模板留空，勾选设计业绩完整保留。附件验证码不绕过。证据见 `evidence/c2-cityhtml-project18-20260822.json`。

> 数据源 adapter：`mianyang` · kind=`mianyang` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18）**

## 机制

官方入口：https://ggzy.my.gov.cn/myggzy/jsgc/001001/moreinfojyxx.html 。列表为静态分页；`projectInfo.html` 是壳页，必须调用公开 `/EpointWebBuilder/getinfobyrelationguidaction.action?cmd=getInfolistNew&infoid=...`，从二次 JSON 中精确选择同 `infoid` 且 `categorynum=001001` 的关系，再拼接 `/myggzy + urlpath`。

## 验证结论

关系数组可能同时含补遗、开标、候选、结果和合同，当前实现只取招标公告。真实详情为完整 HTML，可提取地点、开标、资金、工期、资质、联合体、招标人和代理机构。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 绵阳 -k 公路 -d 30 --stage zb --limit 3 --out out/mianyang.xlsx --csv
```

## 诚实限制

关系缺失记解析失败，不静默写成空窗口。招标文件附件下载需要验证码，静态采集不绕过；正文厚字段不受影响，附件链接留空并写 sidecar 备注。

## 2026-08-23 生产试运行02

勘察设计施工总承包模板按 `2.1招标范围 → 2.2标段划分` 和 `2.4建设内容及规模 → 2.5计划工期` 完整提取。源文同时勾选“设计业绩要求/无业绩要求”时performance留空，并写 `signals.field_conflicts[]`，不替平台猜答案。fixture：`evidence/production02-gap32-c-v1.json`。
