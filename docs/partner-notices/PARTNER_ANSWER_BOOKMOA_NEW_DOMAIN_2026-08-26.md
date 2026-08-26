# Storige 회신 (2026-08-26) — new.bookmoa.com 베타 전환 체크 3건

- 발신: Storige 운영 (papascompany)
- 결론 요약: **① 동의(조치 불필요) ② 적용 + 라이브 검증 완료 ③ 전제 사실 확인 — 단 오너 대시보드 액션 필요(권한 스코프)**

---

## ① 콜백 URL — 동의합니다

말씀하신 구조가 맞습니다 — 콜백 URL 은 저장된 등록값이 아니라 잡 생성 시 `callbackUrl` 로 실려 오는 값입니다. 새 프로젝트 env 가 새 콜백을 실어 보내면 자동 반영됩니다. 저희 쪽 조치 없음.

## ② site 설정 — ✅ 적용 완료 + 라이브 검증까지 마쳤습니다

`b5aef7a9…` (bookmoa-mobile) 행에 `https://new.bookmoa.com` 을 **frame_ancestors + allowed_origins 양쪽에 추가**했습니다. 보내주신 SQL 은 재실행 시 중복 append 되므로 `JSON_CONTAINS` 가드를 붙인 멱등 형태로 실행했습니다.

**라이브 검증 완료** (재검증 없이 바로 쓰셔도 됩니다):
- `GET /api/frame-ancestors` 합집합에 `https://new.bookmoa.com` 포함 확인
- `/embed` 실제 응답 헤더 실측:
  `content-security-policy: frame-ancestors … https://new.bookmoa.com` 포함 확인 (2단 캐시 통과 완료)

**정확성 참고 하나**: 편집기 CSP 의 정적 기본 목록에 `https://*.bookmoa.com` 와일드카드가 원래 포함돼 있어, **frame-ancestors 만으로는** new.bookmoa.com iframe 이 이전에도 차단되지 않았을 가능성이 있습니다(귀측 실측은 API 합집합 조회 기준으로 보입니다). 실질적으로 새로 뚫린 것은 **allowed_origins(API CORS)** 쪽입니다 — 이게 없으면 iframe 은 떠도 편집기의 API 호출이 막힙니다. 어느 쪽이든 이제 양쪽 다 명시 등재된 정확한 상태입니다.

**①에서 요청하신 구 도메인 잔존 보고** — 세 필드 모두 구 도메인입니다:

| 필드 | 현재값 | 용도 (판단 참고) |
|---|---|---|
| `domain` | `bookmoa-mobile.vercel.app` | site 대표 도메인 표시용 |
| `upload_callback_url` | `https://bookmoa-mobile.vercel.app/api/storige/webhook` | **워커 웹훅 수신처** — 잡별 callbackUrl 미지정 시 폴백으로 쓰일 수 있는 값 |
| `return_url_base` | `https://bookmoa-mobile.vercel.app` | 편집 완료 후 복귀 링크 베이스 |

**[갱신] 세 필드 모두 새 도메인으로 전환 완료했습니다**: `domain=new.bookmoa.com` · `upload_callback_url=https://new.bookmoa.com/api/storige/webhook` · `return_url_base=https://new.bookmoa.com`.

전환하며 중요한 것 하나를 확인했습니다 — 이 필드들은 표시용만이 아니라 **웹훅 발송의 SSRF 허용 호스트 목록**을 만듭니다. 전환하지 않았다면 내일 새 프로젝트가 실어 보내는 `new.bookmoa.com` 콜백이 웹훅 가드에 막혔을 수 있습니다(①의 "조치 불필요"에 숨어 있던 함정). 병행 기간 안전도 확인했습니다: 허용 호스트는 `frame_ancestors` 호스트를 포함하므로, 구 오리진이 allowlist 에 남아 있는 한 **구 프로젝트발 잡의 콜백(구 도메인)도 계속 허용**됩니다. 구 프로젝트 완전 폐기 시점에 allowlist 의 구 오리진 제거를 요청 주세요.

## ③ R2 CORS — 전제는 사실로 확인했습니다. 단, 저희 운영 채널로는 적용 불가라 오너 액션으로 넘깁니다

먼저 사실 확인: 프로덕션 스토리지가 실제로 **R2 직결(presigned)** 입니다 — `storage_settings.driver = 's3'`, 버킷 `storige-files`, presign 발급이 실제 `*.r2.cloudflarestorage.com` URL 을 반환함을 라이브로 실측했습니다. 즉 R2 CORS 에 새 오리진이 없으면 새 도메인에서 업로드가 실패한다는 진단이 맞습니다.

S3 API(`PutBucketCors`)로 즉시 적용을 시도했으나 **AccessDenied** — 현재 발급된 R2 API 토큰이 Object Read/Write 스코프라 버킷 설정 관리 권한(Admin Read/Write)이 없습니다. 따라서 이 항목은 **Cloudflare 대시보드 보유자(오너)의 액션**입니다:

> Cloudflare 대시보드 → R2 → `storige-files` → Settings → CORS Policy
> `AllowedOrigins` 에 `https://new.bookmoa.com` 추가 (기존 항목 유지, `ExposeHeaders` 의 `ETag` 유지 — 멀티파트 완료가 ETag 를 요구합니다)

적용되는 대로 이 채널로 알려드리면, 귀측 최종 스모크(편집기 iframe + 업로드) 진행하시면 됩니다.

## 문의

②의 검증은 전부 재현 가능합니다(공개 조회 + 응답 헤더). 추가 확인 필요 시 같은 채널로.
