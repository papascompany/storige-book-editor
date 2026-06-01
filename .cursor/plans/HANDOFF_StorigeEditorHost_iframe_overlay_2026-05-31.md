# 연동 지시서 — bookmoa-mobile `StorigeEditorHost` 수정 (iframe 오버레이 풀스크린 + 모바일)

> **대상**: 다른 Claude Code 세션 (bookmoa-mobile 레포 작업자)
> **작성**: 2026-05-31 / Storige 측 계약은 코드 검증 완료 (아래 §9 참조 경로)
> **레포**: `bookmoa-mobile` (Vercel: `bookmoa-mobile.vercel.app`) — **Storige 레포 아님**
> **건드리는 파일**: `src/components/StorigeEditorHost.jsx`, `src/pages/Orders.jsx`(진입부), 필요 시 `api/storige/router.js`(editor-config)
> **건드리지 말 것**: Storige 레포(`storige-book-editor`) — 이 문서는 그쪽을 **읽기 전용 계약**으로만 참조

---

## 0. TL;DR

현재 PC/모바일에서 "편집하기 → 편집기 구동 → 저장 → 닫기" 플로우가 **샘플 템플릿(8×8 24p)으로 잘못 뜬다.**
원인은 단 하나: **iframe URL에 `templateSetId`를 안 실어 보냄** → 에디터가 "파라미터 없음 → 기본 샘플" 경로로 떨어짐.

해야 할 일 3가지:
1. **(P0 버그픽스)** 상품의 `templateSetId`(+token, 옵션 파라미터)를 iframe URL에 정확히 실어 보낸다.
2. **(UX)** iframe을 작은 박스가 아니라 **풀스크린 오버레이**(`position:fixed; inset:0; 100dvw×100dvh`)로 띄운다.
3. **(완료/닫기)** 에디터가 보내는 `storige:completed` 메시지를 수신해 오버레이를 닫고 합성을 트리거한다.

---

## ⚡ 업데이트 (2026-06-01) — Storige 측 `/embed` 라우트 배포 완료, 이 내용이 우선

> 아래 변경은 **Storige 측 구현이 끝나 배포된 새 계약**이다. §2~§5의 옛 `/?templateSetId=…`(EditorView) 설명보다 **이 절을 우선** 적용하라. (옛 경로는 완료 메시지를 안 보냈고, 이제 `/embed`가 정식 경로다.)

### (1) iframe 진입 URL을 `/embed` 로 변경 (가장 중요)
- **옛**: `https://editor.papascompany.co.kr/?templateSetId=…`  ← 완료 메시지 미발신(쓰지 말 것)
- **신규 편집**: `https://editor.papascompany.co.kr/embed?templateSetId=<id>&token=<jwt>&orderSeqno=<n>&pageCount=&paperType=&bindingType=&parentOrigin=https://bookmoa-mobile.vercel.app`
- **재편집(장바구니/주문내역의 수정 버튼)**: `https://editor.papascompany.co.kr/embed?sessionId=<저장된세션ID>&token=<jwt>&parentOrigin=https://bookmoa-mobile.vercel.app`
  - `templateSetId`는 **세션에서 자동 도출**되므로 생략 가능(함께 보내도 무방·권장).
  - `/embed`는 **완전 배선된 편집기**(자동저장·세션영속·재편집 복원·정식 postMessage)를 띄운다.

### (2) 완료 메시지 — 이제 **dual-emit** (둘 다 옴)
편집완료 시 `/embed`가 두 메시지를 **모두** 발신한다:
- **레거시** `{ type:'storige:completed', payload:{ sessionId, orderSeqno, status, completedAt, files } }` ← **지금 구현한 수신부 그대로 동작** ✅
- **정식** `{ source:'storige-editor', version:'1', event:'editor.complete', payload:{ sessionId, … }, timestamp }` ← 추후 이걸로 이전 권장
- 저장 시: `storige:saved` / `editor.save`, 준비 완료: `storige:ready` / `editor.ready`, 취소: `storige:cancel` / `editor.cancel`, 에러: `storige:error` / `editor.error`
- → **현재 구현 변경 없이 작동**한다. 정식 엔벨로프로 옮길지는 선택.

### (3) 재편집 플로우 대응 (신규 요구사항 — 장바구니/주문내역 "수정" 버튼)
편집보관함이 아직 없어도, **세션ID를 항목에 저장**해두면 재편집이 된다:
1. 신규 편집 완료 시 받은 `payload.sessionId`를 **그 장바구니 항목 / 주문 라인에 저장**(Supabase).
2. 장바구니/주문내역 행의 "수정"(초록 아이콘) 클릭 → 저장해 둔 `sessionId`로 `/embed?sessionId=…&token=…&parentOrigin=…` 오버레이 오픈.
3. 편집기가 그 세션의 **최종 canvasData를 그대로 복원**해 이어서 편집 → 다시 완료하면 같은 세션이 갱신(`editVersion` 증가)된다.
4. 적용 화면: 마이페이지 > 주문 > **주문내역**(관리 `•••`), 마이페이지 > 주문 > **장바구니**(파일/펜 아이콘). 두 곳 모두 같은 `/embed?sessionId=` 방식.
   - 주문 확정(결제완료) 전까지는 항상 재편집 가능. 확정 후 정책은 bookmoa가 상태값으로 게이팅.

### (4) 그대로 적용되는 것
- §6 풀스크린 오버레이 / §7 모바일 체크리스트 / §8 보안(origin 검증) — **변경 없이 그대로**.
- 단 §5.2 수신부의 origin 검증(`e.origin === 'https://editor.papascompany.co.kr'`)은 필수 유지.

---

## 1. 근본 원인 (검증됨)

에디터 `/` 라우트(`EditorView`)는 URL에 `templateSetId / productId / contentId / editMode`가 **전부 없으면** 의도적으로 샘플 템플릿셋(`sample-8x8-book-24p`)을 로드한다. (디폴트 데모 동작)

→ 즉 Storige/API/DB는 정상이고, **bookmoa가 iframe을 띄울 때 파라미터를 안 넘기는 호스트측 배선 누락**이다.
실제로 admin 상품 설정에는 `templateSetId = f0335fda-bf48-47f2-a908-2b2e70e78de8`(A4 하드커버 책자)가 정상 저장돼 있다. 빠진 건 "구동 시 이 값을 URL로 전달"하는 코드뿐.

검증: 아래 URL을 브라우저에서 직접 열면 정상 구동된다.
```
https://editor.papascompany.co.kr/?templateSetId=f0335fda-bf48-47f2-a908-2b2e70e78de8
```

---

## 2. 필수 / 권장 파라미터 표

에디터(`EditorView`)가 읽는 쿼리 파라미터. **camelCase와 snake_case 둘 다 허용**(camelCase 우선). 외부 노출 권장 표기는 snake_case지만 어느 쪽이든 동작한다.

| 파라미터 (camelCase) | snake_case 대체 | 필수 | 값/출처 | 설명 |
|---|---|---|---|---|
| `templateSetId` | `template_set_id` | ✅ **필수** | 상품의 Storige 연동 설정값 (예: `f0335fda-…`) | **이게 없으면 샘플로 떨어짐.** 절대 빈 문자열 금지 |
| `token` | `token` | ✅ 로그인 시 필수 | shop-session JWT (1h) | 인증. 게스트면 생략 가능(에디터가 게스트 세션 자동 생성) |
| `pageCount` | `page_count` | 🔶 권장 | 고객 주문 옵션 (내지 수) | book 모드 페이지 자동 확장/검증에 사용. 범위 밖이면 로드 실패 가능 |
| `paperType` | `paper_type` | 🔶 권장 | 주문 옵션 (예: `mojo_80g`) | 책등 너비 계산(SpineCalculator) |
| `bindingType` | `binding_type` | 🔶 권장 | 주문 옵션 (예: `perfect`/무선, `saddle`/중철) | 책등/제본 계산 |
| `size` | `size` | ⬜ 선택 | 규격 코드 | 일부 흐름에서 사용 |
| `width` / `height` | `width`/`height` | ⬜ 선택 | mm | 특수 케이스 |

> ❗ `orderSeqno`, `callbackUrl`은 **이 라우트의 URL 파라미터가 아니다.** 주문/웹훅 연결은 완료 후 서버 어댑터(`api/storige/synthesize.js`)에서 `compose-mixed` 호출 시 `callbackUrl`로 처리한다. (§5 흐름 참조)

> ❗ `adminEdit=templateSet`은 **관리자 템플릿셋 편집 전용**. 고객 주문 흐름에서는 절대 보내지 말 것.

---

## 3. 상품 → templateSetId 매핑 규칙

bookmoa admin "상품 수정 > Storige 편집기 연동"에 저장되는 필드:

| admin 필드 | 의미 | 사용처 |
|---|---|---|
| `사용` (체크박스) | Storige 연동 on/off | off면 편집하기 버튼 자체를 숨김 |
| `sortcode` | Storige 상품코드 (예: `A4hardcoverbook`) | 서버 어댑터에서 합성 규칙 분기용 |
| `stanSeqno` (선택) | 쇼핑몰 ERP 규격 식별 ID | 공통 템플릿셋이면 비움 |
| **`templateSetId`** | **편집기에 넘길 템플릿셋 ID** | **← iframe URL `templateSetId`로 그대로 전달** |
| `templateSetName` | 표시용 이름 | UI 라벨만 |
| `표지 편집 가능` (coverEditable) | 표지 편집 허용 여부 | 합성 outputMode 판별(서버) |

**매핑 규칙 (단순):**
1. 상품 객체에 저장된 **`templateSetId`를 그대로** iframe URL `templateSetId` 파라미터에 넣는다. 변환/가공 금지.
2. `templateSetId`가 비어 있거나 "사용" off면 → 편집하기 버튼 비활성 + 안내("이 상품은 편집기 미연동"). **샘플로 떨어지게 두지 말 것.**
3. `pageCount/paperType/bindingType`은 **templateSet이 아니라 고객의 주문 옵션**에서 가져와 전달한다.
4. (선택) 서버 `api/storige/router.js`에 `editor-config` 엔드포인트가 있으면, 상품ID로 `{ templateSetId, coverEditable, sortcode }`를 받아오는 단일 소스로 사용. 없으면 상품 객체 필드 직접 사용.

---

## 4. iframe URL 빌드 (구현 예시)

```js
const EDITOR_ORIGIN = 'https://editor.papascompany.co.kr';

function buildEditorUrl({ templateSetId, token, order }) {
  if (!templateSetId) throw new Error('templateSetId 누락 — 편집기 진입 차단'); // 샘플 폴백 방지
  const p = new URLSearchParams();
  p.set('templateSetId', templateSetId);
  if (token) p.set('token', token);
  if (order?.pageCount)   p.set('pageCount', String(order.pageCount));
  if (order?.paperType)   p.set('paperType', order.paperType);
  if (order?.bindingType) p.set('bindingType', order.bindingType);
  return `${EDITOR_ORIGIN}/?${p.toString()}`;
}
```

token은 서버 어댑터 `POST /api/storige/shop-session`(X-API-Key)로 발급받아 클라이언트로 내려준다. (API Key는 **서버에서만** 사용, 클라이언트 노출 금지)

---

## 5. 완료 / 닫기 핸드셰이크 계약 (검증됨)

### 5.1 에디터 → 부모(호스트)로 오는 메시지

고객 iframe 흐름에서 **편집완료** 시, 에디터는 `window.parent.postMessage`로 다음을 보낸다(현재 검증된 실제 동작):

```js
{
  type: 'storige:completed',
  payload: {
    sessionId: string,        // ← 합성 트리거에 사용
    orderSeqno: number,
    status: string,           // 'completed'
    completedAt: string,      // ISO
    files: { coverFileId: string|null, contentFileId: string|null }
  }
}
```

> ⚠️ **알려진 비표준 주의**: Storige 코드에는 현재 postMessage 규약이 혼재한다.
> - 고객 라우트(`/`, EditorView) → **`storige:completed`** (위, targetOrigin `'*'`) ← **호스트는 이걸 들어야 함**
> - 관리자 템플릿셋 편집 → `ADMIN_EDITOR_SAVED/CLOSED/READY/ERROR`
> - IIFE(EmbeddedEditor, PHP용) → 정식 엔벨로프 `{ source:'storige-editor', event:'editor.complete', … }`
>
> **이 작업에서는 고객 iframe = `storige:completed`만 신뢰**하면 된다. (정식 엔벨로프는 라우트 경로에서 안 옴)
>
> **마이그레이션 예고 (짝 문서와 동기화)**: Storige 측 통일 작업([`HANDOFF_Storige_postMessage_standardize_2026-06-01.md`](./HANDOFF_Storige_postMessage_standardize_2026-06-01.md))이 배포되면, 에디터가 `storige:completed`와 **정식 엔벨로프 `{ source:'storige-editor', event:'editor.complete' }`를 동시 발신(dual-emit)**한다. 그때:
> 1. 지금은 `storige:completed` 수신으로 구현(현행 동작 보장).
> 2. Storige dual-emit 배포 후, 수신부를 정식 엔벨로프로 옮기고 URL에 `parentOrigin=https://bookmoa-mobile.vercel.app`를 추가(→ origin 제한 활성화, `'*'` 탈피).
> 3. payload 필드(sessionId/orderSeqno/status/completedAt/files)는 두 포맷이 동일하므로 수신 로직 재사용 가능.
>
> 이 레포에서 Storige 코드를 고치지 말 것 — 통일은 Storige 측 짝 문서 담당.

### 5.2 호스트 수신부 (구현 예시)

```js
useEffect(() => {
  function onMessage(e) {
    // 보안: origin 검증 (에디터는 '*'로 쏘므로 호스트가 막아야 함)
    if (e.origin !== EDITOR_ORIGIN) return;
    const data = e.data;
    if (data?.type === 'storige:completed') {
      const { sessionId } = data.payload || {};
      closeOverlay();                 // 1) 오버레이 즉시 닫기 (리로드 0)
      triggerSynthesis(sessionId);    // 2) 서버 합성(compose-mixed) 트리거 + 폴링 (Orders.jsx)
    }
  }
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}, []);
```

### 5.3 "닫기"(취소) 동작

고객 라우트는 취소 전용 메시지를 보내지 않는다. 따라서 **닫기는 호스트가 소유**한다:
- 오버레이에 **호스트가 렌더한 닫기(✕) 버튼**을 둔다(에디터 위 우상단, safe-area 고려).
- 닫기 클릭 → 저장 안 된 변경 경고(선택) → 오버레이 언마운트. 합성 트리거하지 않음.
- 완료(`storige:completed`) 경로와 닫기 경로를 명확히 분리.

---

## 6. 오버레이 풀스크린 구현

핵심: **작은 인라인 iframe ❌ → 풀스크린 오버레이 ✅**. 편집 화면은 전체 뷰포트를 쓰되, bookmoa 페이지는 밑에 살아있어 닫으면 리로드 0으로 복귀.

```jsx
// StorigeEditorHost.jsx (개념 골격)
{open && (
  <div className="storige-overlay" role="dialog" aria-modal="true">
    <button className="storige-overlay__close" onClick={onClose} aria-label="편집기 닫기">✕</button>
    <iframe
      ref={iframeRef}
      src={editorUrl}
      title="Storige 편집기"
      allow="fullscreen; clipboard-write"
      // sandbox 쓸 경우: "allow-scripts allow-same-origin allow-forms allow-popups"
    />
  </div>
)}
```

```css
.storige-overlay{
  position: fixed; inset: 0;
  width: 100dvw; height: 100dvh;   /* ❗ 100vh 금지 — 모바일 주소창 때문에 잘림 */
  z-index: 2147483000;             /* 최상단 */
  background: #fff;
  overscroll-behavior: contain;
}
.storige-overlay iframe{
  width: 100%; height: 100%; border: 0; display: block;
}
.storige-overlay__close{
  position: absolute;
  top: max(8px, env(safe-area-inset-top));
  right: max(8px, env(safe-area-inset-right));
  z-index: 1;
}
```

오버레이 열릴 때 **부모 스크롤 잠금**:
```js
function openOverlay(){ document.body.style.overflow = 'hidden'; setOpen(true); }
function closeOverlay(){ document.body.style.overflow = ''; setOpen(false); }
```

---

## 7. 모바일 체크리스트 (PC/모바일 공통 매끄러움)

- [ ] 높이 `100dvh` 사용(❗`100vh` 금지). `min-height:100dvh` 보조.
- [ ] `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` 확인(safe-area 대응).
- [ ] 오버레이 열릴 때 `body{overflow:hidden}` + `overscroll-behavior:contain`로 **배경 스크롤·바운스 차단**.
- [ ] 닫기 버튼은 `env(safe-area-inset-*)` 적용(노치/홈바 겹침 방지).
- [ ] iframe `allow="fullscreen; clipboard-write"`. 캔버스 핀치줌이 필요하면 sandbox에 과한 제약 금지.
- [ ] 닫은 뒤 `body.overflow` 원복 확인(스크롤 먹통 버그 방지).
- [ ] 가상 키보드 올라올 때 레이아웃 깨짐 점검(텍스트 편집). `100dvh`면 대체로 안전.
- [ ] iOS Safari: 오버레이 위에서 페이지 전체 스크롤/줌이 새어나가지 않는지 실기 확인.
- [ ] 진입 직후 흰 화면 동안 호스트 로딩 스피너 표시(`editor.ready` 대신 iframe `onLoad`로 대체 가능).
- [ ] 뒤로가기(Android 물리버튼/제스처) 시 오버레이 닫힘 처리(history state push/pop) — 페이지 이탈 방지.

---

## 8. 보안

- **origin 검증 필수**: 에디터가 `'*'`로 postMessage하므로, 호스트 수신부에서 `e.origin === 'https://editor.papascompany.co.kr'`만 통과.
- **API Key 비노출**: `STORIGE_API_KEY`는 서버 어댑터(`api/storige/*`)에서만. 클라이언트엔 shop-session으로 발급한 단기 JWT(token)만.
- iframe `src` origin 고정(상수). 동적 origin 주입 금지.

---

## 9. Storige 측 읽기 전용 참조 (계약 출처 — 수정 금지)

| 파일 (storige-book-editor) | 확인 내용 |
|---|---|
| `apps/editor/src/views/EditorView.tsx:75-95` | 읽는 URL 파라미터 전체 목록 |
| `apps/editor/src/views/EditorView.tsx:150-165` | 파라미터 없을 때 샘플 자동 로드(=현재 버그 증상) |
| `apps/editor/src/utils/searchParams.ts` | camelCase/snake_case 양쪽 허용 규칙 |
| `apps/editor/src/hooks/useWorkSave.ts:702-720` | 완료 메시지 `storige:completed` payload |
| `apps/editor/src/components/editor/EditorHeader.tsx:317-366` | 편집완료/관리자 메시지(ADMIN_EDITOR_*) — 참고 |
| `apps/editor/src/embed.tsx:159-208` | 정식 엔벨로프(IIFE 전용) — 라우트 경로엔 미적용 |

에디터 origin: `https://editor.papascompany.co.kr`
샘플 폴백 ID(이게 뜨면 파라미터 누락 신호): `sample-8x8-book-24p`

---

## 10. 수용 기준 (Acceptance Criteria)

1. A4 하드커버 책자(상품) 편집하기 → **"A4하드커버 책자" 템플릿셋**이 뜬다(샘플 8×8 아님).
2. 콘솔에 `[EditorView] No params provided — loading default sample…` 로그가 **안 뜬다**.
3. 편집완료 → 호스트가 `storige:completed` 수신 → 오버레이 자동 닫힘 → 합성 트리거.
4. 닫기(✕) → 합성 없이 오버레이만 닫히고 bookmoa 페이지가 **리로드 없이** 원상태(스크롤/주문맥락 유지).
5. 모바일(iOS Safari/Android Chrome) 실기에서 편집 화면이 전체 뷰포트, 배경 스크롤/바운스 없음, 닫기 후 스크롤 정상.
6. token 만료/누락 시에도 샘플로 떨어지지 않고 명확한 에러/재인증 처리(또는 게스트 흐름).

---

## 11. 범위 밖 (이번 작업 금지)

- Storige 레포(`storige-book-editor`) 코드 수정 — postMessage 규약 통일은 **별도 Storige 태스크**로 분리.
- 합성 outputMode 변경, 웹훅 스키마 변경.
- PHP 쇼핑몰 어댑터(IIFE 경로) — 코드 경로 완전 분리, 건드리지 말 것.
- 플랫폼 공통 `StorigeEditor.open()` SDK화 — 후속 단계(이 작업 안정화 후).
