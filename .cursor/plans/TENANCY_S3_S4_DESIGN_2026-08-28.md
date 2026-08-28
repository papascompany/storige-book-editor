# 테넌시 S3·S4 설계안 — 오너 결정 상신 (2026-08-28)

> **성격**: 오너 결정 게이트에 올리는 **제안**이다. 구현 아님, 코드 무변경.
> **입력**: 정렬 스캐폴드 `TENANCY_S3_S4_DECISION_TRACK_2026-08-28.md`(확정 사실+대안 판정),
> printy 회신 `docs/partner-notices/PARTNER_ANSWER_PRINTY_UPLOAD_TENANCY_2026-08-27.md`,
> bookmoa-mobile-65 세션 정렬 답변(2026-08-28).
> **정본 근거**: `CONTRACT_FREEZE.md §4.3`, `PLATFORM_EXPANSION_PLAN_2026-07-03.md §8`.

## 0. 결정 요청 요약

두 표면이 미결 오너 트랙(2026-07-03~)에 묶여 있고, 파트너 정렬이 끝나 이제 방향을 결정할 수 있다.

| # | 표면 | 저장/서빙 | 권고 축 | 결정 필요 |
|---|---|---|---|---|
| S3 | presigned 고객 원본 `files.site_id=NULL` + 무소유 hardDelete | R2 | A안(complete 옵션형 스탬프) → 이원 정책 → NULL-파괴 게이트 | 이원 정책 화이트리스트 승인 · 파괴 게이트 시점 |
| S4 | compose-mixed 산출물 무인증 공개 | **워커 로컬 디스크 + nginx** | nginx `secure_link` 서명 URL(outputs 한정) + **재발급 API**(bookmoa blocker) | 서명 URL 발급 권한 주체 · grandfathering 방식 · cutover 날짜 |

**두 파트너 정렬 핵심**: bookmoa 는 산출물 공개 URL 을 **클라이언트에 직접 노출**(printy 는 서버 중계) →
**S4 가 S3 보다 노출이 크고 우선**. bookmoa 는 조이는 방향을 지지하되(자사 R-92 에서 동일 전환 전례),
**기존 주문에 박제된 구 URL 이 죽으면 과거 다운로드가 전부 깨진다**는 blocker 를 걸었다.

## 1. 실현가능성 — 실측 확정

- nginx: `--with-http_secure_link_module` + `--with-http_auth_request_module` **둘 다 포함**(2026-08-28 `nginx -V` 실측). 서명 URL·인증 위임 모두 가능.
- compose-mixed 산출물 = 워커 **로컬 디스크** `/app/storage/outputs/<jobId>/{cover|content|pages|merged}.pdf`(R2 아님), nginx `location /storage/ { alias /app/storage/; }` 무인증 서빙. → secure_link 가 이 구조에 자연스럽다(R2 presign 불필요).
- presigned 고객 파일 = R2, `files.site_id=NULL` 237건(printy 0·bookmoa 3·MD2 1), `DELETE /files/:id/external` 즉시 hardDelete.

## 2. S3 설계 — presigned 파일 테넌트 귀속

### 2-A. 1단계: complete 시 옵션형 site 스탬프 (동결 저촉 없음)

- **무엇**: `POST /files/:id/complete`·`multipart/complete` 에 `OptionalShopJwtGuard`(절대 거부 안 하는 옵션 가드) 부착 → caller 를 `completeSingle/completeMultipart` 에 전달(두 서비스 함수는 **이미 caller 파라미터 기구현**). caller 가 shop-session 이면 그 siteId 로 파일 스탬프, 없으면 종전대로 NULL.
- **동결 저촉 없음 근거**: contract-freeze.spec 은 경로·메서드·IS_PUBLIC·ApiKeyGuard 유무·Throttle 만 단언(핸들러 내부 로직 비대상). 이 변경은 `@Public` 유지·ApiKeyGuard 불추가라 스펙 무변경.
- **커버 범위**: shop-session Bearer 를 실어 complete 하는 파트너만(bookmoa 는 R-104 상 presigned 직결이므로 **업로드에 Bearer 를 붙이도록 클라 1줄 추가하면 커버**). 100p 의 키없는 server-to-server·게스트 편집기는 여전히 NULL → **부분 개선, 봉합 아님**.
- **diff 규모**: 컨트롤러 2핸들러 + 가드 부착. 서비스 로직은 기존 재사용.

### 2-B. 이원 정책 (계획서 §8 처방) — 🔴 오너 결정

신규 파일은 A안으로 site 귀속, 기존 NULL 의존분은 화이트리스트로 보호:
- **결정 1**: NULL-site 파일에 대한 파괴/조회 허용을 유지할 파트너 화이트리스트 = 현재 NULL 의존 파트너(100p·MD2·게스트 경로). 이 목록을 `assertSiteAccess` 가 참조.
- **결정 2**: 화이트리스트 밖 신규 NULL 생성을 **경고→차단**으로 승격하는 시점.

### 2-C. NULL-파괴 게이트 (D안) — A/B 선행 필수

`DELETE /files/:id/external`·`expiry/external` 의 NULL-pass 를 좁힌다. **단 A안으로 신규 파일이 스탬프되고 파트너가 키 첨부를 이행한 뒤**에만 — 지금 단독 시행하면 100p/MD2 의 대용량 무인증 파일 정리가 깨진다(그들의 회수·삭제 대상이 전부 NULL 파일). → **최종 단계, 관측 후 게이트**.

## 3. S4 설계 — compose-mixed 산출물 회수

### 3-A. 축: nginx secure_link 서명 URL (outputs 경로 한정)

- **무엇**: `location /storage/outputs/` 를 별도 블록으로 분리해 `secure_link` + `secure_link_md5` 검증. 서명 없는/만료된 요청은 403. **`/storage/uploads`·`designs`·`thumbnails` 등 나머지는 무변경**(게스트 편집기 UX·라이브러리 무영향 — editor/admin 은 outputs 미참조, grep 실측).
- **서명 URL 발급 = API 신규 라우트**. worker_jobs 에서 outputFileUrl 조회 → `md5(secret + path + expiry)` 해시 계산 → `?md5=…&expires=…` 붙은 URL 반환.
- **🔴 결정 3 (발급 권한 주체)**: 누가 서명 URL 을 받을 수 있는가?
  - (a) 사이트 API 키(X-API-Key) + 잡 site 대조 — 파트너 서버가 발급
  - (b) shop-session Bearer — 세션 소유 검증
  - (c) 주문 소유 증명(bookmoa order-design 프록시 패턴) 위임
  - 권고: **(a) 기본 + 잡이 NULL-site 면 화이트리스트 파트너 키만**(S3 이원 정책과 정합).

### 3-B. 🔴 grandfathering — bookmoa blocker 해소 (필수)

기존 주문에 박제된 구 공개 URL 을 죽이지 않는다. 두 방식 택1(결정 4):
- **방식 A (유예 서빙)**: cutover 후 N개월간 구 무인증 URL 을 계속 서빙(secure_link 를 신규 잡에만 적용, 기존 outputs 디렉터리는 유예). 단순하나 유예 기간 동안 기존 URL 노출 잔존.
- **방식 B (재발급 API, 권고)**: `GET /worker-jobs/:id/output-url`(인증) → 항상 유효한 서명 URL 재발급. 클라이언트가 만료 시 재조회. bookmoa 가 "박제 URL 대신 jobId 저장 → 필요 시 재발급"으로 전환하면 구 URL 즉시 폐기 가능. **bookmoa 코드 1~2일**(R-92 서명 URL 소비 경험 재사용).
- 권고: **B 를 정식 경로로 + A 를 전환 유예로 병행**. bookmoa 는 B 소비로 전환, printy 는 무영향(서버 중계라 URL 미사용).

### 3-C. cutover 계획 (무중단)

1. 서명 URL 발급 API + nginx secure_link(outputs 한정) 배포 — **기존 무인증 URL 은 아직 유효**(secure_link 를 신규 잡부터, 또는 유예 플래그)
2. 가이드 §3.4·5.1 갱신 + 파트너 공지(bookmoa 요청: **1주 전 + 이 채널**)
3. bookmoa 재발급 API 소비 전환(1~2일), printy 무영향 확인
4. 관측 후 outputs 무인증 서빙 종료 — bookmoa 가 날짜 확정
5. grandfathering 유예분(방식 A) 만료 스케줄

## 4. 회귀 테스트 계획

- contract-freeze.spec: S3 A안 후 스펙 무변경 확인(가드 시맨틱 유지). S4 신규 라우트는 파트너 표면이면 동결 등재.
- 신규: secure_link 검증(유효 서명 200·만료 403·미서명 403), 재발급 API 인증(사이트 키 site 대조·NULL 잡 화이트리스트), A안 스탬프(Bearer 있으면 site·없으면 NULL·위조 무시).
- 무중단 가드: uploads/designs/thumbnails 는 secure_link 미적용 유지(게스트 UX 회귀 방지).

## 5. 오너 결정 게이트 — 상신 항목

| 결정 | 선택지 | 권고 |
|---|---|---|
| D1. S3 A안 배선 착수 | 예/아니오 | **예**(저촉 없음·부분개선·즉시 가능) |
| D2. 이원 정책 화이트리스트 | 파트너 목록 확정 | 100p·MD2·게스트 경로 |
| D3. S4 서명 URL 발급 권한 | (a)키/(b)Bearer/(c)주문증명 | (a)+NULL 잡 화이트리스트 |
| D4. grandfathering | 유예/재발급/병행 | **재발급 API + 유예 병행** |
| D5. cutover 날짜 | bookmoa 조율 | 1주 공지 후 bookmoa 확정 |
| D6. NULL-파괴 게이트(D안) 시점 | A안 관측 후 | 최종 단계 |

## 6. 단계 로드맵 (승인 시)

1. **S3 A안**(저위험·독립) → 배포 → 신규 파일 스탬프 관측
2. **S4 서명 URL 발급 API + nginx secure_link(outputs, 신규 잡)** → 배포(기존 URL 유효)
3. 가이드 갱신 + 파트너 1주 공지
4. bookmoa 재발급 소비 전환 → cutover(무인증 종료) → printy 무영향 확인
5. 관측 후 **S3 NULL-파괴 게이트(D안)** + 이원 정책 차단 승격

각 단계는 독립 배포 가능하고 이전 단계 무중단을 깨지 않는다. **1·2 는 D1·D3·D4 승인 즉시 착수 가능.**
