/**
 * files JWT 라우트 목록 회원 번호 판정 + 사이트 범위 (2026-09-30).
 *
 *  - getFiles: 비-staff 호출자의 회원 번호가 양의 정수가 아니면 orderSeqno·무파라미터 분기는 빈 목록,
 *    memberSeqno 분기는 요청 번호가 양의 정수가 아니면 403 PERMISSION_DENIED.
 *  - getFiles: 비-staff 호출자 토큰에 siteId 가 있으면 다른 site 파일은 목록에서 제외(NULL-site 포함).
 *  - getFile·downloadFile·deleteFile: 비-staff 호출자 토큰 siteId 와 파일 siteId 가 모두 있고 다르면
 *    404 FILE_NOT_FOUND(소유 판정보다 먼저). NULL-site 파일·siteId 없는 토큰은 종전 판정.
 *  - staff(admin·manager·super_admin)는 사이트 조건 없이 종전 규칙. SITE_ADMIN·SITE_MANAGER 는 staff 가 아니다.
 */
import { HttpException } from '@nestjs/common';
import { FilesController } from './files.controller';
import type { FilesService } from './files.service';
import type { PresignedUploadService } from './presigned-upload.service';
import type { Response } from 'express';

const FILE_ID = '22222222-2222-4222-8222-222222222222';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface FileRow {
  id: string;
  memberSeqno: number | null;
  siteId: string | null;
}

interface Caller {
  id?: string;
  userId?: string;
  source?: string;
  role?: string;
  siteId?: string;
}

const shop = (userId: string, siteId?: string): Caller => ({
  userId,
  source: 'shop',
  role: 'customer',
  ...(siteId ? { siteId } : {}),
});
const staffAdmin: Caller = { id: 'admin-1', role: 'admin', siteId: SITE_A };
const staffManagerUpper: Caller = { id: 'admin-2', role: 'MANAGER', siteId: SITE_A };
const staffSuperUpper: Caller = { id: 'admin-3', role: 'SUPER_ADMIN', siteId: SITE_A };

async function errorOf(p: Promise<unknown>): Promise<{ status: number | 'ok'; code?: string }> {
  try {
    await p;
    return { status: 'ok' };
  } catch (e) {
    if (e instanceof HttpException) {
      const body = e.getResponse() as { code?: string };
      return { status: e.getStatus(), code: body?.code };
    }
    throw e;
  }
}

describe('FilesController — 목록 회원 번호 판정 · 사이트 범위', () => {
  let filesService: {
    findById: jest.Mock;
    findByOrderSeqno: jest.Mock;
    findByMemberSeqno: jest.Mock;
    toResponseDto: jest.Mock;
    softDelete: jest.Mock;
    getFileStream: jest.Mock;
  };
  let controller: FilesController;
  let current: FileRow;

  const rowsFor = (m: number): FileRow[] => [
    { id: `f-${m}-a`, memberSeqno: m, siteId: SITE_A },
    { id: `f-${m}-b`, memberSeqno: m, siteId: SITE_B },
    { id: `f-${m}-null`, memberSeqno: m, siteId: null },
  ];

  beforeEach(() => {
    current = { id: FILE_ID, memberSeqno: 777, siteId: SITE_B };
    filesService = {
      findById: jest.fn(async () => current),
      findByOrderSeqno: jest.fn(async (): Promise<FileRow[]> => [
        { id: 'o-zero', memberSeqno: 0, siteId: null },
        { id: 'o-neg', memberSeqno: -5, siteId: null },
        { id: 'o-777-a', memberSeqno: 777, siteId: SITE_A },
        { id: 'o-777-b', memberSeqno: 777, siteId: SITE_B },
        { id: 'o-777-null', memberSeqno: 777, siteId: null },
      ]),
      findByMemberSeqno: jest.fn(async (m: number): Promise<FileRow[]> => rowsFor(m)),
      toResponseDto: jest.fn((f: FileRow) => ({ id: f.id })),
      softDelete: jest.fn().mockResolvedValue(undefined),
      // 권한 통과 후에만 호출된다 — 여기서 멈춰 스트리밍 경로를 타지 않게 한다
      getFileStream: jest.fn().mockRejectedValue(new Error('stream-called')),
    };
    controller = new FilesController(
      filesService as unknown as FilesService,
      {} as unknown as PresignedUploadService,
    );
  });

  const ids = (r: { files: Array<{ id: string }> }): string[] => r.files.map((f) => f.id);
  const res = {} as Response;

  describe('getFiles — 회원 번호가 양의 정수가 아닌 비-staff 호출자', () => {
    it.each(['0', '-5'])('orderSeqno 분기: 회원 번호 %s → 빈 목록', async (sub) => {
      expect(await controller.getFiles(shop(sub), '5')).toEqual({ files: [], total: 0 });
    });

    it.each(['0', '-5'])('memberSeqno 분기: 회원 번호 %s 의 본인 번호 조회 → 403 PERMISSION_DENIED', async (sub) => {
      expect(await errorOf(controller.getFiles(shop(sub), undefined, sub))).toEqual({
        status: 403,
        code: 'PERMISSION_DENIED',
      });
      expect(filesService.findByMemberSeqno).not.toHaveBeenCalled();
    });

    it('memberSeqno 분기: 비숫자 요청 번호 → 403 PERMISSION_DENIED', async () => {
      expect(await errorOf(controller.getFiles(shop('777'), undefined, 'abc'))).toEqual({
        status: 403,
        code: 'PERMISSION_DENIED',
      });
    });

    it.each(['0', '-5'])('파라미터 없음: 회원 번호 %s → 빈 목록', async (sub) => {
      expect(await controller.getFiles(shop(sub))).toEqual({ files: [], total: 0 });
      expect(filesService.findByMemberSeqno).not.toHaveBeenCalled();
    });

    it('staff 의 memberSeqno=0 조회 → 통과', async () => {
      expect((await errorOf(controller.getFiles(staffAdmin, undefined, '0'))).status).toBe('ok');
      expect(filesService.findByMemberSeqno).toHaveBeenCalledWith(0);
    });
  });

  describe('getFiles — 사이트 범위', () => {
    it('site A 회원: orderSeqno·memberSeqno·무파라미터 분기 모두 A + NULL-site 만', async () => {
      expect(ids(await controller.getFiles(shop('777', SITE_A), '5'))).toEqual(['o-777-a', 'o-777-null']);
      expect(ids(await controller.getFiles(shop('777', SITE_A), undefined, '777'))).toEqual([
        'f-777-a',
        'f-777-null',
      ]);
      const out = await controller.getFiles(shop('777', SITE_A));
      expect(ids(out)).toEqual(['f-777-a', 'f-777-null']);
      expect(out.total).toBe(2);
    });

    it('siteId 없는 회원 토큰 → 사이트 조건 없이 본인 파일 전량', async () => {
      expect(ids(await controller.getFiles(shop('777'), '5'))).toEqual(['o-777-a', 'o-777-b', 'o-777-null']);
      expect(ids(await controller.getFiles(shop('777')))).toEqual(['f-777-a', 'f-777-b', 'f-777-null']);
    });

    it('staff(siteId 포함) → 사이트 조건 없이 전량', async () => {
      expect(ids(await controller.getFiles(staffAdmin, undefined, '123'))).toEqual([
        'f-123-a',
        'f-123-b',
        'f-123-null',
      ]);
      expect(ids(await controller.getFiles(staffAdmin, '5'))).toEqual([
        'o-zero',
        'o-neg',
        'o-777-a',
        'o-777-b',
        'o-777-null',
      ]);
    });

    it('staff(SUPER_ADMIN) 목록 → memberSeqno·orderSeqno 사이트 조건 없이 전량', async () => {
      expect(ids(await controller.getFiles(staffSuperUpper, undefined, '123'))).toEqual([
        'f-123-a',
        'f-123-b',
        'f-123-null',
      ]);
      expect(ids(await controller.getFiles(staffSuperUpper, '5'))).toEqual([
        'o-zero',
        'o-neg',
        'o-777-a',
        'o-777-b',
        'o-777-null',
      ]);
    });
  });

  describe('getFile · downloadFile · deleteFile — 사이트 범위', () => {
    const routes: Array<[string, (u: Caller) => Promise<unknown>]> = [
      ['getFile', (u) => controller.getFile(FILE_ID, u)],
      ['downloadFile', (u) => controller.downloadFile(FILE_ID, res, u)],
      ['deleteFile', (u) => controller.deleteFile(FILE_ID, u)],
    ];

    it.each(routes)('%s: site A 호출자 + site B 파일 → 404 FILE_NOT_FOUND(소유자·비소유자 동일)', async (_l, call) => {
      current = { id: FILE_ID, memberSeqno: 777, siteId: SITE_B };
      expect(await errorOf(call(shop('777', SITE_A)))).toEqual({ status: 404, code: 'FILE_NOT_FOUND' });
      expect(await errorOf(call(shop('778', SITE_A)))).toEqual({ status: 404, code: 'FILE_NOT_FOUND' });
      expect(filesService.softDelete).not.toHaveBeenCalled();
      expect(filesService.getFileStream).not.toHaveBeenCalled();
    });

    it.each(routes)('%s: 같은 site 파일·NULL-site 파일의 비소유자 → 403 PERMISSION_DENIED', async (_l, call) => {
      for (const siteId of [SITE_A, null]) {
        current = { id: FILE_ID, memberSeqno: 777, siteId };
        expect(await errorOf(call(shop('778', SITE_A)))).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      }
      expect(filesService.softDelete).not.toHaveBeenCalled();
      expect(filesService.getFileStream).not.toHaveBeenCalled();
    });

    it('소유자 통과 경로: 같은 site·NULL-site·siteId 없는 토큰', async () => {
      for (const siteId of [SITE_A, null]) {
        current = { id: FILE_ID, memberSeqno: 777, siteId };
        expect((await errorOf(controller.getFile(FILE_ID, shop('777', SITE_A)))).status).toBe('ok');
        await expect(controller.downloadFile(FILE_ID, res, shop('777', SITE_A))).rejects.toThrow('stream-called');
      }
      current = { id: FILE_ID, memberSeqno: 777, siteId: SITE_B };
      expect((await errorOf(controller.getFile(FILE_ID, shop('777')))).status).toBe('ok');
      expect((await errorOf(controller.deleteFile(FILE_ID, shop('777')))).status).toBe('ok');
      expect(filesService.softDelete).toHaveBeenCalledWith(FILE_ID);
    });

    it('staff(siteId=A) + site B 파일 → 종전대로 통과', async () => {
      current = { id: FILE_ID, memberSeqno: 777, siteId: SITE_B };
      expect((await errorOf(controller.getFile(FILE_ID, staffAdmin))).status).toBe('ok');
      await expect(controller.downloadFile(FILE_ID, res, staffAdmin)).rejects.toThrow('stream-called');
      expect((await errorOf(controller.deleteFile(FILE_ID, staffManagerUpper))).status).toBe('ok');
    });

    it('staff(SUPER_ADMIN, siteId=A) + site B 파일 → getFile·downloadFile·deleteFile 사이트 조건 없이 통과', async () => {
      current = { id: FILE_ID, memberSeqno: 777, siteId: SITE_B };
      expect((await errorOf(controller.getFile(FILE_ID, staffSuperUpper))).status).toBe('ok');
      await expect(controller.downloadFile(FILE_ID, res, staffSuperUpper)).rejects.toThrow('stream-called');
      expect((await errorOf(controller.deleteFile(FILE_ID, staffSuperUpper))).status).toBe('ok');
      expect(filesService.softDelete).toHaveBeenCalledWith(FILE_ID);
    });

    it('SITE_ADMIN 역할은 staff 판정 대상이 아니다 — 같은 사이트 파일이어도 소유자가 아니면 403 PERMISSION_DENIED', async () => {
      current = { id: FILE_ID, memberSeqno: 777, siteId: SITE_A };
      const siteAdmin: Caller = { id: 'site-admin-1', role: 'SITE_ADMIN', siteId: SITE_A };
      expect(await errorOf(controller.getFile(FILE_ID, siteAdmin))).toEqual({
        status: 403,
        code: 'PERMISSION_DENIED',
      });
      expect(await errorOf(controller.deleteFile(FILE_ID, siteAdmin))).toEqual({
        status: 403,
        code: 'PERMISSION_DENIED',
      });
      expect(filesService.softDelete).not.toHaveBeenCalled();
    });
  });
});
