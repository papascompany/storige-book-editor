# quickstart — PDF 업로드 주문 (`creationType: 'PDF_UPLOAD'`)

이미 완성된 표지/내지 PDF 를 가진 파트너가 **주문 1건을 끝까지** 처리하는 최소 코드다.

```
① ping            키 인증 확인
② book-specs      판형 규칙 확인 + calculated-size 로 "PDF 를 몇 mm 로 만들지" 확정
③ books.create    DRAFT 도서 생성
④ 자산 투입       표지/내지 PDF — fileId 참조(권장) 또는 멀티파트
⑤ finalization    최종화 착수(검증 → 합성)
⑥ 완료 대기       웹훅(권장) 또는 폴링
⑦ GET /pdf        최종 PDF 스트림 수령
```

## 무엇을 증명하는가

`src/verify.ts` 는 **라이브 키 없이** 실제 SDK 를 통과시켜 다음을 단언한다(`pnpm verify`).

| | 내용 |
|---|---|
| A | 전 여정이 위 순서의 **9개 HTTP 호출**로 나가고, 전 호출이 `Authorization: Bearer` 단일 헤더를 쓰며, POST 3건에 `Idempotency-Key` 가 자동 부여된다 |
| B | 멀티파트 업로드는 멱등키가 **자동 부여되지 않고**, 명시 제공 시 SDK 가 `키:sha256(파일)` 로 내용 주소화한다 |
| C | `409 ERR_FINALIZATION_IN_PROGRESS` 는 실패가 아니라 **기존 attempt 합류**로 이어진다(재착수 0회) |
| D | `422 ERR_PAGE_COUNT_OUT_OF_RANGE` 는 도서를 만들기 **전에** 차단된다(고아 DRAFT 없음) |

## 전제

- Node **≥ 22.18** — 빌드 단계 없이 `node src/main.ts` 로 `.ts` 를 그대로 실행한다
  (Node 내장 타입 스트리핑). 더 낮은 버전이면 `tsx`/`ts-node` 를 끼우면 된다.
- 파트너 API 키 — **test 키로 시작하라**. env(test/live)는 키에 내재하며 데이터가 완전히 격리된다.
- 표지/내지 PDF. `fileId` 참조 경로를 쓰려면 동결 업로드 표면(presigned ≤2GB)에 먼저 올려
  `files.id` 를 받아 둔다.

## `@storige/sdk` 참조 방식 (중요)

SDK 는 아직 **npm 미배포**(`private: true`)다. 그래서 이 예제는 모노레포 안에서
`"@storige/sdk": "workspace:*"` 로 참조한다.

```jsonc
// 지금 (모노레포 내부)
"dependencies": { "@storige/sdk": "workspace:*" }

// 배포 후 (파트너 레포)
"dependencies": { "@storige/sdk": "^0.1.0" }   // npm i @storige/sdk
```

배포 시점·배포 형태는 오너 결정(D-10b) 대기 중이다. **코드는 한 줄도 바뀌지 않는다** —
`package.json` 의 의존성 표기만 바꾸면 된다.

## 실행

```bash
# 0) SDK 빌드(모노레포에서 workspace 참조를 쓰므로 dist 가 필요하다)
pnpm --filter @storige/sdk build

# 1) 라이브 키 없이 호출 시퀀스 확인
pnpm --filter @storige/example-pdf-upload-order verify

# 2) 실제 주문
cp .env.example .env      # 값 채우기
node --env-file=.env src/main.ts
```

## 자산 투입 — `fileId` 참조가 권장 경로다

| | fileId 참조(JSON) | 직접 업로드(멀티파트) |
|---|---|---|
| 상한 | **2GB** (presigned 업로드 표면) | 100MB |
| MIME | 제한 없음(업로드 표면 규칙 적용) | **PDF 만** — 이미지는 415 |
| `Idempotency-Key` | **자동 부여** | **자동 부여 없음** (아래) |

### 🚨 멀티파트에 멱등키가 자동 부여되지 않는 이유

서버 멱등 인터셉터는 `request_hash` 를 **본문(`req.body`)** 으로 만든다. 그런데 멀티파트
요청에서는 `req.body` 가 비어 있어 해시가 **상수**가 된다. 즉 같은 키로 다른 파일을 올리면
서버가 "같은 요청"으로 보고 **첫 번째 응답을 재생**한다 → 두 번째 파일은 조용히 사라진다.

SDK 는 이 구멍을 알기에 멀티파트에 키를 **자동 부여하지 않는다**. 대신 키를 명시하면
파일 바이트의 SHA-256 을 합성해 키를 **내용 주소화**한다(`키:sha256(파일)`) — 다른 파일이면
키도 달라지므로 함정이 사라진다. `src/order.ts` 의 `multipartOptions()` 가 그 처리다.

→ 가능하면 **fileId 참조**를 쓰라. 본문이 JSON 이라 서버 해시가 정상 작동하고, 2GB 까지 올릴 수 있다.

## 판형 미연결 도서 — `validationSkipped: true` 의 의미

`books.create` 에 `bookSpecUid` 를 주지 않으면(또는 `pageCount` 가 확정되지 않으면) 서버는
대조할 판형이 없어 **워커 구조 검증을 건너뛰고** 최종화한다. 그 결과는

- `BookFinalizationView.validationSkipped === true`
- 웹훅 `book.finalization.completed` payload 의 `validationSkipped === true`

로 표시된다. 이는 **미검증 FINALIZED** 라는 뜻이다 — 규격 오류(사이즈/페이지수/도련)가
걸러지지 않은 채 인쇄 공정으로 넘어갈 수 있으므로, 파트너가 자체 검수 게이트를 태워야 한다.
검증을 받고 싶다면 `bookSpecUid` 와 `pageCount` 를 **반드시** 함께 넘겨라(이 예제의 기본 동작).

## 실패 코드 대응표

분기는 **항상 `errorCode` 로** 한다. `message` 는 사람용이며 예고 없이 개선된다.

| 코드 | status | 언제 | 대응 |
|---|---|---|---|
| `ERR_PAGE_COUNT_OUT_OF_RANGE` | 422 | `pageMin/pageMax/pageIncrement` 위반 | 도서 생성 **전에** 판형 규칙으로 걸러라 |
| `ERR_FINALIZATION_IN_PROGRESS` | 409 | 최종화 진행 중 재착수 | 실패로 다루지 말 것 — `getFinalization` 으로 기존 attempt 에 합류 |
| `ERR_ASSETS_INCOMPLETE` | 422 | 표지/내지 누락 | 자산 보강 후 재착수 |
| `ERR_ASSET_ALREADY_EXISTS` | 409 | `POST` 인데 이미 있음 | 교체는 `replacePdfCover`(PUT) |
| `ERR_ASSET_NOT_FOUND` | 404 | `PUT` 인데 대상 없음 | 신규는 `uploadPdfCover`(POST) |
| `ERR_BOOK_NOT_DRAFT` | 409 | FINALIZED 도서에 자산 변경 | 새 도서를 만들어라 |
| `ERR_UNSUPPORTED_CONTENT_TYPE` | 415 | 멀티파트 비-PDF | fileId 참조 경로로 |
| `ERR_RATE_LIMITED` | 429 | 버킷 초과(heavy 100/min · general 300/min) | SDK 가 `Retry-After` 를 준수해 자동 재시도 |

최종화 **실패**는 예외가 아니라 **값**으로 온다: `waitForFinalization` 이
`status: 'FAILED'` 인 view 를 반환하며, `errorCode`/`errorDetail` 로 분기한다.

## 완료 대기 — 폴링보다 웹훅

정본 알림 경로는 웹훅(`book.finalization.completed` / `.failed`)이다. 폴링은 웹훅 유실·지연에
대비한 **백스톱**으로 쓰는 것이 맞다.

- `GET finalization` 은 general 버킷(300/min)이라 여유가 있지만, 다수 도서를 동시에 폴링하면
  리밋에 닿는다. 서버는 `X-RateLimit-*` 잔량 헤더를 주지 않아 **선제 회피가 불가능**하다.
- 웹훅 수신 서버는 [`examples/webhook-receiver`](../webhook-receiver) 참조.
- `.env` 의 `STORIGE_SKIP_POLLING=1` 로 두면 이 예제도 최종화 착수까지만 하고 빠진다.

## 최종 PDF 수령 — 스트림 분기

`GET /books/{uid}/pdf` 는 v1 에서 **유일하게 봉투가 없는** 라우트다. 성공하면 서버가
`application/pdf` 를 직접 파이프하고, 오류일 때만 JSON 봉투가 온다. SDK 가 `Content-Type` 으로
분기해 성공은 `RawStream`, 오류는 `StorigeApiError` 로 돌려준다.

```ts
const pdf = await client.books.downloadPdf(book.uid);
await pipeline(Readable.fromWeb(pdf.stream), createWriteStream(outPath));
```

`await res.arrayBuffer()` 처럼 전량 버퍼링하지 말 것 — 2GB 산출물에서 메모리가 터진다.
스트림 소비/해제 책임은 호출측에 있다.

## 파일

| 파일 | 역할 |
|---|---|
| `src/env.ts` | 환경변수 파싱·검증 **단일 지점**. `process.env.X!` 안티패턴 금지 |
| `src/order.ts` | 주문 흐름 전체(①~⑦). 여기만 읽으면 통합이 끝난다 |
| `src/main.ts` | env → 클라이언트 → 흐름 실행 → PDF 저장 + 에러 3종 분류 |
| `src/verify.ts` | 오프라인 드라이런(mock fetch) — 위 A~D 단언 |
