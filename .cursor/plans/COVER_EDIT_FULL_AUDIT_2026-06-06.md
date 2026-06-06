# 표지편집·책모드 전수 감사 + 개발 개선계획 (2026-06-06)

> 방법: 9차원 병렬 감사 → 미구현/결함 주장 **적대적 반증** → 종합(opus). 19개 에이전트, 모든 주장 file:line 근거.
> 스펙 기준: `스프레드편집_결정사항_요약_20260206.md`(A/B 결정) + `20260224_표지편집 모드에 대하여.pdf`.
> 적대적 검증 정정 1건: "낱장 width/height 미전달→210×297 폴백(broken)" → **implemented** (ProdConfigure.jsx:141-142가 productMeta.width/height 실제 전달; 폴백은 미전달 시에만, 재편집 Orders.jsx 경로만 해당).

---

## 0. 총평

- **캔버스 코어 로직(SpreadLayoutEngine/SpreadPlugin, 5영역·날개·총폭·재배치)은 성숙**하고 34개 단위테스트 통과. 단일/책 모드 분기, 상품↔템플릿셋 연결, 면지 비충돌, cover/content 분리생성도 동작.
- **그러나 "인프라는 있는데 사용자 진입점/배선이 빠진 반쪽 구현" 패턴이 반복**된다. 특히 **인쇄 무결성 가드가 코드엔 있으나 실가동 0%** — 이것이 최우선 리스크.
- PDF 핵심 요청(**영역 클릭 포커싱 편집**)과 별도 요청(**내지 PDF 자동 임포지션**)은 **미구현**.

---

## 1. 현황 매트릭스

### 1-A. 표지 펼침면 편집 (PDF 핵심)
| 영역 | 상태 | 핵심 |
|---|---|---|
| 펼침면 통합 단일화면·5영역 모델 | ✅ OK | SpreadLayoutEngine+SpreadPlugin 단일캔버스, 5영역(날개시)/3영역, 총폭 wing×2+cover×2+spine 공용함수. 34 테스트 통과 (A4/A5/A23/A24) |
| **영역 클릭→포커싱 편집** | ❌ **MISSING** | **PDF 핵심질문.** 통합 스프레드에 전무 — SpreadPlugin은 object:* 만 바인딩(mouse:down 없음), 가이드 evented:false, getRegionAtX·useCoverRegion·coverEditMode·zoomToRegion 전부 dead. 인프라만 있고 진입점 없음 |
| 포커싱 UI(CoverFocusBar) 정합 | 🟡 PARTIAL | separated(영역별 별도캔버스) 모델 전용 + `!isSpreadMode` 게이트 → 통합화면에선 숨김. 페이지전환이지 영역포커싱 아님. **단일화면 스펙과 정면 충돌** |
| 날개(wing) 5영역 | ✅ OK | 계산·총폭×2·admin입력→서버정규화/강제→editor→worker MediaBox까지 일관. 비활성 시 자유객체 강등 (B48) |
| A8 영역 경계/중앙 스냅 | ❌ MISSING | handleObjectMoving이 TODO 스텁(0줄) |
| A18 영역별 배경 오버라이드 | ❌ MISSING | 전역배경만. region 인지 타입/툴 없음 |
| A9 mm 라벨 줌보정(B58) | 🟡 PARTIAL | 라벨은 있으나 fontSize 고정+뷰포트 비례 스케일, 1/zoom 역보정 없음 |
| 책등 음영 밴드 | ❌ MISSING | 점선 가이드만, fill rect 없음 (PDF 시각화 대비) |

### 1-B. 상품별 템플릿 등록·연결·운영
| 영역 | 상태 | 핵심 |
|---|---|---|
| admin SPREAD 직접 저작(A22) | ✅ OK | TemplateEditor가 편집기 `/template` iframe 임베드, 스프레드 설정모달(coverW/H·wing·초기책등) |
| 책템플릿셋 구조검증(A23) | ✅ OK | SPREAD=1+PAGE N, WING/COVER/SPINE 불허를 admin+서버(validateBookModeTemplates) 양쪽 강제 |
| 단일/책 모드 결정(A19) | ✅ OK | templateSet.editorMode DB값으로 결정, spread 템플릿 존재 시 book 자동전환 |
| 상품↔템플릿셋 연결·운영 | ✅ OK | product_template_sets(sortcode→set, 기본/순서/활성), 삭제 시 사용중 차단 |
| **소프트커버 가변책등 "기존디자인 영역분할 등록"** | ❌ MISSING | **PDF 추가요청.** admin SPREAD 저작은 빈 캔버스만, 기존 표지 임포트→영역분할 등록 UI 부재 (cropRegions.ts는 3D목업 전용) |
| 고객진입 sortcode 런타임 분기 | 🟡 PARTIAL | by-product API는 있으나 고객흐름은 수기 단일 storigeTemplateSetId 의존. 상품별 분기가 운영자 ID 입력에 의존 |
| by-product DTO 노출 | 🟡 PARTIAL | editorMode/coverEditable/endpaperConfig 미노출(편집기 본문 재조회로 기능보완) |

### 1-C. 낱장상품·페이지추가
| 영역 | 상태 | 핵심 |
|---|---|---|
| 낱장(단일모드) end-to-end | ✅ OK | 워크스페이스·로드·PDF 생성/업로드 분기 배선. width/height 전달 확인(정정됨) |
| 페이지 추가/삭제 기본동작 | ✅ OK | 캔버스 생성·제거, pages 동기화, 책모드 추가→책등 재계산→resizeSpine. 하단 SpreadPagePanel |
| **A13 제본별 최소페이지·중철 4배수 가드** | ❌ MISSING | 무선32p/중철4p·4배수 강제 editor에 없음. 서버는 비차단 warning만. SpineEditor 라벨은 dead(미마운트) |
| B24 spine debounce300+abort | 🟡 PARTIAL | AbortSignal이 spineApi까지 미전달(콜백만 무시), add/delete 버튼이 debounce 우회 직접호출 |
| 페이지 add/delete History(B25) | ❌ MISSING | 크로스캔버스 페이지 undo 스택 없음 |
| 책등 resize=History 비대상(B25) | 🔴 BROKEN | resizeSpine이 historyProcessing 미설정 + 가이드/라벨이 history 필터 통과 → 캔버스 히스토리 오염(undo 시 책등폭 오복원) |
| restoring/isLayoutTransaction 플래그(B26) | 🔴 BROKEN | store 플래그 true 세팅 0건 → 즉시재계산 분기 dead code |

### 1-D. 면지(endpaper)
| 영역 | 상태 | 핵심 |
|---|---|---|
| 면지 ↔ 스프레드 충돌 | ✅ NO-CONFLICT | endpaperConfig(compose-mixed 워커) / ENDPAPER 타입 2종 모두 내지 PAGE세트·책등 pageCount·패널 미진입. SPREAD 합성 불간섭 |
| validateBookModeTemplates ENDPAPER 거부 | 🟡 PARTIAL | book검증이 ENDPAPER 미언급 → BOOK셋에 섞여도 통과(무해하나 A23 위반 잠복, admin이 만든 면지 편집기서 조용히 사라지는 UX 비일관) |

### 1-E. 내지 PDF 자동 임포지션 (별도 요청)
| 영역 | 상태 | 핵심 |
|---|---|---|
| **내지 PDF 첨부→표지편집 모드→자동 임포지션 표시** | ❌ **MISSING** | editor-side 전무. pdfjs 미설치, pdfToImages/renderPage 0건. ContentPdfAttachModal은 배타(replace) 플로우("PDF첨부와 캔버스편집 동시 불가"). 실제 합본은 워커 compose-mixed 최종출력에만 |
| contentPdfMode:'underlay' | 🔴 BROKEN | API DTO/주석에만 있는 죽은 컬럼. editor/canvas-core 참조 0건 |

### 1-F. 프런트↔편집기 연동·인쇄 무결성 (★ 최우선)
| 영역 | 상태 | 핵심 |
|---|---|---|
| mode 전송/스프레드 트리거 분리 | ✅ OK | bookmoa는 cover/both만, 트리거는 editorMode='book'/spread템플릿. 설계 일관 |
| **편집기 metadata.spread/spine 저장(B38)** | ❌ **MISSING** | 완료 시 {spreadContentPageCount}만 기록. **출력재현 단일소스가 비어있음** |
| B48 상품스펙 강제검증 | ❌ MISSING | CreateEditSessionDto에 coverW/H/wing 필드조차 없음 |
| B49 세션생성 SpreadSpec 재검증 | ❌ MISSING | edit-sessions가 SpreadSpec import조차 안 함 |
| B38/B49 스냅샷 검증 게이트 | 🔴 BROKEN | validateSpreadSnapshot이 `session.mode===SPREAD` 게이트인데 그 mode가 절대 세팅 안 됨 → **정상흐름서 항상 스킵** |
| B42-44 cover.pdf MediaBox 하드검증 | 🟡 PARTIAL | 견고히 구현됐으나 mode==='spread'(handleSpreadSynthesis) 전용, **실제 출력 compose-mixed엔 미적용** |
| /worker-jobs/spread-synthesize 배선 | 🔴 BROKEN | controller 라우트 자체가 없음 — MediaBox 하드검증의 유일경로가 dead |
| bookmoa 실제 출력(compose-mixed) | 🔴 BROKEN | cover 크기를 프런트 저장값 무검증 신뢰. MediaBox/스냅샷 미호출. **인쇄사고 직결** |

---

## 2. 구조 관통 문제 (crossCutting)

1. **두 패러다임 공존·충돌**: 통합 펼침면(단일캔버스, 스펙 정답) vs 레거시 separated(영역별 별도캔버스). 영역 인터랙션(CoverFocusBar/MoveToCoverRegion)은 전부 separated 전용이고 통합 모드에선 게이트로 숨겨짐 → PDF 핵심질문이 통합엔 미구현, separated엔 단일화면 스펙과 상충.
2. **3개 축 분리(mode / editorMode / SessionMode)**: 편집기 mode에 'spread'가 없어 session.mode가 SessionMode.SPREAD가 절대 안 됨. 그런데 가장 견고한 서버 검증이 그 SPREAD 게이트에 의존 → **검증이 정상흐름서 항상 스킵**.
3. **스냅샷 미저장의 파급**: 편집기가 출력재현 단일소스를 안 저장 → API·워커의 스냅샷 가드 전부 데이터 부재로 무력. 검증 인프라(코드)와 실제 데이터흐름(배선)의 단절.
4. **반쪽 구현 반복**: getRegionAtX/useCoverRegion·coverEditMode·/embed coverWing·PageLimitModal·SpineEditor·restoring 플래그 — 전부 선언/인프라만 있고 진입점/배선 없음.
5. **연결 이중소스+수기 의존**: storige product_template_sets ↔ bookmoa storigeTemplateSetId. 폴백(sample-8x8-book-24p)이 잘못된 ID를 alert만 띄우고 테스트모드로 흡수 → 주문 오류 조용히 통과 위험.
6. **검증 비대칭**: A13·A23 등 제약이 "서버는 알지만 안 막거나, admin은 막지만 런타임은 안 막거나" 형태로 부분적.

---

## 3. 인쇄사고 직결 리스크 (P0)

- **[P0-A]** 실제 출력(compose-mixed)이 표지 펼침면 크기를 프런트값 무검증 신뢰 → 책등폭·내지 페이지수 불일치 시 잘못된 크기로 인쇄, 표지-책등 어긋남/재단 틀어짐.
- **[P0-B]** metadata.spread/spine 미저장 → 인쇄사고 시 원인추적·재현·검증자동화 기반 부재.
- **[P0-C]** 견고한 무결성 하드검증(MediaBox/스냅샷/1페이지 강제)이 실가동 0% (게이트 스킵 + spread-synthesize dead + 실출력은 검증없는 compose-mixed).

---

## 4. 개발 개선 계획 (로드맵)

### 🔴 P0 — 인쇄 무결성 (3건, 반드시 함께·순서대로)
1. **[M] 편집기 스프레드 완료 시 metadata.spread(SpreadSpec)+metadata.spine 저장** — 모든 가드의 전제. embed.tsx 완료 update(~1026-1031)/useWorkSave.ts(~691-697)/edit-sessions.ts DTO(~73-84). 이미 store에 보유 → 직렬화만.
2. **[M] 검증 게이트를 SessionMode→editorMode/metadata.spread 존재 기준으로 변경** — edit-sessions.service.ts(:393 게이트, create ~50-80). #1과 동시 배포(soft→hard).
3. **[L] compose-mixed 실출력에 MediaBox 대조 하드검증 실가동** — synthesis.processor.ts(handleComposeMixedSynthesis ~119-293) + pdf-synthesizer(validateSpreadSnapshot ~701). 단계적 롤아웃(경고→하드), 스프레드 케이스만 선별.

### 🟠 P1 — 스펙/PDF 핵심 기능갭 (5건)
4. **[XL] 통합 펼침면 영역 클릭→포커싱 편집** (PDF 핵심) — SpreadPlugin mouse:down→getRegionAtX→zoom/pan/편집컨텍스트 + dead 훅/설정 연결. 단계적(선택→포커싱→편집제한).
5. **[M] A13 제본별 최소페이지·중철 4배수 가드** (인쇄사고) — useEditorStore canAddMorePages/canDeletePage + 서버 차단 검토. 기존주문 soft/신규 hard.
6. **[M] B48/B49 세션·합성잡 상품스펙 강제검증** — CreateEditSessionDto/compose-mixed DTO에 표지스펙 + 대조검증.
7. **[L] 고객 sortcode by-product 런타임 분기 연결 + DTO 확장**(editorMode/coverEditable/endpaperConfig 노출) + 폴백 alert→명시적 오류처리.
8. **[XL] PDF 추가요청: 소프트커버 가변책등 기존디자인 영역분할 등록 admin 도구** — TemplateEditor SPREAD 저작에 기존표지 임포트→5영역 분할 UI(cropRegions 재활용).

> 별도 요청 **내지 PDF 자동 임포지션**은 기존 갭 **P0-2(편집기 pdfjs 파이프라인)** 와 동일 — pdfjs-dist 추가→pdfToImages→첨부 시 페이지별 잠금배경 임포지션→underlay 모드. 규모 XL, P1급.

### 🟡 P2 — 폴리시/기술부채 (4건)
9. **[L] 책등 resize 히스토리 오염 차단 + B24 debounce/abort 실가동 + restoring 플래그 정리** (undo 정합).
10. **[L] A18 영역별 배경 + 책등 음영밴드 + A9 라벨 줌보정** (영역배경은 워커 출력 정합 스코프 선결).
11. **[M] A8 영역 경계/중앙 스냅** (handleObjectMoving 구현).
12. **[S] ENDPAPER를 book검증 화이트리스트 거부 + dead 코드/명세 정리** (PageLimitModal·underlay 등).

---

## 5. 검증 신뢰도
- 9차원 전부 적대적 반증 통과. 정정 1건(낱장 width/height)으로 거짓 음성 제거.
- 모든 BROKEN/MISSING 판정은 grep-negative 또는 직접 file:line 확인 기반.

---

## 6. 진행 내역 (실행 로그)

### ✅ P0 Step 1 — 스프레드 출력재현 단일소스 (완료·배포·라이브검증, 2026-06-06, 커밋 `df99d69`)
설계→적대적검증(sound-with-fixes, MAJOR 2/MINOR 4 전부 반영)→구현→빌드/테스트→배포→프로덕션 능동 E2E.

**P0-1 (편집기 metadata.spread/spine 저장)** + **P0-2 (검증 게이트 editorMode 전환, SOFT)** 함께 처리.

저장 계약(`EditSession.metadata`):
- `spread`(SpreadSnapshot): `{ spec:SpreadSpec(8필드), totalWidthMm, totalHeightMm, dpi }`. 총폭은 `computeSpreadDimensions(normalizeSpreadSpec(spec))` 재계산값(wing×2 포함 단일소스, 스토어 캐시 미사용).
- `spine`(SpineSnapshot): `{ pageCount, paperType, bindingType, spineWidthMm, formulaVersion, spineWidthSource? }`. 필수 5필드 모두 유효할 때만 기록(부분기록 금지). `spineWidthSource`=spec이 공식값과 일치하면 'formula', 수동조정이면 'manual'.
- `spreadValidation`(SpreadValidationResult): 완료 시 서버가 기록 `{ ok, checkedAt, gate, mismatches, mode }`.

검증 게이트: `session.mode===SPREAD || !!metadata.spread`. 편집기는 책 완료 시에도 mode를 'both'/'cover'로 보내므로 **metadata.spread 존재**로 편집기 책 완료를 포착. 기본 **SOFT**(누락/불일치=경고·기록, throw 금지 → 기존 주문 무중단). 운영 ENV `SPREAD_SNAPSHOT_HARD_FAIL=true`일 때만 HARD 차단(P0-3 이후 승격).

구현: `packages/types`(SPINE_FORMULA_VERSION, spineWidthSource, SpreadValidationResult+EditSessionMetadata.spreadValidation), `apps/editor/src/utils/buildSpreadSnapshots.ts`(공용 util, try/catch 무중단), `embed.tsx`/`useWorkSave.ts`(두 완료경로 적용), `apps/api/.../edit-sessions.service.ts`(게이트+soft validateSpreadSnapshot).

검증: types/api/editor/worker 빌드 통과 · edit-sessions.service.spec 8/8 · buildSpreadSnapshots 7/7 · **프로덕션 E2E**: 스프레드 편집완료 재현 → 세션 metadata에 spread/spine/spreadValidation(ok:true, gate:metadata-spread, mode:soft) 기록 + spineWidthSource:'formula' + totalWidthMm 정확(214×2+0.6=428.6) 확인. DB ALTER 0건(metadata=JSON).

→ **다음**: P0 Step 2 = P0-3(실출력 compose-mixed MediaBox 하드검증, soft→hard 단계) → 이후 `SPREAD_SNAPSHOT_HARD_FAIL=true` 승격.

### ✅ P0 Step 2 — compose-mixed 스프레드 cover MediaBox 무결성 검증(SOFT) + 분리 2파일 규칙 강제 (완료·배포·라이브검증, 2026-06-07, 커밋 `d81d3a7`)
재설계 필요했음: 1차 설계(게이트 `outputMode==='separate'`)가 **FLAWED** — bookmoa는 스프레드 책을 `outputMode='single'`로 보내고 single 분기는 cover 미로드/미출력. 운영DB 확인 결과 스프레드 합성은 **프로덕션 미실행**(오늘 프리즈 수정 전까지 스프레드 편집완료 불가). CTO 확정 비즈니스 규칙(**스프레드 책 = cover.pdf[펼침면 전체:뒷표지|책등|앞표지+날개] + content.pdf "분리 2파일"**)으로 재설계.

구현(API+Worker):
- **API `createComposeMixedJob`**: 세션 `metadata.spread`(Step1 스냅샷) 조회 → ①cover 검증 기대치(`spreadTotalWidthMm/HeightMm/dpi`) 큐 push, ②스프레드 책(coverEditable)이면 `outputMode`를 **'separate' 강제**(편집기 펼침면 cover가 출력에서 누락되지 않게). best-effort try/catch(잡 생성 무중단).
- **Worker `handleComposeMixedSynthesis`(separate 분기)**: coverDoc 로드 직후 `validateSpreadCoverSize` — 1쪽 가정 + MediaBox(pt→mm) ↔ 기대치, tol=max(0.2mm,1px@dpi). **SOFT**(기본): `result.coverSizeValidation` 기록 + warn, throw 금지. **HARD**(`SPREAD_SNAPSHOT_HARD_FAIL=true`): `SPREAD_PDF_SIZE_MISMATCH` throw→잡 FAILED.

게이트: `metadata.spread 존재 AND 펼침면 cover 입력`. 비스프레드/레더(content-only)/빈표지 폴백 자동 skip. cover=펼침면 전체폭이라 2배 오탐 없음.

**라이브 E2E(프로덕션, soft)**: compose-mixed 직접 호출로 검증 — outputMode 'separate' 강제 ✅, 기대치 428.6 push ✅, **PASS**(cover 428.6 → `ok:true, mismatches:[]`) ✅, **MISMATCH 3종**(35.28/209.97/429.2mm → `ok:false` 정밀 mm 기록) ✅, 전부 SOFT COMPLETED(무차단) ✅.

### 🐞 보너스 — P0-3 가드가 실제 인쇄크기 결함 1건 검출·수정 (커밋 `8580b96`)
첫 실제 cover 검증에서 cover MediaBox **429.2mm vs 기대 428.6mm(0.6mm 과대)** 검출. 근본원인: `useSettingsStore.updateSpreadSpineWidth`가 책등 리사이즈(1.2→0.6mm) 시 `spec.spineWidthMm`만 갱신하고 `SpreadConfig.totalWidthMm`는 stale(429.2) → cover 생성이 stale 총폭 사용. 수정: `computeSpreadDimensions`로 `totalWidthMm/totalHeightMm` 동시 재계산. 검증: 수정 후 cover가 `428.6 x 301`로 생성 → MediaBox 검증 `ok:true`. (SOFT 우선 배포의 가치 — HARD였다면 모든 스프레드 합성이 차단됐을 결함을 무중단 검출)

### ⚠️ HARD 승격 선결조건 (운영)
`SPREAD_SNAPSHOT_HARD_FAIL=true`는 API(완료시점)+Worker(MediaBox) 양쪽을 동시 승격하나, **worker 컨테이너에 ENV가 주입되는지 확인 필요**: `docker exec storige-worker printenv SPREAD_SNAPSHOT_HARD_FAIL`. 미주입 시 docker-compose.yml worker 서비스 environment에 추가. SOFT 기간 `worker_jobs.result.coverSizeValidation.ok=false` 빈도 모니터링 후 승격.

### P0 종합: 3개 핵심(스냅샷 저장 → 게이트 전환 → compose-mixed 실검증) 전부 SOFT로 실가동 + 실제 결함 1건 수정. 인쇄사고 방지장치가 "코드엔 있으나 실가동 0%" → **실가동(SOFT)**. HARD 승격은 모니터링 후 ENV 1개로.
