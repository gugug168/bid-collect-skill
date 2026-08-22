# 宜宾市 采集参考（城市级 · 筑龙 SPA 网关）

## 2026-08-22 D project18

官方 `getGCJS_ZhaoBiao_GongGao` action与SPA详情路由已接通；管网30天为空、90天命中3条，另核对1条设备采购。结构化标段字段可取得控制价、保证金和评标办法；ZBJ评分细则记录为未解析形态。证据见 `evidence/d-restricted-project18-20260822.json`。

> 数据源 adapter：`yibin` · kind=`yibin` · 验证状态：**🟡 列表层可用·无详情直链（allowNoUrl 形态）**
> 最后验证：2026-08-16（Goal v5 批次2 侦察接入实测）

## 机制
筑龙 SPA 统一网关（`/ggfwptwebapi/Web/service` action RPC：action=pageTongYong_SouSuo + xinXi_LeiXing=102 招标公告码表；**详情为 SPA hash 路由无直链** allowNoUrl（部分 gongGao_URL 外链可用）；HEAD 请求被 WAF 403 必须 GET/POST）
（端点逆向证据：四路侦察 agent 真机验证，见 CITY_PLATFORMS.md）

## 验证结论
🟡 2026-08-16 实测：3 条真实记录（金沙江宜宾排水管网监理/施工、珙县燃气管网）但无官方详情直链——**FAILED 系 allowNoUrl 硬字段诚实判定非采集失败**（同陕西形态）。侦察 total=7952、管网命中 266。
机器证据：`test-logs/v5-fulltest-2026-08-16/b2_yibin.run-report.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node scripts/province-collect.cjs -p yibin -k 管网 -d 365 --limit 20 --csv -o out/yibin.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
