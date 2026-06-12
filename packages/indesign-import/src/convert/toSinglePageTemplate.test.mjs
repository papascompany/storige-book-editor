// toSinglePageTemplate(PSD 경로) — psd-artwork 출력 계약 고정.
//
// 의도된 출력 계약 변경(2026-06-12, 캔버스 taint 방어): 변환기 image 출력에
// crossOrigin:'anonymous' 명시. admin 이 src 를 스토리지 URL 로 치환하면 편집기에서
// 교차출처 로드 — crossOrigin 없으면 fabric 비-CORS 로드 → toDataURL SecurityError.
import test from 'node:test';
import assert from 'node:assert/strict';
import { toSinglePageTemplate } from './toSinglePageTemplate.mjs';
import { ARTWORK_LOCK } from './artworkLock.mjs';

const parsed = {
  widthPx: 300,
  heightPx: 200,
  dpi: 150,
  layers: [],
  warnings: [],
  isCmyk: false,
};
const background = {
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  widthPx: 600,
  heightPx: 400,
};

test('psd-artwork: crossOrigin anonymous 명시 + 기존 계약(잠금/중앙원점/스케일) 불변', () => {
  const { draftTemplateDto: dto } = toSinglePageTemplate(parsed, background, { name: 'T' });
  const art = dto.canvasData.objects.find((o) => o.id === 'psd-artwork');
  assert.ok(art, 'psd-artwork 존재');
  assert.strictEqual(art.type, 'image');
  assert.strictEqual(art.crossOrigin, 'anonymous', 'taint 방어 crossOrigin 명시');
  // 기존 계약 회귀 금지
  assert.strictEqual(art.src, background.dataUrl);
  assert.strictEqual(art.originX, 'center');
  assert.strictEqual(art.originY, 'center');
  assert.strictEqual(art.left, 0);
  assert.strictEqual(art.top, 0);
  for (const [k, v] of Object.entries(ARTWORK_LOCK)) {
    assert.deepStrictEqual(art[k], v, `ARTWORK_LOCK.${k}`);
  }
  // 150dpi 동률 소스 → 캔버스 = PSD px, 배경 600px → scale 0.5
  assert.strictEqual(dto.canvasData.width, 300);
  assert.strictEqual(dto.canvasData.height, 200);
  assert.strictEqual(art.scaleX, 0.5);
  assert.strictEqual(art.scaleY, 0.5);
});

test('배경 없음(null) → image 객체 미출력 (crossOrigin 변경과 무관하게 기존 동작 불변)', () => {
  const { draftTemplateDto: dto } = toSinglePageTemplate(parsed, null, { name: 'T' });
  assert.ok(!dto.canvasData.objects.some((o) => o.type === 'image'), 'image 없음');
});
