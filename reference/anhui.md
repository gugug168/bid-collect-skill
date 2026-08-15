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

## 中标/合同阶段（B 阶段 · Goal v1）
- `--stage candidate`(bulletinNature=2) / `result`(bulletinNature=3) 列表均通；详情复用 `anhuiWinHtml` AJAX 取正文（与 zb 期 `anhuiDetail` 同一函数）。
- 实测命中：中标人 / 中标价 / 项目经理 / 中标得分 / 招标人 全命中（bn=2 候选、bn=3 结果均稳）。
- 用法：`-p anhui --stage result -k 管网 --detail -d 120 --csv`
