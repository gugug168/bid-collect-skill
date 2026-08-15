# 黑龙江省 采集参考

> 数据源 adapter：`heilongjiang` · kind=`epoint` · 验证状态：**🟡 CONNECTED_NO_RECENT_DATA（当前窗口）**
> 最后验证：2026-08-15（30→90→365 天、管网关键词均无记录）

## 机制
EPoint 标准 `getFullTextDataNew`，**cnum=002=工程建设信息(27万条)**；`keywordClient:true`（服务端 wd 检索全坏，拉全量类目后客户端按标题过滤）。

## 2026-08-14 验证结论
✅ **历史修复已验证（2026-08-14）**：原 cnum=003=政府采购(错配) + 服务端关键词检索失效 → 0 条；改 cnum=002 + keywordClient 后，用 **`-d 400`** 实测抓到"供水管网改造"等 6 条 18/20 全命中。

当前 2026-08-15 的 30→90→365 天窗口 sidecar 均为 `CONNECTED_NO_RECENT_DATA`；这只覆盖本次参数与时间窗，不抹除历史可达证据。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p heilongjiang -k 管网 --detail -d 120 --csv -o out/heilongjiang.csv
// （用 `-d 400`：建设索引偏旧，-d 120 会全过滤）
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。