# 甘肃省采集参考

> adapter：`gansu` · kind=`gs` · 验证状态：**✅ VERIFIED_RECORD** · 当前入口：兰州市公共资源交易门户 · 最后验证：2026-08-21（A2 project18 clean evidence）

## 机制

官方入口：[兰州市公共资源交易中心](https://lzggzyjy.lanzhou.gov.cn)。`gsDetail` 支持 SSR `/xqfzx/014001/` 与 mustache `/jygk/002001/` 双分支。平台部分地区只返回 `620101`，现统一输出人读地区；官方文件入口返回 HTML 下载壳时不冒充可解析附件。

## A2 project18 结论

管网3条及供热监理1条均为干净代码真实公告。17字段终态为 VL=3、VD=8、ND=2、R=4，无 `FIELD_UNVERIFIED`。样本未披露可用建设规模和独立企业业绩；控制价、保证金、评标办法和满分位于 HTML 文件壳之后，按受限收口。`docLink` 保留官方入口，附件失败只写 sidecar，不降低公告状态。

机器证据：`reference/evidence/a2-structured-project18-20260821.json`。

## 可重复采集命令

```powershell
node scripts/province-collect.cjs -p gansu -k 管网 -d 30 --stage zb --limit 3 --xlsx-layout project18 --attach --csv -o out/gansu.xlsx
```

该 adapter 不是甘肃所有地市完整性的证明；只对当前官方入口和样本作字段结论。
