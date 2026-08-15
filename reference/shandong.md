# 山东省 采集参考

> 数据源 adapter：`shandong` · kind=`html` · 验证状态：**⚠️ 环境限制（代码正确，待开放网络/降频）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
Jeecms SSR `.jhtml` 列表+详情。

## 2026-08-14 验证结论
⚠️ **本沙箱不可达**：`.jhtml` 列表端点服务端 RST（连接重置），开放网络可能可采。代码机制正确（HTML 族通用），标注 ENV_LIMIT 非代码缺陷。复测：`HTTPS_PROXY` 走开放网络重试。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p shandong -k 管网 --detail -d 120 --csv -o out/shandong.csv
// （本沙箱不可达，开放网络重试）
```

## 诚实留空字段（源页无则空，绝不伪造）
（见 verdict；该源无法提供建设类公告厚字段）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
