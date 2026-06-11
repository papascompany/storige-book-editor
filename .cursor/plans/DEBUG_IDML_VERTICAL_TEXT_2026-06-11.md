# IDML 가져오기 디버그 사이클 — 세로짜기(Vertical Text) 미지원 (2026-06-11)

> **목적**: "a64d409 이후에도 IDML 업로드가 깨진다"는 보고의 전체 디버깅 기록.
> 다른 세션이 같은 증상을 만나면 이 문서를 먼저 참조.
> 관련: `docs/IDML_IMPORT_FLOW.md` §5b/§6, `docs/COORDINATE_SYSTEM.md`

---

## 1. 보고된 증상 (LA-383_26_KYM.idml, 표지 210×297 + 책등 10mm, 날개 없음)

| # | 증상 | 판정 |
|---|------|------|
| 1 | 업로드 미리보기부터 회색 박스 + 텍스트 어긋남 | 절반은 **IDML 포맷 한계**(아래 §4), 절반은 **세로짜기 버그**(§3) |
| 2 | 템플릿편집 모드에서도 동일하게 깨짐 | 동일 |
| 3 | 저장 후 "다시 편집" 시 **다른 템플릿**(고등수학) 객체가 보임 | **오인** — 수정 전(06-11 08:06 배포 이전) 등록된 레거시 MA-348 템플릿(`2e3e40b9…`)을 연 것. DB로 확인: 사용자가 저장한 `c95a11c9…`(LA-383)는 내용·좌표·workspace 모두 정상 저장됨 |

## 2. 증거 수집 경로 (재사용 가능한 기법)

1. **배포 시각**: `https://api.github.com/repos/papascompany/storige-book-editor/deployments` — Vercel이 GitHub deployment 생성. 527b85b admin/editor = 06-11 08:06~08:08 KST, a64d409 admin = 09:31 KST → 사용자 테스트(10:09)보다 앞섬 = "배포 안 됨" 가설 기각.
2. **DB 직접 조회**: `templates` 테이블에서 id/name/created·updated_at + `JSON_EXTRACT(canvas_data,'$.objects[*].left')` 등으로 저장본 좌표·내용 검증 (전체 dump 불필요).
3. **저장 시점 썸네일**: `templates.thumbnail_url` PNG = 저장 당시 캔버스 렌더 스냅샷. 편집기 화면 증거로 최강.
4. **로컬 재현**: 원본 IDML이 사용자 Mac에 있음(`~/Desktop/LA-383_26_KYM.idml`, `~/Desktop/MA-348_26_KYM.idml`, 원본 폴더 `~/Downloads/0604_기성표지/`). `packages/indesign-import`에서 Node 스크립트로 `parseIdml`→`toSpreadTemplate` 실행해 NDJSON 계측.

## 3. 근본 원인 — IDML 세로짜기 미지원 (이번에 수정)

- InDesign **세로짜기** 텍스트는 `Stories/Story_*.xml`의 `<StoryPreference StoryOrientation="Vertical">`로 표현된다. **회전(ItemTransform)이 아님** — 글자가 똑바로 선 채 위→아래로 쌓이는 CJK 세로조판.
- 리더(`idml/reader.mjs`)가 이 속성을 파싱하지 않아 가로 텍스트로 변환됨.
- LA-383의 앞/뒤표지 제목·"독서" 4개 프레임이 전부 Vertical: 예) 제목 프레임 37×167.4mm(좁고 김), 60pt. 가로 렌더 시 fontSize 125px 한 줄이 캔버스 우단(1269.7px)을 넘어 1634px까지 오버플로 → "제목이 잘려나가고 깨져 보임".
- 책등 텍스트는 `Horizontal` + 프레임 회전 90° 방식이라 기존 코드로 정상이었음 (두 방식은 다른 메커니즘).

**수정** (커밋 참조):
- `packages/indesign-import/src/idml/reader.mjs` — `parseStory()`가 `StoryPreference@StoryOrientation`을 읽어 `story.vertical` 반환.
- `packages/indesign-import/src/convert/toSpreadTemplate.mjs` — `vertical`이면 텍스트를 **글자 단위 세로 배치**(한 글자=한 줄, `textAlign:'center'`, `lineHeight:1`)로 근사 + 검수 경고("세로쓰기 텍스트 N개 …") 추가.
- 검증: 변환기 테스트 42/42 통과, LA-383 실파일 미리보기 SVG 렌더에서 원본과 동일한 세로 제목 배치 확인, 오버플로 해소(프레임 우단 1181px < 1269.7px).
- 한계: 단(column)·줄간격은 근사. 다단 세로조판(여러 단락)은 한 단으로 합쳐짐 → 관리자가 편집기에서 보정.

## 4. 코드로 해결 불가한 IDML 포맷 한계 (반복 문의 예상)

- **배치(placed) 이미지**: IDML에는 링크 메타만 있고 **이미지 픽셀이 없다**. 벡터/하이브리드 모두 복원 불가 → 회색 플레이스홀더 + 경고가 정상 동작. 이미지 위주 디자인(LA-383 버블 배경 등)은 "다 깨진 것처럼" 보이지만 텍스트·도형·좌표는 정상.
  - 대안(미구현 후보): ① IDML+Links 폴더 zip 업로드 지원, ② 운영자가 편집기 [이미지] 메뉴로 원본 업로드 교체(현행 안내), ③ InDesign에서 배경을 PNG로 내보내 하이브리드 배경으로 별도 첨부.
- **폰트 미임베드**: 폰트는 라이브러리 시딩 필요(기존 경고 동작).

## 5. 레거시 데이터 주의 (재가져오기 대상)

06-11 08:06 KST(527b85b 배포) **이전에 가져온** 템플릿은 코드 수정으로 자동 복원되지 않음 → 삭제 후 재가져오기:
- `2e3e40b9…` MA-348 (06-11 00:16 등록, 하이브리드 좌우반전 PNG 박제)
- `96728f5c…` MA-348, `b403bf52…` LA-383 (06-10 등록, width가 px로 오염)
- `9cb8709f…` MA-348 (06-09 등록)

또한 같은 파일을 여러 번 가져와 **동명 템플릿이 다수 공존** → "다시 편집" 시 다른 행을 열고 깨졌다고 오인하기 쉬움. 테스트 후 구버전 정리 권장.

## 6. 잔여 후보 작업 (미착수)

- [ ] 배치 이미지 복원: IDML+Links zip 업로드 지원 (§4 ①)
- [ ] 세로짜기 다단/줄간격 정밀화 (필요 시)
- [ ] 가져오기 목록 UX: 동명 템플릿 구분(가져온 시각 표시 등)
