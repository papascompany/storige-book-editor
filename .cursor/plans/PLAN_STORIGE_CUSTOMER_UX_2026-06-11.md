# [작업계획] 고객 UX 플로우 정비 — storige 세션 (2026-06-11)

> 4이슈 조사(서브에이전트 6, 적대검증 2건 통과) 결과 기반. bookmoa-mobile 측 지시문:
> `/Users/yohan/Documents/claude/bookmoa-mobile/docs/STORIGE_UX_HANDOFF_2026-06-11.md`
> 목표 플로우: 주문>옵션선택>편집기구동>저장>**마이페이지(장바구니) 또는 편집보관함(신설)**

## 확정 근본원인 요약

| 증상 | 근본원인 | 코드 |
|---|---|---|
| '테스트모드' 구동 | bookmoa 장바구니 더미행(`TPL-A4-HARD`)→404→**무음 샘플 폴백**. IDML 셋(a2cc2939)은 정상(라이브 검증) | embed.tsx:571-587, 659-676 |
| 텍스트 중앙 붕괴 | embed 책등 재계산→`repositionObjects` spine 분기가 **meta.anchor 무시**, `TextResizeStrategy`가 무조건 spine 중앙 반환→전 책등 텍스트 한 점 적층. + 출력 origin이 old layout(**stale origin**)→전 anchored 객체 Δspine/2 드리프트. + 변환기 center-x 단독 판정→전폭 배경이 'spine' 분류돼 축소 | SpineResizeStrategy.ts:96-112,175-199 / SpreadPlugin.ts:301,321-344 / toSpreadTemplate.mjs:134-142 |
| 불러오기 모달 누락 | `WorkspaceModal` `s.status !== 'complete'` 필터 — 고객 저장본은 전부 complete(편집완료) | WorkspaceModal.tsx:33-35 |
| 옵션 미표시/보관함 부재 | 옵션이 세션 metadata 미스냅샷 + 경량 목록 API 부재 + 재편집 게이트(`orderSeqno&&mode`) 함정 + `GET /edit-sessions?memberSeqno=` IDOR | embed.tsx:500,529-545 / edit-sessions.controller.ts:292-295 |

## 작업 항목 (서브에이전트 3병렬 — 파일 영역 분리)

### W-A. canvas-core + 변환기 (책등 재배치 무결성) — Agent A
1. `SpreadPlugin.repositionObjects` spine 분기: `meta.anchor.kind==='region'`이면 위치는
   `computeObjectReposition`(covers와 동일, anchor 보존) — 텍스트 적층 해소. anchor 없을 때만 현행 중앙 폴백.
2. 같은 함수 stale origin 분리: 출력 scene 변환은 `outOrigin = -newLayout.total/2` 사용
   (입력 bbox 변환은 old origin 유지) — ":352-356 'drift 0'" 주석 의도와 정합화. spine/cover 분기 모두.
3. 방어 가드: spine 분기에서 `br.width > oldSpine.width*1.5`(전폭 배경 오분류 기저장 데이터)면 skip(무이동·무스케일).
4. 변환기 `toSpreadTemplate`: spine 판정 시 `widthPx > region.width*1.05`면 regionRef=null+canvas anchor(강등) — spine만, cover는 불변.
5. 테스트: canvas-core 기존 227 + spine reposition 단위 테스트(텍스트 yNorm 보존·전폭 배경 무이동), 변환기 42 + spine 강등 테스트.

### W-B. editor (embed UX + 모달) — Agent B
1. `WorkspaceModal`: complete 필터 제거 + 데이터소스 `GET /edit-sessions/my`로 교체(updatedAt DESC·게스트 제외).
2. embed 무음 폴백 제거: 두 catch 모두 — `import.meta.env.DEV || allowSampleFallback=1`일 때만 샘플 폴백,
   아니면 명확한 에러 UI + `editor.error{code:'TEMPLATE_SET_NOT_FOUND', templateSetId}` 발신.
   폴백 발생 시: 다른 spec 위 세션 canvasData 복원 스킵 + alert에 실패 id 표기 + editor.ready에 fallback 플래그.
3. 세션 생성 metadata에 `orderOptions:{pageCount,paperType,bindingType,size,productId,orderSeqno}` 스냅샷.
4. 재편집 게이트 완화: `sessionId`만 있어도 세션 조회·복원(mode/orderSeqno는 세션에서 도출). 기존 경로 호환 유지.

### W-C. api (보관함 지원 + 보안) — Agent C
1. `GET /edit-sessions/my?summary=1`: canvasData 제외 + templateSetName 배치 조인 + thumbnailUrl 평탄화.
2. IDOR 가드: `GET /edit-sessions?memberSeqno=` — admin/manager 아니면 본인 외 403(외부서버는 X-API-Key 라우트라 무영향).

### W-D. 마무리 (메인)
- 빌드/테스트 전체 → 리뷰 → 커밋/푸시(editor·admin 자동배포) → **API VPS 수동 재배포** → 라이브 검증
  (실셋 a2cc2939 embed: 책등 재계산 후 텍스트 위치 보존 / 모달 최근 저장본 / 가짜 id→TEMPLATE_SET_NOT_FOUND) → 문서 갱신.

## 수용 기준
- [ ] IDML 셋 embed 구동: 책등 폭 변경 후에도 책등 텍스트 yNorm 적층 없음, 표지 객체 드리프트 0
- [ ] 불러오기 모달에 방금 저장본(complete 포함) 표시·재편집 동작
- [ ] 무효 templateSetId → 무음 폴백 없이 editor.error + 에러 UI
- [ ] 세션 metadata.orderOptions 저장 확인(신규 세션)
- [ ] /my?summary=1: canvasData 없음+templateSetName 포함 / 타인 memberSeqno 조회 403
- [ ] 회귀 0: canvas-core 227+α, 변환기 42+α, api jest, editor/admin build
