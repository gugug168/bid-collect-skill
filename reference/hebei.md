# 河北省 采集参考

## 2026-08-22 C1 project18

管网30→90→365天均为空；无关键词30天命中1条官方招标公告，不冒充管网结果。资质模板未给实际门槛，已拒收。证据见 `evidence/c1-htmlpdf-project18-20260822.json`。

> 数据源 adapter：`hebei` · kind=`html` · 验证状态：**🟡 CONNECTED_NO_RECENT_DATA（当前窗口）**
> 最后验证：2026-08-15（30→90→365 天、管网关键词均无记录）

## 机制
SSR 列表镜像 `jyxxList.html` 分页正则。

## 2026-08-14 验证结论
✅ **历史开箱验证**：HTML 族，详情通用 HTML 抓取全字段命中（2026-08 前期实测）。

当前实时窗口 sidecar 均为 `CONNECTED_NO_RECENT_DATA`，不推断为代码失败；历史厚字段证据仍保留。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p hebei -k 管网 --detail -d 120 --csv -o out/hebei.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 赵县 --limit 1 --no-detail`（无 `-k` 口径）返回 1/1 条记录（中达储能科技（赵县）…项目，标题含筛词）；`-k 管网` 365d 仍 0 条。观察：cityHint 匹配源比输出 city 列丰富（`-c 石家庄` 能正确命中 cityHint 为「河北省石家庄市赵县北王里镇」的记录）。

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
