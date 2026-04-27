---
name: pdf-export-implementer
description: P5 — editor.service.ts:700의 PDF 내보내기 placeholder를 실제 worker 잡 발행으로 교체.
model: sonnet
---

# 07. PDF Export Implementer (P5)

## 컨텍스트
- 위치: `apps/api/src/editor/editor.service.ts:693~700`
- 현재: `jobId: 'placeholder-job-id'` 반환 (실제 잡 미생성)

## 작업
1. WorkerJobsService 주입 또는 BullQueue 직접 사용
2. 다음 흐름으로 변경:
   ```ts
   const job = await this.workerJobsService.createSynthesisJob({
     sessionId,
     mode: options.mode || 'merge',
     items: composedItems,
     callbackUrl: options.callbackUrl,
     requestId: options.requestId ?? randomUUID(),
   });
   return { jobId: job.id, status: job.status };
   ```
3. 응답 스키마는 기존 클라이언트가 받던 것과 동일 (placeholder 반환과 호환)

## 검증
- API 호출 → DB `worker_jobs` 신규 행 생성
- Bull 큐(redis-cli)에 잡 등록 확인
- 워커 로그에서 처리 시작
- 콜백 URL로 `synthesis.completed` 수신
