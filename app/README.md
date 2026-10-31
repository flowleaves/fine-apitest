# app · 可复用代码

```
app/
├─ run.mjs                  # CLI 主入口
├─ review.mjs               # 追加 artifact 视觉复核
├─ serve.mjs                # 本地只读结果页服务
├─ web/                     # 结果页（index.html / style.css / app.js）
├─ data/unified_bank.json   # 指纹库（18 个模型，约 1MB）
└─ lib/
   ├─ runner.mjs            # 编排：发现模型 → 派发 → 判分 → 归档
   ├─ chat.mjs              # Chat Completions / SSE / 超时 / 重试
   ├─ models.mjs            # GET /models 自动发现
   ├─ netguard.mjs          # URL 规范化 + 私网/元数据拦截
   ├─ sse.mjs               # SSE 解码器
   ├─ secrets.mjs           # 本地密钥存储（data/keys.json）
   ├─ report.mjs            # summary.md / 测试记录.md / index.json
   ├─ overall.mjs           # 总评规则
   ├─ log.mjs               # 脱敏日志
   ├─ util.mjs              # 路径安全、JSON、哈希、格式化
   └─ tests/
      ├─ definitions.mjs    # 三项测试的题目与参数
      ├─ candy.mjs          # 糖果判分（candy-rule-v3）
      ├─ fingerprint.mjs    # 挑战套件 + 指纹归因
      └─ artifact.mjs       # HTML 提取与结构检查
```

## 调用关系

```
run.mjs
  → runner.executeRun()
      → models.discoverModels()        GET /models
      → chat.runChatWithRetry()        POST /chat/completions (SSE)
      → tests/candy.gradeCandy()
      → tests/fingerprint.analyzeFingerprint()
      → tests/artifact.evaluateArtifact()
      → overall.computeModelOverall()
      → report.renderSummary() / updateIndex()

serve.mjs
  → listRuns()                         data/index.json / 扫描 data/
  → /api/run /api/artifact /api/report 只读接口
  → web/                             结果页 SPA
```

## 扩展建议

- 新增测试：仅在用户明确要求变更项目时，改 `tests/definitions.mjs`、`runner.mjs`、`report.mjs`、`overall.mjs`，补单测。
- 新增协议：在 `chat.mjs` 旁增加适配器，保持 `runChatOnce` 的返回结构。
- 新增报告格式：只改 `report.mjs`，不要改 `run.json` 的既有字段。
- 指纹算法/库是版本化资产，改动必须更新 `THIRD_PARTY_NOTICES.md` 并重跑指纹测试。
