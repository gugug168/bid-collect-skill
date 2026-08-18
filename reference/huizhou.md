# 惠州市采集参考（城市级 · 广东政府 JSONP）

> 数据源 adapter：`huizhou` · kind=`huizhou` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18）**

## 机制

官方栏目：https://zyjy.huizhou.gov.cn/ggfw/jyxx/jsgc/zbzgysgg/ 。正式采集复用官网 JS 调用的 `https://search.gd.gov.cn/jsonp/site/752376`，遍历 8 个建设工程叶子栏目；只留 `post_type=normal`、未废止、未过期且标题为招标公告的记录。详情链接优先 `post_url` 并规范化回官方主域。

## 验证结论

静态分页存在日期乱序，不能用于时间截止。JSONP 对关键词“管网”30 天可稳定命中；详情精确覆盖项目地点、工期和最高投标限价，官方 `viewPdf` GET 可公开下载时保留附件。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 惠州 -k 管网 -d 30 --stage zb --limit 3 --out out/huizhou.xlsx --csv
```

## 诚实限制

地区以官方栏目映射为准；不能把“监理/勘察设计”等标的类型写入地区列。
