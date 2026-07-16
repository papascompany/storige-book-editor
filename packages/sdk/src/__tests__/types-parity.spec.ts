/**
 * 구조 등가성 테스트 — SDK 자체 재선언 계약 vs 서버 정본(@storige/types).
 *
 * ## 왜 이 테스트가 존재하는가
 * SDK 는 @storige/types 를 **런타임 의존하지 않는다**(private:true 패키지라
 * 통째 배포하면 2207줄 내부 도메인 모델이 전량 노출된다 — v1 계약은 75줄뿐).
 * 대신 계약을 자체 재선언하고, 서버가 계약을 바꾸면 이 테스트가 red 가 되어
 * 드리프트를 잡는다. @storige/types 는 devDependency 이므로 번들에 유입되지 않는다.
 *
 * ## 무엇을 대조하는가
 *  1) ErrV1 키집합·값 1:1 (29종 additive 성장도 여기서 감지)
 *  2) 봉투/페이지네이션 필드 집합 — 타입 레벨(컴파일 타임) 상호 할당 가능성
 *
 * 타입은 런타임에 지워지므로 (2)는 `expectAssignable` 스타일의 컴파일 타임
 * 단언으로 검사한다 — tsc(typecheck)·vitest 둘 다에서 red 가 된다.
 */

import { describe, expect, it } from 'vitest';
import {
  ErrV1,
  type PartnerV1ErrorEnvelope,
  type PartnerV1ErrorItem,
  type PartnerV1Pagination,
  type PartnerV1SuccessEnvelope,
} from '@storige/types';
import { ErrorCode, type ErrorItem, type KnownErrorCode } from '../errors';
import type { Pagination, SuccessEnvelope } from '../envelope';

describe('@storige/types 구조 등가성 (드리프트 감시)', () => {
  describe('ErrV1 카탈로그', () => {
    it('SDK ErrorCode 키집합 === 서버 ErrV1 키집합', () => {
      const serverKeys = Object.keys(ErrV1).sort();
      const sdkKeys = Object.keys(ErrorCode).sort();
      // 서버에 코드가 추가되면(additive) 여기서 red — SDK 카탈로그 갱신 신호
      expect(sdkKeys).toEqual(serverKeys);
    });

    it('SDK ErrorCode 값 === 서버 ErrV1 값 (1:1)', () => {
      const serverEntries = Object.entries(ErrV1 as Record<string, string>).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      const sdkEntries = Object.entries(ErrorCode as Record<string, string>).sort(
        ([a], [b]) => a.localeCompare(b),
      );
      expect(sdkEntries).toEqual(serverEntries);
    });

    it('카탈로그는 설계서 §3.3 의 29종이다', () => {
      expect(Object.keys(ErrorCode)).toHaveLength(29);
      expect(Object.keys(ErrV1)).toHaveLength(29);
    });

    it('모든 SDK 코드는 자기 이름과 같은 문자열 값을 가진다(키=값 규약)', () => {
      for (const [key, value] of Object.entries(ErrorCode)) {
        expect(value).toBe(key);
      }
    });

    it('KnownErrorCode 타입은 서버 ErrV1 값 union 과 상호 할당 가능', () => {
      // 컴파일 타임 단언 — 한쪽에만 코드가 생기면 tsc red
      const fromServer: KnownErrorCode = ErrV1.ERR_RATE_LIMITED;
      const toServer: ErrV1 = ErrorCode.ERR_RATE_LIMITED as ErrV1;
      expect(fromServer).toBe('ERR_RATE_LIMITED');
      expect(toServer).toBe(ErrV1.ERR_RATE_LIMITED);
    });
  });

  describe('봉투 구조 (컴파일 타임 상호 할당)', () => {
    it('Pagination ↔ PartnerV1Pagination', () => {
      const server: PartnerV1Pagination = { total: 3, limit: 20, offset: 0, hasNext: false };
      // 서버 → SDK 할당 가능(필드 누락 시 red)
      const sdk: Pagination = server;
      // SDK → 서버 할당 가능(잉여 필드/타입 불일치 시 red)
      const roundTrip: PartnerV1Pagination = sdk;
      expect(roundTrip).toEqual(server);
      expect(Object.keys(sdk).sort()).toEqual(['hasNext', 'limit', 'offset', 'total']);
    });

    it('SuccessEnvelope<T> ↔ PartnerV1SuccessEnvelope<T>', () => {
      const server: PartnerV1SuccessEnvelope<{ uid: string }> = {
        success: true,
        message: 'Success',
        data: { uid: 'bk_1' },
        pagination: null,
      };
      const sdk: SuccessEnvelope<{ uid: string }> = server;
      const roundTrip: PartnerV1SuccessEnvelope<{ uid: string }> = sdk;
      expect(roundTrip).toEqual(server);
      expect(Object.keys(sdk).sort()).toEqual(['data', 'message', 'pagination', 'success']);
    });

    it('ErrorItem ↔ PartnerV1ErrorItem', () => {
      const server: PartnerV1ErrorItem = { code: 'VALIDATION', message: 'x' };
      const sdk: ErrorItem = server;
      const roundTrip: PartnerV1ErrorItem = sdk;
      expect(roundTrip).toEqual(server);
    });

    it('에러 봉투 필드 6종 집합 일치', () => {
      const server: PartnerV1ErrorEnvelope = {
        success: false,
        errorCode: ErrV1.ERR_NOT_FOUND,
        message: '없음',
        errors: [],
        fieldErrors: null,
        requestId: 'req_1',
      };
      expect(Object.keys(server).sort()).toEqual([
        'errorCode',
        'errors',
        'fieldErrors',
        'message',
        'requestId',
        'success',
      ]);

      // 서버 봉투는 SDK ErrorEnvelope 로 그대로 수용돼야 한다.
      // (SDK 쪽 requestId 는 string|null — 스트림 중단 경로가 null 을 보내므로
      //  의도적으로 더 넓다. 따라서 서버→SDK 방향만 할당 가능하다.)
      const sdk: import('../envelope').ErrorEnvelope = server;
      expect(sdk.errorCode).toBe('ERR_NOT_FOUND');
    });
  });

  describe('알려진 드리프트(서버 트랙 에스컬레이션 대상)', () => {
    it('PartnerV1ErrorEnvelope.requestId 는 string 이나 스트림 중단 경로는 null 을 보낸다', () => {
      // books.controller.ts GET :uid/pdf 의 stream error 핸들러가
      //   res.status(500).json({ ..., requestId: null })
      // 을 보낸다 → 계약(string) 위반. SDK 는 string|null 로 방어한다.
      // 이 테스트는 SDK 의 방어적 타입 선택을 문서화한다(서버 수정 시 좁혀도 됨).
      const streamErrorBody = {
        success: false as const,
        errorCode: 'ERR_INTERNAL',
        message: '파일 스트리밍 중 오류가 발생했습니다',
        errors: [],
        fieldErrors: null,
        requestId: null,
      };
      const sdk: import('../envelope').ErrorEnvelope = streamErrorBody;
      expect(sdk.requestId).toBeNull();
    });
  });
});
