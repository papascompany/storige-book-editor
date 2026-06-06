# RESUME PROMPT — Storige (2026-06-07 인수인계)

> 새 세션 시작 시 **이 파일 먼저 읽기**. 프로토콜: `CLAUDE.local.md` → 최신 RESUME_PROMPT(이 파일) → `git log --oneline -20`.
> 응답 한국어. 커밋 끝 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
> 운영: master push → editor/admin **자동배포(Vercel)**. API·worker 는 **수동배포**(`ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && docker compose up -d --build api worker'`). 프로덕션 고객 실사용 — 빌드/테스트 후 진행. SSH 키 `ssh-add -l` 확인.

---

## 0. 이번 사이클(2026-06-06~07) 완료·배포 내역 (전부 라이브, SOFT)

전수 감사(`COVER_EDIT_FULL_AUDIT_2026-06-06.md`) → 인쇄 무결성(P0) 전량 + 표지편집(P1) 3/4 구현. 상세: `docs/EDITOR.md §19`, `docs/SYSTEM_INTEGRATION_OVERVIEW.md` v2.6.

| 영역 | 커밋 | 상태 |
|---|---|---|
| 스프레드 편집완료 **프리즈 근본수정**(metadata 400 @Transform + 내지 unit 옵셔널체이닝) | `027c010` | ✅ '렌더러 프리즈' 오진 정정. 편집완료 정상화 |
| **woff2ToTtf 엔드포인트**(`POST /library/woff2ToTtf`, wawoff2, SSRF) | `8fea0e8` | ✅ ※아웃라인화 실발효는 폰트 시딩(제품결정) 후 |
| **P0-1/2 출력재현 단일소스**: metadata.spread/spine 저장 + 검증게이트 editorMode 전환 | `df99d69` | ✅ 라이브 E2E |
| **P0-3 compose-mixed cover MediaBox 검증 + 분리2파일 강제** + **totalWidthMm 0.6mm 결함수정**(가드가 검출) | `d81d3a7`,`8580b96` | ✅ 라이브 E2E(ok:true + 불일치 정밀검출) |
| **B48/B49** 스냅샷↔템플릿 권위 기하 대조 | `b53fc50` | ✅ 실데이터 검증(오탐0). 무결성 체인 완성: 템플릿권위 ⟵ metadata.spread ⟵ cover.pdf |
| **A13** 제본 페이지 가드(무선32p/중철64p, null=제약없음) | `7453bb1` | ✅ store test 33/33 |
| **영역 클릭 포커싱**(canvas-core 단독, /embed 자동작동) | `af69ac5` | ✅ 라이브검증(앞/뒷표지 클릭→하이라이트 전환). 가이드/라벨/오버레이 excludeFromExport(저장오염 해소) |
| 문서: EDITOR §19, 통합 v2.6(md+html), INDEX, DEPLOYMENT 플래그 | `0c4b3d2`,`31c9aee` 등 | ✅ |

**검증 토글**: 전부 **SOFT**(경고/기록, 무중단). 운영 ENV `SPREAD_SNAPSHOT_HARD_FAIL=true`(api+worker 공용)로 HARD(차단) 승격. ⚠️승격 전 worker 컨테이너 ENV 주입 확인: `docker exec storige-worker printenv SPREAD_SNAPSHOT_HARD_FAIL`(미주입이면 docker-compose worker.environment 추가). SOFT 기간 `worker_jobs.result.coverSizeValidation`·`metadata.spreadValidation` 모니터링 후 승격.

---

## 1. 다음 작업 — 유일 잔여 P1: 내지 PDF 표시전용 임포지션 (XL)

**제품결정 확정**: 첨부 내지 PDF는 **표시 전용(가이드), 사용자 편집은 최종 인쇄에 미반영**. 최종 내지 인쇄는 원본 PDF 그대로.
- 목표: 내지 PDF 첨부 + 책 편집 구동 시, 첨부 PDF 각 페이지를 내지 캔버스에 **`excludeFromExport:true` 잠금배경(가이드)**으로 자동 표시.
- ⚠️ 원 설계(워크플로 `wj3y4f2pz`, inner-pdf-imposition)는 적대적검증에서 **flawed** — 인쇄경로 전제 오류(편집기는 canvas.toSVG 렌더라 underlay에 반드시 excludeFromExport). **표시전용 기준으로 재설계 후 구현** 권장.
- 구현 난점: (a) PDF→이미지 래스터 — **편집기 pdfjs-dist 도입(표시전용엔 이쪽이 단순)** 또는 워커 GS 다중페이지(게스트 인증·GS 타임아웃 5s→동적·동시성1 가드 필요), (b) 첨부→편집기 배선(현 `ContentPdfAttachModal`은 배타 replace 플로우 — `apps/editor/src/components/editor/ContentPdfAttachModal.tsx`), (c) N페이지 캔버스 자동생성 메모리 가드(lazy fromURL, 상한, recalcSpine 1회), (d) `contentPdfMode:'underlay'`(현 dead API 컬럼) 활용.
- 전용 사이클(재설계→구현→빌드/테스트→배포→라이브검증→문서) 권장. 워커 손대면 GS 타임아웃·게스트 인증부터 확인.

### 후속(P1 잔여 보강)
- 영역클릭 포커싱 **줌/팬**(WorkspacePlugin.focusOnContentRect, viewport 수학 주의) + **S1 사이드바 region 버튼바**(EditorView+embed.tsx 양쪽 배선) + **S4 신규객체 강제 앵커링**(useSpreadAutoAnchor 확장). 현재는 하이라이트 토글만.
- B48 보강: compose-mixed endpaper 카운트·coverEditable 대조.
- A13 중철 4배수(soft, 완료시 경고).

### P2 (감사문서 §4)
- 책등 resize 히스토리 오염 + B24 debounce/abort 실가동 / A18 영역별 배경·책등 음영밴드·A9 라벨 줌보정 / A8 영역 스냅 / ENDPAPER book검증 화이트리스트 거부.

### 게이트(미착수) — `EDITOR_TEMPLATE_ASSET_GAP_2026-06-02.md`
- P0-2(=내지PDF, 위), P1-4 사진틀, P2-7 면지, P2-8 WYSIWYG·아웃라인(폰트 시딩 제품결정 필요).

---

## 2. bookmoa 측 (별도 세션 진행 중)
전달 완료 지시문(bookmoa-mobile `docs/`):
- `HANDOFF_storige_spread_integrity_2026-06-07.md` — **스프레드 책 = separate 2파일(cover.pdf+content.pdf) 출력 강제** 대응(T1 필수), separate 명시·검증결과 가시화·HARD 대비·체크리스트 반영.
- `HANDOFF_storige_wing_product_2026-06-05.md` — 날개 상품 admin 입력/저장(productMeta.wing*) + Configure 배선.
- `STORIGE-ANSWER-E4-raw-file-download-2026-06-06.md` — 원본 다운로드(`GET /api/files/{id}/download/external`, 완료).
- ⚠️ API가 스프레드 책 `outputMode='separate'` 강제(single 무시) → bookmoa 산출물 2파일 처리 확인 필요.

---

## 3. QA 재현 레시피 (스프레드 책 편집완료/검증)
1. VPS `.env`의 `API_KEYS` 2번째 값으로 토큰: `POST /api/auth/shop-session`(X-API-Key, memberSeqno 1049737389, orderSeqno 999970).
2. `editor.papascompany.co.kr/embed?sessionId=7d4e9171-35d5-4ca1-9571-452fb3056ac4&templateSetId=f0335fda-bf48-47f2-a908-2b2e70e78de8&mode=both&orderSeqno=999970&token=<access>&refreshToken=<refresh>` 직접 로드(top-level 가능). 편집완료 클릭(find ref '편집완료')→콘솔 `[finish]` 마커.
3. compose-mixed 검증 직접호출: `POST /api/worker-jobs/compose-mixed`(@Public) `{editSessionId, coverUrl, contentPdfUrl, coverEditable:true}` → `worker_jobs.result.coverSizeValidation` 확인.
4. DB(6.7 레시피): `file_edit_sessions.metadata`(spread/spine/spreadValidation), `worker_jobs.result`. QA 파일은 `UPDATE files SET deleted_at=NOW()` soft-delete.
- 현재 열린 QA 브라우저 탭 다수 — 정리 가능.

## 4. 핵심 파일 빠른참조
- 스냅샷/검증: `apps/api/src/edit-sessions/edit-sessions.service.ts`(validateSpreadSnapshot/compareSpreadWithTemplateAuthority), `apps/editor/src/utils/buildSpreadSnapshots.ts`.
- cover MediaBox + separate 강제: `apps/api/src/worker-jobs/worker-jobs.service.ts`(createComposeMixedJob), `apps/worker/src/processors/synthesis.processor.ts`(validateSpreadCoverSize).
- 영역클릭/스프레드: `packages/canvas-core/src/plugins/SpreadPlugin.ts`(handleRegionClick/getRegionAtPoint/focusRegion), `apps/editor/src/hooks/useEditorContents.ts`(loadSpreadModeEditor).
- 제본 가드: `apps/editor/src/stores/useEditorStore.ts`(canAdd/DeletePage), `SpreadPagePanel.tsx`.
- 책등→총폭: `apps/editor/src/stores/useSettingsStore.ts`(updateSpreadSpineWidth).
- 공용: `packages/types/src/index.ts`(computeSpreadDimensions, validateSpreadAgainstAuthority, BINDING_CONSTRAINTS, SPINE_FORMULA_VERSION, Spread/Spine Snapshot, SpreadValidationResult).
- 문서: `docs/EDITOR.md §19`, `docs/SYSTEM_INTEGRATION_OVERVIEW.md` v2.6, `docs/INDEX.md`, `docs/DEPLOYMENT.md`, `.cursor/plans/COVER_EDIT_FULL_AUDIT_2026-06-06.md`(실행로그).
