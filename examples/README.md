# Storige quickstart 예제

**Partner API v1** 을 `@storige/sdk` 로 소비하는 최소 실행 예제 3종. 파트너가 그대로
복사해 시작할 수 있도록 추상화를 최소화했고, 각 예제는 라이브 키 없이 돌려 볼 수 있는
검증 스크립트(`pnpm verify`)를 함께 가진다.

> ⚠️ 이 예제들은 **Partner API v1**(`/api/v1/books` · `/api/v1/book-specs` · `/api/v1/webhooks`)
> 표면을 쓴다. 기존 파트너가 쓰는 레거시 외부 표면(`/files/upload/external` ·
> `validate/external` · `download/external`)과는 다른 경로다 — 유형별 레거시 시퀀스는
> `docs/PLATFORM_INTEGRATION_GUIDE.md` 를 참조하라.

## 무엇을 언제 쓰나

| 예제 | 상황 | 핵심 API |
|---|---|---|
| [`pdf-upload-order`](./pdf-upload-order) | **PDF 를 내가 만든다.** 자체 편집기/렌더러가 있고 Storige 의 인쇄 검증·합성·산출만 필요하다 | `books.create({creationType:'PDF_UPLOAD'})` → 자산 투입 → `startFinalization` → `downloadPdf` |
| [`editor-session-order`](./editor-session-order) | **편집 UI 를 Storige 에 위임한다.** `/embed` iframe 으로 고객이 편집하고, 끝난 세션을 주문으로 승격한다 | `/embed` + postMessage 엔벨로프 v1 → `books.create({creationType:'EDITOR_SESSION', sessionId})` |
| [`webhook-receiver`](./webhook-receiver) | **완료 통지를 비동기로 받는다.** 위 두 경우 **모두**에 필요하다 | `@storige/sdk/webhook` — 서명 검증 · 중복 배달 단락 · 이벤트 분기 |

연동 유형(`docs/PLATFORM_INTEGRATION_GUIDE.md` §0)과의 대응은 대략 이렇다.

```
유형 1 (자체 편집기 오프로드)  → pdf-upload-order      + webhook-receiver
유형 2 (임베드 편집 위임)      → editor-session-order  + webhook-receiver
유형 3 (임베드 + 외부 수신)    → editor-session-order  + webhook-receiver
```

`webhook-receiver` 가 전부에 붙는 이유: 최종화는 **비동기**이고, 폴링은 백스톱이지
정본 알림 경로가 아니다.

## 시작 순서 (권장)

1. **`webhook-receiver` 를 먼저 띄워라.** `pnpm verify` 가 서명 생성부터 중복 단락까지
   전 배선을 외부 의존 없이 확인해 준다 — 여기서 배선이 맞으면 나머지가 쉬워진다.
2. 자기 상황에 맞는 주문 예제 하나(`pdf-upload-order` 또는 `editor-session-order`)를
   `pnpm verify` 로 돌려 **어떤 HTTP 호출이 나가는지** 눈으로 확인한다.
3. `.env` 를 채우고 **test 키**로 실제 호출한다. env(test/live)는 키에 내재하며 데이터가
   완전히 격리된다.

## 공통 전제

- **Node ≥ 22.18.** 빌드 단계 없이 `node src/main.ts` 로 `.ts` 를 그대로 실행한다(Node
  내장 타입 스트리핑). 더 낮은 버전이면 `tsx`/`ts-node` 를 끼우면 되고 코드는 그대로다.
- **SDK 는 아직 npm 미배포**(`private: true`)다. 그래서 예제들은 모노레포 안에서
  `"@storige/sdk": "workspace:*"` 로 참조하고, 먼저 dist 를 만들어야 한다.

  ```bash
  pnpm --filter @storige/sdk build
  ```

  배포 후에는 `npm i @storige/sdk` + `"^0.1.0"` 으로 바꾸면 되고 **예제 코드는 한 줄도
  바뀌지 않는다**(배포 시점·형태는 오너 결정 D-10b 대기).
- **시크릿은 전부 env 경유.** 각 예제에 `.env.example` 이 있고, 파싱·검증은 `src/env.ts`
  한 곳에서만 한다. `process.env.X!`(non-null 단언)는 타입만 속이므로 쓰지 않는다.

## 전량 검증

```bash
pnpm --filter @storige/sdk build
for e in pdf-upload-order editor-session-order webhook-receiver; do
  pnpm --filter "@storige/example-$e" typecheck
  pnpm --filter "@storige/example-$e" verify
done
```

CI(`.github/workflows/ci.yml`)가 같은 검증을 매 push/PR 마다 돈다.

## 아직 예제가 없는 것

- **`creationType: 'TEMPLATE'` / `'MIX_COVER_TEMPLATE'`** — 서버측 바인딩(cover/contents)
  라우트가 **미구현**이라 최종화가 422 로 막힌다(서버 Stage 5). 동작하지 않는 예제를
  미리 만들지 않는다.
- **호스트 → 편집기 명령 전송** — 동결 계약 문서에 수신 명령 목록이 없다. 확정되지 않은
  형태를 예제로 굳히면 그것이 곧 계약 약속이 되므로 다루지 않는다.
