# 岳阳市 采集参考（城市级 · 静态 CMS·GBK）

## 2026-08-22 C3 project18

管网30/90天为空，365天命中2条，非管网1条；已清理GBK模板符号并精确解析建设内容、范围、工期和业绩。证据见 `evidence/c3-specialhtml-project18-20260822.json`。

> 数据源 adapter：`yueyang` · kind=`yueyang` · 验证状态：**✅ 已打通（2026-08-16 V5 批次2 实测）**
> 最后验证：2026-08-16（Goal v5 批次2 侦察接入实测）

## 机制
静态发布 CMS（数字栏目树 /56114/56125/56126/ + content_*.html；**全站 GBK 编码**须 TextDecoder("gbk")；JSP pager.offset 分页；无服务端关键词 → clientFilterOnly；兄弟栏目 56127 候选/56128 结果/56129 变更可作 B 阶段枚举入口）
（端点逆向证据：四路侦察 agent 真机验证，见 CITY_PLATFORMS.md）

## 验证结论
✅ 2026-08-16 实测：2/2 VERIFIED_RECORD（南津港污水管网提标改造代建/君山燃气管网 EPC，GBK 中文完美解码）。侦察约 5700 条。
机器证据：`test-logs/v5-fulltest-2026-08-16/b2_yueyang.run-report.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node scripts/province-collect.cjs -p yueyang -k 管网 -d 365 --limit 20 --csv -o out/yueyang.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
