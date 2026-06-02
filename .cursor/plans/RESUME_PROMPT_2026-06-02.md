# Sprint Handoff — 2026-06-02

> **목적**: 편집기 임베드 아키텍처(`/embed`) 전환 + 텍스트 편집 자유도 강화 + 원형 텍스트 + 게스트 폴백 작업 정리/인수인계.
> **이전 마스터**: [`RESUME_PROMPT_2026-05-20.md`](./RESUME_PROMPT_2026-05-20.md) (인쇄 워크플로우 v1 완료)
> **짝 문서(연동)**: [`HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md`](./HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md) (bookmoa 측) · [`HANDOFF_Storige_postMessage_standardize_2026-06-01.md`](./HANDOFF_Storige_postMessage_standardize_2026-06-01.md) (SUPERSEDED)

---

## 0. TL;DR

> **외부 iframe 임베드 경로를 `/`(EditorView, 완료 미발신) → `/embed`(EmbeddedEditor, 완전 배선)로 전환.**
> 텍스트 편집 자유도(이탤릭/부분색상/글자크기/원형) 강화. 회원 식별 없는 토큰 시 게스트 폴백으로 편집기 오픈 보장.
> 전부 master 푸시 + Vercel 프로덕션 배포 + 라이브 검증 완료. PHP IIFE / 회원 / 관리자 경로 불변(회귀 0).

---

## 1. 이번 세션 커밋 (시간순)

| 커밋 | 영역 | 내용 |
|---|---|---|
| [`cc850bc`](https://github.com/papascompany/storige-book-editor/commit/cc850bc) | docs | 연동 핸드오프 2건 (bookmoa iframe 오버레이 + postMessage 통일) |
| [`6f68a3d`](https://github.com/papascompany/storige-book-editor/commit/6f68a3d) | editor | **`/embed` 라우트** — EmbeddedEditor 마운트 + sessionId 재편집 + dual-emit |
| [`272fd9e`](https://github.com/papascompany/storige-book-editor/commit/272fd9e) | editor | **텍스트 스타일 자유도** — 이탤릭 + 부분 색상 + 글자크기 입력/프리셋 + 직관 UI |
| [`2f5ee23`](https://github.com/papascompany/storige-book-editor/commit/2f5ee23) | editor | **곡선 텍스트 호 각도** 슬라이더(30~340°) — 원형/배지 (Phase 1) |
| [`21b2a4d`](https://github.com/papascompany/storige-book-editor/commit/21b2a4d) | editor | 곡선 텍스트 **각도 프리셋 칩**(반원/¾/원형) — (Phase 2) |
| [`144cda9`](https://github.com/papascompany/storige-book-editor/commit/144cda9) | editor | **게스트 세션 폴백** — `MEMBER_REQUIRED` 400 방어 |

배포: editor Vercel 자동배포(master push). 최신 라이브 번들 `index-CRTWj2wg.js`.

---

## 2. `/embed` 라우트 — 임베드 아키텍처 전환

### 2.1 배경 (왜 전환)
- 기존 `/`(EditorView)는 고객 편집완료 시 부모로 **완료 메시지를 안 보냄**(`completeSpreadWork` orphaned). 자동저장·세션영속 배선도 없음.
- 자동저장 / 세션 영속 / 정식 postMessage / **sessionId 재편집**은 전부 `embed.tsx`(IIFE EmbeddedEditor)에만 존재.
- → 외부 iframe은 **완전 배선된 EmbeddedEditor**를 URL로 마운트하는 게 정답 (의사결정 B안).

### 2.2 구현
| 파일 | 내용 |
|---|---|
| `apps/editor/src/views/EmbedView.tsx` (신규) | URL 파라미터(camel/snake) → `EditorConfig` → `<EmbeddedEditor>` 마운트. 신규편집(`templateSetId`) / 재편집(`sessionId`→templateSetId 자동도출). dual-emit + parentOrigin + token 선주입 |
| `apps/editor/src/App.tsx` | `/embed` 라우트 추가 (기존 SPA fallback rewrite가 자동 처리, vercel.json 불변) |
| `apps/editor/src/embed.tsx` | `EditorInstanceMethods` export (EmbedView ref 타입용, 추가형) |

### 2.3 진입 URL 계약
```
신규: /embed?templateSetId=<id>&token=<JWT>&orderSeqno=<n>&pageCount=&paperType=&bindingType=&parentOrigin=https://bookmoa-mobile.vercel.app
재편집: /embed?sessionId=<저장된ID>&token=<JWT>&parentOrigin=...   (templateSetId 자동도출)
```

### 2.4 postMessage (dual-emit)
- 정식 엔벨로프 `{ source:'storige-editor', version:'1', event:'editor.ready|save|complete|cancel|error|needAuth', payload, timestamp }` — parentOrigin 타깃
- 레거시 `{ type:'storige:completed'|'storige:saved'|... }` — 기존 호스트 하위호환
- → bookmoa 현행 `storige:completed` 수신부 그대로 동작 + 추후 정식 엔벨로프로 이전 권장

### 2.5 검증
- vite build / tsc / eslint 클린. 프로덕션 `/embed?templateSetId=sample-8x8-book-24p` 로드 시 `[EmbeddedEditor]` 마운트 + 템플릿 로드 확인.

---

## 3. 텍스트 편집 자유도 강화 (`272fd9e`)

`apps/editor/src/controls/TextAttributes.tsx`, `ObjectFill.tsx`:
- **이탤릭(fontStyle)** 토글 — 굵게/밑줄과 동일하게 부분선택(`setSelectionStyles`) + 전체 폴백. (B/I/U 3버튼)
- **부분 색상** — 편집 중 글자 범위 선택 시 그 부분에만 단색 적용(범위 없으면 전체). fabric 제약상 부분은 단색만(그라디언트 전체).
- **글자 크기** — 직접 입력 + **프리셋(pt) 드롭다운** 추가(`applyFontSizePt` 공유).
- **직관 UI** — 굵게(B)/기울임(I)/밑줄(U) 아이콘 + title 툴팁 + `aria-pressed`.
- 영속: per-character `styles`(이탤릭·부분색)는 직렬화 리스트(`packages/canvas-core/src/utils/canvas.ts`)에 포함 → 저장/복원/PDF 반영.
- 라이브 검증: "TEXT"에 이탤릭 적용 시 캔버스에서 기울어짐 확인.

---

## 4. 원형/배지 텍스트 (`2f5ee23`, `21b2a4d`)

`apps/editor/src/controls/TextEffect.tsx` ("곡선" 컨트롤):
- 기존 180° 고정 → **호 각도 슬라이더(30~340°)** 일반화. `generatePathData(r, reverse, deg)` (180°는 기존과 동일 = 회귀 0).
- **각도 프리셋 칩**: 반원(180°)/¾(270°)/원형(320°) — 일반 버튼으로 원클릭.
- `arcDeg` 영속: `curveArcDeg`를 직렬화 리스트에 추가(`curveRadius/curveDirection`과 동일 취급).
- 배지 만들기: 상단 텍스트(곡선 상단) + 하단 텍스트(곡선 하단) 두 개 → 원형 배지(패치/병뚜껑/라벨).
- **PDF 출력 안전성(검증됨)**: 출력은 `tempCanvas.renderAll()` → `toDataURL('png')` 래스터 캡처(`useWorkSave.ts`)라, fabric이 그린 곡선 텍스트가 **그대로 PNG→PDF에 출력**됨. 구조적으로 인쇄 안전.
- (참고) `EffectPlugin.textCurve`(글자 그룹 분해)는 **죽은 레거시** — 미사용. 실제 구현은 path-on-IText.

---

## 5. 게스트 세션 폴백 (`144cda9`) — MEMBER_REQUIRED 400 방어

### 5.1 증상/근본
- bookmoa가 `/embed`로 띄울 때 토큰에 **회원번호(memberSeqno) 누락/0** → `POST /edit-sessions`가 **400 `MEMBER_REQUIRED`**("회원 정보가 필요합니다.") → "편집기를 열 수 없습니다".
- shop-session JWT의 `sub=memberSeqno`, `source:'shop'` → JWT 전략이 `userId=sub` 매핑 → controller가 `user.userId`로 소유자 정함. 회원번호 없으면 400.

### 5.2 Storige 보강 (방어적)
`apps/editor/src/embed.tsx`, `hooks/useEmbedAutoSave.ts`:
- 회원 세션 생성 실패 시 **`createGuest` 자동 폴백** → 편집기 정상 오픈.
- 모든 저장 경로(자동저장/save/complete)를 `currentSession.guestToken` 유무로 **`update ↔ updateGuest` 분기**. 회원 토큰이면 `guestToken=null` → 기존 동작 그대로(PHP/회원 회귀 0).
- 게스트 편집완료: 회원 전용 `complete` 불가 → `updateGuest`로 저장 후 **`editor.needAuth`**(부모로 로그인 유도) emit. `EmbedMessageEvent`에 `editor.needAuth` 추가.
- 라이브 검증: 토큰 없이 `?orderSeqno=&mode=both` 진입 시 콘솔 `Member session create failed — falling back to guest` → `Guest session created (fallback)` → 템플릿 로드(에러 모달 미출현) 확인.

### 5.3 ❗ 정석 해결은 bookmoa 측 (진행 중)
게스트 폴백은 "편집기 오픈"만 보장. **완전 정상 운영은 bookmoa가 shop-session 발급 시 로그인 회원의 `memberSeqno`를 싣는 것**:
```
POST /api/auth/shop-session  (X-API-Key, 서버에서만)
Body: { memberSeqno: <로그인 회원번호>, memberId, memberName }
→ accessToken을 /embed?token= 으로
```
상세: `HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md` §(3.5).

---

## 6. bookmoa-mobile 측 잔여 작업 (다른 레포/세션, 진행 중)

`HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md` §업데이트(2026-06-01) 기준:
1. iframe URL을 `/` → **`/embed`** 로 변경 (+필수 파라미터).
2. 재편집: 완료 시 `payload.sessionId` 저장 → 주문내역/장바구니 "수정" 버튼이 `/embed?sessionId=`로 재구동.
3. 완료 수신부: `storige:completed` 그대로 동작(dual-emit). 추후 정식 엔벨로프로 이전 가능.
4. ✅ **shop-session 토큰에 `memberSeqno` 포함** — **완료·확인됨**(2026-06-02). 테스트 회원 로그인 → "A4 하드커버 책자" 회원 세션 정상 생성(400 없음) + 실제 템플릿 로드 확인.
5. ✅ **pageCount placeholder 미전송** — **완료**(2026-06-02). 상품 `productMeta.pages=1` placeholder를 호스트가 `pageCount=1`로 보내 "최소 8페이지" 검증 에러 발생 → `StorigeEditorHost.jsx`에서 `pageCount < 2`면 미전송(템플릿 기본 페이지수 사용)으로 수정.
   - (Storige 보강 2026-06-02): 범위 밖 pageCount는 **throw 대신 템플릿 유효 범위로 클램프**(`useEditorContents.ts` spread/single 모드, 커밋은 §8 참조). 호스트 placeholder에도 편집기 진입 보장.
6. (게스트 폴백 시) `editor.needAuth` 수신 → 로그인 → migrate → 재완료.

---

## 7. 운영 상태 (2026-06-02)

| 도메인 | 상태 |
|---|---|
| `https://editor.papascompany.co.kr/` (EditorView, 레거시 고객/관리자) | ✅ |
| `https://editor.papascompany.co.kr/embed` (신규 임베드 진입) | ✅ |
| API `https://api.papascompany.co.kr/api/health` | ✅ |

- API/Worker/DB 변경 **없음** (이번 세션은 editor 프론트 + 핸드오프 문서만). 재배포 불필요.

---

## 8. 변경 이력

| 일시 | 변경 |
|---|---|
| 2026-06-02 | `/embed` 임베드 전환 + 텍스트 자유도(이탤릭/부분색/사이즈/원형) + 게스트 폴백. editor 프론트 6커밋, PHP/회원/관리자 회귀 0. bookmoa 토큰 memberSeqno 작업 진행 중 |
