# 广西壮族自治区 采集参考

## 2026-08-22 C1 project18

详情页通过官方动态密钥接口加载PDF，采集器已能取得文件；本批四条PDF均无文本层，详情字段按 `FIELD_OCR_REQUIRED` 收口，本轮不增加OCR。短效token不写入招标文件链接。证据见 `evidence/c1-htmlpdf-project18-20260822.json`。

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

## 城市/区县筛选（2026-08-16 实测）
`-c 柳州 --limit 1 --detail` 返回 1/1 条 `柳州市` 记录（柳州市鱼峰区南片…项目）；详情 PDF DES 加密为既知限制，不影响列表层城市粒度。（2026-08-16 重跑）

## 诚实留空字段（源页无则空，绝不伪造）
（见 verdict；该源无法提供建设类公告厚字段）

## 中标/合同阶段（B 阶段 · Goal v1）

本省的 `--stage candidate|result|contract`（中标候选/结果/合同）**待逐省枚举端点，尚未配置 `stages`**。
原因：B 阶段栏目码因省而异，盲推会把错类目当中标候选（浙江 `002001003` 实证=开标记录）。
状态与正确做法见 `FAMILY_INDEX.md` §3.1「其余 26 省 B 阶段现状」。

## 家族与通用纪律
见 `FAMILY_INDEX.md`（家族总览 + 代理/鉴权/mustache 脏值拦截/去重坍缩等通用提醒）。
