---
name: collect-bid-notices
description: 采集招标/中标/采购公告。广东使用粤公平结构化 JSON，跨省使用按省注册的公共资源交易中心 adapter；当前注册 32 个省市级平台，支持关键词、时间窗口、详情厚字段、MD/CSV/XLSX、B 阶段和监控。适用于采集或监控管网、污水、排水、市政、水利等公开招投标信息。
license: MIT
metadata:
  version: "1.3.0"
  author: "大古"
---

# 粤公平招标采集器 (collect-bid-notices)

## 何时用

- 用户要采集/监控广东（尤其珠海）的招标公告、中标公示、采购公告等
- 关键词场景：管网、污水、排水、市政、供水、水利等工程类关键词
- 需要结构化字段：公告标题、发布日期、业主单位、项目类型、环节（招标/中标/评标等）、项目编号、平台
- 产出 Markdown 报告 + JSON + CSV，供筛选、归档或定时监控
- **监控场景**：配合 `--state` 状态文件，每天/每小时跑一次，只输出"新出现的公告"

## 数据源

`POST https://ygp.gdzwfw.gov.cn/ggzy-portal/search/v2/items`

粤公平返回 **100% 结构化 JSON**（对比 Playwright 渲染方案成功率仅 40%、招标文件链接 10%）。单页请求约 100ms，零外部依赖（Node 内置 fetch）。

## 调用方式

```bash
# 单城市 + 多关键词（OR）
node scripts/ygp-collect.cjs -k "管网,污水,排水" -c 珠海 -d 60

# 全省扫描（工程建设 + 政府采购）——务必加 --delay 500 防限流
node scripts/ygp-collect.cjs -k "管网" -c 全省 --cat A,D -d 30 --delay 500

# 排除词（去掉监理/评标噪音）
node scripts/ygp-collect.cjs -k "污水,排水" -c 珠海 -d 60 -x "监理,评标"

# 不限关键词（抓全量）+ Markdown + JSON + CSV
node scripts/ygp-collect.cjs -k "" -c 珠海 --cat A -d 30 -o report.md --json --csv

# ★ 监控模式：只出新公告（状态文件记住已见 docId）
node scripts/ygp-collect.cjs -k "管网" -c 珠海 -d 7 --state ~/bid-state.json -o today.md
# 第二天再跑同样的命令 → 只输出昨天之后新增的公告；--all 可强制输出全部
```

## 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `-k, --keyword` | 关键词，逗号分隔（OR）；留空=不限 | 空 |
| `-c, --city` | 城市，逗号分隔，或 `全省` | 珠海 |
| `--cat` | 类别：`A`工程建设 `B`土地矿业 `C`国有资产 `D`政府采购 `R`中介服务 `L`用能权 `M`涉法涉诉 `S`海洋资源 `Z`其他；可逗号多值 | A |
| `-d, --days` | 近 N 天（客户端按发布日倒序截断） | 30 |
| `-x, --exclude` | 排除词，逗号分隔（标题包含则丢弃） | 空 |
| `-l, --limit` | 最多返回条数 | 200 |
| `-o, --out` | 输出 Markdown 文件路径 | 控制台 |
| `--json` | 连同 JSON 输出（`<out 去后缀>.json`） | 关 |
| `--csv` | 连同 CSV 输出（`<out 去后缀>.csv`，带 BOM 便于 Excel） | 关 |
| `--state` | 状态文件路径（记录已见 docId，用于监控只出新公告） | 关 |
| `--all` | 配合 `--state` 仍输出全部（默认仅输出新公告） | 关 |
| `--delay` | 请求前延迟毫秒（限流防护，0=关闭）；被限流会自动提升 | 350 |
| `--retries` | 429/5xx 重试次数 | 6 |
| `-q, --quiet` | 只输出结果 | 关 |

城市全集：省级 广州 韶关 深圳 珠海 汕头 佛山 江门 湛江 茂名 肇庆 惠州 梅州 汕尾 河源 阳江 清远 东莞 中山 潮州 揭阳 云浮

## 跨省模式（省级公共资源交易中心）

粤公平**只覆盖广东 21 市**，跨省必须用各省市自己的公共资源交易中心平台。本模式的思路与粤公平**完全一致**：零依赖 `node` 内置 `fetch` + 解析（JSON 或 HTML），不同之处是每个省的平台结构不同，所以做成**按省注册 adapter** 的框架。

> ⚠️ 实测提醒：全国聚合源 `ggzy.gov.cn` 的列表接口（`getTradList`）在本环境稳定 404（完整 cookie 链 + 浏览器头仍 404），**不可用**；必须逐省适配各自的省级平台。

> ⚠️ 传输层提醒（2026-08-12 实测）：本沙箱经代理 `127.0.0.1:7897` 访问部分省 HTTPS 时 **TLS 握手失败**（`curl` 报 `schannel: failed to receive handshake`，Python/OpenSSL 报 `WinError 10053`/`WRONG_VERSION_NUMBER`；直连报 `getaddrinfo failed` 即无直连外网）。这类省**绝非"跑不通"**——改走 **HTTP** 后多可达（河北→502、广西→404 表示代理已抵达源站）。若某省标准 EPoint 路径在 HTTPS 下 HTTP 0 / TLS 失败，记为「待他网环境复测」，不要判失败；另注意河南类站点 `linkurl` 恒空（文件索引级），须 `allowNoUrl` 放行并诚实留空详情链接，禁止伪造。

**已支持省份（31 个，均端到端实测返回真实记录 · 2026-08-13~14 bespoke 批次后）**：详见 `reference/` 下每省一页。

> ⚠️ **每个官方招投标网站结构不同**（列表路径/参数/翻页/厚字段位置各异）。本采集器按省/市注册 adapter；**具体每省如何正确获取完整信息，见 `reference/<adapter>.md`**；要新增网站，先 `Read reference/NEW_PROVINCE_TEMPLATE.md` 按步骤逆向，再回填本指针表。adapter 逻辑以 `scripts/province-collect.cjs` 为准，reference 是文档沉淀，改 adapter 必须同步改省页。

| adapter | 省份/平台 | 类型族 | reference |
|---|---|---|---|
| guangdong | 广东(21市) | ygp 独立 API | [guangdong.md](reference/guangdong.md) |
| hunan | 湖南 | bespoke+详情接口 | [hunan.md](reference/hunan.md) |
| jiangsu | 江苏 | epoint | [jiangsu.md](reference/jiangsu.md) |
| zhejiang | 浙江 | epoint | [zhejiang.md](reference/zhejiang.md) |
| hainan | 海南 | epoint | [hainan.md](reference/hainan.md) |
| sichuan | 四川 | epoint | [sichuan.md](reference/sichuan.md) |
| xinjiangbt | 新疆兵团 | epoint | [xinjiangbt.md](reference/xinjiangbt.md) |
| heilongjiang | 黑龙江 | epoint | [heilongjiang.md](reference/heilongjiang.md) |
| henan | 河南 | epoint | [henan.md](reference/henan.md) |
| shandong | 山东 | html | [shandong.md](reference/shandong.md) |
| anhui | 安徽 | html | [anhui.md](reference/anhui.md) |
| xizang | 西藏 | html | [xizang.md](reference/xizang.md) |
| guangxi | 广西 | html | [guangxi.md](reference/guangxi.md) |
| beijing | 北京 | html | [beijing.md](reference/beijing.md) |
| shanxi | 山西 | html | [shanxi.md](reference/shanxi.md) |
| hebei | 河北 | html | [hebei.md](reference/hebei.md) |
| shanghai | 上海 | html | [shanghai.md](reference/shanghai.md) |
| shaanxi | 陕西 | sntba | [shaanxi.md](reference/shaanxi.md) |
| ningxia | 宁夏 | epointX | [ningxia.md](reference/ningxia.md) |
| xinjiang | 新疆本级 | epointX | [xinjiang.md](reference/xinjiang.md) |
| jiangxi | 江西 | epointX | [jiangxi.md](reference/jiangxi.md) |
| qinghai | 青海 | epointX | [qinghai.md](reference/qinghai.md) |
| gansu | 甘肃(兰州) | gs | [gansu.md](reference/gansu.md) |
| guizhou | 贵州 | bespoke REST | [guizhou.md](reference/guizhou.md) |
| yunnan | 云南 | bespoke REST | [yunnan.md](reference/yunnan.md) |
| hubei | 湖北 | bespoke REST | [hubei.md](reference/hubei.md) |
| jilin | 吉林 | trs | [jilin.md](reference/jilin.md) |
| fujian | 福建 | bespoke REST | [fujian.md](reference/fujian.md) |
| tianjin | 天津 | bespoke POST | [tianjin.md](reference/tianjin.md) |
| neimenggu | 内蒙古 | trs | [neimenggu.md](reference/neimenggu.md) |
| liaoning | 辽宁 | trs | [liaoning.md](reference/liaoning.md) |
| chongqing | 重庆 | 特殊/ENV_LIMIT | [chongqing.md](reference/chongqing.md) |

> 类型族共通打法见 [`reference/FAMILY_INDEX.md`](reference/FAMILY_INDEX.md)；加省脚手架见 [`reference/NEW_PROVINCE_TEMPLATE.md`](reference/NEW_PROVINCE_TEMPLATE.md)。诚实未 verified：重庆(Cloudflare 521·沙箱代理出口被拦，公开网络可直连，待他网复测)。

```bash
# 山东：管网类公告，近 30 天，带 CSV
node scripts/province-collect.cjs -p shandong -k "管网" -d 30 --delay 500 --out shandong-管网.md --csv

# 城市/区县筛选：客户端按平台地区字段、标题和提取地点匹配；逗号表示 OR
node scripts/province-collect.cjs -p 海南 -c "海口,文昌" -k 管网 -d 30 --detail --out out/hainan-city.xlsx

# 河南：管网文件索引（近 4000 天，列表层，详情链接诚实留空）
node scripts/province-collect.cjs -p 河南 -k 管网 -d 4000 --no-detail --limit 60 --delay 500 --out henan-管网.md

# 未知省会报错并列出已支持省份（示例：西藏尚未适配）
node scripts/province-collect.cjs -p 西藏 -k 管网
# => 未知省份: 西藏 | 支持: shandong,jiangsu,zhejiang,hainan,anhui,sichuan,xinjiangbt,heilongjiang,guangdong,henan
```

### 跨省模式参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `-p, --province` | 省份 adapter 名（见下方"已支持省份"） | 必填 |
| `-c, --city` | 城市/区县，逗号分隔（OR）；`全省` 或留空为不过滤。按平台地区、标题和提取地点客户端匹配 | 全省 |
| `-k, --keyword` | 关键词（标题包含即保留；留空=不限，按时间窗口抓全量） | 空 |
| `-d, --days` | 近 N 天（按公告日期倒序截断，遇早于 cutoff 的即停止翻页） | 30 |
| `--limit` | 最多返回条数（达到即停，省去翻完所有历史页） | 0（不限制） |
| `--delay` | 请求前延迟毫秒（限流防护） | 500 |
| `-o, --out` | 输出 Markdown 路径（不给则打印到控制台） | 控制台 |
| `--csv` | 连同 CSV 输出（`<out 去后缀>.csv`，带 BOM） | 关 |
| `--xlsx-layout` | `full29` 保留完整字段；`biaobiaotong16` 严格输出标标通 16 列、4 个分类 sheet | `full29` |

### 翻页与去重保护（已内置）

- 按 adapter 的 `listUrl(page)` 翻页；日期早于 cutoff **或** 达到 `--limit` **或** 连续 2 页无新链接（翻页回环防护）**或** 超过 200 页上限，任一触发即停止。
- 按公告 URL 去重，避免重复入库。
- `--city` 不依赖各省不一致的服务端参数：对已获取记录的地区提示、标题和提取地点做 OR 匹配；无法确认城市归属时不伪造城市名。
- 与粤公平共用：礼貌延迟 + 指数退避 + 429 重试（`requestWithRetry`）。

### 城市/区县筛选实测样本（2026-08-15）

这不是各省完整城市目录；仅记录真实页面验证过的匹配样本，后续可按同一 `-c` 机制继续扩展：

| 省份 | 命令中的筛选词 | 实际返回地区 | 平台类型 |
|---|---|---|---|
| 江苏 | `徐州` | 徐州市（2/2） | EPoint |
| 天津 | `滨海` | 滨海新区（1/1） | JEECMS POST |
| 贵州 | `仁怀` | 仁怀市（1/1） | REST |

### 如何新增一个省份 adapter（核心扩展点）

每个省只需在 `scripts/province-collect.cjs` 的 `ADAPTERS` 里加一项，框架自动复用翻页/过滤/去重/输出：

```js
const ADAPTERS = {
  shandong: { /* 见文件 */ },
  henan: {  // ← 新增省：只需填这三项
    name: "河南省公共资源交易中心",
    // 1) 列表 URL 模板（page 为页码，路径/参数因省而异）
    listUrl: (page) => `https://.../list?pageNo=${page}`,
    // 2) 解析：从 HTML 提取 {url, title, date}
    //    推荐按 <li> 块解析（每个列表项同时含详情链接与日期），标题 strip 标签后用关键词过滤
    parse(html) {
      const items = [];
      const liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi; let li;
      while ((li = liRe.exec(html))) {
        const block = li[1];
        const am = block.match(/<a[^>]+href=["'](https?:\/\/[^"']+\.jhtml)["'][^>]*>([\s\S]*?)<\/a>/i);
        if (!am) continue;
        const title = am[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (title.length < 4) continue;
        const dm = block.match(/(\d{4}-\d{2}-\d{2})/);
        items.push({ url: am[1], title, date: dm ? dm[1] : "" });
      }
      return items;
    },
  },
};
```

**适配某省的标准步骤（调研优先，禁止拍脑袋）：**
1. 找到该省平台"建设工程/交易公开"栏目列表页（首页找入口，或搜 `<省名> 公共资源交易中心`）。
2. 用 `node -e` 抓列表页，确认是否服务端渲染含公告 `<a href=...jhtml>` 链接；若是 SPA，则要找它的 JSON 接口（逆向 XHR/内联脚本），按粤公平方式解析 JSON。
3. 确认翻页机制：GET 参数（`pageNo`）还是路径分页（`queryContent_2-xxx.jspx`）还是 POST 表单——山东就是路径分页的坑，GET `pageNo` 会一直返回第 1 页。
4. 确认日期位置：多数在 `</a>` 之后（如 `<div class="list-times">2026-08-09</div>`），少数在链接前；按 `<li>` 块解析最稳。
5. 跑通后把 adapter 固化进文件，并回写本 SKILL.md 的"已支持省份"。

## 监控模式（推荐日常用法）

`--state <文件>` 让采集器记住"已见过的公告"（按 docId）。每次运行：

- 默认**只输出本次新出现的公告**（不在状态文件里的）
- 运行结束后自动把本次 docId 合并写回状态文件
- 加 `--all` 可忽略状态、输出全部（状态仍更新）

典型定时监控：每天 `node ... -k "管网" -c 珠海 -d 7 --state ~/bid-state.json -o today.md`，
第二天重跑即可拿到"今日新增"。配合 crontab / 飞书定时任务即可做自动预警。

## ⚠️ 限流须知（重要）

粤公平对高频访问返回 **HTTP 429**。本采集器内置四重防护：

1. **请求前礼貌延迟**（`--delay`，默认 350ms）
2. **429/5xx 指数退避重试**（默认 6 次，最长累计约 30s）
3. **尊重 `Retry-After` 头**：服务端返回重试秒数时按它等待（不再硬退避）
4. **自适应降速**：一旦触发 429，自动把后续请求间隔提升到该等待值（上限 60s），降低连续被封概率
5. **数据不完整显式标记**：某组合重试耗尽仍失败 → 报告内标注 `⚠️ 数据不完整` 并以 **退出码 2** 告警，**绝不静默当 0 条**

实测经验：
- **单城市 / 少量关键词**：默认参数即可，约 1-2s 完成。
- **全省扫描（21 地市 × 多类别）**：建议 `--delay 500~600`，约 30-60s 完成，**全量无丢失**。
- **切勿在极短时间内连续跑多次重负载**：限流器有"余温"，第二次会被 429 打满。若得到退出码 2，请等待 30-60s 冷却后重跑，或改用分城市串行运行。监控模式每次跑量小，基本不会触发。

## 字段说明（输出 JSON/CSV 每条）

**实际输出字段（以代码为准）**：CSV 保留 36 个采集与溯源字段；XLSX 默认 `full29`，也可用 `--xlsx-layout biaobiaotong16` 输出与参考工作簿完全一致的 16 列顺序和 4 个分类 sheet（房建市政/水利/公路/其他项目）。兼容版字段为：序号/项目地点/开标时间/项目名称/资金来源/工期/资质要求/业绩要求/控制价万元/保证金万元/评标办法/联合体/满分标准/链接/招标文件/备注。

> `biaobiaotong16` 用于 A 阶段招标公告对标；B 阶段的中标人、中标价、得分、排名、合同金额等扩展字段只在默认 `full29` 和 CSV 中保留。

- **厚字段（owner/控制价/代理/项目编号/开标时间/资质/工期/评标办法/资金来源等）仅在「接口返回这些字段」时非空**:粤公平(ygp) 100% JSON 自带;跨省模式加 `--detail` 触发详情抓取——标准 epoint 族(江苏/浙江/海南/四川/兵团)与湖南(`hn`)经 `--detail` 即拿全厚字段(实测 20/20 命中 owner/控制价/开标/资质/docLink);HTML 族部分省份详情页为 SPA 或需 http,效果因站而异(见各 `reference/<省>.md`);河南为文件索引无详情链接(仅列表层);黑龙江 legacy 端点索引陈旧(最新 2025-07)近期公告需重探站点当前后端。其余拿不到的字段诚实留空（非伪造）。
- `owner` = 业主/采购单位（粤公平及已逆向详情接口的省份如湖南可拿全；纯列表层省份为空）
- `stage`/`type` = 环节（招标公告、中标候选人公示、中标结果…）；湖南用 `noticeType` 精确映射
- `projectCode` = 项目编号（CSV 已含此列；湖南经 `getBySectionId` 拿到）
- `docId` = 去重主键

## 不适用 / 已知限制

- **详情正文与招标文件下载链接：暂不支持。** 列表接口不返回公告正文，且详情 API（`trading-notice/v2/detail`）所需的"交易环节码（tradingProcess）"是 SPA 内部码，列表 API 不暴露，必须经浏览器渲染详情页才能拿到。本采集器保持零依赖、纯列表采集。**如需正文/附件，需额外加一个 Playwright 渲染详情页的步骤**（可作为后续增强，但会引入浏览器依赖）。
- 服务端 `publishStartTime/endTime` 不真过滤，时间窗口由客户端按发布日倒序截断实现（已验证）。
- 粤公平模式仅覆盖广东省（粤公平 21 市）。跨省请用 `province-collect.cjs` 的省级模式（已支持山东，其他省按 adapter 注册表扩展）。
- 跨省模式同样**不支持详情正文与招标文件下载链接**（同粤公平的零依赖纯列表限制）。

## 端到端采集纪律与工具能力（2026-08-13 加固 R1-R4 + R6）

**核心纪律**：只采公开数据，绝不绕过 CA/验证码/WAF；空字段/空 linkurl 强制留空，绝不伪造详情链接。

### 新增 CLI 能力
```bash
# 1) 端点自动探测（R2）：自动试 cnum 001-004 + TPBidder/EpointWebBuilder 子上下文 + http 兜底
#    诚实分类：HIT（可建 adapter）/ AUTH_WALL（登录墙）/ ENV_LIMIT（本环境 TLS 受限）/ NO_EPOINT（定制 SPA）
node scripts/province-collect.cjs -p 新疆 --probe        # 单省探测，自动落盘 test-logs/probe-<省>.md
node scripts/province-collect.cjs --probe-all            # 21 省批量取证，逐省落盘证据 + 汇总表

# 2) verified 门禁（R3）：端到端实测返回真实「标题+日期」记录才 PASS，否则拒绝标 verified
node scripts/province-collect.cjs -p 河南 -k 管网 -d 4000 --verify   # PASS 须 realRecords>0 且 url 无坍缩

# 3) 常规采集（已 verified 省）
node scripts/province-collect.cjs -p 浙江 -k 管网 -d 365 --no-detail --limit 60 --delay 500
```

### 传输层（R1）
`httpFetch`：Node fetch 为主，遇 TLS/连接失败自动改 curl 子进程兜底；**200 但空 body**（代理对部分主机返回空体，curl 才能拿到真 JSON，如新疆）也会自动重试 curl。**绝不抛错**，失败返回带 `klass` 分类（`tls`/`conn`/`dns`/`timeout`）的结构化结果，上层据此诚实判"环境限制"而非"跑不通"。`robustFetch` 在 https 传输失败时自动重试 `http://` 同路径，捕捉"仅 https 握手失败但 http 可达"的站点（如河北/广西）。

### 诚实规则（R4）
`epointList` 中 `url: (r.linkurl && toAbs(r.linkurl, ad.base) !== ad.base) ? toAbs(...) : ""` —— linkurl 解析后若坍缩成站点根自身，强制留空，杜绝"全量记录 url 等于同一 base"的去重坍缩（河南曾因此 74 条被并成 1 条）。`allowNoUrl` adapter 选项放行"无详情链接但标题真实"的记录（如河南文件索引），详情列诚实空 `[详情]()`，不伪造。

### 新增省份的标准步骤（先探测、再建 adapter、再过门禁）
1. `node ... --probe -p <省>` 看结论。HIT → 进第 2 步；AUTH_WALL/ENV_LIMIT/NO_EPOINT → 记证据、诚实未 verified、转下一省（**严禁臆断跑不通**）。
2. 在 `ADAPTERS` 加 adapter（填 `base`/`referer`/`cnum`/`sortField`/`allowNoUrl` 等），并在 `PROBE_TARGETS` 留观测锚点。
3. `node ... --verify -p <省> -k 管网 -d <天数>` 必须 PASS（真实记录 >0、无坍缩）才算 verified。
4. 证据自动化（R6）：`--probe`/`--probe-all` 自动把每省结论落盘 `test-logs/probe-<省>.md` 并汇总 `test-logs/probe-summary.md`，无需手工补文档。

## 省平台架构分类与攻坚策略（2026-08-12 全 31 省实测总结）

`province-collect.cjs` 的 EPoint 适配器只在**公开可取的 EPoint/同源框架**省能直接用。其余省按以下分类攻坚，避免误判"跑不通"：

| 分类 | 判别信号 | 代表省 | 攻坚策略 |
|---|---|---|---|
| ✅ 公开可取 | 标准 `getFullTextDataNew` 返回 JSON `records[]`（cnum 001-004 变体命中） | 山东/江苏/浙江/海南/安徽/四川/兵团/黑/粤/豫(共10) | 直接建 adapter |
| 🔒 登录墙 | 路径正确但返回 `{"status":{"code":401,"text":"未登录，请登录"}}` 或需授权头/验证码 | 青海(TPBidder 授权头缺失)/江西(dzjy→WAF403)；新疆**标准** `EpointWebBuilder` 路径 401，但 `/inteligentsearchnew/` 匿名可用（已 HIT） | 需 CA/会话/授权头/GUID，非公开范围，诚实记未 verified |
| 🟡 定制 SPA | 标准路径 405，GET 返回 SPA 首页 HTML；或 404 但首页有 `/f/new/list-{hash}`、`/jyxx/xxxDetail?guid=` 等自定义结构 | 上海/辽宁（北京/天津/山西/河北/福建/云南/湖南/湖北/重庆已 2026-08-13 bespoke 为 HIT；宁夏/新疆本级为 `epointX` HIT；陕西为 `sntba` HIT；西藏为 HTML 渲染 HIT） | 必须逐站逆向其真实列表/详情接口（bespoke 工程） |
| ⚠️ 环境不可测 | 经代理 HTTPS 握手失败（`schannel failed to receive handshake` / `HTTP 0`），http 可达但 502；直连=`getaddrinfo failed`（沙箱无外网）；Cloudflare 521=代理出口被 WAF 拦 | 重庆(Cloudflare 521 代理出口，公开网络可直连命中) | 沙箱代理 TLS/WAF 限制，非站点问题；待能直连/代理兼容的网络复测 |
| 🔐 授权墙(AUTH_WALL) | 公开列表接口 HTTP 可达、返回合法 JSON 结构，但**对所有查询恒返空 `data:[]`**；其鉴权引导脚本明确返回"未授权"，程序化客户端无法建立授权会话 | 本次 31 省探测**无最终落地的 AUTH_WALL 省**；内蒙古曾初判为此类（auth 网关 `getPublishResourceDealList` 恒返空），但正确端点 `searchPublishResource` 为 HIT——**多试一个端点再下"AUTH_WALL"结论** | 端点连通性正常、数据被授权层拦截时归此类；非"跑不通"、非 ENV_LIMIT；诚实不建 adapter |

**判别铁律**：
1. "200 但无 records" 一定要 curl 抓 body 体检：401 鉴权 JSON = 端点正确（只是墙）；nginx 404 HTML 伪 200 = 路径错。
2. TPBidder/EpointWebBuilder 系省，EPoint 接口在 `/TPBidder/inteligentsearch/...` 或 `/EpointWebBuilder/inteligentsearch/...` 子上下文，不在根路径。
3. 凡 `HTTP 0`/`schannel 失败` 一律归"待他网环境复测"，严禁判"跑不通"。
4. 公共服务门户 URL（如 sxbid.com.cn、jszbtb.com）≠ 交易端；确证需以交易端域名实测。
