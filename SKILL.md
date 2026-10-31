---
name: fine-apitest
description: Test an OpenAI-compatible model relay station with three capability tests (candy reasoning, model fingerprint, capybara beach HTML animation), archive raw results, and optionally visually review the HTML artifact. Use when the user provides a station name, base URL, and API key and asks to test a relay station or compare its models.
---

# fine-apitest

用本地零依赖 CLI 测试模型中转站。用户给出 **站点名称 + Base URL + API Key** 后，你负责跑完三项测试、复核 HTML、如实汇报。

## 项目阶段（默认运行期）

设计已经冻结。默认只做四件事：**运行测试、写报告、视觉复核、浏览只读结果页**。

除非用户明确说「修改项目 / 改题目 / 改判分 / 改代码」，否则不要改：

- 测试题目或测试数量；
- 判分规则 / 总评规则；
- `run.json`、`summary.md`、目录结构；
- `app/` 下的代码。

需要改项目时，先读 `PROJECT-PLAN.md` 与 `agent.md`，并同步更新文档和测试。

> 执行测试任务时，不要先重构代码或改题目；直接运行 `node app/run.mjs`。只有 CLI 本身报错、需要修 bug 时，先向用户说明影响并取得修改授权。

## 何时使用

- 用户说「测一下这个中转站」「看看这些模型靠不靠谱」「跑三项测试」；
- 用户给出 `站点名 + https://.../v1 + sk-...`；
- 用户想比较某站多个模型，或定期留档。

不要用于：修改渠道/余额/计费、验证账号所有权、攻击或扫描内网。

## 前置检查

1. Node.js >= 20：`node -v`。
2. 工作目录是 `fine-apitest`（含 `app/run.mjs`）；如果在父目录，先 `cd fine-apitest`。
3. 不需要 `npm install`；没有 npm 依赖。

> 本 Skill 的基目录就是 `fine-apitest`。如果 OpenCode 以 `.opencode/skills/fine-apitest` 加载，先 `cd` 到该目录，或用绝对路径执行 `node <skill-dir>/app/run.mjs`。

## 标准流程

### 1. 收集输入

- `station`：站点名称，必填；
- `group`：分组，可选，默认「默认」；
- `url`：OpenAI 兼容 Base URL，通常以 `/v1` 结尾；
- `key`：API Key。

如果用户只给域名，补成 `https://<域名>/v1`。不确定模型列表时先跑：

```bash
node app/run.mjs --list-models --station "<站点>" --url "<URL>" --key "<KEY>"
```

### 2. 跑测试

默认自动发现全部模型、全并发、失败重试 1 次：

```bash
node app/run.mjs --station "<站点>" --group "<分组>" --url "<URL>" --key "<KEY>" --json
```

省时/省钱时加 `--model <id>`（可逗号分隔）。stdout 是 JSON；退出码 0 只代表「运行完成」，不代表全部通过；必须看 `totals` 和 `results[].overall`。

三项测试固定为：

1. 糖果测试（自动判分）
2. 模型指纹检测（3 次挑战）
3. 水豚 · 海滩骑行 HTML（结构检查 + 视觉复核）

### 3. 读结果

- 人类可读：`summaryPath`（`<run>/summary.md`）
- 机器可读：`<run>/run.json`
- 索引：根 `测试记录.md`
- 失败细节：`<run>/responses/`、`<run>/requests/`

汇报时必须包含：

- 模型数、请求成功/失败数；
- 通过 / 待复核 / 不通过；
- 每个模型的三项结论；
- 失败分类与可执行建议；
- 哪些 HTML 仍需视觉复核。

不要把「待复核」说成「通过」。

### 4. 打开结果页

```bash
node app/serve.mjs --open
```

默认 `http://127.0.0.1:8788/`，按站点/分组展示，模型和三项测试可折叠，水豚 HTML 可在 sandbox iframe 中预览/全屏。页面只读，不会修改结果。

### 5. 视觉复核 HTML

对 `summary.md` 的「待 Agent 视觉复核」列表，打开 `.html`，检查：

1. 是否明显是水豚（大脸、小耳、钝鼻），并戴着墨镜；
2. 自行车是否有两轮、车架、车把、车座、曲柄、脚踏板、辐条；
3. 是否真的在海滩上：沙滩、海浪、天空/阳光、夏日氛围；
4. 速度滑块是否覆盖 0.3×–3.0×，拖动时车轮/踏板/背景是否实时平滑变化；
5. 暂停/继续按钮是否有效，恢复后动画是否连续；
6. 左上角是否有风格化的「星芽」艺术字；
7. 桌面与窄屏是否都能正常显示，动画是否连续同步。

然后：

```bash
node app/review.mjs --run "<runDir>" --model "<模型>" --test capybara-html --verdict pass --note "水豚/墨镜/海滩清晰，滑块 0.3–3.0 实时生效，暂停恢复连续，星芽艺术字与移动端布局正常"
```

`--test` 可用 `capybara-html`（也接受 `capybara` / `html`）；`--verdict` 为 `pass` / `fail` / `review`。备注必须写具体依据，不要只写「不错」。

没有浏览器能力时，明确说「HTML 仍需人工视觉复核」，不要假装已看。

### 6. 最终汇报

复核后重新读 `summary.md` 或 `run.json` 的 `overall`，再给最终结论。建议格式：

```
站点：<站>/<组> · 模型 6 个 · 请求 30（29 成功 / 1 失败）
通过 4 · 待复核 1 · 不通过 1
- model-a：通过（糖果正确；指纹最像 claude-opus-5-5；水豚 HTML 复核通过）
- model-b：不通过（糖果错误）
- model-c：待复核（水豚 HTML 未视觉复核）
报告：<summaryPath>
```

## 密钥规则

- 默认保存到 `data/keys.json`，便于下次复用；用户不想保存时加 `--no-save-key`。
- 共享机器上优先用 `--key-env` / `--key-file`，避免 Key 留在 shell 历史或进程列表。
- 不要在回复中回显完整 Key；不要把它写进报告、日志、提交信息。
- 共享项目目录前提醒用户删除 `data/keys.json`。

## 失败分类

| 分类 | 含义 | 建议 |
|---|---|---|
| `auth_error` | 401/403 | 检查 Key / 分组权限 |
| `rate_limited` | 429 限流 | 降低并发或稍后重试 |
| `upstream_exhausted` | `All available accounts exhausted` | 站方账号池耗尽；等恢复/换分组 |
| `upstream_5xx` | 502/503/504 | 中转站侧问题；不是本工具故障 |
| `connect_timeout` | 建连超时 | 检查域名/网络/代理 |
| `first_content_timeout` | 首 token 超时 | 调大 `--timeout-first` 或换模型 |
| `param_rejected` | 400/422 参数被拒绝 | 查看 `responses/` 原始错误 |
| `empty_response` | 200 但正文为空 | 重试或换模型 |
| `private_target` | 私网/环回目标 | 仅本地 mock 加 `--allow-private` |

不要对 401/403/参数拒绝做无限重试。

## 安全边界

- 只调用 `GET /models` 与 `POST /chat/completions`，不修改任何站点配置。
- 默认拒绝私网/环回/云元数据目标；`--allow-private` 只用于本地 mock。
- 不删除历史运行目录；需要重跑就新建运行。
- 不伪造结果；失败就写失败。
- 设计冻结后，不擅自修改项目内容。
- 结果页只读；不要为让它显示结果而改写 `data/` 或添加写接口。

## 参考

- `README.md`：完整参数、数据布局、判定规则、安装方式。
- `PROJECT-PLAN.md`：项目阶段、范围与变更控制。
- `agent.md`：项目规范与修改约束。
- `app/run.mjs`：主入口。
- `app/review.mjs`：视觉复核入口。
- `app/serve.mjs` + `app/web/`：本地只读结果页。

## 安装

把整个 `fine-apitest/` 目录放到 OpenCode 的 `.opencode/skills/fine-apitest/`（或全局 `~/.config/opencode/skills/fine-apitest/`）。推荐用 junction/symlink，保证 `app/` 与文档同步。Claude Code 兼容目录是 `~/.claude/skills/fine-apitest/`。
