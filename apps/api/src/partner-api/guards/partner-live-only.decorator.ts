import { SetMetadata } from '@nestjs/common';
import { PARTNER_LIVE_ONLY_KEY } from '../partner-api.constants';

/**
 * live 전용 v1 라우트 마킹 (Stage 2 환경 모델 — 로드맵 §6 Stage 2 작업 1).
 *
 * test 키(partner_api_keys.env='test')가 마킹된 라우트를 호출하면
 * PartnerApiKeyGuard 가 403 ERR_ENV_MISMATCH 표준 에러로 거부한다.
 * sites 레거시 키는 live 취급이라 영향 없음.
 *
 * 사용처(예정): Stage 3+ 의 live 전용 동작 — 실제 생산 finalization,
 * live 웹훅 설정 변경 등. 현 Stage 표면(GET 조회)은 마킹하지 않는다.
 */
export const PartnerLiveOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PARTNER_LIVE_ONLY_KEY, true);
