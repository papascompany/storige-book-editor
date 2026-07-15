import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { ErrV1 } from '@storige/types';
import { WebhookConfig } from '../entities/webhook-config.entity';
import { PartnerApiException } from '../../partner-api/http/partner-api.exceptions';
import { SitesService } from '../../sites/sites.service';
import {
  WEBHOOK_V2_CONFIG,
  WEBHOOK_V2_SUBSCRIBABLE_EVENTS,
} from './webhook-v2.constants';
import { WebhookV2Config } from './webhook-v2.config';
import {
  encryptWebhookSecret,
  generateWebhookSecret,
} from './webhook-secret.crypto';

/**
 * 웹훅 v2 config CRUD + 발신용 config 조회(캐시) — 설계서 §1.5 라우트 20~22.
 *
 * - secret 은 생성/회전 응답에서만 1회 노출(원문 미보관 — secret_enc 만 저장).
 * - url 은 기존 발신 경로와 동일한 SSRF allowlist 를 통과해야 한다
 *   (env WEBHOOK_ALLOWED_HOSTS + sites 동적 매칭 — 422 ERR_WEBHOOK_URL_FORBIDDEN).
 * - 발신측(WebhookDeliveryService)은 findActiveConfigCached 로 조회 —
 *   30초 TTL 캐시로 이벤트당 DB 조회를 상수화, 쓰기 시 즉시 무효화.
 */

export interface WebhookConfigView {
  url: string;
  env: 'test' | 'live';
  events: string[];
  status: 'active' | 'disabled';
  secretPrefix: string;
  createdAt: Date;
  updatedAt: Date;
  /** 생성/회전 시에만 존재 — 이후 재조회 불가(1회 노출) */
  secret?: string;
}

export interface UpsertWebhookConfigInput {
  url: string;
  events?: string[];
  rotateSecret?: boolean;
}

const CONFIG_CACHE_TTL_MS = 30_000;

/**
 * 기존 v1 발신과 동일 규약의 정적 allowlist (webhook.service.ts 와 동일 파싱 —
 * 발신 정본 코드는 동결 표면이라 import 하지 않고 규약만 복제, 주석으로 상호 참조).
 */
function parseAllowedHosts(): string[] {
  const env = process.env.WEBHOOK_ALLOWED_HOSTS;
  if (env === '*') return []; // 와일드카드 = 검증 비활성화
  if (env && env.length > 0) {
    return env.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [
    'papascompany.co.kr',
    'bookmoa.com',
    'localhost',
    '127.0.0.1',
    'host.docker.internal',
  ];
}

@Injectable()
export class WebhookConfigService {
  private readonly logger = new Logger(WebhookConfigService.name);

  /** (siteId:env) → config|null — 발신 핫패스 캐시 */
  private cache = new Map<
    string,
    { expiresAt: number; config: WebhookConfig | null }
  >();

  constructor(
    @InjectRepository(WebhookConfig)
    private readonly configRepository: Repository<WebhookConfig>,
    @Inject(WEBHOOK_V2_CONFIG) private readonly v2Config: WebhookV2Config,
    @Optional() private readonly sitesService?: SitesService,
  ) {}

  /** v2 활성 여부 (WEBHOOK_CONFIG_ENC_KEY 유효 주입) */
  get enabled(): boolean {
    return this.v2Config.enabled;
  }

  // ── 발신측 조회 ────────────────────────────────────────────────────────

  /**
   * 발신용 active config 조회(30초 캐시). v2 비활성/미등록/비활성 상태면 null —
   * 호출측은 null 이면 기존 v1 경로로 폴스루한다(opt-in 불변식).
   */
  async findActiveConfigCached(
    siteId: string,
    env: 'test' | 'live',
  ): Promise<WebhookConfig | null> {
    if (!this.v2Config.enabled) return null; // 비활성 — DB 조회조차 없음(현행 무영향)

    const key = `${siteId}:${env}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.config;

    const config = await this.configRepository.findOne({
      where: { siteId, env, status: 'active' },
    });
    this.cache.set(key, {
      expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
      config: config ?? null,
    });
    return config ?? null;
  }

  private invalidateCache(siteId: string, env: 'test' | 'live'): void {
    this.cache.delete(`${siteId}:${env}`);
  }

  // ── v1 API CRUD ───────────────────────────────────────────────────────

  /**
   * PUT /api/v1/webhooks/config — upsert.
   * 생성 시 secret 자동 발급(응답 1회 노출). 갱신은 secret 유지 —
   * rotateSecret=true 일 때만 재발급(역시 1회 노출).
   */
  async upsert(
    siteId: string,
    env: 'test' | 'live',
    input: UpsertWebhookConfigInput,
  ): Promise<WebhookConfigView> {
    this.assertEnabled();
    await this.assertUrlAllowed(input.url);
    const events = this.normalizeEvents(input.events);

    const existing = await this.configRepository.findOne({
      where: { siteId, env },
    });

    let issuedSecret: string | undefined;

    if (!existing) {
      const generated = generateWebhookSecret();
      issuedSecret = generated.secret;
      const config = this.configRepository.create({
        id: randomUUID(),
        siteId,
        env,
        url: input.url,
        secretEnc: encryptWebhookSecret(generated.secret, this.v2Config.encKey!),
        secretPrefix: generated.secretPrefix,
        events,
        status: 'active' as const,
      });
      await this.configRepository.save(config);
      this.invalidateCache(siteId, env);
      this.logger.log(
        `webhook v2 config 생성 — site=${siteId} env=${env} (secret 1회 노출)`,
      );
      return this.toView(config, issuedSecret);
    }

    existing.url = input.url;
    existing.events = events;
    existing.status = 'active';
    if (input.rotateSecret) {
      const generated = generateWebhookSecret();
      issuedSecret = generated.secret;
      existing.secretEnc = encryptWebhookSecret(
        generated.secret,
        this.v2Config.encKey!,
      );
      existing.secretPrefix = generated.secretPrefix;
      this.logger.log(
        `webhook v2 secret 회전 — site=${siteId} env=${env} (신규 secret 1회 노출)`,
      );
    }
    await this.configRepository.save(existing);
    this.invalidateCache(siteId, env);
    return this.toView(existing, issuedSecret);
  }

  /** GET /api/v1/webhooks/config — secret 은 prefix 마스킹만 */
  async get(siteId: string, env: 'test' | 'live'): Promise<WebhookConfigView> {
    const config = await this.configRepository.findOne({
      where: { siteId, env },
    });
    if (!config) throw this.notFound();
    return this.toView(config);
  }

  /** DELETE /api/v1/webhooks/config — 발송 중지(행 삭제. 이력은 보존) */
  async remove(
    siteId: string,
    env: 'test' | 'live',
  ): Promise<{ deleted: true }> {
    const config = await this.configRepository.findOne({
      where: { siteId, env },
    });
    if (!config) throw this.notFound();
    await this.configRepository.delete({ id: config.id });
    this.invalidateCache(siteId, env);
    this.logger.log(`webhook v2 config 삭제 — site=${siteId} env=${env}`);
    return { deleted: true };
  }

  // ── 내부 ─────────────────────────────────────────────────────────────

  private toView(config: WebhookConfig, secret?: string): WebhookConfigView {
    return {
      url: config.url,
      env: config.env,
      events: config.events,
      status: config.status,
      secretPrefix: config.secretPrefix,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      ...(secret !== undefined ? { secret } : {}),
    };
  }

  private normalizeEvents(events: string[] | undefined): string[] {
    if (!events || events.length === 0) return []; // 빈 배열 = 전체 구독
    const catalog = new Set<string>(WEBHOOK_V2_SUBSCRIBABLE_EVENTS);
    const unknown = events.filter((e) => !catalog.has(e));
    if (unknown.length > 0) {
      throw new PartnerApiException(
        ErrV1.ERR_VALIDATION_FAILED,
        400,
        '요청 검증에 실패했습니다',
        [],
        {
          events: [
            `알 수 없는 이벤트: ${unknown.join(', ')} (허용: ${WEBHOOK_V2_SUBSCRIBABLE_EVENTS.join(', ')})`,
          ],
        },
      );
    }
    return [...new Set(events)];
  }

  private assertEnabled(): void {
    if (!this.v2Config.enabled) {
      throw new PartnerApiException(
        ErrV1.ERR_SERVICE_UNAVAILABLE,
        503,
        '웹훅 설정 기능이 비활성 상태입니다 (서버에 WEBHOOK_CONFIG_ENC_KEY 미설정)',
      );
    }
  }

  /**
   * SSRF 방어 — 기존 발신 allowlist(env 정적 + sites 동적)와 동일 규약.
   * 통과 못하면 422 ERR_WEBHOOK_URL_FORBIDDEN (설계서 §3.3).
   */
  private async assertUrlAllowed(rawUrl: string): Promise<void> {
    const forbidden = (detail: string) =>
      new PartnerApiException(
        ErrV1.ERR_WEBHOOK_URL_FORBIDDEN,
        422,
        `웹훅 URL 이 허용되지 않습니다 — ${detail}`,
      );

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw forbidden('URL 형식 불량');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw forbidden('http/https 만 허용');
    }

    const allowedHosts = parseAllowedHosts();
    if (allowedHosts.length === 0) return; // 와일드카드 모드(현행 규약 동일)

    const host = url.hostname.toLowerCase();
    const staticMatch = allowedHosts.some(
      (allowed) =>
        host === allowed.toLowerCase() ||
        host.endsWith('.' + allowed.toLowerCase()),
    );
    if (staticMatch) return;

    if (this.sitesService) {
      try {
        if (await this.sitesService.isWebhookHostAllowed(rawUrl)) return;
      } catch (err) {
        this.logger.error(
          `sites 기반 webhook host 확인 실패: ${(err as Error).message}`,
        );
      }
    }
    throw forbidden(
      '허용 호스트 목록에 없음 — 사이트 도메인 등록(admin) 후 재시도',
    );
  }

  private notFound(): PartnerApiException {
    return new PartnerApiException(
      ErrV1.ERR_WEBHOOK_CONFIG_NOT_FOUND,
      404,
      '웹훅 설정이 없습니다 — PUT /api/v1/webhooks/config 로 먼저 등록하세요',
    );
  }
}
