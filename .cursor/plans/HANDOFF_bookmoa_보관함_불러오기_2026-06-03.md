# [bookmoa 전달] 보관함 ↔ Storige "불러오기/재편집" 연동 지시서 (2026-06-03)

> 이 이슈는 **양쪽 대응**이 필요합니다.
> - **Storige(우리)**: 불러오기/재편집 시 캔버스가 비어 보이는 버그 + 편집완료 PDF 오류 수정 (진행 중, bookmoa 대기 불필요).
> - **bookmoa(이 문서)**: 보관함/마이페이지가 "로그인 회원의 저장 이력"을 일관되게 보여주고 재편집으로 이어지게 하는 연동 작업.

---

## 0. 증상 (고객 보고)
- 고객 임베드 편집기에서 **"불러오기"** 클릭 → 모달에 저장된 작업 목록(주문 #466104252618 등)은 보임.
- 그러나 항목을 불러오면 **편집 영역이 빈 화면**. (← Storige 버그, 우리가 수정)
- "닫기" 시 최초 주문 화면으로 복귀. (← bookmoa 호스트 동작, UX 결정 필요)
- 목록이 **로그인 고객의 보관함과 일관**되어야 함. (← 아래 bookmoa 작업)

---

## 1. 연동 구조 (현재 사실 관계)

"불러오기" 목록의 **데이터 소스는 Storige** 입니다:

```
GET https://api.papascompany.co.kr/api/edit-sessions/my
Header: Authorization: Bearer <shop-session JWT>
→ 응답: { sessions: [...], total }   // memberSeqno 기준 + 게스트 제외, 최신순 200건
```

각 session 항목(주요 필드):
| 필드 | 의미 |
|---|---|
| `id` | **sessionId** — 재편집 시 `/embed?sessionId=` 로 전달 |
| `orderSeqno` | 주문번호 |
| `templateSetId` | 템플릿셋 ID — 재편집 URL 에 함께 전달 권장 |
| `status` | `draft`/`editing`/`complete` |
| `updatedAt` | 최종 수정 시각 |
| `coverFileId` / `contentFileId` | 완료 PDF 파일 ID (있으면) |

> 즉 **목록 필터의 핵심은 `memberSeqno`** 입니다. 이게 회원마다 안정적이어야 보관함이 일관됩니다.

---

## 2. bookmoa 필수 작업

### 2-1. ★최우선 — memberSeqno 안정성
shop-session 토큰 발급 시 **로그인 회원에 대해 항상 동일한 실제 회원 식별번호(정수)** 를 `memberSeqno` 로 전달해야 합니다.

```
POST /api/auth/shop-session   (X-API-Key)
Body: { "memberSeqno": <회원 고유번호 정수>, "memberId": "...", "memberName": "..." }
```

- ❌ **세션마다/주문마다 바뀌는 합성 값(UUID 해시 등) 금지.**
  - 이전 연동에서 `memberSeqno=1049737389` 를 "UUID 해시 합성"으로 전달한 사례가 있었는데,
    이 값이 **동일 회원에 대해 항상 같은 값**이면 OK, **로그인/세션마다 달라지면** 보관함 목록이 회원별로 쪼개져 "내 이력"이 안 보입니다.
- ✅ 로그인 회원 = bookmoa 회원 테이블의 PK(또는 변하지 않는 회원 sequence)를 그대로 사용.
- ⚠️ 비회원(게스트)은 별도 — 게스트 세션은 24h 후 자동 삭제되며 `/my` 목록에 안 나옵니다.
  게스트가 로그인/가입하면 게스트 세션을 회원으로 승계(`POST /api/edit-sessions/guest/migrate`, body `{ guestToken }`, 회원 JWT)해야 보관함에 들어옵니다.

**검증**: 같은 회원으로 2개 이상 주문을 편집 후 → `/edit-sessions/my` 가 그 주문들을 모두 반환하면 OK.

### 2-2. 보관함/마이페이지 목록 (택1 또는 병행)

**방법 A (권장·단순) — Storige 목록 직접 조회**
1. 회원 로그인 상태에서 shop-session JWT 발급(2-1).
2. `GET /api/edit-sessions/my` (회원 JWT) 호출 → `sessions[]` 렌더.
3. 각 항목 "이어서 편집" 버튼 → 아래 재편집 URL(2-3)로 편집기 오픈.
4. 썸네일이 필요하면 `coverFileId`/`contentFileId` 로 PDF/미리보기를 표시하거나, 별도 미리보기 이미지를 자체 저장.

**방법 B (보강) — 완료 신호를 bookmoa DB에 적재**
- 편집기는 편집완료 시 부모창으로 postMessage 를 보냅니다(이미 동작 중):
  ```js
  // event: 'editor.complete' (정식 엔벨로프 {source:'storige-editor', event:'editor.complete', payload})
  // payload 주요: { sessionId, coverFileId, contentFileId, orderSeqno ... }
  ```
- bookmoa 호스트가 이 `sessionId` 를 **주문/회원 레코드에 저장** → 보관함을 자체 DB로 렌더 + 재편집 링크 생성.
- 또는 주문 단위로 `GET /api/edit-sessions/external?orderSeqno=<n>` (X-API-Key) 로 조회 가능.

### 2-3. 재편집 진입 URL (필수)
보관함/주문화면의 "이어서 편집/수정" 은 **기존 sessionId 를 전달**해 복원하게 합니다(새로 시작 금지):

```
/embed?sessionId=<id>&templateSetId=<templateSetId>&token=<accessToken>&refreshToken=<refreshToken>&orderSeqno=<n>&parentOrigin=<호스트 origin>
```
- `sessionId` 필수(복원), `templateSetId` 함께 권장(도출 생략·안전), `token`/`refreshToken` 은 사일런트 리프레시용(다일 편집).
- 신규 편집은 종전대로 `templateSetId` 만(또는 + `productId`).

### 2-4. (선택) "닫기" 동선
현재 "닫기" 시 최초 주문 화면으로 복귀합니다. 보관함 UX 상 **닫기 후 보관함으로 이동**을 원하면,
호스트가 `editor.cancel`/`editor.close` 수신 시 보관함 라우팅을 처리하면 됩니다(편집기는 메시지만 발신, 라우팅은 호스트 책임).

---

## 3. Storige(우리)가 이번에 수정하는 것 (bookmoa 작업 아님)
- **불러오기/재편집 시 캔버스 빈 화면** — 멀티페이지/스프레드 canvasData(페이지 배열)를 전 페이지 캔버스에 복원 + 각 캔버스 workspace 보장.
- **편집완료 PDF 오류** `첫 번째 캔버스에서 워크스페이스를 찾을 수 없습니다` — 복원 후 workspace 미보장 → 보장하도록 수정.
- → 위 두 가지가 고쳐지면, bookmoa가 sessionId 만 정확히 넘기면 복원·재편집·완료가 정상 동작합니다.

---

## 4. 한 줄 요약 (bookmoa 액션)
1. **로그인 회원은 항상 동일한 실제 memberSeqno 전달** (보관함 일관성의 핵심).
2. 보관함/마이페이지 = `GET /api/edit-sessions/my`(회원 JWT) 목록 렌더(또는 완료 postMessage sessionId 적재).
3. "이어서 편집" = `/embed?sessionId=&templateSetId=&token=&refreshToken=` 로 재진입.
4. (선택) 게스트→회원 승계 `guest/migrate`, 닫기 동선 보관함 라우팅.

## 5. API 빠른참조
| 용도 | 메서드/경로 | 인증 |
|---|---|---|
| 회원 토큰 발급 | `POST /api/auth/shop-session` | X-API-Key |
| 토큰 갱신(다일 편집) | `POST /api/auth/shop-refresh-body` `{refreshToken}` | 없음(refreshToken) |
| 내 세션 목록 | `GET /api/edit-sessions/my` | 회원 JWT |
| 주문별 세션/파일 | `GET /api/edit-sessions/external?orderSeqno=` | X-API-Key |
| 게스트→회원 승계 | `POST /api/edit-sessions/guest/migrate` `{guestToken}` | 회원 JWT |
| 재편집 진입 | `/embed?sessionId=&templateSetId=&token=&refreshToken=` | URL 토큰 |
