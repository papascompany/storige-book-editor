import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { SitesService } from '../../sites/sites.service';

/**
 * X-API-Key Guard (Phase A 갱신).
 *
 * Phase A:
 *   - DB의 sites 테이블 조회 → req.user = { apiKey, source, siteId, siteName, role }
 *   - 인증코드 매칭 안 되거나 status=suspended면 401
 *   - 기존 .env API_KEYS 값은 부팅 시 SitesService.onModuleInit() 가 시드 → 호환
 *
 * @CurrentSite() 데코레이터로 컨트롤러에서 site 컨텍스트 추출 가능.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly sitesService: SitesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('API Key is required');
    }

    let site = await this.sitesService.findByEditorAuthCode(apiKey);
    let role: 'editor' | 'worker' = 'editor';

    if (!site) {
      site = await this.sitesService.findByWorkerAuthCode(apiKey);
      role = 'worker';
    }

    if (!site) {
      throw new UnauthorizedException('Invalid API Key');
    }

    request.user = {
      apiKey,
      source: 'shop',
      siteId: site.id,
      siteName: site.name,
      role,
    };
    return true;
  }
}
