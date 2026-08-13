# [Storige] 합성 API(compose-mixed) 계약 변경 안내 — 2026-08-13

수신: bookmoa-mobile · 100p Books · MD2Books · ShareSnap (합성 API 사용 예정/사용 중인 모든 연동처)
정본 문서: `docs/PLATFORM_INTEGRATION_GUIDE.md` §3.4 / §3.4.1 / §5.1

> **먼저 결론**: 지금 이 API 를 호출 중인 파트너는 **없습니다**(프로덕션 호출 이력 0건 실측).
> 따라서 **즉시 조치가 필요한 곳은 없고**, 연동 착수 전에 아래 4가지만 확인하시면 됩니다.
> 이번 변경의 목적은 "잘못 호출했는데 성공처럼 보이던" 동작을 없애는 것입니다.

---

## 1. 파일 참조를 빠뜨리면 이제 **400** 입니다 (가장 중요)

**종전**: 표지/내지 URL 을 하나도 안 보내도 `201` 로 잡이 생성되고, 잠시 뒤
**A4 백지 1페이지 PDF 가 `COMPLETED`** 로 산출됐습니다. 즉 실패가 성공처럼 보였습니다.

**변경**: 합성할 자산(표지·내지)이 하나도 없으면 즉시 거부합니다.

```json
HTTP 400
{ "code": "EMPTY_COMPOSE_INPUT",
  "message": "합성할 표지/내지 자산이 없습니다. coverUrl·contentPdfUrl 중 하나 이상이 필요합니다." }
```

⚠️ **이전 가이드의 curl 예시(`{editSessionId, orderId}` 2필드)가 정확히 이 경우였습니다.**
그 예시는 폐기됐습니다 — 새 가이드 §3.4 의 전체 필드 예시를 사용하세요.

**파일 참조 형식 주의**: `https://…` 는 검증에서 거부됩니다. `api://<fileId>` 또는 `/storage/...` 만 사용하세요.

## 2. 결과 PDF 회수 경로가 정정됐습니다

이전 가이드가 안내하던 `GET /api/worker-jobs/:id/output` 은 **사이트 API 키로 호출하면 401** 입니다
(내부 관리자 전용 라우트). 파트너 경로가 아니었습니다.

**올바른 회수 절차**

```bash
# 1) 상태·산출 경로 조회
curl "https://api.papascompany.co.kr/api/worker-jobs/external/<jobId>" -H "X-API-Key: <SITE_API_KEY>"
#    → outputFileUrl, result.outputFiles[]

# 2) 그 경로를 그대로 GET
curl "https://api.papascompany.co.kr/storage/outputs/<jobId>/content.pdf" -o content.pdf
curl "https://api.papascompany.co.kr/storage/outputs/<jobId>/cover.pdf"   -o cover.pdf   # separate 모드
```

- `outputMode=separate`(스프레드 책은 서버가 강제) 에서는 **`outputFileUrl` 이 `content.pdf` 하나만** 가리킵니다.
  표지는 `result.outputFiles[]` 에서 `cover.pdf` 항목을 **따로** 받아야 합니다.
- 🔒 **산출물 URL 은 비밀로 취급하세요.** 이 경로는 무인증 공개이며 접근 통제가 `jobId`(UUID) 은닉에만 의존합니다.
  로그·클라이언트 코드·고객 화면에 노출하지 마세요.

## 3. `siteId` 는 파트너가 채우는 필드가 아닙니다

요청 본문의 `siteId` 는 이제 **검증된 세션 정보와 일치할 때만** 채택되고, 그 외에는 무시됩니다(잡은 정상 생성).
사이트 귀속은 서버가 판단합니다 — 보내지 마세요.

## 4. (신규·선택) 세션 자동 조립 — `assembleFromSession`

편집 세션 하나로 합성 입력을 서버가 채워주는 경로가 추가됐습니다. **선택 기능이며, 안 쓰면 기존과 동일합니다.**

```bash
curl -X POST "https://api.papascompany.co.kr/api/worker-jobs/compose-mixed" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <shop-session accessToken>" \
  -d '{ "editSessionId": "<uuid>", "assembleFromSession": true, "orderId": "ORD-…" }'
```

- 서버가 표지·내지·면지·판형을 세션에서 도출합니다. **직접 보낸 값이 항상 우선**합니다(빈 자리만 채움).
- **인증 필수**: 검증된 shop-session 토큰이 있어야 하고, 그 토큰의 사이트·주문 범위와 세션이 일치해야 합니다.
  불일치·미인증은 전부 `404 SESSION_NOT_FOUND` 입니다(세션 존재 여부를 노출하지 않기 위함).
- 도출 실패 시 `400 SESSION_ASSEMBLY_INCOMPLETE` + `missing[]` 로 어떤 조각이 없는지 알려줍니다.
- 편집 가능한 면지(frontEditable/backEditable=true)는 저장 스키마가 없어 자동 조립 대상이 아닙니다 — 직접 공급하세요.

---

## 확인 요청

1. 합성 API 연동 착수 전에 새 가이드 §3.4 예시로 **실제 1회 호출 테스트**를 해 주세요(빈 입력 400 확인 포함).
2. 결과 회수를 `download/external` 또는 `:id/output` 으로 구현해 두신 곳이 있으면 위 2번 절차로 교체해 주세요.
3. 웹훅을 받으실 거면 요청에 **`callbackUrl` 을 직접 포함**해 주세요 — 사이트 기본값을 자동 상속하지 않습니다.

문의는 Storige 운영팀으로 회신 주시면 됩니다.
