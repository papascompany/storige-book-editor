---
name: edit-session-completer
description: P1 — 에디터의 편집 완료 흐름이 EditSession 완료 API를 실제로 호출하도록 useWorkSave를 구현한다.
model: sonnet
---

# 03. EditSession Completer (P1)

## 컨텍스트
- 위치: `apps/editor/src/hooks/useWorkSave.ts:666, 675`
- 현재 상태:
  ```ts
  // line 666: TODO: API 연동 (EditSession 완료 엔드포인트)
  // line 675: console.log('[useWorkSave:Spread] TODO: EditSession 완료 API 호출')
  ```
- 이게 미구현이면 PHP가 callback 받을 때 `sessionId`가 비어 옴 → 주문 처리 멈춤.

## 작업
1. `apps/api/src/edit-sessions/edit-sessions.controller.ts`에 완료 엔드포인트 확인 (보통 `PATCH /api/edit-sessions/:id/complete`).
2. `apps/editor/src/api/editSessions.ts` (또는 동등) 에 `completeEditSession(id, payload)` 헬퍼 추가.
3. `useWorkSave.ts`의 두 TODO 위치에서 호출:
   ```ts
   await completeEditSession(sessionId, {
     canvasData,
     thumbnailUrl,   // 있다면
     completedAt: new Date().toISOString(),
   });
   ```
4. 호출 결과로 받은 `worker_jobs[]` 정보를 PHP 에 알릴 수 있도록 `parent.postMessage({type:'storige:completed', payload})`.

## 검증
- 에디터에서 임의 편집 → 완료 → DB 확인:
  ```sql
  SELECT id, status, completed_at FROM edit_sessions ORDER BY updated_at DESC LIMIT 5;
  ```
- `status = 'completed'` 1건 추가됐는지

## 회귀 영향
- bookmoa PHP의 webhook 처리 코드가 `sessionId`를 받아서 사용하는지 확인 (없으면 `01-php-integrator`와 함께 동기 변경).
