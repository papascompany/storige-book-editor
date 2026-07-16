/**
 * StorigeClient — Partner API v1 클라이언트 진입점.
 */

import type { PingView } from '../types';
import { BookSpecsResource } from './book-specs';
import { BooksResource } from './books';
import { WebhooksResource } from './webhooks';
import { HttpClient, type HttpClientOptions, type RequestOptions } from './http';

/**
 * 클라이언트 옵션.
 *
 * ⚠️ env(test/live)는 **키에 내재**한다 — 파라미터로 받지 않는다. test 키로
 *    발급받으면 그 키의 모든 요청이 test 스코프이고, 데이터는 live 와 완전히
 *    격리된다. live 전용 라우트를 test 키로 호출하면 403 ERR_ENV_MISMATCH.
 */
export type StorigeClientOptions = HttpClientOptions;

/**
 * Storige Partner API v1 클라이언트.
 *
 * @example
 * import { StorigeClient } from '@storige/sdk/client';
 * import { ErrorCode, StorigeApiError } from '@storige/sdk';
 *
 * const client = new StorigeClient({
 *   apiKey: process.env.STORIGE_API_KEY!,
 *   baseUrl: 'https://api.example.com',
 * });
 *
 * await client.ping();
 */
export class StorigeClient {
  private readonly http: HttpClient;

  /** 판형 마스터(§1.2) — GET 3종 */
  readonly bookSpecs: BookSpecsResource;

  /** 도서 aggregate(§1·§2.4~2.6·§6) — 11라우트 */
  readonly books: BooksResource;

  /** 웹훅 관리(§1.5) — 7라우트. 수신 서명 검증은 `@storige/sdk/webhook` */
  readonly webhooks: WebhooksResource;

  constructor(options: StorigeClientOptions) {
    this.http = new HttpClient(options);
    this.bookSpecs = new BookSpecsResource(this.http);
    this.books = new BooksResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
  }

  /**
   * GET /api/v1/ping — 연결/인증 확인.
   *
   * v1 은 무인증 라우트 0 원칙이라 ping 도 파트너 키가 필요하다 →
   * 온보딩 시 키 유효성 스모크로 쓴다.
   *
   * @throws StorigeApiError ERR_UNAUTHORIZED(401) — 키 누락/무효
   */
  async ping(options?: RequestOptions): Promise<PingView> {
    return this.http.request<PingView>({ method: 'GET', path: '/ping', options });
  }
}
