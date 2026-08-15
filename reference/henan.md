# 河南省 采集参考

> 数据源 adapter：`henan` · kind=`epoint` · 验证状态：**⚠️ 受限源（仅文件索引级，无公告厚字段）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
EPoint 标准 `getFullTextDataNew`，**cnum=001=档案电子件（按文件名）索引**。

## 2026-08-14 验证结论
⚠️ **文件索引级源，不可用**：河南该实例全文索引是"档案电子件（名称）"（306 万条），records 的 `title`/`linkurl` 恒空（仅文件名），`管网` 等建设关键词检索返回 0；列表面板即"文件索引"而非"公告页"。**定位为 LIST_ONLY/文件索引源，无法抽建设类厚字段公告**，须另寻河南公告页级源（如地市门户）。诚实不伪造详情链接（已 `allowNoUrl`）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p henan -k 管网 --detail -d 120 --csv -o out/henan.csv
// （仅文件索引级，0 建设公告，见 verdict）
```

## 诚实留空字段（源页无则空，绝不伪造）
（见 verdict；该源无法提供建设类公告厚字段）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
