# 常州市 采集参考（城市级 · 独立平台）

> 数据源 adapter：`changzhou` · kind=`epoint` · 验证状态：**✅ VERIFIED_RECORD（2026-08-22 B1）**
> 最后验证：2026-08-22（管网3条+科创中心设计1条）

## 机制
城市级**独立平台**（常州市公共资源交易中心 https://ggzy.changzhou.gov.cn，江苏省平台不聚合其详情），标准 EPoint `getFullTextDataNew` 同构。两个实例级差异（真机二分定位）：
1. **`fields` 投影参数敏感**：传入即静默返空（total None，与"无数据"不可区分）——`omitFields: true` 删除该参数，返回全量字段（解析链不变）
2. **栏目 12 位深层级**（安阳是 9 位）：`001001001` 前缀 = 工程建设招标公告大类（末 3 位子码：001 施工 total≈1192 / 002 监理设计≈309 / 004 设备采购≈95，均为 zb 范畴）；锁前缀 contains 隔离 001006 产权交易（商铺租赁类）与 005 其他交易

`sortField: "webdate"`（同安阳）。日期回退链 infodateformat→infodatepx→webdate→infodate 自动覆盖。

## 验证结论
✅ 2026-08-16 实测：`-p changzhou -k 管网 -d 30 --limit 3 --detail` 3/3 VERIFIED_RECORD——控制价 250/2994.43/440 万、招标人、官方详情链接（ggzy.changzhou.gov.cn/jyzx/001001/...）全命中。机器证据：`test-logs/v5-fulltest-2026-08-16/changzhou2.run-report.json`。

## 2026-08-22 B1 project18 结论

已确认服务端 `wd` 会忽略关键词，现强制标题二次过滤；设施/桩号不再冒充地区，业绩残句被拒收，公开附件可补保证金。17字段终态为 VL=3、VD=12、VA=1、R=1，无 `FIELD_UNVERIFIED`。机器证据：`reference/evidence/b1-epoint-project18-20260822.json`。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p changzhou -k 管网 -d 30 --limit 20 --detail --csv -o out/changzhou.csv
```

## 诚实留空字段（源页无则空，绝不伪造）
B 阶段 `stages` 未配置（栏目码待逐项真机枚举，本轮只验收 zb）。

## 中标/合同阶段（B 阶段 · Goal v1）

本 adapter 的 `--stage candidate|result|contract` **待逐项枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因平台而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1。

## 家族与通用纪律
见 `FAMILY_INDEX.md`。同类独立市级平台总账见 [`CITY_PLATFORMS.md`](CITY_PLATFORMS.md)。
