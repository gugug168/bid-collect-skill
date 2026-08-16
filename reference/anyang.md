# 安阳市 采集参考（城市级范本）

> 数据源 adapter：`anyang` · kind=`epoint` · 验证状态：**✅ 已打通（2026-08-16 城市级接入实测）**
> 最后验证：2026-08-16（zb 列表层 5/5 VERIFIED_RECORD + 城市筛选）

## 机制
城市级独立站点（安阳市公共资源交易中心 https://ggzy.anyang.gov.cn），标准 EPoint `getFullTextDataNew`（与江苏/兰州同构）；无 infodatepx 字段，`sortField: "webdate"`（同浙江/海南）；cats 不锁（PoC 全量 96504 条），类型由 inferType 按标题判（混入的评标结果公示如实标型，不冒充招标公告）。

## 验证结论
✅ 2026-08-16 实测：`-p anyang -k 管网 -d 365 --limit 5` 返回 5/5 条 VERIFIED_RECORD（标题/日期/官方链接齐备，样本：高新区市政管网、西片区雨水管网更新、林州市城区道路综合管网）。证据：`test-logs/city-2026-08-16/anyang/*.run-report.json`。

## 城市/区县筛选（2026-08-16 实测）
`-c` 客户端过滤可用（安阳平台 city 列为 安阳市/林州市/滑县 等区县级粒度）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p anyang -k 管网 -d 365 --limit 20 --csv -o out/anyang.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 stages 未枚举（栏目码待逐项真机验证，警惕海南式误锁）；类型不预设 defaultType（cats 全量混型，由标题判）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省（市）而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
