# Storige 연동 안내 (2026-08-28) — 합성 산출물 서명 URL + 업로드 테넌트 귀속 (printy · bookmoa 공통)

- 발신: Storige 운영 (papascompany)
- 적용 시점: **2026-08-28 프로덕션 반영 완료** (전부 additive — 기존 연동 무중단, 즉시 조치 불요)
- 배경: printy 감사 문의(S2~S4) → 양사 정렬 → 오너 결정(D1·D3·D4). 사실 확정 회신(2026-08-27)의 후속 조치입니다.

## 1. 신설 ① — 합성 산출물 **서명 URL 재발급 API** (S4/S2 해소)

compose-mixed 등 합성 산출물의 **인증 회수 경로가 생겼습니다** — "인증 경로가 존재하지 않는다"던 상태의 해소입니다.

```
GET /api/worker-jobs/external/<jobId>/output-url      (X-API-Key)
→ { jobId, expiresInSec: 300,
    files:[ {name:"content.pdf", url:"/storage-signed/outputs/…?md5=…&expires=…"}, … ] }
```

- `files[]` 에 잡의 **모든 산출물**이 옵니다(`separate` 는 cover·content 2건 — 종전 "cover 는 못 받는" 제약 없음).
- 서명 URL 은 **단명(기본 300초)** 입니다. **DB 에는 URL 이 아니라 `jobId` 를 저장**하고, 다운로드 시점마다 재발급하세요(멱등·저비용). 만료는 `410`, 서명 불일치는 `403`, 타 테넌트 잡은 `404` 입니다.
- 라이브 실증 완료: 발급 200 · 서명 GET 200 · 변조 403 · 만료 410 · 무키 401.

**유예(grandfathering)**: 종전 무인증 `/storage/outputs/…` 직접 GET 은 cutover 전까지 그대로 동작합니다.

> **[확정 2026-08-28] cutover 실행일 = 2026-09-04.** 양사 전환 완료(printy ⓐ·ⓑ 배포+e2e 통과 / bookmoa ⓑ 귀속 실측+ⓐ 코드 불요 판명)와 최소 1주 공지 약속을 충족해 확정합니다. 9/4 부터 무인증 `/storage/outputs/` 는 `410 Gone` 으로 닫히며, 회수는 서명 URL 재발급 API 로만 가능합니다. 다른 `/storage/` 하위(uploads·designs·thumbnails)는 무변경입니다.

## 2. 신설 ② — 업로드 완료 시 테넌트 귀속 (S3 1단계)

presigned 업로드의 `complete`(single `:id/complete` · `multipart/complete`)에 **shop-session Bearer 를 함께 실으면**, 그 파일이 귀사 사이트로 귀속(site 스탬프)됩니다. 귀속된 파일은 테넌트 격리가 적용됩니다 — **다른 사이트 키로는 조회·삭제가 404 로 차단**됩니다(라이브 교차 실증 완료).

```
Authorization: Bearer <SHOP_SESSION_JWT>    # POST /api/auth/shop-session (X-API-Key) 로 발급
```

- Bearer 없이 호출하면 **종전과 완전히 동일**합니다(무중단). 단 그 파일은 무귀속(NULL)으로 남아 격리 대상이 아닙니다 — "동거 테넌트의 무소유 삭제" 우려(S3)는 **귀속된 파일부터** 닫힙니다.
- 이행 권장: 업로드 완료 호출에 헤더 1줄 추가입니다.

## 3. 각 사 권장 조치 (요청 아님 — 전환 시점은 자율, cutover 전까지)

| 파트너 | 조치 | 규모 |
|---|---|---|
| printy | ① 서버 중계(proxy-download)의 compose-mixed 분기를 재발급 API 소비로 전환 ② complete 에 Bearer 첨부 | 소 |
| bookmoa | ① 주문 항목의 "산출물 URL 박제"를 **jobId 저장**으로 전환 + 다운로드 시 재발급 소비(R-92 서명 URL 경험 재사용) ② complete 에 Bearer 첨부 | 1~2일(자체 추산) |

전환이 끝나면 알려주세요 — **cutover(무인증 경로 종료) 날짜를 그때 조율**합니다.

## 4. 계약 등재

신설 라우트는 등재 시점부터 동결 계약(ADDITIVE→FROZEN)입니다 — 경로·인증 시맨틱이 CI 게이트로 고정돼 예고 없이 바뀌지 않습니다. 가이드 §3.4·§5.1·§2.2 가 갱신돼 있습니다.

## 문의

전부 라이브 실증 기반입니다. 추가 확인·전환 지원은 같은 채널로.
