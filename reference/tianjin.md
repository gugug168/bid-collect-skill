# 天津市 采集参考

> 数据源 adapter：`tianjin` · kind=`tj` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-15（全量实测矩阵 + 单省复测 + 城市筛选）

## 机制
JEECMS：`POST /content/pageContent` 取详情 HTML 片段。

## 2026-08-14 验证结论
✅ **开箱即用**：bespoke tjDetail，2026-08-14 矩阵实测 10 条管网 18/20 全命中（含 owner/控制价/开标/资质/docLink）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p tianjin -k 管网 --detail -d 120 --csv -o out/tianjin.csv
```

## 城市/区县筛选（2026-08-15 实测）
`-c 滨海 --limit 1 --detail` 返回 1/1 条 `滨海新区` 记录（供热“一张网”项目）。同次验证修复了「一标段: 资质:…」格式：企业资质输出为 `市政公用工程施工总承包一级及以上`，不会截断成标签前缀。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。
## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
