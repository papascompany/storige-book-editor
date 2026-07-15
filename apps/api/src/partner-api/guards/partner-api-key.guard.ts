import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ErrV1 } from '@storige/types';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { PartnerApiException } from '../http/partner-api.exceptions';
import {
  PartnerRequest,
  ensureRequestId,
  ensureStartedAt,
} from '../http/request-context';

/**
 * v1 전용 인증 가드 (설계서 §7.1, AD-5).
 *
 * - `Authorization: Bearer <key>` 와 `X-API-Key: <key>` 병행 수용, 동일 키 검증.
 * - 둘 다 오면 Authorization 우선, 값 불일치 시 401 ERR_UNAUTHORIZED(모호성 거부).
 * - 실제 키 검증은 기존 공용 ApiKeyGuard(sites editor/worker 키 로직)에 **위임 재사용** —
 *   공용 가드 파일은 무수정(§2.1: v1 키가 기존 표면으로 새는 것을 구조적으로 차단,
 *   Stage 2 의 partner_api_keys 조회 폴백도 이 가드에만 얹는다).
 * - v1 요청 컨텍스트(@CurrentSite)는 공용 가드가 세팅한 req.user 를 그대로 재사용.
 */
@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyGuard: ApiKeyGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PartnerRequest>();
    // v1 요청 최초 접점 — requestId·latency 기점 확보(인증 실패 봉투/감사에도 필요)
    ensureRequestId(req);
    ensureStartedAt(req);

    const bearer = this.extractBearer(req.headers['authorization']);
    const headerKeyRaw = req.headers['x-api-key'];
    const headerKey = typeof headerKeyRaw === 'string' ? headerKeyRaw : undefined;

    if (bearer && headerKey && bearer !== headerKey) {
      // 모호성 거부 — 어느 키로 인증할지 단정할 수 없음
      throw this.unauthorized(
        'Authorization Bearer 와 X-API-Key 값이 일치하지 않습니다',
      );
    }

    const apiKey = bearer ?? headerKey;
    if (!apiKey) {
      throw this.unauthorized('API Key 가 필요합니다 (Authorization: Bearer 또는 X-API-Key)');
    }

    // 위임: 공용 가드는 x-api-key 헤더만 읽으므로 선택된 키를 주입 후 재사용.
    // (Bearer 단독 요청도 이 시점부터 공용 로직과 동일 경로 — 검증 로직 중복 0)
    req.headers['x-api-key'] = apiKey;

    try {
      return await this.apiKeyGuard.canActivate(context);
    } catch {
      // 공용 가드의 UnauthorizedException 을 v1 표준 봉투 예외로 표준화
      throw this.unauthorized('유효하지 않은 API Key 입니다');
    }
  }

  private extractBearer(header: string | undefined): string | undefined {
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : undefined;
  }

  private unauthorized(message: string): PartnerApiException {
    return new PartnerApiException(ErrV1.ERR_UNAUTHORIZED, 401, message);
  }
}
