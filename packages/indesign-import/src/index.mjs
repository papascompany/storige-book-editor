// @storige/indesign-import — IDML → Storige 표지 펼침면 템플릿 변환기.
// 브라우저/노드 공용(src 는 node 내장 API 미사용). 파싱: jszip + fast-xml-parser.

import { parseIdml, colorToHex } from './idml/reader.mjs';
import { toSpreadTemplate, deriveSpecFromPages } from './convert/toSpreadTemplate.mjs';
import { buildPreviewSvg } from './preview/svg.mjs';
import { ARTWORK_LOCK } from './convert/artworkLock.mjs';
import * as units from './geometry/units.mjs';
import * as regions from './geometry/regions.mjs';

export { parseIdml, colorToHex, toSpreadTemplate, deriveSpecFromPages, buildPreviewSvg, units, regions };

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * 편의 함수: IDML 버퍼 → { result, dto, previewSvg }.
 * mode='vector'(기본): 모든 객체를 벡터로. mode='hybrid': 텍스트만 편집 레이어로 두고
 * 나머지(도형/배경)를 300dpi PNG 한 장으로 굽어 최하단 이미지 레이어로 깐다.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {{name?:string, dpi?:number, previewWidth?:number, mode?:('vector'|'hybrid'), rasterDpi?:number}} [opts]
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
