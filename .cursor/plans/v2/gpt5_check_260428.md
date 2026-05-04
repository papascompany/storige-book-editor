# GPT-5.5 개발 진행 점검 보고 (2026-04-28)

아래 내용은 현재 Storige 개발 진행 문서와 주요 코드 흐름을 읽고 점검한 결과입니다. Claude Code에서 이어서 확인할 때, 특히 Day 5 PHP staging 회귀 전에 실제 코드와 운영 환경에서 아래 항목을 검증해 주세요.

## 현재 기준 문서

- 최신 진행 기준은 `.cursor/plans/_RESUME_PROMPT.md`와 `.cursor/plans/v2/NEW_DEV_PLAN.md`입니다.
- 다만 두 문서 사이에도 시간차가 있습니다.
  - `_RESUME_PROMPT.md`: P1/P5 완료 후 Day 5 또는 P4 직전 상태.
  - `NEW_DEV_PLAN.md`: 작성 당시 기준이라 P1/P5/D4가 아직 미완료처럼 남아 있음.
- `00_MASTER_DEVELOPMENT_GUIDE.md`, `HANDOFF_GUIDE.md`, `WORKER_FLOW_전체정리.md`는 구조 이해에는 유용하지만 2026-04-16 기준 구버전 문맥이 섞여 있습니다.
- 새 세션에서는 `v2/`를 최신 기준으로 삼고, 루트 문서는 참고용으로만 보는 것이 안전합니다.

## 1. 가장 큰 리스크: 에디터 완료 PDF 업로드 ID

현재 `apps/editor/src/hooks/useWorkSave.ts`의 `completeSpreadWork`는 PDF를 `storageApi.uploadDesign()`으로 업로드한 뒤 반환된 `id`를 `coverFileId`, `contentFileId`로 저장합니다.

문제 가능성:

- `storageApi.uploadDesign()`은 `/storage/upload/designs`를 호출합니다.
- 이 경로는 파일을 storage에 저장하고 UUID를 반환하지만, `files` 테이블의 엔티티를 만드는 흐름이 아닌 것으로 보입니다.
- 이후 서버의 `EditSessionsService.createValidationJobs()`나 `EditorService.exportToPdf()`는 `filesService.findById()`로 `coverFileId`, `contentFileId`를 조회합니다.
- 따라서 저장된 ID가 실제 `files.id`가 아니면 검증 잡 생성이나 P5 export가 실패할 수 있습니다.

확인할 코드:

- `apps/editor/src/hooks/useWorkSave.ts`
- `apps/editor/src/api/storage.ts`
- `apps/editor/src/api/files.ts`
- `apps/api/src/storage/storage.controller.ts`
- `apps/api/src/files/files.controller.ts`
- `apps/api/src/files/files.service.ts`

확인 질문:

- `coverFileId`, `contentFileId`는 반드시 `files` 테이블의 ID여야 하는가?
- 그렇다면 `completeSpreadWork`는 `storageApi.uploadDesign()`이 아니라 `filesApi.upload()` 또는 이에 준하는 `/files/upload` 계열 API를 써야 하는가?
- 현재 운영 DB에서 완료된 세션의 `cover_file_id`, `content_file_id`가 `files.id`로 실제 조회되는가?

## 2. Synthesis/Conversion worker 상태 업데이트 경로

문서에서도 지적된 문제인데, 실제 코드상 `SynthesisProcessor`는 다음 경로로 상태를 업데이트합니다.

```ts
await axios.patch(
  `${this.apiBaseUrl}/worker-jobs/${jobId}/status`,
  payload,
  { headers: { 'X-API-Key': process.env.WORKER_API_KEY } },
);
```

하지만 API Key 인증이 붙은 공개 경로는 다음입니다.

```ts
@Patch('external/:id/status')
@Public()
@UseGuards(ApiKeyGuard)
```

문제 가능성:

- worker가 `X-API-Key`를 붙여도 `/worker-jobs/:id/status`는 전역 JWT guard 영향을 받을 수 있습니다.
- 이 경우 synthesis job은 큐에서 실행되어도 DB 상태 업데이트와 API 측 웹훅 전송이 실패할 수 있습니다.
- P5가 "잡 발행"까지는 완료되어도 end-to-end 완료로 보기 어렵습니다.

확인할 코드:

- `apps/worker/src/processors/synthesis.processor.ts`
- `apps/worker/src/processors/conversion.processor.ts`
- `apps/worker/src/processors/validation.processor.ts`
- `apps/api/src/worker-jobs/worker-jobs.controller.ts`

확인 질문:

- synthesis/conversion도 validation처럼 `/worker-jobs/external/:id/status`로 PATCH해야 하는가?
- 운영 로그에서 synthesis status PATCH가 200으로 성공한 증거가 있는가?
- `worker_jobs.status`가 실제로 `COMPLETED`까지 바뀌는가?

## 3. PHP webhook payload 계약 불일치 가능성

`NEW_DEV_PLAN.md`의 synthesis webhook 예시는 `sessionId`가 포함된 형태입니다.

```json
{
  "event": "synthesis.completed",
  "jobId": "yyy-yyy",
  "sessionId": "xxx-xxx",
  "mode": "merge",
  "outputFileUrl": "https://api.papascompany.co.kr/storage/outputs/.../merged.pdf",
  "timestamp": "..."
}
```

하지만 실제 `WorkerJobsService.sendSynthesisCallback()` payload는 주로 다음 형태로 보입니다.

- `event`
- `jobId`
- `orderId`
- `status`
- `outputFileUrl`
- `outputFiles`
- `outputFormat`
- `errorMessage`
- `timestamp`

문제 가능성:

- 실제 payload에 `sessionId`가 없으면 PHP가 문서 기준으로 주문/세션 매핑을 할 때 실패할 수 있습니다.
- `orderId`는 `orderSeqno`와 명칭이 다르므로 PHP 측 필드명과 맞춰야 합니다.
- `outputFileUrl`은 상대 URL일 수 있으므로 PHP가 API base URL을 붙이는지 확인해야 합니다.

확인할 코드:

- `apps/api/src/worker-jobs/worker-jobs.service.ts`
- `apps/api/src/webhook/webhook.service.ts`
- PHP 측 `webhook/storige.php` 또는 동등 핸들러

확인 질문:

- PHP webhook handler는 `sessionId`, `jobId`, `orderId/orderSeqno` 중 무엇으로 주문을 매핑하는가?
- synthesis callback payload에 `sessionId`를 추가해야 하는가?
- `outputFileUrl`, `outputFiles[].url`이 상대경로일 때 PHP가 절대 URL로 변환하는가?

## 4. Webhook 재시도 시 서명 누락 가능성

`WebhookService.sendCallback()`의 최초 요청은 `X-Storige-Signature`를 포함합니다.

하지만 catch 후 1회 재시도 요청에는 다음 헤더만 보입니다.

- `Content-Type`
- `X-Storige-Event`
- `X-Storige-Retry`

문제 가능성:

- PHP가 `X-Storige-Signature` 검증을 강제하면 최초 요청은 통과하지만 재시도 요청은 실패할 수 있습니다.

확인할 코드:

- `apps/api/src/webhook/webhook.service.ts`

확인 질문:

- retry 요청에도 `X-Storige-Signature`를 동일하게 붙여야 하는가?
- PHP handler가 retry 요청도 동일하게 검증하는가?

## 5. spread mode webhook 중복/비표준 전송 가능성

`SynthesisProcessor.handleSpreadSynthesis()`는 상태 업데이트 후 직접 `sendSpreadWebhook()`을 호출합니다.

동시에 API의 `WorkerJobsService.updateJobStatus()`는 synthesis job 완료/실패 시 `sendSynthesisCallback()`을 호출합니다.

문제 가능성:

- synthesis status PATCH 경로를 고치면 spread 완료 시 webhook이 중복 전송될 수 있습니다.
- worker 직접 `sendSpreadWebhook()`은 공통 `WebhookService`를 타지 않으므로 `X-Storige-Signature`, `timestamp`, 표준 payload가 빠질 수 있습니다.
- PHP handler가 표준 payload만 기대하면 spread webhook만 다르게 실패할 수 있습니다.

확인할 코드:

- `apps/worker/src/processors/synthesis.processor.ts`
- `apps/api/src/worker-jobs/worker-jobs.service.ts`
- `apps/api/src/webhook/webhook.service.ts`

확인 질문:

- webhook 전송 책임은 API `WebhookService` 하나로 통일해야 하는가?
- worker에서 직접 PHP callback을 보내는 코드는 제거하거나 표준화해야 하는가?
- spread mode 결과도 일반 synthesis callback payload와 동일한 계약으로 맞출 수 있는가?

## 6. P4 중철 imposition은 아직 미구현 상태

`apps/worker/src/services/pdf-synthesizer.service.ts`에서 `bindingType === 'saddle'`일 때 아직 TODO 상태로 보입니다.

현재 동작:

- `Saddle stitch ordering not yet implemented` 경고
- 일반 merge fallback

문제 가능성:

- 중철 주문을 운영에서 받으면 페이지 imposition이 맞지 않는 PDF가 생성될 수 있습니다.
- Day 5 PHP 회귀와 별개로, 운영 상품에서 중철 주문을 받을지 여부를 먼저 결정해야 합니다.

확인할 코드:

- `apps/worker/src/services/pdf-synthesizer.service.ts`
- `.cursor/plans/v2/agents/06-saddle-stitch-orderer.md`

확인 질문:

- 컷오버 직후 중철 주문을 받을 예정인가?
- 받는다면 Day 5 전에 P4를 먼저 구현/검증해야 하는가?
- 받지 않는다면 PHP/Admin 상품 옵션에서 중철 진입을 일시 차단할 수 있는가?

## 7. 문서 정리 필요

문서 간 기준이 섞여 있습니다.

정리 권장:

- `_RESUME_PROMPT.md`와 `v2/NEW_DEV_PLAN.md`를 최신 기준으로 동기화.
- `00_MASTER_DEVELOPMENT_GUIDE.md` 상단에 “현재 진행 기준은 `v2/NEW_DEV_PLAN.md`”라고 표시.
- `WORKER_FLOW_전체정리.md`의 worker PATCH 경로 경고가 아직 유효한지 확인 후 해결/미해결 상태 표시.
- `09-cutover-runbook.md`의 `_RESUME_PROMPT.md` 템플릿은 v2 시점 내용이라 현재 v5와 충돌합니다. 최신 템플릿으로 갱신 필요.

## Claude Code에 요청할 확인 순서

1. `completeSpreadWork`에서 저장하는 `coverFileId/contentFileId`가 실제 `files.id`인지 DB와 코드로 검증.
2. synthesis/conversion worker status PATCH가 운영에서 200 성공하는지 로그와 코드로 검증.
3. synthesis webhook 실제 payload를 PHP handler 기대값과 비교.
4. webhook retry에도 signature가 필요한지 확인하고 필요 시 수정.
5. spread webhook 중복/비표준 전송 가능성을 확인.
6. 중철 주문 운영 여부에 따라 P4를 Day 5 전 처리할지 결정.
7. 위 결과를 기준으로 `_RESUME_PROMPT.md`와 `v2/NEW_DEV_PLAN.md` 최신화.

## 결론

문서상 다음 단계는 Day 5 PHP staging 회귀가 맞지만, 위 1~3번은 회귀 테스트에서 바로 실패를 만들 수 있는 수준입니다. 특히 `storageApi.uploadDesign()`이 반환한 ID를 `files` 엔티티 ID처럼 쓰는 부분과 synthesis status PATCH 경로는 먼저 확인해야 합니다. 이 두 항목이 실제로 문제가 맞다면 P1/P5는 “잡 발행 코드 반영” 상태이지 “end-to-end 완료”로 보기 어렵습니다.
