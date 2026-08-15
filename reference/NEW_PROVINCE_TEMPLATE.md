# 新增一个招投标网站 adapter · 脚手架（NEW_PROVINCE_TEMPLATE）

> 用途：每当要支持一个新的官方招投标网站（省级平台 / 独立市级平台），照本模板的**探测步骤**逆向，把 adapter 固化进 `scripts/province-collect.cjs`，再回填 SKILL.md 指针表 + 新建 `reference/<key>.md`。
> 组织单元是「网站」：省级平台一页；独立市级站（结构不同于省站）可单页；同一网站内多市循环（如广东 21 市）写在对应省页内，不单列。

## 标准步骤（调研优先，禁止拍脑袋）

1. **找列表页**：首页找"建设工程 / 交易公开 / 招标公告"栏目入口，或搜 `<省名/市名> 公共资源交易中心`。确认是 SSR 还是 SPA。
2. **抓页面判断结构**：
   - SSR（HTML 含 `<a href=...jhtml>`）：用 `<li>`/`<tr>` 块正则取标题+日期+链接，零鉴权，客户端过滤。
   - SPA（HTML 薄、数据走 XHR）：抓 `app.<hash>.js` 逆向 `tradeApi`/`rest`/`search` 等真实 JSON 接口路径与参数（**别盲试 `/detail`，先搜 bundle 找真实端点**，湖南即此坑）。
3. **确认翻页机制**：GET 参数 `pageNo` / 路径分页 `queryContent_2.jspx` / POST 表单 / EPoint `current/rows` / TRS `perpage`。注意山东式路径分页坑（GET pageNo 恒第1页）。
4. **确认关键词检索**：服务端（EPoint cnum / neimenggu noticeName / guizhou args）还是客户端（blind，拉全量后过滤）。服务端失效就 `clientFilterOnly:true`。
5. **厚字段（业主/控制价/资质等）**：列表层多为空，**逆向该站结构化详情接口**（如湖南 `getBySectionId`+`getNoticeInfo`），`--detail` 触发；详情抓不到就诚实留空，绝不伪造。
6. **环境约束**：本沙箱经代理 `127.0.0.1:7897`；部分省 HTTPS TLS 握手失败 → 改 **HTTP** 兜底（广西/贵州/陕西已验证）。`AUTH_WALL` **绝凭单一死端点下结论**（甘肃/青海/内蒙古均因多试端点翻案）。
7. **verify 门禁**：端到端实测返回真实「标题+日期」记录才标 `verified=true`；`code:200` 但空 `data:[]` 不算。

## 代码骨架（加到 ADAPTERS）

```js
const ADAPTERS = {
  // ...已有省...
  newprov: {
    name: "新省份公共资源交易中心",
    verified: true,            // 第7步实测通过才 true
    kind: "epoint",             // epoint / epointX / gs / trs / html / hn / gz / yn / hb / jl / fj / tj / nmg / ln / cq / ygp / sntba / 自定义
    base: "https://xxx.gov.cn", // https 本环境 TLS 失败则记注释并改 http
    // 列表接口（按 kind 选对应 *List 函数；自定义 kind 需新增 list 函数）
    listUrl: (page) => `https://xxx.gov.cn/list?pageNo=${page}`,
    // 解析：从 HTML/JSON 提取 {url, title, date}
    // 关键词不支持服务端检索时加 clientFilterOnly: true
    // 列表无详情直链时加 allowNoUrl: true（诚实留空，禁伪造）
  },
};
```

自定义 kind 还需在文件底部 `module.exports` 的 list 函数映射里加一项，并新增 `newprovList(ad, page, args)` 函数（参照 `hnList`/`gsList` 写法）。

## 回填清单（改完必须同步，防代码/文档脱节）

1. SKILL.md 指针表加一行：`| newprov | 新省份 | 类型族 | [newprov.md](reference/newprov.md) |`。
2. 新建 `reference/newprov.md`（复制本模板下方骨架，填实测域名/接口/参数/坑点/厚字段覆盖/样例命令）。
3. 若归属某新家族，更新 `reference/FAMILY_INDEX.md`。
4. **纪律（铁律）**：日后若改 `ADAPTERS[newprov]`（base/接口/参数/厚字段逻辑），**必须同步改 `reference/newprov.md`**，否则文档与代码脱节，下个人照文档跑会错。

## reference/<key>.md 页面骨架

```markdown
# <平台全称> · 招标采集 adapter

- adapter 名：`<key>`
- 平台根：<base>（base 以 scripts/province-collect.cjs 的 ADAPTERS[<key>].base 为准）
- 类型族：<epoint / epointX / trs / html / bespoke / 特殊>
- 实测日期：YYYY-MM-DD
- 状态：verified / ENV_LIMIT / AUTH_WALL(诚实未建)

## 列表接口
- <方法+URL+参数>
- 翻页：<机制>
- 关键词检索：<服务端 / 客户端>

## 详情接口
- <方法+URL → 返回字段> / 无（列表层已含，厚字段诚实留空）

## 坑点 / 注意事项
- <WAF/反爬/字段为空/需 http 兜底 ...>

## 厚字段覆盖率
- 能拿：<owner / controlPrice / ...>
- 诚实留空：<budget / bond / docLink，因公告正文不公开，绝不伪造>

## 样例命令
node scripts/province-collect.cjs -p <key> -k 管网 -d 365 --detail --csv --out <key>-管网.md
```
