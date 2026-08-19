# 秦皇岛市采集参考（城市级 · 静态 HTML）

> 数据源 adapter：`qinhuangdao` · kind=`qinhuangdao` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18）**

## 机制

官方入口：https://www.qhdggzy.cn/qhdggzy/jydt/001003/001003001/moreinfo.html 。第 1 页为 `moreinfo.html`，第 2–6 页为 `N.html`，列表和详情均为静态 HTML。栏目名为“招标/资审公告”，严格排除资格预审、资审、变更、澄清、答疑、中标、结果和合同。

## 验证结论

近期真实招标公告的标题、日期、链接、地区齐全；详情可提取地点、开标、资金、工期、控制价、资质、联合体、招标人和代理机构。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 秦皇岛 -k 管道 -d 30 --stage zb --limit 3 --out out/qinhuangdao.xlsx --csv
```

## 诚实限制

静态第 7 页跳到 2021 旧档，完整深翻需要验证码。运行确需翻过第 6 页时记录 `BROWSER_REQUIRED`，不能把分页断层写成“无公告”。
