# 泉州市 采集参考（城市级 · Java .do）

## 2026-08-22 C3 project18

管网3条、非管网1条通过；项目壳页后的官方项目JSON与F001招标公告正文已接通，规模、范围、资金、工期、资格、金额和保证金可核对。证据见 `evidence/c3-specialhtml-project18-20260822.json`。

> 数据源 adapter：`quanzhou` · kind=`quanzhou` · 验证状态：**✅ 已打通（2026-08-16 V5 批次2 实测）**
> 最后验证：2026-08-16（Goal v5 批次2 侦察接入实测）

## 机制
Java `.do` 动作（`/project/getProjPage_project.do` POST；**全站 http 协议** keepScheme；projName 服务端过滤实测无效 → clientFilterOnly，全站搜索端点 getWebSearchPage.do 的 keyword 才是全文检索）
（端点逆向证据：四路侦察 agent 真机验证，见 CITY_PLATFORMS.md）

## 验证结论
✅ 2026-08-16 实测：3/3 VERIFIED_RECORD（南安市污水提质增效管网/石狮排水管网，http 直链）。侦察 total=8982、管网命中 2684。
机器证据：`test-logs/v5-fulltest-2026-08-16/b2_quanzhou.run-report.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node scripts/province-collect.cjs -p quanzhou -k 管网 -d 30 --limit 20 --csv -o out/quanzhou.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
