/**
 * files JWT 라우트 소유 판정 (2026-09-30) — getFile·getFiles·downloadFile·deleteFile.
 *
 * 호출자 회원 번호가 양의 정수이고 파일 memberSeqno 와 같을 때만 소유자로 본다(userId 없음·0 은 소유자 아님).
 * 목록(getFiles)의 memberSeqno 분기는 양의 정수 회원 번호만 허용한다.
 * staff(admin·manager)는 역할 문자열 대소문자와 무관하게 네 라우트 모두 같은 판정이다.
 */
import { HttpException } from '@nestjs/common';
import { FilesController } from './files.controller';
import type { FilesService } from './files.service';
import type { PresignedUploadService } from './presigned-upload.service';
import type { Response } from 'express';

const FILE_ID = '11111111-1111-4111-8111-111111111111';

interface FileRow {
  id: string;
  memberSeqno: number | null;
}

/** userId 가 없는 로그인 사용자(관리자 앱 User 엔티티, 비-staff 역할) */
const noUserId = { id: 'user-uuid-1', role: 'customer' };
/** shop 토큰(회원 번호 0) */
const shopZero = { userId: '0', source: 'shop', role: 'customer' };
const member777 = { userId: '777', source: 'shop', role: 'customer' };
const staffAdmin = { id: 'admin-1', role: 'admin' };
const staffUpper = { id: 'admin-2', role: 'ADMIN' };
const managerUpper = { id: 'admin-3', role: 'MANAGER' };

async function statusOf(p: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
}

describe('FilesController — 소유 판정(회원 번호가 양의 정수일 때만 소유자)', () => {
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

  beforeEach(() => {
    current = { id: FILE_ID, memberSeqno: 0 };
    filesService = {
      findById: jest.fn(async () => current),
      findByOrderSeqno: jest.fn(async (): Promise<FileRow[]> => [
        { id: 'f-null', memberSeqno: null },
        { id: 'f-zero', memberSeqno: 0 },
        { id: 'f-777', memberSeqno: 777 },
      ]),
      findByMemberSeqno: jest.fn(async (m: number): Promise<FileRow[]> => [{ id: `f-${m}`, memberSeqno: m }]),
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

  const res = {} as Response;

  describe('getFile · downloadFile · deleteFile', () => {
    it.each([
      ['getFile', (u: unknown) => controller.getFile(FILE_ID, u)],
      ['downloadFile', (u: unknown) => controller.downloadFile(FILE_ID, res, u)],
      ['deleteFile', (u: unknown) => controller.deleteFile(FILE_ID, u)],
    ])('%s: userId 없음 + 파일 memberSeqno 0 → 403', async (_l, call) => {
      expect(await statusOf(call(noUserId))).toBe(403);
      expect(await statusOf(call(undefined))).toBe(403);
      expect(filesService.softDelete).not.toHaveBeenCalled();
      expect(filesService.getFileStream).not.toHaveBeenCalled();
    });

    it.each([
      ['getFile', (u: unknown) => controller.getFile(FILE_ID, u)],
      ['downloadFile', (u: unknown) => controller.downloadFile(FILE_ID, res, u)],
      ['deleteFile', (u: unknown) => controller.deleteFile(FILE_ID, u)],
    ])('%s: shop 토큰(회원 번호 0) + 파일 memberSeqno 0 → 403', async (_l, call) => {
      expect(await statusOf(call(shopZero))).toBe(403);
      expect(filesService.softDelete).not.toHaveBeenCalled();
      expect(filesService.getFileStream).not.toHaveBeenCalled();
    });

    it('회원 번호가 음수인 shop 토큰 + 같은 memberSeqno 파일 → 403', async () => {
      current = { id: FILE_ID, memberSeqno: -5 };
      expect(await statusOf(controller.getFile(FILE_ID, { userId: '-5', source: 'shop', role: 'customer' }))).toBe(403);
    });

    it('downloadFile: 소유자 → 권한 통과 후 스트림 조회(불변)', async () => {
      current = { id: FILE_ID, memberSeqno: 777 };
      await expect(controller.downloadFile(FILE_ID, res, member777)).rejects.toThrow('stream-called');
    });

    it('회원 소유자 통과·타 회원 403·파일 memberSeqno NULL 은 비-staff 403 (불변)', async () => {
      current = { id: FILE_ID, memberSeqno: 777 };
      expect(await statusOf(controller.getFile(FILE_ID, member777))).toBe('ok');
      expect(await statusOf(controller.getFile(FILE_ID, { userId: '778', source: 'shop' }))).toBe(403);
      current = { id: FILE_ID, memberSeqno: null };
      expect(await statusOf(controller.getFile(FILE_ID, shopZero))).toBe(403);
      expect(await statusOf(controller.getFile(FILE_ID, noUserId))).toBe(403);
    });

    it('staff(admin·ADMIN) → userId 없어도 통과(불변)', async () => {
      expect(await statusOf(controller.getFile(FILE_ID, staffAdmin))).toBe('ok');
      expect(await statusOf(controller.deleteFile(FILE_ID, staffUpper))).toBe('ok');
    });

    it('대문자 역할(ADMIN·MANAGER) → getFile 통과, downloadFile 은 스트림 조회까지 진행', async () => {
      for (const staff of [staffUpper, managerUpper]) {
        expect(await statusOf(controller.getFile(FILE_ID, staff))).toBe('ok');
        await expect(controller.downloadFile(FILE_ID, res, staff)).rejects.toThrow('stream-called');
      }
    });
  });

  describe('getFiles', () => {
    it('orderSeqno: userId 없음 → 빈 목록', async () => {
      const out = await controller.getFiles(noUserId, '5');
      expect(out).toEqual({ files: [], total: 0 });
    });

    it('orderSeqno: 회원 → 본인 파일만(불변)', async () => {
      const out = await controller.getFiles(member777, '5');
      expect(out.files).toEqual([{ id: 'f-777' }]);
    });

    it('memberSeqno=0: userId 없음 → 403, shop 토큰(회원 번호 0) → 403', async () => {
      expect(await statusOf(controller.getFiles(noUserId, undefined, '0'))).toBe(403);
      expect(await statusOf(controller.getFiles(shopZero, undefined, '0'))).toBe(403);
      expect(filesService.findByMemberSeqno).not.toHaveBeenCalled();
    });

    it('파라미터 없음: userId 없음 → 빈 목록, 회원 → 본인 목록(불변)', async () => {
      expect(await controller.getFiles(noUserId)).toEqual({ files: [], total: 0 });
      expect(filesService.findByMemberSeqno).not.toHaveBeenCalled();
      const out = await controller.getFiles(member777);
      expect(out.files).toEqual([{ id: 'f-777' }]);
    });

    it('staff → 임의 memberSeqno 조회 통과(불변)', async () => {
      expect(await statusOf(controller.getFiles(staffAdmin, undefined, '123'))).toBe('ok');
      expect(filesService.findByMemberSeqno).toHaveBeenCalledWith(123);
    });

    it('대문자 역할(ADMIN) → 임의 memberSeqno 조회 통과, orderSeqno 결과 전량', async () => {
      expect(await statusOf(controller.getFiles(staffUpper, undefined, '456'))).toBe('ok');
      expect(filesService.findByMemberSeqno).toHaveBeenCalledWith(456);
      const out = await controller.getFiles(staffUpper, '5');
      expect(out.files).toEqual([{ id: 'f-null' }, { id: 'f-zero' }, { id: 'f-777' }]);
    });
  });
});
