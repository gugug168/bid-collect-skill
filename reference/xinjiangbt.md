# 新疆生产建设兵团 采集参考

> 数据源 adapter：`xinjiangbt` · kind=`epoint` · 验证状态：**🟡 CONNECTED_NO_RECENT_DATA（当前管网窗口）**
> 最后验证：2026-08-15（30→90→365 天、管网关键词均无记录）

## 机制
EPoint 标准，cnum=004（兵团）。

## 2026-08-15 验证结论
✅ **历史开箱验证**：兵团公告标题多不含"管网"二字，`-k 管网` 过滤为 0；**去掉 `-k`** 实测抓 19 条 18/20 全命中。机制无问题，仅关键词匹配特性。

当前 2026-08-15 的管网关键词窗口 sidecar 均为 `CONNECTED_NO_RECENT_DATA`；按历史规则去掉关键词后才可验证更广泛公告，不把本次空窗写成平台失败。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p xinjiangbt -k 管网 --detail -d 120 --csv -o out/xinjiangbt.csv
// （去掉 `-k 管网`：兵团公告标题无"管网"字，过滤为 0）
```

## 城市/区县筛选（2026-08-16 实测）
`-c 第四师 --limit 2 --detail`（无 `-k` 口径）返回 2/2 条记录（第四师G218线-可克达拉…项目，标题含筛词）；兵团粒度为师市制（第N师）。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
