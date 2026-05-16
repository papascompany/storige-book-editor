# Bookmoa Storige 연동 개발 계획

작성일: 2026-05-16

## 작업 원칙

- 주 작업 루트: `/Users/yohan/claude/Bookmoa Storige editor/storige`
- 추가 참조/수정 루트: `/Users/yohan/Documents/claude/bookmoa-mobile`
- 두 경로는 별도 git 저장소이므로 상태 확인, 변경 확인, 커밋은 각각 분리한다.
- `STORIGE_API_KEY`는 브라우저에 노출하지 않고 각 외부 서비스의 서버 어댑터에서만 사용한다.
- 1차 연동 대상은 `bookmoa-mobile`이며, PHP bookmoa web 연동은 같은 플랫폼 계약을 따르는 후속 검증 대상으로 둔다.

## 전체 목표

Storige를 외부사이트 연동 플랫폼으로 정리하고, `bookmoa-mobile`에서 상품 매핑, 편집기 실행, 편집 완료 저장, PDF 검증/합성 요청, webhook 결과 반영까지 이어지는 표준 흐름을 구현한다.

## Phase 0. 현재 상태 기준선 확인

### 0-1. 저장소 상태 확인

- 대상 repo: `storige`, `bookmoa-mobile`
- 작업:
  - 각 repo에서 `git status --short` 확인
  - 이미 존재하는 untracked/modified 파일을 기록
  - 이번 작업과 무관한 기존 변경은 건드리지 않음
- 산출물:
  - 작업 시작 전 변경 상태 메모
- 검증:
  - 두 repo의 변경 내역을 혼동하지 않고 분리 기록

### 0-2. 실제 API 계약 확인

- 대상 repo: `storige`
- 확인 파일:
  - `apps/api/src/auth/auth.controller.ts`
  - `apps/api/src/templates/product-template-sets.controller.ts`
  - `apps/api/src/worker-jobs/worker-jobs.controller.ts`
  - `apps/api/src/worker-jobs/dto/worker-job.dto.ts`
  - `apps/api/src/worker-jobs/dto/check-mergeable.dto.ts`
  - `apps/api/src/webhook/webhook.service.ts`
  - `apps/editor/src/embed.tsx`
- 작업:
  - `shop-session` 응답 형태 확인
  - 상품별 템플릿셋 조회 API 확인
  - `check-mergeable`, `validate/external`, `synthesize/external` 요청 DTO 확인
  - webhook 서명 방식 확인
  - embed 설정 및 완료 이벤트 payload 확인
- 산출물:
  - `bookmoa-mobile` 서버 어댑터 구현에 필요한 최종 요청/응답 계약
- 검증:
  - 문서와 실제 코드가 다른 항목을 별도 표시

## Phase 1. bookmoa-mobile 서버 어댑터 추가

### 1-1. 환경 변수 계약 추가

- 대상 repo: `bookmoa-mobile`
- 추가/정리할 변수:
  - `STORIGE_API_BASE`
  - `STORIGE_API_KEY`
  - `STORIGE_EDITOR_URL`
  - `STORIGE_WEBHOOK_URL`
- 작업:
  - 서버리스 API에서만 읽는 환경 변수로 사용
  - 클라이언트 번들에서 접근하지 않도록 `VITE_` prefix를 쓰지 않음
- 산출물:
  - `.env.example` 또는 문서화 파일
- 검증:
  - `rg "STORIGE_API_KEY|VITE_STORIGE"`로 클라이언트 노출 여부 확인

### 1-2. 공통 Storige fetch 유틸 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/_client.js`
- 작업:
  - `STORIGE_API_BASE`, `STORIGE_API_KEY` 필수값 검증
  - `X-API-Key` 헤더 자동 부착
  - Storige API 오류 응답을 일관된 JSON으로 변환
  - 메서드별 body 직렬화 처리
- 산출물:
  - 서버리스 API들이 공유하는 내부 클라이언트
- 검증:
  - 환경 변수 누락 시 500과 명확한 오류 메시지 반환

### 1-3. shop-session 어댑터 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/shop-session.js`
- 작업:
  - 클라이언트 요청에서 주문/상품/customer 정보를 받음
  - Storige `POST /auth/shop-session` 호출
  - 응답의 `accessToken`, `expiresIn`, `member`를 클라이언트에 반환
  - HTTP status는 `200`/`201` 모두 2xx 성공으로 처리
- 산출물:
  - 클라이언트가 API Key 없이 편집기 세션을 발급받는 endpoint
- 검증:
  - API Key가 응답 body/header에 포함되지 않음

### 1-4. 상품 템플릿셋 조회 어댑터 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/template-sets.js`
- 작업:
  - `sortcode`, `stanSeqno` query를 받음
  - Storige `GET /product-template-sets/by-product` 호출
  - 템플릿셋 목록을 그대로 또는 UI 친화 형태로 반환
- 산출물:
  - 상품 등록/수정 화면에서 템플릿셋을 조회할 수 있는 endpoint
- 검증:
  - `sortcode`, `stanSeqno` 누락 시 400 반환

## Phase 2. 상품 모델과 관리자 UI 매핑 추가

### 2-1. 커스텀 상품 데이터 모델 확장

- 대상 repo: `bookmoa-mobile`
- 대상 파일:
  - `src/App.jsx`
- 추가 필드:
  - `allowEditor`
  - `storigeProductSortcode`
  - `storigeStanSeqno`
  - `storigeTemplateSetId`
  - `storigeTemplateSetName`
- 작업:
  - 기존 `customProducts` local storage 구조와 하위 호환 유지
  - 신규 상품 기본값은 `allowEditor: false`
- 산출물:
  - Storige 편집 가능 상품을 구분할 수 있는 상품 데이터
- 검증:
  - 기존 상품이 필드 없이도 렌더링/수정/저장 가능

### 2-2. ProductEditor에 Storige 연동 섹션 추가

- 대상 repo: `bookmoa-mobile`
- 대상 파일:
  - `src/App.jsx`
- 작업:
  - 상품 수정 modal에 `Storige 편집기 사용` 체크박스 추가
  - `sortcode`, `stanSeqno`, `templateSetId` 입력 필드 추가
  - `sortcode + stanSeqno`로 템플릿셋 조회 버튼 추가
  - 조회 결과에서 기본 템플릿셋 선택 가능하게 구성
- 산출물:
  - 운영자가 상품별 Storige 템플릿셋 매핑을 저장할 수 있는 UI
- 검증:
  - 저장 후 상품 목록/상세 진입 시 매핑 정보 유지

### 2-3. 엑셀 내보내기/가져오기 필드 확장

- 대상 repo: `bookmoa-mobile`
- 대상 파일:
  - `src/App.jsx`
- 작업:
  - 상품정보 sheet에 Storige 필드 포함
  - 업로드 시 기존 파일에는 영향 없이 신규 필드가 있으면 반영
- 산출물:
  - 대량 상품 관리 시 Storige 매핑 유지
- 검증:
  - 기존 엑셀 업로드 파일도 정상 파싱

## Phase 3. 편집기 진입 흐름 연결

### 3-1. 편집기 실행 방식 결정 및 1차 구현

- 대상 repo: `bookmoa-mobile`
- 권장 1차 방식:
  - 운영 편집기 URL 새 탭 또는 현재 탭 이동
- 이유:
  - 현재 앱이 단일 `App.jsx` 기반이고 라우터/서버 렌더링 구조가 없으므로 embed 전용 페이지보다 초기 구현 범위가 작음
- 작업:
  - `STORIGE_EDITOR_URL` 기반 편집기 URL 생성
  - `templateSetId`, `pageCount`, `paperType`, `bindingType`, `width`, `height`는 camelCase query로 전달
  - `returnUrl`, `orderSeqno`, `parentOrigin` 전달 가능 구조 확보
- 산출물:
  - 상품 상세에서 편집기를 열 수 있는 URL 생성 로직
- 검증:
  - Storige API Key가 URL에 포함되지 않음

### 3-2. ProdConfigure에 편집기 버튼 추가

- 대상 repo: `bookmoa-mobile`
- 대상 파일:
  - `src/App.jsx`
- 작업:
  - `prod.allowEditor`이고 `storigeTemplateSetId`가 있을 때 `편집기로 작업하기` 버튼 표시
  - 버튼 클릭 시 `/api/storige/shop-session` 호출
  - 세션 발급 성공 후 편집기 URL 오픈
  - 실패 시 사용자에게 명확한 오류 표시
- 산출물:
  - 고객이 상품 상세에서 Storige 편집기를 실행하는 흐름
- 검증:
  - API 실패, 매핑 누락, 팝업 차단 케이스 처리

### 3-3. 편집 완료 결과 수신 방식 정리

- 대상 repo: `bookmoa-mobile`, `storige`
- 작업:
  - 새 탭/returnUrl 방식에서 완료 결과를 어떻게 전달받을지 확인
  - 가능한 방식:
    - return URL query에 `sessionId`, `coverFileId`, `contentFileId` 포함
    - 서버 webhook 또는 polling으로 상태 조회
    - embed 전환 시 `postMessage`로 수신
- 산출물:
  - 1차 구현에서 사용할 완료 결과 저장 방식
- 검증:
  - 완료 결과가 브라우저 조작만으로 다른 주문에 덮어쓰이지 않도록 주문 식별자 검증

## Phase 4. 장바구니/주문 데이터에 Storige 결과 저장

### 4-1. cart item storige 객체 추가

- 대상 repo: `bookmoa-mobile`
- 대상 파일:
  - `src/App.jsx`
- 저장 형태:
  - `storige.sessionId`
  - `storige.coverFileId`
  - `storige.contentFileId`
  - `storige.templateSetId`
  - `storige.status`
  - `storige.orderSeqno`
- 작업:
  - `ProdConfigure.handleAdd`에서 편집 결과가 있으면 cart item에 포함
  - 기존 파일 업로드 기반 cart item과 공존
- 산출물:
  - 주문 확정 단계에서 worker 합성 요청에 필요한 파일 ID 보존
- 검증:
  - 장바구니, 주문 내역, 재주문에서 기존 데이터가 깨지지 않음

### 4-2. 주문 생성 시 Storige 필드 보존

- 대상 repo: `bookmoa-mobile`
- 대상 파일:
  - `src/App.jsx`
- 작업:
  - checkout/order 생성 흐름에서 cart item의 `storige` 객체 유지
  - 주문 상세에서 Storige 상태와 파일 ID를 운영자가 확인할 수 있게 표시
- 산출물:
  - 주문 데이터에 편집 세션과 결과 파일 연결
- 검증:
  - 주문 완료 후 새로고침해도 Storige 필드 유지

## Phase 5. PDF 검증/합성 worker 연동

### 5-1. check-mergeable 어댑터 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/check-mergeable.js`
- 작업:
  - `coverFileId`, `contentFileId`, 주문 옵션을 받음
  - Storige `POST /worker-jobs/check-mergeable/external` 호출
- 산출물:
  - 주문 확정 전 합성 가능 여부 확인 endpoint
- 검증:
  - 파일 ID 누락 시 400 반환

### 5-2. synthesize 어댑터 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/synthesize.js`
- 작업:
  - 주문 확정 시 `coverFileId`, `contentFileId`, `orderId`, `editSessionId`, `callbackUrl` 전달
  - Storige `POST /worker-jobs/synthesize/external` 호출
  - 반환된 `jobId`를 주문 데이터에 저장할 수 있게 응답
- 산출물:
  - 결제/주문 완료 후 PDF 합성 job 생성 endpoint
- 검증:
  - 같은 주문에서 중복 호출될 때의 처리 정책 확인

### 5-3. validate 어댑터 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/validate.js`
- 작업:
  - 업로드 PDF 또는 편집 결과 PDF를 검증 job으로 전달
  - Storige `POST /worker-jobs/validate/external` 호출
- 산출물:
  - PDF 검증 요청 endpoint
- 검증:
  - 검증 실패/수정 가능/성공 상태를 UI 메시지로 매핑

## Phase 6. Webhook과 결과 PDF 처리

### 6-1. webhook endpoint 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/webhook.js`
- 작업:
  - `X-Storige-Event`, `X-Storige-Signature` 수신
  - 현재 Storige 구현 기준 서명 검증 방식 적용
  - `jobId`, `orderId`, `status`, `outputFileUrl`, `errorMessage` 파싱
  - 주문 상태 저장소가 확정되기 전에는 로그/응답 구조부터 구현
- 산출물:
  - Storige worker 결과를 받는 endpoint
- 검증:
  - 잘못된 서명 또는 누락된 필수값은 거부

### 6-2. 결과 PDF 다운로드 프록시 추가

- 대상 repo: `bookmoa-mobile`
- 예상 파일:
  - `api/storige/output.js`
- 작업:
  - 클라이언트가 Storige API를 직접 호출하지 않도록 서버에서 다운로드 프록시
  - `jobId` 기준 `GET /worker-jobs/{jobId}/output` 호출
  - 권한/주문 소유 검증 지점 확보
- 산출물:
  - 주문 상세에서 결과 PDF를 안전하게 내려받는 endpoint
- 검증:
  - Storige 내부 storage URL이나 API Key가 클라이언트에 노출되지 않음

## Phase 7. Storige 플랫폼 계약 보강

### 7-1. Editor URL 파라미터 호환성 정리

- 대상 repo: `storige`
- 대상 파일:
  - `apps/editor` 내 URL query 파싱 지점
- 작업:
  - `template_set_id`, `page_count`, `paper_type`, `binding_type`, `return_url` snake_case 입력을 camelCase로 정규화
  - 기존 camelCase query는 계속 지원
- 산출물:
  - PHP 문서와 bookmoa-mobile 양쪽이 안전하게 쓸 수 있는 호환 레이어
- 검증:
  - camelCase/snake_case 양쪽 URL로 동일 설정 로드

### 7-2. Webhook 서명 방식 문서/구현 일치

- 대상 repo: `storige`
- 대상 파일:
  - `apps/api/src/webhook/webhook.service.ts`
  - 관련 docs
- 작업:
  - 현재 Base64 방식 유지 또는 HMAC-SHA256 전환 중 하나 확정
  - bookmoa-mobile webhook 검증 코드와 같은 방식으로 맞춤
- 산출물:
  - 외부 서비스가 구현 가능한 webhook 서명 계약
- 검증:
  - 정상 서명 통과, 변조 payload 거부 테스트

### 7-3. Site 기반 도메인 정책 개선

- 대상 repo: `storige`
- 대상 영역:
  - CORS origin
  - iframe `frame-ancestors`
  - postMessage origin
  - webhook allowlist
- 작업:
  - Site 설정의 `domain`, `allowedOrigins`, `frameAncestors`, `uploadCallbackUrl` 기반으로 정책을 모으는 방향 검토
  - 즉시 구현 범위와 운영 환경 변수 유지 범위를 분리
- 산출물:
  - 외부 사이트 추가 시 환경변수 수동 변경을 줄이는 설계/구현
- 검증:
  - 등록되지 않은 origin/callback host 차단

## Phase 8. 파트너 관리자/주문처리 기능

### 8-1. 권한 모델 확장

- 대상 repo: `storige`
- 대상 파일:
  - `packages/types/src/index.ts`
  - `apps/api/src/auth/entities/user.entity.ts`
- 작업:
  - `PARTNER_ADMIN`, `PARTNER_OPERATOR` 역할 추가
  - `users.site_id` nullable FK 추가
  - JWT payload에 site scope 포함
- 산출물:
  - 사이트별 파트너 계정 모델
- 검증:
  - 기존 admin/customer 로그인 흐름 회귀 없음

### 8-2. Site scope guard 추가

- 대상 repo: `storige`
- 작업:
  - 파트너 역할이면 `siteId=user.siteId`를 강제하는 guard/interceptor 추가
  - worker jobs, edit sessions, files 목록/상세/download에 적용
- 산출물:
  - 다른 사이트 데이터 직접 접근 방지
- 검증:
  - A 사이트 파트너가 B 사이트 job/file/session 접근 시 403

### 8-3. 파트너 주문처리 API/UI 추가

- 대상 repo: `storige`
- 예상 API:
  - `GET /partner/orders`
  - `GET /partner/orders/:id`
  - `PATCH /partner/orders/:id/status`
  - `GET /partner/worker-jobs`
  - `GET /partner/files/:id/download`
- 작업:
  - 주문 목록, 상세, PDF 다운로드, 제작 상태 변경 구현
  - Admin UI에서 역할별 메뉴 분리
- 산출물:
  - 제휴사 관리자/주문처리 화면
- 검증:
  - 자기 사이트 주문만 조회/처리 가능

## Phase 9. 통합 검증

### 9-1. 로컬 개발 검증

- 대상 repo: `storige`, `bookmoa-mobile`
- 작업:
  - 각 repo 의존성/빌드 스크립트 확인
  - `bookmoa-mobile` build 실행
  - 가능하면 Storige API/Editor 로컬 실행 후 shop-session과 편집기 진입 테스트
- 검증:
  - 빌드 성공
  - API Key 브라우저 노출 없음
  - 편집기 URL 생성 정상

### 9-2. E2E 시나리오

- 시나리오:
  - Storige Admin에서 사이트 등록 및 인증코드 발급
  - 상품 `sortcode + stanSeqno`와 템플릿셋 연결
  - bookmoa-mobile 관리자에서 상품에 Storige 매핑 저장
  - 고객 상품 상세에서 편집기 실행
  - 편집 완료 후 `sessionId`, `coverFileId`, `contentFileId` 저장
  - 장바구니/주문 완료
  - `check-mergeable` 및 `synthesize` 호출
  - webhook으로 `synthesis.completed` 수신
  - 결과 PDF 다운로드
  - Storige Admin에서 사이트 필터로 작업 분리 확인
- 검증:
  - 북모아 사이트와 테스트 외부 사이트의 작업/세션/job이 분리됨

## 우선순위

### P0

- `bookmoa-mobile` 서버 어댑터 추가
- 상품 Storige 매핑 필드/UI 추가
- 편집기 진입 URL 생성 및 shop-session 발급
- cart/order에 Storige 편집 결과 저장
- Editor URL snake_case/camelCase 호환성 정리

### P1

- worker `check-mergeable`, `validate`, `synthesize` 어댑터
- webhook endpoint 및 서명 검증
- 결과 PDF 다운로드 프록시
- 기본 통합 테스트

### P2

- Site 기반 CORS/iframe/webhook allowlist 정리
- 파트너 관리자 권한 모델
- 파트너 주문처리 API/UI
- 다중 외부 서비스 온보딩 문서/SDK 정리

## 첫 구현 단위

가장 먼저 진행할 구현 단위는 `bookmoa-mobile`의 서버 어댑터와 상품 매핑 UI다.

1. `api/storige/_client.js`
2. `api/storige/shop-session.js`
3. `api/storige/template-sets.js`
4. `src/App.jsx`의 `ProductEditor` Storige 필드 추가
5. `src/App.jsx`의 `ProdConfigure` 편집기 버튼 추가

이 단위가 끝나면 API Key 비노출 원칙을 지키면서 상품별 편집기 실행까지 검증할 수 있다.
