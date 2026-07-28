# Partner API v1 레퍼런스

아래 레퍼런스는 **서버 라우트 정의에서 자동 생성**한 것이라 경로·메서드·파라미터·요청
스키마는 서버와 어긋나지 않습니다. 다만 생성 스펙이 담지 못하는 것이 있어, 읽기 전에
아래 6가지를 알고 있어야 합니다.

## 읽기 전에

1. **Base URL** — 생성 스펙에는 서버 주소가 비어 있습니다. 프로덕션은
   `https://api.papascompany.co.kr` 이며 아래 경로가 그 뒤에 붙습니다
   (예: `https://api.papascompany.co.kr/api/v1/ping`). → [1.3](/guide/common/#1-3)
2. **인증** — 전 라우트가 파트너 키 필수이고 `Authorization: Bearer <key>` 와
   `X-API-Key: <key>` 를 병행 수용합니다(둘 다 보내고 값이 다르면 401).
   아래 스펙의 보안 스킴 표기는 이 병행 수용을 정확히 반영하지 못합니다.
   → [1.2](/guide/common/#1-2)
3. **응답 봉투** — 성공은 `{success, message, data, pagination}`, 실패는
   `{success, errorCode, message, errors, fieldErrors, requestId}` 입니다.
   `GET /api/v1/books/{uid}/pdf` 만 예외로 봉투 없는 raw 스트림입니다.
   → [1.7](/guide/common/#1-7)
4. **상태코드는 "선언된 응답"입니다** — 아래 각 오퍼레이션의 상태코드 표는 서버가
   **문서에 명시한 케이스**만 모은 것이지 그 라우트가 낼 수 있는 응답의 전부가
   아닙니다. 인증(401)·리밋(429)·검증(400)·서버오류(5xx)는 표에 없어도 발생하며,
   분기는 상태코드가 아니라 `errorCode` 로 하세요. → [1.7](/guide/common/#1-7)
5. **멀티파트 계약은 아래 스펙이 부정확합니다** — 자산 투입 라우트의
   `multipart/form-data` 스키마가 `{fileId}` 로 표기돼 있으나 **실제 폼 필드명은
   `file`(바이너리)** 입니다. 멀티파트에 `Idempotency-Key` 를 재사용하면 파일이
   조용히 유실되는 함정도 함께 정리돼 있습니다. → [2.0](/guide/self-editor/#2-0)
6. **응답 `data` 스키마는 제공되지 않습니다** — 서버에 응답 타입이 선언돼 있지 않아
   아래에는 요청 스키마만 있습니다. 지어낸 응답 예시를 싣지 않기로 했으므로, 응답
   필드 구조는 `test` 키로 실제 호출해 확인하세요. → [1.7](/guide/common/#1-7)

> 여기 없는 것: 편집기 임베드(`/embed`)와 레거시 외부 표면(`/api/files/*` ·
> `/api/worker-jobs/*`)은 v1 이 아니라 별개 계약입니다 —
> [유형 2](/guide/embed/) · [5.1](/reference/#5-1) 참조.
