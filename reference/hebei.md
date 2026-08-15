# 河北省 采集参考

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

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。
## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
