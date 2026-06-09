# RESUME PROMPT — Storige (2026-06-09 인수인계)

> 새 세션 시작 시 **이 파일 먼저 읽기**. 프로토콜: `CLAUDE.local.md` → 최신 RESUME_PROMPT(이 파일) → `git log --oneline -20`.
> 응답 한국어. 커밋 끝 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
> 운영: master push → editor/admin **자동배포(Vercel)**. API·worker 는 **수동배포**(`ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && docker compose build api && docker compose up -d api && docker compose restart nginx'`). 프로덕션 고객 실사용 — 빌드/테스트 후 진행. SSH 키 `ssh-add -l` 확인.
> ⚠️ **스키마 변경 배포 주의**: prod `synchronize:false` + API `forbidNonWhitelisted:true` → 마이그레이션 SQL을 prod DB에 **직접 선실행** 후 API 재배포. admin(Vercel 자동)이 먼저 떠서 새 필드 보내면 옛 API가 400. 절차는 메모리 `feedback_schema_change_deploy` 참조.

---

## 0. 이번 사이클(2026-06-09) 완료·배포 내역 — 에디터 워크플로우 4종 + 폼 UX

전 사이클(2026-06-08)에 IDML/PSD→템플릿 변환기(`packages/indesign-import`)를 마무리. 이번 사이클은 **편집기 워크플로우 감사 4종(②③①④) + 템플릿셋 폼 UX 정리(B)**.

| # | 기능 | 커밋 | 배포 상태 |
|---|---|---|---|
| **②** | 템플릿 교체 후 라이브 캔버스 갱신 (낱장 '템플릿' 메뉴) | `8b6b4a6` | ✅ editor 배포. setSession 후 `TemplatePlugin.replaceTemplate`(워크스페이스·사용자객체 보존) |
| **③** | 커버(펼침면) 교체 워크플로우 | `2d26283` | ✅ editor 배포. 후보필터=`spec.coverWidth/Height`, live=`SpreadPlugin.init(newSpec)`(재호출 안전) |
| **①** | PDF 생성 옵션(단면/양면-원파일/양면-파일분리) — 데이터모델+admin | `bf1bcb9` | ✅ **전체 배포**(마이그레이션+VPS API+admin). `template_sets.pdf_output_mode` |
| **①** | 워커 분기(duplex-split 분할) — Phase 2 | branch `feat/pdf-output-worker-A1`(`386c8ab`) | ⏸ **스테이징 보류**(인쇄출력 영향). master 미반영 |
| **④** | 에셋 구성(템플릿셋↔라이브러리 카테고리 큐레이션) — 데이터모델+admin | `1d77812` | ✅ **전체 배포**. 조인 `template_set_library_categories`(카테고리 단위, "연결 없으면 전역") |
| **④** | 에디터 에셋 필터링 enforcement — Phase 2 | `d6bafab`(API)+`c7e6ba6`(editor) | ✅ **전체 배포**. editor-contents에 templateSetId 필터 |
| **B** | 템플릿셋 폼 UX 정리(Collapse 5그룹 아코디언) | `6736762` | ✅ admin 배포. Chrome 검증완료 |

추가 버그수정(④ 작업 중): `template_sets` **생성 시** `pdfOutputMode/endpaperConfig/coverEditable/coverPreviewImage/contentPdfEditable`가 저장 안 되던 잠재버그(이전엔 *수정* 시에만 저장) → create 명시매핑 보강(`1d77812`).

### 검증 방식
- 코드레벨 정적검증(tsc/build/lint) + admin 측은 Chrome 직접 화면 테스트(①④ 필드·B 아코디언 렌더 확인). 
- 에디터 런타임(②③ 캔버스 교체, ④ 에셋 필터)은 라이브 세션 필요 → 수동 스모크 테스트 권장(절차는 §2).
- 로컬 백엔드/워커 없음 → 워커/DB는 런타임 미검증.

---

## 0-b. 변환모듈 인쇄 정합성 사이클(2026-06-09 오후, CTO 방향)

변환모듈 P0/P1을 진행. 인쇄 출력 영향 항목은 **스테이징 브랜치 보존**(검증 후 머지), 무관 항목만 배포.

| 항목 | 상태 |
|---|---|
| **B. 상품별 색모드** `TemplateSet.colorMode(rgb/cmyk)` + admin | ✅ **배포**(`7cf5a79`, 마이그레이션 `color_mode`). 워커 색변환(GS ColorConversionStrategy/ICC)은 미구현(스테이징 예정) |
| **A. 텍스트 아웃라인 혼합폰트 충실도** | 🌿 `feat/print-text-outline`(`b9a3fa0`). ※ 아웃라인 자체는 이미 라이브(8fea0e8), 이건 혼합폰트 per-run 버그 수정 |
| **C. overprint/별색 보존** (GS pdfwrite 보존 플래그) | 🌿 `feat/print-overprint-preserve`(`5c02c1e`) |
| **PNG-1. 변환 PNG 스토리지 업로드**(dataURL→URL, DB 비대화 해소) | ✅ **배포**(`1dd9484`, admin) |
| **PNG-2. 사진 프레임 마스킹** | 🌿 **구현** `feat/print-frame-masking`(`beca763`). inverted clipPath(프레임 클론 absolutePositioned+inverted:true) → 투명창에만 사진, 프레임 위(bringToFront). 실사용 setupFrameContent 갭 해소 + frameRef 직렬화 + WorkspacePlugin page-outline 가드. 스테이징 시각검증 필요(창 방향·z순서·재로드·인쇄 export). |
| **D. 에디터 실로드 E2E**(책등가변+meta) | 수동 절차 §2-b. `meta` 직렬화 해소(canvas.ts:151) 확인, 실세션 1회 검증 필요 |

**✅ 통합 배포됨(merge `20ac84c`, 2026-06-09 오후, 오너 결정 deploy-and-iterate)** — 위 4종(① duplex-split · A 아웃라인 충실도 · C overprint 보존 · PNG-2 프레임 마스킹)을 master 머지 + 배포(editor Vercel + VPS api·worker, 마이그레이션 없음, API healthy). 스테이징 브랜치 4종 삭제. **실주문/시각 검증은 실 IDML 플로우에서 진행** → **신규 문서 [`docs/IDML_IMPORT_FLOW.md`](../../docs/IDML_IMPORT_FLOW.md) + `.html`**(업로드·변환·등록·테스트·검증 전체 플로우 + 두 시나리오(펼침면 하이브리드/책등가변) + 검증 체크리스트 + 문제해결). 미구현: B 워커 색변환(GS ColorConversionStrategy).

---

## 2-b. D 에디터 실로드 E2E 절차

1. admin: IDML 변환 → 표지 Template 등록 → 책등 가변 책 셋 등록(방법A) + 내지 추가 + pageCountRange. 2. 그 셋으로 책모드 세션. 3. ✅ 표지+영역 가이드. 4. 내지 수 변경 → ✅ 책등 폭 자동 재계산 + 앞/뒤표지 평행이동. 5. 편집완료→재로드 → ✅ meta 보존(책등 가변 재배치 동작).

---

## 1. 잔여 작업 (우선순위)

1. **① 워커 duplex-split 실주문 검증**(✅ 배포됨 merge `20ac84c`) — 셋 `pdfOutputMode='duplex-split'` 선택 시만 작동(그 외 dormant). 검증항목: 양면 낱장 실주문 N세트→`set_<i>.pdf` n개(각 2p, 앞=먼저/뒤=다음 순서), single 1p, duplex-merged 회귀 무변경, 멱등 재완료, 웹훅 `outputFiles[type:'set']` 소비처(admin/PHP) 배선. ⚠️ 회전 없음(RIP 처리).
2. **④ 폰트 큐레이션(후속)** — `LibraryFont`에 `category_id` 컬럼 없어 폰트는 큐레이션 제외(현재 전역). 필요 시 스키마+admin 폰트-카테고리 UI 추가.
3. **②③ 에디터 수동 스모크** — §2 절차.
4. **set 출력파일 소비 배선** — duplex-split의 n개 `set` 파일을 admin/PHP가 가져가는 경로(현재 웹훅 payload엔 실림, 소비처 미배선). A1 에이전트가 별도 task로 등록함.

---

## 2. ②③ 에디터 수동 테스트 절차 (라이브 세션 필요)

**② 템플릿 교체**: 낱장 편집세션 → 텍스트/이미지 직접 추가 → 사이드 '템플릿' → 같은 사이즈 다른 템플릿 교체 → ✅ 화면 즉시 갱신 + 재단선/워크스페이스 + 내가 추가한 객체 보존.

**③ 커버 교체**(책모드 표지): 표지 펼침면 페이지 → 사이드 '템플릿' → ✅ 같은 표지 사이즈 다른 펼침면이 후보로 표시 → 교체 → 영역(앞/뒤/책등) 가이드 새 spec 재계산. 내지 수 변경 시 책등 자동 재계산.

**④ 에셋 필터**: admin에서 템플릿셋에 '에셋 구성'으로 특정 카테고리 연결 → 그 셋의 편집세션 → 사이드 배경/프레임/요소 → ✅ 연결한 카테고리 에셋만 노출(연결 없으면 전체).

---

## 3. 핵심 파일

- `apps/editor/src/components/TemplatePanel/TemplatePanel.tsx` — ②③ 라이브 교체(handleReplaceConfirm)
- `packages/canvas-core/src/plugins/{TemplatePlugin,SpreadPlugin}.ts` — replaceTemplate / init(spec)
- `apps/api/src/templates/entities/template-set-library-category.entity.ts` — ④ 조인 엔티티
- `apps/api/src/templates/template-sets.service.ts` — ④ upsert/populate + create 보강
- `apps/api/src/editor-contents/editor-contents.service.ts` — ④ 에셋 필터(getCuratedCategoryIds)
- `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx` — ①④ 필드 + B Collapse 그룹
- `apps/api/migrations/20260609_*.sql` — ①(pdf_output_mode) / ④(조인테이블, FK collation=utf8mb4_unicode_ci 주의)
- (보류) `apps/worker/src/processors/synthesis.processor.ts` + `apps/api/src/{worker-jobs,edit-sessions}` — ① duplex-split (branch)
