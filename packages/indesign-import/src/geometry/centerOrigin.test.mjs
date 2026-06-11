// centerOrigin.mjs — content↔scene 좌표 변환 SSOT 단위 테스트.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  halvesOf,
  contentToScene,
  sceneToContent,
  contentToSceneX,
  contentToSceneY,
  sceneToContentX,
  sceneToContentY,
} from './centerOrigin.mjs';

test('halvesOf: 폭/높이의 절반', () => {
  assert.deepStrictEqual(halvesOf(2539.37, 1753.94), { halfW: 1269.685, halfH: 876.97 });
});

test('content→scene: 좌상단원점 → 중앙원점(−half 평행이동)', () => {
  const { halfW, halfH } = halvesOf(2540, 1754);
  // 콘텐츠 중심(half, half) 은 scene 원점(0,0)
  assert.deepStrictEqual(contentToScene(1270, 877, halfW, halfH), { x: 0, y: 0 });
  // 콘텐츠 좌상단(0,0) 은 scene (−half,−half)
  assert.deepStrictEqual(contentToScene(0, 0, halfW, halfH), { x: -1270, y: -877 });
});

test('scene→content: 중앙원점 → 좌상단원점(+half 평행이동)', () => {
  const { halfW, halfH } = halvesOf(2540, 1754);
  assert.deepStrictEqual(sceneToContent(0, 0, halfW, halfH), { x: 1270, y: 877 });
  assert.deepStrictEqual(sceneToContent(-1270, -877, halfW, halfH), { x: 0, y: 0 });
});

test('왕복 불변식: sceneToContent(contentToScene(p)) == p (그리고 역방향)', () => {
  const { halfW, halfH } = halvesOf(2539.37, 1753.94);
  for (const [x, y] of [[0, 0], [658.46, -200], [-927.17, 480.5], [1269.685, 876.97]]) {
    const back = sceneToContent(
      contentToScene(x, y, halfW, halfH).x,
      contentToScene(x, y, halfW, halfH).y,
      halfW,
      halfH
    );
    assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9, `왕복 불일치 (${x},${y}) → (${back.x},${back.y})`);
  }
});

test('스칼라 헬퍼는 벡터 헬퍼와 일치', () => {
  const { halfW, halfH } = halvesOf(1000, 600);
  assert.strictEqual(contentToSceneX(700, halfW), contentToScene(700, 0, halfW, halfH).x);
  assert.strictEqual(contentToSceneY(450, halfH), contentToScene(0, 450, halfW, halfH).y);
  assert.strictEqual(sceneToContentX(200, halfW), sceneToContent(200, 0, halfW, halfH).x);
  assert.strictEqual(sceneToContentY(150, halfH), sceneToContent(0, 150, halfW, halfH).y);
});
