# quickstart — 임베드 편집 주문 (`creationType: 'EDITOR_SESSION'`)

파트너 사이트가 Storige 편집기를 `iframe` 으로 띄우고, 고객이 편집을 끝내면 그 **세션을
도서로 승격**해 주문을 만드는 흐름이다. PDF 를 파트너가 준비하지 않는다는 점에서
[`pdf-upload-order`](../pdf-upload-order) 와 정반대다.

```
                        ┌ 🔒 세션 게이트 (파트너 로그인 자리)
브라우저 ─GET /api/config┘ ─▶ 요청자 몫의 embedUrl(회원 JWT 포함)
   │
   └ iframe ─▶ /embed?templateSetId=…&parentOrigin=…&token=…
   ▲                    │
   │  postMessage 엔벨로프 v1 (editor.ready … editor.complete)
   ▼
호스트 페이지 ──POST /api/promote { sessionId }──▶ 호스트 서버
                                                     │ 🔒 파트너 키
                                                     ▼
                                books.create({ creationType:'EDITOR_SESSION', sessionId })
                                            → books.startFinalization()
```

## 무엇을 증명하는가

`src/verify.ts` 는 서버·브라우저 없이 다음을 단언한다(`pnpm verify`).

| | 내용 |
|---|---|
| A | **postMessage 게이트** — 브라우저가 실제로 실행하는 모듈(`public/editor-events.js`)을 그대로 import 해서, 위조 오리진 4종(접미 일치·스킴 다름 포함)·다른 프레임·레거시 `storige:*` dual-emit·미래 version 이 전부 차단됨을 확인. **`expectedSource` 를 빠뜨리면 통과가 아니라 예외**(fail-closed)인 것까지 |
| A' | **게스트 완료 분기** — `editor.complete`(`needsAuth:true`) 에서 승격을 **시도조차 하지 않고** 로그인 유도로 빠지는지 |
| B | **승격 시퀀스** — `POST /books` → `POST /books/{uid}/finalization` 2콜뿐이고(자산 투입 라우트가 없다), 본문이 `{creationType:'EDITOR_SESSION', sessionId}` 이며 `Idempotency-Key` 가 자동 부여됨 |
| B' | **판형 전달** — `bookSpecUid`/`pageCount` 가 실제로 본문에 실려 미검증 FINALIZED(D-9)를 피하는지 |
| C | **거부 분기** — 404 존재 은닉 / 409 `SESSION_NOT_COMPLETE` / 409 진행 중 합류 |

> ⚠️ **라이브 스모크는 아직 돌리지 않았다.** 위는 전부 오프라인 단언(주입식 fetch +
> 브라우저 없는 모듈 호출)이다. 실제 iframe 로드·CSP `frame-ancestors`·실 편집기의
> postMessage 발신은 **파트너 환경에서 직접 확인**해야 한다.
>
> 브라우저 거동을 직접 재현하려면 서버를 띄운 뒤 개발자 콘솔에서 아래를 실행하라 —
> 화이트리스트 밖 오리진의 잘 만들어진 봉투가 무시되는 것을 눈으로 볼 수 있다.
>
> ```js
> // 호스트 오리진(= 화이트리스트 밖)에서 보낸, 형식은 완벽한 봉투.
> // ①origin 불일치 + ②source 불일치 로 두 번 걸린다 →
> // 로그에 아무것도 찍히지 않고 /api/promote 도 나가지 않는다.
> window.postMessage({ source:'storige-editor', version:'1',
>   event:'editor.complete', payload:{ sessionId:'sess_forged' } }, location.origin);
> ```

## 전제

- Node **≥ 22.18** (빌드 없이 `.ts` 실행 — Node 내장 타입 스트리핑)
- 파트너 API 키(**test 키 권장**) + 편집기 배포 오리진 + 템플릿셋 id
- 호스트 오리진이 편집기 CSP `frame-ancestors` 에 등록돼 있어야 iframe 이 뜬다
  (미등록 도메인은 브라우저가 프레임을 차단한다 — 등록 요청은 운영에 문의)

## `@storige/sdk` 참조 방식

SDK 는 아직 **npm 미배포**(`private: true`)라 모노레포 내부에서 `workspace:*` 로 참조한다.
배포 후에는 `npm i @storige/sdk` 로 바꾸면 되고 **코드는 그대로**다(오너 결정 D-10b 대기).

## 실행

```bash
pnpm --filter @storige/sdk build                              # 0) SDK 빌드
pnpm --filter @storige/example-editor-session-order verify     # 1) 오프라인 검증
cp .env.example .env && node --env-file=.env src/server.ts     # 2) 호스트 서버 기동
# → 콘솔에 찍힌 **1회용 로그인 URL**(http://localhost:4001/#demo=…)로 접속한다.
#   그냥 http://localhost:4001 로 열면 /api/config 가 401 이다 — 의도된 동작이다(③ 참조).
```

---

## ① iframe 을 띄울 때 — `parentOrigin` 이 없으면 아무 이벤트도 오지 않는다

편집기는 `parentOrigin` 파라미터가 **있을 때만** 정식 엔벨로프를 발신하고, `targetOrigin`
으로 그 값을 그대로 쓴다(`'*'` 를 절대 쓰지 않는다). 넘기지 않으면 편집기는 "콜백 마운트
모드"로 간주해 postMessage 를 아예 보내지 않는다.

```
/embed?templateSetId=<셋 id>&parentOrigin=https://내-호스트&token=<회원 JWT>&orderSeqno=<주문번호>
/embed?sessionId=<세션 id>&parentOrigin=…&token=…      ← 재편집(templateSetId 는 세션에서 도출)
```

파라미터는 camelCase / snake_case 양쪽 다 받는다. URL 조립은 `src/env.ts` 참조.

## ② 이벤트를 받을 때 — 4단 게이트를 **전부** 통과시켜라

`window.addEventListener('message')` 는 **어떤 오리진의 어떤 프레임/탭에서 보낸 메시지도**
받는다. 검증 없이 `event.data.payload.sessionId` 를 서버로 넘기면 공격자가 임의 sessionId 를
주입할 수 있다.

```js
// public/editor-events.js — parseEditorMessage()
① event.origin 이 화이트리스트에 **정확히 일치**   ← endsWith/includes 금지
② event.source === iframe.contentWindow            ← 같은 오리진의 다른 프레임 차단
③ data.source === 'storige-editor' && data.version === '1'
④ typeof data.event === 'string'
```

①에서 `origin.endsWith('.example.com')` 같은 접미 일치를 쓰면 `evil-example.com` 이 뚫린다.
②를 빼면 편집기 오리진에 열린 다른 프레임이 메시지를 밀어 넣을 수 있다. `verify.ts` 가 이
두 우회를 실제로 시도해 막히는 것을 확인한다.

### ②는 인자를 빼먹어도 꺼지지 않는다 (fail-closed)

`expectedSource` 는 **필수 인자**다. 빠뜨리면 `parseEditorMessage` 가 `TypeError` 를 던진다 —
게이트가 조용히 사라지지 않는다. 타입(JSDoc)에서도 막히므로 `tsc` 단계에서 먼저 걸린다.

```js
parseEditorMessage(event, { allowedOrigins })                       // ❌ throw
parseEditorMessage(event, { allowedOrigins, expectedSource: iframe.contentWindow }) // ✅
parseEditorMessage(event, { allowedOrigins, expectedSource: 'skip-source-check' })  // ⚠️ 명시적 우회
```

건너뛰려면 `SKIP_SOURCE_CHECK`(`'skip-source-check'`) 리터럴을 **손으로 적어야** 한다.
정당한 용도는 window 개념이 없는 환경(Node 검증)뿐이고, 코드 리뷰에서
`grep skip-source-check` 한 번으로 우회 지점이 전부 드러난다.

### 발신 이벤트 9종

`editor.ready` · `editor.save` · `editor.complete` · `editor.cancel` · `editor.error` ·
`editor.needAuth` · `editor.state` · `editor.saved` (동결 8종)
\+ `editor.pricingChange` (ADDITIVE, opt-in — 가격 설정이 있는 템플릿셋 + 회원 세션만)

카탈로그는 **additive 로만** 자란다. 모르는 이벤트에서 크래시하지 말고 **무시**하라
(이 예제의 `switch` 는 `default` 에서 로그만 남긴다).

> **호스트 → 편집기 명령은 이 예제 범위 밖이다.** 동결 계약 문서에 수신 명령 목록이
> 없으므로 여기서는 **발신 이벤트 수신만** 다룬다. 명령 전송이 필요하면 계약 확정 후
> 별도로 문의하라 — 확정되지 않은 형태를 예제로 굳히지 않는다.

### 레거시 `storige:*` 는 듣지 않는다

편집기는 하위호환을 위해 `{ type: 'storige:completed', payload }` 형태를 **함께** 발신하고,
`parentOrigin` 이 없으면 그것만 `targetOrigin: '*'` 로 뿌린다. 신규 연동은 정식 엔벨로프만
들어야 한다 — 위 게이트 ③이 자연히 걸러낸다(`source` 필드가 없다).

## ③ 승격은 **서버측**에서 — 파트너 키를 브라우저에 내리지 마라

이 예제가 정적 페이지 + 작은 서버로 나뉜 이유가 그것이다.

| | 브라우저 | 호스트 서버 |
|---|---|---|
| 가진 것 | 편집기 URL · 허용 오리진 · **자기 회원 JWT** | **파트너 API 키** |
| 하는 일 | 편집기 띄우기 · 이벤트 검증 · sessionId 전달 | 세션 인증 · `books.create` · `startFinalization` |

`src/env.ts` 가 env 를 `server`(비밀)/`browser`(공개)로 나눠 담아 경계를 코드에 박아 뒀다.
키가 프런트로 새면 그 키를 얻은 누구나 테넌트 전체의 도서를 만들고 읽을 수 있다.

### 🔒 `/api/config` 는 **무인증이면 안 된다** — 토큰 자판기가 된다

`/api/config` 가 주는 embed URL 에는 **회원 JWT(`token`)** 가 실린다. 무인증으로 열어 두면
그 URL 을 아는 누구나 세션 토큰을 받아 간다. 데모 토큰일 때는 무해해 보이지만, 파트너는
이 모양을 복사한 뒤 **정적 토큰만 로그인 사용자 토큰으로 갈아끼운다** — 그 순간 무인증
엔드포인트가 임의 요청자에게 남의 세션 토큰을 발급하게 된다.

그래서 이 예제는 세 가지를 구조로 박아 뒀다.

1. **토큰은 `env.browser` 에 없다.** 공개 버킷에는 오리진 2종뿐이고, embed URL 조립
   (`buildEmbedUrl(token)`)은 서버가 **요청자가 정해진 뒤에** 한다.
2. **`/api/config` · `/api/promote` 둘 다 세션 게이트 뒤.** 없으면 `401 AUTH_REQUIRED`.
3. **토큰은 `resolveEditorTokenFor(user)` 로 요청자 기준 발급.** 데모는 회원이 1명뿐이라
   env 의 정적 토큰을 돌려주지만, 시그니처가 `user` 를 받으므로 파트너가 갈아끼울 자리가
   코드에 남아 있다.

> ⚠️ **데모 로그인(`POST /api/session`)은 인증이 아니다.** 부팅 시 콘솔에 찍힌 1회용
> nonce 를 대조할 뿐이다(= 서버를 직접 띄운 사람인가). 무인증 로그인 엔드포인트를 열어
> 두면 게이트가 장식이 되므로 **일부러** 닫아 뒀다 — 생략은 fail-closed 여야 한다.
> 파트너는 `src/host-session.ts` 의 `resolve()` 를 자기 세션 미들웨어로 **통째로**
> 교체하라. 그 파일이 이 예제에서 유일하게 "그대로 쓰면 안 되는" 파일이다.

> ⚠️ 데모 서버의 `/api/promote` 는 세션 인증까지만 하고 **세션 소유 검증은 생략**했다.
> 운영에서는 "로그인한 사용자(`user.id`)의 주문에 실제로 묶인 sessionId 인가"를 반드시
> 확인하라 — 서버는 테넌트(site) 경계까지만 지키므로, 같은 사이트의 다른 고객 세션은
> 이 엔드포인트가 막지 않으면 승격된다.

> 🔒 호스트 페이지는 embedUrl 을 화면 로그에 남길 때 `token` 을 `<redacted>` 로
> **마스킹**한다(`maskUrl()`). 스크린샷·고객센터 첨부로 새는 것이 실제 유출 경로다.

## ④ 승격이 거부되는 경우

| 코드 | status | 원인 |
|---|---|---|
| `ERR_NOT_FOUND` | 404 | 세션 없음 **/ 다른 테넌트 세션 / NULL-site(게스트) 세션** |
| `ERR_SESSION_NOT_PROMOTABLE` | 409 | `SESSION_NOT_COMPLETE`(편집 미완료) · `SESSION_OUTPUT_MISSING`(합성 산출 없음) · `SESSION_OUTPUT_UNAVAILABLE` |
| `ERR_VALIDATION_FAILED` | 400 | `sessionId` 누락 |

404 가 세 경우를 **한 코드로 뭉뚱그리는 것은 의도적**이다 — 존재 은닉(IDOR 방지). 파트너는
"남의 세션인지 없는 세션인지" 구분할 수 없다.

**가장 흔한 실수는 게스트 세션이다.** `token` 없이 편집기를 띄우면 세션에 소유 사이트가
남지 않아(NULL-site) 어떤 테넌트도 승격할 수 없다.

### 🚨 분기 근거는 `editor.needAuth` 가 아니라 `editor.complete.needsAuth` 다

편집기는 게스트 완료 시 **두 이벤트를 이 순서로** 보낸다.

```
① editor.complete  { sessionId, needsAuth: true, guestToken, … }   ← 먼저
② editor.needAuth  { guestToken, reason: 'complete_save' }          ← 나중(하위호환)
```

`editor.needAuth` 를 기다렸다 분기하면 **이미 늦다** — ①에서 무조건 승격을 때리면 그 사이
`404 SESSION_NOT_FOUND` 를 맞고 사용자에게는 "승격 실패"만 보인다. 반드시 complete
payload 의 `needsAuth` 로 먼저 분기하라.

```js
const done = readCompletePayload(payload);
switch (decideCompleteAction(done)) {          // public/editor-events.js
  case 'require-login': /* 로그인 유도 — 승격 시도 안 함 */ break;
  case 'promote':       /* POST /api/promote */ break;
  case 'ignore':        /* sessionId 없음 */ break;
}
```

`readCompletePayload` 는 `guestToken` 이 있는데 `needsAuth` 가 빠진 형태도 게스트로
판정한다(fail-closed). 게스트 토큰 **값 자체는 돌려주지 않는다**(유무만) — 세션 자격증명이라
로그·DOM 으로 새면 그 세션을 남이 이어 편집할 수 있다.

로그인시킨 뒤에는 `/embed?sessionId=<그 세션>&token=<회원 JWT>` 로 다시 열어 회원 세션으로
완료시키면 그대로 승격된다(작업물은 보존된다).

## ⑤ 승격 이후

승격된 도서는 세션 산출 PDF 가 `pdf_contents` 자산으로 **자동 연결**된 DRAFT 다 —
PDF_UPLOAD 와 달리 수동 자산 투입이 없다. 이후는 동일하다:

- 완료 통지: 웹훅 `book.finalization.completed` / `.failed` → [`examples/webhook-receiver`](../webhook-receiver)
- 최종 PDF: `GET /books/{uid}/pdf` (스트림) → `pdf-upload-order` 의 ⑦ 참조

### 🖨️ `bookSpecUid` 를 안 넘기면 인쇄 검증이 통째로 생략된다 (D-9)

대조 판형이 없으면 서버는 워커 구조 검증을 **건너뛰고** 최종화하고 웹훅에
`validationSkipped: true` 를 실어 준다. 그 도서는 재단·페이지수·여백이 한 번도 대조되지
않은 **미검증 FINALIZED** 이며, 그대로 발주하면 인쇄 사고가 그대로 나간다.

각주로만 두면 그대로 복붙되므로 코드에 박아 뒀다.

```ts
promoteSession(client, {
  sessionId,
  partnerRef,
  bookSpecUid: env.server.bookSpecUid,   // ← STORIGE_BOOK_SPEC_UID
  // pageCount: 24,                      // ← 판형과 함께 넘겨야 페이지수까지 대조된다
});
// → result.willSkipValidation === true 면 자동 발주 금지, 수동 검수 게이트로
```

`PromoteResult.willSkipValidation` 은 승격 **시점에** 알려 준다 — 웹훅을 기다릴 필요가 없다.
생략이 정당한 경우는 판형 데이터가 아직 없는 개발 단계뿐이고, 그 상태로 발주하면 안 된다.

## 파일

| 파일 | 역할 |
|---|---|
| `public/index.html` | iframe 호스트 페이지 — 이벤트 수신·분기 + 토큰 마스킹 로그 |
| `public/editor-events.js` | 🔑 postMessage 4단 게이트(fail-closed) + 게스트 분기 판정. 브라우저와 검증이 **같은 파일**을 쓴다 |
| `src/env.ts` | env 파싱 단일 지점 + `server`(비밀)/`browser`(공개) 분리 |
| `src/host-session.ts` | 🔑 세션 게이트 — **파트너가 자기 로그인으로 교체할 유일한 파일** |
| `src/promote.ts` | 서버측 승격 — 404/409 분기 + 판형 게이트(D-9) |
| `src/server.ts` | express — 정적 서빙 + `/api/session` + 🔒`/api/config` + 🔒`/api/promote` |
| `src/verify.ts` | 오프라인 드라이런 — 위 A~C 단언 |
