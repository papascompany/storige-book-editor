// @storige/indesign-import — IDML → Storige 표지 펼침면 템플릿 변환기.
// 브라우저/노드 공용(src 는 node 내장 API 미사용). 파싱: jszip + fast-xml-parser.

import { parseIdml, colorToHex, parseGradients } from './idml/reader.mjs';
import { toSpreadTemplate, deriveSpecFromPages } from './convert/toSpreadTemplate.mjs';
import { buildPreviewSvg } from './preview/svg.mjs';
import { ARTWORK_LOCK } from './convert/artworkLock.mjs';
import { computeFlatSpineCrops } from './convert/flatSpineGeometry.mjs';
import { halvesOf, contentToSceneX } from './geometry/centerOrigin.mjs';
import * as units from './geometry/units.mjs';
import * as regions from './geometry/regions.mjs';

export { parseIdml, colorToHex, parseGradients, toSpreadTemplate, deriveSpecFromPages, buildPreviewSvg, computeFlatSpineCrops, units, regions };

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * 편의 함수: IDML 버퍼 → { result, dto, previewSvg }.
 * mode='vector'(기본): 모든 객체를 벡터로(conversionMode='full').
 * mode='hybrid': 텍스트만 편집 레이어로 두고 나머지(도형/배경)를 300dpi PNG 한 장으로 굽어
 *   최하단 이미지 레이어로 깐다(conversionMode='flat-spread' — 책등 고정).
 * mode='flat-spine': 전폭 300dpi 1회 렌더 후 3크롭(spine 3배폭/back/front, 흰 배경 합성)으로
 *   나눠 깐다(conversionMode='flat-spine' — 책등 가변 허용).
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{name?:string, dpi?:number, previewWidth?:number, mode?:('vector'|'hybrid'|'flat-spine'), rasterDpi?:number}} [opts]
 */
export async function convertIdmlToTemplate(buffer, opts = {}) {
  const doc = await parseIdml(buffer);
  const result = toSpreadTemplate(doc, { name: opts.name, dpi: opts.dpi });
  let dto = result.draftTemplateDto;
  let finalResult = result;

  if (opts.mode === 'hybrid') {
    const { rasterizeArtwork } = await import('./raster/rasterize.mjs');
    const raster = await rasterizeArtwork(dto, { dpi: opts.rasterDpi || 300 });
    const cw = dto.canvasData.width;
    const ch = dto.canvasData.height;
    // 비텍스트 디자인을 한 장의 300dpi PNG 로(최하단). 캔버스(px@150dpi)에 맞게 스케일.
    const artwork = {
      type: 'image',
      id: 'idml-artwork',
      src: raster.dataUrl,
      // 콘텐츠 중앙원점 규약: 배경(캔버스 전체)의 중심 = (0,0). originX/originY='center' 이므로
      // left/top=0 이면 캔버스를 꽉 채운다. (좌상단원점으로 두면 우하단 어긋나 화면 밖 → 배경 미표시)
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      width: raster.widthPx,
      height: raster.heightPx,
      scaleX: round4(cw / raster.widthPx),
      scaleY: round4(ch / raster.heightPx),
      // 배경 아트워크는 '표지 판형에 고정' — 고객/관리자가 실수로 이동·회전·삭제 못 하도록 잠금.
      // (편집은 텍스트 오버레이만. 배경 교체는 재가져오기로.) 잠금 속성은 canvas-core
      // extendFabricOption 화이트리스트로 저장 라운드트립 보존됨. PSD 경로(toSinglePageTemplate)와 동일.
      ...ARTWORK_LOCK,
      isUserAdded: false,
      meta: { regionRef: null, anchor: { kind: 'canvas', x: 0, y: 0 } },
    };
    // 텍스트만 편집 레이어로 유지(이미지 위).
    const textObjs = dto.canvasData.objects.filter((o) => o.type === 'textbox');
    const hybridDto = {
      ...dto,
      canvasData: { ...dto.canvasData, objects: [artwork, ...textObjs] },
    };
    dto = hybridDto;
    finalResult = { ...result, draftTemplateDto: hybridDto, mode: 'hybrid' };
  }

  if (opts.mode === 'flat-spine') {
    const { rasterizeArtwork } = await import('./raster/rasterize.mjs');
    const { cropArtworkPng } = await import('./raster/cropArtwork.mjs');
    const dpi = opts.rasterDpi || 300;
    // 전폭 1회 렌더 후 3크롭. 크롭 경계는 mm 기반 공식(flatSpineGeometry, 절대 규칙 #5)으로
    // 환산 — rasterizeArtwork 의 widthPx/heightPx 와 동일 공식이라 항상 일치한다.
    const raster = await rasterizeArtwork(dto, { dpi });
    const crops = computeFlatSpineCrops(dto.spreadConfig.spec, { dpi });
    if (raster.widthPx !== crops.fullWidthPx || raster.heightPx !== crops.fullHeightPx) {
      throw new Error(
        `flat-spine: 래스터(${raster.widthPx}×${raster.heightPx})와 크롭 지오메트리(${crops.fullWidthPx}×${crops.fullHeightPx}) 불일치`
      );
    }
    // 3장 모두 흰 배경 합성(불투명 보장) — z-order 은폐(spine 위를 back/front 가 덮음)의 전제.
    const [spinePng, backPng, frontPng] = await Promise.all([
      cropArtworkPng(raster.dataUrl, crops.spine, crops.fullHeightPx),
      cropArtworkPng(raster.dataUrl, crops.back, crops.fullHeightPx),
      cropArtworkPng(raster.dataUrl, crops.front, crops.fullHeightPx),
    ]);

    const cw = dto.canvasData.width; // 판형 메타(px@150dpi) — fabric 캔버스 치수 아님(절대 규칙 #3)
    const ch = dto.canvasData.height;
    const { halfW, halfH } = halvesOf(cw, ch);
    // 300dpi 크롭 → 150dpi 캔버스 스케일(≈0.5). hybrid 와 동일하게 실측비로 계산.
    const sx = round4(cw / crops.fullWidthPx);
    const sy = round4(ch / crops.fullHeightPx);
    const regions150 = dto.spreadConfig.regions; // {kind,x,width} px@150dpi

    // 크롭 중심의 content x — crops.*.centerPx(flatSpineGeometry 단일 출처)를 mm 환산.
    // 일반식(left + width/2) 기반이라 back.left=0 같은 암묵 전제에 결합되지 않고,
    // spine 은 클램프/반올림 후 실제 크롭 중심이 그대로 반영된다.
    const cropCenterMm = (crop) => (crop.centerPx / dpi) * units.MM_PER_INCH;
    const spineCenterCropMm = cropCenterMm(crops.spine);
    const backCenterMm = cropCenterMm(crops.back); // = spine.xMm/2 (대칭 사양)
    const frontCenterMm = cropCenterMm(crops.front);
    const regionAnchorFor = (kind, centerXpx150) => {
      const r = regions150.find((rg) => rg.kind === kind);
      return {
        kind: 'region',
        xNorm: r && r.width ? round4((centerXpx150 - r.x) / r.width) : 0,
        yNorm: 0.5, // 크롭은 항상 세로 전체 → 중심 y = 콘텐츠 중앙
      };
    };
    const mkArtwork = (id, png, { left, regionRef, anchor, flat }) => ({
      type: 'image',
      id,
      src: png.dataUrl,
      // 콘텐츠 중앙원점 규약(hybrid idml-artwork 와 동일): originX/originY='center', left/top=scene px.
      originX: 'center',
      originY: 'center',
      left: round2(left),
      top: 0,
      width: png.widthPx,
      height: png.heightPx,
      scaleX: sx,
      scaleY: sy,
      // 배경 아트워크 판형 고정(이동·회전·삭제 차단). clipPath 는 직렬화 유실 → 절대 사용 금지.
      ...ARTWORK_LOCK,
      isUserAdded: false,
      meta: { regionRef, anchor, flatArtwork: flat },
    });

    const spineArtwork = mkArtwork('spine-artwork', spinePng, {
      // 책등 크롭의 실제 중심에서 left 유도(가정값 0 금지) — 대칭 레이아웃에서는 콘텐츠 중앙
      // = scene x≈0 이지만, 클램프/roundMm01 오프셋이 있는 퇴화 케이스도 자동 흡수된다.
      // (resizeSpine 시 meta.flatArtwork='spine' 가드로 무이동·무스케일.)
      left: contentToSceneX(units.mmToPx(spineCenterCropMm), halfW),
      regionRef: null,
      // canvas anchor 는 content 좌표 규약: 콘텐츠 중앙 = (contentWidth/2, contentHeight/2).
      // (scene 0,0 의 content 표현 — 기존 코드베이스 canvas anchor 규약과 동일.)
      anchor: { kind: 'canvas', x: halfW, y: halfH },
      flat: 'spine',
    });
    const backArtwork = mkArtwork('back-artwork', backPng, {
      left: contentToSceneX(units.mmToPx(backCenterMm), halfW),
      regionRef: 'back-cover',
      anchor: regionAnchorFor('back-cover', units.mmToPx(backCenterMm)),
      flat: 'back',
    });
    const frontArtwork = mkArtwork('front-artwork', frontPng, {
      left: contentToSceneX(units.mmToPx(frontCenterMm), halfW),
      regionRef: 'front-cover',
      anchor: regionAnchorFor('front-cover', units.mmToPx(frontCenterMm)),
      flat: 'front',
    });

    // z-order: [spine(최하단), back, front, ...텍스트 오버레이]
    const textObjs = dto.canvasData.objects.filter((o) => o.type === 'textbox');
    const flatDto = {
      ...dto,
      canvasData: {
        ...dto.canvasData,
        objects: [spineArtwork, backArtwork, frontArtwork, ...textObjs],
      },
    };
    dto = flatDto;
    finalResult = { ...result, draftTemplateDto: flatDto, mode: 'flat-spine' };
  }

  // conversionMode 스탬프 — spreadConfig(JSON)에 기록. 편집기/canvas-core 가 책등 가변 허용
  // 여부와 flat 아트워크 재배치 분기에 사용. 미존재(과거 데이터) 시 'full' 간주.
  const conversionMode =
    opts.mode === 'hybrid' ? 'flat-spread' : opts.mode === 'flat-spine' ? 'flat-spine' : 'full';
  dto = { ...dto, spreadConfig: { ...dto.spreadConfig, conversionMode } };
  finalResult = { ...finalResult, draftTemplateDto: dto };

  const previewSvg = buildPreviewSvg(dto, { width: opts.previewWidth });
  return { result: finalResult, dto, previewSvg };
}

/**
 * PSD(포토샵) → 단일 페이지 템플릿(명함/내지 단품 등). 하이브리드: 비텍스트=300dpi급 배경 PNG,
 * 텍스트=편집가능 레이어(근사 폰트/크기/색, 관리자 확정 전제).
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{name?:string, pageType?:('page'|'cover'), previewWidth?:number}} [opts]
 */
export async function convertPsdToTemplate(buffer, opts = {}) {
  const { parsePsd } = await import('./psd/reader.mjs');
  const { compositeLayersToPng } = await import('./psd/rasterizePsd.mjs');
  const { toSinglePageTemplate } = await import('./convert/toSinglePageTemplate.mjs');
  const parsed = await parsePsd(buffer);
  const rasterLayers = parsed.layers.filter((l) => l.kind === 'raster');
  const background = rasterLayers.length
    ? await compositeLayersToPng(rasterLayers, parsed.widthPx, parsed.heightPx)
    : null;
  const result = toSinglePageTemplate(parsed, background, { name: opts.name, pageType: opts.pageType });
  const previewSvg = buildPreviewSvg(result.draftTemplateDto, { width: opts.previewWidth });
  return { result, dto: result.draftTemplateDto, previewSvg };
}
