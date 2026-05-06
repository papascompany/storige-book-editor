import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-headerapikey';
import { SitesService } from '../../sites/sites.service';

/**
 * X-API-Key 인증 전략 (Phase A 갱신).
 *
 * 변경:
 *   - 기존: .env API_KEYS 단순 비교 → req.user = { apiKey, source: 'shop' }
 *   - 신규: SitesService DB 조회 → req.user = { apiKey, source: 'shop', siteId, siteName, role }
 *
 * 하위 호환:
 *   - 부팅 시 SitesService.onModuleInit() 가 .env API_KEYS 값을 DB에 시드
 *   - PHP 측 코드/.env 변경 0
 */
@Injectable()
export class ApiKeyStrategy extends PassportStrategy(Strategy, 'api-key') {
  private readonly logger = new Logger(ApiKeyStrategy.name);

  constructor(private readonly sitesService: SitesService) {
    super(
      { header: 'X-API-Key', prefix: '' },
      true,
      async (apiKey: string, done: (error: Error | null, data: any) => void) => {
        return this.validate(apiKey, done);
      },
    );
  }

  private async validate(
    apiKey: string,
    done: (error: Error | null, data: any) => void,
  ) {
    try {
      // 1. editor_auth_code 우선 매칭 (대부분 PHP 측 호출)
      let site = await this.sitesService.findByEditorAuthCode(apiKey);
      let role: 'editor' | 'worker' = 'editor';

      if (!site) {
        // 2. worker_auth_code 매칭 (편집기와 다른 키 사용 시)
        site = await this.sitesService.findByWorkerAuthCode(apiKey);
        role = 'worker';
      }

      if (!site) {
        done(null, false);
        return;
      }

      done(null, {
        apiKey,
        source: 'shop',
        siteId: site.id,
        siteName: site.name,
        role,
      });
    } catch (e) {
      this.logger.warn(`api-key validate error: ${(e as Error).message}`);
      done(null, false);
    }
  }
}
