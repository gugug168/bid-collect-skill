---
name: collect-bid-notices
description: 从中国大陆 31 个省级行政区及新疆生产建设兵团的官方公共资源交易/招投标平台采集招标公告、中标候选、中标结果和合同信息，输出可审计的 Markdown、XLSX 与 CSV；支持关键词、时间窗口、详情厚字段、阶段选择、城市筛选、限流退避、探测与验证。
---

# 招投标公告采集

## 结果契约

- 只采公开信息，不绕过 CA、验证码、登录墙或 WAF。
- 区分三种状态：`代码已适配`、`当前环境可达`、`本次现场验证通过`。不得把它们合并成“支持”。
- `未获取`、`源站未公开`、`当前网络受限`、`样本字段为空`是不同事实；不得写成数字 `0`。
- 每条结果保留官方详情链接。链接为空时诚实留空，不拼造 URL。
- 用户确认信息是否齐全；AI 负责按官方页面逐字段复核准确性。
- 默认阶段是 `zb` 招标公告；`candidate` / `result` / `contract` 继续作为公开能力，但仅对 adapter 已明确配置并有对应实证的阶段生效。本 PR 的全国状态总账与分层验收只覆盖 `zb`，不得据此宣称 B 阶段全国通过。

### 机器侧运行状态

有 `--out` 时，采集器会在同目录生成 `<输出文件名>.run-report.json`，不写入业务表。状态只使用以下口径：

- `VERIFIED_RECORD`：至少一条记录同时有标题、日期和官方详情链接。
- `CONNECTED_NO_RECENT_DATA`：本次窗口没有返回记录；空结果不等同于失败。
- `FAILED`：采集过程观测到程序错误，详见 sidecar 的 `errors`。
- 返回了记录但标题/日期/官方链接任一硬字段缺失，也记 `FAILED`，不得把它伪装成已验证记录。
- `UNVERIFIED`：尚未进行本省现场验证，由逐省 reference/验证记录维护。
- `BROWSER_REQUIRED`：静态方式确实不可用，需要人工浏览器路径；不得因本机偶尔可达而省略此标记。

sidecar 保存 `snapshot_at`、参数、来源、记录数量、状态和错误摘要；Excel/CSV 继续只放业务字段。

## 开始前

从 Skill 根目录运行离线门禁：

```powershell
node scripts/self-test.cjs
```

必须看到 `SELF_TEST … passed`（以 scripts/self-test.cjs 实际用例数为准）。失败时先修门禁，不开始批量联网。

选定省份后，读取 `reference/<adapter>.md`；城市入口口径见 `reference/CITY_ENTRY_INDEX.md`，招标公告实时快照见 `reference/ZB_LIVE_STATUS_2026-08-15.md`；新增省份读 `reference/NEW_PROVINCE_TEMPLATE.md`。

## 常用命令

```powershell
# 招标阶段；默认抓详情并生成 XLSX
node scripts/province-collect.cjs -p 浙江 -k 管网 -d 30 --limit 20 --out output/zhejiang.xlsx --csv

# 中标候选 / 中标结果 / 合同（仅运行该省已配置阶段）
node scripts/province-collect.cjs -p 海南 --stage candidate -k 管网 -d 120 --limit 20 --out output/hainan-candidate.xlsx --csv
node scripts/province-collect.cjs -p 海南 --stage result -k 管网 -d 120 --limit 20 --out output/hainan-result.xlsx --csv
node scripts/province-collect.cjs -p 海南 --stage contract -k 管网 -d 120 --limit 20 --out output/hainan-contract.xlsx --csv

# 仅列表层，减少详情请求
node scripts/province-collect.cjs -p 江苏 -k 管网 -d 30 --no-detail --limit 20 --out output/jiangsu.xlsx --csv

# 端点探测 / 真实记录门禁
node scripts/province-collect.cjs -p 新疆 --probe
node scripts/province-collect.cjs -p 浙江 -k 管网 -d 365 --verify
```

`-p` 接受 adapter 键或中文省名。代码内 `PROV_ALIAS` 覆盖全部 32 个 adapter；新疆兵团可写 `兵团` 或 `新疆兵团`。不传 `--stage` 等价于 `--stage zb`。

## 参数

| 参数 | 含义 | 默认 |
|---|---|---|
| `-p, --province` | adapter 键或中文省名 | 必填 |
| `-c, --city` | 城市/区县过滤（逗号 OR；简称/全称按地区、标题、提取地点客户端匹配，不依赖各省不一致的服务端参数） | 全省 |
| `-k, --keyword` | 标题关键词；空值表示不限 | 空 |
| `-d, --days` | 近 N 天 | 30 |
| `--stage` | `zb` / `candidate` / `result` / `contract`；具体支持范围以 adapter 的 `stages` 为准 | `zb` |
| `--limit` | 最多输出条数 | 0，不限制 |
| `--delay` | 请求间隔毫秒 | 500 |
| `--no-detail` | 关闭详情厚字段 | 默认开启详情 |
| `--attach` | 详情缺金额时尝试从公开附件补抽 | 关闭 |
| `--no-xlsx` | 不生成 XLSX | 默认生成 XLSX |
| `--xlsx-layout` | `biaobiaotong16`（严格对齐标标通参考工作簿的 16 列顺序，固定 4 sheet）；`full29` 仅为旧调用兼容 | `biaobiaotong16` |
| `--csv` | 同时生成 CSV | 关闭 |
| `-o, --out` | 输出 `.xlsx` 或 `.md` 路径 | 不写文件 |
| `--probe` | 探测单省端点并写证据 | 关闭 |
| `--probe-all` | 批量探测待探省份 | 关闭 |
| `--verify` | 要求真实标题与日期记录通过门禁 | 关闭 |

### 城市筛选实测样本（`-c`，2026-08-15/16）

| 省份 | 命令中的筛选词 | 实际返回地区 | 平台类型 |
|---|---|---|---|
| 江苏 | `盐城` | 盐城市（2/2） | EPoint |
| 天津 | `宝坻` | 天津市·宝坻区（2/2，列表层） | JEECMS POST |
| 贵州 | `仁怀` | 仁怀市（1/1） | REST |
| 浙江 | `嵊泗` | 嵊泗县（1/1） | EPoint |
| 山东 | `潍坊` | 潍坊（2/2） | HTML |
| 湖南 | `郴州` | 郴州市（1/1） | bespoke |
| 湖北 | `襄阳` | 襄阳市（1/1） | REST |
| 福建 | `漳州` | 漳州市（2/2） | REST |
| 四川 | `广汉` | 广汉市（2/2） | EPoint |

山东还实测了 `-c "济南,青岛" --limit 2` 的 OR 查询：返回济南与青岛各 1 条。
32 省逐省实测粒度、空窗口与受限省口径全量见 [`reference/CITY_ENTRY_INDEX.md`](reference/CITY_ENTRY_INDEX.md)（2026-08-16 更新；广东 429 冷却中留待复测）。


## 输出 schema

- XLSX schema 以 `scripts/province-collect.cjs` 的 `XLSX_HEADER` 为唯一真相源，当前 29 列，按房建市政、水利、公路、其他项目分 sheet。
- 公开业务表固定使用 `biaobiaotong16` 的 16 列；`full29`/CSV 仅为既有调用兼容，不作为本轮验收表。机器侧失败原因、来源、时间和数量只写 sidecar。
- XLSX 与 CSV 不是同一列集。预算 `budget` 与控制价 `controlPrice` 是两个事实，禁止合并。
- 输出层清理 `undefined`、`null`、`NaN` 和未渲染 `{{downloadurl}}`；合法数值 `0` 不会被当成缺失。

## 33 个 adapter 与家族（32 省级 + anyang 城市级范本）

代码内 `ADAPTERS` 是 adapter 清单真相源，当前 33 个键：

```text
beijing tianjin hebei shanxi neimenggu liaoning jilin heilongjiang
shanghai jiangsu zhejiang anhui fujian jiangxi shandong henan
hubei hunan guangdong guangxi hainan chongqing sichuan guizhou
yunnan xizang shaanxi gansu qinghai ningxia xinjiang xinjiangbt
anyang
```

`anyang` 为首个**城市级 adapter 范本**（安阳市公共资源交易中心，标准 EPoint 同构；`-p 安阳` 可用）。城市级接入不改变 32 省语义——总账与逐省 reference 以省级为准，anyang 单独计行。

家族包括 `epoint`、`epointX`、HTML SSR、TRS、粤公平 API 及各省 bespoke REST/POST。具体端点、阶段、限制与复采命令维护在每省 reference 和 `reference/FAMILY_INDEX.md`；城市入口口径见 [`reference/CITY_ENTRY_INDEX.md`](reference/CITY_ENTRY_INDEX.md)。

## 稳定性纪律

1. 单省、单阶段、有限样本先跑通，再扩大范围。
2. 429 时尊重 `Retry-After` 或服务端“请 N 秒后重试”，并提升全局请求间隔；不得快速重打。
3. 401/403、验证码、CA 或登录墙归 `auth`，停止；不得绕过。
4. DNS/TLS/连接/超时归 `net/env`，保留错误摘要和检查时间；不得记成 0 条。
5. HTTP 成功但解析不到预期结构归 `parse/site`，回到官方页面/前端脚本核实端点。
6. 现场复测输出写新目录，不覆盖历史 `test-logs/*_verify.csv`。
7. 每省至少抽一条官方页面，与 XLSX/CSV 逐字段比对；记录 `snapshot_at`、代码 commit/hash、来源 URL 和限制。

## 已知限制

- 官方平台结构和风控会变化；昨天验证通过不等于今天仍可达。
- 部分省只公开列表或详情字段；源页不存在的字段写“未获取/留空”，不臆造数值或链接。
- 上海等 SPA、广西加密附件、广东 429、陕西授权墙、山东特定网络出口等限制以当前 reference 和验证工作簿为准。
- 附件只处理公开可下载内容；扫描件无文本层时诚实留空。
- `--verify` 证明列表返回真实标题/日期，不自动证明所有厚字段齐全；厚字段仍需逐条回源复核。

## 修改与验收

修改 `province-collect.cjs` 或 `self-test.cjs` 时，同步：

```text
C:/Users/Administrator/.workbuddy/skills/collect-bid-notices/scripts/
E:/工程项目/_工具脚本/bid-collect/
```

然后执行：

```powershell
node --check scripts/province-collect.cjs
node scripts/self-test.cjs
```

两份文件 SHA-256 必须一致。`SKILL.md`、`reference/` 只在正式 Skill 树维护，不复制到工程项目镜像。
