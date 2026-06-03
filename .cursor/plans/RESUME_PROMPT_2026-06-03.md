# RESUME PROMPT — Storige 편집기 (2026-06-03 인수인계)

> 다음 세션 시작 시 **이 파일을 먼저 읽고** 이어서 작업. (CLAUDE.md 세션 시작 프로토콜: `CLAUDE.local.md` → 최신 RESUME_PROMPT → `git log --oneline -15`)
> 응답은 한국어. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## 0. 즉시 해야 할 일 (이 세션의 미완 #1)

### 🔴 [최우선] 스프레드 책 "편집완료" 표지 PDF 생성 예외
- **증상**: 스프레드(펼침 표지) 책에서 편집완료 시 표지 cover PDF 생성(`coverPlugin.saveMultiPagePDFAsBlob([allCanvas[0]],[allEditors[0]], {width: spreadCfg.totalWidthMm, height: totalHeightMm, cutSize}, undefined, 300)`)이 **예외를 던짐**. 프로덕션 난독화로 에러가 `Mt` 로만 찍혀 원인 미해독.
- **현재 배포 상태**: 진단 로깅 + cover/content **독립 try/catch(부분 생성)** 이미 배포됨(`1967bc5`). 실패해도 `complete()`는 진행(회귀 없음). 한쪽만 성공 시 그쪽 fileId 저장.
- **다음 단계(반드시 로컬에서)**: 프로덕션 브라우저가 무거운 editor(opencv 10MB)로 **반복 크래시**해 난독화 에러를 못 읽음. **로컬 dev 서버(`pnpm --filter @storige/editor dev`) + 소스맵**으로 편집완료 재현 → 콘솔 `[EmbeddedEditor] Spread COVER PDF 실패: <메시지> <stack>` 확인 → 표지 PDF 예외 수정.
  - 의심 후보: ① svg2pdf가 스프레드 표지 특수객체(fillImage/accessory/spread region)를 못 다룸 ② size=totalWidthMm(≈429mm 와이드) 관련 ③ 표지 캔버스 workspace/clipPath 상태. (재편집 로드 자체는 workspace 정상 — 콘솔 "Updated clipPath to loaded workspace" 확인됨)
- **관련 파일**: `apps/editor/src/embed.tsx` handleFinish(~807-940, 스프레드 분기 ~849-900), `packages/canvas-core/src/plugins/ServicePlugin.ts` `saveMultiPagePDFAsBlob`(194)→`_createMultiPagePDF`(525), 표지 workspace 체크(618).
- **QA 레시피**: shop-session 토큰 발급(X-API-Key=`STORIGE_API_KEY` in CLAUDE.local.md §5, memberSeqno=아무 정수) → `POST /edit-sessions {mode:'both', templateSetId:'f0335fda-bf48-47f2-a908-2b2e70e78de8'}` → `/embed?templateSetId=f0335fda…&sessionId=<id>&token=…&refreshToken=…&orderSeqno=…&mode=both` 로드 → 편집완료 → 세션 `coverFileId/contentFileId` 채워지는지 확인 + PDF 다운로드해 페이지수/판형 검증(표지=스프레드 전체폭, 내지=단면).

### 🟡 [확인 대기] bookmoa 측 후속 (지시문 전달 완료, 회신 대기)
- 핸드오프 `.cursor/plans/HANDOFF_bookmoa_합성트리거_게스트_2026-06-03.md` 전달함:
  - **A. compose-mixed 트리거(필수)**: 스프레드 책은 편집완료가 합성 자동발행 안 함 → bookmoa가 `editor.complete` 수신 후 `POST /api/worker-jobs/compose-mixed`(outputMode `single`, coverUrl/contentPdfUrl + 판형 + callbackUrl) 명시 호출해야 최종 합본 PDF 생성.
  - **B. "비회원" 배너**: 게스트 세션일 때만 표시. 회원이 보면 토큰 미전달/만료 또는 게스트 sessionId 재사용 → 회원 토큰 보장 + 로그인 시 `guest/migrate` 승계 + `editor.needAuth` 처리.
- **표지 PDF 예외 수정 후**: 편집완료→cover/content PDF→(bookmoa)compose-mixed→최종 합본 PDF 전 구간 E2E 검증.

---

## 1. 이번 세션(2026-06-03) 완료·배포 내역 (master, Vercel 자동배포 + API 수동배포)

| 영역 | 커밋 | 상태 |
|---|---|---|
| P0-1 에셋 라이브러리 단절 해소(editor-contents→library_*) | `b04dd39` | ✅ 배포·라이브검증(요소3/프레임2/배경3) · **API 재배포함** |
| P0-3 PDF DPI 72→300 + 이미지 인쇄캡 3508 | `9eff3ed` | ✅ |
| P1-5 객체 잠금/삭제불가(LockPlugin 배선+삭제강제+직렬화+관리자 토글) | `74a082f`,`615c642` | ✅ |
| P1-6 곡선 텍스트 PDF 보존(tspan rotate) | `61e3d13` | ✅ |
| P0-2 API 토대(content_pdf_mode, underlay 가드완화) | `c02a6e6` | ✅ **prod DB ALTER + API 재배포함** (편집기 pdfjs 파이프라인은 미착수) |
| 임베드 사일런트 리프레시(shop-refresh-body + 401 자동갱신 + refreshToken body 노출) | `d40c599`,`57cd860` | ✅ 라이브검증 · **API 재배포함** |
| 임베드 페이지 네비게이션 누락 수정(EmbeddedEditor에 BookNav/SpreadPagePanel 배선) | `6e12f83` | ✅ 라이브검증 |
| 스프레드 네비 위치 옵션 동작(SpreadPagePanel orientation) + 모바일 | `4681ab7` | ✅ 라이브검증(우측↔하단 토글) |
| 불러오기(모달) 멀티페이지 복원(빈 캔버스/workspace 오류) → URL 재진입 | `8dd1d32` | ✅ 라이브검증 |
| 복원 오버레이 hang 근본수정(loadFromJSON cb 타임아웃 + 폰트 allSettled/RAF가드) + 타임아웃 12s→8s | `eac4b3a`,`c445305` | ✅ 라이브검증(오버레이 즉시 닫힘) |
| 스프레드 편집완료 멀티페이지 PDF 분리(cover+content) + 스킵버그(내지 ServicePlugin 부재) 수정 + 진단로깅 | `eac4b3a`,`c556429`,`1967bc5` | ⚠️ **표지 PDF 예외 미해결**(위 §0) |
| 문서/매뉴얼 | `ff3bbde` | ✅ EDITOR.md §15, PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html, 갭문서 진행상태 |

전달 핸드오프: `759bd6a`(리프레시), `fe21761`(compose-mixed/게스트), 보관함/불러오기(8dd1d32 내), 합성/게스트(fe21761).

---

## 2. 갭 분석 잔여(미착수, 실시각 QA 필요) — `.cursor/plans/EDITOR_TEMPLATE_ASSET_GAP_2026-06-02.md` "진행 상태" 표 참조
- **P0-2 편집기/워커**: PDF 첨부 → pdfjs 렌더 → 잠금배경 페이지 자동생성 + 워커 underlay 합성. (API 토대만 있음. **참고: 이미 `vendor-pdf` 청크 존재 = pdfjs-dist 의존성 포함됨 → 신규 설치 불필요할 수 있음**.)
- **P1-4 사진틀 정식화**: extensionType photo-frame + fitMode(cover/contain) + 프레임내 이동/줌 + 원본화질 합성. 진입점 `useImageStore.ts:416-647`, `controls/`, `ServicePlugin`.
- **P2-7 면지** 편집 캔버스(loadTemplateSetEditor endpaper 분기), **P2-8 WYSIWYG**(`_removeSvgBackground` 과삭제 id기반 한정 등) — 모두 시각 diff QA 필요.

---

## 3. 운영 핵심 (상세는 CLAUDE.local.md)
- **편집기/관리자**: master push → Vercel 자동배포(`storige-editor` projectId `prj_SJiDnhbSopZphVVVAR0LBWvOaSui`, team `team_dOpgsAqfLyl4qNlVgSiFVm6B`). 빌드 ~1-3분.
- **API/워커**: **수동 배포** `ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && docker compose up -d --build api'`. prod `synchronize:false` → 엔티티 컬럼 추가 시 **반드시 prod ALTER 선행**.
- **빌드 검증**: `pnpm --filter @storige/canvas-core build` / `pnpm --filter @storige/editor build` / `build:embed` / typecheck. ⚠️ 기존 `useTemplateSetSave.ts:94` 타입에러 1건은 **사전존재·무관**(Vite 빌드 비차단).
- **admin 계정·STORIGE_API_KEY**: CLAUDE.local.md §5. (로그/커밋 금지)
- **템플릿셋 테스트**: `f0335fda-bf48-47f2-a908-2b2e70e78de8`("A4하드커버 책자", 스프레드 표지+내지1). 합성 회원 memberSeqno 예: 1049737389.
- **브라우저 QA 주의**: 프로덕션 임베드는 무거워(opencv) 백그라운드 탭/멀티탭에서 **렌더러 크래시** 잦음. 표지 PDF 같은 정밀 진단은 **로컬 dev + 소스맵** 권장. 편집기 unsaved-changes beforeunload로 같은 탭 navigate 막힘 → 새 탭 사용.
- **세션 정리**: QA로 만든 file_edit_sessions 는 `UPDATE … SET deleted_at=NOW()` soft-delete(하드삭제 금지).

---

## 4. 핵심 파일 빠른참조
- 임베드 편집기: `apps/editor/src/embed.tsx`(EmbeddedEditor: handleFinish/handleLoadSession/init), `views/EmbedView.tsx`(/embed 진입).
- 복원/로딩: `apps/editor/src/hooks/useEditorContents.ts`(loadTemplateSetEditor/loadSpreadModeEditor/loadCanvasData), `useEmbedAutoSave.ts`.
- 캔버스 코어: `packages/canvas-core/src/plugins/ServicePlugin.ts`(loadJSON/saveMultiPagePDFAsBlob), `FontPlugin.ts`(applyFontToObject), `WorkspacePlugin.ts`, `Editor.ts`(hooks tapPromise).
- 페이지 네비: `components/PageNavigation/BookNavigation.tsx`, `components/PagePanel/SpreadPagePanel.tsx`.
- 세션 API: `apps/api/src/edit-sessions/`(complete는 SPREAD 자동합성 스킵), `apps/api/src/worker-jobs/`(compose-mixed), `apps/api/src/auth/`(shop-session/shop-refresh-body).
