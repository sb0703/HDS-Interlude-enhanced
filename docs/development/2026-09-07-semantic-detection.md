# 时间与事件语义审核重写

本记录说明第一阶段的时间/期限判断、用户报告时间解释、剧情推进/重复判断。后续独立时间复核、旧规则清理和恢复隔离见 [恢复边界说明](2026-09-08-review-boundary-cleanup.md)。

## 实时数据流

1. 主叙事接收完整用户原话、接收时间、故事时区及历史上下文。`temporalEvidence` 不用词表预判哪些表达是时间，也不预先猜测日期。
2. 独立审核在现有一次审核调用中解释时间含义，比较历史事件、计划和正文；没有为三个检测维度各增加一个模型调用。
3. 实时审核必须返回 `checks` 中的 `time` 和 `progression` 两项结论，以及 `reportedTimes`。缺少结构时沿用一次格式修复，仍不可用则不提交剧情。
4. `reportedTimes` 只提取当前用户原话中的时间，不把候选正文或旧历史混入用户陈述。程序校验原文引用、日期合法性和歧义结构，并根据合法时间计算 past/current/future；自然语言解释仍由模型负责。
5. 历史相似度只辅助选择证据，不再通过动作词、相似度阈值或固定分钟窗口判定“重复/推进”。最新历史结束状态与相似片段共同进入有限上下文。

## 边界

- 保留时间戳/时区、证据引用、结构、权限、真实投递和重试上限等程序约束。
- 不确定的日期、指代或时段保留为 ambiguous/uncertain，不强行制造精确时间。
- 时间与事件维度可能共享同一个矛盾，不要求模型把同一错误机械拆成多个类别。
- 关闭 consistencyReview 会跳过主叙事的独立语义审核，没有暗中回退到旧词表检测；远程记忆整理仍执行自己的写入审核。
- `extractUserReportedTimes`、`narrativeClockConflict`、`narrativeHasProgression` 旧辅助导出已移除。新入口为 `temporalEvidence`、`normalizeUserReportedTimes` 和只负责检索的 `rankNarrativeHistory`。
- 模型审核仍可能误判；结构检查验证可追溯性，不等于证明模型语义判断永远正确。

## 验证

- `test/semantic-detection.test.ts` 验证原话无词表过滤、证据引用、跨日合法时间、歧义、错误结构拒绝、检索不做语义裁决和审核适配器的格式修复。
- `deploy/server/koishi/smoke-semantic-detection.cjs` 使用完全虚构角色，实测改写期限、重复事件、否定句和英文相对时间。该脚本不读取数据库、不发送 Bot 消息。
- 运行前须设置 `HDS_ROOT` 为部署根目录。可通过 `HDS_PLUGIN_PATH` 测候选包，`HDS_CASES` 选择失败用例复验。`HDS_DEBUG=1` 仅用于查看脚本内虚构用例的模型文本返回。

现有历史污染与数据恢复是独立事项，本次代码升级不删除或重建任何历史记录。
