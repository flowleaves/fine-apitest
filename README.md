# fine-apitest · 模型中转站三项能力测试

给 Agent 用的本地测试工具：告诉它 **站点名称、Base URL、API Key**，它会先列出可用模型，由你选定后再跑三项测试、归档原始结果，并生成可读报告。

> 零依赖、零构建、纯 Node ESM。复制目录即可用，不需要 `npm install`。

## 项目阶段与变更控制

- **设计期（当前已完成）**：可以调整测试题目、判分规则、报告格式和目录结构。
- **运行期（默认）**：设计冻结后，Agent **只运行测试、写报告、浏览只读结果页**；HTML 只做基础结构检查，视觉/审美评测交给用户。除非用户明确要求「修改项目」，否则不改题目、代码、数据结构或报告规则。
- 任何题目 / 判分 / 数据契约变更，都必须由用户明确提出，并同步更新 `PROJECT-PLAN.md`、`agent.md` 和 `README.md`。

详见 `PROJECT-PLAN.md` 与 `agent.md` 的「项目阶段与变更控制」。

## 三项测试

| 测试 | 内容 | 判定 |
|---|---|---|
| 糖果测试 | 经典「黑袋糖果」组合题 | 自动判分：正确 / 错误 / 待复核 |
| 模型指纹检测 | 3 组 1–355 无语义数字选择，和指纹库比对 | 输出最可能模型与家族概率；证据不足记待复核 |
| 水豚 · 海滩骑行 HTML | 单文件 HTML：戴墨镜的水豚在海滩骑自行车，带速度滑块、暂停/继续、左上角「星芽」艺术字 | 只做基础结构检查；视觉评测交给用户 |

指纹结论只表示「数字分布最像哪个模型」，**不构成模型真假判定**。

## 目录

```
fine-apitest/
├─ SKILL.md                 # Agent Skill 入口（OpenCode / Claude Code 等读取）
├─ agent.md                 # 项目规范：给 Agent 的硬性规则
├─ AGENTS.md                # 指向 agent.md 的入口
├─ PROJECT-PLAN.md          # 项目阶段、范围与变更控制
├─ README.md                # 本文件
├─ THIRD_PARTY_NOTICES.md   # 指纹库/算法来源与 MIT 许可
├─ 测试记录.md              # 每次运行的索引（CLI 自动维护）
├─ app/
│  ├─ run.mjs               # 主入口：跑测试
│  ├─ review.mjs            # 按用户要求追加 HTML 视觉复核
│  ├─ serve.mjs             # 本地只读结果页服务
│  ├─ web/                  # 结果页（零构建 HTML/CSS/JS）
│  ├─ lib/                  # 传输、SSE、判分、指纹、报告、归档
│  └─ data/unified_bank.json # 指纹库（约 1MB）
├─ data/                    # 每次运行的归档
│  ├─ keys.json             # 本地密钥（gitignored）
│  └─ <站点>/<分组>/<runId>/
│     ├─ run.json
│     ├─ summary.md
│     ├─ requests/
│     ├─ responses/
│     ├─ artifacts/
│     └─ logs/run.log
├─ logs/                    # 全局日志
└─ tests/                   # 零依赖单测 + mock 上游 e2e
```

## 安装为 Agent Skill

`fine-apitest/` 本身就是一个目录式 Skill：根目录的 `SKILL.md` 是入口，`app/`、`README.md`、`agent.md` 是它的支持文件。把整个目录放到 Agent 的 skills 目录即可。

OpenCode 项目级（推荐用 junction/symlink，避免复制后失同步）：

```powershell
# Windows（在仓库根目录执行）
mkdir .opencode\skills
cmd /c mklink /J .opencode\skills\fine-apitest fine-apitest
```

```bash
# macOS / Linux
mkdir -p .opencode/skills
ln -s "$PWD/fine-apitest" .opencode/skills/fine-apitest
```

全局安装：

```bash
# OpenCode
mkdir -p ~/.config/opencode/skills
ln -s "$PWD/fine-apitest" ~/.config/opencode/skills/fine-apitest

# Claude Code / 兼容目录
mkdir -p ~/.claude/skills
ln -s "$PWD/fine-apitest" ~/.claude/skills/fine-apitest
```

如果系统不允许创建链接，也可以直接复制整个 `fine-apitest/` 到 `.opencode/skills/fine-apitest/`。OpenCode 会根据 `SKILL.md` 的 `description` 自动发现，也可以用 `@fine-apitest` 显式加载。

## 快速开始

要求：Node.js >= 20（推荐 22+）。

```bash
cd fine-apitest

# 1. 先看有哪些模型
node app/run.mjs --list-models --station "凉热葵" --group "claude-kiro-0075" --url "https://api.liangrekui.com/v1" --key "sk-..."

# 2. 选定模型后运行
node app/run.mjs --station "凉热葵" --group "claude-kiro-0075" --url "https://api.liangrekui.com/v1" --key "sk-..." --model "claude-opus-5-5"
```

> Agent 默认流程：用户没指定模型时先列出模型让用户选择，不直接全量运行。只有用户明确要求「全部模型」时才省略 `--model`。

运行结束后：

- 报告：`data/凉热葵/claude-kiro-0075/<runId>/summary.md`
- 机器可读：同目录 `run.json`
- 索引：根目录 `测试记录.md`
- 日志：`logs/fine-apitest.log` 与本次运行目录下的 `logs/run.log`

密钥会保存到 `data/keys.json`，下次可省略 `--key`：

```bash
node app/run.mjs --station "凉热葵" --group "claude-kiro-0075" --url "https://api.liangrekui.com/v1" --model "claude-opus-5-5"
```

不想保存：

```bash
node app/run.mjs --station "凉热葵" --url "https://api.liangrekui.com/v1" --key "sk-..." --model "claude-opus-5-5" --no-save-key
```

### 查看结果页

```bash
node app/serve.mjs --open
```

默认打开 `http://127.0.0.1:8788/`，页面会读取本地 `data/`：

- 按「站点 + 分组」聚合，可切换同一分组的历史运行；
- 模型卡片 / 三项测试逐项折叠，点开看糖果原文、指纹分布、HTML 结构检查；
- 水豚 HTML 直接在 sandbox iframe 中预览，支持全屏与下载；
- 搜索模型、按总评筛选、明暗主题、展开/收起模型；
- **只读**：不提供写接口，不会修改测试结果。

默认只绑定 `127.0.0.1`。需要局域网访问时显式加 `--host 0.0.0.0`，并自行加认证/反向代理；不要直接暴露到公网。

### 只测指定模型

```bash
node app/run.mjs --station "站点" --url "https://api.example.com/v1" --model claude-opus-5-5
node app/run.mjs --station "站点" --url "https://api.example.com/v1" --model claude-opus-5-5,claude-sonnet-5
```

CLI 未指定 `--model` 时会 `GET /v1/models` 并测试全部模型；**Agent 流程应先列出模型让用户选择**，只有用户明确要求全量时才全量运行。默认全并发；模型很多（例如 20+）时建议加 `--concurrency 8`，避免触发站方限流。

### 先看有哪些模型

```bash
node app/run.mjs --list-models --station "站点" --url "https://api.example.com/v1"
```

### 查看 / 删除本地密钥

```bash
node app/run.mjs --list-keys
node app/run.mjs --forget-key --station "站点" --group "默认"
```

## 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--station` | 站点名称（归档与密钥索引） | 必填 |
| `--group` | 分组名称 | `默认` |
| `--url` | OpenAI 兼容 Base URL | 必填（或复用已保存） |
| `--key` | API Key | — |
| `--key-env` | 从环境变量读取 Key | — |
| `--key-file` | 从文件读取 Key | — |
| `--model` | 只测指定模型，可重复/逗号分隔 | 未指定时测试全部（Agent 流程应先让用户选） |
| `--concurrency` | 并发数 | `0` = 全并发 |
| `--retry` | 每个请求失败重试次数 | `1` |
| `--max-tokens` | 覆盖所有测试的 `max_tokens` | `16384` |
| `--timeout-connect` | 连接超时 | `15000` |
| `--timeout-first` | 首内容超时 | `300000` |
| `--timeout-gap` | 内容间隔超时 | `120000` |
| `--timeout-total` | 总时限 | `900000` |
| `--no-save-key` | 不保存本次密钥 | — |
| `--no-retry` | 等价于 `--retry 0` | — |
| `--allow-private` | 允许私网/环回目标（仅本地 mock） | — |
| `--json` | stdout 输出机器可读 JSON | — |
| `--data-dir` | 数据目录 | `./data` |
| `--log-dir` | 日志目录 | `./logs` |
| `--record-file` | 索引文件 | `./测试记录.md` |
| `--bank` | 指纹库 | `app/data/unified_bank.json` |

## 结果怎么判

### 分项

- **糖果**：`correct` / `wrong` / `review`（前提被否认、结论矛盾、无明确结论都会进 `review`）。
- **指纹**：`predicted`（有结论）/ `insufficient`（有效数字不足）/ `failed`（请求失败）。
- **水豚 HTML**：
  - 结构硬检查：完整标签、无外链、内嵌 SVG、动画、速度滑块覆盖 `0.3×–3.0×`、暂停/继续按钮、`星芽`、vanilla JS；
  - 轻微警告：缺 viewport、未检测到事件绑定、体积偏小；
  - 默认只做结构检查，不做审美/视觉评分；结构通过后把预览/全屏交给用户评测；
  - 结论：`ok`（结构通过，待用户评测）/ `review` / `fail`。

### 总评

- 任意硬失败 → **不通过**（请求失败、糖果错误、HTML 结构不合格）；
- 否则有未完成项 → **待复核**（HTML 结构通过但用户尚未评测、指纹证据不足、指纹部分样本失败、糖果待复核）；
- 三项全部完成且用户确认 HTML 通过 → **通过**。

只有用户明确要求视觉复核并给出结论时，`review.mjs` 的 `pass` 才可覆盖「缺 viewport / 未检测到事件绑定 / 体积偏小」这类轻微结构警告，但**不能覆盖**无产物、外链、截断、缺滑块/暂停/星芽等硬失败。

## HTML 交付与用户评测

默认流程：

1. Agent 只确认 `capybara-html` 的结构检查结果（`checks` / `verdict`）；
2. 把 artifact 路径或结果页链接交给用户；
3. 由用户看预览/全屏，判断水豚、自行车、海滩、动画、构图等视觉效果；
4. HTML 未由用户给出结论时，总评保持 `待复核`。

Agent **不主动**做审美、构图、动画流畅度评分，也**不自行**调用 `review.mjs`。

如果用户明确要求视觉复核，可参考以下清单：

1. 是否明显是水豚（大脸、小耳、钝鼻），并戴着墨镜；
2. 自行车是否有两轮、车架、车把、车座、曲柄、脚踏板、辐条；
3. 是否真的在海滩上：沙滩、海浪、天空/阳光、夏日氛围；
4. 速度滑块是否覆盖 0.3×–3.0×，拖动时车轮/踏板/背景是否实时平滑变化；
5. 暂停/继续按钮是否有效，恢复后动画是否连续；
6. 左上角是否有风格化的「星芽」艺术字；
7. 桌面与窄屏是否都能正常显示，动画是否连续同步。

然后执行：

```bash
node app/review.mjs --run "data/站点/分组/<runId>" --model "模型" --test capybara-html --verdict pass --note "水豚/墨镜/海滩清晰，滑块 0.3–3.0 实时生效，暂停恢复连续，星芽艺术字与移动端布局正常"
```

`--test` 可用 `capybara-html`（也接受 `capybara` / `html`）。`--verdict` 为 `pass` / `fail` / `review`。

查看待复核：

```bash
node app/review.mjs --run "<runDir>" --list
```

## 数据与安全

- 每次运行独立目录，原始 SSE / JSON 响应按尝试次数保存，便于复查失败原因。
- 请求快照中的 `Authorization` 固定写成 `Bearer <redacted>`。
- 原始响应落盘前会脱敏 `sk-...` 与 `Bearer ...`。
- 报告只记录密钥的 `sha256:` 指纹，不记录明文。
- `data/keys.json` 是本机明文密钥库，已加入 `.gitignore`；共享目录前请删除。
- 默认拒绝私网/环回/云元数据目标；本地 mock 测试才使用 `--allow-private`。
- 本工具只读 `GET /models` 和 `POST /chat/completions`，不修改渠道、余额、计费或任何平台配置。

## 常见错误

| 现象 | 含义 | 处理 |
|---|---|---|
| `HTTP 401/403` | Key 无效或无权限 | 检查 Key / 分组 |
| `HTTP 429 All available accounts exhausted` | 中转站没有可用上游账号 | 等站方恢复，或换分组 |
| `HTTP 502/503/504` | 中转站源站/Cloudflare 故障 | 不是本平台问题；稍后重试 |
| `连接超时` | TCP/TLS 建连失败 | 检查域名、网络、代理 |
| `首内容等待超时` | 上游长时间不返回首 token | 调大 `--timeout-first` 或换模型 |
| `目标解析到非公网地址` | 目标是私网/环回 | 本地 mock 加 `--allow-private` |
| `模型列表为空` | `/models` 不可用或无模型 | 用 `--model` 指定，或检查站点 |
| `参数被拒绝 HTTP 400` | 上游不接受 `max_tokens` / `stream_options` 等 | 查看 `responses/` 里的原始错误 |

## 开发与测试

```bash
# 全部测试（单测 + mock e2e + 结果页 API）
npm test

# 只跑单测
npm run test:unit

# 只跑结果页 API 测试
npm run test:web

# 启动结果页
npm run serve

# 启动 mock 上游（手动调试）
npm run mock
```

测试不依赖真实中转站，也不会写入真实 `data/`。

## 已知边界

- 只实现 OpenAI Chat Completions（`/v1/chat/completions`），未实现 Responses / Anthropic / Gemini 原生协议。
- 三项测试默认 `max_tokens=16384`；仍可能被上游截断，看到 `truncated` 时可用 `--max-tokens 32768` 重试。
- 指纹库包含 18 个模型，超出库范围的模型只能给「最像」结果，不能证明真假。
- 无管理型 Web UI；提供本地只读结果页。无定时任务、无跨运行趋势；这些是后续扩展。
- 不做 DNS 固定；这是本地可信 CLI，不是多租户服务端。若要公网部署，需补 SSRF 防护与认证。
- 设计冻结后默认只运行测试、写报告；修改题目/判分/数据契约需用户明确要求。

## 致谢

指纹挑战套件、归因算法与指纹库来自 [ModelTrace](https://github.com/xqy2006/ModelTrace)（MIT）。详见 `THIRD_PARTY_NOTICES.md`。
