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
import { buildStoryTypography, verticalLineHeightFromTracking } from './textStyles.mjs';
import { isGradientRef, buildFabricGradientFill } from './gradientFill.mjs';

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
  const verticalFrames = []; // 세로짜기(StoryOrientation=Vertical) 프레임 — 글자 단위 세로 배치 근사
  const textWarnings = new Set(); // 텍스트 매핑 경고(per-run 근사/미해석 색) — 중복 제거용

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

    let regionRef = resolveRegionAtX(regionsPx, centerXpx);
    // [강등 가드] 스프레드 전폭 배경처럼 중심 x 만 책등 밴드에 들어와 'spine' 으로 판정되는
    // 객체는 편집기의 책등 가변(resizeSpine) 시 newSpine/oldSpine 비율 축소+중앙이동으로
    // 표지 전체가 붕괴한다. spine 판정에 한해 객체 폭이 책등 폭을 유의미하게(5%) 초과하면
    // 자유 객체(regionRef=null + canvas anchor)로 강등한다.
    // ⚠️ cover/wing 판정은 절대 불변 — 풀블리드 표지 배경은 cover 앵커를 유지해야
    // 책등 가변 시 표지와 함께 따라간다.
    if (regionRef === 'spine') {
      const spineRegion = regionsPx.find((r) => r.kind === 'spine');
      if (spineRegion && widthPx > spineRegion.width * 1.05) {
        regionRef = null;
      }
    }
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
    // 그라디언트 fill (비텍스트, A1) — 판정은 반드시 FillColor="Gradient/..." 로만.
    // (실측: InDesign 은 모든 프레임에 잔존 GradientFillStart/Length 기본값을 박아두므로
    //  기하 파라미터 존재만으로 판정하면 단색 객체가 그라디언트로 오염된다.)
    // 텍스트 fill 그라디언트는 fabric 텍스트 그라디언트 미지원으로 현행 '검정 대체+경고' 유지.
    let gradFill = null;
    if (it.type !== 'TextFrame' && !it.placedContent && isGradientRef(it.fillColor)) {
      const def = doc.gradients?.get(it.fillColor);
      if (def && def.stops?.length) {
        const gradAngle = it.gradientFill?.angle ?? 0;
        const g = buildFabricGradientFill(def, {
          mapPt, // mapLocalToCanvas 재사용(SSOT) — 좌표식 복붙 금지. E 도 inner pt 합성 후 동일 사상.
          start: it.gradientFill?.start ?? null,
          lengthPt: it.gradientFill?.length ?? null,
          angleDeg: gradAngle,
          objectAngleDeg: isPath ? 0 : d.rotationDeg,
          objectFlipY: isPath ? false : !!d.flipped,
          centerXpx,
          centerYpx,
          widthPx,
          heightPx,
        });
        gradFill = g.fill;
        for (const s of def.stops) {
          if (s.isSpot) spotNames.add(s.spotName);
          if (s.unknown) warnings.push(`미해석 색상: ${s.unknown}`);
        }
        if (g.warnings.includes('gradient-rotated-object')) {
          warnings.push(
            `그라디언트(${it.self}): 회전 객체 적용 — 실측 표본 없음, inner 공간 합성 + 중심 역회전(편집기에서 확인 권장)`
          );
        }
        if (g.warnings.includes('gradient-flipped-object')) {
          warnings.push(
            `그라디언트(${it.self}): 플립(flipY) 객체 적용 — 실측 표본 없음, 중심 기준 y 미러 보정(편집기에서 확인 권장)`
          );
        }
        if (g.warnings.includes('gradient-default-geometry')) {
          warnings.push(
            `그라디언트(${it.self}): 기하(GradientFillStart/Length) 미지정 — 객체 폭 기준 기본 적용`
          );
        }
        // FLAT(미리보기/래스터) SVG 는 objectBoundingBox 정규화라 비정사각 bbox 의 대각
        // 그라디언트는 각도가 bbox 비율만큼 근사된다(편집기/PDF 의 fabric 'pixels' 렌더는 정확).
        if (gradAngle % 90 !== 0 && Math.abs(widthPx - heightPx) > 0.5) {
          warnings.push(
            `그라디언트(${it.self}): 대각 각도(${gradAngle}°)+비정사각 객체 — FLAT 미리보기/래스터는 각도 근사(편집기/PDF 는 정확)`
          );
        }
        // 곡선 세그먼트(베지어 C) 경로의 bbox 는 transformedBBox(앵커 기준)와 극값이 어긋날 수
        // 있어 그라디언트 로컬 원점(좌상단)이 수 px 밀릴 수 있다 — 경고로 표면화.
        if (pathD && pathD.includes('C')) {
          warnings.push(
            `그라디언트(${it.self}): 곡선(베지어) 경로 결합 — 앵커 기준 bbox 근사로 그라디언트 위치가 미세 오차 가능(편집기에서 확인 권장)`
          );
        }
      }
      // def 미존재 → 아래 공통 경로(미해석 색상 경고 + 검정 폴백) 유지
    }
    if (fill.unknown && !gradFill) warnings.push(`미해석 색상: ${fill.unknown}`);
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
      // 그라디언트는 fabric Gradient 직렬화 plain object(왕복 안전 — gradientFill.mjs 주석),
      // 그 외는 기존 단색 hex. cmykFill/spotColor 단일값은 그라디언트와 의미 충돌 → 스톱별 보존.
      fill: gradFill || (fill.isNone ? '' : fill.hex || '#000000'),
      ...(fill.cmyk && !gradFill ? { cmykFill: fill.cmyk } : {}),
      ...(fill.isSpot && !gradFill ? { spotColor: fill.spotName } : {}),
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
      const ptToPx = (pt) => round2(mmToPx(ptToMm(pt), dpi));
      // per-run 타이포그래피(A2+A3) — runs 가 있으면(신규 reader) 지배값+per-char styles,
      // 없으면(수제 doc/구버전) 기존 '첫 non-null' 폴백. 3모드(full/flat-spread/flat-spine)
      // 모두 이 textbox 산출물을 그대로 재사용하므로 여기 한 곳이 공통 적용 지점이다.
      const typo = it.story?.runs?.length
        ? buildStoryTypography(it.story, {
            ptToPx,
            resolveFillHex: (colorId) => {
              const c = resolveColor(colorId, doc.colors);
              if (c.unknown) {
                textWarnings.add(`미해석 텍스트 색상: ${c.unknown} — 검정으로 대체됨(그라디언트 등)`);
                return { hex: '#000000' };
              }
              if (c.isSpot) spotNames.add(c.spotName);
              return { hex: c.isNone ? '#000000' : c.hex || '#000000' };
            },
          })
        : null;
      if (it.story?.runFallback) {
        // reader 의 방어 강하(문자배열 정규화 ≠ 문자열 정규화) — 발생하면 per-run 스타일이
        // 통째로 빠진 채 변환되므로 운영에서 감지 가능하게 경고로 표면화한다.
        textWarnings.add(
          `텍스트(${it.self}): per-run 정규화 불일치 — 단일 스타일 폴백 적용(혼합 서식 유실 가능)`
        );
      }
      // 세로짜기(StoryOrientation=Vertical) — fabric 은 CJK 세로조판 미지원이라 글자 단위
      // 세로 배치(한 글자 = 한 줄)로 근사한다. 이를 빠뜨리면 세로 프레임(좁고 긴) 텍스트가
      // 거대한 가로 한 줄로 렌더되어 캔버스 밖까지 잘려나간다(2026-06-11 LA-383 재현).
      if (it.story?.vertical && obj.text) {
        obj.text = obj.text
          .split('\n')
          .map((line) => [...line].join('\n'))
          .join('\n');
        obj.textAlign = 'center';
        // 세로 자간(Tracking)은 글자 진행(세로) 간격 → 줄전진으로 환산.
        // (charSpacing 은 1글자/줄 구조에서 측정 상쇄로 무효과 — 실측 §4.)
        obj.lineHeight = verticalLineHeightFromTracking(typo?.base.tracking ?? 0);
        verticalFrames.push(it.self);
      }
      // ⚠️ fabric 5.5: styles 키가 아예 없으면 fromObject 의 stylesFromArray(undefined)가
      // undefined 를 전파 → 이후 toObject(저장/PDF)에서 stylesToArray 가 크래시(무한로딩).
      // 빈 객체라도 반드시 출력한다.
      obj.styles = {};
      let textFillId = it.story?.fillColor;
      if (typo) {
        if (typo.base.sizePt) obj.fontSize = ptToPx(typo.base.sizePt); // pt→px(지배값)
        if (typo.base.font) obj.fontFamily = typo.base.font;
        if (typo.base.fontWeight !== 400) obj.fontWeight = typo.base.fontWeight;
        if (typo.base.fontStyle === 'italic') obj.fontStyle = 'italic';
        if (typo.base.underline) obj.underline = true;
        textFillId = typo.base.fillColor;
        if (!it.story.vertical) {
          obj.textAlign = typo.textAlign;
          if (typo.lineHeight != null) obj.lineHeight = typo.lineHeight;
          if (typo.charSpacing) obj.charSpacing = typo.charSpacing;
          // 전 run 동일 속성이면 {} 유지(불필요 비대 방지) — multiStyle 일 때만 채움.
          // styles 인덱스는 obj.text(=story.text, '\n' 분리 라인/라인내 문자) 기준.
          if (typo.multiStyle) obj.styles = typo.styles;
        } else if (typo.multiStyle) {
          // 글자단위 분해가 line/char 인덱스를 바꾸므로 세로짜기는 단일 스타일 유지(택1).
          // 근거: 실측 세로 4스토리 전부 단일 run — 리맵 이득 0, 인덱스 오염 리스크만 존재.
          textWarnings.add(
            `세로쓰기 혼합 스타일(${it.self}) — 글자단위 근사와의 충돌 방지를 위해 대표 스타일로 단일화`
          );
        }
        for (const w of typo.warnings) textWarnings.add(`텍스트(${it.self}): ${w}`);
      } else {
        if (it.story?.sizePt) obj.fontSize = ptToPx(it.story.sizePt); // pt→px(폴백)
        if (it.story?.font) obj.fontFamily = it.story.font;
      }
      const tf = resolveColor(textFillId, doc.colors);
      if (tf.unknown) {
        // 종전엔 경고 없이 검정 fallback(도형 fill 만 경고) — 그라디언트 등 미해석 색을 가시화
        textWarnings.add(`미해석 텍스트 색상: ${tf.unknown} — 검정으로 대체됨(그라디언트 등)`);
      }
      obj.fill = tf.isNone || tf.unknown ? '#000000' : tf.hex || '#000000';
      if (tf.cmyk) obj.cmykFill = tf.cmyk;
      if (tf.isSpot) { obj.spotColor = tf.spotName; spotNames.add(tf.spotName); }
      // width/height 는 프레임 자체 치수(회전 전)를 유지 → angle(예: 책등 세로쓰기 90°)
      // 회전 시 텍스트가 프레임 밖으로 넘치지 않게 한다. (이전엔 삭제해 책등 이탈)
    }

    objects.push(obj);
  }

  // 텍스트 매핑 경고(per-run 근사 한계/미해석 색상) — 프레임 간 중복 제거 후 병합
  warnings.push(...textWarnings);

  // 세로짜기 근사 경고 — 줄간격/단(column) 구성은 원본과 다를 수 있음
  if (verticalFrames.length) {
    warnings.push(
      `세로쓰기 텍스트 ${verticalFrames.length}개 — 글자 단위 세로 배치로 근사 변환됨. ` +
        `편집기에서 줄간격·위치를 확인하세요.`
    );
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
