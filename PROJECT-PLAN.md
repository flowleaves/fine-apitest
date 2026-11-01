# PROJECT-PLAN · fine-apitest

> 本文件定义项目阶段、范围与变更控制。设计完成后，默认进入**运行期**：只运行测试、写报告、浏览只读结果页；HTML 只做基础结构检查，视觉/审美评测交给用户。除非用户明确要求修改项目，否则不改代码、题目、判分或数据结构。

## 1. 目标

给 Agent 一个本地、零依赖、零构建的能力测试工具：

- 输入：站点名称、Base URL、API Key；
- 先列出可用模型，由用户选择后再测试（用户明确要求全量时才全量）；
- 执行三项固定测试；
- 归档原始响应与 HTML 产物；
- 生成可读报告与机器可读结果；
- HTML 只做基础结构检查，视觉/审美评测交给用户；
- 提供本地只读结果页：站点/分组、模型卡片、测试折叠、HTML 预览/全屏；
- 结果按「站点 / 分组 / 运行」归档，并写入根 `测试记录.md`。

## 2. 测试矩阵（设计冻结）

| # | ID | 名称 | 类型 | 请求数 | 判定 |
|---|---|---|---:|---:|---|
| 1 | `candy` | 糖果测试 | 文本推理 | 1 | 自动判分：correct / wrong / review |
| 2 | `fingerprint` | 模型指纹检测 | 数字分布 | 3 | 指纹库归因：predicted / insufficient / failed |
| 3 | `capybara-html` | 水豚 · 海滩骑行 HTML | HTML artifact | 1 | 结构硬检查；视觉评测交给用户 |

每个模型共 **5 个请求**（1 + 3 + 1）。默认先列出模型让用户选择；只有用户明确要求全量时才测试全部模型。

### 2.1 水豚 HTML 题目要求

题目原文见 `app/lib/tests/definitions.mjs` 的 `CAPYBARA_HTML_PROMPT`。核心要求：

- 戴太阳镜的水豚在海滩骑自行车，可爱、色彩丰富的 SVG 卡通风格，沙滩与海浪；
- 单文件，内联 SVG + CSS + 原版 JavaScript；
- 速度滑块 0.3×–3.0×，控制循环和方向盘旋转；
- 暂停/继续按钮；
- 左上角「星芽」艺术字；
- 响应式布局；
- 无外部依赖；
- 只返回完整 HTML；
- 实现简单，避免不必要的复杂性。

### 2.2 结构硬检查

- 完整 `<html>` / `<body>` / `</html>`；
- 内嵌 `<svg>`；
- 动画痕迹（CSS/SMIL/JS）；
- `<input type="range">` 且 min ≤ 0.3、max ≥ 3.0；
- 暂停/继续按钮；
- 「星芽」文本；
- vanilla `<script>`；
- 无外链资源；
- 未被 `max_tokens` 截断。

轻微警告：缺 viewport、未检测到事件绑定、体积偏小。警告不直接判失败；结构通过后由用户看预览并评测。

### 2.3 结果指标

- **首字**：`metrics.firstContentMs`，从请求发出到收到首个内容片段的耗时；多请求测试取有效样本平均值。
- **输出 token/s**：上游 `usage.output` ÷ 生成耗时；多请求测试按有效样本汇总。
- 两项指标在 `summary.md` 的测试表与本地只读结果页展示，原始值保留在 `run.json` 的 `metrics`。

## 3. 项目阶段

### 阶段 A · 设计期（已完成）

- 完成三项测试定义；
- 完成 CLI、判分、指纹、HTML 检查、报告、归档；
- 完成 Agent Skill、项目规范、README；
- 完成本地只读结果页（站点/分组、模型卡片、HTML 预览/全屏）；
- 完成单测与 mock e2e；
- 冻结数据契约与报告字段。

### 阶段 B · 运行期（默认）

Agent 只做：

1. 运行测试（未指定模型时先列模型让用户选）；
2. 写运行报告与 `测试记录.md`；
3. 把 HTML 结构与预览交给用户评测；
4. 启动只读结果页浏览结果；
5. 向用户汇报结果。

默认禁止：

- 改测试题目/数量/判分；
- 改 `app/` 代码；
- 改数据契约、目录结构、报告字段；
- 删除历史运行目录。

### 阶段 C · 变更期（仅用户明确要求时）

触发语句示例：

- 「修改项目」「改题目」「改判分」「改代码」；
- 「增加/删除测试」；
- 「调整报告/目录结构」。

变更流程：

1. 读 `agent.md`、本文件与相关代码；
2. 说明影响范围与兼容性；
3. 修改代码、测试、文档；
4. 跑 `npm test`；
5. 更新本文件的变更记录。

## 4. 运行期操作规范

### 允许写入

- 新建 `data/<站点>/<分组>/<runId>/`；
- 更新 `data/index.json` 与根 `测试记录.md`；
- 追加 `logs/fine-apitest.log` 与 `data/.../logs/run.log`；
- 在已有运行目录内写 `review` 字段并重写该运行的 `summary.md` / `run.json` 复核相关字段。

### 不允许写入

- `app/` 源码；
- `app/data/unified_bank.json`；
- 测试题目/判分规则；
- 历史运行目录的原始响应、请求快照、产物；
- 其它项目的文件。

## 5. 数据契约

```
data/
  index.json
  keys.json                     # 本地明文密钥，gitignored
  <站点>/<分组>/<runId>/
    run.json                    # 机器可读结果
    summary.md                  # 人类可读报告
    requests/                   # 请求快照（密钥脱敏）
    responses/                  # 原始响应/SSE（密钥脱敏）
    artifacts/<模型>/capybara.html
    logs/run.log
```

关键字段：

- `run.json.totals`: `models/pass/review/fail/requests/succeededRequests/failedRequests`
- `run.json.results[].tests`: `candy`、`fingerprint`、`capybara-html`
- `run.json.results[].overall`: `pass` / `review` / `fail`
- `capybara-html`: `status`、`verdict`、`artifactFile`、`checks`、`review`

## 6. 验收标准

设计期完成标准：

- `npm test` 全部通过；
- mock e2e 覆盖：发现模型 → 三项测试 → 归档 → 视觉复核工具 → 总评更新（`review.mjs` 保留给用户明确要求时使用）；
- 结果页 API 覆盖：运行列表、运行详情、HTML、Markdown 报告；
- 密钥不出现在运行目录/报告/日志；
- `测试记录.md` 能自动更新；
- 文档与实现一致。

运行期完成标准：

- 报告已生成；
- 失败项有分类与原始响应；
- HTML 结构检查完成，并明确标注「视觉效果待用户评测」；
- 总评与 `review` 状态一致；
- 没有密钥泄露。

## 7. 不在首版范围

- 管理型 Web UI / 可视化编辑 / 写操作；本地只读结果页已在范围内；
- 定时巡检、告警、跨运行趋势；
- Responses / Anthropic / Gemini 原生协议；
- Docker 镜像；
- 多租户服务端、认证、SSRF 公网防护；
- 自动判定 HTML 视觉质量；视觉/审美评测由用户完成，Agent 只做基础结构检查。

## 8. 后续可选扩展

仅在用户明确要求变更时考虑：

- 管理型 Web 后台 / 可视化编辑；
- 历史趋势对比；
- 多站点批量配置；
- 定时任务。

## 9. 变更记录

| 日期 | 变更 | 影响 |
|---|---|---|
| 2026-10-31 | 首版设计冻结 | 糖果、指纹、鹈鹕 SVG、鹈鹕 HTML |
| 2026-11-01 | 取消两个鹈鹕测试，新增水豚海滩 HTML | 测试变为三项；每模型 5 个请求；新增滑块/暂停/星芽/响应式检查；默认 HTML `max_tokens=8192` |
| 2026-11-01 | 新增本地只读结果页 | `app/serve.mjs` + `app/web/`；按站点/分组、模型卡片、三项测试折叠、HTML sandbox 预览/全屏；不提供写接口 |
| 2026-11-01 | 调整测试执行规则 | 未指定模型时先列模型让用户选择，不默认全量；HTML 只做基础结构检查，视觉/审美评测交给用户，Agent 不主动调用 `review.mjs` |
| 2026-11-01 | 默认 `max_tokens` 统一为 16384 | 三项测试默认值由糖果/指纹 `4096`、HTML `8192` 统一为 `16384`；避免长 HTML 被截断；`--max-tokens` 仍可覆盖 |
| 2026-11-02 | 取消默认 `max_tokens` | 三项测试默认不再发送 `max_tokens`，输出上限交给上游；`--max-tokens <n>` 仍可显式限制；`run.json` 的 `maxTokens` 默认记为 `null` |
| 2026-11-02 | 中文水豚提示词 + 指标展示 | `CAPYBARA_HTML_PROMPT` 改为简体中文简化版；`summary.md` 与结果页新增「首字」「输出 token/s」；指纹测试聚合 `speedTps` |
