/**
 * OPS-S4-N2 — QueueMonitorService.isEnabled() (기동 스냅샷용).
 *
 * enabled 는 필드 초기화 시점에 process.env 를 읽으므로 env 를 설정한 뒤 인스턴스를 만든다.
 * onModuleInit 은 호출하지 않는다(interval 생성 방지).
 */
import { Queue } from 'bull';
import { QueueMonitorService } from './queue-monitor.service';

function create(): QueueMonitorService {
  const q = {} as unknown as Queue;
  return new QueueMonitorService(q, q, q);
}

describe('QueueMonitorService.isEnabled', () => {
  const backup = process.env.QUEUE_MONITOR_ENABLED;

  beforeEach(() => {
    delete process.env.QUEUE_MONITOR_ENABLED;
  });

  afterEach(() => {
    if (backup === undefined) delete process.env.QUEUE_MONITOR_ENABLED;
    else process.env.QUEUE_MONITOR_ENABLED = backup;
  });

  it('미설정이면 true', () => {
    expect(create().isEnabled()).toBe(true);
  });

  it("'false' 면 false", () => {
    process.env.QUEUE_MONITOR_ENABLED = 'false';
    expect(create().isEnabled()).toBe(false);
  });

  it.each(['FALSE', '0', 'true', ''])('%j 면 true (정확히 false 일 때만 OFF)', (raw) => {
    process.env.QUEUE_MONITOR_ENABLED = raw;
    expect(create().isEnabled()).toBe(true);
  });
});
