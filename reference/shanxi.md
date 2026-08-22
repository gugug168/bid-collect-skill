# 山西省 采集参考

## 2026-08-22 C1 project18

30天管网3条、非管网1条通过；最高投标限价/招标控制价公示已从 `zb` 剔除，项目规模不再污染招标范围。证据见 `evidence/c1-htmlpdf-project18-20260822.json`。

> 数据源 adapter：`shanxi` · kind=`html` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
sxbid.com.cn SPA 壳页，正文为 PDF，经 pdfjs `viewer.html?rdm=3&file=<编码PDF>` 加载。

## 2026-08-14 验证结论
✅ **pdfjs 修复后打通**：2026-08-14 将 pdfjs iframe 检测前置 + 放宽无 .pdf 后缀，实测 6 条管网公告抽取 PDF 正文 → owner/agency/控制价/开标/资质/保证金/docLink 全命中（budget 亦可抽）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p shanxi -k 管网 --detail -d 120 --csv -o out/shanxi.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 定襄 --limit 1 --detail` 返回 1/1 条 `定襄县` 记录（定襄县老城北片区…项目）；PDF 正文省，--limit 1。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 中标/合同阶段（B 阶段 · Goal v1）
- `--stage candidate`(list/12) / `result`(list/13) 列表均通；详情为 PDF 正文（pdfjs 加载，`extractWinDetail` 复用 zb 期 grab 池）。
- 实测命中：中标人 / 招标人 / 项目经理 / 得分 部分命中（PDF 结构化差异大，字段覆盖弱于 list 层）。
- 用法：`-p shanxi --stage candidate -k 管网 --detail -d 120 --csv`
