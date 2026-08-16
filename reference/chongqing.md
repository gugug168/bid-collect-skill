# 重庆市 采集参考

> 数据源 adapter：`chongqing` · kind=`cq` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
Nuxt SSR，列表+详情同源 HTML。

## 2026-08-14 验证结论
✅ **复测已可达**：2026-08-14 矩阵实测 rc=0 抓 6 条管网 18/20 全命中（此前 Cloudflare 521 已于本环境解除，原 ENV_LIMIT 标注作废）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p chongqing -k 管网 --detail -d 120 --csv -o out/chongqing.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 九龙坡 --limit 2 --detail` 返回 2/2 条记录（大九污水厂九龙坡范围…项目）；city 列碎片化为片区名，标题源稳定命中。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
