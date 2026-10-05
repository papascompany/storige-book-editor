# [공지] 2026-10-05 배포 — 합성 입력 오류 즉시 실패 · 합성 실패 응답 `errorCode`·안내 문구 · 보정 결과 `outputFileId` 유지

- 수신: bookmoa · printy
- 발송 상태: 미발송(배포 전 사전 통지)
- 배포: 배포 시각(UTC)은 별도로 알려 드립니다. 이 공지에 회신(ACK)을 받은 뒤 배포합니다.
- **적용 시점**: §1·§2 는 Storige 가 **worker 배포 완료를 통지한 시각**부터입니다. §3(서버)은 같은 배포 중에 반영되며, 반영 시각을 완료 통지에 함께 적습니다. 배포가 진행되는 동안(완료 통지 전)에도 새 동작이 나타날 수 있습니다.
- 문서: `docs/CONTRACT_FREEZE.md` v1.11 · `docs/PLATFORM_INTEGRATION_GUIDE.md`(2.2 단계 5a). 문서는 배포를 시작할 때 공개되며, 내용은 위 적용 시점부터 유효합니다.
- 편집기: `/embed` 회원 세션 생성이 서버 오류로 실패할 때의 처리가 바뀝니다(가이드 3.3). 이벤트명·code·`message`·`fatal`·발신 횟수는 같고 귀사 코드 변경은 필요 없습니다. 편집기는 배포를 시작할 때 반영되며, 완료 통지에 1줄로 알려 드립니다.
- 100p: 합성을 쓰지 않아 이번 변경의 영향이 없습니다(완료 통지에 1줄로 알려 드립니다).

## 0. 요약

| # | 변경 | 대상 | 파트너 코드 변경 |
|---|---|---|---|
| 1 | 합성 입력 오류는 재시도 없이 첫 시도에 `FAILED` | bookmoa · printy | 필요 없음 |
| 2 | 합성 `FAILED` 응답에 `errorCode` 추가, `errorMessage` 는 안내 문구, `errorDetail` 은 정해진 상세 값만 | bookmoa · printy | 필요 없음(예상) — 고객 화면 표시 여부 회신 요청 |
| 3 | 페이지수·도련 보정 작업의 `outputFileId` 는 처음 기록된 값 유지(정보) | bookmoa · printy | 필요 없음 |

- 라우트·메서드·인증 방식·요청 형식·이벤트명·웹훅 본문 형식·응답 필드 구성·`editor.error` code 집합은 바뀌지 않습니다.
- 이번 배포의 그 밖의 서버 내부 변경은 파트너 동작에 영향이 없습니다.

## 1. 합성 입력 오류 즉시 실패 — bookmoa · printy

- **대상**: `POST /worker-jobs/synthesize/external`(양사의 합성 호출)과 `compose-mixed`, 펼침면(스프레드) 책 합성입니다. 분리 합성(`split-synthesize/external` 등)은 지금과 같습니다.
- **바로 실패(재시도 없음)**: 아래 입력 오류는 다시 시도해도 결과가 같으므로 첫 시도에 `status:'FAILED'` 가 됩니다.

| 경우 | `errorCode` |
|---|---|
| 입력 PDF 를 열 수 없음(손상·열기 암호 등, PDF 가 아닌 파일 포함) | `PDF_LOAD_FAILED` |
| 입력 파일이 없음 | `FILE_NOT_FOUND`(파일 저장 방식에 따라 아래 `4xx` 행으로 기록될 수 있음) |
| 입력 주소를 쓸 수 없음 | `INPUT_URL_REJECTED` |
| 입력 주소(URL)나 입력 파일 조회가 `408`·`425`·`429` 를 뺀 `4xx` 로 응답(지금도 바로 실패) | `SYNTHESIS_FAILED`(`errorDetail.httpStatus` 에 응답 상태 코드) |

- **재시도(지금과 같음)**: 입력을 받는 중 연결이 끊긴 경우, 응답이 없거나 `408`·`425`·`429`·`5xx` 로 응답한 경우, 처리 도구의 일시 오류처럼 다시 시도하면 결과가 달라질 수 있는 실패는 2026-10-03 공지(`PARTNER_NOTICE_WAVE3_2026-10-03.md`) §3 과 같이 최대 3회까지 처리합니다(대기 30초, 그다음 90초).
- **웹훅**: 바로 실패한 작업도 `synthesis.failed` 를 1회 보냅니다. 본문 형식은 같고, 본문에는 지금처럼 `errorCode` 가 없습니다(`errorMessage` 는 §2 의 안내 문구).
- **시간**: 위 입력 오류는 지금까지 재시도 대기(30초+90초)를 거쳐 `FAILED` 가 됐지만, 배포 뒤에는 첫 시도에서 `FAILED` 가 됩니다. 앞선 합성 작업이 있으면 그 처리 시간만큼은 지금처럼 더 걸립니다.
- **귀사 영향**: 양사 합성 폴링 상한(120초) 안에 `FAILED` 를 받는 경우가 늘어납니다. 지금까지 상한을 넘겨 '합성 중'으로 남던 입력 오류 항목이 폴링 안에서 실패로 확정됩니다. 같은 입력으로 다시 합성해도 같은 실패이므로, 입력 파일을 바로잡은 뒤 다시 합성(새 jobId)하시면 됩니다.

## 2. 합성 `FAILED` 응답 값 — bookmoa · printy

작업 조회(`GET /worker-jobs/external/:id`)의 `FAILED` 응답 값이 아래처럼 바뀝니다. 대상은 `synthesize/external`·`compose-mixed`·펼침면 책 합성과, `test` 환경 키로 만든 합성 작업(합성 방식과 관계없이)입니다.

| 필드 | 지금 | 배포 뒤 |
|---|---|---|
| `errorCode` | `null`(펼침면 책 합성 제외) | 워커 오류 코드(§1 의 `PDF_LOAD_FAILED`·`FILE_NOT_FOUND`·`INPUT_URL_REJECTED` 등). 그 밖의 실패는 `SYNTHESIS_FAILED` |
| `errorMessage` | 처리 오류 원문 | `errorCode` 에 대응하는 안내 문구(아래 표). 일부 문구는 쪽수·치수 등 입력 값을 포함합니다 |
| `errorDetail` | 경로마다 다름 | `input`(`cover`·`content`·`endpaper`·`spread`)·`phase`·`httpStatus`·`target`·`expected`·`got`·`index` 중 해당하는 키의 값(문자열·수·불리언·`null`)만. 담을 값이 없으면 `null` |

양사 합성(`synthesize/external`)에서 받을 수 있는 주요 값입니다.

| `errorCode` | `errorMessage` |
|---|---|
| `PDF_LOAD_FAILED` | `PDF 로드 실패 (암호화/손상/지원불가)` |
| `FILE_NOT_FOUND` | `파일을 찾을 수 없습니다` |
| `INPUT_URL_REJECTED` | `입력 파일 주소를 사용할 수 없습니다` |
| `SYNTHESIS_FAILED` | `합성 처리 중 오류가 발생했습니다` |

- `errorCode` 는 값이 추가될 수 있는 문자열입니다(ADDITIVE). 모르는 값은 일반 실패로 처리하세요.
- `errorMessage` 는 사람이 읽는 문구라 바뀔 수 있습니다. 처리 분기는 `errorCode` 로 하세요.
- `synthesis.failed` 웹훅 본문의 `errorMessage` 도 위 안내 문구입니다. 본문에는 지금처럼 `errorCode` 가 없으므로, 코드가 필요하면 폴링 라우트로 작업을 조회하세요.
- **바뀌지 않음**:
  - `JOB_STALLED`·`JOB_TIMEOUT_SWEPT` 로 기록되는 `FAILED`(2026-10-03 공지의 시스템 실패 두 코드와 늦은 완료 반영 규칙 포함)
  - 분리 합성(`split-synthesize/external` 등, `test` 환경 키 작업 제외)의 `FAILED` 값
  - 이미 `FAILED` 로 기록된 작업의 값(배포 진행 중에 `FAILED` 가 된 작업은 새 값일 수 있습니다)
- **귀사 영향**: 양사 연동은 `errorMessage` 로 분기하지 않고, `errorCode` 는 `JOB_STALLED`·`JOB_TIMEOUT_SWEPT` 두 값과만 비교하는 것으로 알고 있습니다. 이 경우 두 값의 의미는 그대로이므로 코드 변경은 필요 없을 것으로 봅니다. 다르게 쓰고 계시면 회신에 적어 주세요.
- 고객 화면에 `errorMessage` 를 그대로 보여 주고 계시면, 고객에게 보이는 문구가 처리 오류 원문에서 위 안내 문구로 바뀝니다. §4 에서 표시 여부를 여쭙니다.

## 3. 페이지수·도련 보정 결과 `outputFileId` 유지(정보) — bookmoa · printy

- 페이지수 보정(`fix-pagecount`, `/external` 포함)과 도련 보정(`fix-bleed`) 작업의 `outputFileId` 는 처음 기록된 값으로 유지됩니다. 같은 작업의 완료가 다시 보고되어도 바뀌지 않습니다.
- 2026-10-03 공지 §1 의 작업 상태 고정(종결 뒤 처음 기록된 값 유지)과 같은 원칙이며, 정상 흐름에서는 지금과 같습니다.
- **귀사 영향**: 없습니다.

## 4. 요청

- 수신 확인(ACK)을 부탁드립니다. 회신을 받은 뒤 배포합니다.
- **고객 화면에 합성 `errorMessage` 를 그대로 표시하시는지** 회신 부탁드립니다(표시한다면 어느 화면인지). §2 의 문구 변경이 고객에게 보이는지 확인하려는 것입니다.
- `errorCode` 를 `JOB_STALLED`·`JOB_TIMEOUT_SWEPT` 비교 외에 쓰고 계시면 함께 알려 주세요.
- 귀사 코드 변경은 필요 없을 것으로 봅니다.
- 배포 시각(UTC)과 worker 배포 완료 시각은 따로 알려 드립니다.

## 5. 되돌릴 경우

- 배포 뒤 이번 변경을 되돌리면 되돌린 시각과 범위를 바로 통지하고, 문서(`CONTRACT_FREEZE.md`·연동 가이드)도 함께 원래대로 돌립니다.
- 되돌리기 전에 이미 `FAILED` 로 기록된 작업의 `errorCode`·`errorMessage`·`errorDetail` 은 그대로 남습니다.
