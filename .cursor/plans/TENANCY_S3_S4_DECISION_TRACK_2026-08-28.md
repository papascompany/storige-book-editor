# 테넌시 S3·S4 결정 트랙 — 정렬 스캐폴드 (2026-08-28)

> **상태**: (C) 경로 진행 중 — printy 회신 완료(발송 대기) → **bookmoa 답 정렬 대기** → 설계안 상신.
> 이 문서는 설계안이 아니라 **정렬용 씨앗**이다. bookmoa 답이 도착하면 그 요구를 여기에 접합해
> `TENANCY_S3_S4_DESIGN_<날짜>.md` 로 승격한다. 지금 단계에서 코드는 건드리지 않는다.

## 왜 이 트랙이 전역인가

printy 문의 S3(presigned NULL-site)·S4(compose-mixed 산출물 공개)는 **printy 고유가 아니다.**
같은 표면을 **bookmoa-mobile·100p·MD2Books·ShareSnap 이 공유**한다 — 한 파트너 문의만으로 상류를
조이면 다른 파트너를 깬다. 그래서 개별 회신이 아니라 **플랫폼 결정 트랙**으로 올린다.

| 이슈 | 공유 파트너 | 이미 인지된 정본 |
|---|---|---|
| S3 presigned `files.site_id=NULL` + 무소유 삭제 | 전 파트너 고객 업로드(printy·bookmoa·100p·MD2) | `PLATFORM_EXPANSION_PLAN_2026-07-03.md §8`(격리 결함), `CONTRACT_FREEZE.md §4.3` |
| S4 compose-mixed 산출물 무인증 공개 `/storage/outputs/` | compose-mixed 사용자(printy·bookmoa-mobile) | `worker-jobs.controller.ts` 주석(2026-07-03 기록·08-13 재확인), `CONTRACT_FREEZE.md §4.3` |

## 확정된 사실 (printy 회신 근거 — 재조사 불요)

- `files.site_id`: 라이브 NULL 237(live 225) / printy 귀속 0 / bookmoa-mobile 3 / MD2Books 1
- 실질 공격자 집합 = **유효 editor 키 활성 테넌트 8곳**(익명 아님, 신뢰 경계 내부)
- `DELETE /files/:id/external` = 즉시 **hardDelete**(R2 객체+DB 행, 48h 복구창 없음), NULL-pass 로 타 테넌트 통과
- presigned 확정 파일 `expires_at=NULL`(영구), retention sweep 미대상
- compose-mixed 산출물 = `/storage/outputs/<jobId>/*.pdf`, nginx `alias` 무인증 + CORS `*`, jobId=uuidv4(122bit)
- R2 List 불가(r2.dev 비활성), 버킷 CORS 에 printy 커스텀 도메인 이미 포함(라이브 204)

## 결정이 필요한 것 (오너)

### S3 — presigned 파일 테넌트 귀속

이미 스코프된 대안 A~D(printy 회신 §S3-Q3-3 판정):

| 안 | 동결 저촉 | 판정 |
|---|---|---|
| **A. complete 시 옵션형 site 스탬프** | 없음(핸들러 내부 로직은 동결 밖) | **1단계 권장** — diff 작음, shop-session 제시분만 커버 |
| B. 발급 시 site 바인딩 | 강제형=명시 위반, 옵션형만 | A 와 동일 부분 커버 |
| C. key prefix | B 제약 + assertSiteAccess 가 키 미파싱 | 실효 0, 최하 |
| D. 파괴 연산만 소유 검증 | DELETE external 동결 목록 실재 | 최종 상태로 옳으나 **A/B 선행 없이 단독 금지**(100p/MD2 정리 플로우 직격) |

이원 정책(계획서 §8 처방): A/B 옵션형 스탬프 → 파트너 키 첨부 이행 안내 → 관측 → NULL-파괴 단계 게이트.

### S4 — compose-mixed 산출물 회수

두 사안이 직교(printy 회신 §S4-Q4-2): (i) 잡 siteId 스탬프는 assembleFromSession+Bearer 로 해결됨
(ii) **바이트가 공개 `/storage/` 에 놓이는 것**은 별개. 해소 후보(제안, 미결):
- (i) 산출물 `files` 등록 + `download/external` 인증 회수 — 단 잡이 NULL 이면 파일도 NULL 스탬프라 §4.3 통과 → **S3 A안 선행 필수**
- (ii) nginx `/storage/outputs/` 서명 토큰(secure_link) — outputs 한정 시 게스트 UX(uploads/designs/thumbnails) 무영향(grep 실측: editor/admin 은 outputs 미참조)
- (iii) X-API-Key 에도 site 컨텍스트 부여
- 어느 안이든 **가이드 §3.4·5.1 회수 절차를 쓰는 기존 파트너 cutover 공지 필수**(무중단)

## bookmoa 정렬 — ✅ 완료 (2026-08-28, bookmoa-mobile-65 세션 회신)

| 칸 | bookmoa 답(원장 기준) | 설계 함의 |
|---|---|---|
| 1. 산출물 회수 방식 | ~~클라이언트 직접 노출~~ → **[정정 2026-08-28, bookmoa 재실측]** 전 경로(관리자·고객·게스트)가 **이미 jobId 경유**(proxy-download 스트림, 공개 URL 여는 UI 0곳), DB 실측상 박제된 주문 항목 0건, webhook outputFileUrl 은 소비처 없는 메타 | 초기 답변이 과대 평가였음이 판명 — **cutover 에 bookmoa 코드 변경 불요**, grandfathering 실수요 소멸 |
| 2. 업로드 경로 | **브라우저→R2 presigned 무인증 직결**(R-104 확정, 08-27 신도메인 스모크로 `/files/:id/complete` 브라우저 직접 201 실측). files/upload 프록시는 관리자 전용화 | **S3 NULL-site 주 사용자가 bookmoa** — 노출면 큼 |
| 3. 위험 인식 | **둘 다 실질 위험(수용 아님)**. 근거: bookmoa 자체가 R-92/R-95 에서 order-files 공개 직링크를 "URL 유출=위협모델"로 판정해 **private+300초 서명 URL 로 이미 전환한 전례**. 최종 인쇄 PDF=고객 저작물·개인정보. hardDelete 복구창 0 = 타 테넌트 버그 하나로 원본 소실 | **조이는 방향 지지** — 서명 URL 이 bookmoa 에 이미 검증된 패턴 |
| 4. cutover 창 | **사전 공지 1주 + 신구 병행이면 무중단 가능**. bookmoa 코드 변경 1~2일(서명 URL 소비=만료 시 재조회, 또는 서버 중계 전환, R-92 경험). cutover 날짜는 bookmoa 가 맞춤 | 서명 URL 소비 클라이언트가 이미 존재 → 재사용 |

**🔴 bookmoa 필수 조건(설계 blocker)**: 기존 주문에 **이미 박제된 구 공개 URL** 이 즉시 죽으면 과거 주문 PDF 다운로드가 전부 깨진다. → 설계에 **① 기존 산출물 grandfathering(구 공개 URL 유예 서빙) 또는 ② jobId→서명 URL 재발급 API** 를 반드시 포함. 그게 있으면 cutover 는 bookmoa 가 맞춘다.

**printy vs bookmoa 정렬 차이**: printy=서버 중계(공개 URL 클라 미노출) / bookmoa=클라 직접 노출. **bookmoa 가 더 노출됨** → S4 를 S3 보다 먼저 볼 근거. 단 서명 URL 전환 시 printy 는 무영향(이미 서버 중계라 URL 을 안 씀), bookmoa 는 소비 코드 1~2일. → **설계는 bookmoa 제약(grandfathering)을 축으로 잡되 printy 무중단 유지.**

## 승격 조건

**bookmoa 4칸 완료(2026-08-28) →** `TENANCY_S3_S4_DESIGN_<날짜>.md`(설계안: A안 배선 diff 범위·이원 정책
화이트리스트 데이터·nginx secure_link 설계·cutover 공지문·회귀 테스트 계획) → 오너 결정 게이트.
