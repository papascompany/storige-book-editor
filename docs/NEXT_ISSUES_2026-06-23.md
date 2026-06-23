# 추후 체크 이슈 — 2026-06-23

> 2026-06-23 잔여 게이트 배치(ⓐ~ⓕ) 처리 후 **미완·게이트·후속** 항목 정리.
> 배포 완료분(ⓐ compress·ⓓ WH-001 우리측·ⓕ SEC-005·ⓔ 합성멱등·ⓑ AUTH stage1)은 LIVE.
> 정본 상세: 메모리 `project_full_audit_2026-06-21` + `.cursor/plans/P0-2_HISTORY_PURGE_READINESS_2026-06-23.md`.

---

## 🔴 보안/인증 (고위험 — 단계적·검증 선행)

### I-1. AUTH-001 stage 1b — 프론트 httpOnly 쿠키 전환
- **상태**: stage1(서버측 비파괴 — jwt 다중 extractor + login/refresh dual Set-Cookie) **배포·LIVE**. stage1b 미착수.
- **할 일**: admin 프론트 `withCredentials:true` + localStorage 토큰 제거 → 쿠키 기반 인증으로 전환. refresh 인터셉터(admin `/auth/refresh`) e2e 선행 필수.
- **위험**: 인증 경로 = 실수 시 전체 로그인 잠금. 단계적·롤백 준비.
- **동반**: editor(크로스도메인 임베드)는 httpOnly 불가 → Bearer 유지 + **CSP Report-Only** 먼저 + `JWT_EXPIRES_IN` 단축(현재 7d → 보수적 단축, eviction 위험 모니터링). **CSRF**는 별도 티켓.

### I-2. ⓒ 게이트 B — git 히스토리 시크릿 정화 (force-push)
- **상태**: PREP 완료. **오너 승인·타이밍 게이트**. 회전(§1)이 끝나 **비긴급**(방어심층).
- **할 일**: `git filter-repo`로 히스토리 백엔드 `.env.production`/`.env.development` 블롭 제거 + force-push + VPS `reset --hard` + 협업자 재클론 + GitHub Support 캐시제거 티켓.
- **명령 정본**: `.cursor/plans/P0-2_HISTORY_PURGE_READINESS_2026-06-23.md` 게이트 B.

### I-3. ⓒ 게이트 A — bookmoa PHP 키 cutover ⏸️ **보류**
- **상태**: bookmoa PHP 연동 당분간 보류 → 키 cutover 보류.
- **잔여 노출(인지)**: 구 키(site `1391c5b4` 북모아 메인)가 PUBLIC 히스토리 노출 상태로 **active 유지**.
- **판단필요**: PHP가 *현재 구 키 사용 중*이면 비활성=장애 → 보류 유지. *연동 보류=PHP 미호출*이면 **지금 비활성화해도 무중단·노출 즉시 제거 가능**(연동 재개/호출여부 확인 시 결정).
- **재개 절차**: P0-2 readiness 게이트 A.

---

## 🟡 워커/큐 신뢰성

### I-4. Bull 합성 재시도(attempts>1) 활성화
- **상태**: 멱등 가드(완료 마커, ⓔ) **배포·LIVE**. `attempts`는 여전히 1(보수적).
- **할 일**: 합성 `.add()`에 `attempts:2 + 지수 backoff` 부여 = 일시 실패 자동복구. **선결**: 비최종 시도에서 `FAILED` 웹훅을 보내지 않도록(현재 catch→updateJobStatus(FAILED)→파트너 premature FAILED) `job.attemptsMade < job.opts.attempts`일 땐 throw만(콜백 억제). 5개 핸들러 catch 분기 영향.
- **근거**: 멱등 가드가 중복합성은 막으나, 재시도 시 중간 FAILED 웹훅 의미론을 정리해야 안전.

### I-5. BQ-03 — updateJobStatus 최종실패 시 throw 전환
- **상태**: sweeper(2h)로 보완 중(PROCESSING 잔류 회수). throw 전환 보류.
- **할 일**: 상태업데이트 최종실패 시 throw로 전환(멱등성 검토 후). I-4와 함께 검토.

### I-6. 휴면 버그 — 워커 `getFileById` 401
- **상태**: 무영향(활성 합성경로 미사용). merge-by-fileId 모드 도입 시 필요.
- **할 일**: 워커용 메타 엔드포인트(ApiKeyGuard)로 `GET /files/:id` 대체(현재 JwtAuthGuard가 워커키 401).

---

## 🟢 파트너/운영

### I-7. WH-001 — 파트너 HMAC cutover (구 base64 폐기)
- **상태**: 위조불가 HMAC(`X-Storige-Signature-HMAC`) **추가 헤더로 발송 중**(2026-06-23 prod 활성화). 구 base64(`X-Storige-Signature`)도 병행(비파괴).
- **할 일**: 파트너(bookmoa-mobile/ShareSnap/100p/MD2Books — PHP는 보류)가 신 헤더 검증 전환 확인 후 구 base64 발송 제거.
- **지시문**: `.cursor/plans/WH001_PARTNER_CUTOVER/` (5종 + OUR_CUTOVER_RUNBOOK).
- **별건 문서수정**: `docs/PLATFORM_WORKER_INTEGRATION_v1.md` §5-3의 HMAC 스킴 기술이 **부정확**(헤더명/서명문/env 불일치) → 정정 필요.

### I-8. jspdf 4.x 사후 모니터링
- **상태**: prod editor = jspdf 4.x(+compress) 전환·LIVE. 골든파리티(픽셀/연산자 동일) 검증 완료.
- **할 일**: 며칠간 실제 주문 PDF(명함/표지+내지/봉투) 육안 확인. 이상 시 `vercel promote <ounewexk3-url>`(2.x 롤백).

---

## 📌 다음 작업 (CTO 지시, 2026-06-23)
- **템플릿/템플릿셋 상품 유형 1~2종 추가** — 진행 중. 제작 가이드 정본 = `docs/템플릿등록 매뉴얼.md`(+`.html`). 현재 상태 보고는 별도.

---

> 작성 2026-06-23. 처리 완료분/커밋은 메모리 `project_full_audit_2026-06-21` 참조.
