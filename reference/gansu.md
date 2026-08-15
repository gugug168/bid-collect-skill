# 甘肃省 采集参考

> 数据源 adapter：`gansu` · kind=`gs` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
bespoke `gsDetail` 双分支：SSR `/xqfzx/014001/` 走通用抽取；mustache `/jygk/002001/` 走 `BulletinWebServer.action?cmd=getallprocessdetailInfonew`。

## 2026-08-14 验证结论
✅ **双分支打通（2026-08-14 前序）**：14 条管网 0 undefined / 0 dirty docLink；mustache 脏值全局拦截已加。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p gansu -k 管网 --detail -d 120 --csv -o out/gansu.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。