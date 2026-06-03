# [bookmoa 전달] 편집완료 후 최종 인쇄 PDF 합성 트리거 + 게스트/회원 세션 (2026-06-03 #2)

> 직전 지시(§2/§3) 완료 보고 확인했습니다. 아래는 **이번 Storige 멀티페이지 PDF 수정에 따라 새로 필요한 bookmoa 작업**과, 라이브에서 본 "비회원" 배너 관련 확인 사항입니다.

---

## A. ★편집완료 후 "최종 인쇄 PDF 합성" 트리거 (스프레드 책 필수)

### 배경
- Storige 편집기가 **편집완료 시** 스프레드 책의 **표지(cover) PDF + 내지(content) 멀티페이지 PDF 를 각각 생성·업로드**하고 세션에 `coverFileId`/`contentFileId` 를 기록하도록 수정됐습니다.
- 단, **스프레드 책은 편집완료가 합성(merge)을 자동 트리거하지 않습니다.** (펼침면은 일반 사이즈 검증과 충돌 → PHP/bookmoa 주도 합성 설계.)
- 따라서 **최종 1개 인쇄용 합본 PDF**를 얻으려면 **bookmoa가 `compose-mixed` 를 명시 호출**해야 합니다.

### 흐름
```
편집기 편집완료
  → postMessage 'editor.complete' { payload: { sessionId, orderSeqno, files:{coverFileId, contentFileId} } }
  → (bookmoa 수신) 표지/내지 파일 URL 확보
  → POST /api/worker-jobs/compose-mixed  호출
  → (워커 합성) callbackUrl 으로 완료 통지(outputFileUrl)
  → 주문에 최종 PDF 연결
```

### 1) 표지/내지 파일 URL 확보
`editor.complete` payload 의 `coverFileId`/`contentFileId` 로부터 PDF URL 을 얻습니다. 주문번호로 한 번에 조회 권장:
```
GET /api/edit-sessions/external?orderSeqno=<n>     (헤더: X-API-Key)
→ files.cover, files.content (PDF URL) 반환
```

### 2) compose-mixed 호출
```
POST /api/worker-jobs/compose-mixed     (현재 @Public — 서버 간 호출, 향후 X-API-Key 예정)
Content-Type: application/json
{
  "editSessionId": "<sessionId>",
  "coverUrl":      "<표지 PDF URL>",          // 표지 cover PDF
  "coverEditable": true,
  "coverWidthMm":  <표지 스프레드 폭mm>,        // 표지=펼침 전체 폭
  "coverHeightMm": <표지 높이mm>,
  "contentPdfUrl": "<내지 멀티페이지 PDF URL>",  // 내지 content PDF
  "contentWidthMm":  <내지 1면 폭mm>,           // 내지=단면(책등 제외)
  "contentHeightMm": <내지 높이mm>,
  "frontEndpaperUrls": [],                      // 면지 있으면 URL 배열(없으면 생략)
  "backEndpaperUrls":  [],
  "outputMode": "single",                       // 스프레드 책 합본 = single
  "orderId": "<주문번호>",
  "callbackUrl": "<bookmoa 합성완료 수신 URL>"
}
→ 200 { id, status:'PENDING', ... }
```
- **outputMode**: 표지+내지 **합본 1개**는 `single`. (분리 보관이 필요하면 `separate`, 내지만이면 `content-only`.)
- 출력 순서(워커 고정): `[표지, 앞면지…, 내지, 뒷면지…]`.
- 사이즈는 주문 판형 기준(표지=펼침 전체, 내지=단면). Storige `external` 응답/세션 metadata 의 `spreadContentPageCount` 도 참고 가능.

### 3) 완료 수신
워커가 `callbackUrl` 로 완료 통지:
```
{ event:'synthesis.completed', jobId, sessionId, status:'completed',
  outputFileUrl:'/storage/outputs/<job>/merged.pdf', outputFormat:'single', capability:'compose-mixed' }
```
이 `outputFileUrl` 을 주문 최종 인쇄물로 연결.

> 단면/일반(비스프레드) 상품은 종전대로 단일 PDF(cover 또는 content)만 생성되며, 합성이 필요 없으면 compose-mixed 생략 가능.

---

## B. "비회원으로 작업한 디자인은 24시간 후 자동 삭제됩니다" 배너 — 확인 요망

### 표시 조건
이 배너는 **현재 세션이 게스트 세션일 때만**(세션에 `guestToken` 존재) 표시됩니다. **로그인 회원 세션이면 표시되지 않습니다.**

### 라이브에서 회원인데 배너가 보였다면 (택1 확인)
1. **고객이 비로그인(게스트 체크아웃)** 이었다면 → 배너 정상. 저장/주문 시 로그인 유도(아래 3) 필요.
2. **로그인 회원인데 배너가 보였다면 → 회원이 게스트로 처리된 것.** 원인 후보:
   - 편집기 진입 시 **token(회원 JWT) 미전달/만료** → 회원 세션 생성 실패 → 게스트 폴백.
   - **과거 게스트로 생성된 sessionId 를 그대로 재편집** → 그 세션은 계속 게스트.

### bookmoa 처리
- **회원 세션 보장**: 로그인 회원은 진입 URL 에 항상 유효한 회원 `token`(+`refreshToken`) 전달 → 회원 세션 생성(배너 없음).
- **게스트→회원 승계**: 게스트로 시작했다가 로그인하면 로그인 직후
  `POST /api/edit-sessions/guest/migrate { guestToken }` (회원 JWT) 호출 → 게스트 세션이 회원 보관함에 편입(24h 삭제 제외).
- **`editor.needAuth` 수신**: 게스트가 편집완료 누르면 편집기가 `editor.needAuth` postMessage 발신 → bookmoa 가 로그인 페이지로 유도 → 로그인 후 승계(위) → 재완료.
- **재편집 sessionId**: 회원이 이어서 편집할 땐 **그 회원 소유의 sessionId** 를 전달(게스트 세션 ID 재사용 지양). 보관함 목록(`GET /api/edit-sessions/my`)이 회원 세션만 반환하므로 이 목록의 id 를 쓰면 안전.

---

## C. Storige(우리)가 이번에 함께 수정/검증 (bookmoa 작업 아님)
- 재편집 복원 시 "디자인을 적용하는 중" 오버레이가 늦게 닫히던 근본(표지 loadJSON 콜백 미발화) 수정 + 타임아웃 단축.
- 편집완료 멀티페이지 PDF(표지 cover + 내지 content) 실QA.

## 한 줄 요약 (bookmoa 액션)
1. **편집완료(`editor.complete`) 수신 → `POST /api/worker-jobs/compose-mixed`(outputMode `single`) 호출 → 최종 합본 PDF 획득.** (스프레드 책 필수)
2. 회원은 유효 token 전달로 **회원 세션 보장**(배너 없음), 게스트는 **로그인 후 `guest/migrate` 승계** + `editor.needAuth` 처리.
