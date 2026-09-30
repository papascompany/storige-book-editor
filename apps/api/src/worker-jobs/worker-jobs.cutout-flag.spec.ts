/**
 * OPS-S4-N2 — 컷아웃 라우트 기능 플래그 게이트(WorkerJobsController.assertCutoutEnabled).
 *
 * 꺼져 있으면 라우트가 404(기존 페이로드 그대로)로 응답하고, 켜져 있으면 통과한다.
 * 술어는 config/feature-flags.ts isFlagOn(worker 와 같은 술어)이고, 소스는 ConfigService 다.
 */
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerJobsController } from './worker-jobs.controller';
import { WorkerJobsService } from './worker-jobs.service';

function createController(value: unknown): {
  assertCutoutEnabled(): void;
  requestedKeys: string[];
} {
  const requestedKeys: string[] = [];
  const config = {
    get: (key: string): unknown => {
      requestedKeys.push(key);
      return value;
    },
  } as unknown as ConfigService;
  const controller = new WorkerJobsController({} as unknown as WorkerJobsService, config);
  const gate = controller as unknown as { assertCutoutEnabled(): void };
  return {
    assertCutoutEnabled: () => gate.assertCutoutEnabled(),
    requestedKeys,
  };
}

describe('WorkerJobsController 컷아웃 기능 플래그 게이트', () => {
  it.each<[unknown]>([[undefined], [null], [''], ['false'], ['0'], ['yes']])(
    'CUTOUT_ENABLED=%j → 404 NOT_FOUND(기존 페이로드)',
    (value) => {
      const c = createController(value);
      let caught: unknown;
      try {
        c.assertCutoutEnabled();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NotFoundException);
      expect((caught as NotFoundException).getStatus()).toBe(404);
      expect((caught as NotFoundException).getResponse()).toEqual({
        code: 'NOT_FOUND',
        message: 'Cannot resolve route',
      });
    },
  );

  it.each<[unknown]>([['true'], [' TRUE '], ['1'], ['True']])(
    'CUTOUT_ENABLED=%j → 통과',
    (value) => {
      expect(() => createController(value).assertCutoutEnabled()).not.toThrow();
    },
  );

  it('CUTOUT_ENABLED 키를 ConfigService 에서 읽는다', () => {
    const c = createController('true');
    c.assertCutoutEnabled();
    expect(c.requestedKeys).toEqual(['CUTOUT_ENABLED']);
  });
});
