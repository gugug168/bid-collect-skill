# 广西壮族自治区 采集参考

> 数据源 adapter：`guangxi` · kind=`html` · 验证状态：**⚠️ 部分通（列表通，详情待实现）**
> 最后验证：2026-08-14（全量实测矩阵 + 单省复测）

## 机制
列表 SSR `.html` 可达（http:port）；详情 PDF 经单 DES-ECB(key=`Ctpsp@88`，取前 8 字节) 解密 `getSecretKey` 响应取密钥再下 PDF。

## 2026-08-14 验证结论
⚠️ **列表通、详情待实现**：列表+通用 HTML 抽取已通，但详情 PDF 需 DES 解密；Node 22 禁用 DES 且 openssl 无 legacy 模块，纯 JS 实现未完成（待办：移植 `detail_Encryption.js` 单 DES-ECB+PKCS7）。当前 `-k 管网 --detail` 抽到的记录厚字段为空（详情 PDF 未解密）。

## 可重复采集命令
```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p guangxi -k 管网 --detail -d 120 --csv -o out/guangxi.csv
// （详情待 DES 实现，当前厚字段空）
```

## 诚实留空字段（源页无则空，绝不伪造）
（见 verdict；该源无法提供建设类公告厚字段）

## 历史兼容说明（不属于公开契约）
本文件公开使用范围仅为招标公告（zb）。候选/中标/合同旧实现不在本轮实现或验收。
## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
