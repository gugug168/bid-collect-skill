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

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。
## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
