# 温州市采集参考（城市级 · JPaas CMS）

## 2026-08-22 C2 project18

管网30/90天为空，365天命中1条；另核对1条公路监理公告。已按编号段精确解析规模、范围、监理服务期和业绩引用。证据见 `evidence/c2-cityhtml-project18-20260822.json`。

> 数据源 adapter：`wenzhou` · kind=`wenzhou` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 天“管网”0 条，扩大到 90 天得到 1 条；Sol 实测）

## 机制
官方主站招标公告入口：https://ggzyjy-eweb.wenzhou.gov.cn/col/col1229696276/index.html 。页面 `AuthorizedRead/unitbuild.js` 匿名调用 `/api-gateway/jpaas-publish-server/front/page/build/unit`，其中 `pageId=1229696276` 明确对应温州市主站“招标公告”。adapter 按发布日期翻页、客户端过滤关键词，详情页再从 `#pdfshow[data-value]` 下载官方公告 PDF 提取厚字段。

早期探测的 `col1229666813` 属温州市公共资源交易中心瑞安分网旧栏目，不能代表温州市主站；本 adapter 不使用该旧入口。

## 验证结论
✅ 2026-08-18 实测：30 天“管网”无记录，按协议扩大到 90 天后取得 1 条《温州市区供水管网漏损治理工程一阶段一老旧管道改造》。标题、日期、官方详情链接、地区四个硬字段齐全；官方 PDF 可提取开标时间、企业自筹、270 日历天、市政资质、控制价 1823.9929 万元、评定分离、不接受联合体、招标人、代理机构和联系人。源页未披露的业绩、保证金、满分标准保持空白。

机器证据：`wenzhou-sol-90d-v2/wenzhou.run-report.json`（以最终复采目录为准）。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 温州 -k 管网 -d 90 --limit 3 --csv --xlsx -o out/wenzhou.xlsx
```

## 诚实留空与限制
仅采 `zb` 招标公告。若附件是扫描件且没有文本层，解析器会留空并记录原因，不做 OCR 猜测；官方源页没有的字段不从同项目其他阶段借值。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
