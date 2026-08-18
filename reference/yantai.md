# 烟台市 采集参考（城市级 · EPoint 双层包装）

> 数据源 adapter：`yantai` · kind=`sdwrap` · 验证状态：**✅ VERIFIED_RECORD（2026-08-18 实时复测）**
> 最后验证：2026-08-18（30 天“管网”2 条；Sol + Luna 双重复测）

## 机制
官方入口：https://ggzyjy.yantai.gov.cn/ 。EPoint 双层包装（与临沂同款 `sdwrap` kind；主字段为 title 而非 titlenew；含 categorynum/categoryname/xiaquname 结构化字段）。只采官方 `003001003=工程建设招标公告` 与 `003002002=政府采购公告`；服务端分栏目请求后，再按 `categorynum` 客户端校验，拒绝中标结果、采购合同、答疑与变更。

## 验证结论
✅ 2026-08-18 实测：30 天“管网”2 条，均为真实招标/采购公告，标题、日期、官方详情链接、地区完整；标标通 16 列通过。旧的全站搜索样本混入合同/中标结果，已由本次锁栏目证据取代。机器证据：`city-semantic-retest-luna/batch-summary.json`、`field-fix-sol-v2/yantai.run-report.json`。

## 可重复采集命令
```bash
node scripts/province-collect.cjs -p yantai -k 管网 -d 30 --limit 3 --csv --xlsx -o out/yantai.xlsx
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
