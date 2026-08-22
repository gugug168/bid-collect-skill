# 临沂市 采集参考（城市级 · EPoint 双层包装）

> 数据源 adapter：`linyi` · kind=`sdwrap` · 验证状态：**✅ 已打通（2026-08-16 V5 批次2 实测）**
> 最后验证：2026-08-22（B4 project18 实时复测）

## 机制
EPoint 双层包装（山东系 SSR 壳 + 标准 `getFullTextDataNew`，但响应为 `{code, content:"JSON字符串"}` 须二次 JSON.parse——`sdwrap` kind；pn=offset 语义；sort webdate+id 双字段）
（端点逆向证据：四路侦察 agent 真机验证，见 CITY_PLATFORMS.md）

## 验证结论
✅ 2026-08-16 实测：3/3 VERIFIED_RECORD（兰山区枣园片区雨水管网物探/勘察/设计）。侦察 wd=管网 total=153339。
机器证据：`test-logs/v5-fulltest-2026-08-16/b2_linyi.run-report.json`。

## 2026-08-22 project18 复测

全站检索曾把合同、中标结果、候选人和招标计划误标为招标公告；现只允许 `012001001=工程建设招标公告` 与 `012002001=政府采购公告`，并继续使用标题阶段守卫。30天“管网”3条+非管网1条通过，项目规模中的预算章节和重复句首已清理。无公开招标文件直链的附件字段以受限终态收口。字段证据见 `evidence/b4-epoint-project18-20260822.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node scripts/province-collect.cjs -p linyi -k 管网 -d 30 --limit 20 --csv -o out/linyi.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
