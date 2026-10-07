# [공지] 재편집 템플릿셋 결정 변경 · 완료 이벤트 `templateSetId` 추가 (FREEZE v1.16)

- 수신: bookmoa · printy(회신(ACK) 요청) / ShareSnap · MD2Books(통지, 재편집 URL 구성 확인 요청) / 100p Books(참고 — 편집기를 쓰지 않아 영향 없음)
- 작성: 2026-10-06(UTC)
- 발송 상태: 미발송(배포 전 사전 통지). printy 에는 연락 창구가 다시 열린 뒤 보냅니다.
- 배포: 편집기(`/embed`)만 배포합니다. 서버(api·worker)·DB 변경은 없습니다. IIFE 번들(`window.StorigeEditor`)은 이번 배포에 포함되지 않습니다(§6). 배포 시각(UTC)은 따로 알려 드립니다. bookmoa·printy 의 회신(ACK)을 받은 뒤 배포합니다.
- **적용 시점**: Storige 가 **편집기 배포 완료를 통지한 시각**부터입니다. 배포가 진행되는 동안(완료 통지 전)에 연 편집기는 새 동작일 수 있고, 이미 열려 있던 편집기 화면은 새로고침 전까지 이전 동작입니다.
- 문서: `docs/CONTRACT_FREEZE.md` v1.16(재편집 템플릿셋 결정·`editor.ready` `templateSetId` 값 MODIFY-TARGET, 나머지 키 ADDITIVE) · `docs/PLATFORM_INTEGRATION_GUIDE.md`(3.1 재편집과 템플릿셋 · 3.2 `editor.ready`·`editor.complete`·레거시 dual-emit). 문서는 배포를 시작할 때 공개되며, 내용은 위 적용 시점부터 유효합니다.
- **기존 공지 대체**: 이 공지는 `PARTNER_NOTICE_STORYBOOK_WRAP_2026-10-06` §3 의 '재편집(`sessionId`) 주의'(`/embed` 는 URL·props 의 `templateSetId` 를 세션에 기록된 값보다 먼저 씀)를 대체합니다. `CONTRACT_FREEZE.md` v1.13 의 같은 문구도 v1.16 으로 대체됩니다. 위 적용 시점부터는 재편집 URL 에 상품 매핑의 새 템플릿셋 id 를 함께 보내도 기존 세션은 그 세션을 만든 세트로 열립니다.

## 0. 요약

| # | 변경 | 대상 | 파트너 코드 변경 |
|---|---|---|---|
| 1 | 재편집(`sessionId`)은 세션에 기록된 템플릿셋으로 엽니다. URL `templateSetId` 가 달라도 세션 세트가 우선합니다 | 임베드 호스트 전체 | 필요 없음(재편집 URL 에 `templateSetId` 생략 권장) |
| 2 | `editor.ready`·`storige:ready` 의 `templateSetId` 는 실제로 연 세트입니다. 보낸 값과 세션 세트가 다르면 `templateSetMismatch` 가 함께 실립니다 | 임베드 호스트 전체 | 필요 없음 |
| 3 | `editor.complete`·`storige:completed` 에 `templateSetId`(이번 편집을 앉힌 세트)와 `templateSetMismatch` 가 추가됩니다 | 임베드 호스트 전체 | 필요 없음 |
| 4 | 편집 중인 디자인에서는 AI 패널로 템플릿셋을 바꾸지 않고 '새로 편집' 안내를 표시합니다 | AI 패널이 표시되는 편집기 | 필요 없음 |

- 엔벨로프(`source:'storige-editor'`, `version:'1'`), 이벤트명, `editor.error` code·`fatal`, 이벤트 발신 순서(레거시 먼저), URL 파라미터, 신규 편집과 '새로 편집하기'는 바뀌지 않습니다.
- bookmoa·printy 의 현행 재편집 경로(`sessionId` 만 보냄)에서는 열리는 세트, `editor.ready` 값, 오류 처리, 완료 저장값이 바뀌지 않습니다(§3).

## 1. 재편집(`sessionId` 로 열기)

- 세션을 만든 템플릿셋(세션 세트)으로 엽니다. 편집 결과의 검증·합성도 세션 세트를 기준으로 합니다.
- 재편집 URL 의 `templateSetId` 는 **생략을 권장**합니다. 보낸 값이 세션 세트와 다르면 세션 세트로 열고, `editor.ready`·`storige:ready` 에 아래가 함께 실립니다.

```json
{ "templateSetId": "207c458f-…", "templateSetMismatch": { "requested": "9e768d01-…", "session": "207c458f-…", "resolution": "session" } }
```

- 세션 세트가 삭제되어 조회가 HTTP 404 이고 세션 세트와 다른 `templateSetId` 를 보냈다면, 지금처럼 보낸 세트로 엽니다. 이때 `templateSetId` 는 보낸 세트이고 `templateSetMismatch` 는 `resolution:'requested'`, `reason:'SESSION_SET_UNAVAILABLE'` 입니다. 보낸 세트도 열 수 없으면 지금과 같은 초기화 실패 code 로 1회 보냅니다(`TEMPLATE_SET_NOT_FOUND` 의 `templateSetId` = 보낸 세트).
- 세션 세트 조회가 404 가 아닌 이유(네트워크·타임아웃·서버 오류, 404 가 아닌 4xx, 응답 형식 오류)로 실패하면 다른 세트로 시도하지 않고 초기화 실패 code 로 1회 보냅니다(`TEMPLATE_SET_NOT_FOUND` 의 `templateSetId` = 세션 세트). 이 경우 종전에는 보낸 세트로 열렸습니다.
- `templateSetId` 를 생략했거나 세션 세트와 같은 값을 보낸 재편집은 지금과 같습니다. 세션 세트를 열 수 없으면 지금처럼 오류로 끝납니다.
- `orderSeqno`·`mode` 진입에서 주문의 기존 세션을 열 때도 같은 규칙(세션 세트 우선)입니다.
- **템플릿셋을 바꾸려면 `sessionId` 없이 새로 편집**하세요. 재편집 세션의 템플릿셋을 바꾸는 파라미터는 없습니다.

## 2. `editor.ready`·`storige:ready`

- `templateSetId` 는 편집기가 실제로 연 세트입니다. 보낸 값(또는 세션에서 도출한 값)과 세션 세트가 같으면 지금과 같은 값입니다.
- `templateSetMismatch {requested, session, resolution:'session'|'requested', reason?:'SESSION_SET_UNAVAILABLE'}` 는 보낸 `templateSetId` 와 세션 세트가 모두 있고 다를 때만 실립니다(추가 키, 무시해도 됩니다).
- 레거시 `storige:ready` 는 `{templateSetId, sessionId, templateSetMismatch?}` 이며 값은 `editor.ready` 와 같습니다.
- 변경 이력 복원 뒤에는 지금처럼 `editor.ready` 를 다시 보내지 않습니다.

## 3. 완료 이벤트 `editor.complete`·`storige:completed`

- `templateSetId` 가 추가됩니다. 값은 이번 편집을 앉힌 세트입니다(재편집은 세션 세트, 위 404 경우만 보낸 세트, 신규 편집은 연 세트).
- `templateSetMismatch` 는 `editor.ready` 와 같은 값으로, 불일치가 있을 때만 실립니다.
- 두 키는 회원 완료와 게스트 완료(`needsAuth:true`) 모두에 실리고, 레거시 `storige:completed` 에도 같은 값으로 실립니다. 레거시가 정식 이벤트보다 먼저 오므로 완료 저장에 템플릿셋을 쓰면 레거시 값을 읽어도 됩니다.
- 기존 키, `files` 중첩, `pages`, `status` 리터럴은 바뀌지 않습니다.
- **귀사 영향(bookmoa·printy)**: 현행 재편집 경로(`sessionId` 만 보냄)에서는 이 값이 `editor.ready` 의 `templateSetId` 와 같습니다. 완료 저장에 payload `templateSetId` 를 먼저 써도 저장 결과는 바뀌지 않습니다.

## 4. 편집기 AI 패널 — 편집 중 템플릿셋 전환 차단

- 편집기에 AI 패널이 표시되는 경우에 해당합니다.
- 편집 중인 디자인에서는 AI 패널에서 다른 템플릿셋을 고르거나 생성해도 세트를 바꾸지 않고, 아래 안내를 표시합니다.
  - '편집 중인 디자인은 다른 템플릿셋으로 바꿀 수 없습니다. 새로 편집해 주세요.'
  - 편집 중인 디자인: `sessionId` 로 연 재편집, `orderSeqno` 진입으로 주문의 회원 세션을 열거나 새로 만든 편집
- `sessionId` 없이 `templateSetId` 로 연 편집 등 그 밖의 신규 편집은 지금처럼 고른 세트로 다시 엽니다.
- 다른 세트로 편집하려면 호스트 화면의 '새로 편집하기'(`sessionId` 없는 새 편집)로 안내해 주세요.

## 5. 바뀌지 않는 것

- 엔벨로프 `source`·`version`(`'1'`), 이벤트명, 발신 순서
- `TEMPLATE_SET_NOT_FOUND`·`SESSION_NOT_FOUND`·`NETWORK_ERROR`·`AUTH_EXPIRED` 의 code·`fatal`·발신 횟수
- 신규 편집과 '새로 편집하기', URL 파라미터
- 서버 API·웹훅·작업 응답

## 6. IIFE 번들(`window.StorigeEditor`)

- 이번 배포에 포함되지 않습니다. 배포된 IIFE 번들은 지금 동작 그대로입니다.
- 이 변경이 들어간 번들로 다시 빌드·배포할 때 §1 의 규칙이 적용되고, `onReady` 콜백에 선택 인자 `{templateSetId, templateSetMismatch?}`, `onComplete` 결과에 `templateSetId`·`templateSetMismatch` 가 실립니다. 그 시점은 따로 알려 드립니다.

## 7. 요청

- **bookmoa**: 수신 확인(ACK)을 부탁드립니다. 회신을 받은 뒤 배포합니다.
  - 재편집 URL 에 `templateSetId` 를 함께 보내는 경로가 없는지 다시 확인해 주세요.
  - 레거시 `storige:completed` 에서도 payload `templateSetId` 를 먼저 읽는지 확인해 주세요.
  - bookmoa-mobile 저장소가 따로 있다면, 그쪽도 모르는 키를 무시하는지 확인해 주세요.
- **printy**: 수신 확인(ACK)을 부탁드립니다. 회신을 받은 뒤 배포합니다.
  - payload `templateSetId` 를 완료 저장에 쓰기 시작해도, 현행 재편집 경로에서는 `editor.ready` 값과 같아 저장 결과가 바뀌지 않는지 확인해 주세요.
  - 엔벨로프 `version` 은 `'1'` 그대로입니다.
- **ShareSnap**: 재편집 URL 에 `sessionId` 와 `templateSetId` 를 함께 보내는지, 보낸다면 그 값이 세션을 만든 세트인지 알려 주세요. `TEMPLATE_SET_NOT_FOUND` 를 받았을 때의 처리도 알려 주세요.
- **MD2Books**: 재편집 URL 에 `templateSetId` 를 함께 싣는지 알려 주세요.
- 세션 세트와 다른 `templateSetId` 를 일부러 보내고 있다면 배포 전에 알려 주세요. 위 적용 시점부터 그 재편집은 세션 세트로 열립니다.

## 8. 되돌릴 경우

- 배포 뒤 이번 변경을 되돌리면 되돌린 시각과 범위를 바로 통지하고, 문서(`CONTRACT_FREEZE.md`·연동 가이드)도 함께 원래대로 돌립니다.
- 되돌리면 재편집은 지금처럼 URL·props 의 `templateSetId` 를 먼저 쓰고, `editor.ready`·`storige:ready` 의 `templateSetId` 는 보낸 값(또는 세션에서 도출한 값)으로 돌아갑니다. 추가된 키(`templateSetMismatch`, 완료 이벤트의 `templateSetId`)는 실리지 않습니다. 키가 없는 상태는 지금과 같습니다.
