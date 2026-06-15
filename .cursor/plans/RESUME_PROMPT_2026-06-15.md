# [새 세션 시작 프롬프트] Storige 개발 인수인계 (2026-06-15)

> **용도**: 새 Claude Code 세션에서 이 문서만 읽으면 이전 컨텍스트 없이 작업을 이어갈 수 있는 자립형 지시서.
> **역할**: CTO 오케스트레이션(서브에이전트 병렬 조사/구현 + 적대 교차검증), 한국어 응답.
> **현재 master HEAD**: `da3cb78` (origin 정합).

---

## 0. 세션 시작 체크리스트 (순서대로)

1. `CLAUDE.local.md` 읽기 (SSH/배포/시크릿/사이트 API 키 — 커밋 금지 파일).
2. SSH 에이전트 확인: `ssh-add -l 2>&1 | head -1` → 비었으면 `ssh-add ~/.ssh/id_ed25519`. ⚠️ SSH 는 **`deploy@158.247.235.202` 만**(fail2ban).
3. 자동 로드되는 메모리(MEMORY.md 인덱스) 확인 — 아래 핵심 메모리가 컨텍스트에 들어옴:
   - `project-library-category-assets` (가장 최신 — 라이브러리 에셋/카테고리)
   - `project-stability-audit-2026-06-13` (전체 안정성 감사)
   - `project-template-conversion-modes` (flat-spread/flat-spine)
   - `project-indesign-template-converter` (IDML 변환기 전반)
   - `feedback-schema-change-deploy`, `feedback-api-redeploy-nginx` (배포 함정)
4. `git log --oneline -20` 으로 최신 상태 확인.
5. 테스트 베이스라인: editor 129 / canvas-core 306 / api 133 / indesign-import 142 / admin 26·14.

---

## 1. ⚠️ 최우선 미결 — 오너 협조 필요 (보안)

**PUBLIC 레포에 실사용 시크릿이 히스토리에 평문 노출** — 안정성 감사(2026-06-13)에서 발견.
- 레포 측 조치는 완료(.env.production git rm·.gitignore·마스킹·gitleaks CI `.github/workflows/gitleaks.yml`).
- **미실행(오너 협조 필요)**: ① `STORIGE_API_KEY` 회전(bookmoa PHP·ShareSnap·100p 동시 교체 — 복수 키 병행 가능), ② 북모아 DB 자격증명 회전 + 3306 IP allowlist, ③ git 히스토리 정화(filter-repo **드라이런 완료**, force-push 게이트 — `/tmp/storige-hist-mirror-EXECUTION_RUNBOOK.md`).
- **런북**: `docs/SECURITY_ROTATION_RUNBOOK_2026-06-13.md`. 공개 노출은 정화로 회수 불가 → **회전이 본질, 정화는 그 다음**.

---

## 2. 오너 결정 대기 (제안서 작성 완료 — 승인 시 착수)

1. **책등 정책 + 용지코드 매핑**: `docs/PROPOSAL_LIBRARY_*` 아님 → `.cursor/plans/PROPOSAL_SPINE_POLICY_PAPER_MAPPING_2026-06-12.md`.
   - 신규 진입 책등: 제본 5유형(소프트커버=perfect/하드커버=hardcover/중철=saddle/**압축앨범·화보집=신규 binding_types 행 필요**) × 템플릿 유형(flat-spread 고정/flat-spine 가변) 3계층 방어. **선행 입력 필요**: 압축앨범 합지 두께·화보집 양장 여유(인쇄소 스펙).
   - 용지코드: 정본=두께, bookmoa 코드(`mojo100` 류)는 `paper_types.aliases` 로 흡수 + 미지 코드 404→폴백+경고. **선행**: bookmoa 실판매 용지 목록+두께.
   - 권장 구현 순서: B(용지 alias+폴백) → A-1(등록 검증) → A-2(게이트 모달) → 신규 제본 2종.
2. **폰트**: 비Adobe 3종(페이퍼로지/태나다체/Pretendard ExtraBold) 시딩 완료. **미결**: Adobe 3종(명조 Std/Myriad/Minion) 라이선스, **THE명품고딕M**(상업폰트 — 라이브 MA/LA 템플릿 실사용, 구매 vs 대체 결정).
3. **색상 필터 메타 파이프라인**(라이브러리 P3 잔여, 선택): 엔티티 색상 컬럼+추출+admin 입력 — 별도 대공사.

---

## 3. 이번 세션 완료분 (전부 배포·라이브 검증)

- **IDML 템플릿 유형 3종**(`spreadConfig.conversionMode` full/flat-spread/flat-spine): flat-spread=전폭 300dpi PNG 1장+텍스트(책등 고정), flat-spine=back/spine(3배폭)/front 3분할(책등 가변). 변환→등록→재편집 라이브 확인. `[[project-template-conversion-modes]]`.
- **A1~A6 변환 충실도**: per-run styles·행간/자간/정렬·그라디언트·rx/ry·placed 이미지 동반 업로드. `[[project-indesign-template-converter]]`.
- **라이브 P1 3종**: 재앵커 viewport bbox 오염, 재편집 spine 오염, PointerShiftGuard(패널 마운트 레이스).
- **전체 안정성 감사**(6렌즈): 워커 PDF(잡 실패 미기록·블리드 파괴·GS 타임아웃)·API 보안(RolesGuard·throttler·path traversal·레거시 IDOR)·편집기(undo/dispose 누수)·의존성 CVE 범프·인프라(certbot webroot). `[[project-stability-audit-2026-06-13]]`.
- **보안 후속**: gitleaks CI, 자동저장 복원 UI(ED-5), SVG XSS 완화, Vercel ignoreCommand 멀티커밋 누락 수정(VERCEL_GIT_PREVIOUS_SHA).
- **라이브러리 에셋 빈 패널 3버그 + 카테고리 큐레이션 + P3 패널 일관화 + 미분류 13건 백필** 완료. `[[project-library-category-assets]]`.

---

## 4. 핵심 함정 (코드 만지기 전 필독)

**배포**:
- ⚠️ **API 재배포 전 미적용 마이그레이션 확인 필수** — 이번 세션 a52a48d 재배포 시 `sites.retention_days` 등 미적용으로 502 발생·복구. prod synchronize off + forbidNonWhitelisted → 마이그레이션 수동 실행 후 API 재배포.
- API 단독 recreate 시 nginx 옛 IP 캐싱 502 → **API 완전 기동 후 nginx 재시작**(또는 전체 배포). `[[feedback-api-redeploy-nginx]]`.
- **Vercel ignoreCommand**: 멀티커밋 푸시에서 중간 커밋 앱 변경 누락 가능 → `${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}` 로 수정됨. editor/admin vercel.json.
- editor/admin = master push 자동 배포 / API·worker = VPS 수동(`docker compose build api && up -d api && restart nginx`).

**편집기/변환기**:
- 좌표는 `geometry/centerOrigin.mjs` SSOT 헬퍼만(±half 복붙 금지). textbox `styles:{}` 필수, 배경=`ARTWORK_LOCK`, **clipPath 금지**(fabric toJSON 유실).
- 영역 판정은 `SpreadPlugin.resolveRegionMetaForObject`(무인자 getBoundingRect=viewport 좌표 금지).
- 자동저장 게이트=`isInitializedRef`(useAppStore.ready 는 캔버스 등록 시 이미 true라 무효).
- **shop-session JWT role='customer'(소문자)** vs UserRole.CUSTOMER 대문자 → 편집기 `normalizeRole` 로 흡수. **/embed 는 `useAuthStore.setToken()` 호출해야 me 채워짐**(안 하면 isCustomer=false → 에셋 패널 빈 채).
- 라이브러리 에셋 상대 URL(`/storage/...`)은 `resolveAssetUrl` 로 API 호스트 prefix.
- 회귀 금지 커밋 동작 불변: 9628f1a/527b85b/a64d409/d9a3e4b/9898eab/7585e38/e4eb328/a01f3f3/8a23f93/3639c8b/e1fd2f2/e93ae8c/4c06584/d58cb9b/682defe/ba07340/9e9da01/da3cb78.

---

## 5. 검증 자산

- **실 IDML**(커밋 금지): `~/Desktop/MA-348_26_KYM.idml`(도형/텍스트 표지), `~/Desktop/LA-383_26_KYM.idml`(placed+세로짜기), `~/Desktop/EN-288-26-KYM.idml`.
- **정식 템플릿셋**: `a2cc2939-b76d-41a2-bd41-2d9fba091a24`('A4 기본 책자', 표지=flat-spine).
- **편집기 E2E**: `POST /api/auth/shop-session`(X-API-Key — CLAUDE.local.md §5) → `/embed?templateSetId=...&token=...&mode=both&orderSeqno=...&pageCount=...&paperType=mojo_80g&cb=<랜덤>`. 책등 계산 검증: `POST /api/products/spine/calculate`(pageCount/paperType/bindingType).
- **로컬 변환 CLI**: `node packages/indesign-import/scripts/convert-sample.mjs <파일>`(fixtures 덮어쓰기 주의). mode='hybrid'(flat-spread)/'flat-spine' 직접 호출은 /tmp 스크립트로.
- **브라우저 검증**: Chrome MCP(Browser 1 로컬). /embed 는 캐시버스트(cb) 필수. ⚠️ dirty 탭은 beforeunload 로 navigate/close 막힘 → 새 탭 사용.
- **DB/운영**: CLAUDE.local.md §6 레시피. admin 계정 §5.

---

## 6. 잔여 백로그 (우선순위 낮음 / 차기)

- fabric 7 / jspdf 3 마이그레이션(SVG XSS — 즉시 완화는 배포됨, 메이저 마이그레이션은 스파이크 문서 `docs/FABRIC7_JSPDF3_MIGRATION_SPIKE_2026-06-13.md`. fabric 7.2.0 이 stylesToArray 몽키패치를 상류 fix함 → 제약 해소).
- B1 내지 다중페이지 IDML → PAGE 템플릿 일괄 변환, B2 미리보기 렌더엔진 fabric 통일.
- AppText 라이브러리 연동(폰트 라이브러리 등장 시 useLibraryPanel 패턴 적용).
- 텍스트 fill 그라디언트(현재 검정 대체+경고), 세로짜기 약물 정밀화.
- 운영 정리: SpineCalculator 콘솔 에러 스팸(용지코드 매핑 제안에 포함), cross-origin taint 후속 칩, 테스트 세션(orderSeqno 9906xx) 정리.

---

## 7. 진행 방식 권장

항목별: **reader/코드 실측 → 서브에이전트 병렬 조사 → 구현 → 단위테스트(베이스라인 위) → 적대 교차검증 → 로컬 정량검증 → 배포 → 라이브 라운드트립 검증 → 문서·메모리 갱신**. 파괴적/외부 영향 작업(force-push, prod 데이터 변경, 키 회전)은 오너 확인 후. 스키마 변경 시 마이그레이션 직접 실행 후 API 재배포 순서 준수.
