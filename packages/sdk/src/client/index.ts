/**
 * @storige/sdk/client — Partner API v1 HTTP 클라이언트.
 *
 * 계약 타입·에러·상수는 루트 subpath(`@storige/sdk`)에서 가져온다.
 */

export { StorigeClient } from './client';
export type { StorigeClientOptions } from './client';

export { BookSpecsResource } from './book-specs';
export { BooksResource } from './books';
export type { AssetFile, AssetInput, WaitForFinalizationOptions } from './books';
export { WebhooksResource } from './webhooks';

export { isIdempotentReplay } from './http';
export type { HttpClientOptions, RawStream, RequestOptions, RetryOptions } from './http';

// 멱등 정책 표면 — 멀티파트 함정 대응을 파트너가 직접 다뤄야 할 때 사용
export {
  canAutoAssignIdempotencyKey,
  composeMultipartIdempotencyKey,
  generateIdempotencyKey,
} from './idempotency';
export type { BodyKind } from './idempotency';
