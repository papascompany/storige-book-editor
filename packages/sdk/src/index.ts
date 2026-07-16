/**
 * @storige/sdk — Storige Partner API v1 공식 SDK (루트 subpath).
 *
 * ## 왜 수작업(hand-written)인가
 * v1 표면에 `@ApiResponse({ type })` 스키마가 0건이고, 성공/에러 봉투는 런타임
 * 인터셉터(partner-envelope.interceptor.ts)·예외 필터 소관이라 OpenAPI 문서에
 * 나타나지 않는다. 즉 openapi-partner.json 은 문서 포털 렌더용이지 SDK 코드생성
 * 입력이 아니다 — 생성기를 돌리면 봉투 없는 잘못된 타입이 나온다.
 *
 * ## 계약 타입을 자체 재선언하는 이유
 * 서버는 @storige/types 를 공유하지만 그 패키지는 private:true 이고 2207줄 중
 * v1 계약은 75줄뿐이다. 통째로 배포하면 내부 도메인 모델 전량이 파트너에게
 * 노출된다. 따라서 SDK 는 v1 계약(ErrV1 29종·봉투·페이지네이션)만 자체 재선언하고,
 * 드리프트는 types-parity.spec.ts 가 구조 등가성으로 감시한다(@storige/types 는
 * devDependency — 런타임 번들 유입 없음).
 *
 * ## 서브패스
 * - `@storige/sdk`         — 계약 타입·에러·상수(런타임 무관, 트리셰이킹 가능)
 * - `@storige/sdk/client`  — HTTP 클라이언트(StorigeClient)
 *
 * 예약: `./webhook`(수신 서명 검증)·`./embed`(임베드 편집기)는 후속 단계.
 * 미구현 서브패스를 미리 선언하지 않는다 — 던지는 스텁은 계약 약속이 되어
 * 파트너를 오도한다. 패키지 미배포(private) 상태라 후속 추가는 additive 다.
 */

/** SDK 버전 — package.json version 과 동기(릴리스 워크플로 게이트에서 대조). */
export const SDK_VERSION = '0.1.0';
