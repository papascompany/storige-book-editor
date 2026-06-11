// IdmlDoc → Storige 표지 펼침면 템플릿(spec + regions + CanvasData objects + draft DTO).
//
// 좌표 규약(전체: docs/COORDINATE_SYSTEM.md):
//  - IDML 스프레드 좌표(pt): x=0 은 좌측 콘텐츠 가장자리, y=0 은 세로 중앙.
//  - 파싱 중간값은 content(좌상단원점, 0..W) px. 최종 출력 객체 left/top 은 scene(중앙원점,
//    originX/originY='center'). content→scene 변환은 centerOrigin.mjs(SSOT)만 사용.
//  - 변환: pt → mm → workspace px(DPI 150).
//  - 책등(spine) 폭은 권위로 고정하지 않음(런타임 파생). cover/height/wing 만 권위.

import { ptToMm, mmToPx, roundMm01, DEFAULT_DPI } from '../geometry/units.mjs';
import { applyToPoint, decompose } from '../geometry/matrix.mjs';
import {
  layoutRegionsMm,
  layoutRegionsPx,
  resolveRegionAtX,
} from '../geometry/regions.mjs';
import { buildPathD, transformedBBox } from '../geometry/path.mjs';
import { halvesOf, contentToSceneX, contentToSceneY } from '../geometry/centerOrigin.mjs';

const PATH_TYPES = new Set(['Polygon', 'GraphicLine']);

/** 페이지들 → 표지 spec(mm). 3페이지=날개없음[cover,spine,cover], 5페이지=날개[wing,cover,spine,cover,wing] */
export function deriveSpecFromPages(pages, bleedMm) {
  const widthsMm = pages.map((p) => ptToMm(p.widthPt));
  const heightMm = roundMm01(ptToMm(Math.max(...pages.map((p) => p.heightPt))));
  // 가장 좁은 페이지 = 책등
  const spineIdx = widthsMm.indexOf(Math.min(...widthsMm));
  const spineWidthMm = roundMm01(widthsMm[spineIdx]);
  // 표지폭 = 책등 제외 페이지 중 가장 넓은 폭(좌우 동일 가정)
  const coverCandidates = widthsMm.filter((_, i) => i !== spineIdx);
  const coverWidthMm = roundMm01(Math.max(...coverCandidates));
  const wingEnabled = pages.length >= 5;
  const wingWidthMm = wingEnabled
    ? roundMm01(Math.min(...coverCandidates))
    : 0;
  return {
    coverWidthMm,
    coverHeightMm: heightMm,
    spineWidthMm,
    wingEnabled,
    wingWidthMm,
    cutSizeMm: bleedMm != null ? roundMm01(bleedMm) : 3,
    safeSizeMm: 3,
  };
}

/** color id → { hex, cmyk, isPaper, isNone, isSpot, spotName } */
function resolveColor(colorId, colors) {
  if (!colorId || /\/None$/.test(colorId)) return { isNone: true };
  if (/\/Paper$/.test(colorId)) return { hex: '#ffffff', isPaper: true };
  const c = colors.get(colorId);
  if (!c) return { hex: null, unknown: colorId };
  const out = { hex: c.hex, space: c.space };
  if (c.space === 'CMYK') out.cmyk = c.value; // 원본 보존 → cmykFill
  if (c.isSpot) {
    out.isSpot = true; // 별색/혼합잉크 — 4도 근사로 손실(경고 대상)
    out.spotName = c.spotName;
  }
  return out;
}

const FABRIC_TYPE = {
  Rectangle: 'rect',
  Oval: 'ellipse',
  Polygon: 'path',
  GraphicLine: 'path',
  TextFrame: 'textbox',
};

/**
 * IdmlDoc → 표지 펼침면 변환 결과.
 * @returns { spec, regions, totalWidthMm, objects, fonts, warnings, draftTemplateDto }
 */
export function toSpreadTemplate(doc, opts = {}) {
  const dpi = opts.dpi || DEFAULT_DPI;
  const name = opts.name || 'Imported Cover';
  const bleedMm = doc.bleedPt != null ? ptToMm(doc.bleedPt) : null;
  const spec = deriveSpecFromPages(doc.pages, bleedMm);

  const regionsMm = layoutRegionsMm(spec);
  const regionsPx = layoutRegionsPx(spec, dpi);
  const totalWidthMm = roundMm01(
    regionsMm.reduce((a, r) => a + r.widthMm, 0)
  );

  // 스프레드→캔버스 좌표 원점 보정
  const originXpt = Math.min(...doc.pages.map((p) => p.leftSpreadPt)); // 좌측 콘텐츠 가장자리
  const topYpt = Math.min(...doc.pages.map((p) => p.topSpreadPt)); // 상단(스프레드 y center 기준 음수)
  const contentHeightPx = mmToPx(spec.coverHeightMm, dpi);
  // 시스템 좌표 규약 = 콘텐츠 '중앙원점'(WorkspacePlugin 워크스페이스 중심 = fabric (0,0),
  // 편집기/PDF/반응형 줌이 모두 이 규약). 변환기는 좌상단 content(0..W) 로 계산하므로 최종 출력에서
  // contentToScene(centerOrigin.mjs SSOT) + originX/originY='center' 로 정렬해야 화면=PDF=web 일치.
  const totalWidthPx = mmToPx(totalWidthMm, dpi);
  const { halfW, halfH } = halvesOf(totalWidthPx, contentHeightPx);

  const warnings = [];
  const objects = [];
  const spotNames = new Set(); // 별색(Spot) 감지 — 후가공/별색 의도 확인 경고용
  const placedFrames = []; // 배치(placed) 이미지 프레임 — IDML 에 원본 미포함 → 플레이스홀더

  // 로컬점([x,y]) → 캔버스 px({x,y}) 매퍼: world transform → 스프레드 → 캔버스 원점보정 → px
  const mapLocalToCanvas = (transform) => ([lx, ly]) => {
    const sp = applyToPoint(transform, lx, ly);
    return {
      x: mmToPx(ptToMm(sp.x - originXpt), dpi),
      y: mmToPx(ptToMm(sp.y - topYpt), dpi),
    };
  };

  for (const it of doc.items) {
    if (!it.bbox) continue;
    const isPath = PATH_TYPES.has(it.type) && it.subpaths?.length;
    const d = decompose(it.transform);
    const mapPt = mapLocalToCanvas(it.transform);

    // 경로형(폴리곤/라인)은 실제 변환된 anchor 들로 정확한 bbox 계산, 그 외는 로컬 bbox×scale
    let centerXpx, centerYpx, widthPx, heightPx, pathD = null;
    if (isPath) {
      pathD = buildPathD(it.subpaths, mapPt);
      const tb = transformedBBox(it.subpaths, mapPt);
      centerXpx = tb.cx;
      centerYpx = tb.cy;
      widthPx = tb.w;
      heightPx = tb.h;
    } else {
      const cSpread = applyToPoint(it.transform, it.bbox.cx, it.bbox.cy);
      centerXpx = mmToPx(ptToMm(cSpread.x - originXpt), dpi);
      centerYpx = mmToPx(ptToMm(cSpread.y - topYpt), dpi);
      widthPx = mmToPx(ptToMm(it.bbox.w * Math.abs(d.scaleX)), dpi);
      heightPx = mmToPx(ptToMm(it.bbox.h * Math.abs(d.scaleY)), dpi);
    }

    const regionRef = resolveRegionAtX(regionsPx, centerXpx);
    const region = regionsPx.find((r) => r.kind === regionRef);
    const anchor = region
      ? {
          kind: 'region',
          xNorm: (centerXpx - region.x) / region.width,
          yNorm: contentHeightPx ? centerYpx / contentHeightPx : 0,
        }
      : { kind: 'canvas', x: round2(contentToSceneX(centerXpx, halfW)), y: round2(contentToSceneY(centerYpx, halfH)) };

    const fill = resolveColor(it.fillColor, doc.colors);
    const stroke = resolveColor(it.strokeColor, doc.colors);
    // 배치(placed) 이미지 프레임 — IDML 에 원본 픽셀 미포함(링크 메타만)이라 복원 불가.
    // 빈 프레임 대신 회색 플레이스홀더로 표시해 관리자가 편집기에서 이미지를 교체하도록 안내.
    if (it.placedContent) {
      placedFrames.push(it.self);
      fill.hex = '#e9e9e9';
      fill.isNone = false;
      stroke.hex = '#999999';
      stroke.isNone = false;
    }
    if (fill.unknown) warnings.push(`미해석 색상: ${fill.unknown}`);
    if (fill.isSpot) spotNames.add(fill.spotName);
    if (stroke.isSpot) spotNames.add(stroke.spotName);

    // 컴파운드 패스(서브패스≥2) → even-odd: 도넛형/음각 로고의 구멍 보존(nonzero면 메워짐)
    const isCompound = isPath && (it.subpaths?.length || 0) >= 2;

    const obj = {
      type: FABRIC_TYPE[it.type] || 'rect',
      // 에디터 편집모드에서 객체 추적/선택/잠금이 가능하도록 안정적 id 부여(IDML Self 기반)
      id: `idml-${it.self}`,
      selectable: true,
      evented: true,
      // 중심 기준 + 콘텐츠 중앙원점 정렬(일반 템플릿과 동일한 좌표 모델)
      originX: 'center',
      originY: 'center',
      left: round2(contentToSceneX(centerXpx, halfW)),
      top: round2(contentToSceneY(centerYpx, halfH)),
      width: round2(widthPx),
      height: round2(heightPx),
      // fabric.Ellipse 는 rx/ry(반경)로 그린다 — width/height 만 주면 rx=0 으로 로드돼 타원이
      // 비가시 + 재저장 시 width:0 박제. Oval 은 rx/ry 를 명시한다.
      ...(it.type === 'Oval' ? { rx: round2(widthPx / 2), ry: round2(heightPx / 2) } : {}),
      // 경로형은 변환좌표에 회전이 이미 반영됨 → angle 0
      angle: isPath ? 0 : round2(d.rotationDeg),
      ...(!isPath && d.flipped ? { flipY: true } : {}),
      fill: fill.isNone ? '' : fill.hex || '#000000',
      ...(fill.cmyk ? { cmykFill: fill.cmyk } : {}),
      ...(fill.isSpot ? { spotColor: fill.spotName } : {}),
      ...(stroke.isNone ? {} : { stroke: stroke.hex || undefined }),
      ...(it.strokeWeight ? { strokeWidth: round2(mmToPx(ptToMm(it.strokeWeight), dpi)) } : {}),
      // 복원된 경로(절대 캔버스 px). Fabric 로드 시 pathOffset 정규화는 에디터-로드 단계에서 검증.
      ...(pathD ? { path: pathD } : {}),
      ...(isCompound ? { fillRule: 'evenodd' } : {}),
      isUserAdded: false,
      // Spread 가변 재배치용 — 저장 화이트리스트에 'meta' 보존 필요(README 참고)
      meta: {
        regionRef: regionRef || null,
        anchor,
        ...(it.placedContent ? { placeholder: 'placed-image' } : {}),
      },
      _idml: { self: it.self, srcType: it.type, points: it.bbox.pointCount },
    };

    if (it.type === 'TextFrame') {
      obj.type = 'textbox';
      obj.text = it.story?.text || '';
      // ⚠️ fabric 5.5: styles 키가 아예 없으면 fromObject 의 stylesFromArray(undefined)가
      // undefined 를 전파 → 이후 toObject(저장/PDF)에서 stylesToArray 가 크래시(무한로딩).
      // 빈 객체라도 반드시 출력한다.
      obj.styles = {};
      if (it.story?.sizePt) obj.fontSize = round2(mmToPx(ptToMm(it.story.sizePt), dpi)); // pt→px
      if (it.story?.font) obj.fontFamily = it.story.font;
      const tf = resolveColor(it.story?.fillColor, doc.colors);
      obj.fill = tf.isNone ? '#000000' : tf.hex || '#000000';
      if (tf.cmyk) obj.cmykFill = tf.cmyk;
      if (tf.isSpot) { obj.spotColor = tf.spotName; spotNames.add(tf.spotName); }
      // width/height 는 프레임 자체 치수(회전 전)를 유지 → angle(예: 책등 세로쓰기 90°)
      // 회전 시 텍스트가 프레임 밖으로 넘치지 않게 한다. (이전엔 삭제해 책등 이탈)
    }

    objects.push(obj);
  }

  // 배치(placed) 이미지 경고 — IDML 에는 이미지 원본이 포함되지 않음(링크 메타만)
  if (placedFrames.length) {
    warnings.push(
      `배치 이미지 ${placedFrames.length}개 — IDML 에는 이미지 원본이 포함되지 않아 복원할 수 없습니다. ` +
        `해당 자리는 회색 플레이스홀더로 표시됩니다. 편집기에서 [이미지] 메뉴로 원본 이미지를 업로드해 교체하세요.`
    );
  }

  // 별색(Spot) 경고 — 4도 근사로 손실, 후가공/별색 의도 확인 필요
  if (spotNames.size) {
    warnings.push(
      `별색(Spot) ${spotNames.size}개 감지 — 4도(CMYK 근사)로 변환됨. 후가공(박·형광)/별색판 의도 확인 필요: ${[...spotNames].join(', ')}`
    );
  }

  // 재단여백(블리드) 커버리지 점검 — 채움 객체들의 합집합이 재단선 밖 cutSize 까지 닿는지.
  // (기하 자동확장은 디자인 판단이 필요해 보류 — 경고로 사람이 편집기에서 확장하도록)
  {
    const bleedPx = mmToPx(spec.cutSizeMm, dpi);
    const tol = mmToPx(0.5, dpi);
    let minL = Infinity, maxR = -Infinity, minT = Infinity, maxB = -Infinity, any = false;
    for (const o of objects) {
      if (o.type === 'textbox' || !o.fill || o.fill === '') continue;
      if (o.width == null || o.height == null) continue;
      any = true;
      minL = Math.min(minL, o.left - o.width / 2);
      maxR = Math.max(maxR, o.left + o.width / 2);
      minT = Math.min(minT, o.top - o.height / 2);
      maxB = Math.max(maxB, o.top + o.height / 2);
    }
    if (any) {
      const miss = [];
      if (minL > -halfW - bleedPx + tol) miss.push('좌');
      if (maxR < halfW + bleedPx - tol) miss.push('우');
      if (minT > -halfH - bleedPx + tol) miss.push('상');
      if (maxB < halfH + bleedPx - tol) miss.push('하');
      if (miss.length) {
        warnings.push(
          `재단여백(블리드) 미달 가장자리: ${miss.join('·')} — 배경이 재단선 밖 ${spec.cutSizeMm}mm까지 안 닿음(인쇄 시 흰 테두리 위험). 편집기에서 배경을 블리드까지 확장 권장`
        );
      }
    }
  }

  // 폰트 경고(임베드 안 됨 → 시딩 필요)
  if (doc.fonts.length) {
    warnings.push(`폰트 미임베드(시딩 필요): ${doc.fonts.join(', ')}`);
  }

  const draftTemplateDto = {
    name,
    // Template.width 는 서버(validateAndNormalizeSpreadConfig)가 totalWidthMm 로 검증/override.
    // 따라서 총폭을 보냄(불일치 경고 방지). 서버가 최종 정규화.
    type: 'spread',
    width: totalWidthMm,
    height: spec.coverHeightMm,
    canvasData: {
      version: '5.3.0',
      width: round2(mmToPx(totalWidthMm, dpi)),
      height: round2(contentHeightPx),
      objects,
    },
    spreadConfig: {
      version: 1,
      spec,
      regions: regionsPx.map((r) => ({
        kind: r.kind,
        x: round2(r.x),
        width: round2(r.width),
      })),
      totalWidthMm,
      totalHeightMm: spec.coverHeightMm,
    },
  };

  return {
    spec,
    regionsMm,
    totalWidthMm,
    objects,
    fonts: doc.fonts,
    warnings,
    draftTemplateDto,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
