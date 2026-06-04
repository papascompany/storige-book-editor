# HANDOFF — bookmoa-mobile: 편집기 뒤로가기/이탈 데이터 무결성 처리 (2026-06-04)

> 대상: **bookmoa-mobile**(호스트 SPA, 편집기를 iframe 으로 임베드).
> 편집기(`editor.papascompany.co.kr/embed`)는 데이터 무결성 가드 + **호스트 연동 핸드셰이크**를 이미 배포함(커밋 256b517·이번 사이클).
> 이 문서는 호스트가 **무엇을 구현해야** 가장 견고하게 동작하는지를 정리한다.

---

## 0. 배경 (왜 필요한가)

- 호스트 SPA(`?page=...` 쿼리 라우팅) 안에서 편집 중 브라우저 **← 뒤로가기**를 누르면, 호스트의 클라이언트측 라우팅이라 편집기 iframe 의 `beforeunload` 가 발화하지 않아 **아무 경고 없이** 편집 전 주문화면으로 빠져나가 작업이 유실될 수 있었다.
- 편집기는 자체적으로 **내부 뒤로가기 가드**(history sentinel + confirm + 강제 자동저장)를 갖고 있어 **호스트가 아무것도 안 해도 기본 보호는 된다(Tier B)**. 다만 호스트 히스토리에 sentinel 1개가 남는 미세 부작용이 있고, 확인창 UX·라우팅을 호스트가 직접 통제하려면 **Tier A(핸드셰이크)** 가 가장 견고하다.

---

## 1. postMessage 프로토콜

### 1.1 공통
- **편집기 origin**: `https://editor.papascompany.co.kr` (이하 `EDITOR_ORIGIN`).
- 호스트는 iframe `src` 에 **반드시** `&parentOrigin=<호스트 origin>` 을 포함해야 한다(예: `parentOrigin=https://bookmoa-mobile.vercel.app`).
  - 편집기는 이 값으로 **인바운드 메시지 origin 검증** + **아웃바운드 postMessage 대상**을 결정한다. **누락 시 핸드셰이크/이벤트가 전혀 동작하지 않는다.**

### 1.2 편집기 → 호스트 (아웃바운드 이벤트)
봉투: `{ source:'storige-editor', version:'1', event, payload, timestamp }`

| event | 발생 시점 | payload |
|---|---|---|
| `editor.ready` | 편집기 초기화 완료 | `{ templateSetId, sessionId }` |
| `editor.save` | 저장(수동/명령) 완료 | `{ sessionId, savedAt }` |
| `editor.complete` | **편집완료**(주문 확정) | `{ sessionId, orderSeqno, files:{coverFileId, contentFileId} }` |
| `editor.cancel` | 편집기 취소/닫기 | `{ sessionId }` |
| `editor.needAuth` | 게스트가 편집완료 시 로그인 필요 | `{ guestToken, reason }` |
| `editor.error` | 오류 | `{ message }` |
| **`editor.state`** | 호스트 `getState` 응답 | `{ requestId?, ready, dirty, sessionId }` |
| **`editor.saved`** | 호스트 `saveNow` 응답 | `{ requestId?, ok, error? }` |

### 1.3 호스트 → 편집기 (인바운드 명령) ← **이번에 신설**
봉투: `{ source:'storige-host', version:'1', command, requestId?, payload? }`
호스트는 `iframe.contentWindow.postMessage(envelope, EDITOR_ORIGIN)` 로 전송.

| command | 동작 | 응답 |
|---|---|---|
| `getState` | 현재 미저장 여부 조회 | `editor.state { requestId, ready, dirty, sessionId }` |
| `saveNow` | **강제 저장(flush)** | `editor.saved { requestId, ok, error? }` |
| `setBackGuard` | `payload:{enabled:boolean}` — 편집기 **내부** 뒤로가기 가드 on/off | (응답 없음) |

> `requestId` 는 호스트가 응답을 매칭하기 위한 임의 문자열. 편집기가 응답 payload 에 그대로 echo 한다.

---

## 2. Tier A — 호스트 주도(권장, 가장 견고)

호스트가 뒤로가기/이탈을 직접 통제한다. 편집기 내부 가드는 끄고(중복·sentinel 방지), 호스트가 미저장 확인+강제저장 후 라우팅한다.

### 동작 순서
1. iframe 로드 후 `editor.ready` 수신 → `setBackGuard {enabled:false}` 전송(내부 가드 off).
2. 호스트가 **자체 popstate 가드**(sentinel)로 편집기 화면의 뒤로가기를 가로챈다.
3. 뒤로가기 감지 → 편집기에 `getState` → `editor.state.dirty` 확인.
   - `dirty=false` → 즉시 주문화면으로 라우팅.
   - `dirty=true` → 호스트 확인창 표시.
     - "계속 편집" → 머무름(sentinel 재추가).
     - "저장하고 나가기" → `saveNow` 전송 → `editor.saved.ok` 수신 후 주문화면으로 라우팅.
4. 호스트 헤더의 "닫기"/뒤로 UI 버튼도 동일 유틸을 사용(저장 후 라우팅).

### 예시 코드 (React/TS, bookmoa-mobile)

```tsx
const EDITOR_ORIGIN = 'https://editor.papascompany.co.kr'
const HOST_SRC = 'storige-host'

// 편집기로 명령 전송 + 응답 대기(요청/응답 매칭)
function createEditorBridge(getIframe: () => HTMLIFrameElement | null) {
  let seq = 0
  const pending = new Map<string, (payload: any) => void>()

  function onMessage(e: MessageEvent) {
    if (e.origin !== EDITOR_ORIGIN) return
    const d = e.data
    if (!d || d.source !== 'storige-editor') return
    if ((d.event === 'editor.state' || d.event === 'editor.saved') && d.payload?.requestId) {
      const cb = pending.get(d.payload.requestId)
      if (cb) { pending.delete(d.payload.requestId); cb(d.payload) }
    }
    // editor.complete / editor.cancel / editor.needAuth 등은 별도 핸들러에서 처리
  }
  window.addEventListener('message', onMessage)

  function send(command: string, payload?: any) {
    getIframe()?.contentWindow?.postMessage(
      { source: HOST_SRC, version: '1', command, payload }, EDITOR_ORIGIN,
    )
  }
  function request<T = any>(command: string, timeoutMs = 4000): Promise<T> {
    const requestId = `req-${++seq}`
    return new Promise<T>((resolve) => {
      const t = setTimeout(() => { pending.delete(requestId); resolve({ timeout: true } as any) }, timeoutMs)
      pending.set(requestId, (p) => { clearTimeout(t); resolve(p) })
      getIframe()?.contentWindow?.postMessage(
        { source: HOST_SRC, version: '1', command, requestId }, EDITOR_ORIGIN,
      )
    })
  }
  return {
    dispose: () => window.removeEventListener('message', onMessage),
    disableInternalBackGuard: () => send('setBackGuard', { enabled: false }),
    getState: () => request<{ ready: boolean; dirty: boolean; sessionId: string | null }>('getState'),
    saveNow: () => request<{ ok: boolean; error?: string }>('saveNow', 8000),
  }
}

// 편집기 화면에서 뒤로가기/이탈 가드 (호스트 라우터에 맞게 leaveToOrder 구현)
function installHostBackGuard(bridge: ReturnType<typeof createEditorBridge>, leaveToOrder: () => void) {
  let leaving = false
  const pushSentinel = () => history.pushState({ __bookmoaEditorGuard: true }, '')
  pushSentinel()

  const onPop = async () => {
    if (leaving) return
    const st = await bridge.getState()
    if (!st?.dirty) { leaving = true; window.removeEventListener('popstate', onPop); leaveToOrder(); return }
    const ok = window.confirm('저장되지 않은 변경사항이 있습니다.\n저장하고 나가시겠습니까?')
    if (!ok) { pushSentinel(); return }        // 계속 편집
    await bridge.saveNow()                       // 강제 저장(최대 8s)
    leaving = true
    window.removeEventListener('popstate', onPop)
    leaveToOrder()                               // 주문화면으로 라우팅
  }
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}

// 사용 예
// const bridge = createEditorBridge(() => iframeRef.current)
// onEditorReady => bridge.disableInternalBackGuard()
// const uninstall = installHostBackGuard(bridge, () => router.goToOrderScreen())
// 헤더 닫기 버튼: onClick => { await bridge.saveNow(); router.goToOrderScreen() }
```

> ⚠️ `getState`/`saveNow` 는 **비동기(postMessage 왕복)** 다. popstate 안에서 `await` 하되, 응답 전 사용자가 다시 뒤로가기를 눌러도 안전하도록 sentinel(머무름)을 유지하는 위 패턴을 그대로 사용할 것.

---

## 3. Tier B — 최소(호스트 뒤로가기 코드 없음)

- 편집기 **내부 가드를 켠 채로 둔다(기본값)**. 뒤로가기 confirm+강제저장은 편집기가 자체 처리한다.
- 호스트가 해야 할 것은 **라우팅 반응뿐**:
  - `editor.complete` 수신 → 주문완료/다음 단계로 라우팅.
  - `editor.cancel` 수신 → 주문화면으로 라우팅.
  - `editor.needAuth` 수신 → 로그인/회원가입 유도(게스트 승계).
- 한계: 호스트 히스토리에 sentinel 1개가 남아 **정상 종료 후** 뒤로가기 1회가 흡수될 수 있음(미세). 이를 없애려면 Tier A.

---

## 4. 체크리스트 (bookmoa-mobile)

- [ ] iframe `src` 에 `parentOrigin=<bookmoa-mobile origin>` 포함(필수). token/refreshToken/sessionId 등 기존 파라미터 유지.
- [ ] 호스트 `message` 리스너에서 **`e.origin === EDITOR_ORIGIN` 검증**(필수, 보안).
- [ ] (Tier A) `editor.ready` 후 `setBackGuard{enabled:false}` 전송.
- [ ] (Tier A) 편집기 화면 진입 시 popstate 가드 설치, 이탈 시 `getState`→(dirty면)`saveNow`→라우팅. 화면 떠날 때 가드 해제.
- [ ] 호스트 헤더 "닫기"/뒤로 버튼도 `saveNow` 후 라우팅(같은 유틸 재사용).
- [ ] `editor.complete`/`editor.cancel`/`editor.needAuth` 라우팅 반응 확인.

---

## 5. 편집기 측 참조 (이미 배포됨)
- 인바운드 핸들러 + 응답: `apps/editor/src/embed.tsx` (`EMBED_HOST_MESSAGE_SOURCE`, `getState`/`saveNow`/`setBackGuard`, `editor.state`/`editor.saved`).
- 내부 뒤로가기 가드: `apps/editor/src/hooks/useEmbedBackGuard.ts` (Tier B 기본 동작) — `setBackGuard{enabled:false}` 로 off.
- 상세: `docs/EDITOR.md` §17.

---

## 6. ⚠️ 보안/환경 주의 (검증 중 확인)

### 6.1 CSP frame-ancestors (임베드 허용 도메인) — **중요**
편집기는 다음 origin 에서만 iframe 임베드를 허용한다(2026-06-04 확인):
```
content-security-policy: frame-ancestors 'self'
  https://*.papascompany.co.kr https://*.bookmoa.co.kr https://www.bookmoa.co.kr https://*.vercel.app
```
- `bookmoa-mobile.vercel.app` → `*.vercel.app` 매칭 → **정상**.
- ⚠️ **커스텀 도메인(예: `m.bookmoa.co.kr` 외 다른 도메인)으로 이전하면 그 origin 이 위 목록에 없을 경우 임베드가 차단(빈 화면)** 된다. 도메인 변경 시 편집기 측 CSP 에 origin 추가 요청 필요(`apps/editor` 배포 설정).

### 6.2 parentOrigin 정확 일치
- iframe `src` 의 `parentOrigin` 은 **호스트 페이지 origin 과 정확히 일치**(scheme+host, 경로/슬래시 없음)해야 한다. 예: `https://bookmoa-mobile.vercel.app`.
- 편집기는 인바운드 `e.origin === parentOrigin` 검증 + 아웃바운드 targetOrigin 으로 사용. 불일치 시 **조용히 무시**(에러도 안 남).

### 6.3 타임아웃 폴백은 "안전" 기본값으로
- `getState` 가 타임아웃(구버전 편집기/네트워크 blip)되면 **dirty 로 가정(확인창 표시)** 하라 — 절대 "조용히 이탈" 폴백 금지(데이터 유실).
- 참고: 핸드셰이크를 지원하는 편집기는 내부 가드(256b517)도 함께 갖는다. 따라서 `getState` 응답이 오면 신버전(둘 다 보유), 타임아웃이면 구버전 가능성 → 안전측(확인창)으로.

## 7. 라이브 e2e 검증 결과 (2026-06-04, 운영자 대행)
호스트 페이지 ↔ 실제 편집기 빌드(현재 배포본 동일 코드) iframe 으로 왕복 확인 — **모두 통과**:
- `getState` → `editor.state { requestId(echo), ready, dirty, sessionId }` ✓
- `saveNow` → `editor.saved { requestId(echo), ok:true }` ✓
- `setBackGuard{enabled:false}` 전송 ✓
- origin 제한 + requestId 매칭 + 봉투 포맷 정상 ✓
→ bookmoa 브리지가 의존하는 핸드셰이크 plumbing 실증 완료. (dirty/save 의 "의미적" 왕복은 실제 캔버스 편집이 필요한 운영 검증 영역이나, **프로토콜·응답 경로는 검증됨**.)
