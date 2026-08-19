# 潍坊市采集参考（城市级 · EpointWebBuilder）

> 数据源 adapter：`weifang` · kind=`weifang` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 天“管网”0 条；扩大到 90 天命中 13 条）

## 机制
官方入口：http://ggzy.weifang.gov.cn:8082/wfggzy/jyxx/007001/trade.html?nowid=007001001 。正式采集调用官方 `/EpointWebBuilder/rest/secaction/getSecInfoListYzm`，锁 `007001001=招标（资格预审）公告`；`pageIndex` 为零基，参数名大小写不能照搬宜昌。

## 验证结论
✅ 90 天“管网”命中寒亭区产业园污水管网、寿光市供水管网等真实公告。接口、详情、标题、日期和地区均来自官方平台；HTTPS 当前不可用，必须保留官方 `http://:8082`。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 潍坊 -k 管网 -d 90 --stage zb --limit 3 --csv --xlsx -o out/weifang.xlsx
```

## 诚实限制
官网 UI 深页会出现验证码；本 adapter 依赖服务端关键词、日期窗口和 1–3 条早停。接口结构异常或验证码阻断应记失败/需浏览器，不能记为空数据。
