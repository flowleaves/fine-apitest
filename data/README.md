# data · 数据归档

每次运行自动创建：

```
data/
  index.json                       # 运行索引（测试记录.md 的数据源）
  keys.json                        # 本地密钥（gitignored，明文，仅本机）
  <站点>/<分组>/<runId>/
    run.json                       # 完整机器可读结果
    summary.md                     # 人类可读报告
    requests/                      # 请求快照（密钥已脱敏）
    responses/                     # 原始响应 / SSE，按尝试次数保存
    artifacts/                     # capybara.html
    logs/run.log                   # 本次运行日志
```

约定：

- 站点名与分组名会做文件系统安全化；原名保留在 `run.json`。
- `runId` 为 UTC 时间 + 随机后缀，可按时间排序。
- 密钥不会写入运行目录；只记录 `sha256:` 指纹。
- 原始响应可能包含上游返回的敏感内容，请勿公开分享整个 `data/`。
- `data/index.json` 与根 `测试记录.md` 由 CLI 自动维护，不要手工改。
- 运行期只写 `data/` 与 `logs/`；除非用户明确要求修改项目，否则不改 `app/`、题目或判分规则。
