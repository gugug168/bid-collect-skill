# 济南市采集参考（城市级 · 建设工程 search.do）

> 数据源 adapter：`jinan` · kind=`jinan` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18）**

## 机制

官方入口：https://jnggzy.jinan.gov.cn/jnggzyztb/front/noticelist.do?type=0&xuanxiang=1&area= 。POST `/jnggzyztb/front/search.do`，固定 `type=0/xuanxiang=招标公告`，`pagenum` 1-based。详情 URL 保留 `showview` 返回的 `isnew=0|1`。

## 验证结论

不解析混合阶段的首页 iframe。详情 `table_one` 精确映射项目编号、地点、资金、投资、合同估算价、招标人、代理及联系方式，避免通用扫描把“中国执行信息公开网”当主体。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 济南 -k 管网 -d 30 --stage zb --limit 3 --out out/jinan.xlsx --csv
```

## 诚实限制

`showNotice.do` 路径本身不能证明阶段；以 search.do 的 `xuanxiang` 和标题双重确认。
