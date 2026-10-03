# [공지] 2026-10-03 배포 — 편집기 오류 안내 · 합성 내지 산출 크기 · 운영자 감사 기록 · 작업 실패 코드 · 대용량 업로드 사이트 귀속

- 수신: bookmoa · printy · 100p Books
- 발송 상태: 미발송(배포 전 사전 통지)
- 배포: 예정일 2026-10-03. 배포 시각(UTC)은 별도로 알려 드립니다. 서버(api·worker)와 편집기는 배포 시각이 다를 수 있습니다.
- 문서: `docs/CONTRACT_FREEZE.md` v1.9 · `docs/PLATFORM_INTEGRATION_GUIDE.md` · `docs/PDF_VALIDATION_GUIDE.md`

## 0. 요약

| # | 변경 | 대상 | 파트너 코드 변경 |
|---|---|---|---|
| 1 | 편집기 `editor.error` 의 code·문구 정리(`sessionId` 단독 진입의 세션 조회 실패 알림 포함), 비회원 편집완료 안내 | bookmoa · printy | 필요 없음 |
| 2 | 합성 산출 내지 크기(재단선 영역을 포함한 내지) | bookmoa · printy | 필요 없음 |
| 3 | 운영자 대리 편집 감사 기록에 인증 단계 거부 요청 행 추가 | 운영자 권한을 쓰는 파트너 | 필요 없음 |
| 4 | 작업 실패 코드 `JOB_STALLED` 추가 | 공통 | 필요 없음 |
| 5 | 대용량 업로드 완료(`complete`)의 `X-API-Key` 사이트 귀속 | 100p Books | 필요 없음 |

- 라우트·메서드·인증 방식·이벤트명·웹훅 본문 형식은 바뀌지 않습니다. 더해지는 값과 필드는 아래 각 절에 적었습니다.
- 100p Books 는 편집기와 합성을 쓰지 않으므로 §1·§2 는 해당이 없습니다.

## 1. 편집기 오류 안내 정리 — bookmoa · printy

`editor.error` 의 이벤트명, code 6종(`AUTH_EXPIRED`·`NETWORK_ERROR`·`SAVE_FAILED`·`INVALID_DATA`·`SESSION_NOT_FOUND`·`TEMPLATE_SET_NOT_FOUND`), payload 형식은 같습니다. 아래 경우의 code 와 `message` 문구가 정리됩니다.

### 1-1. `orderSeqno` 진입(`sessionId` 없음)

- 주문번호로 세션을 찾는 조회가 연결 실패·타임아웃·서버 오류(5xx·408·429)로 실패하면, **새 세션을 만들지 않고** `editor.error {code:'NETWORK_ERROR', fatal:true}` 를 보냅니다. 첫 진입과 같은 화면 재진입(같은 `orderSeqno`) 모두 같습니다.
- 조회가 인증 만료(401)면 `AUTH_EXPIRED` 1회로 멈추고 새 세션을 만들지 않습니다.
- 그 밖의 조회 거절(4xx)은 세션이 없는 것으로 보고 새 세션을 만듭니다(지금과 같음).
- 회원 세션 생성이 `400`(`MEMBER_REQUIRED` 또는 code 없음)이나 `403 PERMISSION_DENIED` 로 거절되면 비회원 세션을 만듭니다(지금과 같음). 생성이 연결·서버 오류면 `NETWORK_ERROR`, 401 이면 `AUTH_EXPIRED` 1회, 그 밖의 거절이면 `INVALID_DATA` 로 멈춥니다. 모두 `fatal:true` 이며 새 세션을 만들지 않습니다.

### 1-2. `sessionId` 진입(`templateSetId` 없음)

- `templateSetId` 없이 `sessionId` 만으로 열면 편집기가 세션을 조회해 템플릿셋을 찾습니다. 이 조회가 실패하면 아래 code 를 1회 보냅니다. 모두 `fatal:true` 입니다.
  - 연결 실패·타임아웃·서버 오류(5xx·408·429) → `NETWORK_ERROR`
  - 인증 만료(401) → `AUTH_EXPIRED`
  - 세션 없음·권한 없음·잘못된 id → 지금과 같이 `SESSION_NOT_FOUND`
  - 그 밖의 실패 → `INVALID_DATA`
- 레거시 `storige:error` 도 같은 `message` 로 1회 보냅니다. `editor.error` 는 `parentOrigin` 을 지정한 경우에 보냅니다.
- `templateSetId` 를 함께 보내면 이 조회를 하지 않으므로 해당하지 않습니다.

### 1-3. 템플릿셋 조회·로드

- 일시 오류(연결 실패·타임아웃·5xx·408·429)는 `{code:'NETWORK_ERROR', message, fatal:true}` 입니다(`templateSetId` 필드 없음).
- 템플릿셋이 없거나 요청이 거절되거나 데이터 형식이 맞지 않으면 지금과 같이 `{code:'TEMPLATE_SET_NOT_FOUND', message, templateSetId, fatal:true}` 입니다.
- 화면과 `message` 문구에는 `templateSetId` 와 서버 원문이 들어가지 않습니다. payload 의 `templateSetId` 필드는 그대로 실립니다.

### 1-4. 인증 만료 `AUTH_EXPIRED`

- 편집기 초기화(재초기화 포함) 한 번에 최대 1회 보냅니다. 초기화 중 여러 요청이 함께 401 이어도 1건입니다.

### 1-5. 초기화 실패와 `SAVE_FAILED` 의 `message` 는 고정 한국어 문구

- 편집기 초기화 실패(세션 조회·생성, 템플릿셋 조회·로드)와 `SAVE_FAILED` 의 `message`(레거시 `storige:error` 포함)는 고객에게 그대로 보여 줄 수 있는 고정 한국어 문구입니다. 서버 원문과 식별자는 넣지 않습니다.
- 문구는 바뀔 수 있으니 처리 분기는 `code` 로 하세요.
- 주요 문구(초기화 실패·`SAVE_FAILED`):

| code | 경우 | `message` |
|---|---|---|
| `NETWORK_ERROR` | 연결 실패·타임아웃(초기화·템플릿셋) | 편집 작업을 불러오지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요. |
| `NETWORK_ERROR` | 서버 오류 5xx·408·429(초기화·템플릿셋) | 일시적인 서버 오류로 편집 작업을 불러오지 못했습니다. 잠시 후 다시 시도해주세요. |
| `INVALID_DATA` | 세션 생성 거절, `sessionId` 진입의 세션 조회 거절(1-2 의 그 밖의 4xx) | 편집 작업을 시작할 수 없습니다. 이전 화면으로 돌아가 다시 열어 주세요. |
| `TEMPLATE_SET_NOT_FOUND` | 템플릿셋 없음·거절 | 이 상품의 편집 정보를 찾을 수 없습니다. 이전 화면으로 돌아가 다시 열거나, 계속되면 고객센터에 문의해 주세요. |
| `AUTH_EXPIRED` | 인증 만료 | 인증이 만료되었습니다. 페이지를 새로고침해주세요. |
| `SAVE_FAILED` | 저장·완료 실패 | 원인별 고정 문구(예: 저장하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해주세요.) |

### 1-6. 비회원 편집완료 안내

- 비회원 세션에서 편집완료를 누르면 편집기 안에 "작업이 저장되었습니다. 로그인하면 이어서 주문할 수 있어요." 안내가 뜹니다.
- 호스트로 가는 이벤트(`editor.complete` `needsAuth:true` → `editor.needAuth`)는 같습니다.

## 2. 합성 산출 내지 크기 — bookmoa · printy

- **대상**: `editSessionId` 를 실은 `POST /worker-jobs/synthesize/external` 합성입니다. 양사의 합성 호출은 모두 여기에 해당합니다. 편집기 안의 내지 PDF 첨부 빈 페이지 채움과 `compose-mixed` 자동조립(`assembleFromSession:true`)도 같은 규칙을 따릅니다.
- **규칙**: 내지 PDF 에 명시된 재단 박스(TrimBox)가 그 세션 템플릿셋의 재단 크기(가로×세로, ±1mm)와 맞고, 페이지가 재단선·여백 영역까지 포함해 그보다 크면, 합성 산출 내지 페이지를 **재단 + 템플릿셋 도련×2** 크기로 맞춥니다. TrimBox 를 사방 같은 폭으로 넓힌 영역이 남습니다.
- **예시**(도련 3mm):

| 재단(템플릿셋) | 합성 산출 내지 |
|---|---|
| 210×297 | 216×303 |
| 210×210 | 216×216 |
| 297×210 | 303×216 |

- **그대로인 경우**
  - 편집기 산출 내지는 산출이 바뀌지 않습니다(재단선 영역이 없는 재단 크기, 또는 이미 작업사이즈).
  - TrimBox 가 없는 파일, 이미 작업사이즈(±1mm)인 파일, 작업사이즈 영역이 페이지 안에 들어가지 않는 파일.
  - 표지·면지.
  - `editSessionId` 없는 합성, `compose-mixed` 에 파일을 직접 넘기는 호출, 내지 펼침면 템플릿셋.
- 원본 파일은 그대로 보존됩니다(다운로드하면 원본).
- 요청·웹훅 형식은 같습니다. 잡 조회 응답의 `options` 에 추적용 `contentTrim`(재단·도련 값) 키가 더해질 수 있으며, 무시해도 됩니다.
- 양사 모두 산출 크기에 따른 후속 처리가 없다고 회신(10-03)하셨으므로 조치할 것이 없습니다.

## 3. 운영자 대리 편집 감사 기록 — 운영자 권한을 쓰는 파트너

- 운영자 대리 편집 권한(가이드 §3.3.2)을 쓰는 경우에만 해당합니다.
- 감사 조회(`GET /auth/partner-operator-session/audit`) 결과에, 운영자 토큰 요청 가운데 인증 단계에서 거부된 요청도 `action:'request'` 행으로 남습니다.
  - 허용되지 않은 기능 호출: `statusCode: 403`, `detail.errorCode: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED'`
  - 취소·만료 등으로 무효가 된 권한의 요청: `statusCode: 401`, `detail.errorCode: 'PARTNER_OPERATOR_GRANT_INVALID'`
- 행 형식, 조회 범위(자기 사이트·파트너가 발급한 권한), 해당 요청의 응답은 같습니다.
- 액세스 토큰이 만료됐거나 형식이 맞지 않아 운영자 권한을 확인할 수 없는 요청, 요청 한도 초과(429)로 거절된 요청, 토큰 갱신 실패는 기록 대상이 아닙니다.

## 4. 작업 실패 코드 `JOB_STALLED` — 공통

- 워커 처리 중 작업이 반복해서 중단되면(한 번은 자동으로 다시 처리합니다) 작업을 `status:'FAILED'`, `errorCode:'JOB_STALLED'` 로 기록합니다. `errorMessage` 는 "워커 처리 중 작업이 반복해서 중단되어 실패로 기록했습니다. 필요하면 같은 요청으로 새 작업을 만들어 주세요." 입니다.
- 확인은 잡 조회(`GET /worker-jobs/external/:id`)의 `status`·`errorCode` 로 하세요. `synthesis.failed`·`validation.failed` 웹훅 본문에는 `errorCode` 필드가 없습니다(지금과 같음).
- 대응: 같은 요청으로 새 작업을 만드세요. 다른 실패 코드와 같은 방식으로 처리하면 됩니다.
- 이미 끝난 작업(`COMPLETED`·`FAILED` 등)은 바뀌지 않습니다. 합성 결과가 이미 만들어진 작업은 `FAILED` 대신 `COMPLETED` 로 보고됩니다.
- `errorCode` 에 값 하나가 더해지는 변경입니다(ADDITIVE). 모르는 값은 일반 실패로 처리하세요.
- 참고: 생성 후 2시간 안에 끝나지 않은 작업은 지금과 같이 `errorCode:'JOB_TIMEOUT_SWEPT'` 로 기록됩니다.
- 100p Books: 10-03 회신하신 검증 작업 조회 방식(`GET /worker-jobs/external/:id`)에서는 달라지는 점이 없습니다.
- v1 도서 최종화를 쓰는 경우: 최종화의 검증·합성 작업이 이 코드로 실패하면 최종화도 `status:'FAILED'`, `errorCode:'ERR_PDF_VALIDATION_FAILED'` 로 끝납니다. 같은 최종화 요청을 다시 보내면 새로 진행합니다(가이드 1.7).

## 5. 대용량 업로드 완료의 사이트 귀속 — 100p Books

- **변경**: `POST /files/:id/complete`(및 `POST /files/multipart/complete`)에 실어 보내시는 `X-API-Key` 가 활성 사이트 키면, 배포 이후 새로 완료되는 파일이 귀사 사이트로 귀속됩니다. 편집기 키와 워커 키 모두 같은 귀사 사이트로 처리됩니다.
- **같은 사이트 키**(편집기 키·워커 키)로 하는 `GET /files/:id/download/external`·`POST /worker-jobs/validate/external`·`DELETE /files/:id/external` 은 지금과 같습니다.
- **다른 사이트의 키**로 이 파일을 다운로드·삭제하면 `404 FILE_NOT_FOUND` 입니다. 사이트가 기록된 파일에 지금도 적용되는 사이트 구분 응답이며, 새로 생기는 검사가 아닙니다.
- **바뀌지 않는 것**: 응답 형식·상태 코드·경로, 보관기간(영구), 배포 전에 완료된 파일. 이미 완료된 파일은 `complete` 를 다시 호출해도 귀속이 바뀌지 않습니다. 키가 없거나 무효여도 업로드 완료는 실패하지 않습니다.
- bookmoa · printy: `Authorization`(shop-session)으로 완료하는 브라우저 직결 업로드는 지금과 같습니다. 토큰과 사이트 키를 함께 보내면 두 사이트가 같을 때만 귀속합니다.

## 6. 요청

- 수신 확인(ACK)을 부탁드립니다.
- 100p Books: §5 는 귀사 ACK 를 받은 뒤 배포합니다. 업로드 완료·다운로드·검증·삭제에 쓰시는 키가 모두 귀사 사이트 키(편집기 키·워커 키)인지 확인 부탁드립니다(10-03 회신 기준으로는 그렇습니다).
- 배포 시각(UTC)은 따로 알려 드립니다.
