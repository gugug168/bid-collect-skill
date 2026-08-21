# 招标公告实时状态总账（基线 2026-08-15；广东更新至 2026-08-19；A1/A2 更新至 2026-08-21）

> 本表只记录招标公告（`zb`）的实时窗口结果，不包含候选人/中标/合同阶段。每次采集的 sidecar 才是单次运行的机器真相；这里是便于人审和 PR 追踪的当前快照。
>
> 验收规则：先跑近 30 天，出现 1–3 条真实公告即停止扩大；空结果扩大到 90 天和 365 天。`CONNECTED_NO_RECENT_DATA` 只表示该次参数、关键词和窗口内没有记录，不等于官方平台历史上没有公告。

| adapter | 30 天状态 | 条数 | 90/365 天 | 主要证据 | 备注 |
|---|---|---:|---|---|---|
| beijing | `VERIFIED_RECORD` | 3 | — | `beijing.run-report.json` | 标题/日期/官方 URL 齐全 |
| tianjin | `VERIFIED_RECORD` | 3 | — | `tianjin.run-report.json` | 列表层真实公告 |
| hebei | `CONNECTED_NO_RECENT_DATA` | 0 | 90/365 仍 0 | `hebei.run-report.json`, `hebei-90d`, `hebei-365d` | 不升级为失败 |
| shanxi | `VERIFIED_RECORD` | 3 | — | `shanxi.run-report.json` | PDF/列表入口可达 |
| neimenggu | `VERIFIED_RECORD` | 3 | — | `neimenggu.run-report.json` | 官方 JSON 详情 |
| liaoning | `VERIFIED_RECORD` | 1 | — | `reference/evidence/a2-structured-project18-20260821.json` | 管网1+非管网1条干净复测；发布机构不再冒充地区 |
| jilin | `VERIFIED_RECORD` | 1 | — | `jilin.run-report.json` | 30 天仅 1 条，按规则停止 |
| heilongjiang | `CONNECTED_NO_RECENT_DATA` | 0 | 30/90/365天0；无关键词30天0 | `reference/evidence/b1-epoint-project18-20260822.json` | B1 四次请求成功、零错误限流；17字段以NO_SAMPLE收口 |
| shanghai | `VERIFIED_RECORD` | 3 | — | `shanghai.run-report.json` | DNS→curl 兜底后有记录 |
| jiangsu | `VERIFIED_RECORD` | 3 | — | `reference/evidence/b1-epoint-project18-20260822.json` | B1 管网3+非管网1；服务范围与业绩门槛修复 |
| zhejiang | `VERIFIED_RECORD` | 3 | — | `reference/evidence/b1-epoint-project18-20260822.json` | B1 PDF回源；零控制价、规模地点和scope尾噪声修复 |
| anhui | `VERIFIED_RECORD` | 3 | — | `reference/evidence/a2-structured-project18-20260821.json` | 管网3+非管网1条；保证金账户噪声已修复 |
| fujian | `VERIFIED_RECORD` | 3 | — | `reference/evidence/a2-structured-project18-20260821.json` | 官方签名详情API；管网3+学校1条干净复测 |
| jiangxi | `VERIFIED_RECORD` | 3 | — | `jiangxi.run-report.json` | TLS→curl 兜底 |
| shandong | `VERIFIED_RECORD` | 3 | — | `shandong.run-report.json` | 现网已返回真实记录 |
| henan | `VERIFIED_RECORD` | 1 | 管网30/90天0；365天深页TLS失败 | `reference/evidence/a2-structured-project18-20260821.json` | 无关键词复扫命中1条，不冒充管网样本；附件需验证码 |
| hubei | `VERIFIED_RECORD` | 3 | — | `hubei.run-report.json` | 武汉另有城市筛选证据 |
| hunan | `VERIFIED_RECORD` | 3 | — | `hunan.run-report.json` | 官方 REST |
| guangdong | `VERIFIED_RECORD` | 3 | 3 天广州3、珠海3 | `2026-08-19_project18实时验收/*.run-report.json` | `3C14` 纯招标；公开详情与附件链接；大文件/验证码单独记附件信号 |
| guangxi | `VERIFIED_RECORD` | 3 | — | `guangxi.run-report.json` | HTTP 官方入口 |
| hainan | `VERIFIED_RECORD` | 3 | — | `reference/evidence/b1-epoint-project18-20260822.json` | B1 管网3+河道疏浚1；附件验证码单列 |
| chongqing | `VERIFIED_RECORD` | 3 | — | `reference/evidence/a2-structured-project18-20260821.json` | 管网3+非管网1条；Nuxt SSR详情复测 |
| sichuan | `VERIFIED_RECORD` | 3 | — | `reference/evidence/b2-epoint-project18-20260822.json` | B2 管网3+储能EPC 1；未勾选业绩模板已清理 |
| guizhou | `VERIFIED_RECORD` | 3 | — | `guizhou.run-report.json` | 官方 REST |
| yunnan | `VERIFIED_RECORD` | 3 | — | `yunnan-detail-v3.run-report.json` | guid→官方详情 URL 修复后通过 |
| xizang | `VERIFIED_RECORD` | 3 | — | `reference/evidence/a2-structured-project18-20260821.json` | 管网3+非管网1条；projectCode详情复测 |
| shaanxi | `CONNECTED_NO_RECENT_DATA` | 0 | 90/365 仍 0 | `shaanxi-v2.run-report.json`, `shaanxi-90d`, `shaanxi-365d` | 既有登录墙证据仍保留 |
| gansu | `VERIFIED_RECORD` | 3 | — | `reference/evidence/a2-structured-project18-20260821.json` | 管网3+非管网1条；文件入口HTML壳单独记受限 |
| qinghai | `VERIFIED_RECORD` | 3 | — | `qinghai.run-report.json` | EPointX |
| ningxia | `VERIFIED_RECORD` | 3 | — | `reference/evidence/b2-epoint-project18-20260822.json` | B2 管网3+非管网1；标段划分与资金前缀已清理 |
| xinjiang | `VERIFIED_RECORD` | 3 | — | `xinjiang.run-report.json` | EPointX |
| xinjiangbt | `VERIFIED_RECORD` | 1 | 管网30/90/365天0 | `reference/evidence/b2-epoint-project18-20260822.json` | 无关键词官方公路招标1条，不冒充管网命中 |
| anyang | `VERIFIED_RECORD` | 1 | — | `reference/evidence/b1-epoint-project18-20260822.json` | B1 排除竞争性磋商等非招标采购，管网招标1条 |
| dingxi | `CONNECTED_NO_RECENT_DATA` | 0 | 365 仍 0 | `dingxi-365d.run-report.json` | 城市级（infodate 排序变体）：可达 total=4621 但源站 2023-04 后停更，非近期数据源 |
| changzhou | `VERIFIED_RECORD` | 3 | — | `reference/evidence/b1-epoint-project18-20260822.json` | B1 标题二次关键词过滤；附件补保证金 |
| luoyang | `VERIFIED_RECORD` | 2 | 30 天 2，停止扩大 | `reference/evidence/b2-epoint-project18-20260822.json` | B2 管网2+医院设计1；scope章节尾已清理 |
| zhengzhou | `VERIFIED_RECORD` | 3 | 30 天 3，停止扩大 | `reference/evidence/b2-epoint-project18-20260822.json` | B2 管网3+供配电1；资金尾部已清理 |
| mianyang | `VERIFIED_RECORD` | 3 | 30 天 3，停止扩大 | `p0-city-batch-release/mianyang.run-report.json` | 静态列表+关系接口；精确选择 `001001` 招标公告；附件验证码不绕过 |
| qinhuangdao | `VERIFIED_RECORD` | 3 | 30 天 3，停止扩大 | `p0-city-batch-release/qinhuangdao.run-report.json` | 静态近期页；排除资格预审/变更；深页验证码边界保留 |
| nantong | `VERIFIED_RECORD` | 3 | 30 天 3，停止扩大 | `p0-city-batch-release/nantong-v2.run-report.json` | EWB-FRONT；严格阶段三字段；剔除已作废并清理 `[新]` |
| nanjing | `VERIFIED_RECORD` | 2 | 30 天 2，停止扩大 | `reference/evidence/a3-city-structured-project18-20260821.json` | A3 管网2+非管网1；资质、业绩、满分和文件链接复核 |
| huizhou | `VERIFIED_RECORD` | 3 | 30 天 3，停止扩大 | `city-batch2-release/huizhou.run-report.json` | 官方广东政府 JSONP；8 栏目地区映射；过滤废止/过期 |
| zhongshan | `VERIFIED_RECORD` | 3 | 30/90 天 0，365 天 3 | `reference/evidence/a3-city-structured-project18-20260821.json` | A3 补全多专业资格；附件验证码留空 |
| jinan | `VERIFIED_RECORD` | 1 | 30 天 1，停止扩大 | `reference/evidence/a3-city-structured-project18-20260821.json` | A3 管网1+非管网1；精确工期、企业资质和业绩金额 |
| wuhan | `VERIFIED_RECORD` | 3 | 30 天 3，停止扩大 | `reference/evidence/a3-city-structured-project18-20260821.json` | A3 管网3+非管网1；结构化详情复测 |
| suzhou | `CONNECTED_NO_RECENT_DATA` | 0 | 30/90/365 天均 0 | `city-retest-01/batch-summary.json` | 接口成功；历史 VERIFIED 路由证据保留，当前窗口空不冒充有记录 |
| xuzhou | `VERIFIED_RECORD` | 3 | 30 天 0，90 天 3 | `reference/evidence/b2-epoint-project18-20260822.json` | B2 管网3+农村污水EPC 1；附件验证码单列 |
| yichang | `VERIFIED_RECORD` | 3 | — | `b2_yichang.run-report.json` | 城市级（EpointWebBuilder 变体）（V5 批次2 侦察接入） |
| linyi | `VERIFIED_RECORD` | 3 | — | `b2_linyi.run-report.json` | 城市级（EPoint 双层包装）（V5 批次2 侦察接入） |
| yantai | `VERIFIED_RECORD` | 2 | — | `city-semantic-retest-luna/batch-summary.json` | 锁 `003001003`/`003002002` 后复验；2/2 为招标/采购公告，无合同/中标结果 |
| hefei | `VERIFIED_RECORD` | 2 | — | `hefei-sol-30d-v2/hefei.run-report.json` | 锁 `002001001` + 合肥行政区守卫；排除铜陵/芜湖/广德等异地项目 |
| wenzhou | `VERIFIED_RECORD` | 1 | 30 天 0，90 天 1 | `wenzhou-sol-90d-v2/wenzhou.run-report.json` | 锁温州市主站 `col1229696276`；官方 CMS 列表 + PDF 详情；16 列回源复验 |
| ningbo | `VERIFIED_RECORD` | 1 | 30 天 1，停止扩大 | `reference/evidence/a3-city-structured-project18-20260821.json` | A3 管网1+非管网1；无工期时拒绝“施工期”误抽；附件HTTP 0单列 |
| jiaxing | `VERIFIED_RECORD` | 1 | 30 天 1，停止扩大 | `jiaxing-sol-30d-v2/jiaxing.run-report.json` | 锁建设工程 `col1229743509` 招标公告；JPaas 列表 + HTML 详情；16 列回源复验 |
| weifang | `VERIFIED_RECORD` | 3 | 30 天 0，90 天 3 | `city-expansion-sol/weifang-90-v3.run-report.json` | 锁 `007001001`；修复官方 `:8082` 详情端口保留；标题/日期/链接/地区齐全 |
| qingdao | `VERIFIED_RECORD` | 3 | 30 天 3，停止扩大 | `reference/evidence/a3-city-structured-project18-20260821.json` | A3 管网3+非管网1；范围尾数字与评审模板噪声已修复 |
| shenzhen | `VERIFIED_RECORD` | 1 | 30 天 1，停止扩大 | `reference/evidence/a3-city-structured-project18-20260821.json` | A3 管网1+非管网1；双重阶段守卫、空标签与定性满分闭环 |
| wuxi | `VERIFIED_RECORD` | 3 | — | `b2_wuxi.run-report.json` | 城市级（webBuilder AJAX）（V5 批次2 侦察接入） |
| quanzhou | `VERIFIED_RECORD` | 3 | — | `b2_quanzhou.run-report.json` | 城市级（Java .do·http）（V5 批次2 侦察接入） |
| yueyang | `VERIFIED_RECORD` | 2 | — | `b2_yueyang.run-report.json` | 城市级（静态 CMS·GBK）（V5 批次2 侦察接入） |
| zunyi | `VERIFIED_RECORD` | 3 | — | `city-semantic-retest-luna/batch-summary.json` | 只收 `announcement=交易公告`；3/3 无答疑、澄清或更正 |
| yibin | `FAILED` | 3 | — | `b2_yibin.run-report.json` | 城市级（筑龙 SPA）：3 条真实记录无详情直链，FAILED 系 allowNoUrl 诚实判定非采集失败（V5 批次2 侦察接入） |


## 汇总

- `VERIFIED_RECORD`：56 个（新疆兵团以无关键词官方招标公告样本转正，未冒充管网命中）
- `CONNECTED_NO_RECENT_DATA`：5 个（河北、黑龙江、陕西、定西、苏州）
- `FAILED`：1 个（宜宾 allowNoUrl 无直链形态）
- `BROWSER_REQUIRED`：本轮未新增；Chrome CDP 未连接，不能宣称浏览器路径可用。

外部完整人读报告与逐次 XLSX/CSV/sidecar 位于 GOAL evidence 目录；本表不复制业务数据，也不把空结果写成 0 条历史事实。
