/**
 * BookSpecs 리소스 — 판형 마스터 GET 3종 (설계서 §1.2).
 *
 * 전부 general 버킷(300/min) — 읽기 전용 마스터 조회.
 */

import type { Page } from '../index';
import type { BookSpecListQuery, BookSpecView, CalculatedSizeView } from '../types';
import type { HttpClient, RequestOptions } from './http';

export class BookSpecsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /api/v1/book-specs — 판형 목록.
   *
   * isActive 미지정 시 **활성 판형만** 노출된다(외부 대면 기본).
   * limit 100 초과값은 서버가 100으로 캡한다(에러 아님).
   */
  async list(query: BookSpecListQuery = {}, options?: RequestOptions): Promise<Page<BookSpecView>> {
    return this.http.requestPage<BookSpecView>({
      method: 'GET',
      path: '/book-specs',
      query: {
        coverType: query.coverType,
        bindingType: query.bindingType,
        // 서버는 'true'|'false' 문자열만 수용(@IsIn) — boolean 을 문자열로 변환
        isActive: query.isActive === undefined ? undefined : String(query.isActive),
        limit: query.limit,
        offset: query.offset,
      },
      options,
    });
  }

  /**
   * GET /api/v1/book-specs/{uid} — 판형 상세.
   *
   * @throws StorigeApiError ERR_BOOK_SPEC_NOT_FOUND(404) — 없음/비활성/타 사이트
   */
  async get(uid: string, options?: RequestOptions): Promise<BookSpecView> {
    return this.http.request<BookSpecView>({
      method: 'GET',
      path: `/book-specs/${encodeURIComponent(uid)}`,
      options,
    });
  }

  /**
   * GET /api/v1/book-specs/{uid}/calculated-size — 페이지 수 기반 실측 mm.
   *
   * 응답의 각 mm 값대로 PDF 를 제작하면 워커 사이즈 검증을 ±sizeToleranceMm
   * 내에서 통과한다. 책등 계수 미구성 판형은 spine/cover 가 null + warnings.
   *
   * @throws StorigeApiError ERR_VALIDATION_FAILED(400) — pageCount 비정수/0/음수
   * @throws StorigeApiError ERR_PAGE_COUNT_OUT_OF_RANGE(422) — pageMin/Max/Increment 위반
   * @throws StorigeApiError ERR_BOOK_SPEC_NOT_FOUND(404)
   */
  async calculatedSize(
    uid: string,
    pageCount: number,
    options?: RequestOptions,
  ): Promise<CalculatedSizeView> {
    return this.http.request<CalculatedSizeView>({
      method: 'GET',
      path: `/book-specs/${encodeURIComponent(uid)}/calculated-size`,
      query: { pageCount },
      options,
    });
  }
}
