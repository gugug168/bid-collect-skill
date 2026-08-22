# 合肥市采集参考（城市级 · webBuilder Service）

> 数据源 adapter：`hefei` · kind=`hefei` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-22（B4 project18 实时复测）

## 机制
官方入口：https://ggzy.hefei.gov.cn/jyxx/002001/engineer2.html 。官方 `engineer2.js` 调用 `/EpointWebBuilderService/hfggzyGetGgInfo.action?cmd=getinfojyxxlistZfcg`；锁 `002001001=招标公告`，服务端按标题关键词分页。详情 URL 由官方分类、发布日期和 `infoid` 组成。

合肥中心同时承载少量省级集团异地项目，因此 adapter 还会校验标题中的合肥行政区实体；铜陵、芜湖、广德等异地项目即使由该站发布，也不会冒充合肥记录。

## 验证结论
✅ 2026-08-18 实测：30 天“管网”2 条，分别为新站区排口及管网整治工程、巢湖市污水处理及配套管网工程。两条标题、日期、官方链接、地区完整；开标时间、资金、工期、资质、业绩、控制价、评标办法、联合体等标标通字段来自官方详情页。机器证据：`hefei-sol-30d-v2/hefei.run-report.json`（以最终复采目录为准）。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 合肥 -k 管网 -d 30 --limit 3 --csv --xlsx -o out/hefei.xlsx
```

## 诚实留空字段（源页无则空，绝不伪造）
源页未披露的保证金、满分标准等字段保持空白；当前只验收 `zb` 招标公告。

## 2026-08-22 project18 复测

30天“管网”命中2条并核对1条智能网联非管网公告。辖区守卫已删除“经开区/高新区”这类全国重名弱证据，望江县项目不再冒充合肥；平台抬头不再写入地区。三条详情与可解析PDF未披露保证金及评分总分，以未披露终态收口。字段证据见 `evidence/b4-epoint-project18-20260822.json`。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
