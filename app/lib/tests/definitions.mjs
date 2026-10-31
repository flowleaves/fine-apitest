/**
 * 三项固定测试的定义。
 *
 * 变更记录：
 * - 2026-11-01：移除「鹈鹕 · SVG」「鹈鹕 · HTML 动画」，新增「水豚 · 海滩骑行 HTML」。
 *
 * 设计完成后进入运行期：除非用户明确要求修改项目，否则只运行测试、写报告，
 * 不再改动题目、判分、数据结构或代码。
 */

export const CANDY_BAG_V1_PROMPT = `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨，允许在袋内按形状挑选，但无法辨认口味，已取出的糖果不能放回）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定分别摸出多少颗圆形糖果和多少颗五角星形糖果，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）
苹果味 桃子味 西瓜味
圆形 7 9 8
五角星形 7 6 4`;

export const CANDY_REFERENCE = '21';

export const CAPYBARA_HTML_PROMPT = `Create a self-contained HTML animation featuring a cool capybara wearing sunglasses and riding a bicycle along a sunny beach. Use a beautiful, polished cartoon-style SVG illustration with ocean waves, golden sand, and a relaxing summer atmosphere.

Add a speed control slider (0.3×–3.0×) that smoothly adjusts the bicycle's movement, wheel rotation, and pedaling animation in real time. Include a pause/resume button.

Place the Chinese text **「星芽」** in elegant artistic typography at the top-left corner of the screen. Make it visually distinctive and stylish.

Requirements:
- Smooth, continuous animation with synchronized movements.
- Responsive layout for desktop and mobile.
- Beautiful colors, detailed illustrations, and polished UI.
- Use inline SVG, CSS, and vanilla JavaScript only.
- No external libraries, images, or dependencies.
- Deliver a complete, standalone HTML file that runs directly in a browser.

Return only the complete HTML source code.`;

export const TESTS = [
  {
    id: 'candy',
    name: '糖果测试',
    kind: 'candy',
    prompt: CANDY_BAG_V1_PROMPT,
    requests: 1,
    maxTokens: 4096,
  },
  {
    id: 'fingerprint',
    name: '模型指纹检测',
    kind: 'fingerprint',
    prompt: null,
    requests: 3,
    maxTokens: 4096,
  },
  {
    id: 'capybara-html',
    name: '水豚 · 海滩骑行 HTML',
    kind: 'artifact',
    artifact: 'html',
    fileName: 'capybara.html',
    prompt: CAPYBARA_HTML_PROMPT,
    requests: 1,
    maxTokens: 8192,
  },
];

export const TEST_IDS = TESTS.map((test) => test.id);
