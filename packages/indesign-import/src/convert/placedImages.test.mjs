// placed 이미지 복원(A5) 테스트 — 디스크립터(좌표/크롭 식) + applyPlacedImages(매칭/베이크) +
// 렌더러 패리티 + 하위호환(미제공 시 기존 플레이스홀더/경고 보존).
//
// 좌표 검증 기준(설계 검증 보고 §1): 배치 SSOT = inner <Image> ItemTransform.
//   imgLocal = innerIT · GraphicBounds, visible = imgLocal ∩ frame bbox,
//   소스 크롭 = inverse(innerIT)·visible (GB 0..1 정규화), 객체 = 기존 non-path 분기 동일식.
// 베이크는 Node(sharp) 경로로 픽셀 단위 검증(브라우저 canvas 경로는 admin 수동 검증).
import { test } from 'node:test';
import assert from 'node:assert';
import { toSpreadTemplate } from './toSpreadTemplate.mjs';
import { applyPlacedImages, bakeCroppedImage } from './placedImages.mjs';
import { buildArtworkSvg } from '../raster/rasterize.mjs';
import { buildPreviewSvg } from '../preview/svg.mjs';
import { parseIdml } from '../idml/reader.mjs';
import { extractDesignPackage } from '../index.mjs';

const mm2pt = (mm) => (mm * 72) / 25.4;
const PT2PX = 150 / 72; // pt → px@150dpi

// 3페이지(날개없음) 표지: 표지210 + 책등10 + 표지210 = 430mm × 297mm (기존 테스트와 동일 규약)
function makeDoc(items) {
  const h = mm2pt(297);
  return {
    bleedPt: mm2pt(3),
    fonts: [],
    colors: new Map(),
    pages: [
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: -mm2pt(215), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(10), heightPt: h, leftSpreadPt: -mm2pt(5), topSpreadPt: -h / 2 },
      { widthPt: mm2pt(210), heightPt: h, leftSpreadPt: mm2pt(5), topSpreadPt: -h / 2 },
    ],
    items,
  };
}

const I = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// 기준 placed 프레임: 스프레드 중앙 200×160pt, inner 0.5 스케일 + 이동.
//   img local x ∈ [-120, 180], y ∈ [-80, 120] → visible = frame [-100,100]×[-80,80]
//   소스 GB 크롭: x [40, 440] (좌 20pt 갭은 frame 밖→x0=40 아님? → (-100+120)/0.5=40), y [0, 320]
//   → crop = { x: 40/600, y: 0, w: 400/600, h: 320/400 } = { 0.066667, 0, 0.666667, 0.8 }
const placedItem = (self, overrides = {}) => ({
  self,
  type: 'Rectangle',
  fillColor: 'Color/None',
  transform: I,
  bbox: { minX: -100, minY: -80, maxX: 100, maxY: 80, cx: 0, cy: 0, w: 200, h: 160, pointCount: 4 },
  placedContent: 'Image',
  placed: {
    contentType: 'Image',
    innerTransform: [0.5, 0, 0, 0.5, -120, -80],
    graphicBounds: { left: 0, top: 0, right: 600, bottom: 400 },
    linkUri: 'file:/x/Links/photo.jpg',
    linkFileName: 'photo.jpg',
    ...overrides.placed,
  },
  ...overrides.item,
});

// ── 1. 디스크립터: 크롭 좌표식 ──

test('placed 디스크립터: visible 교차 → 정규화 소스 크롭 + 타깃 기하(축정렬)', () => {
  const { objects } = toSpreadTemplate(makeDoc([placedItem('pf')]));
  const o = objects[0];
  assert.strictEqual(o.meta.placeholder, 'placed-image', '플레이스홀더 표식 유지');
  const p = o.meta.placed;
  assert.ok(p, 'meta.placed 디스크립터 존재');
  assert.strictEqual(p.linkFileName, 'photo.jpg');
  assert.ok(!p.unsupported, '지원 케이스');
  // 소스 크롭(GB 0..1): 손계산 (40/600, 0/400, 400/600, 320/400)
  assert.ok(Math.abs(p.crop.x - 40 / 600) < 1e-4, `crop.x ${p.crop.x}`);
  assert.ok(Math.abs(p.crop.y - 0) < 1e-4, `crop.y ${p.crop.y}`);
  assert.ok(Math.abs(p.crop.w - 400 / 600) < 1e-4, `crop.w ${p.crop.w}`);
  assert.ok(Math.abs(p.crop.h - 320 / 400) < 1e-4, `crop.h ${p.crop.h}`);
  assert.strictEqual(p.bakeFlipX, false);
  assert.strictEqual(p.bakeFlipY, false);
  // 타깃: visible 중심 = 프레임 중심 = 스프레드 중앙 → scene (0,0). 치수 = 200×160pt → px@150
  assert.ok(Math.abs(p.target.left - 0) < 0.5 && Math.abs(p.target.top - 0) < 0.5, `target center (${p.target.left},${p.target.top})`);
  assert.ok(Math.abs(p.target.width - 200 * PT2PX) < 0.5, `target.width ${p.target.width}`);
  assert.ok(Math.abs(p.target.height - 160 * PT2PX) < 0.5, `target.height ${p.target.height}`);
  assert.strictEqual(p.target.angle, 0);
  assert.strictEqual(p.target.flipY, false);
});

test('placed 디스크립터: inner 음수 a(x플립) → 크롭 미러 + bakeFlipX', () => {
  // a=-0.5, e=+180: img local x extent 동일 [-120,180], GB 크롭은 반대편 [160,560]
  const { objects } = toSpreadTemplate(
    makeDoc([placedItem('pf', { placed: { innerTransform: [-0.5, 0, 0, 0.5, 180, -80] } })])
  );
  const p = objects[0].meta.placed;
  assert.ok(Math.abs(p.crop.x - 160 / 600) < 1e-4, `crop.x ${p.crop.x}`);
  assert.ok(Math.abs(p.crop.w - 400 / 600) < 1e-4, `crop.w ${p.crop.w}`);
  assert.strictEqual(p.bakeFlipX, true, 'x 플립은 픽셀 베이크 대상');
  assert.strictEqual(p.target.flipY, false, '프레임 자체는 비플립');
});

test('placed 디스크립터: 회전+flipY 프레임(LA-383 실측 형태) → angle/-90 + flipY, 치수는 로컬 기준', () => {
  // frame T = [0,-1,-1,0,0,0]: rot -90° + flipY (det<0) — LA-383 u8c6/u9d3 과 동일 형태
  const { objects } = toSpreadTemplate(
    makeDoc([placedItem('pf', { item: { transform: { a: 0, b: -1, c: -1, d: 0, e: 0, f: 0 } } })])
  );
  const p = objects[0].meta.placed;
  assert.strictEqual(p.target.angle, -90);
  assert.strictEqual(p.target.flipY, true);
  // 회전돼도 width/height 는 로컬(회전 전) 치수 — fabric 이 angle 로 회전
  assert.ok(Math.abs(p.target.width - 200 * PT2PX) < 0.5, `target.width ${p.target.width}`);
  assert.ok(Math.abs(p.target.height - 160 * PT2PX) < 0.5, `target.height ${p.target.height}`);
  assert.ok(Math.abs(p.target.left) < 0.5 && Math.abs(p.target.top) < 0.5, '중앙 프레임 → scene (0,0)');
});

test('placed 디스크립터: 회전 inner IT(b/c≠0)는 unsupported — 플레이스홀더 폴백 표식', () => {
  const { objects, warnings } = toSpreadTemplate(
    makeDoc([placedItem('pf', { placed: { innerTransform: [0.5, 0.1, 0, 0.5, -120, -80] } })])
  );
  const p = objects[0].meta.placed;
  assert.strictEqual(p.unsupported, 'rotated-inner-transform');
  assert.ok(!p.crop, '크롭 미산출');
  // 미제공 출력 불변 원칙: toSpreadTemplate 단계에서는 추가 경고 없음(기존 placed 경고만)
  assert.ok(warnings.some((w) => w.startsWith('배치 이미지 1개')), '기존 placed 경고 유지');
  assert.ok(!warnings.some((w) => w.includes('rotated')), 'unsupported 경고는 이미지 제공 시에만');
});

test('placed 디스크립터: 링크 파일명 없으면 meta.placed 자체를 emit 하지 않는다(기존과 동일)', () => {
  const { objects } = toSpreadTemplate(
    makeDoc([placedItem('pf', { placed: { linkFileName: null, linkUri: null } })])
  );
  assert.strictEqual(objects[0].meta.placed, undefined);
  assert.strictEqual(objects[0].meta.placeholder, 'placed-image');
});

// ── 2. applyPlacedImages: 매칭/미매칭/대소문자/다중 프레임/하위호환 ──

async function makeTestPng() {
  // 60×40: 좌 30px 빨강 / 우 30px 파랑 (sharp raw → png)
  const sharp = (await import('sharp')).default;
  const W = 60, H = 40;
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      if (x < W / 2) raw[i] = 255;
      else raw[i + 2] = 255;
    }
  const buf = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function rawOf(dataUrl) {
  const sharp = (await import('sharp')).default;
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  return sharp(buf).raw().toBuffer({ resolveWithObject: true });
}

test('applyPlacedImages: 매칭 → 동일 인덱스에 plain image 객체 치환(z-order/id 보존, 잠금 없음)', async () => {
  const result = toSpreadTemplate(
    makeDoc([
      { self: 'under', type: 'Rectangle', fillColor: 'Color/None', transform: I, bbox: { cx: 0, cy: 0, w: 100, h: 100, pointCount: 4 } },
      placedItem('pf'),
      { self: 'over', type: 'Rectangle', fillColor: 'Color/None', transform: I, bbox: { cx: 0, cy: 0, w: 100, h: 100, pointCount: 4 } },
    ])
  );
  const png = await makeTestPng();
  const out = await applyPlacedImages(result, new Map([['photo.jpg', png]]));
  assert.strictEqual(out.placedApplied.matched, 1);
  assert.strictEqual(out.placedApplied.failed.length, 0);
  const objs = out.draftTemplateDto.canvasData.objects;
  assert.strictEqual(objs.length, 3, '객체 수 불변');
  assert.strictEqual(objs[0].id, 'idml-under', 'z-order 보존(아래)');
  assert.strictEqual(objs[2].id, 'idml-over', 'z-order 보존(위)');
  const img = objs[1];
  assert.strictEqual(img.type, 'image');
  assert.strictEqual(img.id, 'idml-pf', '플레이스홀더 id 승계');
  assert.ok(img.src.startsWith('data:image/png;base64,'), '베이크 PNG dataURL');
  // 의도된 출력 계약 변경(2026-06-12, 캔버스 taint 방어): admin 동반업로드로 src 가
  // 스토리지 URL 로 치환되면 편집기에서 교차출처 로드 — crossOrigin 명시 필수.
  assert.strictEqual(img.crossOrigin, 'anonymous', 'placed image crossOrigin 명시');
  // 베이크 치수 = 소스 60×40 의 정규화 크롭: round(0.0667*60)=4.. w=round(0.6667*60)=40, h=round(0.8*40)=32
  assert.strictEqual(img.width, 40);
  assert.strictEqual(img.height, 32);
  // scale = 타깃 px / 베이크 px → 표시 치수 = 200×160pt @150dpi
  assert.ok(Math.abs(img.width * img.scaleX - 200 * PT2PX) < 0.5, `display w ${img.width * img.scaleX}`);
  assert.ok(Math.abs(img.height * img.scaleY - 160 * PT2PX) < 0.5, `display h ${img.height * img.scaleY}`);
  // FULL 모드 편집 가능: 잠금/플레이스홀더 표식 없음
  assert.strictEqual(img.selectable, true);
  assert.strictEqual(img.evented, true);
  assert.strictEqual(img.lockMovementX, undefined, 'ARTWORK_LOCK 미적용');
  assert.strictEqual(img.isUserAdded, false);
  assert.strictEqual(img.meta.placeholder, undefined);
  assert.strictEqual(img.meta.placed, undefined);
  assert.ok(img.meta.anchor, '앵커 유지');
  // 직렬화 함정 금지: clipPath/fabric 네이티브 크롭 키 부재 + JSON 왕복 안전
  assert.strictEqual(img.clipPath, undefined);
  assert.strictEqual(img.cropX, undefined);
  assert.strictEqual(img.cropY, undefined);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(img)), img, 'plain JSON 왕복');
  // placed 경고 소거(전건 복원)
  assert.ok(!out.warnings.some((w) => w.startsWith('배치 이미지')), 'placed 경고 제거');
});

test('applyPlacedImages: 미제공(undefined) → 디스크립터만 제거, 플레이스홀더/경고 완전 보존', async () => {
  const result = toSpreadTemplate(makeDoc([placedItem('pf')]));
  const out = await applyPlacedImages(result, undefined);
  const o = out.draftTemplateDto.canvasData.objects[0];
  assert.strictEqual(o.type, 'rect');
  assert.strictEqual(o.fill, '#e9e9e9', '회색 플레이스홀더 유지');
  assert.strictEqual(o.meta.placed, undefined, '디스크립터 제거(저장 산출물 오염 금지)');
  assert.strictEqual(o.meta.placeholder, 'placed-image');
  assert.deepStrictEqual(out.warnings, result.warnings, '경고 불변');
  // 원본(디스크립터 제외)과 동일 직렬화 — 키 순서 보존 검증
  const orig = result.draftTemplateDto.canvasData.objects[0];
  const stripped = { ...orig, meta: { ...orig.meta } };
  delete stripped.meta.placed;
  assert.strictEqual(JSON.stringify(o), JSON.stringify(stripped), '바이트 동일(키 순서 포함)');
});

test('applyPlacedImages: 빈 linkedImages(빈 Map/빈 객체) = 미제공과 동일 — 경고 미발생, 디스크립터만 제거', async () => {
  const result = toSpreadTemplate(makeDoc([placedItem('pf')]));
  const base = await applyPlacedImages(result, undefined);
  for (const empty of [new Map(), {}]) {
    const out = await applyPlacedImages(result, empty);
    assert.deepStrictEqual(out.placedApplied, { matched: 0, failed: [] });
    assert.ok(
      !out.warnings.some((w) => w.includes('동반 업로드 매칭 실패')),
      '빈 컬렉션에 매칭 실패 경고를 만들지 않는다'
    );
    assert.deepStrictEqual(out.warnings, result.warnings, '경고 불변(기존 placed 경고 그대로)');
    assert.strictEqual(
      JSON.stringify(out.draftTemplateDto),
      JSON.stringify(base.draftTemplateDto),
      '미제공(undefined) 경로와 바이트 동일'
    );
  }
});

test('applyPlacedImages: failed 순서는 객체 인덱스 순 — 베이크 완료 타이밍(비동기)과 무관', async () => {
  const result = toSpreadTemplate(
    makeDoc([
      placedItem('pf1', { placed: { linkFileName: 'corrupt.jpg', linkUri: 'file:/x/Links/corrupt.jpg' } }),
      placedItem('pf2', { placed: { linkFileName: 'missing.jpg', linkUri: 'file:/x/Links/missing.jpg' } }),
    ])
  );
  // pf1(인덱스 0): 제공됐지만 깨진 이미지 → 비동기 bake-failed 푸시.
  // pf2(인덱스 1): 미제공 → 동기 not-provided 푸시(정렬 없으면 이쪽이 먼저 온다).
  const out = await applyPlacedImages(result, {
    'corrupt.jpg': 'data:image/png;base64,@@not-an-image@@',
  });
  assert.deepStrictEqual(
    out.placedApplied.failed.map((f) => f.fileName),
    ['corrupt.jpg', 'missing.jpg'],
    '객체 인덱스 순 정렬'
  );
  assert.ok(out.placedApplied.failed[0].reason.startsWith('bake-failed'), out.placedApplied.failed[0].reason);
  assert.strictEqual(out.placedApplied.failed[1].reason, 'not-provided');
  // 내부 정렬용 index 키가 결과에 누출되지 않는다
  assert.deepStrictEqual(Object.keys(out.placedApplied.failed[0]), ['fileName', 'reason']);
});

test('applyPlacedImages: 미매칭 → 플레이스홀더+placed 경고 유지 + 매칭 실패 경고 구분', async () => {
  const result = toSpreadTemplate(makeDoc([placedItem('pf')]));
  const png = await makeTestPng();
  const out = await applyPlacedImages(result, { 'other.jpg': png });
  assert.strictEqual(out.placedApplied.matched, 0);
  const o = out.draftTemplateDto.canvasData.objects[0];
  assert.strictEqual(o.type, 'rect');
  assert.strictEqual(o.fill, '#e9e9e9');
  assert.ok(out.warnings.some((w) => w.startsWith('배치 이미지 1개')), 'placed 경고(미복원 1건) 유지');
  assert.ok(out.warnings.some((w) => w.includes('동반 업로드 매칭 실패: photo.jpg')), '매칭 실패 경고');
});

test('applyPlacedImages: 대소문자 무시 매칭(PHOTO.JPG ↔ photo.jpg)', async () => {
  const result = toSpreadTemplate(makeDoc([placedItem('pf')]));
  const png = await makeTestPng();
  const out = await applyPlacedImages(result, { 'PHOTO.JPG': png });
  assert.strictEqual(out.placedApplied.matched, 1);
  assert.strictEqual(out.draftTemplateDto.canvasData.objects[0].type, 'image');
});

test('applyPlacedImages: 다중 프레임 동일 링크 — 둘 다 복원, 경고는 dedupe', async () => {
  const result = toSpreadTemplate(makeDoc([placedItem('pf1'), placedItem('pf2')]));
  const png = await makeTestPng();
  const out = await applyPlacedImages(result, { 'photo.jpg': png });
  assert.strictEqual(out.placedApplied.matched, 2);
  const objs = out.draftTemplateDto.canvasData.objects;
  assert.strictEqual(objs[0].type, 'image');
  assert.strictEqual(objs[1].type, 'image');
  assert.strictEqual(objs[0].id, 'idml-pf1');
  assert.strictEqual(objs[1].id, 'idml-pf2');
  // 미제공 케이스 dedupe 검증(같은 파일 2프레임 → 실패 경고 1건)
  const out2 = await applyPlacedImages(result, { 'nope.jpg': png });
  const missWarnings = out2.warnings.filter((w) => w.includes('동반 업로드 매칭 실패: photo.jpg'));
  assert.strictEqual(missWarnings.length, 1, '동일 파일명 중복 경고 dedupe');
  assert.ok(out2.warnings.some((w) => w.startsWith('배치 이미지 2개')), '미복원 2건 카운트');
});

test('applyPlacedImages: unsupported 디스크립터 + 이미지 제공 → 플레이스홀더 유지 + 미지원 경고', async () => {
  const result = toSpreadTemplate(
    makeDoc([placedItem('pf', { placed: { innerTransform: [0.5, 0.1, 0, 0.5, -120, -80] } })])
  );
  const png = await makeTestPng();
  const out = await applyPlacedImages(result, { 'photo.jpg': png });
  assert.strictEqual(out.placedApplied.matched, 0);
  assert.strictEqual(out.draftTemplateDto.canvasData.objects[0].type, 'rect');
  assert.ok(
    out.warnings.some((w) => w.includes('복원 미지원') && w.includes('rotated-inner-transform')),
    '미지원 사유 경고'
  );
});

// ── 3. 베이크 픽셀(크롭/플립) ──

test('bakeCroppedImage: 우반 크롭 → 전부 파랑, flipX 베이크 → 좌우 미러', async () => {
  const png = await makeTestPng(); // 좌 빨강 / 우 파랑 (60×40)
  // 우반 크롭 (x 0.5..1.0)
  const right = await bakeCroppedImage(png, { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.strictEqual(right.widthPx, 30);
  assert.strictEqual(right.heightPx, 40);
  const r1 = await rawOf(right.dataUrl);
  const px1 = (x, y) => Array.from(r1.data.slice((y * r1.info.width + x) * r1.info.channels, (y * r1.info.width + x) * r1.info.channels + 3));
  assert.deepStrictEqual(px1(5, 20), [0, 0, 255], '우반 크롭 좌측 = 파랑');
  assert.deepStrictEqual(px1(25, 20), [0, 0, 255], '우반 크롭 우측 = 파랑');
  // 전체 + flipX: 좌(원래 빨강) ↔ 우(원래 파랑) 미러
  const flipped = await bakeCroppedImage(png, { x: 0, y: 0, w: 1, h: 1 }, { flipX: true });
  const r2 = await rawOf(flipped.dataUrl);
  const px2 = (x, y) => Array.from(r2.data.slice((y * r2.info.width + x) * r2.info.channels, (y * r2.info.width + x) * r2.info.channels + 3));
  assert.deepStrictEqual(px2(5, 20), [0, 0, 255], 'flipX 후 좌측 = 파랑');
  assert.deepStrictEqual(px2(55, 20), [255, 0, 0], 'flipX 후 우측 = 빨강');
});

test('bakeCroppedImage: JPEG 소스 → JPEG(q0.9) 베이크, 치수/픽셀 의미 보존', async () => {
  const sharp = (await import('sharp')).default;
  const png = await makeTestPng(); // 좌 빨강 / 우 파랑 (60×40)
  const jpgBuf = await sharp(Buffer.from(png.split(',')[1], 'base64')).jpeg({ quality: 95 }).toBuffer();
  const jpgUrl = 'data:image/jpeg;base64,' + jpgBuf.toString('base64');
  const out = await bakeCroppedImage(jpgUrl, { x: 0.5, y: 0, w: 0.5, h: 1 });
  assert.ok(out.dataUrl.startsWith('data:image/jpeg;base64,'), 'JPEG 소스는 JPEG 유지');
  assert.strictEqual(out.widthPx, 30);
  assert.strictEqual(out.heightPx, 40);
  const meta = await sharp(Buffer.from(out.dataUrl.split(',')[1], 'base64')).metadata();
  assert.strictEqual(meta.format, 'jpeg');
  assert.strictEqual(meta.width, 30);
  assert.strictEqual(meta.height, 40);
  // 우반 크롭 = 파랑 (JPEG 손실 허용 — 우세 채널만 확인)
  const { data, info } = await rawOf(out.dataUrl);
  const c = data.slice((20 * info.width + 15) * info.channels, (20 * info.width + 15) * info.channels + 3);
  assert.ok(c[2] > 200 && c[0] < 80, `우반 크롭 ≈ 파랑: ${Array.from(c)}`);
});

// ── 4. 렌더러 패리티(FLAT 베이크/미리보기) ──

test('렌더러 패리티: placed 이미지의 scale/angle/flipY 가 artwork·preview SVG 에 반영', () => {
  const img = {
    type: 'image',
    id: 'idml-pf',
    src: 'data:image/png;base64,iVBORw0KGgo=',
    originX: 'center',
    originY: 'center',
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    scaleX: 2,
    scaleY: 4,
    angle: -90,
    flipY: true,
    isUserAdded: false,
    meta: { regionRef: null, anchor: { kind: 'canvas', x: 400, y: 300 } },
  };
  const dto = {
    canvasData: { version: '5.3.0', width: 800, height: 600, objects: [img] },
    spreadConfig: { regions: [], totalWidthMm: 135.5, totalHeightMm: 101.6 },
  };
  // artwork SVG(FLAT 베이크 입력): 표시 치수 = width×scaleX, 회전 그룹 + 중심 미러
  const art = buildArtworkSvg(dto);
  assert.ok(art.includes('rotate(-90 400 300)'), `artwork 회전 그룹: ${art}`);
  assert.ok(art.includes('translate(0 600) scale(1 -1)'), 'artwork flipY 미러(중심선 y=300→2·300)');
  assert.ok(art.includes('width="200" height="200"'), 'artwork 표시 치수 = 100×2, 50×4');
  // preview SVG: 동일 의미(출력 스케일 적용 좌표)
  const prev = buildPreviewSvg(dto, { width: 800 }); // scale=1 로 고정해 좌표 그대로
  assert.ok(prev.includes('rotate(-90 400 300)'), 'preview 회전');
  assert.ok(prev.includes('translate(0 600) scale(1 -1)'), 'preview flipY 미러');
  assert.ok(prev.includes('width="200" height="200"'), 'preview 표시 치수');
  // 기존 아트워크(angle/flip 없음)는 transform attr 자체가 없어야 한다(기존 출력 불변)
  const plain = buildPreviewSvg(
    { ...dto, canvasData: { ...dto.canvasData, objects: [{ ...img, angle: 0, flipY: false }] } },
    { width: 800 }
  );
  assert.ok(!/<image[^>]*transform=/.test(plain), '무회전 이미지에 transform 미부착');
});

// ── 5. reader: placed 상세 추출(NFC 파일명 디코드) ──

test('reader: inner ItemTransform/GraphicBounds/Link 파일명(percent-encoded NFD→NFC) 추출', async () => {
  const JSZip = (await import('jszip')).default;
  // '하늘.JPG' 의 NFD percent-encoding (한글 자모 분해 — 실측 IDML 과 동일 형태)
  const nfdUri = 'file:/Users/x/Links/%E1%84%92%E1%85%A1%E1%84%82%E1%85%B3%E1%86%AF.JPG';
  const spreadXml = `<?xml version="1.0" encoding="UTF-8"?>
<idPkg:Spread xmlns:idPkg="http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging">
<Spread Self="s1">
<Page Self="p1" Name="1" GeometricBounds="0 0 400 200" ItemTransform="1 0 0 1 -100 -200"/>
<Rectangle Self="r1" ItemTransform="1 0 0 1 0 0" FillColor="Color/None">
<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>
<PathPointType Anchor="-100 -80"/><PathPointType Anchor="-100 80"/><PathPointType Anchor="100 80"/><PathPointType Anchor="100 -80"/>
</PathPointArray></GeometryPathType></PathGeometry></Properties>
<Image Self="i1" ItemTransform="0.5 0 0 0.5 -120 -80">
<Properties><GraphicBounds Left="0" Top="0" Right="600" Bottom="400"/></Properties>
<Link Self="l1" LinkResourceURI="${nfdUri}"/>
</Image>
</Rectangle>
</Spread>
</idPkg:Spread>`;
  const zip = new JSZip();
  zip.file('Spreads/Spread_s1.xml', spreadXml);
  const buf = await zip.generateAsync({ type: 'uint8array' });
  const doc = await parseIdml(buf);
  const item = doc.items.find((it) => it.self === 'r1');
  assert.strictEqual(item.placedContent, 'Image', '기존 플래그 유지');
  const p = item.placed;
  assert.ok(p, 'placed 상세 추출');
  assert.deepStrictEqual(p.innerTransform, [0.5, 0, 0, 0.5, -120, -80]);
  assert.deepStrictEqual(p.graphicBounds, { left: 0, top: 0, right: 600, bottom: 400 });
  assert.strictEqual(p.linkFileName, '하늘.JPG'.normalize('NFC'), 'NFD 디코드 → NFC 정규화');
  assert.strictEqual(p.linkFileName.length, 6, 'NFC 합성: 자모 5 코드포인트 → 음절 2 + ".JPG" = 6');
});

// ── 6. extractDesignPackage: 순수 IDML vs 패키지 zip 판별 ──

test('extractDesignPackage: designmap.xml 존재 = 순수 IDML(입력 그대로)', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('designmap.xml', '<Document/>');
  zip.file('Spreads/Spread_s1.xml', '<Spread/>');
  const buf = await zip.generateAsync({ type: 'uint8array' });
  const out = await extractDesignPackage(buf);
  assert.strictEqual(out.kind, 'idml');
  assert.strictEqual(out.idmlBuffer, buf, '입력 버퍼 그대로(재압축 금지)');
  assert.strictEqual(out.linkedImages.size, 0);
});

test('extractDesignPackage: 중첩 designmap.xml 만 있는 zip(폴더째 압축, .idml 없음) → 명시 에러', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('MyBook/designmap.xml', '<Document/>');
  zip.file('MyBook/Spreads/Spread_s1.xml', '<Spread/>');
  const buf = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(
    () => extractDesignPackage(buf),
    /IDML 패키지 zip.*\.idml 파일을 넣어주세요/,
    '순수 IDML 오판 대신 사람이 고칠 수 있는 에러'
  );
});

test('extractDesignPackage: 패키지 zip → IDML + 이미지(NFC dataURL) + 디코드 불가 형식 skipped', async () => {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('cover.idml', new Uint8Array([1, 2, 3]));
  zip.file('Links/%photo.jpg'.replace('%', ''), new Uint8Array([0xff, 0xd8, 0xff, 0xe0])); // jpg magic
  zip.file('Links/하늘.png', new Uint8Array([0x89, 0x50])); // NFD 자모 파일명
  zip.file('Links/scan.tif', new Uint8Array([0x49, 0x49]));
  zip.file('__MACOSX/._photo.jpg', new Uint8Array([0]));
  const buf = await zip.generateAsync({ type: 'uint8array' });
  const out = await extractDesignPackage(buf);
  assert.strictEqual(out.kind, 'package');
  assert.ok(out.idmlBuffer && out.idmlBuffer.length === 3, 'IDML 엔트리 추출');
  assert.ok(out.linkedImages.get('photo.jpg')?.startsWith('data:image/jpeg;base64,'), 'jpg dataURL');
  assert.ok(out.linkedImages.has('하늘.png'.normalize('NFC')), 'NFD 파일명 → NFC 키');
  assert.ok(!out.linkedImages.has('._photo.jpg'), '__MACOSX 메타 무시');
  assert.deepStrictEqual(out.skipped, ['scan.tif'], 'TIFF 는 skipped 보고');
});
