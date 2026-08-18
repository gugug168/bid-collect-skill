# 嘉兴市采集参考（城市级 · JPaas CMS）

> 数据源 adapter：`jiaxing` · kind=`jiaxing` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 天“管网”1 条，已满足 1–3 条停止条件；Sol 实测）

## 机制
官方建设工程招标公告入口：https://jxszwsjb.jiaxing.gov.cn/col/col1229743509/index.html 。页面 meta 明确 `ColumnName=招标公告`，`AuthorizedRead/unitbuild.js` 匿名调用 `/api-gateway/jpaas-publish-server/front/page/build/unit`，参数为 `webId=3856`、`tplSetId=qs3Pt5ZSPt8UZss6yAknP`、`tagId=信息list`、`pageId=1229743509`。

嘉兴与温州同属 JPaas，但列表项为 `li.wb-data-list`，不能复用只认 `li.cf` 的温州解析器。详情页直接提供完整 HTML 公告正文，并在 `Attachment-download` 中提供官方“招标公告.pdf”。

## 验证结论
✅ 2026-08-18 实测：近 30 天“管网”取得 1 条《嘉兴经济技术开发区老旧供水管网及二次供水设施改造项目设计采购施工总承包（EPC）》。标题、发布日期、官方详情链接、地区四个硬字段齐全；源页可提取 2026-09-09 14:30 开标、财政统筹资金、36 个月工期、设计及施工资质、不要求业绩、控制价 9598.3458 万元、评定分离、接受联合体、招标人、代理机构、联系人和官方公告 PDF。源页未披露的保证金、满分标准保持空白。

首次实采把“位于嘉兴经济技术开发区内”整句写入地区列；现由城市级 adapter 列表明确回退为“嘉兴市”，避免详情地点句污染硬字段。

机器证据：`jiaxing-sol-30d-v2/jiaxing.run-report.json`（以最终复采目录为准）。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 嘉兴 -k 管网 -d 30 --limit 3 --csv --xlsx -o out/jiaxing.xlsx
```

## 诚实留空与限制
仅采 `zb` 招标公告。列表接口无已验证的服务端关键词 schema，按发布日期分页后客户端过滤；无标题行政区时只回退到官方 adapter 的明确管辖区“嘉兴市”，不臆造经开区为法定区县。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
