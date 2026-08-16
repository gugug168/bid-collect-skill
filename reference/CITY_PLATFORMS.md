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
| 宜昌 yichang | ggzy.sc.yichang.gov.cn | EpointWebBuilder 变体 | getSecInfoListYzm（与河南同族）；20 页起验证码 | ✅ VERIFIED（V5 批次2） |
| 临沂 linyi | ggzyjy.linyi.gov.cn | EPoint 双层包装 | {code,content:"JSON"} 二次 parse；total 15.3 万 | ✅ VERIFIED（V5 批次2） |
| 烟台 yantai | ggzyjy.yantai.gov.cn | EPoint 双层包装 | 与临沂同款 sdwrap kind；total 21.8 万 | ✅ VERIFIED（V5 批次2） |
| 无锡 wuxi | ggzyjy.wuxi.gov.cn | webBuilder AJAX | /info_open JSON；无服务端关键词 clientFilterOnly | ✅ VERIFIED（V5 批次2） |
| 泉州 quanzhou | ggzyjy.quanzhou.gov.cn | Java .do | 全站 http keepScheme；projName 过滤无效 clientFilterOnly | ✅ VERIFIED（V5 批次2） |
| 岳阳 yueyang | ggzy.yueyang.gov.cn | 静态 CMS·GBK | TextDecoder("gbk")；JSP pager.offset 分页 | ✅ VERIFIED（V5 批次2） |
| 遵义 zunyi | ggzy.guizhou.gov.cn | 贵州省平台视角 | docSourceName=遵义市 过滤；announcement 滤 B 阶段 | ✅ VERIFIED（V5 批次2） |
| 宜宾 yibin | ggzy.yibin.gov.cn | 筑龙 SPA 网关 | action RPC；SPA hash 无直链 allowNoUrl（同陕西形态） | 🟡 FAILED=无直链诚实判定 |

## 已识别未接入

| 城市 | 域名 | 状态 |
|---|---|---|
| 苏州 | ggzy.suzhou.gov.cn | 活(200) 自研 SSR（webBuilder 栏目树 jyxx/003XXX/tradeInfo.html 表格，侦察已拿到样本与解析正则）；**分页 URL 模式未验证**，接入留批次3（html kind，成本 ~20 行） |
| 九江 | ggzyjy.jiujiang.gov.cn | **已下线**（2026-02 官方公告：全市平台并入江西省平台 ggzy.jiangxi.gov.cn；旧域名反代空壳）——采集九江走江西省平台按地区过滤（本仓库 jiangxi adapter 已覆盖省级源） |

其余原"域名活非 EPoint"8 城已全部在 V5 批次2 接入（见上表）。18 个变体未中城市的域名模式扩充探测（6 变体 × HEAD+GET 双重复核）已于 2026-08-16 完成：仅绵阳 ggzy.mianyang.cn 命中但 503（后端停服或拒代理出口，改日重试），其余 17 城无独立域名（大概率用省平台聚合，已由省级 adapter 覆盖）。

## 变体未命中（域名变体不中，不代表无平台——域名模式待扩充）

宁波、温州、绍兴、嘉兴、徐州、洛阳、襄阳、赣州、唐山、保定、包头、绵阳、柳州、中山、惠州、湛江、大连、潍坊（截至 2026-08-16 探测的 3 种域名变体）。扩充方向：`{py}ggzy.cn`、`ggzy.{py}.cn`、政务网子路径、省级平台内的城市分站。

## 不适用（已由省平台/现有机制覆盖）

广东 21 市（ygp siteCode 循环）、青岛/深圳等（省级平台聚合）、各省 EPoint 站内多子站（cnum 机制）。

## 纪律

- 接入必须有四件套：reference 页 + PROV_ALIAS + 总账行 + self-test 数字（anyang/dingxi 两次教训：忘同步 CI 红）
- 栏目码必须真机枚举验证语义，禁止盲推（浙江 002001003=开标记录实证）
- EPoint 实例级差异（fields 敏感/排序字段/栏目深度）逐城实测记录在省/城页，不假设一致
