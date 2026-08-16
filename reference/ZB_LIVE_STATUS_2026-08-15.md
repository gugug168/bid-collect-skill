# 招标公告实时状态总账（2026-08-15）

> 本表只记录招标公告（`zb`）的实时窗口结果，不包含候选人/中标/合同阶段。每次采集的 sidecar 才是单次运行的机器真相；这里是便于人审和 PR 追踪的当前快照。
>
> 验收规则：先跑近 30 天，出现 1–3 条真实公告即停止扩大；空结果扩大到 90 天和 365 天。`CONNECTED_NO_RECENT_DATA` 只表示该次参数、关键词和窗口内没有记录，不等于官方平台历史上没有公告。

| adapter | 30 天状态 | 条数 | 90/365 天 | 主要证据 | 备注 |
|---|---|---:|---|---|---|
| beijing | `VERIFIED_RECORD` | 3 | — | `beijing.run-report.json` | 标题/日期/官方 URL 齐全 |
| tianjin | `VERIFIED_RECORD` | 3 | — | `tianjin.run-report.json` | 列表层真实公告 |
| hebei | `CONNECTED_NO_RECENT_DATA` | 0 | 90/365 仍 0 | `hebei.run-report.json`, `hebei-90d`, `hebei-365d` | 不升级为失败 |
| shanxi | `VERIFIED_RECORD` | 3 | — | `shanxi.run-report.json` | PDF/列表入口可达 |
| neimenggu | `VERIFIED_RECORD` | 3 | — | `neimenggu.run-report.json` | 官方 JSON 详情 |
| liaoning | `VERIFIED_RECORD` | 1 | — | `liaoning.run-report.json` | 30 天仅 1 条，按规则停止 |
| jilin | `VERIFIED_RECORD` | 1 | — | `jilin.run-report.json` | 30 天仅 1 条，按规则停止 |
| heilongjiang | `CONNECTED_NO_RECENT_DATA` | 0 | 90/365 仍 0 | `heilongjiang.run-report.json`, `heilongjiang-90d`, `heilongjiang-365d` | 旧快照曾需 400 天，当前窗口仍无记录 |
| shanghai | `VERIFIED_RECORD` | 3 | — | `shanghai.run-report.json` | DNS→curl 兜底后有记录 |
| jiangsu | `VERIFIED_RECORD` | 3 | — | `jiangsu.run-report.json` | 徐州另有城市筛选证据 |
| zhejiang | `VERIFIED_RECORD` | 3 | — | `zhejiang.run-report.json` | 官方 URL 齐全 |
| anhui | `VERIFIED_RECORD` | 3 | — | `anhui-detail-v2.run-report.json` | 详情标题修复后复验 |
| fujian | `VERIFIED_RECORD` | 3 | — | `fujian.run-report.json` | 官方列表/壳页 |
| jiangxi | `VERIFIED_RECORD` | 3 | — | `jiangxi.run-report.json` | TLS→curl 兜底 |
| shandong | `VERIFIED_RECORD` | 3 | — | `shandong.run-report.json` | 现网已返回真实记录 |
| henan | `CONNECTED_NO_RECENT_DATA` | 0 | 90/365 仍 0 | `henan.run-report.json`, `henan-90d`, `henan-365d` | 文件索引级限制仍保留 |
| hubei | `VERIFIED_RECORD` | 3 | — | `hubei.run-report.json` | 武汉另有城市筛选证据 |
| hunan | `VERIFIED_RECORD` | 3 | — | `hunan.run-report.json` | 官方 REST |
| guangdong | `FAILED` | — | 未执行扩大 | `guangdong-cooldown-v1.run-report.json` | 官方接口首个请求 429/60000ms 冷却；manual_observation |
| guangxi | `VERIFIED_RECORD` | 3 | — | `guangxi.run-report.json` | HTTP 官方入口 |
| hainan | `VERIFIED_RECORD` | 3 | — | `hainan.run-report.json` | 多栏目拆轮后有记录 |
| chongqing | `VERIFIED_RECORD` | 3 | — | `chongqing.run-report.json` | Nuxt SSR |
| sichuan | `VERIFIED_RECORD` | 3 | — | `sichuan.run-report.json` | EPoint |
| guizhou | `VERIFIED_RECORD` | 3 | — | `guizhou.run-report.json` | 官方 REST |
| yunnan | `VERIFIED_RECORD` | 3 | — | `yunnan-detail-v3.run-report.json` | guid→官方详情 URL 修复后通过 |
| xizang | `VERIFIED_RECORD` | 3 | — | `xizang.run-report.json` | projectCode 详情 |
| shaanxi | `CONNECTED_NO_RECENT_DATA` | 0 | 90/365 仍 0 | `shaanxi-v2.run-report.json`, `shaanxi-90d`, `shaanxi-365d` | 既有登录墙证据仍保留 |
| gansu | `VERIFIED_RECORD` | 3 | — | `gansu.run-report.json` | 双分支详情 |
| qinghai | `VERIFIED_RECORD` | 3 | — | `qinghai.run-report.json` | EPointX |
| ningxia | `VERIFIED_RECORD` | 3 | — | `ningxia.run-report.json` | EPointX |
| xinjiang | `VERIFIED_RECORD` | 3 | — | `xinjiang.run-report.json` | EPointX |
| xinjiangbt | `CONNECTED_NO_RECENT_DATA` | 0 | 90/365 仍 0 | `xinjiangbt.run-report.json`, `xinjiangbt-90d`, `xinjiangbt-365d` | 旧快照需去关键词，当前管网窗口为空 |
| anyang | `VERIFIED_RECORD` | 5 | — | `city-2026-08-16/anyang/anyang_list.run-report.json` | 城市级 adapter 范本（2026-08-16 接入实测，非省级） |

## 汇总

- `VERIFIED_RECORD`：27 个（含 anyang 城市级范本，2026-08-16 接入）
- `CONNECTED_NO_RECENT_DATA`：5 个（河北、黑龙江、河南、陕西、兵团）
- `FAILED`：1 个（广东，官方 429）
- `BROWSER_REQUIRED`：本轮未新增；Chrome CDP 未连接，不能宣称浏览器路径可用。

外部完整人读报告与逐次 XLSX/CSV/sidecar 位于 GOAL evidence 目录；本表不复制业务数据，也不把空结果写成 0 条历史事实。
