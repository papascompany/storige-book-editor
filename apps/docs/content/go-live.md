# Go-live 체크리스트

프로덕션 전환 전에 확인할 항목입니다. 각 항목은 근거가 되는 가이드 절로 연결됩니다 —
**판단 기준은 링크된 절이 정본**이고, 이 페이지는 행동 목록일 뿐입니다.

해당 없는 절(예: 임베드를 쓰지 않으면 임베드 블록)은 통째로 건너뛰세요.

## 1. 온보딩 · 테넌트

- [ ] 온보딩 요청 양식을 보안 채널로 전달하고 발급된 키를 수령했다 — [1.1](/guide/common/#1-1)
- [ ] 회원번호를 파트너 자체 **정수 시퀀스**로 확정했다(외부 UUID → 정수 1:1, 해시 변환 금지) — [1.1](/guide/common/#1-1)
- [ ] 보존정책(`retentionDays`)을 정하고 운영팀에 전달했다 — [1.1](/guide/common/#1-1)
- [ ] 프로덕션용 `allowedOrigins` 를 등록 요청했다(브라우저에서 호출하는 경우) — [1.5](/guide/common/#1-5)

## 2. 인증 · 시크릿

- [ ] API 키를 **서버에서만** 사용하고 브라우저 번들·프런트 코드에 넣지 않았다 — [1.2](/guide/common/#1-2)
- [ ] 키를 전권 키로 취급하고 저장소·로그·스크린샷에 남지 않도록 처리했다 — [1.2](/guide/common/#1-2)
- [ ] v1 호출에서 `Authorization` 과 `X-API-Key` 를 **동시에 다른 값으로** 보내지 않는다(401) — [1.2](/guide/common/#1-2)
- [ ] `GET /api/v1/ping` 으로 키 인증이 통과하는 것을 확인했다 — [1.7](/guide/common/#1-7)
- [ ] `test` 키로 먼저 통합을 끝내고 `live` 키로 전환할 계획이 있다 — [1.2](/guide/common/#1-2)

## 3. Partner API v1 통합

- [ ] 에러 분기를 **`errorCode` 로만** 하고 `message` 문자열을 파싱하지 않는다 — [1.7](/guide/common/#1-7)
- [ ] 모르는 `errorCode` 를 만나도 크래시하지 않고 기본 분기로 흘린다 — [1.7](/guide/common/#1-7)
- [ ] `429` 응답의 `Retry-After` 를 준수한다(잔량 헤더가 없어 선제 회피 불가) — [1.6](/guide/common/#1-6)
- [ ] 자산 투입은 **`fileId` 참조**를 기본 경로로 쓴다 — [2.0](/guide/self-editor/#2-0)
- [ ] 🚨 **멀티파트 업로드에 `Idempotency-Key` 를 재사용하지 않는다**(같은 키 + 다른 파일 = 조용한 유실) — [1.7](/guide/common/#1-7)
- [ ] 직접(멀티파트) 업로드 상한을 넘는 파일은 presigned 표면에 올린 뒤 `fileId` 로 참조한다(상한 수치는 정본 참조 — 서버 경유·직결·워커 검증이 각각 다른 값) — [1.4](/guide/common/#1-4)
- [ ] `409 ERR_FINALIZATION_IN_PROGRESS` 를 **실패로 처리하지 않고** 기존 attempt 에 합류한다 — [1.7](/guide/common/#1-7)
- [ ] 🖨️ 운영 주문 경로에서 `bookSpecUid` 를 **반드시** 넘겨 미검증 최종화(`validationSkipped`)를 만들지 않는다 — [1.7](/guide/common/#1-7)
- [ ] `validationSkipped: true` 인 도서를 자동 발주로 흘리지 않는 게이트가 있다 — [1.7](/guide/common/#1-7)
- [ ] `GET .../pdf` 수신을 `Content-Type` 으로 분기하고 전량 버퍼링 없이 스트림으로 저장한다 — [2.0](/guide/self-editor/#2-0)
- [ ] 미구현 생성 유형(`TEMPLATE` · `MIX_COVER_TEMPLATE`)을 **생성 전에** 걸러낸다 — 생성은 `201` 로 통과하고 최종화에서 `422` 라, 필터가 없으면 최종화 불가능한 DRAFT 가 쌓인다 — [1.7](/guide/common/#1-7)

## 4. 임베드 (유형 2)

- [ ] `/embed` 라우트를 쓰고 `parentOrigin` 을 넘긴다(루트 `/` 는 레거시) — [3.1](/guide/embed/#3-1)
- [ ] `postMessage` 수신에 오리진 **정확 일치** + 프레임 대조 게이트를 걸었다 — [3.2](/guide/embed/#3-2)
- [ ] 게스트 완료 분기를 `editor.complete` payload 로 판정한다 — [3.2](/guide/embed/#3-2)
- [ ] 모르는 편집기 이벤트에서 크래시하지 않는다 — [3.2](/guide/embed/#3-2)
- [ ] 임베드 도메인이 편집기 CSP `frame-ancestors` 에 반영됐다(DB 변경만으로는 적용되지 않음) — [1.5](/guide/common/#1-5)
- [ ] 세션 승격은 **파트너 서버**에서 하고 승격 요청자가 그 세션의 소유자인지 검증한다 — [1.7](/guide/common/#1-7)
- [ ] 임베드 URL 의 토큰을 화면 로그·고객센터 첨부에 남기지 않는다 — [1.5](/guide/common/#1-5)

## 5. 레거시 워커 잡 경로 (기존 유형 1)

- [ ] `validate/external` 에 `fileType` 과 `orderOptions` 를 명시 전달한다 — [2.2](/guide/self-editor/#2-2)
- [ ] `binding` 을 canonical 4종으로 매핑해 보낸다 — [2.5](/guide/self-editor/#2-5)
- [ ] 제본별 `pageMultiple`/`pageCountMax`/`pageCountMin` 을 전송한다 — [2.4](/guide/self-editor/#2-4)
- [ ] `FIXABLE`(배수 위반) 수신 시 보정 흐름을 붙였거나 재업로드를 유도한다 — [2.6](/guide/self-editor/#2-6)
- [ ] 검증 대상 PDF 가 현재 프로덕션 상한을 넘으면 사전 협의했다 — [1.4](/guide/common/#1-4)
- [ ] 결과 PDF 는 `download/external` 로만 회수한다 — [2.7](/guide/self-editor/#2-7)

## 6. 웹훅 수신

- [ ] 수신 URL 이 등록돼 있다(미등록이면 콜백이 **무음으로 전송되지 않음**) — [5.2](/reference/#5-2)
- [ ] 자기 사이트의 발신 경로(레거시 / v2)를 확인하고 그에 맞는 검증을 구현했다 — [5.2](/reference/#5-2)
- [ ] 웹훅 secret 을 발급 응답에서 즉시 보관했다(재조회 불가) — [5.2](/reference/#5-2)
- [ ] 신선도 판정을 서명 헤더의 `t` 로 하고 본문 `timestamp` 로 하지 않는다 — [5.2](/reference/#5-2)
- [ ] 🚨 부수효과의 근거를 본문이 아니라 **재조회**에서 취한다(본문은 서명 대상이 아님) — [5.2](/reference/#5-2)
- [ ] 중복 배달을 자체 **도메인 멱등**으로 한 번 더 막고 상태 전이를 조건부 갱신으로 한다 — [5.2](/reference/#5-2)
- [ ] 중복 단락 시에도 **2xx** 로 응답해 재시도 체인을 끊는다 — [5.2](/reference/#5-2)
- [ ] 모르는 이벤트에서 예외를 던지지 않는다 — [5.2](/reference/#5-2)
- [ ] 수신 엔드포인트가 HTTPS 다 — [5.2](/reference/#5-2)

## 7. 파일 · 보존

- [ ] 업로드 콘텐츠타입이 화이트리스트를 만족한다 — [1.4](/guide/common/#1-4)
- [ ] presigned 직결을 쓰면 R2 CORS 등록을 요청했다 — [2.2](/guide/self-editor/#2-2)
- [ ] 이행 완료 후 만료 예약 또는 삭제로 보존정책을 집행한다 — [2.7](/guide/self-editor/#2-7)
- [ ] 파일 식별자를 고객 브라우저에 불필요하게 노출하지 않는다 — [1.5](/guide/common/#1-5)

## 8. 전환 직전

- [ ] 실 서버(`test` 키) 대상 스모크를 파트너 환경에서 직접 돌렸다 — [1.7](/guide/common/#1-7)
- [ ] 인쇄 검증 실패(`FAILED`) 시 고객에게 보여 줄 안내 흐름이 있다 — [2.3](/guide/self-editor/#2-3)
- [ ] 유형별 온보딩 체크리스트를 대조 완료했다 — [5.4](/reference/#5-4)
- [ ] 장애 시 문의 채널과 `requestId` 전달 절차를 팀 내에 공유했다 — [1.7](/guide/common/#1-7)
