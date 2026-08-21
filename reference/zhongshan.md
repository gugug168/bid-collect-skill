# 中山市采集参考（城市级 · pageList API）

> 数据源 adapter：`zhongshan` · kind=`zhongshan` · 验证状态：**✅ VERIFIED_RECORD（2026-08-21 A3）**

## 机制

官方入口：https://www.zsjypt.cn/subItem/58 。POST `/pageList`，`nodeId=58`、`offset` 1-based、`limit`、`gjz`；`arab37=1` 为补充公告，必须排除。详情 URL 为 `/artical/58/{arab01}`。

## 验证结论

地区硬字段固定为中山市，镇街继续保留在标题/项目地点。控制价公式取最终带单位结果，不能误取公式基数或设计费。招标文件下载需要验证码，附件链接留空并写 sidecar 提示，公告本身仍可静态验证。

## 2026-08-21 A3 project18 结论

管网30/90天为空、365天命中3条；另取水生态勘察设计1条。已改为从“投标资格能力要求”整格获取多专业资质。17字段终态为 VL=4、VD=8、ND=1、R=4，无 `FIELD_UNVERIFIED`。企业业绩本批未披露；保证金、评标办法、满分和文件直链因验证码受限。机器证据：`reference/evidence/a3-city-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 中山 -k 管网 -d 365 --stage zb --limit 3 --out out/zhongshan.xlsx --csv
```

## 诚实限制

“管网”30/90 天为空，按分层规则扩大到 365 天；不把空窗口当失败。
