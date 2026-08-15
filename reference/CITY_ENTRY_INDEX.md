# 32 省城市/区县入口索引（招标公告）

> 这是城市入口的边界说明，不是“所有城市都已实时验收”的承诺。所有 adapter 都接受 `-c/--city`；默认不筛选（全省）。除广东外，省级平台没有统一、可复用的城市代码表，因此统一采用官方返回字段、标题和项目地点的客户端匹配；未列为 `VERIFIED_SAMPLE` 的城市不宣称已现场验证。
>
> `snapshot_at`、条数和失败原因以每次输出旁的 `.run-report.json` 为准；本索引只描述入口机制与已知证据。

| adapter | 地区 | 官方入口模式 | 城市/区县入口 | 当前证据 |
|---|---|---|---|---|
| beijing | 北京 | 省级 SSR 列表/详情 | 客户端地区/标题匹配 | UNVERIFIED |
| tianjin | 天津 | 省级 JEECMS 接口 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：滨海新区 |
| hebei | 河北 | 省级 SSR 列表/详情 | 客户端地区/标题匹配 | UNVERIFIED |
| shanxi | 山西 | 省级列表 + PDF 正文 | 客户端地区/标题匹配 | UNVERIFIED |
| neimenggu | 内蒙古 | 省级 TRS JSON | 客户端地区/标题匹配 | UNVERIFIED |
| liaoning | 辽宁 | 省级 TRS JSON | 客户端地区/标题匹配 | UNVERIFIED |
| jilin | 吉林 | 省级 TRS JSONP | 客户端地区/标题匹配 | UNVERIFIED |
| heilongjiang | 黑龙江 | 省级 EPoint | 客户端地区/标题匹配 | UNVERIFIED |
| shanghai | 上海 | 省级 SSR 列表/详情 | 客户端地区/标题匹配 | UNVERIFIED |
| jiangsu | 江苏 | EPoint `zhuanzai`/地区字段 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：徐州市（2/2） |
| zhejiang | 浙江 | EPoint 地区字段 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：义乌市（1/1） |
| anhui | 安徽 | 列表 + AJAX 详情 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：合肥市（1/1） |
| fujian | 福建 | 官方 REST/SSR 壳页 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：闽侯县（1/1） |
| jiangxi | 江西 | 官方 EPointX | 客户端地区/标题匹配 | UNVERIFIED |
| shandong | 山东 | 省级 SSR 列表/详情 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：青岛（1/1） |
| henan | 河南 | 官方 EPoint 文件索引 | 仅客户端字段匹配；不补造详情 URL | `CONNECTED_NO_RECENT_DATA`（30/90/365 天） |
| hubei | 湖北 | 官方 REST | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：襄阳市、武汉（各1/1） |
| hunan | 湖南 | 官方 REST | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：郴州市（1/1） |
| guangdong | 广东 | 粤公平逐地市 API | 官方 `siteCode` 循环 21 地市；不使用省码 440000 | `FAILED`：官方 429 限流，待冷却后复测 |
| guangxi | 广西 | 官方 SSR（HTTP 入口） | 客户端地区/标题匹配 | UNVERIFIED |
| hainan | 海南 | EPoint 地区字段 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：海口/文昌命令已跑通 |
| chongqing | 重庆 | 官方 Nuxt SSR | 客户端地区/标题匹配 | UNVERIFIED |
| sichuan | 四川 | EPoint 地区字段 | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：大邑县（1/1） |
| guizhou | 贵州 | 官方 REST | 客户端地区/标题匹配 | `VERIFIED_SAMPLE`：仁怀市（1/1） |
| yunnan | 云南 | 官方 REST + guid 详情 | 客户端地区/标题匹配 | UNVERIFIED |
| xizang | 西藏 | 官方列表 + projectCode 详情 | 客户端地区/标题匹配 | UNVERIFIED |
| shaanxi | 陕西 | 官方搜索接口 | 客户端地区/标题匹配 | `CONNECTED_NO_RECENT_DATA`；既有登录墙证据仍有效 |
| gansu | 甘肃 | 官方 EPoint/门户双分支 | 客户端地区/标题匹配 | UNVERIFIED |
| qinghai | 青海 | 官方 EPointX | 客户端地区/标题匹配 | UNVERIFIED |
| ningxia | 宁夏 | 官方 EPointX | 客户端地区/标题匹配 | UNVERIFIED |
| xinjiang | 新疆 | 官方 EPointX | 客户端地区/标题匹配 | UNVERIFIED |
| xinjiangbt | 新疆兵团 | 官方 EPoint | 客户端地区/标题匹配 | `CONNECTED_NO_RECENT_DATA`（30/90/365 天） |

## 入口规则

1. `-c` 是客户端 OR 匹配，支持简称、全称、逗号和顿号；匹配候选依次来自官方列表地区字段、标题和已提取项目地点。
2. 空地区不会被补写成城市；筛选未命中时只排除该条记录，不推断“该城市没有公告”。
3. 广东是唯一在 adapter 中维护官方城市代码的省份，当前代码表为 21 个 `siteCode`；任何城市循环失败都必须落入 sidecar 的 `FAILED`，不能降级为“无数据”。
4. 区县只有在官方返回字段或标题真实出现时才算可覆盖；本索引不自行创建区县代码。
