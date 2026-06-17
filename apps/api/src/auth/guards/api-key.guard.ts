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

    // P2c: 내부 워커 키(WORKER_API_KEY)는 Default Site 의 editor==worker 코드 때문에 위에서 'editor'로
    // 매칭되더라도 'worker'(신뢰 내부 워커)로 강제한다. → 외부 라우트 테넌트 스코프(P2c S-1~S-3)를
    // 바이패스해 워커 콜백(PATCH status)·파일 처리(download/external)가 테넌트 잡/파일에서도 무중단.
    const workerApiKey = process.env.WORKER_API_KEY;
    if (workerApiKey && apiKey === workerApiKey) {
      role = 'worker';
    }

    request.user = {
      apiKey,
      source: 'shop',
      siteId: site.id,
      siteName: site.name,
      role,
      retentionDays: site.retentionDays ?? null, // 업로드 파일 보존정책 적용용
    };
    return true;
  }
}
