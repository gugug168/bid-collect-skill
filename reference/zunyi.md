# 遵义市 采集参考（城市级 · 省平台视角过滤）

> 数据源 adapter：`zunyi` · kind=`zunyi` · 验证状态：**✅ 已打通（2026-08-16 V5 批次2 实测）**
> 最后验证：2026-08-16（Goal v5 批次2 侦察接入实测）

## 机制
贵州省平台 bespoke REST（`/tradeInfo/es/list` POST，channelId=5904475 工程建设 + docSourceName=遵义市 地市过滤 + docTitle=标题关键词；docRelTime 毫秒时间戳；**按 announcement 过滤 B 阶段**只留 zb 类；市站本体为 TRS SSR 通知栏，数据全在省平台）
（端点逆向证据：四路侦察 agent 真机验证，见 CITY_PLATFORMS.md）

## 验证结论
✅ 2026-08-16 实测：3/3 VERIFIED_RECORD（赤水供水管网漏损治理/习水污水管网答疑澄清，省平台详情直链）。侦察 total=1982。
机器证据：`test-logs/v5-fulltest-2026-08-16/b2_zunyi.run-report.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node scripts/province-collect.cjs -p zunyi -k 管网 -d 30 --limit 20 --csv -o out/zunyi.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
