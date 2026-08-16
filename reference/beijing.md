# 北京市 采集参考

> 数据源 adapter：`beijing` · kind=`html` · 验证状态：**✅ 已打通（厚字段可重复采集）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
Jeecms/Hanweb SSR，列表 `<li>` 正则取标题+日期；详情通用 HTML 抓取。

## 2026-08-14 验证结论
✅ **栏目修正后打通**：原误锁 `jyxxgcjszzgg`（工程建设·终止公告，本身无厚字段）导致"全空"假象；2026-08-14 改锁 `jyxxggjtbyqs`（工程建设·招标公告），`--detail` 实测 10 条管网公告 18/20 厚字段全命中。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p beijing -k 管网 --detail -d 120 --csv -o out/beijing.csv
```

## 城市/区县筛选（2026-08-16 实测）
`-c 海淀 --limit 2 --detail` 返回 2/2 条 `海淀区` 记录（海淀区供水管网消…项目）。（2026-08-16 重跑）

## 诚实留空字段（源页无则空，绝不伪造）
performance / fullScore（源页普遍无评分细则/业绩要求，全省一致诚实留空）；projectSite / city / type 依省而异（源页无则空）

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。

## 中标/合同阶段（B 阶段 · Goal v1）
- `--stage candidate`(jyxxzbhxrgs) / `result`(jyxxzbjggg) / `contract`(jyxxgcjshtgs) 列表均通。
- 详情 JS 渲染：**候选/结果中标人名称不在 SSR**（诚实空）；但 `partyA`(招标人)/`rank` 及结果期 `winPrice`/`winScore` 可从 SSR 碎片拿到。
- 用法：`-p beijing --stage result -k 管网 --detail -d 120 --csv`
