# [긴급 확인 요청] bookmoa — 합성 산출물 다운로드가 파트너 사용 불가 라우트를 호출 중

- 수신: bookmoa
- 발송 상태: 미발송 → 세션채널 전달(2026-09-11)
- 성격: **D5 cutover 와 무관한 별건.** cutover 이전부터 이미 파손 상태였을 개연성이 높습니다.

## 1. 무엇을 발견했나

`bookmoa-mobile` 의 산출물 프록시가 **jobId 모드에서** 다음 라우트를 호출하고 있습니다.

```js
// api/storige/files/proxy-download.js:100
upstreamUrl = `${apiBase}/worker-jobs/${encodeURIComponent(jobId)}/output`;
// :107
headers: { "X-API-Key": apiKey }
```

그런데 `GET /api/worker-jobs/:id/output` 은 **파트너 경로가 아닙니다.**

## 2. 근거 (당사 코드·라이브 실측)

| 근거 | 내용 |
|---|---|
| `apps/api/src/auth/auth.module.ts:48` | 전역 `APP_GUARD` 로 **`JwtAuthGuard`** 등록 — 모든 라우트는 기본 JWT 필요 |
| `apps/api/src/worker-jobs/worker-jobs.controller.ts:623` | `@Get(':id/output')` 에 **`@Public()` 도 `@UseGuards(ApiKeyGuard)` 도 없음** (바로 위 `@Get('external/:id')` 에는 둘 다 있음) |
| 결론 | `X-API-Key` 는 JWT 가 아니므로 **유효한 사이트 키로 호출해도 `401`** |
| 라이브 실측 (2026-09-11) | 무인증 `401` · 임의 키 `401` |
| 당사 가이드 `PLATFORM_INTEGRATION_GUIDE.md` §3.4 | 이미 명시되어 있었습니다 — *"`GET /api/worker-jobs/:jobId/output` 은 파트너 경로가 아닙니다 … 유효한 사이트 API 키로 호출해도 `401` 입니다(2026-08-13 실측). 내부 JWT(admin 미리보기) 전용"* |

이 라우트는 **Admin Before/After 미리보기 전용**(내부 JWT)입니다.

## 3. 왜 지금까지 드러나지 않았을 가능성

프록시가 업스트림 실패를 일반 메시지로 마스킹하면, 401 이 "원본 파일을 가져올 수 없습니다" 류로
보여 원인 추적이 어려웠을 수 있습니다. 또한 8/28 원장 R-149 의 "산출물 다운로드는 전 경로가 이미
jobId 경유 → 코드 변경 불요" 판정은 **라우팅 감사에 근거**했고, jobId 모드의 라이브 200 실측은
수행되지 않았습니다. 같은 코드베이스에서 출발한 printy 는 8/28 에 실제로 호출해 보고 고객
다운로드 화면이 깨져 있음을 발견해 서명 URL 재발급으로 전환했습니다.

## 4. 확인 부탁드리는 것 (실측 1회)

```bash
# 보유하신 완료 jobId 로 1회
curl -i -H "X-API-Key: <bookmoa 사이트 키>" \
  "https://api.papascompany.co.kr/api/worker-jobs/<jobId>/output"
# 401 이면 현재 고객 합성 PDF 다운로드가 파손 상태입니다
```

## 5. 조치 방향

`/worker-jobs/:id/output` → **`GET /api/worker-jobs/external/:id/output-url`** (서명 URL 재발급)로 전환.
반환된 `files[].url` 을 그대로 GET 하면 됩니다. printy 가 8/28 에 적용한 것과 동일한 전환입니다.

> 참고: 이 전환은 D5 cutover(무인증 `/storage/outputs/` 폐쇄)와 **독립**입니다. cutover 이후에는
> 두 실패(이 라우트의 `401`, 레거시 정적 경로의 `410`)가 프록시에서 같은 메시지로 합쳐질 수 있으니,
> 원인 분리를 위해 이 건을 먼저 확정해 주시길 권합니다.
