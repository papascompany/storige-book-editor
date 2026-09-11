# [공지] 산출물 무인증 경로 폐쇄(D5 cutover) 실행 완료 — 2026-09-11

- 수신: printy · bookmoa (S3/S4 테넌시 트랙 양사 공통)
- 발송 상태: 미발송 → 세션채널 전달(2026-09-11)
- 선행 문서: `PARTNER_NOTICE_OUTPUT_SIGNED_URL_2026-08-28.md`(서명 URL 재발급·업로드 귀속 공지)

## 1. 실행 사실과 지연 고지

2026-08-28 에 **cutover 실행일 = 2026-09-04** 로 확정 공지드렸으나, 당사 사정으로
**2026-09-11 에 실행**했습니다. **예정일 대비 7일 지연**된 점 먼저 알려드립니다.

지연 구간(9/4~9/11) 동안 종전 무인증 경로는 계속 살아 있었습니다. 즉 **"9/4 이후 410 일 것"을
전제로 두신 코드가 있었다면 그 기간에는 410 이 아니라 200 이 나왔습니다.** 전환을 이미 마치신
양사에는 실질 영향이 없을 것으로 보이나(유예 경로 소비 0 실측), 전제가 어긋났던 구간이므로
명시해 둡니다.

## 2. 무엇이 바뀌었나

`GET https://api.papascompany.co.kr/storage/outputs/...` (무인증 직접 GET)

→ **`410 Gone`** 을 반환합니다. 응답 헤더:

```
HTTP/2 410
x-storige-notice: gone — use GET /api/worker-jobs/external/:id/output-url
cache-control: no-store
```

**무변경**: `/storage/` 하위의 `uploads` · `designs` · `thumbnails` 는 종전 그대로입니다
(실증에서 404 = 경로 생존 확인). 이번 폐쇄는 `outputs` 한 갈래뿐입니다.

## 3. 유일한 회수 경로

```
GET /api/worker-jobs/external/:id/output-url     (X-API-Key)
```

반환된 `files[].url` 을 그대로 GET 하면 됩니다. `separate` 는 cover·content 2건이 모두 담깁니다.
**DB 에는 URL 이 아니라 `jobId` 를 저장**하고 다운로드 시점마다 재발급하세요(멱등·저비용).

## 4. 실증 결과 (2026-09-11 실측)

| 프로브 | 결과 |
|---|---|
| 레거시 무인증 `/storage/outputs/<실제 산출물>` | **410** + `X-Storige-Notice` + `no-store` |
| 레거시 무인증 `/storage/outputs/<없는 파일>` | **410** (동일 — 존재 여부와 무관하게 폐쇄) |
| 재발급 API 로 받은 **유효 서명 URL** | **200** |
| 변조 서명 | 403 |
| 만료 서명 | 410 (재발급 재호출) |
| `/storage/uploads/` · `/storage/designs/` | 404 (경로 생존, 무변경) |
| `api/health` · editor · admin | 200 / 200 / 200 |

## 5. 양사에 부탁드리는 확인 1건

각 사에서 **구 URL 이 410 으로 떨어지는지 1회만 교차 실측**해 회신 부탁드립니다.
(printy 측은 8/28 에 "재통지가 오면 1회 실측" 으로 예약해 두신 항목입니다.)

```bash
curl -i "https://api.papascompany.co.kr/storage/outputs/<보유하신 jobId>/content.pdf"
# 기대: HTTP/1.1 410 Gone + X-Storige-Notice
```

## 6. 갱신된 문서

- `docs/PLATFORM_INTEGRATION_GUIDE.md` §3.4 — 유예 경로 블록을 410 종료로 교체(체크리스트·라우트 표 동시 정합)
- `docs/CONTRACT_FREEZE.md` — 유예(D4) 표기를 폐쇄 완료로 갱신
- `docker/nginx/nginx.conf` — `location /storage/outputs/` 신설
