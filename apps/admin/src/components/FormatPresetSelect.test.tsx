// @vitest-environment happy-dom
// 판형 프리셋 픽커 — 방향 토글이 폼의 현재 치수를 따르는지, 그 방향으로 프리셋 치수를 주입하는지.
import { createTestQueryClient, renderWithAntd } from '../test/renderWithAntd';
import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormatPresetSelect } from './FormatPresetSelect';
import type { FormatPreset } from '../api/formatPresets';

const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../api/formatPresets', () => ({ formatPresetsApi: { list: mocks.list } }));

const A4: FormatPreset = {
  id: 'preset-a4',
  code: 'a4',
  name: 'A4',
  trimWidthMm: 210,
  trimHeightMm: 297,
  bleedMm: 3,
  sortOrder: 1,
  isActive: true,
};

function checkedOrientation(): string | undefined {
  const checked = document.querySelector<HTMLInputElement>('input[type="radio"]:checked');
  return checked?.value;
}

async function pickA4(container: HTMLElement): Promise<void> {
  fireEvent.mouseDown(container.querySelector('.ant-select-selector') as HTMLElement);
  const option = await waitFor(() => {
    const found = Array.from(document.querySelectorAll<HTMLElement>('.ant-select-item-option')).find((el) =>
      el.textContent?.startsWith('A4'),
    );
    if (!found) throw new Error('A4 옵션 없음');
    return found;
  });
  fireEvent.click(option);
}

describe('FormatPresetSelect 방향 토글', () => {
  beforeEach(() => {
    mocks.list.mockReset();
    mocks.list.mockResolvedValue([A4]);
  });

  it('치수를 받지 않으면 세로형에서 시작한다', () => {
    renderWithAntd(<FormatPresetSelect onApply={vi.fn()} />, { queryClient: createTestQueryClient() });
    expect(checkedOrientation()).toBe('portrait');
  });

  it('가로 치수(297×210)를 받으면 가로형으로 표시하고, 값은 주입하지 않는다', () => {
    const onApply = vi.fn();
    renderWithAntd(<FormatPresetSelect onApply={onApply} currentWidthMm={297} currentHeightMm={210} />, {
      queryClient: createTestQueryClient(),
    });
    expect(checkedOrientation()).toBe('landscape');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('치수가 나중에 들어오거나 바뀌면 토글이 따라가고, 정사각·빈 값에서는 그대로 둔다', () => {
    const onApply = vi.fn();
    const view = renderWithAntd(<FormatPresetSelect onApply={onApply} />, { queryClient: createTestQueryClient() });
    view.rerender(<FormatPresetSelect onApply={onApply} currentWidthMm={297} currentHeightMm={210} />);
    expect(checkedOrientation()).toBe('landscape');
    view.rerender(<FormatPresetSelect onApply={onApply} currentWidthMm={210} currentHeightMm={210} />);
    expect(checkedOrientation()).toBe('landscape');
    view.rerender(<FormatPresetSelect onApply={onApply} currentWidthMm={undefined} currentHeightMm={210} />);
    expect(checkedOrientation()).toBe('landscape');
    view.rerender(<FormatPresetSelect onApply={onApply} currentWidthMm={210} currentHeightMm={297} />);
    expect(checkedOrientation()).toBe('portrait');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('가로형 폼에서 프리셋을 고르면 가로 치수로 주입한다', async () => {
    const onApply = vi.fn();
    const view = renderWithAntd(
      <FormatPresetSelect onApply={onApply} currentWidthMm={297} currentHeightMm={210} />,
      { queryClient: createTestQueryClient() },
    );
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await pickA4(view.container);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({ trimW: 297, trimH: 210, bleedMm: 3 });
  });

  it('치수를 받지 않는 폼에서는 종전대로 세로 치수로 주입하고, 토글을 누르면 가로 치수로 다시 주입한다', async () => {
    const onApply = vi.fn();
    const view = renderWithAntd(<FormatPresetSelect onApply={onApply} />, {
      queryClient: createTestQueryClient(),
    });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    await pickA4(view.container);
    expect(onApply).toHaveBeenLastCalledWith({ trimW: 210, trimH: 297, bleedMm: 3 });
    fireEvent.click(document.querySelector('input[type="radio"][value="landscape"]') as HTMLInputElement);
    expect(onApply).toHaveBeenLastCalledWith({ trimW: 297, trimH: 210, bleedMm: 3 });
    expect(checkedOrientation()).toBe('landscape');
  });
});
