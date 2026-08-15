# 省平台架构家族索引（FAMILY_INDEX）

> 加新省 / 查某省打法前先读此页。2026-08-14 全量实测更新：32 省 adapter 全部验证，**27 省厚字段已打通可重复采集，5 省受限**（见下方总表）。
> 厚字段标准见 `SKILL.md`：owner/agency/projectCode/controlPrice/budget/bond/funding/bidOpen/duration/qualification/performance/evaluation/consortium/fullScore/contact/phone/docLink/city/projectSite/type/date/title/url（26 项）。
> **诚实纪律**：没有任何省能在每条记录填满全部 26 项（源页本就不含 performance/fullScore/projectSite 等）；"打通"= 源页**实际存在的**厚字段成功抽出，不存在的诚实留空，绝不伪造。

## 一、全省验证状态总表（2026-08-14 实测）

| adapter | 省/市 | 家族 kind | 状态 | 厚字段 | 关键修正 / 注记 |
|---|---|---|---|---|---|
| beijing | 北京 | html | ✅ WORKS | 18/20 | 改锁 `jyxxggjtbyqs`（原误锁终止公告） |
| tianjin | 天津 | tj | ✅ WORKS | 18/20 | JEECMS POST 详情 |
| chongqing | 重庆 | cq | ✅ WORKS | 18/20 | Cloudflare 521 已解除（原 ENV_LIMIT 作废） |
| shanghai | 上海 | html | ✅ WORKS | 18/20 | 开箱即用 |
| hebei | 河北 | html | ✅ WORKS | 18/20 | 开箱即用 |
| shanxi | 山西 | html | ✅ WORKS | 18/20 | pdfjs `viewer.html?rdm=3&file=` 修复（正文 PDF） |
| neimenggu | 内蒙古 | nmg | ✅ WORKS | — | TRS 公开 JSON 详情 nmgDetail（15/15，过滤 1970 脏开标） |
| liaoning | 辽宁 | ln | ✅ WORKS | 18/20 | TRS，perpage≤20 |
| jilin | 吉林 | jl | ✅ WORKS | 18/20 | TRS JSONP，channelid=237687 |
| heilongjiang | 黑龙江 | epoint | ✅ WORKS | 18/20 | **修复**：cnum 003→002(工程建设) + keywordClient(wd 检索坏)；用 `-d 400` |
| jiangsu | 江苏 | epoint | ✅ WORKS | 18/20 | cnum=003 |
| zhejiang | 浙江 | epoint | ✅ WORKS | 18/20 | cnum=002，须 webdate 排序 |
| anhui | 安徽 | ah | ✅ WORKS | 18/20 | bespoke newDetailSub AJAX；去 `time=1` 限今天 |
| fujian | 福建 | fj | ✅ WORKS | 18/20 | 壳页 SSR 已含厚字段，无需 bespoke 详情 |
| jiangxi | 江西 | epointX | ✅ WORKS | 18/20 | XZinterface，采购词表增强 |
| hubei | 湖北 | hb | ✅ WORKS | 18/20 | hbDetail 结构化详情 |
| hunan | 湖南 | hn | ✅ WORKS | 18/20 | 标杆 tradeApi |
| guizhou | 贵州 | gz | ✅ WORKS | 18/20 | gzDetail 结构化详情 |
| yunnan | 云南 | yn | ✅ WORKS | 18/20 | ynDetail，code 字符串 `"1"` |
| hainan | 海南 | epoint | ✅ WORKS | 18/20 | 地区字段择优 xiaquname |
| sichuan | 四川 | epoint | ✅ WORKS | 18/20 | cnum=002/003 |
| xizang | 西藏 | xz | ✅ WORKS | 18/20 | bespoke initDetailbyProjectCode（壳页 pc） |
| ningxia | 宁夏 | epointX | ✅ WORKS | 18/20 | interface_wz |
| xinjiang | 新疆 | epointX | ✅ WORKS | 18/20 | inteligentsearchnew（标准路径 401） |
| xinjiangbt | 新疆兵团 | epoint | ✅ WORKS | 18/20 | 标题无"管网"字，去 `-k` 抓 |
| qinghai | 青海 | epointX | ✅ WORKS | 18/20 | inteligentSearch 方法名非标准 |
| gansu | 甘肃 | gs | ✅ WORKS | 18/20 | gsDetail 双分支，0 undefined/0 dirty |
| shandong | 山东 | html | ⚠️ ENV_LIMIT | — | 沙箱不可达 `.jhtml`（RST），开放网络重试 |
| henan | 河南 | epoint | ⚠️ LIMITED | — | 文件索引级（档案电子件），linkurl 恒空，0 建设公告 |
| guangxi | 广西 | html | ⚠️ BROKEN_DETAIL | — | 列表通；详情 PDF 需 DES 解密（待纯 JS 实现） |
| guangdong | 广东 | ygp | ⚠️ ENV_LIMIT | — | 粤公平 429 限流（代码完整，降频复采） |
| shaanxi | 陕西 | sntba | ⛔ AUTH_WALL | — | 401 登录墙，放弃 |

**统计**：✅ 27 省 / ⚠️ 4 省（shandong·henan·guangxi·guangdong）/ ⛔ 1 省（shaanxi）。
**统一可重复采集命令**（WORKS 省直接套用，受限省见注记）：

```bash
HTTPS_PROXY=http://127.0.0.1:7897 node province-collect.cjs -p <adapter> -k 管网 --detail -d 120 --csv -o out/<adapter>.csv
```

- heilongjiang 用 `-d 400`（建设索引偏旧）；
- xinjiangbt 去掉 `-k 管网`（兵团公告标题无"管网"字）；
- shandong / guangdong 待开放网络或降频；henan / guangxi / shaanxi 见各自文档。

## 二、家族总览

| 家族 | adapter kind | 成员（已验证状态） | 共通打法 |
|---|---|---|---|
| EPoint 标准 | `epoint` | jiangsu/zhejiang/hainan/sichuan/xinjiangbt/**heilongjiang(修复)**/henan(受限) | `/inteligentsearch/rest/.../getFullTextDataNew`，cnum 变体，匿名 JSON |
| EPoint 自定义 | `epointX`/`gs` | ningxia/xinjiang/jiangxi/qinghai/gansu | 路径/参数非标准，须逆向；gs 双分支 |
| TRS 引擎 | `jl`/`ln`/`nmg` | jilin/liaoning/neimenggu | `was5/web/search` 或 openSearch，JSONP 剥离，反爬严 |
| HTML SSR | （默认） | shandong(限)/anhui(改 ah)/xizang(改 xz)/guangxi(限)/beijing(改)/shanxi(改)/hebei/shanghai | Jeecms/Hanweb/WebBuilder SSR 正则，零鉴权 |
| bespoke REST | `hn`/`hb`/`gz`/`yn`/`fj`/`tj`/`sntba` | hunan/hubei/guizhou/yunnan/fujian/tianjin/shaanxi(墙) | 各省独立 API，须逐省逆向 |
| 特殊 | `cq`/`ygp` | chongqing(复测通)/guangdong(限) | cq Nuxt SSR；gd 独立 API 逐市循环 |

## 三、各族细节

### 1. EPoint 标准（epoint）
- 接口：`POST {base}/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew`
- 参数：`cnum`（001–004 变体，因省而异）、`pn=offset`、`rn=20`、`sort` JSON、`noParticiple`、服务端 `wd` 关键词。
- **cnum 实测映射**：江苏 003 / 浙江 002 / 四川 002·003 / 海南默认 / 兵团 004 / **黑龙江 002（工程建设，原 003 错配为政府采购）** / 河南 001（档案电子件，文件索引级）。
- **坑**：① 河南为文件索引，`linkurl` 恒空 → `allowNoUrl`（仅列表级，无建设公告）；② **黑龙江服务端 `wd` 检索全坏**（任何关键词 0），须 `keywordClient:true` 拉全量类目后客户端按标题过滤；③ 浙江无 `infodatepx`，须 `webdate` 排序否则返回 2018 老公告；④ 去重坍缩（linkurl 坍缩成 base 强制留空）。
- 厚字段：`--detail` 触发后通用 HTML 抓取即拿全（owner/控制价/开标/资质/docLink 等 18/20 稳定命中）。

### 2. EPoint 自定义（epointX / gs）
- 路径非标准，必须逆向前端 bundle：`/interface_wz/`（宁夏）、`/inteligentsearchnew/`（新疆本级，标准 `/EpointWebBuilder/` 401）、`/XZinterface/`（江西）、`/inteligentsearch/rest/inteligentSearch`（青海，方法名非标准）、`/inteligentsearch/rest/...`（甘肃兰州，unionCondition 过滤 002001001/014001001）。
- 坑：标准路径 401/404；cnum 全量 10 地区串（青海）；`pn=offset`（宁夏/新疆）；`noWd:true` 拉全量（江西）；`noParticiple` 检索怪癖。
- **甘肃双分支（gsDetail）**：SSR `/xqfzx/014001/` 走通用抽取；mustache `/jygk/002001/` 走 `GET {base}/EpointWebBuilder/BulletinWebServer.action?cmd=getallprocessdetailInfonew&infoid=<uuid>&strStep=1|3`，`custom` 二次 JSON.parse，`status.state` 恒 `"error"` 不可信（判 `j.custom` 非空）。

### 3. TRS 引擎（jl / ln / nmg）
- 接口：`GET {base}/was5/web/search`（吉林/辽宁）或 `/trssearch/openSearch/searchPublishResource`（内蒙古）。
- 详情：吉林/辽宁走通用 HTML 抓取（列表 `url` 即详情页）；**内蒙古 `getPublishResourceDealContent?sourceDataKey=`（nmgDetail，公开 JSON，须过滤 1970 脏开标时间）**。
- 坑：JSONP 包裹剥离（吉林）；`perpage≤20`（辽宁 ≥25 触发反爬占位页）；`channelid` 隔离（吉林 237687/辽宁 219677）；内蒙古与 auth 网关 `getPublishResourceDealList`（恒返空）区分，正确列表端 `searchPublishResource`、正确详情端 `getPublishResourceDealContent`。

### 4. HTML SSR（默认）
- 解析：`<li>`/`<tr>` 块正则取标题+日期+链接；零鉴权。
- 坑：路径分页（`jyxxgcgg_2.jhtml` 北京/西藏、`jyxxList.html` 河北、`/f/new/notice/list/11` 山西）；广西/贵州仅 http:port 可达（https TLS 失败）。
- **2026-08-14 修正**：① 北京改锁 `jyxxggjtbyqs`（招标公告，原误锁终止公告）；② 山西 pdfjs `viewer.html?rdm=3&file=<编码PDF>` 前置检测 + 放宽无 .pdf 后缀（正文 PDF 抽取）；③ 安徽/西藏转 bespoke 详情（见下方）。

### 5. bespoke REST/JSON（hn / hb / gz / yn / fj / tj / sntba）
- 湖南 `tradeApi`+`hnDetail`（标杆）；湖北 `jsgcZbggDetail?guid=`+`hbDetail`；贵州 `api/trade/detail?id=`+`gzDetail`；云南 `findZbggByGuid?guid=`+`ynDetail`（code 字符串 `"1"`）；福建 MD5 签名+AES（壳页 SSR 已含厚字段，无需 bespoke 详情）；天津 JEECMS POST（毫秒时间戳）；陕西 sntba（401 墙）。
- 坑：服务端关键词多数失效 → 客户端过滤；福建需签名/解密；云南 `String(j.code)==="1"`；陕西 keywordBlind。

### 6. 特殊 / 限制
- 广东（ygp）：独立 JSON API 100% 结构化含全厚字段，须逐 21 地市 `siteCode` 循环（`440000` 返 0）；本环境 429 限流 → ENV_LIMIT，降频复采。
- 重庆（cq）：Nuxt SSR，2026-08-14 复测已可达（原 Cloudflare 521 解除）→ 升为 WORKS。

## 四、通用提醒（适用所有族）

- **代理**：`HTTPS_PROXY=http://127.0.0.1:7897`；部分省 HTTPS TLS 失败改 **HTTP** 兜底（广西/贵州 http:port）。
- **AUTH_WALL**：绝不凭单一死端点下结论（甘肃/青海/内蒙古均因多试端点翻案）；恒返空 `data:[]` 结构合法 ≠ 跑不通。
- **verify 门禁**：返回真实「标题+日期」才 `verified=true`；`code:200` 空数据不算。
- **诚实留空**：列表无详情直链（`allowNoUrl`）或厚字段拿不到，留空 / 空字符串，禁止伪造。
- **mustache SPA 脏值拦截（全局守卫）**：详情页是未渲染模板时（甘肃/宁夏等 EPoint 系），通用抽取会把 `{{downloadurl}}`（URL 编码 `%7B%7Bdownloadurl%7D%7D`）写进 `docLink`。所有详情合并过滤器已全局拦截含 `{`/`}`/`downloadurl`/`%7B`/`%7D` 的值；`maybePdfText` 与 `gsMapRecord` 各自二次拦截。判别：CSV 的 `docLink` 含 `%7B%7B…%7D%7D` 即报警该省详情页是 SPA。
- **去重坍缩防护**：linkurl 解析后坍缩成 base 自身时强制留空，防全量记录并成 1 条（河南曾 74→1）。
- **频率纪律**：逐省间隔 ≥8s、`--delay 500` 起、单省熔断 180s；粤公平/受限源降频。
- **扩展新网站**：照 `NEW_PROVINCE_TEMPLATE.md`；改 adapter 必须同步改对应 `reference/<key>.md`（本表即总账）。

## 五、历史兼容说明（不属于公开契约）
本索引公开使用范围仅为招标公告（zb）；旧的候选/中标/合同研究不参与当前实现或验收。

## 六、字段口径与通用标签池（Goal v1 抽取修复沉淀 · 2026-08-15）

### 1. 预算 vs 招标控制价（易混淆，务必分清）
- **招标控制价（controlPrice）**：源页「招标控制价 / 最高投标限价 / 最高限价」字段，湖南/江苏等多省由结构化 JSON 或正文直出，覆盖率最高。
- **预算（budget）**：源页「项目预算 / 工程预算 / 预算金额 / 投资预算 / 建设预算 / 预算价」字段，多为**立项投资规模**，很多省公告正文根本不写 → 诚实空（非缺陷）。
- **概算（budget 同列）**：「工程概算 / 投资估算 / 概算」——`grabBudgetWan` 同时匹配概算与预算。
- ⚠️ 湖南实证：14 条里「预算」仅 2 次且均为「施工图预算」（设计条款，不跟金额）；「最高投标限价」12 次均为通用条款不跟金额；真实金额在「招标控制价」→ 故 budget=0% 在湖南样本是诚实空。
- 不要因 budget=0% 就判定"没抓到"——先看源页是否真有预算/概算金额字段。

### 2. 批准文号（approval · 2026-08-15 修复）
- `grabApprovalNo` 捕获「X发改审【2024】17号」类文号（发文机关+部门词+年份+号），已修前缀噪声（排除「的批复告/经由据」等）。
- 湖南实测 approval 从 0% → 36%（5/14），文号干净（双发改审【2024】17号 等）。
- 多数省 approval 为诚实空（正文有「批准/备案」字样但无编号）。

### 3. 429 限流防护（2026-08-15 修复）
- 粤公平 429 响应「请 60 秒后重试」，旧代码冷却封顶 4s 导致永久撞墙 → 改为**按服务端 60s 退避 + 全局降速**（一次被限后续全慢，成功缓回），并解析 `Retry-After`/响应体「N 秒」。
- 全局 `requestWithRetry` 亦加自适应降速记忆。

### 4. 通用标签池（抽字段的"词表"）
- 招标公告字段重点：owner / agency / projectCode / controlPrice / budget / bond / funding / bidOpen / duration / qualification / performance / evaluation / consortium / fullScore / contact / phone / docLink / city / projectSite / type / date / title / url；公开业务表仍以标标通 16 列为准。
- 新增字段若某省抽不到，先查 `grabXxx` 标签池是否覆盖该省表述，再决定是否补标签（全局补，惠及所有省）。
