# Third-Party Notices

本项目的指纹挑战套件与归因算法移植自 **ModelTrace**。

## ModelTrace

- 来源：<https://github.com/xqy2006/ModelTrace>
- 许可：MIT License
- 版权：Copyright (c) 2026 xqy2006
- 移植文件：
  - `static/fingerprint-core.js` → `app/lib/tests/fingerprint.mjs`（归因核心）
  - `challenge_suite.py` → `app/lib/tests/fingerprint.mjs`（挑战套件生成）
  - `data/unified_bank.json` → `app/data/unified_bank.json`（指纹库）
- 算法版本：统一全局稳健数字指纹
  （`VALUE_MIN=1`、`VALUE_MAX=355`、`DIMENSION=355`、`ALPHA=0.5`、`ORDERED_BLOCK_WEIGHT=0.25`，
  挑战套件版本 `fingerprint-suite-v1`）。
- 任何常量或特征管线改动都视为算法版本变更，必须同步更新本声明。

## MIT License（全文）

```
MIT License

Copyright (c) 2026 xqy2006

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
