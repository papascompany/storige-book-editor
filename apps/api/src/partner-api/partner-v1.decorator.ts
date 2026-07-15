import {
  Controller,
  UseFilters,
  UseGuards,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from './guards/partner-rate-limit.guard';
import { PartnerApiExceptionFilter } from './http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from './http/partner-envelope.interceptor';
import { PartnerAuditInterceptor } from './audit/partner-audit.interceptor';
import { PartnerIdempotencyInterceptor } from './idempotency/partner-idempotency.interceptor';

/**
 * v1 컨트롤러 조합 데코레이터 — Partner API v1 표준 스택을 한 번에 바인딩.
 *
 * 글로벌 prefix 'api'(main.ts setGlobalPrefix) 아래 'v1/...' 로 선언되어
 * 최종 경로가 /api/v1/... 이 된다 (설계서 모듈 배치 규약).
 *
 * 스택 구성(순서 의미 있음):
 *  - @Public(): 전역 JwtAuthGuard 우회 — 무인증 개방이 아니라 아래
 *    PartnerApiKeyGuard 가 파트너 키를 강제한다(하우스 @Public+가드 조합 패턴,
 *    v1 무인증 라우트 0 원칙).
 *  - Guards(순서 의미 있음): PartnerApiKeyGuard(Bearer/X-API-Key 병행 인증)
 *    → PartnerRateLimitGuard(per-Key §5.2 — req.user 필요, 기존 per-IP 병존)
 *  - Filter: PartnerApiExceptionFilter(에러 봉투 §3.2 + 에러 감사 + 멱등 재전달)
 *  - Interceptors(바깥→안): 감사 → 멱등(§4, POST+Idempotency-Key 자동 적용)
 *    → 성공 봉투(§3.1) — 멱등 스냅샷이 최종 봉투 shape 을 캡처하는 순서 전제
 *
 * Stage 3+ 의 신규 v1 컨트롤러(books/templates/webhooks)는 이 데코레이터만
 * 붙이면 표준 스택을 승계한다 — 트랙 B·OpenAPI 트랙 통합 포인트.
 */
export function PartnerV1Controller(path = ''): ClassDecorator {
  return applyDecorators(
    Controller(path ? `v1/${path}` : 'v1'),
    Public(),
    UseGuards(PartnerApiKeyGuard, PartnerRateLimitGuard),
    UseFilters(PartnerApiExceptionFilter),
    UseInterceptors(
      PartnerAuditInterceptor,
      PartnerIdempotencyInterceptor,
      PartnerEnvelopeInterceptor,
    ),
  );
}
