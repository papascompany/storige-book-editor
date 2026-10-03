# [공지] 2026-10-03 배포 — 작업 상태 고정 · 합성 자동 재시도 · 편집기 상태 응답 쪽수 · 편집기 안내 문구 · 작업 편집 세션 id

- 수신: bookmoa · printy
- 발송 상태: 미발송(배포 전 사전 통지)
- 배포: 예정일 2026-10-03. 배포 시각(UTC)은 별도로 알려 드립니다. 서버(api·worker)와 편집기는 배포 시각이 다를 수 있습니다.
- 문서: `docs/CONTRACT_FREEZE.md` v1.10 · `docs/PLATFORM_INTEGRATION_GUIDE.md`

## 0. 요약

| # | 변경 | 대상 | 파트너 코드 변경 |
|---|---|---|---|
| 1 | 작업 상태 고정(종결 뒤 상태 불변, 시스템 실패 두 코드만 늦은 완료 반영) | bookmoa · printy | 필요 없음 |
| 2 | 같은 작업의 같은 종결 웹훅은 앞선 발신이 성공했으면 다시 보내지 않음 | bookmoa · printy | 필요 없음 |
| 3 | 합성 작업 자동 재시도(최대 3회 처리), 입력 오류는 바로 실패 | bookmoa · printy | 필요 없음 |
| 4 | 편집기 `editor.state` 에 `pageCount`·`currentPage` 추가 | bookmoa · printy | 필요 없음 |
| 5 | 편집기 화면·`message` 고정 문구 추가분 | bookmoa · printy | 필요 없음 |
| 6 | 작업 응답 `editSessionId` 값, 웹훅 본문 `sessionId` | bookmoa · printy | 필요 없음 |

- 라우트·메서드·인증 방식·이벤트명·웹훅 본문 형식·`editor.error` code 집합은 바뀌지 않습니다. 더해지는 값과 필드는 아래 각 절에 적었습니다.
- 10-03 회신 내용 기준으로 양사 모두 조치할 것이 없습니다. 지금 연동 흐름을 그대로 유지해 주세요.

## 1. 작업 상태 고정 — bookmoa · printy

- 작업 조회(`GET /worker-jobs/external/:id`)의 `status` 가 `COMPLETED`·`FIXABLE`·`FAILED` 가 되면 그 뒤로 바뀌지 않습니다. 합성·검증 작업 모두 같습니다.
- 같은 종결 상태가 다시 보고되어도 처음 기록된 값(`errorCode`·`errorMessage`·`completedAt` 등)이 유지됩니다.
- **시스템 실패의 늦은 완료**: `errorCode` 가 `JOB_STALLED`(처리 중 반복 중단) 또는 `JOB_TIMEOUT_SWEPT`(생성 후 2시간 안에 끝나지 않음)인 `FAILED` 작업이 나중에 처리를 마치면 `status:'COMPLETED'` 가 됩니다.
  - 이때 `errorCode`·`errorMessage`·`errorDetail` 은 비워지고, 웹훅을 받는 작업이면 `synthesis.completed`(검증 작업은 `validation.completed`)를 보냅니다.
  - 검증 작업이 늦게 `FIXABLE` 로 끝나면 `FAILED` 그대로입니다.
  - 그 밖의 `FAILED`(처리 오류로 기록된 실패)는 바뀌지 않습니다.
  - Wave 2 공지(`PARTNER_NOTICE_WAVE2_2026-10-03.md`) §4 의 '이미 끝난 작업(`COMPLETED`·`FAILED` 등)은 바뀌지 않습니다'에서 이 경우만 예외입니다.
  - v1 도서 최종화를 쓰는 경우, 이미 실패로 끝난 최종화는 그대로입니다.
- **귀사 영향**: 양사 연동은 `COMPLETED`·`FAILED` 에서 폴링을 멈추고 항목 상태를 고정하며, 웹훅 수신부는 저장하지 않습니다(10-03 회신). 따라서 늦은 `COMPLETED` 는 귀사 주문에 반영되지 않고, 이 경우 지금처럼 재합성(새 jobId)으로 복구합니다. 현 흐름을 유지하시길 권합니다.
- 시스템 실패를 따로 구분하려면 `errorCode` 두 값(`JOB_STALLED`·`JOB_TIMEOUT_SWEPT`)으로 하시면 됩니다.

## 2. 같은 종결 웹훅의 재발신 — bookmoa · printy

- 같은 작업의 같은 종결 이벤트(`synthesis.completed`·`synthesis.failed`·`validation.*`)는 앞선 발신이 성공했거나 아직 진행 중이면 다시 보내지 않습니다.
- 앞선 발신이 실패했으면 같은 종결 상태가 다시 보고될 때 다시 보냅니다.
- 본문 형식과 서명 방식은 같습니다. 수신 처리는 같은 jobId·이벤트를 다시 받아도 같은 결과가 되도록 두시면 됩니다. 양사는 웹훅을 저장하지 않으므로(10-03 회신) 영향이 없습니다.

## 3. 합성 작업 자동 재시도 — bookmoa · printy

- **대상**: 합성 작업 전체입니다. `POST /worker-jobs/synthesize/external`(양사의 합성 호출), `compose-mixed`, 분리 합성 등 합성 대기열에서 처리하는 작업과 v1 도서 최종화 안의 합성 작업이 모두 해당합니다.
- **재시도**: 일시 오류로 실패하면 최대 3회까지 처리합니다(재시도 최대 2회). 다시 시도하기 전 대기는 30초, 그다음 90초입니다.
  - 일시 오류: 입력 파일 받기·조회의 연결 실패·시간 초과·서버 오류(5xx·408·425·429), 그 밖의 처리 중 오류.
  - 재시도 중에는 `status` 가 `PROCESSING` 이고 웹훅을 보내지 않습니다.
  - 다시 시도해 성공하면 `COMPLETED`·`synthesis.completed` 입니다.
  - 마지막 시도까지 실패하면 `status:'FAILED'` 로 기록하고 `synthesis.failed` 를 1회 보냅니다.
- **바로 실패(재시도 없음)**
  - 입력 오류: 입력을 바꾸지 않으면 결과가 같은 실패입니다. 예: `synthesize` 합성의 입력 파일 받기가 4xx(408·425·429 제외, 예: 404)로 거절된 경우, 쪽수 불일치·쪽 구분 값 오류·편집기 산출물과 세션 불일치 같은 입력 검사 실패.
  - 처리 중 반복 중단(`JOB_STALLED`): 남은 시도와 관계없이 그 시점에 `FAILED` 입니다.
- **시간**: 재시도로 끝나는 합성은 결과가 나오기까지 대기(30초+90초)와 재처리 시간이 더해집니다. 합성은 한 번에 1건씩 처리하므로 앞선 합성 작업이 있으면 그만큼 더 걸릴 수 있습니다.
- **귀사 영향**: 결과가 양사 합성 폴링 상한(120초)을 넘기면 항목은 합성 중으로 남고, 「상태 확인」(1회 조회)으로 결과를 받게 됩니다. 10-03 회신에서 정상 동작으로 확인해 주셨습니다.
- 응답 필드와 웹훅 본문 형식은 같습니다.
- v1 도서 최종화를 쓰는 경우: 최종화 안의 합성 작업도 같은 규칙이므로, 합성이 최종 실패하기까지 걸리는 시간만큼 최종화의 실패 전이도 늦어집니다.

## 4. 편집기 `editor.state` 쪽수 필드 — bookmoa · printy

- `getState` 명령의 응답 `editor.state` 에 선택 필드 `pageCount`·`currentPage` 가 더해집니다. 기존 필드(`requestId`·`ready`·`dirty`·`sessionId`)와 이벤트명은 같습니다.
  - `pageCount`: 물리 쪽수입니다. 회원 세션의 `editor.complete`·`editor.pricingChange` 와 같은 산식입니다.
  - `currentPage`: 1부터 센 현재 편집 화면 순번입니다. 펼침면 세트는 펼침면 단위이고, 표지+내지 세트는 1 이 표지입니다. `pageCount` 와 단위가 다르므로 `currentPage / pageCount` 로 진행률을 계산하지 마세요.
- 두 필드는 편집기 초기화가 끝난 뒤(`editor.ready` 이후)에만 실립니다. 초기화 중이나 변경 이력 복원 중에는 없고, 현재 편집 화면을 알 수 없으면 `currentPage` 만 없습니다. 선택 필드로 처리하세요.
- **귀사 영향**: 양사는 `getState` 응답에서 `dirty` 만 쓰므로(10-03 회신) 영향이 없습니다.
- IIFE 인스턴스 `getState()` 를 쓰는 경우 `currentPage`·`totalPages`(= `pageCount`)가 실제 값이 됩니다(초기화 전·변경 이력 복원 중에는 둘 다 0, 현재 화면을 알 수 없으면 `currentPage` 만 0). IIFE 번들 반영 시점은 따로 알려 드립니다.

## 5. 편집기 고정 안내 문구 추가분 — bookmoa · printy

2026-10-03 Wave 2 공지(`PARTNER_NOTICE_WAVE2_2026-10-03.md`) §1 의 고정 문구에 아래가 더해집니다. 보내는 이벤트·code·`fatal` 은 같습니다.

| 경우 | 화면 문구 · `message` |
|---|---|
| `sessionId` 단독 진입의 세션 조회 실패(Wave 2 공지 §1-2) | 화면에 호스트로 보낸 `message` 와 같은 문구가 표시됩니다 |
| 세션 조회는 됐지만 세션에 템플릿셋이 없음 | 화면: 이 상품의 편집 정보를 찾을 수 없습니다. 이전 화면으로 돌아가 다시 열거나, 계속되면 고객센터에 문의해 주세요. (이벤트는 보내지 않습니다 — 지금과 같음) |
| 편집기 초기화 중 세션 조회가 인증 만료(401) | 화면: 인증이 만료되었습니다. 페이지를 새로고침해주세요. (`AUTH_EXPIRED` 는 지금과 같이 1회) |
| 편집기 안 '저장된 작업 불러오기' 실패(드묾) | `editor.error {code:'INVALID_DATA', message:'작업을 불러오는데 실패했습니다.', fatal:false}`, 레거시 `storige:error` 도 같은 `message` |

- 문구는 바뀔 수 있으니 처리 분기는 `code` 로 하세요.

## 6. 작업 응답 `editSessionId` · 웹훅 본문 `sessionId` — bookmoa · printy

- 배포 이후 생성되는 작업은 생성 요청에 실은 편집 세션 id(합성·검증 등은 `editSessionId`, 분리 합성 계열은 `sessionId`)를 작업에 기록합니다.
- 작업 조회(`GET /worker-jobs/external/:id`) 응답의 `editSessionId` 에 그 값이 실립니다. 세션 id 를 싣지 않았거나 해당 세션이 없으면 `null` 입니다. 배포 전에 만든 작업은 지금과 같습니다.
- 세션이 기록된 작업의 `synthesis.*`·`validation.*` 웹훅 본문에 `sessionId`(작업의 편집 세션 id)가 실립니다. 세션이 기록되지 않은 작업은 키가 없습니다.
- 편집 세션 이벤트(`session.*`)는 지금과 같이 보내지 않습니다.
- 값과 필드가 더해지는 변경(ADDITIVE)이며 모르는 필드는 무시하면 됩니다.
- **귀사 영향**: 양사는 작업 응답의 `editSessionId` 와 웹훅 본문의 `sessionId` 를 쓰지 않으므로(10-03 회신) 영향이 없습니다.

## 7. 요청

- 수신 확인(ACK)을 부탁드립니다.
- 귀사 코드 변경은 필요 없습니다.
- 배포 시각(UTC)은 따로 알려 드립니다.
