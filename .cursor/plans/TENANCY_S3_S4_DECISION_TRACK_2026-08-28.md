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

## bookmoa 정렬 — 채워질 자리 (대기)

bookmoa-mobile 세션에서 확인/회신할 것(printy 와 같은 질문 프레임):
- [ ] bookmoa 가 compose-mixed 산출물을 **현재 어떻게 회수**하는가(공개 URL 직접 GET? 서버 중계?)
- [ ] bookmoa 고객 업로드가 presigned 무인증 경로인가, 아니면 회원 세션 경유인가(→ S3 노출면)
- [ ] bookmoa 가 S4 산출물 공개를 위험으로 보는지, jobId 은닉 방어를 신뢰하는지
- [ ] cutover 를 감내할 수 있는 창(설계안이 공개 URL 을 조일 경우)

→ 위 4칸이 채워지면 A안 우선 + S4 (ii) outputs-한정 서명 토큰을 축으로 설계안 승격.

## 승격 조건

bookmoa 4칸 완료 → `TENANCY_S3_S4_DESIGN_<날짜>.md`(설계안: A안 배선 diff 범위·이원 정책
화이트리스트 데이터·nginx secure_link 설계·cutover 공지문·회귀 테스트 계획) → 오너 결정 게이트.
