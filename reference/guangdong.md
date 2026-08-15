# 广东省 采集参考

> 数据源 adapter：`guangdong` · kind=`ygp` · 验证状态：**❌ FAILED（官方 429，待冷却后复测）**
> 最后验证：2026-08-15（低频单请求仍返回 429）

## 机制
粤公平独立 JSON API `ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items`，须逐 21 地市 `siteCode` 循环（`siteCode=440000` 返 0）。

## 2026-08-15 验证结论
❌ **仍被官方限流**：低频复测（间隔 12 秒、上限 1 条）首个请求即返回 `429`，程序报告全局冷却 `60000ms`；已在冷却前停止重打。该结果是接口失败，不是“窗口无公告”。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p guangdong -k 管网 --detail -d 120 --csv -o out/guangdong.csv
// （环境 429 限流，降频复采）
```

## 诚实留空字段（源页无则空，绝不伪造）
（见 verdict；该源无法提供建设类公告厚字段）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
