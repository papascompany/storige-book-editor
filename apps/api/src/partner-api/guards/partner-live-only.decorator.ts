import { SetMetadata } from '@nestjs/common';
import { PARTNER_LIVE_ONLY_KEY } from '../partner-api.constants';

/**
 * live 전용 v1 라우트 마킹 (test/live 환경 모델).
 *
 * test 키(partner_api_keys.env='test')가 마킹된 라우트를 호출하면
 * PartnerApiKeyGuard 가 403 ERR_ENV_MISMATCH 표준 에러로 거부한다.
 * sites 레거시 키는 live 취급이라 영향 없음.
 *
 * 현재 이 데코레이터를 붙인 라우트는 없다 — 전 v1 라우트가 test/live 양 env 를
 * 허용한다.
 */
export const PartnerLiveOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PARTNER_LIVE_ONLY_KEY, true);
