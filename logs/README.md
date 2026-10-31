# logs · 日志

- `fine-apitest.log`：所有运行的追加日志（开始、发现模型、请求进度、完成、复核）。
- `data/<站点>/<分组>/<runId>/logs/run.log`：单次运行日志。

日志不会记录完整 API Key；仍会对 `sk-...` 和常见 `key=` 查询参数做脱敏。

日志不自动轮转；长期运行时可自行归档或清理 `fine-apitest.log`。
