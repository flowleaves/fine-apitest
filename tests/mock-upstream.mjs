/**
 * 本地 mock 上游：用于 e2e 验证，不依赖任何真实中转站。
 *
 * 提供 /v1/models 与 /v1/chat/completions（SSE）。
 * mock-good 返回正确糖果答案与合格的水豚 HTML；mock-bad 返回错误糖果答案与无效 HTML。
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CAPYBARA_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Capybara Beach Ride · 星芽</title>
<style>
  :root { --sky: #bfe8ff; --sea: #2fa8c9; --sand: #f4d58d; --ink: #263238; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: linear-gradient(#bfe8ff, #e8f7ff 55%, #f4d58d); font-family: ui-sans-serif, system-ui, sans-serif; color: var(--ink); overflow: hidden; }
  .stage { position: relative; width: 100%; height: 100vh; min-height: 420px; }
  .brand { position: absolute; top: 22px; left: 26px; z-index: 4; font-family: "STKaiti", "KaiTi", serif; font-size: clamp(34px, 5vw, 64px); font-weight: 700; letter-spacing: .08em; color: #fff; text-shadow: 0 3px 0 #0b6f86, 0 10px 24px rgba(0, 70, 90, .35); transform: rotate(-4deg); }
  .brand::after { content: ""; position: absolute; left: 4px; right: -10px; bottom: 2px; height: 8px; background: rgba(255, 255, 255, .55); border-radius: 99px; z-index: -1; }
  .ui { position: absolute; left: 50%; bottom: 22px; z-index: 4; transform: translateX(-50%); display: flex; gap: 14px; align-items: center; padding: 12px 18px; border-radius: 999px; background: rgba(255, 255, 255, .72); box-shadow: 0 12px 30px rgba(0, 70, 90, .18); backdrop-filter: blur(8px); }
  .ui label { font-size: 13px; font-weight: 700; white-space: nowrap; }
  input[type="range"] { width: min(38vw, 240px); accent-color: #0b8fa8; }
  #speedValue { min-width: 42px; font-variant-numeric: tabular-nums; font-weight: 700; }
  button { border: 0; border-radius: 999px; padding: 9px 16px; background: #0b8fa8; color: #fff; font-weight: 700; cursor: pointer; }
  button:hover { background: #086f83; }
  .scene { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .wheel { transform-box: fill-box; transform-origin: center; animation: spin 1.2s linear infinite; }
  .leg { transform-box: fill-box; transform-origin: top center; animation: pedal .55s ease-in-out infinite alternate; }
  .road { animation: scroll 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pedal { from { transform: rotate(-14deg); } to { transform: rotate(14deg); } }
  @keyframes scroll { from { transform: translateX(0); } to { transform: translateX(-90px); } }
  @media (max-width: 640px) {
    .ui { width: calc(100% - 24px); justify-content: center; gap: 8px; padding: 10px 12px; }
    input[type="range"] { width: 34vw; }
    .brand { top: 14px; left: 16px; }
  }
</style>
</head>
<body>
<div class="stage">
  <div class="brand">星芽</div>
  <div class="ui">
    <label for="speed">速度</label>
    <input id="speed" type="range" min="0.3" max="3" step="0.1" value="1">
    <span id="speedValue">1.0×</span>
    <button id="pause" type="button">暂停</button>
  </div>
  <svg class="scene" viewBox="0 0 900 520" preserveAspectRatio="xMidYMid slice" role="img" aria-label="戴墨镜的水豚在海滩骑自行车">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fd8ff"/><stop offset="1" stop-color="#e9f9ff"/></linearGradient>
      <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fa8c9"/><stop offset="1" stop-color="#74d7e8"/></linearGradient>
      <linearGradient id="sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7dfa4"/><stop offset="1" stop-color="#e9bf72"/></linearGradient>
    </defs>
    <rect width="900" height="300" fill="url(#sky)"/>
    <circle cx="760" cy="78" r="44" fill="#ffe680" opacity=".95"/>
    <path d="M0 250 Q 120 210 240 250 T 480 250 T 720 250 T 960 250 V 520 H 0 Z" fill="url(#sea)"/>
    <path d="M0 286 Q 90 260 180 286 T 360 286 T 540 286 T 720 286 T 900 286" fill="none" stroke="#e9ffff" stroke-width="7" opacity=".7"/>
    <path d="M0 312 Q 110 288 220 312 T 440 312 T 660 312 T 880 312" fill="none" stroke="#ffffff" stroke-width="4" opacity=".5"/>
    <path d="M0 360 Q 180 330 360 360 T 720 360 T 1080 360 V 520 H 0 Z" fill="url(#sand)"/>
    <g class="road" stroke="#b9854b" stroke-width="5" opacity=".45">
      <line x1="0" y1="470" x2="900" y2="470"/>
      <line x1="30" y1="487" x2="100" y2="487"/>
      <line x1="180" y1="487" x2="250" y2="487"/>
      <line x1="330" y1="487" x2="400" y2="487"/>
      <line x1="480" y1="487" x2="550" y2="487"/>
      <line x1="630" y1="487" x2="700" y2="487"/>
      <line x1="780" y1="487" x2="850" y2="487"/>
    </g>
    <g id="bike" transform="translate(290 285)">
      <circle class="wheel" cx="0" cy="120" r="58" fill="none" stroke="#263238" stroke-width="10"/>
      <circle class="wheel" cx="190" cy="120" r="58" fill="none" stroke="#263238" stroke-width="10"/>
      <line x1="0" y1="120" x2="85" y2="35" stroke="#263238" stroke-width="9"/>
      <line x1="190" y1="120" x2="85" y2="35" stroke="#263238" stroke-width="9"/>
      <line x1="0" y1="120" x2="95" y2="120" stroke="#263238" stroke-width="9"/>
      <line x1="95" y1="120" x2="85" y2="35" stroke="#263238" stroke-width="9"/>
      <line x1="85" y1="35" x2="65" y2="-8" stroke="#263238" stroke-width="9"/>
      <line x1="45" y1="-12" x2="92" y2="-12" stroke="#263238" stroke-width="9"/>
      <circle cx="95" cy="120" r="14" fill="none" stroke="#263238" stroke-width="6"/>
      <path d="M95 120 L120 96 L145 120 Z" fill="none" stroke="#263238" stroke-width="5"/>
    </g>
    <g id="capybara" transform="translate(340 155)">
      <ellipse cx="80" cy="80" rx="82" ry="52" fill="#b9855a"/>
      <ellipse cx="80" cy="80" rx="65" ry="37" fill="#c99a6b"/>
      <circle cx="18" cy="45" r="38" fill="#b9855a"/>
      <ellipse cx="0" cy="52" rx="22" ry="17" fill="#a9744b"/>
      <circle cx="7" cy="44" r="4" fill="#2b1d16"/>
      <rect x="-8" y="28" width="52" height="22" rx="10" fill="#1e2a30"/>
      <rect x="-2" y="33" width="16" height="7" rx="3" fill="#7fe3ff" opacity=".55"/>
      <rect x="22" y="33" width="16" height="7" rx="3" fill="#7fe3ff" opacity=".55"/>
      <path d="M-8 40 Q -26 34 -32 46" fill="none" stroke="#2b1d16" stroke-width="4" stroke-linecap="round"/>
      <path d="M120 52 Q 150 45 160 58" fill="none" stroke="#b9855a" stroke-width="18" stroke-linecap="round"/>
      <path d="M60 120 L42 176 L22 206" fill="none" stroke="#a9744b" stroke-width="13" stroke-linecap="round" class="leg"/>
      <path d="M104 120 L122 176 L142 206" fill="none" stroke="#a9744b" stroke-width="13" stroke-linecap="round" class="leg"/>
      <path d="M150 65 Q 180 70 198 52" fill="none" stroke="#b9855a" stroke-width="16" stroke-linecap="round"/>
    </g>
    <g fill="#fff" opacity=".8">
      <ellipse cx="170" cy="180" rx="42" ry="12"/>
      <ellipse cx="620" cy="200" rx="54" ry="14"/>
      <ellipse cx="760" cy="160" rx="30" ry="9"/>
    </g>
    <g fill="#6fbf73">
      <path d="M70 410 q 12 -60 30 0 q -14 16 -30 0"/>
      <path d="M820 430 q 10 -52 26 0 q -12 14 -26 0"/>
    </g>
  </svg>
</div>
<script>
  const speed = document.getElementById('speed');
  const speedValue = document.getElementById('speedValue');
  const pause = document.getElementById('pause');
  const wheels = [...document.querySelectorAll('.wheel')];
  const legs = [...document.querySelectorAll('.leg')];
  let rate = 1;
  let paused = false;
  let started = performance.now();
  let offset = 0;
  function applyRate() {
    const duration = 1.2 / rate;
    wheels.forEach((el) => { el.style.animationDuration = duration + 's'; });
    legs.forEach((el) => { el.style.animationDuration = (0.55 / rate) + 's'; });
    speedValue.textContent = rate.toFixed(1) + '×';
  }
  speed.addEventListener('input', () => {
    rate = Number(speed.value);
    applyRate();
  });
  pause.addEventListener('click', () => {
    paused = !paused;
    pause.textContent = paused ? '继续' : '暂停';
    document.querySelectorAll('.wheel, .leg, .road').forEach((el) => {
      el.style.animationPlayState = paused ? 'paused' : 'running';
    });
  });
  function tick(now) {
    if (!paused) {
      offset += (now - started) * 0.001 * rate;
      started = now;
    }
    requestAnimationFrame(tick);
  }
  applyRate();
  requestAnimationFrame(tick);
</script>
</body>
</html>`;

function fingerprintNumbers(count) {
  return JSON.stringify(Array.from({ length: count }, (_, index) => ((index * 37 + 11) % 355) + 1));
}

function answerFor(model, prompt) {
  if (prompt.includes('糖果')) return model === 'mock-bad' ? '答案：20' : '答案：21';
  if (prompt.includes('For each of 218 positions')) return fingerprintNumbers(218);
  if (prompt.includes('Provide exactly 233 whole-number')) return fingerprintNumbers(233);
  if (prompt.includes('Fill exactly 247 positions')) return fingerprintNumbers(247);
  if (/capybara|水豚/i.test(prompt)) {
    return model === 'mock-bad' ? '抱歉，无法生成这个 HTML。' : `\`\`\`html\n${CAPYBARA_HTML}\n\`\`\``;
  }
  return 'ok';
}

function sendSse(res, answer) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const chunks = answer.match(/[\s\S]{1,80}/g) || [''];
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
    })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
}

export async function createMockServer() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'mock-good', object: 'model' }, { id: 'mock-bad', object: 'model' }],
      }));
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'bad json' } }));
          return;
        }
        const messages = parsed.messages || [];
        const prompt = String(messages[messages.length - 1]?.content || '');
        sendSse(res, answerFor(parsed.model, prompt));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    server,
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const mock = await createMockServer();
  console.log(JSON.stringify({ port: mock.port, url: `http://127.0.0.1:${mock.port}/v1` }));
}
