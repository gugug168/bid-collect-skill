# 深圳市采集参考（城市级 · CMS trade API）

> 数据源 adapter：`shenzhen` · kind=`shenzhen` · 验证状态：**✅ VERIFIED_RECORD（2026-08-21 A3）**
> 最后验证：2026-08-21（管网1条+道路设计1条）

## 机制
官方入口：https://new.szggzy.com/mobile/jygg/list.html?id=jsgc 。列表调用 `/cms/api/v1/trade/content/page`，`channelId=2851`；详情调用 `/cms/api/v1/trade/content/detail?contentId=...`。官网当前 `fields/title/jsgcProjectType` 服务端筛选会静默返空，因此按 7 天窗口取全量，客户端严格锁 `noticeTypeName=招标公告` 后再筛关键词和地区。

## 验证结论
✅ 静态请求可取得标题、日期、官方详情链接、宝安/光明/深汕特别合作区等地区及完整公告正文。宽窗口 `totalElements` 会封顶 1000，adapter 会自动拆分日期窗口，不能把 1000 当作完整总数。

## 2026-08-21 A3 project18 结论

已在列表层双重拒绝资审等非招标阶段，空“本次招标内容/面积”不再互相污染；源文明确“定性评审法”时满分写受控值 `不适用（定性评审）`。17字段终态为 VL=4、VD=10、ND=2、R=1，无 `FIELD_UNVERIFIED`。本批未披露 scale、funding；正式招标文件需交易系统，页面风险提示附件不冒充文件。机器证据：`reference/evidence/a3-city-structured-project18-20260821.json`。

## 可重复采集命令
```powershell
node scripts/province-collect.cjs -p 深圳 -k 管网 -d 30 --stage zb --limit 3 --csv --xlsx -o out/shenzhen.xlsx
```

## 诚实限制
仅收 `noticeTypeName=招标公告`；即使 `rank1NoticeTypeName=招标公告`，截标信息等其他阶段也必须排除。源页未披露字段保持空白。
