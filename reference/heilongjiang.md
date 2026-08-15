# 黑龙江省 采集参考

> 数据源 adapter：`heilongjiang` · kind=`epoint` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
EPoint 标准 `getFullTextDataNew`，**cnum=002=工程建设信息(27万条)**；`keywordClient:true`（服务端 wd 检索全坏，拉全量类目后客户端按标题过滤）。

## 2026-08-14 验证结论
✅ **修复后打通（2026-08-14）**：原 cnum=003=政府采购(错配) + 服务端关键词检索失效 → 0 条；改 cnum=002 + keywordClient 后，用 **`-d 400`**（建设索引记录偏旧，最新约 2026-03，`-d 120` 会全过滤）实测抓到"供水管网改造"等 6 条 18/20 全命中。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p heilongjiang -k 管网 --detail -d 120 --csv -o out/heilongjiang.csv
// （用 `-d 400`：建设索引偏旧，-d 120 会全过滤）
```

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 中标/合同阶段（B 阶段 · Goal v1）
- `--stage candidate`(cats 003002001002) 列表通；该实例未单列"中标结果"栏目（候选公示已含中标人/中标价），故仅配 candidate。
- 实测命中（最完整）：中标人 / 中标价 / 项目经理 / 中标得分 / 排名 / 招标人 / 承包人 全命中。
- 用法：`-p heilongjiang --stage candidate -k 管网 --detail -d 400 --csv`（建设索引偏旧，用 `-d 400`）
