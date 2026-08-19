# 郑州市采集参考（城市级 · 标准 EPoint）

> 数据源 adapter：`zhengzhou` · kind=`epoint` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18）**

## 机制

官方入口：https://zzggzy.zhengzhou.gov.cn/jsgc/004001/subpage.html 。匿名 EPoint 全文检索，`cnum=012`、`categorynum=004001`、`sort=webdate desc`。该栏目混入大量“招标计划”，按标题明确排除“招标计划/采购意向”，但不强制真实公告标题必须带“招标公告”后缀。

## 验证结论

关键词“管网”可连续分页并返回静态官方详情。明确“本次招标接受联合体投标”优先于后文“联合体各方不得再组成其他联合体”的参与规则。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 郑州 -k 管网 -d 30 --stage zb --limit 3 --out out/zhengzhou.xlsx --csv
```

## 诚实限制

栏目阶段依赖负面守卫；过滤后仍继续翻页，不因整页均为计划而提前结束。
