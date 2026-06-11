# [새 세션 프롬프트] IDML 템플릿 변환기 보완 사이클 (2026-06-12~)

> **용도**: 새 Claude Code 세션에서 `@storige/indesign-import`(IDML→Storige 템플릿 변환기)를
> 추가 보완하기 위한 자립형 시작 프롬프트. 이 문서만 읽으면 이전 컨텍스트 없이 작업 가능.
> **역할**: CTO 오케스트레이션 — 서브에이전트 병렬 조사/구현 + 적대 교차검증, 한국어 응답.

---

## 0. 세션 시작 체크리스트 (순서대로)

1. `CLAUDE.local.md` 읽기 (SSH/배포/시크릿 위치 — 커밋 금지 파일).
2. **필수 선행 문서 3개**:
   - `docs/COORDINATE_SYSTEM.md` — 좌표 규약 **동결 정본** (4좌표계 + content↔scene SSOT)
   - `docs/DESIGN_IMPORT_CONVERTER.md` — 변환기 아키텍처 (§3.4 좌표, §3.6 객체속성, §12 재편집 정합성 사이클)
   - `docs/IDML_IMPORT_FLOW.md` — 운영 플로우 + §5b/§6 문제해결
3. `git log --oneline -15` 로 최신 상태 확인.
4. 테스트 베이스라인: `pnpm --filter @storige/indesign-import test` → **43/43** 이 기준.

## 1. 현재 상태 (2026-06-11 마감 기준 — 전부 라이브 배포됨)

### 완료된 수정 사이클 (회귀 금지 — 절대 되돌리지 말 것)
| 커밋 | 내용 |
|---|---|
| `9628f1a` | textbox `styles:{}` 필수 출력(저장 크래시 방지) + placed 이미지 회색 플레이스홀더 |
| `527b85b` | 재편집 붕괴 5종: loadJSON width/height strip·workspace 복원 / preview·raster 중앙원점 보정 / `ARTWORK_LOCK`(하이브리드 배경 고정) / Oval `rx/ry` / admin vercel ignoreCommand에 indesign-import 추가 |
| `a64d409` | **좌표 변환 SSOT** `geometry/centerOrigin.mjs` 단일화 + 불변식 테스트(renderInvariants) |
| `d9a3e4b` | **세로짜기**(StoryOrientation=Vertical) 파싱 + 글자 단위 세로 배치 근사 (LA-383 디버그) |
| `9898eab` | 책등 재배치 anchor 보존 + stale origin 수정 + **변환기 spine 강등 가드**(전폭 배경 오분류 차단) |

### 핵심 함정 (코드 만지기 전 숙지)
- **좌표**: 객체 left/top = scene(중앙원점). content↔scene 변환은 `geometry/centerOrigin.mjs` 헬퍼만 사용
  (±half 복붙 금지 — 과거 드리프트 사고의 원인). `renderInvariants.test.mjs` 가 가드.
- **textbox 는 `styles:{}` 필수**, **Oval 은 `rx/ry` 필수**, **배경 아트워크는 `ARTWORK_LOCK`**(convert/artworkLock.mjs) 필수.
- **spine regionRef**: 객체폭 > spine폭×1.05 면 강등(canvas anchor) — cover 판정은 불변.
- 변환기는 **admin 브라우저 번들에서 실행** — 수정 후 admin Vercel 자동배포(ignoreCommand 해결됨)
  + **브라우저 캐시 함정**: 검증은 반드시 새 탭/캐시버스트.
- `canvasData.width/height` 는 판형 메타 — fabric 캔버스 치수가 아님(loadJSON 이 strip).
- 2026-06-11 이전 등록된 템플릿은 깨진 데이터일 수 있음 → **재가져오기**가 정답(코드로 자동복원 안 됨).

### 검증 자산
- 실제 IDML: `~/Desktop/MA-348_26_KYM.idml`(도형/텍스트 표지), `~/Desktop/LA-383_26_KYM.idml`(placed 이미지+세로짜기) — **커밋 금지**.
- 로컬 변환: `node packages/indesign-import/scripts/convert-sample.mjs <파일>` (Node에서 변환기 직접 실행 가능, 래스터는 sharp).
- 라이브: admin `/templates/import` (브라우저 자동화는 로컬 파일 업로드 불가 → 로컬 node 변환 또는 사용자 업로드로 검증).
- 라이브 정합 기준 템플릿셋: `a2cc2939-b76d-41a2-bd41-2d9fba091a24`('A4 기본 책자', MA-348 기반).
- 편집기 E2E 토큰: `POST /api/auth/shop-session`(X-API-Key — CLAUDE.local.md) → `/embed?templateSetId=...&token=...` (토큰은 파일로 생성해 전사 변형 방지).

## 2. 보완 백로그 (이번 세션 후보 — 오너와 우선순위 합의 후 진행)

### A. 변환 충실도 (실측 기반 갭)
| # | 항목 | 현황 | 난도 |
|---|---|---|---|
| A1 | **그라디언트 fill** | reader 미파싱(0건) — 단색 hex 만. IDML `Gradient` → fabric linear/radial gradient 변환. 현재는 하이브리드 모드로 우회 | 중 |
| A2 | **텍스트 per-run 스타일** | story 단일 폰트/사이즈만 추출 — 혼합 폰트/색/크기 run 을 `styles` 객체로 채우기(아웃라인 출력 충실도와 직결) | 중상 |
| A3 | **행간(leading)/자간(tracking)/정렬(align)** | 미추출 — textbox lineHeight/charSpacing/textAlign 매핑 | 중 |
| A4 | **세로짜기 품질** | d9a3e4b 글자 단위 근사 — 자간/약물(괄호·장음) 회전, 다열 세로 등 정밀화. LA-383 으로 시각 회귀 비교 | 중 |
| A5 | **placed 이미지 복원 플로우** | 현재 회색 플레이스홀더 — 개선안: (a) IDML+링크이미지 zip 동반 업로드 → Links 파일명 매칭 자동 배치, (b) admin 가져오기 화면에서 프레임별 이미지 매칭 UI | 상 |
| A6 | stroke 정밀도(dash/cap/join), 모서리 radius, 프레임 crop/fit | 미확인 — reader 실측 후 판정 | 소~중 |

### B. 구조/파이프라인
| # | 항목 | 현황 |
|---|---|---|
| B1 | **내지(다중 스프레드/페이지) IDML** | 현재 표지 스프레드 1장 전제 — 내지 IDML(다중 페이지) → PAGE 템플릿 일괄 변환은 미지원 |
| B2 | **미리보기 렌더 엔진 통일** | preview/raster 수제 SVG vs 편집기 fabric — 장기적으로 fabric StaticCanvas 통일 검토(렌더 불일치 원천 제거) |
| B3 | **폰트 시딩 자동화** | woff2ToTtf 엔드포인트 구축됨 — 미임베드 폰트 경고 → 라이브러리 자동 시딩 연결 잔여 |
| B4 | 기존 깨진 등록 템플릿 정리 | LA-383/MA-348 구버전 재가져오기 + 중복(96728f5c 등) 삭제 운영 정리 |

### 권장 진행 방식
1. 오너에게 A/B 우선순위 확인(특히 A5 placed 이미지 — 운영 임팩트 최대 / A1 그라디언트 — 디자인 충실도).
2. 항목별: reader 실측(실 IDML 2종) → 서브에이전트 조사/구현 → 단위테스트 추가(43 베이스라인 위에) →
   로컬 node 변환 정량검증 → admin 배포 → **재편집 라운드트립**(등록→편집→저장→재편집)까지 라이브 검증.
3. 완료 시 `docs/DESIGN_IMPORT_CONVERTER.md`(+.html)·`IDML_IMPORT_FLOW.md` 갱신 + 본 문서 후속 RESUME 기록.

## 3. 연동 컨텍스트 (참고)
- bookmoa-mobile 연동·고객 UX 플로우는 별도 트랙: `bookmoa-mobile/docs/STORIGE_UX_HANDOFF_2026-06-11.md`
  (보관함/삭제 리스트/발주 후 동결 §4.3 — 변환기 세션과 분리, 손대지 말 것).
- storige admin '삭제 리스트', 세션 metadata.orderOptions/member 스냅샷은 배포 완료(b60e93f/52086c5).
