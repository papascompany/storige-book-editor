// 콘텐츠 ↔ 씬(중앙원점) 좌표 변환 — 단일 출처(SSOT).
//
// Storige 는 두 좌표계를 쓴다(자세한 규약은 docs/COORDINATE_SYSTEM.md):
//   • content (콘텐츠/좌상단원점): (0,0)=콘텐츠 좌상단, x∈[0,W] y∈[0,H].
//       IDML/PSD 파싱 좌표, 미리보기·래스터 SVG 의 viewBox("0 0 W H"), region 가이드, path 의 d.
//   • scene   (편집기/중앙원점): (0,0)=워크스페이스 중심.
//       fabric 객체 left/top(originX/originY='center'), 편집기 화면, PDF 렌더가 공유.
//
// 두 좌표계의 차이는 평행이동뿐: scene = content - half, content = scene + half (half={W/2, H/2}).
// 이 부호 규약을 이 파일 한 곳에만 두어, 변환기(toSpreadTemplate/toSinglePageTemplate)·
// 미리보기(preview/svg)·래스터(raster/rasterize) 가 각자 ±half 를 복붙하다 한 곳만 갱신을 빠뜨려
// 좌표가 틀어지는 사고(2026-06-11 ③④ 회귀)를 구조적으로 차단한다.
//
// ⚠️ path 의 d 문자열은 mapLocalToCanvas 가 이미 콘텐츠 절대 px 로 만든 값이라 변환 대상이 아니다.
//    (회전 피벗은 객체 중심 = 변환 대상.)

/** 캔버스(또는 콘텐츠) 폭/높이 → 반값 {halfW, halfH}. */
export function halvesOf(width, height) {
  return { halfW: width / 2, halfH: height / 2 };
}

// --- content → scene (변환기 출력: 객체 left/top, canvas anchor) ---
export const contentToSceneX = (contentX, halfW) => contentX - halfW;
export const contentToSceneY = (contentY, halfH) => contentY - halfH;
export function contentToScene(x, y, halfW, halfH) {
  return { x: contentToSceneX(x, halfW), y: contentToSceneY(y, halfH) };
}

// --- scene → content (미리보기/래스터 렌더: SVG viewBox 좌표) ---
export const sceneToContentX = (sceneX, halfW) => sceneX + halfW;
export const sceneToContentY = (sceneY, halfH) => sceneY + halfH;
export function sceneToContent(x, y, halfW, halfH) {
  return { x: sceneToContentX(x, halfW), y: sceneToContentY(y, halfH) };
}
