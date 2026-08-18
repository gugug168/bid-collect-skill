# 独立市级交易平台总账（CITY_PLATFORMS）

> Goal v5 配套（2026-08-16）。背景：部分地级市的公告在**独立于省级平台的市级平台**上发布（省级列表不聚合其详情/全量），需单独打通。本文档是探测与接入的总账。
> 探测方法（可复现，证据 `test-logs/v5-fulltest-2026-08-16/`）：域名变体（`ggzy.{py}.gov.cn` / `ggzyjy.{py}.gov.cn` / `{py}ggzyjy.gov.cn`）代理 HEAD 探活 → 标准 EPoint `getFullTextDataNew` 指纹 POST（返回 records 即同构可零定制接入）。⚠ 环境教训：本机 DNS 直连不可用（ECONNREFUSED），**必须走代理 curl**。

## 已接入（城市级 adapter）

| 城市 | 域名 | 家族/变体 | 接入要点 | 状态 |
|---|---|---|---|---|
| 安阳 anyang | ggzy.anyang.gov.cn | 标准 EPoint（范本） | 无 infodatepx→webdate 排序；锁 001001002/001002002 | ✅ VERIFIED |
| 兰州（=gansu） | lzggzyjy.lanzhou.gov.cn | gs（双分支） | 省级 WAF 不可达走兰州市级门户 | ✅ VERIFIED（以 gansu 名义） |
| 常州 changzhou | ggzy.changzhou.gov.cn | 标准 EPoint | **fields 投影参数传入即静默返空**（omitFields 开关）；12 位栏目锁 001001001 前缀 | ✅ VERIFIED（2026-08-16 V5） |
| 洛阳 luoyang | lyggzyjy.ly.gov.cn | 标准 EPoint·HTTP | 锁 `003001002` 工程招标公告；webdate 排序；市辖区时从标题提区县 | ✅ VERIFIED（2026-08-18） |
| 郑州 zhengzhou | zzggzy.zhengzhou.gov.cn | 标准 EPoint | `cnum=012`、锁 `004001`；排除混入的招标计划/采购意向 | ✅ VERIFIED（2026-08-18） |
| 绵阳 mianyang | ggzy.my.gov.cn | 静态列表+关系接口 | `projectInfo` 壳页经 `getInfolistNew` 精确选 `001001` 真实详情；附件验证码不绕过 | ✅ VERIFIED（2026-08-18） |
| 秦皇岛 qinhuangdao | qhdggzy.cn | 静态 HTML | 仅 1–6 页连续；第 7 页深翻需验证码；排除资格预审/变更等非 zb | ✅ VERIFIED（2026-08-18） |
| 南通 nantong | ggzyjy.nantong.gov.cn | EWB-FRONT | `categorymum=003001001`；零基分页；客户端关键词；剔除 `[已作废]` | ✅ VERIFIED（2026-08-18） |
| 南京 nanjing | njggzy.nanjing.gov.cn | webdb 双栏目 | 服务类/工程类分取；关键词有效；`status.error` 不可信；标题阶段守卫 | ✅ VERIFIED（2026-08-18） |
| 惠州 huizhou | zyjy.huizhou.gov.cn | 广东政府 JSONP | 遍历 8 叶子栏目；废止/过期过滤；避开静态分页乱序 | ✅ VERIFIED（2026-08-18） |
| 中山 zhongshan | zsjypt.cn | pageList API | `nodeId=58`；`gjz` 关键词；排除 `arab37=1` 补充公告；控制价公式取末值 | ✅ VERIFIED（2026-08-18） |
| 济南 jinan | jnggzy.jinan.gov.cn | 建设工程 search.do | 锁 `xuanxiang=招标公告`；保留 isnew；table_one 结构化详情 | ✅ VERIFIED（2026-08-18） |
| 武汉 wuhan | ggzyfw.wuhan.gov.cn | 静态 CMS 查询 | `channelId=160`；标题+日期查询；详情预检排除资格预审；页内去重 | ✅ VERIFIED（2026-08-18） |
| 苏州 suzhou | ggzy.suzhou.gov.cn | 静态 SSR webBuilder | 锁 003001001 招标公告子栏目；`?pageIndex=N` 分页；相对详情链接拼绝对 | 🟡 CONNECTED_NO_RECENT_DATA（2026-08-18，30/90/365d“管网”均 0；历史 VERIFIED 保留） |
| 徐州 xuzhou | ggzy.zwb.xz.gov.cn | EPoint new API + SSR 首页 | 锁 003001001；官方 `list.js` POST `/inteligentsearchnew/`；禁用有年度断层的静态 `N.html` 分页 | ✅ VERIFIED（2026-08-18，90d 管网 3 条） |
| 定西 dingxi | ggzy.dingxi.gov.cn | 标准 EPoint·infodate 变体 | 第 4 种 sortField；源站 2023-04 停更 | 🟡 技术样本 |
| 宜昌 yichang | ggzy.sc.yichang.gov.cn | EpointWebBuilder 变体 | getSecInfoListYzm（与河南同族）；20 页起验证码 | ✅ VERIFIED（V5 批次2） |
| 临沂 linyi | ggzyjy.linyi.gov.cn | EPoint 双层包装 | {code,content:"JSON"} 二次 parse；total 15.3 万 | ✅ VERIFIED（V5 批次2） |
| 烟台 yantai | ggzyjy.yantai.gov.cn | EPoint 双层包装 | 锁 `003001003` 工程招标公告 + `003002002` 采购公告；服务端分轮 + 客户端 categorynum 双校验 | ✅ VERIFIED（2026-08-18，30d 2 条，阶段纯度复验） |
| 合肥 hefei | ggzy.hefei.gov.cn | webBuilder Service | 锁 `002001001`；官方列表 API；合肥行政区标题守卫排除该中心承载的省级异地项目 | ✅ VERIFIED（2026-08-18，30d 2 条） |
| 温州 wenzhou | ggzyjy-eweb.wenzhou.gov.cn | JPaas CMS AuthorizedRead | 锁温州市主站 `col1229696276` 招标公告；CMS unit 匿名分页；`#pdfshow[data-value]` 取官方 PDF 正文 | ✅ VERIFIED（2026-08-18，30d 0、90d 管网 1 条） |
| 宁波 ningbo | jyxt.zwb.ningbo.gov.cn:4011 | websiteapi SPA | 锁 `020105` 招标公告；复现官网北京时间双 Base64 访客 token；`articleList` + `getArticle`；公开详情 URL 保留端口 | ✅ VERIFIED（2026-08-18，30d 管网 2 条） |
| 嘉兴 jiaxing | jxszwsjb.jiaxing.gov.cn | JPaas CMS AuthorizedRead | 锁建设工程 `col1229743509` 招标公告；unitbuild 匿名分页；HTML 正文 + 官方公告 PDF | ✅ VERIFIED（2026-08-18，30d 管网 1 条） |
| 潍坊 weifang | ggzy.weifang.gov.cn:8082 | EpointWebBuilder 变体 | 锁 `007001001`；`pageIndex` 零基；官方 HTTP 端口 | ✅ VERIFIED（2026-08-18，90d 管网 13 条） |
| 青岛 qingdao | ggzy.qingdao.gov.cn | ASP.NET MVC SSR | 锁官方 `0-0-0` 招标公告；ProjectName/Time 分页；结构化详情覆盖 | ✅ VERIFIED（2026-08-18，30d 管网 4 条） |
| 深圳 shenzhen | new.szggzy.com | CMS trade API | `channelId=2851`；客户端锁 noticeTypeName；日期拆窗规避 1000 上限 | ✅ VERIFIED（2026-08-18，静态列表/详情） |
| 无锡 wuxi | ggzyjy.wuxi.gov.cn | webBuilder AJAX | /info_open JSON；无服务端关键词 clientFilterOnly | ✅ VERIFIED（V5 批次2） |
| 泉州 quanzhou | ggzyjy.quanzhou.gov.cn | Java .do | 全站 http keepScheme；projName 过滤无效 clientFilterOnly | ✅ VERIFIED（V5 批次2） |
| 岳阳 yueyang | ggzy.yueyang.gov.cn | 静态 CMS·GBK | TextDecoder("gbk")；JSP pager.offset 分页 | ✅ VERIFIED（V5 批次2） |
| 遵义 zunyi | ggzy.guizhou.gov.cn | 贵州省平台视角 | docSourceName=遵义市；只收 `announcement=交易公告` | ✅ VERIFIED（2026-08-18，30d 3 条，排除答疑/更正） |
| 宜宾 yibin | ggzy.yibin.gov.cn | 筑龙 SPA 网关 | action RPC；SPA hash 无直链 allowNoUrl（同陕西形态） | 🟡 FAILED=无直链诚实判定 |

## 已识别未接入

| 城市 | 域名 | 状态 |
|---|---|---|
| 九江 | ggzyjy.jiujiang.gov.cn | **已下线**（2026-02 官方公告：全市平台并入江西省平台 ggzy.jiangxi.gov.cn；旧域名反代空壳）——采集九江走江西省平台按地区过滤（本仓库 jiangxi adapter 已覆盖省级源） |

2026-08-18 回访证明“域名变体未命中”会漏掉简称域名、政务子域、官方跳转域和非 `.gov.cn` 官方域名。此类结果一律记 `UNVERIFIED`，不得据此推断“不存在独立平台”或“已被省级 adapter 覆盖”。

## 变体未命中（域名变体不中，不代表无平台——域名模式待扩充）

绍兴、襄阳、大连等已确认存在独立官方入口，留待后续批次；赣州、柳州、湛江、保定、包头等确认应复用省级城市分站；唐山当前公开入口 502。洛阳、绵阳、中山、惠州、南京已接入。后续发现入口时必须从政府页面反向验证主办方和栏目，不只猜域名。

## 不适用（已由省平台/现有机制覆盖）

广东除深圳外的 20 市（ygp siteCode 循环）、各省 EPoint 站内多子站（cnum 机制）。青岛、深圳现已按独立官方入口单列接入。

## 纪律

- 接入必须有四件套：reference 页 + PROV_ALIAS + 总账行 + self-test 数字（anyang/dingxi 两次教训：忘同步 CI 红）
- 栏目码必须真机枚举验证语义，禁止盲推（浙江 002001003=开标记录实证）
- EPoint 实例级差异（fields 敏感/排序字段/栏目深度）逐城实测记录在省/城页，不假设一致
