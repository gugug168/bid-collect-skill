# 广东省采集参考

> adapter：`guangdong` · kind=`ygp` · 招标公告验证状态：**✅ VERIFIED_RECORD**
> 最后验证：2026-08-19（广州/珠海公开列表、详情与附件元数据）

## 机制

- 列表：`POST https://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items`
- 招标公告阶段：`tradingProcess=3C14`、`secondType=A`，同时要求 `noticeNature=正常公告`，并拒绝资格预审、补充/更正/答疑及其他阶段标题。
- 省级 `siteCode=440000` 返回空，代码使用 21 地市唯一代码表；`-c` 为地市或可映射区县时先下推地市 `siteCode`，随后继续做客户端精确过滤。
- 详情：公开 `singleNode` + `detail` 接口，正文在 `tradingNoticeColumnModelList`，附件元数据在 `noticeFileBOList`。
- 官方详情链接按粤公平前端自身路由字段生成；字段不足时留空，不能猜 URL。

## 2026-08-19 实时验证

- 广州近 3 天，`--limit 3 --xlsx-layout project18 --attach`：3 条，状态 `VERIFIED_RECORD`，无列表/详情 429。
- 珠海近 3 天，`--limit 2 --xlsx-layout project18 --attach`：2 条，状态 `VERIFIED_RECORD`。
- 珠海“隆城花园”等老旧小区项目：详情拆出建设规模与本次招标范围；3MB 招标文件 ZIP 自动补出保证金 50 万元、定性评审、满分不适用。
- 珠海“香洲南区水质净化厂三期”：164.6MB 招标文件只保留官方链接并记 `ATTACHMENT_TOO_LARGE`，公告本身仍为 `VERIFIED_RECORD`。
- 当前出口曾达到平台每日下载检查上限；验证码只记录 `ATTACHMENT_CAPTCHA_REQUIRED`，不绕过、不重打。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p 广东 -c 广州 -d 3 --stage zb --limit 10 --delay 1000 --xlsx-layout project18 --attach --out output/guangzhou.xlsx --csv
node scripts/province-collect.cjs -p 广东 -c 珠海 -d 3 --stage zb --limit 10 --delay 1000 --xlsx-layout project18 --attach --out output/zhuhai.xlsx --csv
```

若列表或详情出现 429，按 sidecar 冷却提示停止，不扩大窗口继续重打。

## 附件边界

- “招标文件”列始终保留官方文件 URL。
- `--attach` 每条只选一份正式招标文件；优先 PDF/DOCX/DOC，其次 ZIP；12MB 以上不下载。
- PDF 默认使用零依赖提取器；关键标签乱码时可选调用本机 `python + pdfplumber`，不可用则诚实回退。
- 附件验证码、每日限额、大文件和解析失败写 `signals.attachments[]`，不污染公告硬字段状态。

## 已配置的其他阶段

- `candidate`：`3C51`（中标候选人公示）
- `result`：`3C52`（中标结果）
- 合同阶段没有经实证的独立路由，未配置。

本轮全国验收仍只覆盖 `zb`，不能由广东 B 阶段配置外推全国准确率。

## 家族与通用纪律

家族、429、代理与状态边界见 [`FAMILY_INDEX.md`](FAMILY_INDEX.md)。
