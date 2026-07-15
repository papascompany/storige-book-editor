import { ExecutionContext } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

/**
 * 성공 응답 HTTP status 산출 — 인터셉터 시점의 res.statusCode 는 Nest 가
 * 라우트 기본값(POST=201)을 반영하기 전이라 @HttpCode 메타데이터 + 메서드
 * 기본값으로 계산한다. 감사 기록·멱등 스냅샷이 공유.
 */
export function resolveSuccessStatus(
  reflector: Reflector,
  context: ExecutionContext,
): number {
  const explicit = reflector.get<number | undefined>(
    HTTP_CODE_METADATA,
    context.getHandler(),
  );
  if (typeof explicit === 'number') return explicit;
  const method = context.switchToHttp().getRequest<Request>().method;
  return method === 'POST' ? 201 : 200;
}
