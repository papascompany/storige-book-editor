# bookmoa-mobile 주문화면 대용량 PDF 업로드(presigned 직결) 연동 지시문 + drop-in

> **작성**: 2026-06-19 · **대상**: bookmoa-mobile(주문/장바구니 화면) 작업 세션
> **자기완결**: 이 문서만으로 착수 가능. Storige 백엔드는 **이미 라이브 + 실 R2 E2E 검증 완료**.

---

## 0. 한 줄 요약

주문화면의 **"표지/내지 PDF 업로드"가 100MB에서 막히는** 문제(예: 120MB → "파일 크기 초과(최대 100MB)")를, **브라우저 → Cloudflare R2 presigned 직결 업로드**(>80MB는 멀티파트)로 바꿔 **최대 2GB**까지 받게 한다. 파일 바이트가 bookmoa-mobile 서버/Vercel(4.5MB)·Storige API/multer(100MB)를 **통과하지 않는다**. 받은 `fileId`로 **기존 검증/주문 연동은 그대로** 쓴다.

---

## 1. 배경 / 증상

- 현재 주문화면은 ① **100MB 클라이언트 가드**(파일 선택 즉시 차단) + ② `/files/upload`(서버 multer 100MB)로 업로드 → 120MB 거부.
- Storige 에디터의 "내지 PDF 첨부"는 이미 presigned로 전환됐지만, **주문화면은 별개 입구**라 별도 연동이 필요하다.
- 해결: 이 화면의 업로드를 **presigned 직결**로 교체.

---

## 2. 지금 상태 (중요)

- **Storige presigned 백엔드 = LIVE.** single-part·멀티파트·보안(IDOR)·R2 read 전부 **실 R2로 E2E 검증 완료(2026-06-19)**.
- **API base**: `https://api.papascompany.co.kr/api`
- presigned 발급 엔드포인트는 **`@Public`**(게스트 주문 허용) — 브라우저에서 직접 호출 가능(키 불필요).
- ⚠️ **남은 전제 1건**: R2 버킷 **CORS에 bookmoa-mobile 주문화면 origin 등록**(§6). 이게 있어야 브라우저 PUT이 된다.

---

## 3. API 계약 (검증된 실제 응답 기준)

흐름:
```
[브라우저]                         [Storige API]                 [R2]
 1. POST /files/presigned-upload-public  ──▶ {fileId, uploadUrl, uploadToken}
 2. PUT uploadUrl (파일 바이트 직결, API 우회) ───────────────────▶ R2
 3. POST /files/:fileId/complete {uploadToken} ──▶ HeadObject 검증, status=ready
 4. (기존) fileId 로 검증/주문 연동 그대로
```
>80MB는 멀티파트:
```
 1. POST /files/multipart/init {type,expectedSize}  ──▶ {fileId, uploadId, uploadToken}
 2. 파트별: POST /files/multipart/sign {fileId,partNumber,uploadToken} ──▶ {url}
            PUT url (청크) ─▶ R2 ─▶ ETag(응답헤더)
 3. POST /files/multipart/complete {fileId, parts:[{partNumber,etag}], uploadToken}
    실패 시: POST /files/multipart/abort {fileId, uploadToken}
```

| 엔드포인트 | body | 응답 |
|---|---|---|
| `POST /files/presigned-upload-public` | `{type, expectedSize, originalName?}` | `{fileId, uploadUrl, storageKey, uploadToken, expiresIn}` |
| `PUT <uploadUrl>` (R2 직결) | 파일 바이트, 헤더 `Content-Type: application/pdf` | 200 (+ETag 헤더) |
| `POST /files/:fileId/complete` | `{uploadToken}` | `{id, status:'ready', fileSize, ...}` |
| `POST /files/multipart/init` | `{type, expectedSize, originalName?}` | `{fileId, uploadId, storageKey, uploadToken}` |
| `POST /files/multipart/sign` | `{fileId, partNumber, uploadToken}` | `{url, partNumber, expiresIn}` |
| `POST /files/multipart/complete` | `{fileId, parts:[{partNumber, etag}], uploadToken}` | `{id, status:'ready', ...}` |
| `POST /files/multipart/abort` | `{fileId, uploadToken}` | `{success:true}` |

- `type`: 표지=`cover`, 내지=`content`.
- `expectedSize` = `file.size`(바이트). complete 시 R2 실제 크기와 정확 대조(불일치 거부).
- `uploadToken`: init/presign 응답으로 받은 **소유 토큰**. complete/sign/abort에 **반드시 동봉**(없거나 틀리면 404 — 타인의 업로드 가로채기 차단). ready 확정 후 무효화.
- driver가 s3가 아니면 발급 엔드포인트가 **503 `{code:'STORAGE_NOT_S3'}`** → 폴백 처리.

---

## 4. Drop-in 모듈 (프레임워크 무관 TS — 그대로 추가)

`lib/presignedUpload.ts` 로 추가하고, 표지/내지 업로드 핸들러에서 `uploadPdfViaPresigned()`를 호출하면 된다.

```ts
// lib/presignedUpload.ts — Storige R2 presigned 직결 업로드 (의존성 없음: fetch + XHR)
const STORIGE_API = 'https://api.papascompany.co.kr/api';
const SINGLE_PART_THRESHOLD = 80 * 1024 * 1024; // ≤80MB=single, >80MB=multipart
const PART_SIZE = 16 * 1024 * 1024;             // 16MB/part (R2 min 5MB, 마지막 제외)

export class PresignedNotConfiguredError extends Error {
  code = 'STORAGE_NOT_S3' as const;
}

export interface UploadOpts {
  apiBase?: string;                                       // 기본 STORIGE_API
  type?: 'cover' | 'content' | 'template' | 'other';      // 표지=cover, 내지=content
  onProgress?: (pct: number) => void;                     // 0~100
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 503) throw new PresignedNotConfiguredError('presigned 미구성(503)');
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = (j && j.message) || msg; } catch { /* noop */ }
    throw new Error(typeof msg === 'string' ? msg : '업로드 요청 실패');
  }
  return res.json() as Promise<T>;
}

// R2 직결 PUT — XHR 로 진행률, ETag 반환(멀티파트 결합용). 인증헤더 없음.
function rawPut(url: string, body: Blob, onProgress?: (loaded: number, total: number) => void): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', 'application/pdf'); // 서명 contentType 일치 필수
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve(xhr.getResponseHeader('ETag'))            // R2 CORS ExposeHeaders: ETag 필요
        : reject(new Error(`R2 PUT 실패 (${xhr.status})`));
    xhr.onerror = () => reject(new Error('R2 PUT 네트워크 오류'));
    xhr.send(body);
  });
}

/**
 * 대용량 PDF 업로드 → { fileId } 반환. 이 fileId 로 기존 검증/주문 연동을 그대로 진행.
 * ≤80MB=single PUT, >80MB=멀티파트(청크/재시도/abort).
 */
export async function uploadPdfViaPresigned(file: File, opts: UploadOpts = {}): Promise<{ fileId: string }> {
  const api = opts.apiBase || STORIGE_API;
  const body = { type: opts.type || 'content', expectedSize: file.size, originalName: file.name };

  if (file.size <= SINGLE_PART_THRESHOLD) {
    const init = await postJson<{ fileId: string; uploadUrl: string; uploadToken: string }>(
      `${api}/files/presigned-upload-public`, body,
    );
    await rawPut(init.uploadUrl, file, (l, t) => opts.onProgress?.(Math.round((l / t) * 100)));
    await postJson(`${api}/files/${init.fileId}/complete`, { uploadToken: init.uploadToken });
    return { fileId: init.fileId };
  }

  const init = await postJson<{ fileId: string; uploadId: string; uploadToken: string }>(
    `${api}/files/multipart/init`, body,
  );
  const { fileId, uploadToken } = init;
  const totalParts = Math.ceil(file.size / PART_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];
  let uploaded = 0;
  try {
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      const chunk = file.slice(i * PART_SIZE, Math.min((i + 1) * PART_SIZE, file.size));
      const sign = await postJson<{ url: string }>(`${api}/files/multipart/sign`, { fileId, partNumber, uploadToken });
      const etag = await rawPut(sign.url, chunk, (l) =>
        opts.onProgress?.(Math.round(((uploaded + l) / file.size) * 100)),
      );
      uploaded += chunk.size;
      if (!etag) throw new Error('파트 ETag 누락 — R2 버킷 CORS 의 ExposeHeaders: ETag 확인');
      parts.push({ partNumber, etag });
    }
    await postJson(`${api}/files/multipart/complete`, { fileId, parts, uploadToken });
    return { fileId };
  } catch (err) {
    try { await postJson(`${api}/files/multipart/abort`, { fileId, uploadToken }); } catch { /* best-effort */ }
    throw err;
  }
}
```

사용 예(표지/내지 핸들러):
```ts
import { uploadPdfViaPresigned, PresignedNotConfiguredError } from '@/lib/presignedUpload';

async function handlePdfSelected(file: File, kind: 'cover' | 'content', setPct: (n:number)=>void) {
  try {
    const { fileId } = await uploadPdfViaPresigned(file, { type: kind, onProgress: setPct });
    // ↓ 기존과 동일: 이 fileId 로 검증 잡 생성/폴링 → 통과 시 장바구니 활성
    await startValidation(fileId, kind);
  } catch (e) {
    if (e instanceof PresignedNotConfiguredError) {
      // 운영 중 R2 비활성 등 — 사용자 안내(기존 100MB 경로로 폴백하려면 분기)
    }
    throw e;
  }
}
```

---

## 5. 통합 단계 (bookmoa-mobile)

1. **100MB 클라이언트 가드 상향**(예 2GB). 서버 multer(100MB) 우회는 presigned가 처리하므로 가드만 올리면 됨.
2. 표지/내지 업로드를 **`/files/upload` → `uploadPdfViaPresigned()`** 로 교체. 반환 `fileId`는 기존과 동일한 형태(서버 File 레코드, `storageBackend='s3'`, `status='ready'`)라 **검증/주문 연동 코드는 그대로**.
3. **진행률 UI** 연결(`onProgress`) — 대용량은 % 표시 권장.
4. (선택) ≤100MB는 기존 경로 유지하고 **>100MB만 presigned**로 분기해도 됨(점진 도입). 단순화하려면 전부 presigned로 통일 가능.

---

## 6. ⚠️ R2 CORS (필수 — Storige 오너에게 요청)

브라우저 PUT은 R2 버킷 CORS에 **주문화면 origin**이 있어야 동작한다. 주문화면 도메인 = **bookmoa.com / mybookmake.com**(곧 Vercel 배포에 연결 예정, 그전엔 `*.vercel.app`). Storige 오너가 버킷 `storige-files` CORS에 아래 반영:
```json
{
  "AllowedOrigins": [
    "https://bookmoa.com", "https://www.bookmoa.com",
    "https://bookmoa.net", "https://www.bookmoa.net",
    "https://mybookmake.com", "https://www.mybookmake.com",
    "https://*.vercel.app"
  ],
  "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}
```
- `ExposeHeaders: ["ETag"]` 없으면 **멀티파트 complete 실패**(파트 ETag를 못 읽음).

---

## 7. 보안 / 주의

- **바이트 프록시 금지**: 파일을 bookmoa-mobile Vercel 함수로 중계하지 말 것(4.5MB 하드캡). presigned는 브라우저→R2 직결이라 프록시 불가·불필요.
- **uploadToken**: 발급 응답 값을 complete/sign/abort에 그대로 동봉. 분실 시 그 업로드는 완료 불가(설계상). 클라 메모리에만 보관.
- **소유/주문 연결**: public 발급은 클라가 보낸 `memberSeqno`를 신뢰하지 않음(null 처리). 파일↔주문/회원 연결은 **complete 후 기존 서버측 흐름**(주문에 fileId 기록 등)으로 할 것.
- `Content-Type`은 PUT 시 반드시 `application/pdf`(서명 바인딩). 파일 확장자/타입 검증은 클라에서 선행 권장.

---

## 8. 테스트 체크리스트

- [ ] 6MB / 90MB / **120MB** / 500MB PDF 업로드 성공(멀티파트 진행률 표시)
- [ ] 업로드 후 `fileId`로 기존 검증 통과 → 장바구니 활성
- [ ] Network 탭: PUT 요청 호스트가 **`*.r2.cloudflarestorage.com`**(자사/Vercel 아님), CORS 오류 0
- [ ] 멀티파트: 파트 PUT 응답에 `ETag` 노출(CORS ExposeHeaders 확인)
- [ ] 업로드 중단/재시도 정상, 실패 시 abort 호출됨
- [ ] driver=local 등 503 시 안내(또는 ≤100MB 기존 경로 폴백)

---

## 9. 참고
- 전체 아키텍처/오너 게이트: `docs/LARGE_FILE_UPLOAD_1GB_HANDOFF_2026-06-18.md`
- Storige 측 구현(검증됨): `apps/api/src/files/presigned-upload.service.ts`, `files.controller.ts`(presigned 엔드포인트), `apps/editor/src/api/presigned-upload.ts`(동일 로직의 에디터판 참고)
- ⚠️ 1GB+ 초대용량의 워커 검증은 메모리 재설계(P2) 후 권장 — 업로드 자체는 2GB까지 가능하나, 검증 단계 한도(`WORKER_MAX_FILE_SIZE`)는 운영에서 단계적 상향.
