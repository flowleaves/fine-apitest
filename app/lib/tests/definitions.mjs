/**
 * 三项固定测试的定义。
 *
 * 变更记录：
 * - 2026-11-01：移除「鹈鹕 · SVG」「鹈鹕 · HTML 动画」，新增「水豚 · 海滩骑行 HTML」。
 * - 2026-11-02：三项测试默认不再设置 max_tokens，输出上限交给上游；需要限制时用 --max-tokens。
 * - 2026-11-02：水豚 HTML 提示词改为简体中文版，简化要求，避免不必要的复杂性。
 *
 * 设计完成后进入运行期：除非用户明确要求修改项目，否则只运行测试、写报告，
 * 不再改动题目、判分、数据结构或代码。
 */

export const CANDY_BAG_V1_PROMPT = `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨，允许在袋内按形状挑选，但无法辨认口味，已取出的糖果不能放回）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定分别摸出多少颗圆形糖果和多少颗五角星形糖果，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）
苹果味 桃子味 西瓜味
圆形 7 9 8
五角星形 7 6 4`;

export const CANDY_REFERENCE = '21';

export const CAPYBARA_HTML_PROMPT = `制作一个独立的HTML动画，展示一只戴着太阳镜、在阳光明媚的海滩骑自行车的水豚。用可爱、色彩丰富的SVG卡通风格，搭配沙滩和海浪。

添加速度滑块（0.3×–3.0×）用于控制循环和方向盘旋转，并加一个暂停/继续按钮。

将艺术中文文字“星芽”置于左上角。

只使用内联SVG、CSS和原版JavaScript。保持动画流畅，设计美观，布局响应灵敏。没有外部依赖。

只输出完整的HTML代码。实现简单，避免不必要的复杂性。`;

export const TESTS = [
  {
    id: 'candy',
    name: '糖果测试',
    kind: 'candy',
    prompt: CANDY_BAG_V1_PROMPT,
    requests: 1,
  },
  {
    id: 'fingerprint',
    name: '模型指纹检测',
    kind: 'fingerprint',
    prompt: null,
    requests: 3,
  },
  {
    id: 'capybara-html',
    name: '水豚 · 海滩骑行 HTML',
    kind: 'artifact',
    artifact: 'html',
    fileName: 'capybara.html',
    prompt: CAPYBARA_HTML_PROMPT,
    requests: 1,
  },
];

export const TEST_IDS = TESTS.map((test) => test.id);
