import { SetMetadata } from '@nestjs/common';

export const PARTNER_OPERATOR_ALLOWED_KEY = 'partnerOperatorAllowed';

/**
 * 운영자 대리 편집 토큰(source 'partner_operator')을 받아들이는 핸들러 표시 (2026-09-29).
 *
 * JwtAuthGuard 는 운영자 토큰을 **기본 거부**하고, 이 메타데이터가 **핸들러에** 있을 때만 통과시킨다
 * (클래스 수준 메타데이터는 읽지 않는다). 허용 목록은 partner-operator-allowlist.spec.ts 가 고정한다.
 * 메서드에만 사용한다.
 */
export const PartnerOperatorAllowed = (): MethodDecorator =>
  SetMetadata(PARTNER_OPERATOR_ALLOWED_KEY, true);
