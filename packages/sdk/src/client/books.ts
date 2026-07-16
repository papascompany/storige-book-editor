/**
 * Books 리소스 — 도서 aggregate 11라우트 (설계서 §1·§2.4~2.6·§6).
 *
 * 버킷: 자산 5 + finalization POST + GET pdf = heavy(100/min).
 *       나머지(생성/목록/상세/finalization GET) = general(300/min).
 */

import {
  DIRECT_UPLOAD_MAX_BYTES,
  StorigeUsageError,
  TERMINAL_FINALIZATION_STATUSES,
  type Page,
} from '../index';
import type {
  BookAssetView,
  BookFinalizationView,
  BookListQuery,
  BookView,
  CreateBookInput,
} from '../types';
import type { HttpClient, RawStream, RequestOptions } from './http';
import { composeMultipartIdempotencyKey } from './idempotency';

/** 직접 업로드할 파일 */
export interface AssetFile {
  /** 파일 바이트 */
  data: Uint8Array | ArrayBuffer | Blob;
  filename: string;
  /**
   * 기본 'application/pdf'.
   *
   * ⚠️ 서버 직접 업로드 필터는 **PDF 만** 허용한다(photo 자산도 예외 없음) —
   *    이미지를 멀티파트로 올리면 415 다. 사진은 fileId 참조 경로를 쓴다.
   */
  contentType?: string;
}

/**
 * 자산 투입 입력 — 두 경로 중 하나.
 *
 * ## 권장: fileId 참조
 * 동결 업로드 표면(presigned ≤2GB)에 올린 뒤 fileId 로 참조한다. 본문이 JSON 이라
 * 서버 멱등 해시가 정상 작동하고 → SDK 가 Idempotency-Key 를 자동 부여할 수 있다.
 *
 * ## 직접 업로드(멀티파트, ≤100MB, PDF)
 * 편의 경로지만 **멱등 자동부여가 불가능**하다(idempotency.ts 상단 사유).
 * 멱등이 필요하면 idempotencyKey 를 명시 제공하면 SDK 가 파일 해시를 합성한다.
 */
export type AssetInput = { fileId: string; file?: never } | { file: AssetFile; fileId?: never };

/** 최종화 폴링 옵션 */
export interface WaitForFinalizationOptions extends RequestOptions {
  /** 폴링 간격 시작값(ms). 지수 증가 */
  intervalMs?: number;
  /** 폴링 간격 상한(ms) */
  maxIntervalMs?: number;
  /** 전체 대기 상한(ms). 초과 시 StorigeUsageError */
  timeoutMs?: number;
  /** 상태 전이 관찰 훅 */
  onPoll?: (view: BookFinalizationView) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_POLL_MAX_INTERVAL_MS = 15_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function toBlob(file: AssetFile): Blob {
  const type = file.contentType ?? 'application/pdf';
  if (file.data instanceof Blob) return file.data;
  return new Blob([file.data as BlobPart], { type });
}

async function fileBytes(file: AssetFile): Promise<ArrayBuffer> {
  if (file.data instanceof Blob) return file.data.arrayBuffer();
  if (file.data instanceof ArrayBuffer) return file.data;
  // Uint8Array — 뷰가 버퍼의 일부 구간만 가리킬 수 있으므로 해당 구간만 복사한다
  // (view.buffer 를 통째로 넘기면 다른 데이터까지 해시에 섞인다)
  const view = file.data;
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

/** 바이트 크기 — Blob/ArrayBuffer/Uint8Array 공통 */
function sizeOf(file: AssetFile): number {
  if (file.data instanceof Blob) return file.data.size;
  return file.data.byteLength;
}

export class BooksResource {
  constructor(private readonly http: HttpClient) {}

  // ── 도서 ──────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/books — DRAFT 도서 생성. general 버킷.
   *
   * JSON 본문이라 Idempotency-Key 가 **자동 부여**된다(재시도 중복 생성 방지).
   *
   * @throws StorigeApiError ERR_VALIDATION_FAILED(400) — creationType 누락/무효
   * @throws StorigeApiError ERR_BOOK_SPEC_NOT_FOUND(404) — bookSpecUid 없음/비활성/타 사이트
   */
  async create(input: CreateBookInput, options?: RequestOptions): Promise<BookView> {
    return this.http.request<BookView>({
      method: 'POST',
      path: '/books',
      json: input,
      options,
    });
  }

  /** GET /api/v1/books — 도서 목록(자기 site+env). general 버킷. */
  async list(query: BookListQuery = {}, options?: RequestOptions): Promise<Page<BookView>> {
    return this.http.requestPage<BookView>({
      method: 'GET',
      path: '/books',
      query: {
        status: query.status,
        creationType: query.creationType,
        limit: query.limit,
        offset: query.offset,
      },
      options,
    });
  }

  /**
   * GET /api/v1/books/{uid} — 도서 상세. general 버킷.
   *
   * @throws StorigeApiError ERR_NOT_FOUND(404) — 없음/타 site/타 env(존재 은닉)
   */
  async get(uid: string, options?: RequestOptions): Promise<BookView> {
    return this.http.request<BookView>({
      method: 'GET',
      path: `/books/${encodeURIComponent(uid)}`,
      options,
    });
  }

  // ── 자산 (heavy 버킷) ─────────────────────────────────────────────────

  /**
   * POST /api/v1/books/{uid}/pdf-cover — 표지 PDF **신규** 투입.
   *
   * @throws StorigeApiError ERR_ASSET_ALREADY_EXISTS(409) — 이미 존재(교체는 replacePdfCover)
   * @throws StorigeApiError ERR_BOOK_NOT_DRAFT(409) — FINALIZED 도서
   * @throws StorigeApiError ERR_ASSET_INCOMPATIBLE(422) — creationType 불일치
   */
  async uploadPdfCover(
    uid: string,
    input: AssetInput,
    options?: RequestOptions,
  ): Promise<BookAssetView> {
    return this.putAsset('POST', uid, 'pdf-cover', input, options);
  }

  /**
   * PUT /api/v1/books/{uid}/pdf-cover — 표지 PDF **교체**(기존 replaced + 신규 active).
   *
   * PUT 은 자연 멱등이라 서버 멱등 인터셉터(POST 전용) 대상이 아니다.
   *
   * @throws StorigeApiError ERR_ASSET_NOT_FOUND(404) — 교체 대상 없음(신규는 uploadPdfCover)
   */
  async replacePdfCover(
    uid: string,
    input: AssetInput,
    options?: RequestOptions,
  ): Promise<BookAssetView> {
    return this.putAsset('PUT', uid, 'pdf-cover', input, options);
  }

  /** POST /api/v1/books/{uid}/pdf-contents — 내지 PDF 신규 투입. */
  async uploadPdfContents(
    uid: string,
    input: AssetInput,
    options?: RequestOptions,
  ): Promise<BookAssetView> {
    return this.putAsset('POST', uid, 'pdf-contents', input, options);
  }

  /** PUT /api/v1/books/{uid}/pdf-contents — 내지 PDF 교체. */
  async replacePdfContents(
    uid: string,
    input: AssetInput,
    options?: RequestOptions,
  ): Promise<BookAssetView> {
    return this.putAsset('PUT', uid, 'pdf-contents', input, options);
  }

  /**
   * POST /api/v1/books/{uid}/photos — 사진 자산 추가(다건, sort_order 자동).
   *
   * ⚠️ 직접 업로드 MIME 필터가 PDF 전용이라 **이미지는 fileId 참조 경로만**
   *    실질적으로 동작한다(멀티파트 이미지는 415).
   *
   * @throws StorigeApiError ERR_ASSET_INCOMPATIBLE(422) — creationType 불일치
   * @throws StorigeApiError ERR_UNSUPPORTED_CONTENT_TYPE(415) — 멀티파트 비-PDF
   */
  async addPhoto(uid: string, input: AssetInput, options?: RequestOptions): Promise<BookAssetView> {
    return this.putAsset('POST', uid, 'photos', input, options);
  }

  // ── 최종화 ────────────────────────────────────────────────────────────

  /**
   * POST /api/v1/books/{uid}/finalization — 최종화 착수(DRAFT→FINALIZED). heavy 버킷.
   *
   * 본문이 없어(JSON none) Idempotency-Key 가 자동 부여된다.
   * 완료 대기는 waitForFinalization 또는 **웹훅**(권장)을 쓴다.
   *
   * @throws StorigeApiError ERR_FINALIZATION_IN_PROGRESS(409) — 진행 중 재호출
   * @throws StorigeApiError ERR_ASSETS_INCOMPLETE(422) — 자산 누락
   * @throws StorigeApiError ERR_PAGE_COUNT_OUT_OF_RANGE(422)
   */
  async startFinalization(uid: string, options?: RequestOptions): Promise<BookFinalizationView> {
    return this.http.request<BookFinalizationView>({
      method: 'POST',
      path: `/books/${encodeURIComponent(uid)}/finalization`,
      options,
    });
  }

  /** GET /api/v1/books/{uid}/finalization — 최신 attempt 상태. general 버킷. */
  async getFinalization(uid: string, options?: RequestOptions): Promise<BookFinalizationView> {
    return this.http.request<BookFinalizationView>({
      method: 'GET',
      path: `/books/${encodeURIComponent(uid)}/finalization`,
      options,
    });
  }

  /**
   * 최종화 완료까지 폴링 — COMPLETED/FAILED 도달 시 반환.
   *
   * ⚠️ **웹훅 병행을 권장한다**. 폴링은 보조 수단이다:
   *    - 웹훅(synthesis.completed/failed)이 정본 알림 경로이고, 폴링은 웹훅
   *      유실·수신 지연 시의 백스톱으로 쓰는 것이 맞다.
   *    - GET finalization 은 general(300/min)이라 여유가 있으나, 다수 도서를
   *      동시에 폴링하면 리밋에 닿는다. 서버는 X-RateLimit-* 잔량 헤더를 주지
   *      않아 선제 회피가 불가능하다(429 후 Retry-After 반응만 가능).
   *
   * FAILED 는 **예외가 아니라 값으로** 반환한다 — errorCode/errorDetail 로
   * 분기하는 것이 계약이다.
   */
  async waitForFinalization(
    uid: string,
    options: WaitForFinalizationOptions = {},
  ): Promise<BookFinalizationView> {
    const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxIntervalMs = options.maxIntervalMs ?? DEFAULT_POLL_MAX_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    let attempt = 0;
    for (;;) {
      const view = await this.getFinalization(uid, {
        signal: options.signal,
        headers: options.headers,
        retry: options.retry,
      });
      options.onPoll?.(view);

      if (TERMINAL_FINALIZATION_STATUSES.includes(view.status)) return view;

      if (Date.now() >= deadline) {
        throw new StorigeUsageError(
          `최종화 대기 시간(${timeoutMs}ms) 초과 — 마지막 status=${view.status}. ` +
            '웹훅 수신으로 전환하거나 timeoutMs 를 늘리세요',
        );
      }

      const delay = Math.min(intervalMs * 2 ** attempt, maxIntervalMs);
      const remaining = deadline - Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(delay, remaining))));
      attempt += 1;
    }
  }

  /**
   * GET /api/v1/books/{uid}/pdf — 최종 PDF 스트림. heavy 버킷. FINALIZED 전용.
   *
   * ⚠️ 이 라우트만 **봉투가 없다** — 성공 시 서버가 application/pdf 를 직접
   *    파이프한다(@Res). 오류일 때만 JSON 봉투가 온다 → SDK 가 Content-Type 으로
   *    분기해 성공은 스트림, 오류는 StorigeApiError 로 던진다.
   *
   * 반환 스트림은 호출측이 소비/해제할 책임이 있다(상수 메모리 유지).
   *
   * @throws StorigeApiError ERR_NOT_FOUND(404) — 미FINALIZED/없음/타 테넌트(존재 은닉)
   */
  async downloadPdf(uid: string, options?: RequestOptions): Promise<RawStream> {
    return this.http.requestStream({
      method: 'GET',
      path: `/books/${encodeURIComponent(uid)}/pdf`,
      options,
    });
  }

  // ── 내부 ──────────────────────────────────────────────────────────────

  /**
   * 자산 라우트 공통 — fileId(JSON) / file(멀티파트) 분기.
   *
   * 멀티파트 + 사용자 지정 멱등키인 경우에만 키를 파일 내용으로 합성한다
   * (자동 부여는 하지 않는다 — idempotency.ts 상단 사유).
   */
  private async putAsset(
    method: 'POST' | 'PUT',
    uid: string,
    segment: 'pdf-cover' | 'pdf-contents' | 'photos',
    input: AssetInput,
    options?: RequestOptions,
  ): Promise<BookAssetView> {
    const path = `/books/${encodeURIComponent(uid)}/${segment}`;

    // ① fileId 참조(JSON) — 권장 경로. 멱등 자동부여 정상 작동.
    if (input.fileId !== undefined) {
      return this.http.request<BookAssetView>({
        method,
        path,
        json: { fileId: input.fileId },
        options,
      });
    }

    // ② 직접 업로드(멀티파트)
    const file = input.file;
    if (file === undefined) {
      throw new StorigeUsageError('fileId 또는 file 중 하나는 반드시 제공해야 합니다');
    }

    this.assertUploadable(file);

    const form = new FormData();
    form.append('file', toBlob(file), file.filename);

    let effectiveOptions = options;
    if (options?.idempotencyKey !== undefined) {
      // 서버 request_hash 가 파일을 반영하지 못하므로 키를 내용 주소화한다
      const bytes = await fileBytes(file);
      effectiveOptions = {
        ...options,
        idempotencyKey: await composeMultipartIdempotencyKey(options.idempotencyKey, bytes),
      };
    }

    return this.http.request<BookAssetView>({
      method,
      path,
      form,
      options: effectiveOptions,
    });
  }

  /** 직접 업로드 상한 사전 검증 — 100MB 를 다 올려보내고 413 을 받는 낭비 방지 */
  private assertUploadable(file: AssetFile): void {
    const size = sizeOf(file);
    if (size > DIRECT_UPLOAD_MAX_BYTES) {
      throw new StorigeUsageError(
        `직접 업로드 한도(${DIRECT_UPLOAD_MAX_BYTES} bytes = 100MB)를 초과했습니다 ` +
          `(현재 ${size} bytes). presigned 업로드 표면(≤2GB)에 올린 뒤 { fileId } 참조 경로를 사용하세요`,
      );
    }
  }
}
