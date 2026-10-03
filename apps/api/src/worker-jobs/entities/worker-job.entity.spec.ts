/**
 * worker_jobs.edit_session_id 저장(2026-10-03).
 *
 *  - editSessionId 컬럼은 생성 INSERT 에 들어가고(insert), 이후 UPDATE 에서는 빠진다(update:false).
 *  - 관계(editSession)와 같은 DB 컬럼 하나를 쓴다.
 *  - 실제 저장 경로(repository.save — WorkerJobsService 생성 메서드)로 sqlite 인메모리 DB 에 기록된 값을 확인한다.
 *    세션 행이 없어 FK 를 위반하면 연결 없이 1회 다시 저장한다.
 */
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJob } from './worker-job.entity';
import { EditSessionEntity } from '../../edit-sessions/entities/edit-session.entity';
import { FileEntity } from '../../files/entities/file.entity';
import { WorkerJobsService } from '../worker-jobs.service';
import type { CreateConversionJobDto, CreateValidationJobDto } from '../dto/worker-job.dto';

const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const MISSING_SESSION_ID = '99999999-9999-4999-8999-999999999999';

describe('WorkerJob 엔티티 — edit_session_id 매핑', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'mysql',
      database: 'spec_no_connect',
      entities: [WorkerJob, EditSessionEntity, FileEntity],
    });
    await (ds as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  });

  it('editSessionId 컬럼: INSERT 대상, UPDATE 제외', () => {
    const col = ds.getMetadata(WorkerJob).findColumnWithPropertyName('editSessionId');
    expect(col).toBeDefined();
    expect(col!.isInsert).toBe(true);
    expect(col!.isUpdate).toBe(false);
  });

  it('edit_session_id DB 컬럼은 1개이고 editSession 관계의 조인 컬럼과 같다', () => {
    const meta = ds.getMetadata(WorkerJob);
    const cols = meta.columns.filter((c) => c.databaseName === 'edit_session_id');
    expect(cols).toHaveLength(1);
    const rel = meta.findRelationWithPropertyPath('editSession');
    expect(rel!.joinColumns[0].databaseName).toBe('edit_session_id');
  });

  it('INSERT: editSessionId 값이 edit_session_id 열에 1회 실린다', () => {
    const [sql, params] = ds
      .createQueryBuilder()
      .insert()
      .into(WorkerJob)
      .values({ id: 'job-1', jobType: WorkerJobType.VALIDATE, status: WorkerJobStatus.PENDING, editSessionId: 's-1' })
      .getQueryAndParameters();
    expect(sql.match(/`edit_session_id`/g)).toHaveLength(1);
    expect(params).toContain('s-1');
  });

  it('INSERT: editSession 관계 객체로 넣어도 같은 열에 실린다', () => {
    const [sql, params] = ds
      .createQueryBuilder()
      .insert()
      .into(WorkerJob)
      .values({
        id: 'job-2',
        jobType: WorkerJobType.CONVERT,
        status: WorkerJobStatus.PENDING,
        editSession: { id: 's-2' },
      })
      .getQueryAndParameters();
    expect(sql.match(/`edit_session_id`/g)).toHaveLength(1);
    expect(params).toContain('s-2');
  });

  it('UPDATE: editSessionId 는 SET 에 들어가지 않는다', () => {
    const sql = ds
      .createQueryBuilder()
      .update(WorkerJob)
      .set({ editSessionId: 's-3', status: WorkerJobStatus.PROCESSING })
      .where('id = :id', { id: 'job-3' })
      .getQuery();
    expect(sql).not.toContain('edit_session_id');
    expect(sql).toContain('`status`');
  });
});

describe('WorkerJobsService 생성 저장 — sqlite 실저장(edit_session_id)', () => {
  let lite: DataSource;
  let repo: Repository<WorkerJob>;
  let service: WorkerJobsService;
  let warnSpy: jest.SpyInstance;
  let webhookService: { hasV2Config: jest.Mock; sendCallback: jest.Mock };

  beforeEach(async () => {
    lite = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [WorkerJob, EditSessionEntity, FileEntity],
    });
    // 엔티티의 mysql 전용 타입(enum·timestamp)을 이 드라이버 인스턴스의 지원 목록에 더해 메타데이터 검증을 통과시킨다.
    // synchronize 는 하지 않고 테이블은 아래에서 만든다(sqlite 드라이버는 연결 시 PRAGMA foreign_keys = ON).
    lite.driver.supportedDataTypes.push('enum', 'timestamp');
    await lite.initialize();
    await lite.query('CREATE TABLE file_edit_sessions (id TEXT PRIMARY KEY, site_id TEXT)');
    const cols = lite
      .getMetadata(WorkerJob)
      .columns.map((c) => `\`${c.databaseName}\``)
      .join(', ');
    await lite.query(
      `CREATE TABLE worker_jobs (${cols}, FOREIGN KEY (edit_session_id) REFERENCES file_edit_sessions(id) ON DELETE SET NULL)`,
    );
    await lite.query('INSERT INTO file_edit_sessions (id, site_id) VALUES (?, NULL)', [SESSION_ID]);
    repo = lite.getRepository(WorkerJob);

    webhookService = { hasV2Config: jest.fn(async () => false), sendCallback: jest.fn(async () => true) };
    service = new WorkerJobsService(
      repo,
      { findOne: jest.fn(), update: jest.fn() } as never, // editSessionRepository
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      { add: jest.fn() } as never, // synthesisQueue
      {} as never, // filesService
      webhookService as never,
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await lite.destroy();
  });

  const storedSessionIds = async (): Promise<Array<string | null>> =>
    ((await lite.query('SELECT edit_session_id AS sid FROM worker_jobs')) as Array<{ sid: string | null }>).map(
      (r) => r.sid,
    );

  const validateDto = (editSessionId?: string): CreateValidationJobDto =>
    ({
      fileUrl: 'https://files.example.com/a.pdf',
      fileType: 'content',
      ...(editSessionId ? { editSessionId } : {}),
    }) as CreateValidationJobDto;

  it('검증 잡 생성: 요청한 세션 id 가 edit_session_id 에 기록된다', async () => {
    const job = await service.createValidationJob(validateDto(SESSION_ID));
    expect(job.editSessionId).toBe(SESSION_ID);
    expect(await storedSessionIds()).toEqual([SESSION_ID]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('변환 잡 생성: 요청한 세션 id 가 edit_session_id 에 기록된다', async () => {
    const job = await service.createConversionJob({
      fileUrl: 'https://files.example.com/a.pdf',
      editSessionId: SESSION_ID,
    } as CreateConversionJobDto);
    expect(job.editSessionId).toBe(SESSION_ID);
    expect(await storedSessionIds()).toEqual([SESSION_ID]);
  });

  it('세션 id 없음: NULL 로 기록된다', async () => {
    const job = await service.createValidationJob(validateDto());
    expect(job.editSessionId).toBeNull();
    expect(await storedSessionIds()).toEqual([null]);
  });

  it('없는 세션 id(FK 위반): 연결 없이 잡 1건이 생성되고 로그는 라우트만 남긴다', async () => {
    const job = await service.createValidationJob(validateDto(MISSING_SESSION_ID));
    expect(job.editSessionId).toBeNull();
    expect(job.editSession).toBeNull();
    expect(await storedSessionIds()).toEqual([null]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('[job-link] unlinked route=validate reason=session-missing');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(MISSING_SESSION_ID);
  });

  it('상태 보고(updateJobStatus): edit_session_id 는 그대로이고 응답에 세션 관계 키가 없다', async () => {
    const created = await service.createValidationJob(validateDto(SESSION_ID));
    const updated = await service.updateJobStatus(created.id, { status: WorkerJobStatus.COMPLETED });
    expect(updated.status).toBe(WorkerJobStatus.COMPLETED);
    expect(updated.editSessionId).toBe(SESSION_ID);
    expect(updated.editSession).toBeUndefined();
    expect(JSON.parse(JSON.stringify(updated))).not.toHaveProperty('editSession'); // 응답 본문 직렬화 결과
    const rows = (await lite.query('SELECT status, edit_session_id AS sid FROM worker_jobs')) as Array<{
      status: string;
      sid: string | null;
    }>;
    expect(rows).toEqual([{ status: WorkerJobStatus.COMPLETED, sid: SESSION_ID }]);
  });
});
