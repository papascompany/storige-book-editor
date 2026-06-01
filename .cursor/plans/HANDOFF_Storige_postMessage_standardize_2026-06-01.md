# 후속 지시서 — Storige 에디터 postMessage 규약 통일 (라우트 경로 정식 엔벨로프 발신)

> ## ✅ 상태: 대체 해결됨 (SUPERSEDED, 2026-06-01)
> 이 문서의 목표(라우트 경로에서 정식 엔벨로프 + 레거시 dual-emit)는 **`/embed` 라우트 신설로 이미 달성**되었다.
> - 구현: `apps/editor/src/views/EmbedView.tsx`(신규) + `apps/editor/src/App.tsx`(`/embed` 라우트) — 완전 배선된 `EmbeddedEditor`를 마운트.
> - `/embed`가 **정식 엔벨로프(`editor.*`)** 와 **레거시(`storige:*`)** 를 동시 발신(dual-emit) + `parentOrigin` 지원 + **sessionId 재편집**까지 처리.
> - 즉 "기존 `/` 경로(EditorView)를 고쳐 dual-emit"하는 아래 작업은 **불필요**해졌다. (bookmoa는 `/`가 아니라 `/embed`를 쓴다.)
>
> 아래 본문은 **대안 설계 기록**으로만 보존한다. 별도 후속(예: `/`도 통일, 레거시 deprecate)은 여전히 유효한 참고.

---

> **대상**: 다른 Claude Code 세션 (Storige 레포 `storige-book-editor` 작업자)
> **작성**: 2026-06-01 / 현재 코드 상태 검증 완료 (§8 참조 경로)
> **레포**: `storige-book-editor` (PUBLIC, master)
> **짝 문서(읽고 시작)**: [`HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md`](./HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md) — bookmoa-mobile 호스트 측 계약
> **핵심 원칙**: **additive(추가형) / dual-emit(이중 발신)** — 기존 메시지 절대 제거 금지. 호환 깨면 bookmoa 호스트가 깨진다.

---

## 0. TL;DR

현재 에디터의 부모↔자식 postMessage 규약이 **3종 혼재**한다:

| 경로 | 현재 발신 메시지 | targetOrigin | 발신처 |
|---|---|---|---|
| 고객 iframe `/`(EditorView) — **book/spread 모드** | `{ type:'storige:completed', payload:{…} }` | `'*'` | `useWorkSave.completeSpreadWork` |
| 고객 iframe `/`(EditorView) — **single 모드(낱장)** | **(없음 — 발신 안 함)** ❌ | — | `useWorkSave.saveWork` |
| 관리자 템플릿셋 편집 | `{ type:'ADMIN_EDITOR_SAVED'\|'CLOSED'\|'READY'\|'ERROR' }` | `'*'` | `EditorHeader.sendMessageToCMS` |
| IIFE(PHP, EmbeddedEditor) | 정식 엔벨로프 `{ source:'storige-editor', version:'1', event:'editor.*' }` | `parentOrigin`(엄격) | `embed.tsx postToParent` |

**목표**: 라우트 경로(EditorView)도 **정식 엔벨로프**(`editor.ready/save/complete/cancel/error`)를 발신하도록 통일하되, **기존 메시지는 그대로 병행 발신**해 외부 호스트(bookmoa)가 단계적으로 마이그레이션할 수 있게 한다.

---

## 1. 왜 (배경)

외부 서비스(bookmoa-mobile)가 편집기를 iframe으로 임베드한다. 호스트가 완료/취소를 안정적으로 수신하려면 **단일·일관된 메시지 계약**이 필요하다. 현재는:
- book/spread만 `storige:completed`를 쏘고 **single(낱장)은 아무것도 안 쏨** → 카드/명함 상품에서 호스트가 완료를 못 받음.
- targetOrigin이 `'*'` → 보안상 부모 origin으로 제한해야 함.
- 정식 엔벨로프(`storige-editor`)는 IIFE에만 있어 라우트 경로와 불일치.

이 문서는 이를 **호환을 깨지 않고** 통일한다.

---

## 2. 호환 계약 (가장 중요 — 반드시 준수)

### 2.1 dual-emit 규칙
완료 시 **두 메시지를 모두** 발신한다(전환기 동안):
1. **기존** `{ type:'storige:completed', payload:{…} }` — **그대로 유지**(bookmoa 현행 수신부 보호)
2. **신규** 정식 엔벨로프 `{ source:'storige-editor', version:'1', event:'editor.complete', payload:{…}, timestamp }`

관리자 경로의 `ADMIN_EDITOR_*`도 **유지**(제거 금지). 신규 엔벨로프를 **추가**만 한다.

### 2.2 마이그레이션 4단계 (짝 문서와 동기화)

| 단계 | Storige (이 문서) | bookmoa (짝 문서) |
|---|---|---|
| 1 | (현행) `storige:completed`만 | `storige:completed` 수신 구현 |
| 2 | **dual-emit 추가** (이 작업) | 변경 없음 (계속 동작) |
| 3 | — | 정식 엔벨로프로 수신부 마이그레이션 |
| 4 | 일정 후 `storige:completed`/`ADMIN_EDITOR_*` deprecate | 정식 엔벨로프만 수신 |

→ **이 작업은 "단계 2"만 한다.** 기존 메시지 제거(단계 4)는 이 문서 범위 밖.

### 2.3 payload 일관성
신규 `editor.complete`의 payload는 기존 `storige:completed`의 payload와 **동일 필드**를 포함한다(상위호환):
```ts
payload: {
  sessionId: string,
  orderSeqno: number,
  status: string,
  completedAt: string,        // ISO
  files: { coverFileId: string|null, contentFileId: string|null },
}
```

---

## 3. 작업 범위 (해야 할 것)

### 3.1 `parentOrigin` 파라미터 도입 (targetOrigin `'*'` 탈피)
- `EditorView`가 URL에서 `parentOrigin`(camel)/`parent_origin`(snake)을 `getParamCompat`로 파싱.
- 이 값을 발신 지점(useWorkSave, EditorHeader)까지 전달(권장: `useAppStore` 또는 settings store에 `parentOrigin` 필드 추가해 구독).
- 발신 시 targetOrigin = `parentOrigin`(있으면), 없으면 **하위호환을 위해 `'*'` 유지**(외부가 아직 안 보낼 수 있음). `parentOrigin` 있으면 절대 `'*'` 쓰지 말 것.
- **재사용**: `embed.tsx`의 `postToParent()` + `EMBED_MESSAGE_SOURCE/VERSION/EmbedMessageEnvelope`를 export해 그대로 가져다 쓴다(중복 구현 금지).

### 3.2 라우트 경로 정식 엔벨로프 발신 (5종)
| 이벤트 | 발신 시점 | 발신처(수정 대상) |
|---|---|---|
| `editor.ready` | 캔버스+템플릿셋 로드 완료 후 | `EditorView` 초기화 완료 지점 |
| `editor.save` | 중간 저장(내 작업/임시저장) 성공 | `useWorkSave.saveWork` / 저장 핸들러 |
| `editor.complete` | 편집완료 성공 | `useWorkSave.completeSpreadWork` **및 single 모드 완료 경로** |
| `editor.cancel` | 고객이 닫기/취소 | (신규) 취소 핸들러 — 없으면 추가, 또는 호스트가 닫으므로 best-effort |
| `editor.error` | 저장/완료/로드 실패 | 각 catch 블록 |

### 3.3 single 모드 완료 갭 메우기 (중요)
- 현재 `saveWork`(낱장/single) 경로는 완료 시 **부모 알림이 없다.**
- single 상품(카드/명함/엽서)도 완료 시 `storige:completed`(기존 포맷) + `editor.complete`(신규)를 발신하도록 추가.
- payload 필드는 §2.3과 동일 형태로 맞춘다(없는 값은 null).

### 3.4 관리자 경로
- `EditorHeader.sendMessageToCMS`의 `ADMIN_EDITOR_*`는 **유지**. 추가로 정식 엔벨로프(`editor.save`/`editor.complete`)를 함께 쏠지는 선택(관리자 흐름은 외부 호스트 대상 아님 → 우선순위 낮음, 안 해도 됨). 하더라도 기존 제거 금지.

---

## 4. 회귀 안전 (절대 깨면 안 되는 것)

- **PHP IIFE 경로(`embed.tsx` EmbeddedEditor)**: 이미 정식 엔벨로프 사용 중 → **변경 금지**. `postToParent` 시그니처/동작 바꾸지 말고 export만 추가.
- **기존 `storige:completed` / `ADMIN_EDITOR_*`**: 포맷·발신 시점 **불변**(병행 발신).
- **`parentOrigin` 미전달 시**: 기존과 동일하게 `'*'`로 동작(외부 사이트가 아직 안 보내는 경우 보호).
- **standalone(top-level, iframe 아님)**: `window.parent === window`면 발신 스킵(`postToParent` 이미 처리). 토스트 안내 동작 유지.

---

## 5. 구현 메모

- `embed.tsx`에서 `export function postToParent`, `export const EMBED_MESSAGE_SOURCE/VERSION`, `export interface EmbedMessageEnvelope/type EmbedMessageEvent` 가 이미 export면 그대로 사용. 아니면 export 추가(내부 로직 변경 금지).
- `parentOrigin` 전달 경로: `EditorView`(파싱) → store → `useWorkSave`/`EditorHeader`(구독). hook 인자로 직접 넘기기 어려우면 store 경유가 깔끔.
- `timestamp`는 `new Date().toISOString()` (embed.tsx 기존 방식과 동일).
- `editor.ready` payload엔 `{ sessionId?, templateSetId, mode }` 정도 포함(호스트 로딩 종료 신호용).

---

## 6. 수용 기준 (Acceptance Criteria)

1. 고객 iframe(book/spread)에서 편집완료 시 **`storige:completed`와 `{source:'storige-editor', event:'editor.complete'}` 두 메시지가 모두** 부모로 전달된다.
2. **single 모드(낱장)** 편집완료 시에도 위 두 메시지가 발신된다(기존엔 없던 것).
3. URL에 `parentOrigin=https://bookmoa-mobile.vercel.app`를 주면 targetOrigin이 **그 origin으로 제한**된다(`'*'` 아님). 안 주면 `'*'`로 하위호환.
4. `editor.ready`가 로드 완료 후 1회 발신된다.
5. 실패 시 `editor.error`(+payload.message)가 발신된다.
6. PHP IIFE 경로·관리자 경로·standalone 동작 **불변**(회귀 없음).
7. `pnpm lint` 0 errors, 기존 빌드 통과.

---

## 7. 테스트 시나리오

- iframe 임베드 페이지에서 `window.addEventListener('message', …)`로 book/spread/single 각각 완료 → 두 메시지 수신 확인.
- `parentOrigin` 일치/불일치 시 메시지 도달 여부(불일치면 브라우저가 차단).
- standalone(직접 URL 접속, iframe 아님)에서 postMessage 미발신 + 토스트 정상.
- PHP IIFE 샘플(있으면) 회귀 확인.

---

## 8. 현재 코드 참조 (수정 출발점)

| 파일 | 현재 상태 |
|---|---|
| `apps/editor/src/hooks/useWorkSave.ts:702-720` | `completeSpreadWork` → `storige:completed` 발신(`'*'`). ← 여기에 정식 엔벨로프 dual-emit 추가 |
| `apps/editor/src/hooks/useWorkSave.ts:285` (`saveWork`) | single 모드 — **완료 발신 없음**. ← §3.3 추가 |
| `apps/editor/src/components/editor/EditorHeader.tsx:354-366` | `sendMessageToCMS` → `ADMIN_EDITOR_*`(`'*'`). 유지 |
| `apps/editor/src/embed.tsx:159-208` | `postToParent` + 엔벨로프 정의. ← export 재사용 |
| `apps/editor/src/views/EditorView.tsx:75-95` | URL 파라미터 파싱부. ← `parentOrigin` 추가 |
| `apps/editor/src/utils/searchParams.ts` | `getParamCompat`(camel/snake). 그대로 사용 |

---

## 9. 범위 밖 (이번 작업 금지)

- 기존 `storige:completed` / `ADMIN_EDITOR_*` **제거**(= 마이그레이션 단계 4). 별도 후속.
- bookmoa-mobile 레포 수정(짝 문서 담당).
- 합성 outputMode / 웹훅 / 인증 로직 변경.
- `embed.tsx` IIFE 동작 변경.

---

## 10. 짝 문서 동기화 메모

이 작업(단계 2) 완료 후, bookmoa 호스트 지시서([`HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md`](./HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md)) §5에 안내된 대로 호스트는:
- 당장은 `storige:completed` 수신 유지(동작 보장),
- 이후 `{source:'storige-editor', event:'editor.complete'}` 정식 엔벨로프로 수신부를 옮기고 `parentOrigin`을 URL에 추가한다(origin 제한 활성화).

두 작업의 연결고리 = **공통 payload(§2.3) + 마이그레이션 4단계(§2.2)**.
