// 배치(placed) 이미지 복원 후처리(A5) — toSpreadTemplate 가 emit 한 meta.placed 디스크립터를
// 동반 업로드 이미지(linkedImages: 파일명 → dataURL)와 매칭해, 회색 플레이스홀더를 실제
// fabric image 객체로 '동일 배열 인덱스'에 치환한다(z-order 보존).
//
// 크롭 전략(설계 검증 §2 확정): '크롭 베이크' — 프레임 visible 영역만큼 소스를 픽셀로 잘라
// (inner IT 플립도 미러 베이크) plain image 객체를 만든다. fabric 네이티브 cropX/cropY 는
// preview/raster <image href> 미지원 + width 의미론 충돌 + 교체 시 잔존 왜곡으로 기각.
// clipPath 는 직렬화 함정 — 절대 사용 금지(절대 규칙).
//
// 환경: cropArtwork.mjs 와 동일한 dual-env 패턴.
//   - 브라우저(admin): <img> + <canvas> drawImage 크롭, 플립은 negative-scale draw.
//   - Node(convert-sample/테스트): sharp .extract() + .flop()/.flip().
//
// 하위호환(절대 규칙): linkedImages 미제공 시 meta.placed 디스크립터만 제거하고 나머지는
// 입력 그대로 — 기존 회색 플레이스홀더 + 경고 출력이 바이트 단위로 보존된다.

const round4 = (n) => Math.round(n * 10000) / 10000;

// placed 경고 문구의 단일 출처 — toSpreadTemplate(emit)와 본 모듈(카운트 재산정 시 원본 경고
// 탐지·교체)이 동일 빌더를 공유한다(문구 이중 정의 결합 해소, 바이트 불변).
export const placedWarningFor = (count) =>
  `배치 이미지 ${count}개 — IDML 에는 이미지 원본이 포함되지 않아 복원할 수 없습니다. ` +
  `해당 자리는 회색 플레이스홀더로 표시됩니다. 편집기에서 [이미지] 메뉴로 원본 이미지를 업로드해 교체하세요.`;

// placedWarningFor 가 만든 경고를 찾는 매처 — 카운트(\d+)만 가변.
const PLACED_WARNING_RE = /^배치 이미지 \d+개 — IDML 에는 이미지 원본이 포함되지 않아/;

/**
 * linkedImages(Map 또는 plain object) → 정규화 매처.
 * 키(파일명)는 NFC 정규화 후 정확 매칭, 실패 시 소문자 폴백(대소문자 무시).
 */
function buildImageLookup(linkedImages) {
  const exact = new Map(); // NFC 파일명 → dataUrl
  const lower = new Map(); // NFC 소문자 → dataUrl
  const entries =
    linkedImages instanceof Map ? linkedImages.entries() : Object.entries(linkedImages || {});
  for (const [name, dataUrl] of entries) {
    if (typeof name !== 'string' || typeof dataUrl !== 'string') continue;
    const nfc = name.normalize('NFC');
    if (!exact.has(nfc)) exact.set(nfc, dataUrl);
    const lc = nfc.toLowerCase();
    if (!lower.has(lc)) lower.set(lc, dataUrl);
  }
  return (fileName) => {
    const nfc = String(fileName).normalize('NFC');
    return exact.get(nfc) ?? lower.get(nfc.toLowerCase()) ?? null;
  };
}

/**
 * dataURL 이미지에서 정규화 크롭(0..1, 소스 natural px 기준 환산)을 잘라 베이크.
 * 소스 MIME 이 image/jpeg 면 JPEG(q 0.9)로 재인코딩(사진 원본의 PNG 팽창 방지 — JPEG 는
 * 알파가 없어 무손실 의미론 차이 없음), 그 외(png/gif/webp 등)는 PNG 유지.
 * flipX/flipY 는 픽셀에 미러로 베이크(객체 속성 잔존 금지 — 교체 시 왜곡 방지).
 *
 * @param {string} dataUrl  소스 이미지 dataURL(jpeg/png 등)
 * @param {{x:number,y:number,w:number,h:number}} cropNorm  GraphicBounds 0..1 정규화 크롭
 * @param {{flipX?:boolean, flipY?:boolean}} [opts]
 * @returns {Promise<{dataUrl:string, widthPx:number, heightPx:number}>}
 */
export async function bakeCroppedImage(dataUrl, cropNorm, opts = {}) {
  const flipX = !!opts.flipX;
  const flipY = !!opts.flipY;
  const srcMime = (String(dataUrl).match(/^data:([^;,]+)/) || [])[1] || '';
  const asJpeg = /^image\/jpeg$/i.test(srcMime);

  if (typeof document !== 'undefined') {
    // 브라우저: <img> 디코드 → natural px 크롭 → canvas (cropArtwork.mjs 패턴)
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('placed image decode failed'));
      img.src = dataUrl;
    });
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const rect = cropRectPx(cropNorm, nw, nh);
    const canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    // 플립 미러 베이크: negative-scale draw (cropArtwork dual-env 패턴의 브라우저 측 대응)
    ctx.translate(flipX ? rect.width : 0, flipY ? rect.height : 0);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return {
      // JPEG 소스 → JPEG q0.9 (크롭이 캔버스 전체를 덮어 투명 픽셀 없음 — 검정 배경 함정 없음)
      dataUrl: asJpeg ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png'),
      widthPx: rect.width,
      heightPx: rect.height,
    };
  }

  // Node: sharp. (rasterize.mjs 와 동일하게 모듈명을 변수로 둬 Vite 정적 분석 차단.)
  const sharpName = 'sharp';
  const sharp = (await import(/* @vite-ignore */ sharpName)).default;
  const m = String(dataUrl).match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) throw new Error('placed image dataURL 형식을 해석할 수 없습니다');
  const buf = Buffer.from(m[2], 'base64');
  const meta = await sharp(buf).metadata();
  const rect = cropRectPx(cropNorm, meta.width, meta.height);
  let pipe = sharp(buf).extract(rect);
  if (flipX) pipe = pipe.flop();
  if (flipY) pipe = pipe.flip();
  // JPEG 소스 → JPEG q90 (브라우저 toDataURL('image/jpeg', 0.9) 대응), 그 외 PNG 유지.
  const out = asJpeg
    ? await pipe.jpeg({ quality: 90 }).toBuffer()
    : await pipe.png().toBuffer();
  return {
    dataUrl: `data:${asJpeg ? 'image/jpeg' : 'image/png'};base64,` + out.toString('base64'),
    widthPx: rect.width,
    heightPx: rect.height,
  };
}

/** 정규화 크롭(0..1) → 소스 natural px 정수 크롭(클램프, 최소 1px) */
function cropRectPx(cropNorm, naturalW, naturalH) {
  if (!naturalW || !naturalH) throw new Error('placed image natural size 를 알 수 없습니다');
  let left = Math.round(cropNorm.x * naturalW);
  let top = Math.round(cropNorm.y * naturalH);
  left = Math.max(0, Math.min(naturalW - 1, left));
  top = Math.max(0, Math.min(naturalH - 1, top));
  const width = Math.max(1, Math.min(naturalW - left, Math.round(cropNorm.w * naturalW)));
  const height = Math.max(1, Math.min(naturalH - top, Math.round(cropNorm.h * naturalH)));
  return { left, top, width, height };
}

/** meta 에서 placed 디스크립터만 제거한 사본(키 순서 보존 — 미제공 시 기존 출력과 동일) */
function stripPlaced(obj) {
  if (!obj.meta || !('placed' in obj.meta)) return obj;
  const meta = { ...obj.meta };
  delete meta.placed;
  return { ...obj, meta };
}

/**
 * toSpreadTemplate 결과에 동반 업로드 이미지를 적용한다(인덱스 보존 치환).
 *
 * - linkedImages 미제공(undefined/null) 또는 빈 컬렉션(빈 Map/빈 객체): meta.placed 만 제거
 *   — 출력은 기존(HEAD)과 동일(빈 컬렉션에 '매칭 실패' 경고를 내지 않는다).
 * - 매칭: 플레이스홀더 → 실제 image 객체(베이크 JPEG/PNG). FULL 모드 편집 가능
 *   (잠금 없음, meta.placeholder 제거, isUserAdded:false). FLAT 모드는 호출 순서상
 *   이 결과가 rasterizeArtwork 에 들어가 베이크된다(z-order 그대로).
 * - 미매칭/미지원/베이크 실패: 기존 플레이스홀더 유지 + '동반 업로드 매칭 실패' 경고.
 *   placed 경고 카운트는 잔여(미복원) 프레임 수로 재산정.
 *
 * @param {object} result  toSpreadTemplate() 반환값({ draftTemplateDto, objects, warnings, ... })
 * @param {Map<string,string>|Record<string,string>|null|undefined} linkedImages 파일명→dataURL
 * @returns {Promise<object>} 새 result(같은 형태) — { ..., placedApplied: { matched, failed } }
 */
export async function applyPlacedImages(result, linkedImages) {
  const dto = result.draftTemplateDto;
  const srcObjects = dto.canvasData.objects;

  // 미제공/빈 컬렉션 — 디스크립터만 제거(완전 하위호환). 경고/객체/순서 모두 기존과 동일.
  // 빈 Map/빈 객체는 '이미지를 안 준 것'과 의미가 같으므로 매칭 실패 경고를 만들지 않는다.
  const provided =
    linkedImages instanceof Map
      ? linkedImages.size > 0
      : linkedImages != null && Object.keys(linkedImages).length > 0;
  if (!provided) {
    const objects = srcObjects.map(stripPlaced);
    const draftTemplateDto = { ...dto, canvasData: { ...dto.canvasData, objects } };
    return { ...result, objects, warnings: result.warnings, draftTemplateDto, placedApplied: { matched: 0, failed: [] } };
  }

  const lookup = buildImageLookup(linkedImages);
  // { index, fileName, reason } — push 순서는 베이크 완료 타이밍(비결정)이므로 객체 인덱스를
  // 기록해 두고 마지막에 정렬한다(경고/placedApplied.failed 순서 결정성).
  const failed = [];
  let matched = 0;

  const objects = await Promise.all(
    srcObjects.map(async (o, index) => {
      const desc = o.meta?.placed;
      if (!desc) return o;
      const fileName = desc.linkFileName;
      const src = fileName ? lookup(fileName) : null;
      if (!src) {
        failed.push({ index, fileName, reason: 'not-provided' });
        return stripPlaced(o);
      }
      if (desc.unsupported || !desc.crop || !desc.target) {
        failed.push({ index, fileName, reason: desc.unsupported || 'missing-descriptor' });
        return stripPlaced(o);
      }
      try {
        const baked = await bakeCroppedImage(src, desc.crop, {
          flipX: desc.bakeFlipX,
          flipY: desc.bakeFlipY,
        });
        matched++;
        const t = desc.target;
        // plain image 객체 — hybrid 아트워크와 동일하게 width/height=베이크 원본 px +
        // scaleX/Y 캔버스 맞춤(fabric 네이티브 크롭 의미론 회피). 잠금 없음(고객/관리자 교체 가능).
        return {
          type: 'image',
          id: o.id, // 기존 플레이스홀더 id(idml-<self>) 승계 — 추적/재가져오기 안정성
          src: baked.dataUrl,
          // 캔버스 taint 방어: admin 동반업로드로 src 가 스토리지 URL 로 치환되면 편집기에서
          // 교차출처 로드 — crossOrigin 없으면 toDataURL/getImageData SecurityError.
          crossOrigin: 'anonymous',
          selectable: true,
          evented: true,
          originX: 'center',
          originY: 'center',
          left: t.left,
          top: t.top,
          width: baked.widthPx,
          height: baked.heightPx,
          scaleX: round4(t.width / baked.widthPx),
          scaleY: round4(t.height / baked.heightPx),
          angle: t.angle || 0,
          ...(t.flipY ? { flipY: true } : {}),
          isUserAdded: false,
          meta: { regionRef: t.regionRef, anchor: t.anchor },
          _idml: o._idml,
        };
      } catch (err) {
        failed.push({ index, fileName, reason: `bake-failed: ${err?.message || err}` });
        return stripPlaced(o);
      }
    })
  );

  // 실패 목록을 객체 인덱스 순으로 정렬 — Promise.all 완료 순서에 결합되지 않는 결정적 순서.
  failed.sort((a, b) => a.index - b.index);
  const failedOut = failed.map(({ fileName, reason }) => ({ fileName, reason }));

  // 경고 재산정 — 복원된 프레임은 placed 경고 카운트에서 제외(잔여 건만), 매칭 실패는 별도 경고.
  const remaining = objects.filter((o) => o.meta?.placeholder === 'placed-image').length;
  const warnings = [];
  for (const w of result.warnings) {
    if (PLACED_WARNING_RE.test(w)) {
      if (remaining > 0) warnings.push(placedWarningFor(remaining));
      continue;
    }
    warnings.push(w);
  }
  // 동일 파일명 다중 프레임(실측: 17146230.jpg ×2)의 중복 경고 방지 — 경고만 dedupe.
  const seen = new Set();
  for (const fl of failedOut) {
    const msg =
      fl.reason === 'not-provided'
        ? `동반 업로드 매칭 실패: ${fl.fileName} — 같은 파일명의 이미지를 함께 업로드하면 자동 복원됩니다.`
        : `동반 업로드 매칭 실패: ${fl.fileName} — 복원 미지원(${fl.reason}), 플레이스홀더 유지.`;
    if (!seen.has(msg)) {
      seen.add(msg);
      warnings.push(msg);
    }
  }

  const draftTemplateDto = { ...dto, canvasData: { ...dto.canvasData, objects } };
  return { ...result, objects, warnings, draftTemplateDto, placedApplied: { matched, failed: failedOut } };
}
