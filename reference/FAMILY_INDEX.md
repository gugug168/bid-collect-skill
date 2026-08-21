# 省平台架构家族索引（FAMILY_INDEX）

> 加新省 / 查某省招标公告打法前先读此页。下方状态表是 2026-08-14 的**历史厚字段快照**；当前招标公告实时状态以 [`ZB_LIVE_STATUS_2026-08-15.md`](ZB_LIVE_STATUS_2026-08-15.md) 为准。
> 本页只负责平台家族与路由；project18 的17字段能力只认根目录 `PROJECT18_CAPABILITIES.json`，人读投影见 [`COVERAGE_MATRIX.md`](COVERAGE_MATRIX.md)。
> 厚字段标准见 `SKILL.md`：owner/agency/projectCode/controlPrice/budget/bond/funding/bidOpen/duration/qualification/performance/evaluation/consortium/fullScore/contact/phone/docLink/city/projectSite/type/date/title/url（26 项）。
> **诚实纪律**：没有任何省能在每条记录填满全部 26 项（源页本就不含 performance/fullScore/projectSite 等）；"打通"= 源页**实际存在的**厚字段成功抽出，不存在的诚实留空，绝不伪造。

## 一、全省验证状态总表（历史厚字段快照 · 2026-08-14）

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
| guangdong | 广东 | ygp | ✅ VERIFIED_RECORD | — | 3C14 列表 + singleNode/detail + 官方附件；广州/珠海 2026-08-19 复测 |
| shaanxi | 陕西 | sntba | ⛔ AUTH_WALL | — | 401 登录墙，放弃 |

**统计**：✅ 28 省 / ⚠️ 3 省（shandong·henan·guangxi）/ ⛔ 1 省（shaanxi）。
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
| EPoint 标准 | `epoint` | jiangsu/zhejiang/hainan/sichuan/xinjiangbt/**heilongjiang(修复)**/**anyang·changzhou·luoyang·zhengzhou(城市级)** | `/inteligentsearch/rest/.../getFullTextDataNew`，cnum 变体，匿名 JSON（河南已迁 `henanNotice` 独立 kind，见 §3.1；城市级独立平台总账见 CITY_PLATFORMS.md，常州实例对 fields 投影参数敏感需 omitFields） |
| EPoint 自定义 | `epointX`/`gs` | ningxia/xinjiang/jiangxi/qinghai/gansu | 路径/参数非标准，须逆向；gs 双分支 |
| TRS 引擎 | `jl`/`ln`/`nmg` | jilin/liaoning/neimenggu | `was5/web/search` 或 openSearch，JSONP 剥离，反爬严 |
| HTML SSR | （默认）/`mianyang`/`qinhuangdao` | shandong(限)/anhui(改 ah)/xizang(改 xz)/guangxi(限)/beijing(改)/shanxi(改)/hebei/shanghai/**mianyang·qinhuangdao(城市级)** | Jeecms/Hanweb/WebBuilder SSR；绵阳关系接口解壳；秦皇岛深页验证码边界 |
| WebBuilder REST | `nantong` | **nantong(城市级)** | EWB-FRONT `params` 表单，`categorymum` 官方拼写，零基分页，作废/阶段三字段守卫 |
| 城市官方 bespoke | `nanjing`/`huizhou`/`zhongshan`/`jinan`/`wuhan` | 南京/惠州/中山/济南/武汉 | webdb 双栏目、广东政府 JSONP、pageList、search.do、静态 CMS 查询；各自按官方阶段字段和详情表映射 |
| bespoke REST | `hn`/`hb`/`gz`/`yn`/`fj`/`tj`/`sntba` | hunan/hubei/guizhou/yunnan/fujian/tianjin/shaanxi(墙) | 各省独立 API，须逐省逆向 |
| 特殊 | `cq`/`ygp` | chongqing/guangdong | cq Nuxt SSR；gd 独立 API 按官方地市码定向、公开详情与附件元数据 |

## 三、各族细节

### 1. EPoint 标准（epoint）
- 接口：`POST {base}/inteligentsearch/rest/esinteligentsearch/getFullTextDataNew`
- 参数：`cnum`（001–004 变体，因省而异）、`pn=offset`、`rn=20`、`sort` JSON、`noParticiple`、服务端 `wd` 关键词。
- **cnum 实测映射**：江苏 003 / 浙江 002 / 四川 002·003 / 海南默认 / 兵团 004 / **黑龙江 002（工程建设，原 003 错配为政府采购）** / 河南 001（档案电子件，文件索引级）。
- **坑**：① 河南为文件索引，`linkurl` 恒空 → `allowNoUrl`（仅列表级，无建设公告）；② **黑龙江服务端 `wd` 检索全坏**（任何关键词 0），须 `keywordClient:true` 拉全量类目后客户端按标题过滤；③ 浙江无 `infodatepx`，须 `webdate` 排序否则返回 2018 老公告；④ 去重坍缩（linkurl 坍缩成 base 强制留空）。
- 厚字段：`--detail` 触发后通用 HTML 抓取即拿全（owner/控制价/开标/资质/docLink 等 18/20 稳定命中）。
- 城市变体：洛阳 `cnum=001/cat=003001002/HTTP`；郑州 `cnum=012/cat=004001`，栏目混入招标计划，过滤后仍必须继续分页。

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
- 广东（ygp）：`3C14` 招标列表、21 地市 `siteCode`、公开 `singleNode/detail` 详情和 `noticeFileBOList` 附件；2026-08-19 广州/珠海复测为 VERIFIED_RECORD。附件仍受 12MB、每日限额与验证码边界约束。
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

## 五、中标 / 合同阶段（B 阶段 · 2026-08-15 快照）

> 在招标公告（默认 `zb`）之外，扩展到**中标候选人公示 / 中标结果公示 / 合同公示**三阶段，抽取全新字段。
> 验收标准：抽样可见即可（不强制全量覆盖）。6 个标杆省端点已全摸清单并端到端实测。

### 1. 新 CLI 维度
```bash
node province-collect.cjs -p <adapter> --stage candidate   # 中标候选人公示
node province-collect.cjs -p <adapter> --stage result      # 中标结果公示
node province-collect.cjs -p <adapter> --stage contract    # 合同公示
# 不加 --stage 等价于 --stage zb（原招标公告，行为不变）
```
- 阶段改写：`collectProvince` 在 `args.stage !== "zb"` 时，把 `ad.stages[stage]` 合并进 adapter（`listUrl/type` 改写栏目；`ad` 改 `let` 以支持 reassign）。
- 详情抽取：中标详情走通用 `extractWinDetail`（复用 zb 期 grab 池：中标人 / 中标价 / 项目负责人 / 工期 / 得分 / 排名 / 合同金额 / 招标人 / 承包人）；安徽·西藏经 `anhuiWinHtml`/`xizangWinHtml` 取 AJAX 正文（与 zb 期同机制）。

### 2. 新增字段（CSV 尾部 + XLSX 表头）
`winner`(中标人) · `winPrice`(中标价万元) · `winManager`(项目负责人) · `winScore`(中标得分) · `rank`(排名) · `contractAmount`(合同金额万元) · `partyA`(招标人) · `partyB`(承包人/乙方)。
- `duration` 已在 26 标准字段中复用。
- 诚实纪律：源页无则留空（北京候选/西藏结果等 JS 壳页诚实空，绝不伪造）；grabWinner 已加「公示/公告/名称/得分」后缀噪声拦截，避免把栏目标题当中标人。

### 3. 6 标杆省阶段支持（实测）
| adapter | candidate | result | contract | 备注 |
|---|---|---|---|---|
| heilongjiang | ✅ 全字段最完整 | — | — | cats `003002001002`，SSR 直出 中标人/价/项目经理/得分/排名 |
| anhui | ✅（bn=2） | ✅（bn=3） | 未配 | AJAX `newDetailSub`；中标人/价/项目经理/得分/招标人全命中 |
| shanxi | ✅（list/12） | ✅（list/13） | 未配 | 链接 `/f/new/notice/2/<hash>`；中标人/招标人/项目经理/得分部分命中 |
| gansu | ✅（union `002001003`/`014001003`） | 未配 | 未配 | 兰州 SSR；得分/排名/招标人稳定，中标人部分命中 |
| xizang | ✅（jyxxgchxr） | ⚠️ AJAX 壳页(诚实空) | 未配 | 候选 AJAX 命中；结果 `jyxxgcjg` 为 AJAX 壳页，正文取不到 |
| beijing | ✅ list+招标人+排名 | ✅ list+中标价+得分 | ✅ list | 详情 JS 渲染：候选/结果中标人名称不在 SSR（诚实空），结果能从 SSR 碎片抓到中标价/得分 |

### 3.1 其余 26 省 B 阶段现状（2026-08-15 逐省实证快照）

> ⚠️ **重要**：B 阶段栏目码**不可盲推**。曾假设「EPoint 标准栏目码 001=招标公告 → 003/004/005=中标候选/结果/合同」可套用，
> 但 2026-08-15 真机实测**浙江 `--stage candidate`（cats `002001003`）返回的是「开标记录」而非「中标候选人公示」**
> （标题全为「…开标记录」，winner/winPrice 恒空）。证明该规则**因省而异**，盲配会把错类目当中标候选，**违反诚实纪律**。
> 因此只允许写入逐省实探确认的阶段：代码 `ADAPTERS[*].stages` 是配置真相源，下表记录相应现场证据和限制。
> 尚未实探、源站无独立栏目或当前环境不可达时，分别写「待枚举」「不配 + 原因」或「受限」，不得用推测栏目码补齐。

| adapter | 省 | 家族 | B 阶段状态 | 说明 |
|---|---|---|---|---|
| jiangsu | 江苏 | epoint | ✅ candidate/result | cats 候选`003001007`/结果`003001008`（合同栏目`003004006`仅测试条目→不配）；winner 18/20·rank 16/20·partyA 20/20，少数行含"公示-"/得分噪声（同标杆级抽样噪声） |
| zhejiang | 浙江 | epoint | ✅ candidate/result/contract | 候选`002001004`/结果`002001005`/合同`002002004`（合同在 002002 分支）；winner 14/20·partyA 20/20，少数行"公示[代码]"泄漏 |
| hainan | 海南 | epoint | ✅ candidate/result/contract | 候选`003001005`/结果`003001006`/合同`003002005`（合同在 003002 分支）；2026-08-15 实时 smoke 3/3 命中 projectCode/winner/winPrice/duration/winScore/rank/winManager/partyA，候选历史合同额污染 0/3 |
| sichuan | 四川 | epoint | ✅ candidate/result/contract | 候选`002001006`/结果`002001008`/合同`002001007`（全在 00200100x 分支）；winner 18/20·rank 19/20·partyA 20/20，少数行含"招标人代表/得分"噪声 |
| xinjiangbt | 新疆兵团 | epoint | ✅ candidate/result | 候选`004001002003`/结果`004001003004`（结果在 003 分支）；rank 20/20·partyA 20/20 但 **winner=0/20**（详情页中标人名疑似 JS 渲染未入 SSR，待 grabWinner 调优或诚实空） |
| ningxia | 宁夏 | epointX | ✅ candidate/result/contract | 候选`001001001004`/结果`001001001003`/合同`001001001006`(合同信息公示)；winner 10/10·rank 10/10·partyA/partyB 10/10（最干净之一），winPrice 候选阶段源页无→诚实空 |
| qinghai | 青海 | epointX | ✅ candidate/result/contract | 候选`001001005`/结果`001001006`(中标通知书公示=标后结果)/合同`001001010`(合同公告)；**winner 14/14·rank 14/14·partyA/partyB 14/14·winPrice 8/14**（grabWinner 已加固：表格"第N名 <org>"兜底命中"中标候选人排序名称"表） |
| xinjiang | 新疆 | epointX | ✅ candidate/result | 候选`001001004`/结果`001001005`（工程建设 合同未单独发布→不配 contract）；winner 3/7·rank 5/7·partyA 7/7，部分详情页 JS 渲染 winner 缺失（同 xinjiangbt 模式，诚实空） |
| jiangxi | 江西 | epointX | ✅ candidate/result | 候选`002001004`/结果`002001005`（noWd 无法关键词检索，故 stage 覆写 makeBody 锁 equalList 单码；工程建设 合同未单独发布→不配 contract）；**winner 1/8(真实名 via "为中标人"兜底；余 7/8 详情页 JS 渲染诚实空)·winPrice 8/8·winScore 7/8·partyA/partyB 8/8**（grabWinner 噪声已拦截："公示]"/"业绩查询网址"→诚实空） |
| henan | 河南 | henanNotice | ✅ candidate/result（无合同栏目） | ZB+B 阶段自 2026-08-15 改走新 kind `henanNotice`（`henanNoticeList` POST `/EpointWebBuilder/rest/frontAppCustomAction/getPageInfoListNewYzm`：siteGuid 7eb5f7f1…/xiaqucode 4100/categoryNum 候选`002001003`/结果`002001006`，返回 `custom.infodata[].{title,infourl,infodate}` 真实详情链）；无独立合同栏目→不配 contract；**原 epoint 档案库索引(cnum=001 返文件名、linkurl 恒空)误配已废弃**；本沙箱代理对该 POST 端点 TLS 失败（curl 重试亦不稳）→ 代码正确待开放网络复测 |
| hebei | 河北 | html | ✅ candidate/result（无合同栏目） | 栏目树 `001002002`：候选`003`/结果`004`（招标公告`001`/变更`002`）；`005/006` 空→无独立合同公示栏目，不配 contract；`parse` 正则已泛化至 `00100200200\d` |
| shanghai | 上海 | html | ✅ candidate/result（无合同栏目） | B 阶段静态 SSR 栏目 `queryContents.jhtml` channelId 候选`32`/结果`33`（`inDates=4000`）；原误判为 JS SPA，实为可抽取；`parse` 正则 `/jyxxgc[a-z]+/` 泛化 + url `isIndex=y`；**本轮烟测待确认出数** |
| guangxi | 广西 | html | ✅ candidate/result（无合同栏目） | zbtb.gxi.gov.cn:9000 栏目 categoryId 候选`91`/结果`90`（默认`88`=ZB）；**本轮烟测 result 实测 2 条**（真实记录）；http:port 可达（见 §四 代理兜底） |
| tianjin | 天津 | tj | ✅ candidate/result/contract | channelId 候选`82324`/结果`82323`/合同`82325`（从 `jyxxgcjs.jhtml` 原始 HTML 取 link text 映射确认）；三类均真机返回真实记录（合同示"XX合同订立信息公告"），详情走 JEECMS POST（毫秒时间戳） |
| neimenggu | 内蒙古 | nmg | ✅ candidate/result/contract | `searchPublishResource` 用 `noticeTypeName` 隔离：候选`中标候选人公示`/结果`中标结果公告`(站点无"中标结果公示"字面=0)/合同`合同公示`，均真机数万条；**nmgList 原硬编码 noticeTypeName 为空 → 已改为读 ad.noticeTypeName（stages 覆盖生效）** |
| liaoning | 辽宁 | ln | ✅ candidate/result（无合同栏目） | TRS `was5/web/search`：母栏目 channelId=219677 固定，仅 DOCCHANNEL 隔离；候选`149561`(中标候选人公示)/结果`149562`(中标结果公告)，均真机 2800+/2500+ 条；合同=`Y164624` 走独立 layui 后端非 TRS → 诚实不配 contract；lnList 动态读 ad.searchword 无需改代码 |
| jilin | 吉林 | jl | ✅ candidate/result/contract | TRS `was5/web/search` channelId=237687（**全类型混合栏目 66 万+ 条**，无独立 B 阶段 channelId）；服务端 `iType='…'` 检索式恒返 0 → 改**客户端按 iType 字段过滤**：候选`中标候选人公示`/结果`中标结果公告`+`中标公告`/合同`合同公示`；**顺带修复 ZB 基线**（原检索式返 0，现拉全量客户端过滤；rn 调 50 使 crawlRound 跨页累加到 limit，避免连续空页提前 break） |
| hubei | 湖北 | hb | ✅ result（无独立候选/合同栏目） | `jsgcZbjggs` 真机 100 条；湖北公共资源**无独立中标候选人/合同公示栏目** → 诚实不配 candidate/contract；`hbList` 已修复 B 阶段动态 listKey(`endpoint+"List"`) 与双日期格式(`YYYYMMDDHHmmss`/`2026-08-14`) |
| hunan | 湖南 | hn | ✅ candidate/result（无合同栏目） | listByFile 用 `notice` 隔离阶段（2026-08-15 实测映射）：候选 notice=`2`(ZHONGBIAOHXR_NOTICE,25319条)/结果 notice=`3`(ZHONGBIAO_NOTICE,23590条)；notice=0 招标/1 变更/4·5 暂停/7 澄清/8 plan/9·10 终止/11 重新招标；**合同公示不在 notice 0-11 → 诚实不配 contract**；详情复用 hnDetail 取 招标人/控制价等，constructionNotice/getBySectionId 对本 section 仅回招标/澄清（中标公示未并入）→ **winner/winPrice 诚实空**（待逆向 constructionWin/中标详情端点） |
| guizhou | 贵州 | gz | ✅ candidate/result（合同不配） | candidate=`A03`(中标候选人公示)/result=`A04`(中标结果公示)；A04.2 合同栏目未发布→不配；**顺带修复 ZB `noticeType:affiche`→`A01`+`prjType:A`**（原 affiche 实为"招标计划"误标，find_gz_zb.js 实证 A01=prjType A=招标公告） |
| yunnan | 云南 | yn | ✅ candidate/result/contract | candidate=`getZbwjygsList`(tenderProjectName)/result=`getZbJgGgList`(bulletinname)/contract=`getContractList`(contractName)，全真机数千条；B 阶段详情端点各异→列表层诚实不伪造 URL |
| fujian | 福建 | fj | ✅ candidate/result（无合同栏目） | candidate=GGTYPE`4`(中标候选人公示)/result=GGTYPE`5`(中标结果公告)；GGTYPE 3/6/7+ 返 0 → 无合同栏目，不配 contract |
| chongqing | 重庆 | cq | ✅ candidate/result（无合同栏目） | `categoryNum`：候选`014001003`/结果`014001004`（公告`001`/答疑`002`/办事指南`005`）；无独立合同公示栏目→不配 contract；**顺带解除 `envLimited`（2026-08-15 复测 HTTP 200 可达，此前 Cloudflare 521 为瞬时/出口问题）** |
| guangdong | 广东 | ygp | ✅ candidate/result（无合同栏目） | `3C51`=候选、`3C52`=结果；无经验证合同栏目。2026-08-19 已接公开详情接口，但本轮全国验收仍只覆盖 `zb`，B 阶段不得据此宣称完整厚字段通过。 |
| shaanxi | 陕西 | sntba | ⛔ 不可达 | sntba 仅最新 10 条无详情，B 阶段无意义 |
| shandong | 山东 | html | ✅ candidate/result/contract | Jeecms `queryContent_${p}-jyxxgk.jspx` channelId 候选`149`/结果`87`/合同`78`（合同为混合源，自定义 parse 按 `/合同公示/` 过滤 block）；**`contract` 本轮 `-d 365` 烟测进行中**；ZB 基线仍受沙箱 RST 限制（§一） |

### 4. 已知限制（环境、站点公开范围或页面结构）
- **北京**候选/结果详情页为 JS 渲染，中标人机构名不在 SSR HTML（仅标题/栏目/评标办法条款），故 `winner` 诚实留空；`partyA`(招标人)/`rank` 与结果期 `winPrice`/`winScore` 可从 SSR 碎片拿到。彻底打通需逆向 JS 端点（超出 Goal v1 范围）。
- **西藏 result**（`jyxxgcjg`）列表为 AJAX 壳页，正文取不到 → 诚实空；候选期已实证可用。
- 安徽/西藏少数记录因页面结构差异出现 `名 称`/`已经确定` 等标签碎片泄漏（个别行）， majority 正确，属可接受的抽样噪声。

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
- 招标人 owner / 代理 agency / 项目编号 projectCode / 控制价 controlPrice / 开标 bidOpen / 工期 duration / 资质 qualification / 业绩 performance / 评标办法 evaluation / 联合体 consortium / 满分 fullScore / 项目经理 manager / 联系电话 phone·contact / 招标文件 docLink / 中标人 winner / 中标价 winPrice / 项目负责人 winManager / 中标得分 winScore / 排名 rank / 合同金额 contractAmount / 招标人 partyA / 承包人 partyB。
- 新增字段若某省抽不到，先查 `grabXxx` 标签池是否覆盖该省表述，再决定是否补标签（全局补，惠及所有省）。
