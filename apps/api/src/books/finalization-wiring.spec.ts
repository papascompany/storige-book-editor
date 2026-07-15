/**
 * [적대 리뷰 P1-1] books ⇄ worker-jobs 콜백 역참조 DI 배선 실검증.
 *
 * WorkerJobsService 의 `@Optional() @Inject(forwardRef(() => BookFinalizationsService))`
 * 는 배선(forwardRef 순환·BooksModule export)이 깨지면 bookFinalizationsService 를
 * undefined 로 **침묵** 실체화한다 → finalization 마커 잡 콜백(onWorkerJobSettled)이
 * 영원히 no-op → finalization 이 VALIDATING/COMPOSING 에서 교착한다.
 *
 * 이 spec 은 배선이 깨지면 red 가 되도록 3중으로 잠근다:
 *  ① 실 DI 성립: 두 서비스(+ 상호 forwardRef 상대 BooksService)를 Nest DI 로 컴파일하고
 *     WorkerJobsService 가 BookFinalizationsService **인스턴스**를 주입받는지 단언
 *     (@Inject(forwardRef) 토큰이 깨지면 @Optional 이 undefined 로 만들어 red).
 *  ② 모듈 계약: 실 BooksModule/WorkerJobsModule 의 exports·forwardRef imports 메타데이터
 *     (BooksModule.exports ∋ BookFinalizationsService, 두 모듈 imports 가 서로를 forwardRef)
 *     — export/import 배선이 깨지면 red.
 *  ③ 배선 실패 관측: onModuleInit 이 미주입 시 warn(침묵 마스킹 방지), 주입 시 무경고.
 *
 * ⚠️ 실 BooksModule+WorkerJobsModule 전체(imports 전이 그래프: Bull/@Global Sites/PartnerApi/
 *    Templates …)를 Test.createTestingModule 로 통째 컴파일하면 Nest injector 가
 *    RangeError(Maximum call stack) 로 죽는다(깊은 forwardRef 모듈 순환) — 그래서 ①은 두
 *    서비스 클래스를 leaf 스텁과 함께 평면 모듈로 컴파일(실 DI 데코레이터 관통)하고, 모듈
 *    수준 배선은 ②의 메타데이터 리플렉션으로 잠근다.
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { Logger } from '@nestjs/common';

import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { WorkerJobsModule } from '../worker-jobs/worker-jobs.module';
import { BooksService } from './books.service';
import { BooksModule } from './books.module';
import { BookFinalizationsService } from './book-finalizations.service';

import { WorkerJob } from '../worker-jobs/entities/worker-job.entity';
import { EditSessionEntity } from '../edit-sessions/entities/edit-session.entity';
import { Book } from './entities/book.entity';
import { BookAsset } from './entities/book-asset.entity';
import { BookFinalization } from './entities/book-finalization.entity';
import { BookSpec } from '../book-specs/entities/book-spec.entity';

import { FilesService } from '../files/files.service';
import { WebhookService } from '../webhook/webhook.service';
import { SitesService } from '../sites/sites.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { BookSpecsService } from '../book-specs/book-specs.service';
import { EditSessionsService } from '../edit-sessions/edit-sessions.service';

const repoStub = () => ({});
const queueStub = () => ({ add: jest.fn() });

describe('finalization DI 배선(P1-1) — books ⇄ worker-jobs', () => {
  // ── ① 실 DI 성립: WorkerJobsService 가 BookFinalizationsService 를 주입받는다 ──
  it('① Nest DI: WorkerJobsService.bookFinalizationsService = BookFinalizationsService 인스턴스', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        // 상호 forwardRef 3-클래스 순환(worker ⇄ finalization ⇄ books)을 실 데코레이터로 컴파일
        WorkerJobsService,
        BookFinalizationsService,
        BooksService,
        // repos
        { provide: getRepositoryToken(WorkerJob), useFactory: repoStub },
        { provide: getRepositoryToken(EditSessionEntity), useFactory: repoStub },
        { provide: getRepositoryToken(Book), useFactory: repoStub },
        { provide: getRepositoryToken(BookAsset), useFactory: repoStub },
        { provide: getRepositoryToken(BookFinalization), useFactory: repoStub },
        { provide: getRepositoryToken(BookSpec), useFactory: repoStub },
        // bull queues
        { provide: getQueueToken('pdf-validation'), useFactory: queueStub },
        { provide: getQueueToken('pdf-conversion'), useFactory: queueStub },
        { provide: getQueueToken('pdf-synthesis'), useFactory: queueStub },
        // leaf services
        { provide: FilesService, useValue: {} },
        { provide: WebhookService, useValue: {} },
        { provide: SitesService, useValue: {} },
        { provide: TemplateSetsService, useValue: {} },
        { provide: BookSpecsService, useValue: {} },
        { provide: EditSessionsService, useValue: {} },
      ],
    }).compile();

    const wjs = moduleRef.get(WorkerJobsService);
    const injected = (wjs as unknown as { bookFinalizationsService?: unknown })
      .bookFinalizationsService;
    // 배선 깨짐(@Inject(forwardRef) 토큰 오류 등)이면 @Optional 이 undefined 로 만들어 여기서 red.
    expect(injected).toBeDefined();
    expect(injected).toBeInstanceOf(BookFinalizationsService);
    await moduleRef.close();
  });

  // ── ② 모듈 계약(exports·forwardRef imports) 리플렉션 ──
  const importsOf = (mod: unknown): unknown[] =>
    (Reflect.getMetadata('imports', mod as object) as unknown[]) ?? [];
  const exportsOf = (mod: unknown): unknown[] =>
    (Reflect.getMetadata('exports', mod as object) as unknown[]) ?? [];
  const forwardRefResolvesTo = (imports: unknown[], target: unknown): boolean =>
    imports.some((i) => {
      const fr = (i as { forwardRef?: () => unknown })?.forwardRef;
      return typeof fr === 'function' && fr() === target;
    });

  it('② BooksModule 이 BookFinalizationsService 를 export(콜백 역참조 주입원)', () => {
    expect(exportsOf(BooksModule)).toContain(BookFinalizationsService);
  });

  it('② WorkerJobsModule imports 가 BooksModule 을 forwardRef(순환 배선)', () => {
    expect(forwardRefResolvesTo(importsOf(WorkerJobsModule), BooksModule)).toBe(true);
  });

  it('② BooksModule imports 가 WorkerJobsModule 을 forwardRef(순환 배선)', () => {
    expect(forwardRefResolvesTo(importsOf(BooksModule), WorkerJobsModule)).toBe(true);
  });

  // ── ③ 배선 실패 관측(onModuleInit warn) — 침묵 마스킹 방지 ──
  const makeWorkerJobsService = (
    finService?: Partial<BookFinalizationsService>,
  ): WorkerJobsService =>
    new WorkerJobsService(
      {} as never, // workerJobRepository
      {} as never, // editSessionRepository
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      { add: jest.fn() } as never, // synthesisQueue
      {} as never, // filesService
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
      finService as never, // @Optional bookFinalizationsService
    );

  it('③ 미주입이면 onModuleInit 이 warn(배선 실패 관측)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    makeWorkerJobsService(undefined).onModuleInit();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('BookFinalizationsService 미주입');
    warn.mockRestore();
  });

  it('③ 주입되면 onModuleInit 무경고(정상 배선)', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    makeWorkerJobsService({ onWorkerJobSettled: jest.fn() }).onModuleInit();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
