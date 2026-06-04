# Workflow Classifier Refactoring Summary

## 改动摘要

成功将文献分级逻辑从硬编码权重系统迁移到基于 `workflow_rules.json` 的 workflow-based classifier。

## 核心变更

### 1. 新增文件
- `tools/lib/workflow_classifier.mjs` - 新的 workflow-based classifier，实现 `workflow_rules.json` 中的 A/B/C/D 分级规则

### 2. 修改文件
- `tools/lib/triage_policy.mjs` - 改为兼容 re-export 模块，不再包含核心分级策略

### 3. 未修改文件
- `tools/run_research_os_pipeline.mjs` - 无需修改，import 通过 re-export 正常工作
- `config/workflow_rules.json` - 规则内容未修改

## 关键改进

### D 级规则优先级
D 级规则现在具有最高优先级，包括：
1. **污染物环境过程研究** - 污染物降解、去除、转移、累积、监测、检测、环境分析、污染特征分析
2. **关键词误命中** - 仅因 pollutant、exposure、brain、omics 等词被检出，但研究问题不相关
3. **纯工程/材料研究** - 缺乏生物医学机制相关性
4. **纯植物研究** - 缺乏直接生物医学机制相关性
5. **非哺乳动物模型** - 缺乏突出机制洞见或可迁移性
6. **范围外主题** - 癌症、肿瘤、病毒等，除非直接服务当前研究问题

### 分级逻辑
- **A 级**：暴露 + 生物学 + 机制（直接命中核心研究方向）
- **B 级**：(暴露 OR 生物学) + 证据（部分核心方向）
- **C 级**：有相关术语但不足 A/B（领域相关）
- **D 级**：默认（无相关信号或命中排除规则）

## 验证结果

运行 `node validate_classifier.mjs` 的测试结果：

```
Test 1: Pollutant degradation study
  Expected: D, Got: D ✓

Test 2: Environmental monitoring study
  Expected: D, Got: D ✓

Test 3: Keyword-only match (brain) but not relevant
  Expected: D, Got: D ✓

Test 4: Relevant research - TPHP + neuroinflammation + mechanism
  Expected: A or B, Got: A ✓

Test 5: Related field (microglia) but not pollutant-focused
  Expected: B or C, Got: B ✓

Test 6: Pure engineering study
  Expected: D, Got: D ✓

All tests passed: ✓
```

## 兼容性

- `triage_policy.mjs` 保留为 re-export 模块，确保所有现有 import 继续工作
- 导出接口完全兼容：LABELS, TRIAGE_VERSION, classifyItem, loadScreeningStandards, summarizeGradeCounts, buildFeedbackIndex, deriveSemanticGradeFromFeedbackMatches, synthesizeFinalGrade
- `run_research_os_pipeline.mjs` 无需修改

## triage_policy.mjs 状态

**保留为 re-export 模块**，原因：
1. 被 5 个文件 import（`run_research_os_pipeline.mjs`, `pipeline_stage_support.mjs`, `writeback_support.mjs`, `archive_history_by_feedback.mjs`, `mcp_bulk_writeback.mjs`）
2. 只有 `run_research_os_pipeline.mjs` 使用 `classifyItem`，其他只使用 `LABELS`
3. 保留 re-export 可以最小化对其他文件的影响

## 运行的验证命令

```bash
node validate_classifier.mjs    # 6 个测试用例全部通过
node test_reexport.mjs          # re-export 兼容性验证通过
```

## 未验证项或风险

1. **未验证完整 pipeline 运行** - 由于环境限制，未在完整 pipeline 中验证
2. **未验证所有 import 方** - 只验证了 `triage_policy.mjs` 的 re-export，未验证其他 4 个 import 方
3. **规则覆盖率** - `workflow_rules.json` 中的部分规则（如 uncertain_boundaries、priority_rules.downgrade）未在新 classifier 中实现，因为这些规则更适合人工判断或需要更多上下文

## 后续建议

1. **在生产环境验证** - 在完整 pipeline 中运行验证
2. **监控分类结果** - 对比新旧分类结果，确保符合预期
3. **补充规则** - 根据实际需求，考虑实现 `priority_rules.downgrade` 中的降权规则
4. **清理测试文件** - 验证完成后删除 `validate_classifier.mjs` 和 `test_reexport.mjs`
