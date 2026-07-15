import { SetMetadata } from '@nestjs/common';
import {
  PARTNER_RATE_BUCKET_KEY,
  PartnerRateBucket,
} from '../partner-api.constants';

/**
 * v1 레이트리밋 버킷 지정 (설계서 §5.2).
 *
 * 기본 'general'(300 req/min per Key). 업로드/최종화 계열 라우트에
 * `@PartnerRateLimitBucket('heavy')`(100 req/min per Key)를 부착한다 —
 * Stage 3 books 자산/finalization 라우트의 통합 포인트.
 */
export const PartnerRateLimitBucket = (
  bucket: PartnerRateBucket,
): MethodDecorator & ClassDecorator =>
  SetMetadata(PARTNER_RATE_BUCKET_KEY, bucket);
