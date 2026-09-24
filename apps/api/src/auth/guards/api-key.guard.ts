import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { SitesService } from '../../sites/sites.service';
import { resolveApiKeyRole } from '../api-key-role';

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

    // editor 코드 우선, 없으면 worker 코드 — 둘 다 **그 사이트의 키**로 인정한다.
    let site = await this.sitesService.findByEditorAuthCode(apiKey);
    if (!site) {
      site = await this.sitesService.findByWorkerAuthCode(apiKey);
    }

    if (!site) {
      throw new UnauthorizedException('Invalid API Key');
    }

    // W1 (2026-09-25): role='worker'(테넌트 바이패스 신뢰 주체)는 내부 WORKER_API_KEY 에만 부여한다.
    // 종전에는 worker 코드로 매칭되기만 하면 'worker' 였다 → 파트너 worker 키가 테넌시를 전부 우회했다.
    // 내부 키는 Default Site 의 editor==worker 코드라 위에서 editor 로 매칭돼도 여기서 'worker' 가 된다
    // (P2c: 워커 콜백 PATCH status·파일 처리 download/external 의 테넌트 잡/파일 무중단 — 종전과 동일).
    const role = resolveApiKeyRole(apiKey, process.env.WORKER_API_KEY);

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
