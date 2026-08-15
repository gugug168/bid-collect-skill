# 招标采集器 SKILL · reference 分层改造设计稿

> 状态：待大古确认（2026-08-14）
> 目标：把挤在 SKILL.md 第 73–110 行的 31 省"已支持省份"大表，拆成 `reference/` 下每省一页 + 家族索引，SKILL.md 只留总原则/方法论/纪律/指针。

---

## 1. 现状诊断（事实层）

- `collect-bid-notices/` 当前只有 `SKILL.md`(270 行) + `scripts/`（`province-collect.cjs` 等），**无 `reference/`、无 `scaffolds/`**。
- 31 省特征全挤在 SKILL.md 一张表里（第 73–110 行，38 行），每省一行"关键特征"，信息密度高但：
  - 加省要改大表，易冲突、难 review；
  - 详细逆向过程/坑点散落在代码 `ADAPTERS` 注释与 agent 证据文件里，没沉淀进 skill；
  - 表太长，加载 skill 时占大量上下文。
- **关键约束**：WorkBuddy 的 Skill 机制**只自动加载 `SKILL.md`**，`reference/` 子文件不会自动注入上下文。拆层后 SKILL.md 必须显式写"加省/查某省先 `Read reference/<省>.md`"，否则写了不生效。

---

## 2. 目标目录结构

> **unit 定义（2026-08-14 大古澄清）**：reference 的组织单元是「网站」——每个官方招投标信息网站（省级平台、或独立市级平台）一个页面。省级平台 = 一页；独立市级站（如某省各市有分站且结构不同）可单页；广东 21 市是同一网站内 `siteCode` 循环，在 `guangdong.md` 内写全，不单列 21 页。目标：把「如何正确获取完整信息」的方案按网站沉淀，供复用 + 按同类方法扩展更多网站。

```
collect-bid-notices/
├─ SKILL.md                         ← 瘦身：总原则 + 方法论 + 纪律 + 字段 + 参数 + 指针表
├─ reference/
│  ├─ NEW_PROVINCE_TEMPLATE.md      ← 脚手架：加省照这个填（含探测步骤 + 代码骨架）
│  ├─ FAMILY_INDEX.md               ← 家族索引：按 adapter 类型归类 31 省，速查打法
│  ├─ guangdong.md                  ← 特例①：粤公平 21 市 siteCode 循环详写
│  ├─ hunan.md                      ← 特例②：listByFile + getBySectionId + getNoticeInfo 厚字段链路（标杆样例）
│  ├─ jiangsu.md  zhejiang.md  ...  ← 其余 29 省各一页（按复杂度详略）
│  └─ chongqing.md                  ← ENV_LIMIT 诚实留证（Cloudflare 521 待他网复测）
└─ scripts/
   ├─ province-collect.cjs          ← 不改（adapter 已固化在内，reference 只是文档沉淀）
   ├─ ygp-collect.cjs
   ├─ pdf-text.cjs
   └─ probe-epoint-fingerprint.cjs
```

**"市"的处理**（按你的决策"省级 + 广东和湖南特例"）：
- 全国 31 省各一页（省级平台一锅出，无需逐市页）；
- 广东特例：在 `guangdong.md` 详写 21 市 `siteCode` 循环（珠海/广州…）；
- 湖南特例：在 `hunan.md` 详写厚字段详情接口链路（最新、最复杂，作标杆）；
- 不全国每市单列（300+ 文件纯负担）。湖南的 `regionCode` 只是列表过滤参数，不是分站，不建市页。

---

## 3. 分层原则（SKILL.md 留什么 / reference 放什么）

### SKILL.md 保留（瘦身到 ≈120 行）
- `## 何时用` / `## 数据源`（粤公平）
- `## 跨省模式` 总原则：**"各省平台结构不同，本采集器按省注册 adapter；具体每省怎么取，见 `reference/<省>.md`，加省先 `Read reference/NEW_PROVINCE_TEMPLATE.md`"**
- `## 调用方式`（粤公平 + 跨省通用命令）
- `## 参数`（两套参数表）
- `## 字段说明`（输出 JSON/CSV 字段，含厚字段诚实留空规则）
- `## 限流须知` / `## 监控模式`
- **指针表**（替代原 38 行大表）：`| adapter | 省份 | 类型族 | reference |`，每行只留 adapter 名 + 省份 + 类型族 + 指向 `reference/xx.md` 的链接，删掉"关键特征"列。
- `## 省平台架构分类与攻坚策略`（保留，但精简为指向 FAMILY_INDEX）
- `## 端到端采集纪律`（R1–R6 诚实规则，保留）

### reference/ 承担
- 每省页：域名、列表接口、参数构造、详情接口（如有）、坑点、实测日期、厚字段覆盖率、样例命令。
- FAMILY_INDEX：按类型归类，列共通打法 + 组内省差异，供"加新省时快速判断属于哪族"。
- NEW_PROVINCE_TEMPLATE：加省脚手架（探测步骤 + 代码骨架 + 回填 SKILL 指针表）。

---

## 4. 家族分类（FAMILY_INDEX 框架）

| 家族 | adapter kind | 成员省 | 共通打法 |
|---|---|---|---|
| EPoint 标准 | `epoint` | jiangsu/zhejiang/hainan/sichuan/xinjiangbt/heilongjiang/henan | `/inteligentsearch/rest/.../getFullTextDataNew`，cnum 001–004 变体命中，匿名 JSON |
| EPoint 自定义 | `epointX`/`gs` | ningxia/xinjiang/jiangxi/qinghai/gansu | 同内核但路径/参数非标准，需逆向 `app.js` 找真实路径；gs 用 unionCondition 过滤 |
| TRS 引擎 | `jl`/`ln`/`nmg` | jilin/liaoning/neimenggu | `was5/web/search` 或 `openSearch`，JSONP 包裹剥离，channelid 隔离，反爬严格（perpage≤20） |
| HTML 服务端渲染 | 默认(无 kind) | shandong/anhui/xizang/guangxi/beijing/shanxi/hebei/shanghai | Jeecms/Hanweb/WebBuilder SSR，`<li>`/`<tr>` 正则取标题+日期，零鉴权，客户端过滤 |
| bespoke REST/JSON | `hn`/`hb`/`gz`/`yn`/`fj`/`tj`/`sntba` | hunan/hubei/guizhou/yunnan/fujian/tianjin/shaanxi | 各省独立 API，签名/解密/POST 各异，需逐省逆向；hn 已打通结构化详情接口 |
| 特殊/限制 | `cq`/`ygp` | chongqing(ENV_LIMIT)/guangdong(独立 ygp) | cq Cloudflare 521 待他网复测；gd 独立 API 逐市循环 |

> 通用提醒（进 FAMILY_INDEX 顶部）：代理 `127.0.0.1:7897`；部分省 HTTPS TLS 失败改 HTTP 兜底；AUTH_WALL 绝凭单一死端点下结论（甘肃/青海/内蒙古均翻案）。

---

## 5. 每省页模板（NEW_PROVINCE_TEMPLATE.md 骨架）

```markdown
# <省份名> 招标采集 adapter

- adapter 名：`<key>`
- 平台：<平台全称>
- 类型族：<epoint / epointX / trs / html / bespoke / 特殊>
- 实测日期：YYYY-MM-DD
- 状态：verified / ENV_LIMIT / AUTH_WALL(诚实未建)

## 列表接口
- 方法/URL：`<verb> <url>`
- 关键参数：<param=value ...>
- 分页：<机制>
- 关键词检索：服务端 / 客户端(blind)

## 详情接口（如有）
- `<verb> <url>` → 返回字段：<招标人/控制价/...>
- 触发：采集加 `--detail`

## 坑点 / 注意事项
- <WAF/反爬/字段为空/需 http 兜底 ...>

## 厚字段覆盖率
- 能拿：<owner/controlPrice/...>
- 诚实留空：<budget/bond/docLink，因公告正文不公开>

## 样例命令
node scripts/province-collect.cjs -p <key> -k 管网 -d 365 --detail --csv --out <key>-管网.md
```

---

## 6. 样例省页（hunan.md，特例②标杆）

```markdown
# 湖南省 招标采集 adapter

- adapter 名：`hunan`
- 平台：湖南省公共资源交易服务平台（www.hnsggzy.com）
- 类型族：bespoke 交易 API + 结构化详情接口
- 实测日期：2026-08-14（bespoke 列表 + 厚字段详情补全）
- 状态：verified

## 列表接口
- GET https://www.hnsggzy.com/tradeApi/constructionTender/listByFile
- 参数：notice=0（招标/资审公告）& tenderProjectType=CONSTRUCTION（工程建设）& current=N & size=20
- 分页：MyBatis-Plus current/size，total≈28420
- 关键词检索：客户端（端点只按公告类型过滤，不支持关键词；`clientFilterOnly:true`）
- 含给排水管网类公告

## 详情接口（厚字段，--detail 触发）
- GET /tradeApi/constructionTender/getBySectionId?sectionId=<bidSectionId>
  → 招标人(tendererName)/代理机构/项目编号(bidSectionNo)/控制价(controlPrice)/
    资金来源(funding)/评标办法(evaluation)/完整地区(省·市·县)
- GET /tradeApi/constructionTender/getNoticeInfo?sectionId=<bidSectionId>
  → 开标时间(bidOpen)/投标截止/公告 HTML 正文（抽保证金/资质/工期/联系人/电话）
- 两接口均公开、无需 token；SPA hash 路由详情页 HTML 渲染拿不到正文，故不走通用抓取

## 坑点
- 原 adapter 误指"省招标投标监管网"通知公告栏目（非招标、假阳性），已纠正
- 盲试 /detail 返 500，真实路径是 getBySectionId（逆向 app.js 得）
- listByFile 的 records 里招标人/标段号/开标时间全为 null，厚字段必须走详情接口

## 厚字段覆盖率
- 能拿：owner/agency/projectCode/controlPrice/funding/evaluation/city(精确)/bidOpen/
        qualification/duration/performance/consortium/contact/phone/type(精确)
- 诚实留空：budget(概算)/bond(保证金)/docLink —— 湖南公告正文不公开这些，绝不伪造

## 样例命令
node scripts/province-collect.cjs -p hunan -k 管网 -d 365 --detail --csv --out hunan-管网.md
```

---

## 7. SKILL.md 瘦身后指针表（替代原第 73–110 行）

```
| adapter | 省份 | 类型族 | reference |
|---|---|---|---|
| guangdong | 广东(21市) | ygp 独立 API | [guangdong.md](reference/guangdong.md) |
| hunan | 湖南 | bespoke+详情 | [hunan.md](reference/hunan.md) |
| jiangsu | 江苏 | epoint | [jiangsu.md](reference/jiangsu.md) |
| ... (31 省 + chongqing) ... | | | |
```
> 删原"关键特征"列；详情见各 reference 页。加省先 `Read reference/NEW_PROVINCE_TEMPLATE.md`。

---

## 8. 迁移清单（确认后逐条执行）

| # | 源（SKILL 表行 / 代码注释） | 目标 reference 页 | 备注 |
|---|---|---|---|
| 1 | 第 77 行 shandong | shandong.md | HTML Jeecms |
| 2 | 第 78 行 jiangsu | jiangsu.md | epoint cnum=003 |
| 3 | 第 79 行 zhejiang | zhejiang.md | epoint cnum=002 |
| 4 | 第 80 行 hainan | hainan.md | epoint cnum=003 |
| 5 | 第 81 行 anhui | anhui.md | 表单翻页 |
| 6 | 第 82 行 sichuan | sichuan.md | epoint 002/003 |
| 7 | 第 83 行 xinjiangbt | xinjiangbt.md | epoint cnum=004 |
| 8 | 第 84 行 heilongjiang | heilongjiang.md | epoint 历史索引 |
| 9 | 第 85 行 guangdong | guangdong.md | 特例① 21市 |
| 10 | 第 86 行 henan | henan.md | epoint allowNoUrl |
| 11 | 第 87 行 xizang | xizang.md | HTML SSR |
| 12 | 第 88 行 shaanxi | shaanxi.md | sntba 仅10条 |
| 13 | 第 89 行 ningxia | ningxia.md | epointX |
| 14 | 第 90 行 xinjiang | xinjiang.md | epointX |
| 15 | 第 91 行 jiangxi | jiangxi.md | epointX noWd |
| 16 | 第 92 行 hunan | hunan.md | 特例② 厚字段 |
| 17 | 第 93 行 guangxi | guangxi.md | HTML http:9000 |
| 18 | 第 94 行 guizhou | guizhou.md | bespoke REST |
| 19 | 第 95 行 yunnan | yunnan.md | bespoke REST guid |
| 20 | 第 96 行 hubei | hubei.md | bespoke REST |
| 21 | 第 97 行 jilin | jilin.md | TRS JSONP |
| 22 | 第 98 行 fujian | fujian.md | 签名+解密 |
| 23 | 第 99 行 beijing | beijing.md | HTML Jeecms |
| 24 | 第 100 行 tianjin | tianjin.md | JEECMS POST |
| 25 | 第 101 行 shanxi | shanxi.md | HTML Hanweb |
| 26 | 第 102 行 hebei | hebei.md | HTML 镜像 |
| 27 | 第 103 行 neimenggu | neimenggu.md | TRS REST |
| 28 | 第 104 行 liaoning | liaoning.md | TRS WAS |
| 29 | 第 105 行 gansu | gansu.md | gs EPoint |
| 30 | 第 106 行 shanghai | shanghai.md | HTML JEECMS |
| 31 | 第 107 行 qinghai | qinghai.md | epointX 翻案 |
| 32 | cq adapter | chongqing.md | ENV_LIMIT 留证 |

每页内容从 SKILL 表对应行 + `province-collect.cjs` 的 `ADAPTERS[<key>]` 注释直接抽取，**不重复探测**（除非某省注释缺失需补探）。

---

## 9. 执行步骤（你确认后）

1. `mkdir reference/`
2. 写 `reference/NEW_PROVINCE_TEMPLATE.md`（脚手架）
3. 写 `reference/FAMILY_INDEX.md`（家族分类，第 4 节内容）
4. 写 `guangdong.md` + `hunan.md`（两个特例，最详）
5. 批量生成其余 29 省页（按迁移清单，从代码注释抽）
6. 写 `chongqing.md`（ENV_LIMIT 留证）
7. 瘦身 SKILL.md：删第 73–110 行大表 → 换成指针表（第 7 节）；总原则段加"见 reference"指引
8. `node -c` 校验 collector 不变；skill 副本 `province-collect.cjs` 已与项目版同步，本次只改文档不改代码
9. 收尾：回写今日日志；向你报告

---

## 10. 风险与未决

- **工作量**：32 个 reference 页（31 省 + 重庆）+ 模板 + 索引，纯文档搬运，预计一次性完成；若你担心上下文，可分两批（先特例+索引+模板，再补 29 省）。
- **reference 不自动加载**：已在上文强调，SKILL.md 必须显式指引 agent 主动 Read，否则失效。
- **代码与文档一致性**：adapter 逻辑在 `province-collect.cjs`，reference 只是文档镜像；日后改 adapter 须同步改对应省页（在 NEW_PROVINCE_TEMPLATE 里写明这条纪律）。
