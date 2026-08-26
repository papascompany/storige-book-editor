/**
 * Spine Calculator API Client
 * 책등 폭 계산 및 용지/제본 정보 조회
 */
import axios from 'axios';
import { apiClient } from './client';

/**
 * 요청 취소 판별식.
 *
 * axios 1.x 는 AbortSignal 취소에 CanceledError(name='CanceledError',
 * code='ERR_CANCELED', __CANCEL__=true)를 던진다 — DOM 의 'AbortError' 가 **아니다**.
 * 그래서 `error.name !== 'AbortError'` 식 필터는 취소를 조용히 통과시켜 에러로 오분류한다
 * (2026-08-26 두 어댑터·전송후취소·이미취소 4케이스 실측).
 * 타임아웃(code='ECONNABORTED')은 isCancel=false 라 이 판별식과 완전히 분리된다 —
 * "취소는 조용히, 타임아웃은 에러로" 를 이 한 함수로 판정한다.
 */
export function isRequestCancelled(error: unknown): boolean {
  return (
    axios.isCancel(error) ||
    (error as { code?: string } | null | undefined)?.code === 'ERR_CANCELED'
  );
}

// 책등 계산 요청 파라미터
export interface CalculateSpineParams {
  pageCount: number;       // 페이지 수
  paperType: string;       // 용지 종류 코드
  bindingType: string;     // 제본 방식 코드
  customPaperThickness?: number;  // 커스텀 용지 두께 (mm)
  customBindingMargin?: number;   // 커스텀 제본 마진 (mm)
}

// 책등 계산 결과
export interface SpineCalculationResult {
  spineWidth: number;      // 계산된 책등 너비 (mm)
  paperThickness: number;  // 사용된 용지 두께 (mm)
  bindingMargin: number;   // 사용된 제본 마진 (mm)
  warnings: Array<{ code: string; message: string }>;  // 경고 메시지
  formula: string;         // 계산 공식
}

// 용지 정보
export interface PaperTypeInfo {
  code: string;            // 용지 코드
  name: string;            // 용지 이름
  thickness: number;       // 두께 (mm)
  category: string;        // body (본문용) | cover (표지용)
}

// 제본 정보
export interface BindingTypeInfo {
  code: string;            // 제본 코드
  name: string;            // 제본 이름
  margin: number;          // 제본 마진 (mm)
  minPages?: number;       // 최소 페이지 수
  maxPages?: number;       // 최대 페이지 수
  pageMultiple?: number;   // 페이지 배수
}

export const spineApi = {
  /**
   * 책등 폭 계산
   */
  async calculate(
    params: CalculateSpineParams,
    options?: { signal?: AbortSignal }
  ): Promise<SpineCalculationResult> {
    // signal 은 **옵셔널** — 기존 호출자를 깨지 않는다.
    // apiClient.post 의 3번째 인자는 axios config 로 그대로 넘어가므로(client.ts) 이 한 줄로
    // xhr 어댑터의 취소 배선(abort → request.abort())이 켜진다. 인터셉터의 재요청 경로
    // (401 사일런트 리프레시 / 5xx 재시도)도 같은 config 를 재사용해 signal 을 승계한다.
    const response = await apiClient.post<SpineCalculationResult>(
      '/products/spine/calculate',
      params,
      options?.signal ? { signal: options.signal } : undefined
    );
    return response.data;
  },

  /**
   * 사용 가능한 용지 종류 목록 조회
   */
  async getPaperTypes(): Promise<PaperTypeInfo[]> {
    const response = await apiClient.get<PaperTypeInfo[]>('/products/spine/paper-types');
    return response.data;
  },

  /**
   * 사용 가능한 제본 방식 목록 조회
   */
  async getBindingTypes(): Promise<BindingTypeInfo[]> {
    const response = await apiClient.get<BindingTypeInfo[]>('/products/spine/binding-types');
    return response.data;
  },
};
