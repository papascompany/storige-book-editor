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
 */
@Injectable()
export class SitesService implements OnModuleInit {
  private readonly logger = new Logger(SitesService.name);

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
    return this.siteRepository.save(site);
  }

  async update(id: string, dto: UpdateSiteDto): Promise<Site> {
    const site = await this.findOne(id);
    Object.assign(site, dto);
    return this.siteRepository.save(site);
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
    return this.siteRepository.save(site);
  }

  async remove(id: string): Promise<void> {
    const site = await this.findOne(id);
    await this.siteRepository.remove(site);
  }
}
