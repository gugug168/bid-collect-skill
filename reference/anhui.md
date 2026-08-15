# 安徽省 采集参考

> 数据源 adapter：`anhui` · kind=`ah` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
bespoke `anhuiDetail`：列表 `url` 含 guid+bulletinNature，POST `/jsgc/newDetailSub` 取 jQuery AJAX 分块 HTML 喂通用抽取。

## 2026-08-14 验证结论
✅ **bespoke 打通**：2026-08-14 修正 listUrl（去 `time=1` 仅今天过滤 + 补 tenderProjectType=1），实测 8 条管网 owner/agency/开标/工期/控制价/保证金/资金/资质/评标/联合体/联系/电话全命中（含 bond/evaluation）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p anhui -k 管网 --detail -d 120 --csv -o out/anhui.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。