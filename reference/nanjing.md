# 南京市采集参考（城市级 · webdb）

> 数据源 adapter：`nanjing` · kind=`nanjing` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18）**

## 机制

官方入口：https://njggzy.nanjing.gov.cn/njweb/fjsz/buildService1.html 。POST `/webdb_njggzy/fjszListAction.action?cmd=getInfolist`，分别采 `068001001=服务类`、`068001002=工程类`，参数 `keyword/pageIndex/pageSize`；页码 1-based。响应 `status.state=error` 时 `custom.Table` 仍是真实数据，只验证 `custom`。

## 验证结论

阶段没有独立字段，严格按 `GongGaoName/title` 保留“招标公告”，排除澄清修改和资审公告。详情为静态 HTML；合同估算价单位为万元，项目编号取 `BiaoDuanNO`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 南京 -k 管网 -d 30 --stage zb --limit 3 --out out/nanjing.xlsx --csv
```

## 诚实限制

两个类别必须分别请求；不得按 `status.state` 或类别名推断阶段。
