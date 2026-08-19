# 青岛市采集参考（城市级 · ASP.NET MVC SSR）

> 数据源 adapter：`qingdao` · kind=`qingdao` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 天“管网”4 条）

## 机制
官方入口：https://ggzy.qingdao.gov.cn/Tradeinfo-GGGSList/0-0-0 。路径 `0-0-0` 由官方导航明确标作工程建设“招标公告”；使用官网 `ProjectName`、`Time`、`pageIndex` 参数分页。轻量 `PartialZTBNew` 不支持真实分页，只作连通探针，不作为正式全量来源。

## 验证结论
✅ 当前命中新区老旧排水管网提升、西海岸换热站及管网节能、唐岛湾路道路及管网等公告。详情页用标签表格精确覆盖工程造价、招标单位、代理、联系人、项目编码和工程地点，避免通用文本误把条款数字当控制价。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 青岛 -k 管网 -d 30 --stage zb --limit 3 --csv --xlsx -o out/qingdao.xlsx
```

## 诚实限制
站点 `HEAD` 返回 403 但普通 `GET` 正常；健康检查必须用 GET。若翻页验证码真正阻断，应记 `BROWSER_REQUIRED`，不能写成无数据。
