# Storige 연동 변경 안내 (2026-08-24) — MD2Books 팀

- 발신: Storige 운영 (papascompany)
- 적용 시점: **2026-08-23 프로덕션 반영 완료** (무중단)
- 조치 필요 여부: **불요** (무영향 확인 통지)

## 1. 무엇이 바뀌었나

Storige 회원 세션 API(`/api/edit-sessions` 의 상세/수정/완료/삭제/버전/목록/보관함)에 **테넌트 격리**가 확장 적용되었습니다 — shop-session JWT 의 `siteId` 와 세션의 `siteId` 가 다르면 `404 SESSION_NOT_FOUND`(목록은 조용한 제외). 아울러 임베드 편집기의 `editor.saved` 역명령 응답에 `ok:false, error:'EDITOR_BUSY'` 케이스가 추가되었습니다.

## 2. 귀사 연동에는 영향이 없습니다

귀사 연동(유형 1: 자체 생성 + 검증/합성/발주/보존 오프로드)이 사용하는 경로는 이번 변경 대상이 아닙니다:

- `X-API-Key` / Partner API v1 기반 파일·잡·발주 경로 — **기존 site 격리 규칙 그대로**, 변경 없음
- `compose-mixed` 합성 경로 — 변경 없음
- 임베드 편집기(`/embed`)·shop-session JWT 회원 라우트 — 귀사 미사용

향후 임베드 편집기나 shop-session JWT 기반 회원 라우트를 도입하시게 되면, 정본 가이드 `docs/PLATFORM_INTEGRATION_GUIDE.md` §1.5 "세션 API 테넌트 격리"·§3.2 를 참고해 주세요.

## 3. 문의

이상 동작이 관찰되면 발생 시각·요청 경로와 함께 기존 채널로 연락 주세요.
