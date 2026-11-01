# agent.md · fine-apitest 项目规范

> 给在本项目内工作的 Agent 的硬性规则。执行用户任务时，先读 `SKILL.md`；改代码时，先读本文件与 `PROJECT-PLAN.md`。

## 1. 项目定位

`fine-apitest` 是一个**本地、零依赖、零构建**的模型中转站能力测试工具。用户提供站点名称、Base URL、API Key，工具先列出模型供用户选择，再对选定模型执行三项测试：

1. 糖果测试（自动判分）
2. 模型指纹检测（3 次挑战 + 指纹库归因）
3. 水豚 · 海滩骑行 HTML（只做基础结构检查，视觉评测交给用户）

它只做测试与归档，**不修改**任何中转站的渠道、余额、计费、用户或密钥配置。另提供本地只读结果页，用于浏览归档、折叠查看三项测试、预览水豚 HTML。

结果页只读：`app/serve.mjs` 不提供任何写接口，HTML 通过 sandbox iframe 预览。

## 2. 硬性红线

1. 不修改 `finetest/app` 或其它项目；本项目完全独立。
2. 不把完整 API Key 写入报告、日志、`run.json`、请求快照、提交信息或对话输出。
3. 不提交 `data/keys.json`；该文件已在 `.gitignore`。
4. 不删除、覆盖、重写历史运行目录；需要重跑就新建一次运行。
5. 不引入 npm 依赖、CDN、外部字体或构建步骤；只用 Node 内置模块。
6. 不伪造测试结果；没有跑成功就写失败，不要用「应该可以」代替。
7. 不为了通过测试而放宽 HTML 硬检查（外链、截断、无产物、缺滑块/暂停/星芽）。
8. 不把指纹结论写成「模型真假」的确定结论；它只是分布相似度。
9. 不执行用户没有授权的批量删除、计费、渠道、DNS/SSL 操作。
10. 不在生产环境使用 `--allow-private` 访问内网；它只用于本地 mock。
11. **设计冻结后，除非用户明确要求修改项目，否则只运行测试、写报告、交付 HTML 给用户评测；不改题目、代码、数据结构或判分规则。**
12. **用户未指定模型时，先 `--list-models` 并把列表交给用户选择；不得默认全量测试。** 只有用户明确说「全部模型」时才全量。
13. **HTML 只做基础结构检查；不主动做审美/视觉评测，不自行调用 `review.mjs`。** 把 HTML 预览/全屏链接交给用户评测；用户明确要求视觉复核时才做。

## 3. 技术约定

- 运行时：Node.js >= 20（推荐 22+）。
- 语言：JavaScript ESM（`.mjs`），不使用 TypeScript 构建。
- 依赖：零 npm 依赖；HTTP 使用 Node 内置 `fetch`。
- 目录：
  - `app/run.mjs` 主入口；
  - `app/review.mjs` 按用户要求追加 HTML 视觉复核（默认不使用）；
  - `app/serve.mjs` 本地只读结果页服务；
  - `app/web/` 结果页（零构建 HTML/CSS/JS）；
  - `app/lib/` 可复用模块；
  - `app/lib/tests/` 三项测试的题目、判分、指纹、HTML 检查；
  - `app/data/unified_bank.json` 指纹库；
  - `data/` 运行归档；
  - `logs/` 全局日志；
  - `tests/` 单测与 mock e2e。
- 所有写盘使用 `writeJson` / `writeText`，路径必须经过 `safeSegment` / `uniqueNames`。
- 所有日志必须经过 `Logger`（内置脱敏），不要直接 `console.log` 密钥或完整请求头。
- 时间统一用 ISO 8601（`nowIso()`）；运行 ID 用 `makeRunId()`。

## 4. 数据契约

每次运行必须生成：

```
data/<站点>/<分组>/<runId>/
  run.json
  summary.md
  requests/<模型>/<测试>/request.json
  responses/<模型>/<测试>/[slot-N/]attempt-N.txt
  artifacts/<模型>/capybara.html
  logs/run.log
```

`run.json` 顶层至少包含：

- `version`, `runId`, `startedAt`, `finishedAt`
- `station`, `group`, `baseUrl`, `keyFingerprint`
- `models`, `modelDirs`
- `concurrency`, `retry`, `timeouts`, `maxTokens`
- `totals`: `models/pass/review/fail/requests/succeededRequests/failedRequests`
- `results[]`: 每个模型含 `model`、`tests`、`overall`
- `tests` 必须含 `candy`、`fingerprint`、`capybara-html`
- HTML 测试含 `status`、`verdict`、`artifactFile`、`checks`、`review`
- 失败测试含 `error.category`、`error.message`、`httpStatus`、`attemptDetails`

`data/index.json` 与根 `测试记录.md` 由 `updateIndex()` 维护，不要手工编辑。

## 5. 执行流程（Agent 必须遵守）

### 5.1 收集输入

- 站点名称（必填）
- 分组（可选，默认「默认」）
- Base URL（必填，OpenAI 兼容，通常以 `/v1` 结尾）
- API Key（必填；可用 `--key` / `--key-env` / `--key-file`）

如果用户只给了域名，补成 `https://<域名>/v1`；如果不确定，先 `--list-models` 验证。

**模型选择规则：**

- 用户指定了模型 → 用 `--model` 只测指定模型。
- 用户没有指定模型 → 先 `--list-models`，把模型列表给用户选择；不要直接跑全部。
- 用户明确说「全部模型」→ 才可以省略 `--model` 全量运行。

### 5.2 运行

```bash
node app/run.mjs --station "<站点>" --group "<分组>" --url "<BaseURL>" --key "<Key>" --model "<模型>" --json
```

- 默认只测用户选定的模型；只有用户明确要求全量时才省略 `--model`。
- 默认全并发、失败重试 1 次；不要擅自改成无限重试。
- 默认不发送 `max_tokens`，输出上限交给上游；只有用户明确要求限制时才加 `--max-tokens <n>`。
- 需要机器可读结果时加 `--json`；stdout 只有 JSON，进度在 stderr。
- 退出码 0 表示「运行完成」，不代表所有模型通过；必须读 `totals` 与 `results[].overall`。

### 5.3 读取结果

优先读 `summaryPath` 指向的 `summary.md`，需要程序化处理时读 `run.json`。

报告必须如实转述：

- 模型数、请求成功/失败数；
- 通过 / 待复核 / 不通过数量；
- 每个模型的三项结论；
- 每个测试的首字延迟与输出 token/s（如可用）；
- 失败原因（鉴权、429、5xx、超时、参数拒绝等）；
- HTML 结构是否通过；视觉评测交给用户。

不要把「待复核」说成「通过」。

### 5.4 交付 HTML 给用户评测

默认只做基础结构检查：

1. 确认 `capybara-html` 的 `status`、`verdict`、`checks`；
2. 确认硬性结构项全部通过（标签、内联 SVG、动画、滑块 0.3×–3.0×、暂停/继续、星芽、无外链、未截断）；
3. 把 artifact 路径或结果页链接交给用户，说明「结构通过，视觉效果请自行评测」；
4. HTML 未由用户给出结论时，总评保持 `review`，不要自行改成 `pass`。

**不要**主动打开 HTML 做审美、构图、动画流畅度评分，也**不要**自行调用 `review.mjs`。

如果用户明确要求视觉复核，才按 README 的检查清单检查并调用：

```bash
node app/review.mjs --run "<runDir>" --model "<模型>" --test capybara-html --verdict pass|fail|review --note "<具体依据>"
```

复核后重新读 `summary.md` / `run.json` 的 `overall`，再向用户汇报最终总评。

## 6. 判定规则（不得随意改）

- 糖果：`correct` / `wrong` / `review`；明确否认前提 → `review`，即使答案数字正确。
- 指纹：`predicted` / `insufficient` / `failed`；指纹只作参考，不单独判真假；部分样本失败 → 待复核。
- 水豚 HTML：
  - 硬失败：无产物、根标签/结束标签缺失、外链、`max_tokens` 截断、无内嵌 SVG、无动画、无速度滑块/滑块范围不足、无暂停按钮、无「星芽」、无 vanilla JS；
  - 轻微警告：缺 viewport、未检测到事件绑定、体积偏小；
  - 结构 `ok` 记为「待用户评测」，不要自动按 `pass` 处理；审美/视觉结论由用户给出。
- 总评：任一硬失败 → `fail`；否则有未完成项 → `review`；三项全部完成 → `pass`。
- 只有用户明确给出视觉复核结论时，`review.mjs` 的 `pass` 才可覆盖「缺 viewport / 未检测到事件绑定 / 体积偏小」这类轻微警告，不能覆盖硬失败。

## 7. 失败处理

- 401/403：Key 或分组无权限；不要反复重试。
- 429：区分 `rate_limited` 与 `upstream_exhausted`；后者是站方账号池耗尽，等恢复或换分组。
- 502/503/504：中转站/Cloudflare 侧问题；报告里要写清「不是本平台故障」。
- 连接/首内容/总时限超时：保留原始响应，按需调大超时；不要无限重试。
- 参数被拒绝：查看 `responses/` 原始错误；不要盲目改全局参数。
- 模型列表为空：用 `--model` 指定，或检查站点是否实现 `/models`。

## 8. 代码修改规范

### 新增/修改测试

1. 在 `app/lib/tests/definitions.mjs` 增加定义（id、name、kind、prompt、可选 maxTokens、fileName）。
2. 在 `app/lib/tests/` 增加判分/检查模块。
3. 在 `app/lib/runner.mjs` 增加任务构建与结果构建。
4. 在 `app/lib/report.mjs` 增加报告段落。
5. 在 `app/lib/overall.mjs` 增加总评规则。
6. 在 `tests/unit.test.mjs` 增加单测；必要时扩展 `tests/mock-upstream.mjs` 与 e2e。
7. 更新 `README.md`、`agent.md`、`SKILL.md`、`PROJECT-PLAN.md`。

### 修改指纹

- 指纹算法/挑战套件/指纹库是**版本化资产**；任何常量或特征管线改动都视为算法版本变更。
- 必须同步更新 `THIRD_PARTY_NOTICES.md`，并重新跑指纹单测。
- 不要为了某个模型「好看」而手改概率或结果。

### 代码风格

- 使用 `const`/`let`、小函数、显式返回；不要引入类继承层级。
- 错误信息用中文，包含可执行建议；错误对象保留 `category`。
- 任何外部输入（站点名、模型名、URL、文件名）都要安全化。
- 所有新增逻辑必须有单测或 e2e 覆盖。

## 9. 测试与交付

交付前必须：

```bash
npm test
```

要求：

- 单测 + mock e2e 全部通过；
- 至少手动跑一次 `--help`、`--list-keys`、`--list-models`（可用 mock）；
- 检查 `run.json` / `summary.md` / 日志中没有完整 Key；
- 检查 `data/keys.json` 没有被提交；
- 检查 `测试记录.md` 能正常追加/更新。

## 10. 完成定义（Definition of Done）

一个任务只有同时满足以下条件才算完成：

1. 用户要求的测试已真实执行，或明确说明无法执行的原因；
2. 结果已写入 `data/<站点>/<分组>/<runId>/`；
3. `summary.md` 可读，`run.json` 可解析；
4. 根 `测试记录.md` 已更新；
5. 失败项有明确分类与原始响应可查；
6. HTML 结构检查已完成，并明确标注「视觉效果待用户评测」；
7. 没有密钥泄露；
8. `npm test` 通过（改代码时）。

## 11. 项目阶段与变更控制

### 设计期（已完成）

- 确定三项测试题目、判分规则、数据契约、报告格式、目录结构。
- 允许新增/删除测试、调整 HTML 检查项、修改文档。
- 任何设计变更必须同步测试与文档。

### 运行期（默认）

设计冻结后，Agent 默认只做：

1. 运行测试；
2. 写报告 / 更新 `测试记录.md`；
3. 把 HTML 结构与预览交给用户评测（不主动做审美复核）；
4. 启动只读结果页浏览结果；
5. 向用户汇报结果。

**默认不做**：

- 改测试题目、测试数量、判分规则、总评规则；
- 改 `app/` 代码或数据契约；
- 改目录结构、报告字段、默认参数；
- 删除历史运行目录或重写 `data/`；
- 主动做 HTML 审美/视觉复核或调用 `review.mjs`。

### 变更触发条件

只有用户明确说出以下意图之一，才进入设计期：

- 「修改项目 / 改题目 / 改判分 / 改代码 / 改报告」；
- 「增加/删除某个测试」；
- 「调整数据结构或目录」。

变更时必须：

1. 先读 `PROJECT-PLAN.md` 与相关代码；
2. 说明影响范围与兼容性；
3. 更新测试、文档、`PROJECT-PLAN.md`；
4. 跑 `npm test`；
5. 在 `测试记录.md` 或变更说明中记录。

### 运行期允许的写入

- 新建 `data/<站点>/<分组>/<runId>/`；
- 追加 `data/index.json` 与根 `测试记录.md`；
- 追加 `logs/fine-apitest.log` 与运行目录 `logs/run.log`；
- 在已有运行目录内写 `review` 字段并重写该运行的 `summary.md` / `run.json` 的复核相关字段。

除此之外的写入都视为项目修改，需用户明确授权。
