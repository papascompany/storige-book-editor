import { Injectable, NotFoundException, OnModuleInit, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Site } from './entities/site.entity';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';

/**
 * SitesService — 외부 사이트(테넌트) CRUD + 인증코드 lookup.
 *
 * 부팅 시 .env의 API_KEYS 값을 DB에 시드 (하위 호환). 이후 admin에서
 * 사이트 추가/관리. ApiKeyStrategy는 본 서비스의 findByEditorAuthCode() 사용.
 *
 * Phase 1-2 (2026-05-16) — 도메인 보안 정책 캐시:
 * CORS callback / CSP frame-ancestors / webhook host 검증이 매 요청마다
 * DB 조회하면 비용이 크므로 60초 캐시한다. Admin 에서 사이트 수정 시
 * `invalidatePolicyCache()` 로 즉시 무효화 가능.
 */
@Injectable()
export class SitesService implements OnModuleInit {
  private readonly logger = new Logger(SitesService.name);

  // ── Phase 1-2 도메인 보안 정책 캐시 (60초 TTL) ────────────────
  private readonly POLICY_CACHE_TTL_MS = 60 * 1000;
  private policyCache: {
    expiresAt: number;
    allowedOrigins: Set<string>;
    frameAncestorsByOrigin: Map<string, string[]>; // origin → 해당 site 의 frameAncestors
    webhookAllowedHosts: Set<string>;
  } | null = null;

  constructor(
    @InjectRepository(Site)
    private readonly siteRepository: Repository<Site>,
  ) {}

  async onModuleInit(): Promise<void> {
    // 부팅 시 .env API_KEYS 값을 DB로 시드 (한 번만, idempotent)
    const apiKeysEnv = process.env.API_KEYS || '';
    const keys = apiKeysEnv
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    for (const key of keys) {
      const existing = await this.siteRepository.findOne({
        where: { editorAuthCode: key },
      });
      if (!existing) {
        // .env 키가 DB에 없으면 'Default Site' 명으로 시드 (admin에서 이름 변경 가능)
        await this.siteRepository.save({
          name: 'Default Site',
          editorAuthCode: key,
          workerAuthCode: key,
          status: 'active',
        });
        this.logger.log(`Seeded Site row for env API key (prefix=${key.slice(0, 8)}…)`);
      }
    }

    const count = await this.siteRepository.count();
    this.logger.log(`SitesService initialized — ${count} site(s) registered`);
  }

  generateAuthCode(prefix = 'sk-storige-'): string {
    return prefix + randomBytes(24).toString('hex');
  }

  async findAll(): Promise<Site[]> {
    return this.siteRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Site> {
    const site = await this.siteRepository.findOne({ where: { id } });
    if (!site) throw new NotFoundException(`Site ${id} not found`);
    return site;
  }

  /** ApiKeyStrategy 가 사용 — 활성 사이트 중 editorAuthCode 일치 조회 */
  async findByEditorAuthCode(code: string): Promise<Site | null> {
    return this.siteRepository.findOne({
      where: { editorAuthCode: code, status: 'active' },
    });
  }

  /** 워커 호출용 (Phase A에선 editor와 동일 값이지만 별도 lookup 길 마련) */
  async findByWorkerAuthCode(code: string): Promise<Site | null> {
    return this.siteRepository.findOne({
      where: { workerAuthCode: code, status: 'active' },
    });
  }

  async create(dto: CreateSiteDto): Promise<Site> {
    const editorAuthCode = dto.editorAuthCode || this.generateAuthCode();
    const workerAuthCode = dto.workerAuthCode || editorAuthCode;

    // 인증코드 충돌 사전 검사 (DB unique 제약과 별도 사용자 친화 메시지)
    const conflict = await this.siteRepository.findOne({
      where: [{ editorAuthCode }, { workerAuthCode }],
    });
    if (conflict) {
      throw new ConflictException('인증코드가 이미 다른 사이트에서 사용 중입니다.');
    }

    const site = this.siteRepository.create({
      ...dto,
      editorAuthCode,
      workerAuthCode,
      status: dto.status ?? 'active',
    });
    const saved = await this.siteRepository.save(site);
    this.invalidatePolicyCache();
    return saved;
  }

  async update(id: string, dto: UpdateSiteDto): Promise<Site> {
    const site = await this.findOne(id);
    Object.assign(site, dto);
    const saved = await this.siteRepository.save(site);
    this.invalidatePolicyCache();
    return saved;
  }

  async regenerateAuthCodes(
    id: string,
    target: 'editor' | 'worker' | 'both' = 'both',
  ): Promise<Site> {
    const site = await this.findOne(id);
    if (target === 'editor' || target === 'both') {
      site.editorAuthCode = this.generateAuthCode();
    }
    if (target === 'worker' || target === 'both') {
      site.workerAuthCode = this.generateAuthCode();
    }
    const saved = await this.siteRepository.save(site);
    this.invalidatePolicyCache();
    return saved;
  }

  async remove(id: string): Promise<void> {
    const site = await this.findOne(id);
    await this.siteRepository.remove(site);
    this.invalidatePolicyCache();
  }

  // ─────────────────────────────────────────────────────
  // Phase 1-2 (2026-05-16) — 도메인 보안 정책 동적 조회
  // CORS / CSP frame-ancestors / webhook host 검증의 단일 출처.
  // 60초 캐시. 사이트 수정/삭제 시 자동 무효화.
  // ─────────────────────────────────────────────────────

  /** 캐시 무효화 (Admin 에서 사이트 수정 직후 호출) */
  invalidatePolicyCache(): void {
    this.policyCache = null;
  }

  /**
   * 모든 활성 사이트의 도메인 보안 정책을 합쳐서 반환 (캐시).
   *
   * - allowedOrigins: 모든 사이트의 allowed_origins 합집합
   * - frameAncestorsByOrigin: 각 origin 이 등록된 site 의 frame_ancestors
   * - webhookAllowedHosts: 모든 사이트의 upload_callback_url 호스트 + frame_ancestors 호스트
   */
  private async getPolicyCache(): Promise<NonNullable<SitesService['policyCache']>> {
    const now = Date.now();
    if (this.policyCache && this.policyCache.expiresAt > now) {
      return this.policyCache;
    }

    const sites = await this.siteRepository.find({
      where: { status: 'active' },
    });

    const allowedOrigins = new Set<string>();
    const frameAncestorsByOrigin = new Map<string, string[]>();
    const webhookAllowedHosts = new Set<string>();

    for (const site of sites) {
      const origins = (site.allowedOrigins || []).filter(Boolean);
      const ancestors = (site.frameAncestors || []).filter(Boolean);

      for (const origin of origins) {
        allowedOrigins.add(origin);
        if (!frameAncestorsByOrigin.has(origin)) {
          frameAncestorsByOrigin.set(origin, []);
        }
        frameAncestorsByOrigin.get(origin)!.push(...ancestors);
      }

      // webhook 호스트: upload_callback_url + domain
      for (const urlStr of [site.uploadCallbackUrl, site.domain]) {
        if (!urlStr) continue;
        try {
          const u = new URL(urlStr);
          webhookAllowedHosts.add(u.hostname.toLowerCase());
        } catch {
          // 무시
        }
      }
    }

    this.policyCache = {
      expiresAt: now + this.POLICY_CACHE_TTL_MS,
      allowedOrigins,
      frameAncestorsByOrigin,
      webhookAllowedHosts,
    };
    return this.policyCache;
  }

  /** 외부 origin 이 어느 사이트에든 허용되어 있는지 (CORS callback 용) */
  async isOriginAllowed(origin: string): Promise<boolean> {
    const cache = await this.getPolicyCache();
    return cache.allowedOrigins.has(origin);
  }

  /** Editor 응답 CSP frame-ancestors 헤더에 들어갈 호스트 목록 (중복 제거) */
  async getAllFrameAncestors(): Promise<string[]> {
    const cache = await this.getPolicyCache();
    const all = new Set<string>();
    for (const arr of cache.frameAncestorsByOrigin.values()) {
      for (const ancestor of arr) all.add(ancestor);
    }
    return Array.from(all);
  }

  /** Webhook callback URL 호스트가 어느 사이트에든 등록되어 있는지 */
  async isWebhookHostAllowed(callbackUrl: string): Promise<boolean> {
    let url: URL;
    try {
      url = new URL(callbackUrl);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

    const cache = await this.getPolicyCache();
    const host = url.hostname.toLowerCase();
    if (cache.webhookAllowedHosts.has(host)) return true;
    // 서브도메인 매칭
    for (const allowed of cache.webhookAllowedHosts) {
      if (host.endsWith('.' + allowed)) return true;
    }
    return false;
  }
}
