# 独立市级交易平台总账（CITY_PLATFORMS）

> Goal v5 配套（2026-08-16）。背景：部分地级市的公告在**独立于省级平台的市级平台**上发布（省级列表不聚合其详情/全量），需单独打通。本文档是探测与接入的总账。
> 探测方法（可复现，证据 `test-logs/v5-fulltest-2026-08-16/`）：域名变体（`ggzy.{py}.gov.cn` / `ggzyjy.{py}.gov.cn` / `{py}ggzyjy.gov.cn`）代理 HEAD 探活 → 标准 EPoint `getFullTextDataNew` 指纹 POST（返回 records 即同构可零定制接入）。⚠ 环境教训：本机 DNS 直连不可用（ECONNREFUSED），**必须走代理 curl**。

## 已接入（城市级 adapter）

| 城市 | 域名 | 家族/变体 | 接入要点 | 状态 |
|---|---|---|---|---|
| 安阳 anyang | ggzy.anyang.gov.cn | 标准 EPoint（范本） | 无 infodatepx→webdate 排序；锁 001001002/001002002 | ✅ VERIFIED |
| 兰州（=gansu） | lzggzyjy.lanzhou.gov.cn | gs（双分支） | 省级 WAF 不可达走兰州市级门户 | ✅ VERIFIED（以 gansu 名义） |
| 常州 changzhou | ggzy.changzhou.gov.cn | 标准 EPoint | **fields 投影参数传入即静默返空**（omitFields 开关）；12 位栏目锁 001001001 前缀 | ✅ VERIFIED（2026-08-16 V5） |
| 定西 dingxi | ggzy.dingxi.gov.cn | 标准 EPoint·infodate 变体 | 第 4 种 sortField；源站 2023-04 停更 | 🟡 技术样本 |

## 已识别未接入（域名活，非标准 EPoint 路径——需逐城逆向，下一步专项）

| 城市 | 域名 | 探测结果 |
|---|---|---|
| 苏州 | ggzy.suzhou.gov.cn | 活(200)，标准路径与 3 个 epointX 变体均未命中 |
| 无锡 | ggzyjy.wuxi.gov.cn | 同上 |
| 泉州 | ggzyjy.quanzhou.gov.cn | 同上 |
| 临沂 | ggzyjy.linyi.gov.cn | 同上 |
| 烟台 | ggzyjy.yantai.gov.cn | 同上 |
| 岳阳 | ggzy.yueyang.gov.cn | 同上 |
| 九江 | ggzyjy.jiujiang.gov.cn | 同上 |
| 遵义 | ggzyjy.zunyi.gov.cn | 同上 |
| 宜昌 | ggzyjy.yichang.gov.cn | 活(301) |
| 宜宾 | ggzy.yibin.gov.cn | 活(403，疑似风控) |

接入路径参考：打开首页判系统（EPoint 需找对路径变体；金润/广联达/易招标等其他系需 bespoke 逆向，参照 hunan/guizhou 先例）；同构则按 anyang/changzhou 范本零定制。

## 变体未命中（域名变体不中，不代表无平台——域名模式待扩充）

宁波、温州、绍兴、嘉兴、徐州、洛阳、襄阳、赣州、唐山、保定、包头、绵阳、柳州、中山、惠州、湛江、大连、潍坊（截至 2026-08-16 探测的 3 种域名变体）。扩充方向：`{py}ggzy.cn`、`ggzy.{py}.cn`、政务网子路径、省级平台内的城市分站。

## 不适用（已由省平台/现有机制覆盖）

广东 21 市（ygp siteCode 循环）、青岛/深圳等（省级平台聚合）、各省 EPoint 站内多子站（cnum 机制）。

## 纪律

- 接入必须有四件套：reference 页 + PROV_ALIAS + 总账行 + self-test 数字（anyang/dingxi 两次教训：忘同步 CI 红）
- 栏目码必须真机枚举验证语义，禁止盲推（浙江 002001003=开标记录实证）
- EPoint 实例级差异（fields 敏感/排序字段/栏目深度）逐城实测记录在省/城页，不假设一致
