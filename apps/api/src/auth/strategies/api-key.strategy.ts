import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-headerapikey';
import { SitesService } from '../../sites/sites.service';
import { resolveApiKeyRole } from '../api-key-role';

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

      if (!site) {
        // 2. worker_auth_code 매칭 (편집기와 다른 키 사용 시) — 그 사이트의 키로 인정만 한다
        site = await this.sitesService.findByWorkerAuthCode(apiKey);
      }

      if (!site) {
        done(null, false);
        return;
      }

      // W1 (2026-09-25): ApiKeyGuard 와 같은 판정. 현재 AuthGuard('api-key') 사용처는 0곳이지만
      // 연결되는 순간 파트너 worker 키 테넌시 우회가 재발하지 않도록 같은 단일 원천을 쓴다.
      const role = resolveApiKeyRole(apiKey, process.env.WORKER_API_KEY);

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
