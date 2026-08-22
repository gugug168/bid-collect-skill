# 陕西省 采集参考

## 2026-08-22 D project18

匿名接口仅返回最新10条；管网及无关键词30/90/365天均无合格招标公告，谈判采购已剔除。17字段以 `FIELD_NO_SAMPLE` 收口，不推断未披露。证据见 `evidence/d-restricted-project18-20260822.json`。

> 数据源 adapter：`shaanxi` · kind=`sntba` · 验证状态：**⛔ 登录墙（已放弃）**
> 最后验证：2026-08-15（30→90→365 天窗口仍无记录；历史登录墙证据有效）

## 机制
陕西省公共资源交易中心（`sntba`）列表+搜索。

## 2026-08-14 验证结论
⛔ **登录墙，放弃**：列表接口 401 需验证码/登录；仅"最新 10 条"免登但翻页忽略、关键词搜索需验证码。无稳定免登路径，标注 AUTH_WALL，不在重复采集范围内。

本轮静态复测未重新暴露 401/403，sidecar 因此记录为 `CONNECTED_NO_RECENT_DATA`；不能据此推翻已有登录墙证据，也不能升级为 `VERIFIED_RECORD`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p shaanxi -k 管网 --detail -d 120 --csv -o out/shaanxi.csv
// （401 登录墙，已放弃）
```

## 城市/区县筛选（2026-08-16 实测）
`-c 西安 --limit 3 --no-detail`（无 `-k` 口径）返回 3/3 条记录（西安秦华智慧生活…项目，标题含筛词）；sntba 无详情 URL（`allowNoUrl` 已知形态），城市验证为列表层。

## 诚实留空字段（源页无则空，绝不伪造）
（见 verdict；该源无法提供建设类公告厚字段）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
