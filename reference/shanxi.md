# 山西省 采集参考

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

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。