# 定西市 采集参考（城市级 · infodate 排序变体）

> 数据源 adapter：`dingxi` · kind=`epoint` · 验证状态：**🟡 可达但源站停更（2023-04 后无新公告）**
> 最后验证：2026-08-16（365 天窗口 0 条，CONNECTED_NO_RECENT_DATA，errors=0）

## 机制
城市级独立站点（定西市公共资源交易中心 https://ggzy.dingxi.gov.cn），标准 EPoint `getFullTextDataNew`（与安阳/兰州同构，零定制复用 epointList）。技术价值是**第 4 种 sortField**：该实例无 infodatepx/webdate/infodateformat，日期仅在 `infodate` 列，webdate 排序静默失效返 2018 老记录——须 `sortField: "infodate"`（epointList 日期回退链已含 infodate，零代码改动）。`cats: ["004"]` 为 categorynum 前缀 contains 匹配（隔离 009 新闻/030 业务动态）。

## 验证结论
🟡 2026-08-16 实测：POST 可达（total=4621，cats=004 隔离后 3875 条交易类），但**全站最新数据停在 2023-04-23**——2024/2025/2026 均 0 条，`-d 365` 实跑 0 条（CONNECTED_NO_RECENT_DATA，errors=0，机器证据 `test-logs/city-2026-08-16/dingxi/dingxi_365d.run-report.json`）。仅作"可达城市级 EPoint + infodate 排序变体"技术样本保留，**不作为近期数据源**。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node scripts/province-collect.cjs -p dingxi -d 365 --limit 3 --no-detail --csv -o out/dingxi-365d.csv
```

## 城市/区县筛选（2026-08-16 实测）
近 3 年无新数据，城市过滤无样本可验证，不宣称粒度。

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（源站停更，枚举无意义）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **不配置**：源站 2023-04 后停更，阶段枚举与验证无业务意义。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
