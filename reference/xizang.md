# 西藏自治区 采集参考

> 数据源 adapter：`xizang` · kind=`xz` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
bespoke `xizangDetail`：Jeecms AJAX `personalitySearch/initDetailbyProjectCode`，先抓壳页取 `var pc=真实projectCode` 再 POST。

## 2026-08-14 验证结论
✅ **bespoke 打通（2026-08-14）**：初版误用文章 ID 作 projectCode（返回空），修正为壳页 `pc` 后实测 6 条管网 owner/agency/开标/工期/控制价/资金/资质/联合体/联系/电话全命中。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p xizang -k 管网 --detail -d 120 --csv -o out/xizang.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。