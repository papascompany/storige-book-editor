📋 Storige 인쇄 워크플로우 — 통합 개발 계획서 v1
작성일: 2026-05-19 · 상태: 컨펌 대기

0. 비즈니스 플로우 (최종 정의)
┌─ ADMIN ─────────────────────────────────────────────────────────────────┐
│ 1. 템플릿셋 구성                                                          │
│    • 표지 SPREAD 템플릿 (편집가능/불가 토글)                              │
│    • 앞면지 0~6장 (각각 편집가능/불가)                                   │
│    • 내지 PAGE 템플릿 N장 (canAddPage=true 면 고객 PDF 페이지수로 자동 확장) │
│    • 뒷면지 0~6장                                                        │
│    • 도구 메뉴 화이트리스트 (이전 사이클)                                 │
│ 2. 레더 커버 / 화보집: 미리보기 이미지 = 표지 (편집불가, 빈 PDF + 네이밍) │
│ 3. 인쇄 완료 PDF 다운로드                                                 │
└──────────────────────────────────────────────────────────────────────────┘
                            ↓ 상품 연결
┌─ 고객 (게스트 허용) ────────────────────────────────────────────────────┐
│ 1. 편집기 진입 (URL: ?productId=... or ?templateSetId=...)               │
│ 2. 표지: 편집기에서 디자인 (편집가능 템플릿만)                            │
│ 3. 내지: 두 가지 모드                                                     │
│    A) 편집기로 직접 편집 (기존)                                           │
│    B) PDF 첨부 → 워커 자동 검증 → 통과 시 페이지수 자동 맞춤              │
│       └ 검증 실패 시 이슈 노티 → 고객 수정 후 재첨부                      │
│ 4. 편집완료 → 인쇄용 PDF 자동 생성                                        │
│    └ 표지 PDF + 앞면지 + 내지 + 뒷면지 합본                              │
│ 5. 저장 시점 → 로그인/회원가입 유도 (게스트 → 회원)                       │
│ 6. 마이페이지에서 작업 목록 + 다운로드/주문                                │
└──────────────────────────────────────────────────────────────────────────┘
1. Phase 별 작업 계획
Phase 1 — 운영 즉시 fix · ~1시간
목적: 현재 깨진 이미지 업로드 정상화 (사용자가 본 콘솔 에러)

작업	변경
1-A. POST /storage/upload?category=uploads 권한 개방	@Public() + 파일 크기·MIME 가드 강화
1-B. nginx client_max_body_size 점검	50MB 일치 확인
1-C. 401/500 응답에도 CORS 헤더 보장	NestJS exception filter 검증
검증: 게스트로 jpg/png/pdf 업로드 → 200 OK, 캔버스 추가됨

Phase 2 — 데이터 모델 확장 · ~3시간
목적: 면지 / 편집가능 토글 / PDF 첨부를 위한 스키마

항목	변경
Template.editable (기존)	활용 명확화 — UI 가 readonly 처리
TemplateType enum 에 ENDPAPER 추가	면지 타입
TemplateSet.endpaperConfig 신규	{ frontCount: 0~6, backCount: 0~6, frontEditable: boolean, backEditable: boolean }
TemplateSet.coverEditable 신규	표지 편집가능/불가 (레더 커버 케이스)
EditSession.contentPdfFileId 신규	고객 첨부 PDF
EditSession.contentPdfPageCount	자동 확장 계산용
EditSession.contentPdfValidationResult	워커 검증 결과 캐시
EditSession.guestToken 신규	게스트 작업 식별자
마이그레이션 SQL	idempotent ALTER TABLE
Phase 3 — Admin UI 확장 · ~5시간
목적: 면지/편집가능/레더 커버를 admin 에서 설정

화면	변경
TemplateSetForm	"면지 설정" 섹션 (앞/뒤 개수 + 편집 토글)
TemplateSetForm	"표지 편집가능" 토글 (레더 커버용)
TemplateList	신규 type 'endpaper' 지원 + 라벨
템플릿 편집 페이지	"편집가능" 토글
ProductTemplateSetList	표시 컬럼에 면지 정보
Phase 4 — 편집기 고객 흐름 확장 · ~10시간
목적: 핵심 신규 기능 — PDF 내지 첨부 + 게스트 + 편집가능 처리

항목	작업
4-A. 게스트 토큰 발급	진입 시 자동 게스트 세션 생성 (cookies + EditSession.guestToken)
4-B. 페이지 네비 확장	표지 + 앞면지 N + 내지 M + 뒷면지 K 구조 표시
4-C. 편집가능/불가 readonly	editable=false 인 페이지는 객체 추가/이동 차단 + 안내
4-D. "내지 PDF 첨부" 버튼	헤더에 새 액션 (책자 templateSet 진입 시만 노출)
4-E. PDF 업로드 → 워커 검증 자동 트리거	POST /worker-jobs/validate 호출 → 폴링
4-F. 검증 결과 모달	통과/이슈 목록/수정 안내
4-G. 페이지수 자동 확장	canAddPage=true + PDF 페이지수 > 내지 수 → 부족분 자동 복제
4-H. 내지 페이지에 PDF 페이지 매핑	면지 제외, 1쪽부터 순서대로. 시각: PDF 페이지 썸네일 placeholder
4-I. 표지만 편집 가능한 케이스	내지 페이지 클릭 시 "PDF 첨부됨 — 편집 불가"
4-J. 레더 커버 모드	coverEditable=false → 표지 클릭 시 미리보기만, 빈 PDF 출력 예고
Phase 5 — Worker 합본 확장 · ~4시간
목적: 표지(편집) + 면지 + 첨부 내지 PDF + 면지 합본 출력

항목	작업
5-A. 신규 mode compose-mixed	표지(spread) + 면지들 + 첨부 PDF + 면지들 합본
5-B. 면지 PDF 생성	편집가능 면지 → 캔버스 → PDF / 편집불가 → 빈 페이지
5-C. 표지 PDF 생성	coverEditable=false → 빈 PDF + 표지명 네이밍 (레더 커버)
5-D. 최종 합본 순서	[표지 PDF, 앞면지 1..N, 첨부 내지 PDF, 뒷면지 1..K]
Phase 6 — 저장 시 로그인 유도 + 마이페이지 · ~4시간
목적: 게스트 → 회원 전환 + 작업 목록

항목	작업
6-A. 편집완료 시점 인증 체크	게스트면 로그인/회원가입 모달
6-B. 게스트 → 회원 마이그레이션	guestToken 작업들을 userId 로 흡수
6-C. 마이페이지 UI (간단)	작업 목록 + 다운로드 + 재편집 진입
6-D. PHP 측 가이드 문서	bookmoa 마이페이지 통합 시 endpoint/스키마 안내
Phase 7 — PHP/bookmoa 연동 가이드 · ~2시간
목적: 외부 사이트 통합 시 변경 사항 명세

작업
docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md (신규)
변경된 endpoint / 신규 webhook / EditSession 응답 스키마
guestToken → 회원 마이그레이션 흐름
마이페이지 작업 목록 endpoint (REST)
Phase 8 — 문서·스킬 갱신 · ~2시간
파일	변경
docs/EDITOR.md	§13 면지/PDF 첨부/게스트 추가
docs/EDITOR_SCREENS.md	페이지 네비 모식도 + PDF 첨부 모달
docs/MASTER_STATUS_2026-05-19.md (신규)	사이클 보고서
Storige_개발가이드.html	"PDF 내지 첨부" + "면지 구조" 페이지 신규
.claude/skills/fabric-editor/SKILL.md	면지/편집가능/PDF 첨부 흐름 추가
2. Phase 의존성 + 권장 순서
Phase 1 (즉시 fix) ──┐
                    ├─→ 운영 정상화 후 안전하게 Phase 2~ 진행
Phase 2 (DB 모델)────┼─→ Phase 3 (Admin)
                    │   Phase 4 (Editor) ─→ Phase 5 (Worker)
                    │           └─→ Phase 6 (마이페이지)
Phase 7 (PHP 가이드) ┘
Phase 8 (문서) — 각 Phase 완료 후 누적
총 예상 시간: ~31시간 (분할 진행 시 권장)

3. 미확정 결정사항 — 컨펌 필요
3-1. 게스트 작업 보존 정책
A 안: 게스트 작업은 24시간 후 자동 삭제 (회원 가입 안 하면 폐기)
B 안: 7일 보존 (회원 전환 유도 강화)
C 안: 영구 보존 (cookies 기반 식별)
권장: A 안 (저장공간 + 개인정보 부담 최소)
3-2. 내지 PDF 페이지수 < 내지 수 인 경우
예) templateSet 내지 20p, 고객 PDF 8p → 어떻게?
A 안: 자동 거부 + 안내
B 안: 부족분 빈 페이지 추가
C 안: 고객 선택 (모달)
권장: C 안 (명확성)
3-3. PDF 첨부 후 내지 일부만 편집 허용?
첨부 PDF 가 있는 상태에서 1쪽~5쪽만 편집기로 덮어쓰기?
권장: 불허 (PDF 첨부 모드 ↔ 편집 모드 배타적, 명확성)
3-4. 워커 검증 실패 시 처리
A 안: 첨부 자체 거부 → 즉시 재업로드 안내
B 안: 첨부는 허용 + warning 표시 → 고객이 강제 진행 가능
권장: A 안 (인쇄 사고 방지)
3-5. 레더 커버 미리보기 이미지 업로드 위치
TemplateSet 의 표지 SPREAD 템플릿 자체에 이미지 객체로?
또는 별도 필드 templateSet.coverPreviewImage?
권장: 별도 필드 (편집불가 모드 명시적 분리)
3-6. 게스트 회원 전환 시점
저장 시점 (편집완료 누르면 모달)?
또는 게스트 30분 후 자동 유도?
권장: 저장 시점 만 (사용자 흐름 방해 최소)
4. 진행 방식 옵션
옵션 A — 안전 단계 진행 (권장)
이번 turn: Phase 1 + 2 (운영 정상화 + 데이터 모델)
다음 turn: Phase 3 + 4 (Admin + Editor 핵심)
그 다음: Phase 5 + 6 (Worker + 마이페이지)
마지막: Phase 7 + 8 (가이드 + 문서)
각 단계 종료 시 컨펌

옵션 B — 풀 오토파일럿
Phase 18 일괄 진행. 중간 컨펌 없이 자율 작업.
**예상 3050시간** (한 세션에 완료 어려울 수 있음 — 분할 필요)

옵션 C — 우선순위 재정의
사용자가 특정 Phase 만 먼저 진행 원하시면 알려주세요.
예) "Phase 1 + 4 만 먼저" 등.

5. 컨펌 체크리스트
다음 중 답변해주시면 그에 맞춰 작업 시작합니다:

3-1 ~ 3-6 결정사항 6개 항목 — 권장안 OK / 변경 / 추가 결정?
진행 옵션 — A / B / C?
추가 요구사항 누락된 게 있나요?
예) 다국어, 모바일 UX, 결제 연동 등
답변 받은 후 즉시 첫 단계 작업 들어가겠습니다.