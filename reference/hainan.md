# 海南省 采集参考

> 数据源 adapter：`hainan` · kind=`epoint` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
EPoint 标准；地区字段择优（xiaquname 才是行政区，zhuanzai 是发布平台名须跳过）。

## 2026-08-14 验证结论
✅ **厚字段已打通**：`--detail` 触发后，owner/agency/controlPrice/funding/bidOpen/duration/qualification/consortium/contact/phone/docLink 等稳定抽取（2026-08-14 实测 18/20 列 100% 命中，缺失列即上方"诚实留空"字段，非失败）。 2026-08-14 矩阵实测 20 条管网 18/20 全命中。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p hainan -k 管网 --detail -d 120 --csv -o out/hainan.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。
## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
