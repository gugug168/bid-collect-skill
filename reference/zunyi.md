# 遵义市 采集参考（城市级 · 省平台视角过滤）

## 2026-08-22 C3 project18

管网3条、非管网1条通过；公告详情与官方附件共同核对控制价和保证金，重复资格模板已清理。证据见 `evidence/c3-specialhtml-project18-20260822.json`。

> 数据源 adapter：`zunyi` · kind=`zunyi` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 天“管网”3 条；Sol + Luna 双重复测）

## 机制
官方入口：https://ggzy.guizhou.gov.cn/ 。贵州省平台 bespoke REST（`/tradeInfo/es/list` POST，channelId=5904475 工程建设 + docSourceName=遵义市 地市过滤 + docTitle=标题关键词；docRelTime 毫秒时间戳）。只接受官方阶段字段 `announcement=交易公告`；答疑澄清、更正、中标、合同、异常等全部排除。
（端点逆向证据：四路侦察 agent 真机验证，见 CITY_PLATFORMS.md）

## 验证结论
✅ 2026-08-18 实测：30 天“管网”3/3 均为真实招标公告（赤水供水管网、习水污水管网勘察设计等），标题、日期、官方详情链接、地区完整；答疑澄清/更正不再混入。机器证据：`city-semantic-retest-luna/batch-summary.json`。

## 可重复采集命令
```bash
node scripts/province-collect.cjs -p zunyi -k 管网 -d 30 --limit 3 --csv --xlsx -o out/zunyi.xlsx
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
