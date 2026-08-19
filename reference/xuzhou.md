# 徐州市采集参考（城市级 · EPoint new API）

> 数据源 adapter：`xuzhou` · kind=`epointX` · 验证状态：**✅ 已打通（2026-08-18 API + 详情 + 16 列 E2E）**
> 最后验证：2026-08-18（关键词“管网”，30→90 天分层验收）

## 机制

城市级独立官方平台：徐州市公共资源交易网 https://ggzy.zwb.xz.gov.cn 。建设工程 `003001001` 首页是静态 SSR，但官方 `list.js` 的当前分页和关键词检索实际通过 `/inteligentsearchnew/rest/esinteligentsearch/getFullTextDataNew` POST 加载；静态 `2.html` 会直接跳到 2025-07，不能作为连续分页。adapter 因此走官方 EPoint new API，锁定 `categorynum=003001001`，再进入 `/jyxx/003001/003001001/<日期>/<uuid>.html` 详情页。

## 验证结论

- 2026-08-18 固定 API 请求 `wd=管网`：HTTP 200，`totalcount=370`，首批返回 12 条，字段含 `title/webdate/linkurl/categorynum`。
- 分层实测：30 天 0 条；扩大到 90 天命中 3 条真实招标公告，按规则停止，不再扩大到 365 天。
- 3 条均通过标题、日期、官方链接、地区硬字段；16 列业务表每条填出 14 列，保证金和备注因源页未载保持空白。
- 回源修正：第一条“工程合同估算价（万元）606.22”正确写入控制价口径；评标公式中的“专业工程暂估价 87200 元”不得误抓为 8.72 万元。
- 当前只声明 `zb`；不依据相邻栏目名称推断其他阶段已经支持。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 徐州 -k 管网 -d 90 --limit 3 --out output/xuzhou.xlsx --csv
```

## 诚实限制

- 官方 API 支持关键词与连续分页；不得回退到静态 `N.html` 伪连续分页。
- 区县优先从标题识别；标题不含更细行政区时，地区只回退为官方 adapter 管辖的“徐州市”。
- 源页不存在的 16 列详情字段保持空白，不补造。

## 家族与通用纪律

同类城市入口见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)，字段纪律见 [`FAMILY_INDEX.md`](FAMILY_INDEX.md)。
