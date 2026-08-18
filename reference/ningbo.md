# 宁波市采集参考（城市级 · websiteapi SPA）

> 数据源 adapter：`ningbo` · kind=`ningbo` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 天“管网”2 条，已满足 1–3 条停止条件；Sol 实测）

## 机制
官方入口：https://jyxt.zwb.ningbo.gov.cn:4011/website/home 。前端以北京时间 `YYYY-MM-DD H:mm:ss` 连续 Base64 两次生成匿名访客 token；adapter 显式按 UTC+8 生成，默认零配置。列表调用 `/websiteapi/articleList`，栏目锁定官方 `getCmsType` 返回的 `020105=招标公告`；详情调用 `/websiteapi/getArticle/`，公开链接使用 `/website/announcementDetails` 并保留官方 `:4011` 端口。

官方详情 `content` 含旧模板 HTML 注释，解析前必须删除注释，避免未选中的联合体、资质和开标块污染结果。附件优先选择“招标文件”，其次“招标公告”，不误选公平竞争审查表。

## 验证结论
✅ 2026-08-18 实测：近 30 天“管网”取得 2 条真实招标公告，分别来自奉化区和高新区。2/2 标题、发布日期、官方详情链接、地区四个硬字段齐全；源页可提取开标时间、资金来源、工期、市政资质、控制价、联合体、招标人、代理机构、联系人和招标文件。第二条含两个标段，控制价按标段合并保留；源页未披露的业绩、保证金、评标办法、满分标准保持空白。

机器证据：`ningbo-sol-30d-v2/ningbo.run-report.json`（以最终复采目录为准）。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 宁波 -k 管网 -d 30 --limit 3 --csv --xlsx -o out/ningbo.xlsx
```

## 诚实留空与限制
仅采 `zb` 招标公告，不把 `020106` 澄清/变更、`020110` 中标候选人或 `020111` 中标结果混入。匿名 token 是官网公开前端协议，不需要账号；若官方改变 token 或接口契约，应返回 `FAILED`，不得静默报空。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
