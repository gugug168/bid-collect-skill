# 苏州市 采集参考（城市级 · 静态 SSR）

> 数据源 adapter：`suzhou` · kind=html（默认 SSR 分支） · 验证状态：**CONNECTED_NO_RECENT_DATA（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 → 90 → 365 天，关键词“管网”均为 0；接口成功、非采集失败）

## 机制
城市级独立平台（苏州市公共资源交易平台 https://ggzy.suzhou.gov.cn，webBuilder 4.4）。列表为 **SSR 静态 HTML**——页内 `{{}}` 是 mustache 隐藏模板行，真实数据行同在 HTML（浏览器 DOM 与 curl 双证，勿被模板行误判为 JS 壳）。锁 `003001001` 子栏目（建设工程-招标公告）避开 003001 大类混型（提前公示/定标结果）；分页 `?pageIndex=N`（1-based）；详情静态页 `/jyxx/003001/003001001/<日期>/<uuid>.html`。无服务端关键词（clientFilterOnly）。

## 验证结论
历史证据：2026-08-16 子栏目解析 4 条正式公告（苏州高新区实验学校内装/渭泾塘路设计/吴中太湖新城基建），标题/日期/静态链接/区县级 city 齐备。当前证据：2026-08-18 按 30 → 90 → 365 天复测“管网”均为 0，状态诚实记为 `CONNECTED_NO_RECENT_DATA`，不把空结果冒充成功或失败。机器证据：`city-retest-01/batch-summary.json`。

## 城市/区县筛选（2026-08-16 实测）
cityHint 列表字段为区县级粒度（高新区/相城区/吴中区…），`-c` 客户端过滤直接可用。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 苏州 -k 管网 -d 90 --limit 20 --out output/suzhou.xlsx --csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（003001004 定标结果等子栏目待逐项枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
