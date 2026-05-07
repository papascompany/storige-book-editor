# Storige 플랫폼 워커 연동 — AI 구현 프롬프트

> AI(Claude/GPT 등)에게 [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md)와 함께 첨부 후 본 프롬프트를 그대로 입력하세요.
> `[ ]` 안의 4개 항목만 본인 환경에 맞게 채우면 즉시 동작하는 코드가 나옵니다.

---

## 사용법

1. 본 폴더의 `PLATFORM_WORKER_INTEGRATION_v1.md`를 AI에 첨부 (또는 본문에 붙여넣기)
2. 아래 프롬프트의 `[대괄호]` 부분 채우기
3. AI에게 전달
4. 출력된 코드를 본인 프로젝트에 적용
5. `STORIGE_API_KEY`, `STORIGE_API_BASE`, `STORIGE_WEBHOOK_URL` 환경변수 설정 후 실행

---

## 프롬프트 (복사용)

```
첨부한 "Storige 플랫폼 워커 연동 가이드 v1.0"을 참조해, [언어/프레임워크]로
[당신 사이트명]의 워커 연동 모듈을 구현하세요.

## 환경
- 언어/프레임워크: [예: Node.js + Express, Python + FastAPI, Go + Echo,
                    Java + Spring Boot, Ruby + Rails, PHP 8 + Laravel, C# + ASP.NET]
- 기존 코드 스타일: [예: TypeScript strict, Python type hints, Go idiomatic]
- 환경변수 (.env): STORIGE_API_KEY, STORIGE_API_BASE, STORIGE_WEBHOOK_URL,
                    STORIGE_WEBHOOK_SECRET (있으면)
- 호출 방향: 서버 사이드만 (X-API-Key는 절대 클라이언트 노출 X)

## 구현해야 할 5가지 기능

1. **파일 업로드 헬퍼** — `uploadPdf(path, type): Promise<fileId>`
   - 가이드 §4-1 참조
   - multipart/form-data, X-API-Key 헤더
   - 응답 `id`만 반환 (URL 아님 — UUID)

2. **합성 잡 생성** — `createSynthesisJob(input): Promise<jobId>`
   - 가이드 §4-2 참조
   - 필수: coverFileId, contentFileId, spineWidth (mm)
   - 선택: bindingType (perfect|saddle|hardcover), outputFormat (merged|separate),
     orderId, priority, callbackUrl, editSessionId

3. **Webhook 수신 endpoint** — `POST /storige/webhook`
   - 가이드 §5 참조
   - X-Storige-Event 헤더로 분기 (synthesis.completed / synthesis.failed)
   - X-Storige-Signature HMAC-SHA256 검증 (시크릿 있을 때만)
   - 즉시 200 반환 + 처리는 비동기 큐로
   - replay 방지 (timestamp 5분 이내)

4. **결과 PDF 다운로드** — `downloadResultPdf(jobId, member, orderSeqno): Promise<Buffer>`
   - 가이드 §4-4 + §4-5 참조
   - 1단계: /auth/shop-session 호출 → JWT 받기 (X-API-Key)
   - 2단계: /worker-jobs/{jobId}/output (Bearer JWT) → binary 응답
   - JWT 1h 캐시 권장 (memory 또는 KV store)

5. **상태 조회 (폴링 옵션)** — `getJobStatus(jobId): Promise<status>`
   - 가이드 §4-3 참조
   - webhook 수신 안정화 전까지 백업으로

## 에러 처리 요구사항
- 가이드 §7 응답 코드 카탈로그 모두 구현
- 401 발생 시 명확한 에러 메시지 (키 잘못 / JWT 만료 구분)
- Webhook 200 응답 보장 (실패해도 200, 처리는 비동기)
- 합성 잡 status: PENDING / PROCESSING / COMPLETED / FIXABLE / FAILED 분기

## 보안 / 운영 가이드
- 가이드 §9-1 ~ §9-5 모든 이슈 예방 코드에 반영
- callbackUrl 호스트가 가이드 §9-3에 따라 사전 등록 필요함을 README/주석에 명시
- outputFileUrl은 internal path — 절대 직접 GET 금지, §4-5 흐름만
- 다른 사이트 jobId 다운로드 시 403 정상 응답하도록 처리

## 출력 형식
- 단일 모듈 파일 (혹은 설계상 자연스럽게 분리)
- 모든 입출력 타입 명시 (TypeScript interface / Python dataclass / Go struct 등)
- 실 동작하는 main 예시:
    cover.pdf + content.pdf 업로드 → 합성 잡 → 폴링 또는 webhook → 결과 다운로드 → 저장
- 단위 테스트 1~2개 (mock HTTP)
- README에 환경변수 + callbackUrl 등록 절차 안내

## 제약
- 외부 의존성 최소화 (가능하면 표준 라이브러리. multipart 만 별도 OK)
- X-API-Key는 헤더만 사용, body나 query 사용 금지
- 합성 결과 outputFileUrl 직접 fetch 금지, §4-5 흐름만
- 가이드 외부 정보(웹 검색 등) 사용 금지. 추측 대신 가이드 §X-Y 인용.
- 가이드에 없는 endpoint는 임의로 만들지 말 것.

## 추가 컨텍스트 (선택)
- 기존 사용 중인 큐: [예: BullMQ, Celery, Sidekiq, Resque]
  → Webhook 비동기 처리 시 이 큐 사용
- 기존 사용 중인 storage: [예: 로컬 디스크, S3, R2]
  → 결과 PDF 저장 위치
- 기존 사용 중인 secret manager: [예: AWS SSM, GCP Secret Manager, Vault]
  → STORIGE_API_KEY 보관 방식

답변은 한국어 주석 + 영문 코드 식별자로 작성하세요.
구현이 끝나면 마지막에 "운영팀에 요청할 사항" 체크리스트를 정리해주세요.
```

---

## 채움 예시 — Node.js + Express

```
첨부한 "Storige 플랫폼 워커 연동 가이드 v1.0"을 참조해, **Node.js 22 + Express + TypeScript**로
**점보포토(jumbophoto.co.kr)**의 워커 연동 모듈을 구현하세요.

## 환경
- 언어/프레임워크: Node.js 22 + Express + TypeScript (strict)
- 기존 코드 스타일: pnpm, biome formatter, async/await만 사용
- 환경변수 (.env): STORIGE_API_KEY, STORIGE_API_BASE, STORIGE_WEBHOOK_URL,
                    STORIGE_WEBHOOK_SECRET
- 호출 방향: 서버 사이드만 (X-API-Key는 절대 클라이언트 노출 X)

[... 위 프롬프트 그대로 ...]

## 추가 컨텍스트
- 기존 사용 중인 큐: BullMQ (Redis)
- 기존 사용 중인 storage: AWS S3 (us-east-1)
- 기존 사용 중인 secret manager: AWS SSM Parameter Store
```

---

## 채움 예시 — Python + FastAPI

```
첨부한 "Storige 플랫폼 워커 연동 가이드 v1.0"을 참조해, **Python 3.12 + FastAPI**로
**스튜디오북(studiobook.kr)**의 워커 연동 모듈을 구현하세요.

## 환경
- 언어/프레임워크: Python 3.12 + FastAPI + Pydantic v2
- 기존 코드 스타일: ruff format, type hints 필수, async def 사용
- 환경변수 (.env): STORIGE_API_KEY, STORIGE_API_BASE, STORIGE_WEBHOOK_URL,
                    STORIGE_WEBHOOK_SECRET
- 호출 방향: 서버 사이드만

[... 위 프롬프트 그대로 ...]

## 추가 컨텍스트
- 기존 사용 중인 큐: Celery + RabbitMQ
- 기존 사용 중인 storage: 로컬 디스크 /var/storage/studiobook/
- 기존 사용 중인 secret manager: 환경변수 (.env)
```

---

## 결과물 검증 체크리스트

AI 출력 코드를 받았을 때 다음을 확인:

- [ ] 5개 함수 모두 구현됨 (upload / synth / webhook / download / status)
- [ ] X-API-Key가 모든 외부 호출 헤더에 들어감
- [ ] X-API-Key가 클라이언트(브라우저 JS) 코드에 노출 안 됨
- [ ] outputFileUrl 직접 fetch 시도 없음 (가이드 §4-5 흐름만)
- [ ] Webhook endpoint가 즉시 200 반환
- [ ] X-Storige-Signature 검증 (시크릿 있으면)
- [ ] 401 / 403 / 404 / 422 / 502 에러별 처리 분기
- [ ] FIXABLE 잡 정책 결정 (코드 또는 주석에 명시)
- [ ] JWT 캐시 (1h)
- [ ] callbackUrl 호스트 사전 등록 안내 (README 또는 주석)

---

## 참조 문서

- [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md) — 가이드 본문 (필수 첨부)
- [`PHASE_A_SITE_MODEL_REPORT_2026-05-06.md`](./PHASE_A_SITE_MODEL_REPORT_2026-05-06.md) — 멀티사이트 모델 배경
- [`PHP_INTEGRATION_FINAL_v3.md`](./PHP_INTEGRATION_FINAL_v3.md) — PHP 한정, 편집기 UI 포함 (참고)
- API Swagger: https://api.papascompany.co.kr/api/docs
