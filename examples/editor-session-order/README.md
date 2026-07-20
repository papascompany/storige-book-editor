# quickstart — 임베드 편집 주문 (`creationType: 'EDITOR_SESSION'`)

파트너 사이트가 Storige 편집기를 `iframe` 으로 띄우고, 고객이 편집을 끝내면 그 **세션을
도서로 승격**해 주문을 만드는 흐름이다. PDF 를 파트너가 준비하지 않는다는 점에서
[`pdf-upload-order`](../pdf-upload-order) 와 정반대다.

```
브라우저 ─ iframe ─▶ /embed?templateSetId=…&parentOrigin=…&token=…
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
| A | **postMessage 게이트** — 브라우저가 실제로 실행하는 모듈(`public/editor-events.js`)을 그대로 import 해서, 위조 오리진 4종(접미 일치·스킴 다름 포함)·다른 프레임·레거시 `storige:*` dual-emit·미래 version 이 전부 차단됨을 확인 |
| B | **승격 시퀀스** — `POST /books` → `POST /books/{uid}/finalization` 2콜뿐이고(자산 투입 라우트가 없다), 본문이 `{creationType:'EDITOR_SESSION', sessionId}` 이며 `Idempotency-Key` 가 자동 부여됨 |
| C | **거부 분기** — 404 존재 은닉 / 409 `SESSION_NOT_COMPLETE` / 409 진행 중 합류 |

추가로 호스트 페이지는 실제 브라우저에서 확인했다: 화이트리스트 밖 오리진에서 온
잘 만들어진 `editor.complete` 봉투는 **아무 반응 없이 무시**되고 `/api/promote` 를 부르지 않는다.

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
# → http://localhost:4001 을 브라우저로 연다
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
| 가진 것 | 편집기 URL · 허용 오리진 · 회원 JWT | **파트너 API 키** |
| 하는 일 | 편집기 띄우기 · 이벤트 검증 · sessionId 전달 | `books.create` · `startFinalization` |

`GET /api/config` 는 `env.browser` 만 내려보낸다(`src/env.ts` 가 `server`/`browser` 로
나눠 담아 경계를 코드에 박아 뒀다). 키가 프런트로 새면 그 키를 얻은 누구나 테넌트 전체의
도서를 만들고 읽을 수 있다.

> ⚠️ 데모 서버의 `/api/promote` 는 **세션 소유 검증을 생략**했다. 운영에서는 "로그인한
> 사용자의 주문에 실제로 묶인 sessionId 인가"를 반드시 확인하라 — 서버는 테넌트(site)
> 경계까지만 지킨다.

## ④ 승격이 거부되는 경우

| 코드 | status | 원인 |
|---|---|---|
| `ERR_NOT_FOUND` | 404 | 세션 없음 **/ 다른 테넌트 세션 / NULL-site(게스트) 세션** |
| `ERR_SESSION_NOT_PROMOTABLE` | 409 | `SESSION_NOT_COMPLETE`(편집 미완료) · `SESSION_OUTPUT_MISSING`(합성 산출 없음) · `SESSION_OUTPUT_UNAVAILABLE` |
| `ERR_VALIDATION_FAILED` | 400 | `sessionId` 누락 |

404 가 세 경우를 **한 코드로 뭉뚱그리는 것은 의도적**이다 — 존재 은닉(IDOR 방지). 파트너는
"남의 세션인지 없는 세션인지" 구분할 수 없다.

**가장 흔한 실수는 게스트 세션이다.** `token` 없이 편집기를 띄우면 세션에 소유 사이트가
남지 않아(NULL-site) 어떤 테넌트도 승격할 수 없다. 편집기가 `editor.needAuth` 를 보내면
그 신호를 받아 로그인을 유도하라 — 이 예제의 호스트 페이지가 그렇게 한다.

## ⑤ 승격 이후

승격된 도서는 세션 산출 PDF 가 `pdf_contents` 자산으로 **자동 연결**된 DRAFT 다 —
PDF_UPLOAD 와 달리 수동 자산 투입이 없다. 이후는 동일하다:

- 완료 통지: 웹훅 `book.finalization.completed` / `.failed` → [`examples/webhook-receiver`](../webhook-receiver)
- 최종 PDF: `GET /books/{uid}/pdf` (스트림) → `pdf-upload-order` 의 ⑦ 참조
- `bookSpecUid` 를 함께 넘기지 않으면 `validationSkipped: true` 로 최종화된다(미검증 FINALIZED)

## 파일

| 파일 | 역할 |
|---|---|
| `public/index.html` | iframe 호스트 페이지 — 이벤트 수신·분기 |
| `public/editor-events.js` | 🔑 postMessage 4단 게이트. 브라우저와 검증이 **같은 파일**을 쓴다 |
| `src/env.ts` | env 파싱 단일 지점 + `server`(비밀)/`browser`(공개) 분리 |
| `src/promote.ts` | 서버측 승격 — 404/409 분기 |
| `src/server.ts` | express — 정적 서빙 + `/api/config` + `/api/promote` |
| `src/verify.ts` | 오프라인 드라이런 — 위 A~C 단언 |
