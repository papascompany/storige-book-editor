import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrV1 } from '@storige/types';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { SitesService } from '../../sites/sites.service';
import { PartnerApiException } from '../http/partner-api.exceptions';
import {
  PartnerRequest,
  ensureRequestId,
  ensureStartedAt,
  resolvePartnerEnv,
} from '../http/request-context';
import {
  PARTNER_ENV_LIVE,
  PARTNER_LIVE_ONLY_KEY,
} from '../partner-api.constants';
import { PartnerApiKeysService } from '../keys/partner-api-keys.service';

/**
 * v1 전용 인증 가드 (설계서 §7.1, AD-5).
 *
 * - `Authorization: Bearer <key>` 와 `X-API-Key: <key>` 병행 수용, 동일 키 검증.
 * - 둘 다 오면 Authorization 우선, 값 불일치 시 401 ERR_UNAUTHORIZED(모호성 거부).
 * - 1차: 기존 공용 ApiKeyGuard(sites editor/worker 키 로직)에 **위임 재사용** —
 *   공용 가드 파일은 무수정(§2.1: v1 키가 기존 표면으로 새는 것을 구조적으로 차단).
 *   성공 시 env='live'·apiKeyId=null 을 additive 스탬프(sites 키=단일 env 체계).
 * - 2차(Stage 2 폴백): sites 키 실패 시 partner_api_keys 조회 —
 *   SHA-256 해시 대조 + revoked/grace 만료 검사 + site active 검사 후
 *   req.user 에 site 컨텍스트+env+apiKeyId 세팅. **이 폴백은 본 가드에만 실장** —
 *   v1 발급 키(test 포함)는 기존 external 표면에서 무효(§7.3 논리 분리).
 * - env 스코프: @PartnerLiveOnly 마킹 라우트를 test 키가 호출하면 403 ERR_ENV_MISMATCH.
 */
@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly partnerApiKeysService: PartnerApiKeysService,
    private readonly sitesService: SitesService,
    private readonly reflector: Reflector,
  ) {}

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

    let sitesKeyAuthenticated = false;
    try {
      sitesKeyAuthenticated = await this.apiKeyGuard.canActivate(context);
    } catch {
      sitesKeyAuthenticated = false; // sites 키 불일치 — 아래 partner_api_keys 폴백
    }

    if (sitesKeyAuthenticated && req.user) {
      // 기존 sites 키 경로 완전 불변 + Stage 2 additive 스탬프만
      req.user.env = PARTNER_ENV_LIVE;
      req.user.apiKeyId = null;
    } else {
      await this.authenticateWithPartnerKey(req, apiKey);
    }

    this.assertEnvAllowed(context, req);
    return true;
  }

  /** Stage 2 폴백 — partner_api_keys 해시 검증 (v1 가드 전용, 공용 가드 무접촉) */
  private async authenticateWithPartnerKey(
    req: PartnerRequest,
    apiKey: string,
  ): Promise<void> {
    const keyRow =
      await this.partnerApiKeysService.findValidByPlaintextKey(apiKey);
    if (!keyRow) {
      throw this.unauthorized('유효하지 않은 API Key 입니다');
    }

    // 키가 유효해도 소속 사이트가 없거나 suspended 면 거부 (sites 키와 동일 시맨틱)
    let siteName: string;
    let retentionDays: number | null;
    try {
      const site = await this.sitesService.findOne(keyRow.siteId);
      if (site.status !== 'active') {
        throw new Error('site suspended');
      }
      siteName = site.name;
      retentionDays = site.retentionDays ?? null;
    } catch {
      throw this.unauthorized('유효하지 않은 API Key 입니다');
    }

    req.user = {
      apiKey,
      source: 'partner',
      siteId: keyRow.siteId,
      siteName,
      role: 'editor',
      retentionDays,
      env: keyRow.env,
      apiKeyId: keyRow.id,
    };
  }

  /** @PartnerLiveOnly 라우트의 env 스코프 검사 — test 키는 403 ERR_ENV_MISMATCH */
  private assertEnvAllowed(
    context: ExecutionContext,
    req: PartnerRequest,
  ): void {
    const liveOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      PARTNER_LIVE_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!liveOnly) return;

    if (resolvePartnerEnv(req.user) !== 'live') {
      throw new PartnerApiException(
        ErrV1.ERR_ENV_MISMATCH,
        403,
        'test 환경 키로는 호출할 수 없는 live 전용 동작입니다',
      );
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
