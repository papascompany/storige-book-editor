import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SaveStatus, SaveButton } from './SaveStatus';
import { useSaveStore } from '@/stores/useSaveStore';

describe('SaveStatus', () => {
  beforeEach(() => {
    useSaveStore.getState().reset();
  });

  it('renders saved status correctly', () => {
    useSaveStore.getState().setSaved();

    render(<SaveStatus />);

    expect(screen.getByText('저장됨')).toBeInTheDocument();
  });

  it('renders saving status correctly', () => {
    useSaveStore.getState().setSaving();

    render(<SaveStatus />);

    expect(screen.getByText('저장 중...')).toBeInTheDocument();
  });

  it('renders failed status correctly', () => {
    useSaveStore.getState().setFailed('Error message');

    render(<SaveStatus />);

    expect(screen.getByText('저장 실패')).toBeInTheDocument();
  });

  it('renders unsaved status correctly', () => {
    useSaveStore.getState().setUnsaved();

    render(<SaveStatus />);

    expect(screen.getByText('저장되지 않음')).toBeInTheDocument();
  });

  it('renders offline status correctly', () => {
    useSaveStore.getState().setOnline(false);

    render(<SaveStatus />);

    expect(screen.getByText('오프라인')).toBeInTheDocument();
  });

  it('hides text when showText is false', () => {
    useSaveStore.getState().setSaved();

    render(<SaveStatus showText={false} />);

    expect(screen.queryByText('저장됨')).not.toBeInTheDocument();
  });

  it('shows last saved time when showLastSaved is true and status is saved', () => {
    // Set saved with lastSavedAt
    useSaveStore.getState().setSaved();

    render(<SaveStatus showLastSaved={true} />);

    // Should show relative time like "방금 전"
    expect(screen.getByText(/방금 전/)).toBeInTheDocument();
  });

  it('hides last saved time when showLastSaved is false', () => {
    useSaveStore.getState().setSaved();

    render(<SaveStatus showLastSaved={false} />);

    expect(screen.queryByText(/방금 전/)).not.toBeInTheDocument();
  });

  describe('재진입 시드(seedLastSavedAt) 표시', () => {
    it('시드된 시각을 저장 시각으로 표시한다', () => {
      // 재진입 직후: 이번 세션 자동저장은 아직 없고, 서버 세션 updatedAt 만 시드된 상태
      useSaveStore.getState().seedLastSavedAt(new Date());

      render(<SaveStatus showLastSaved={true} />);

      expect(screen.getByText('저장됨')).toBeInTheDocument();
      expect(screen.getByText(/방금 전/)).toBeInTheDocument();
    });

    it('시드 후 편집이 발생하면 시각을 감춘다 (저장됨 오도 방지)', () => {
      useSaveStore.getState().seedLastSavedAt(new Date());
      useSaveStore.getState().markDirty();

      render(<SaveStatus showLastSaved={true} />);

      expect(screen.getByText('저장되지 않음')).toBeInTheDocument();
      expect(screen.queryByText(/방금 전/)).not.toBeInTheDocument();
    });
  });

  it('applies custom className', () => {
    render(<SaveStatus className="custom-class" />);

    const container = screen.getByText('저장됨').closest('div');
    expect(container).toHaveClass('custom-class');
  });

  describe('sizes', () => {
    it('applies small size classes', () => {
      render(<SaveStatus size="sm" />);

      const text = screen.getByText('저장됨');
      expect(text).toHaveClass('text-xs');
    });

    it('applies medium size classes', () => {
      render(<SaveStatus size="md" />);

      const text = screen.getByText('저장됨');
      expect(text).toHaveClass('text-sm');
    });

    it('applies large size classes', () => {
      render(<SaveStatus size="lg" />);

      const text = screen.getByText('저장됨');
      expect(text).toHaveClass('text-base');
    });
  });

  describe('error indicator', () => {
    it('shows error indicator when status is failed', () => {
      useSaveStore.getState().setFailed('Network error');

      render(<SaveStatus />);

      expect(screen.getByText('!')).toBeInTheDocument();
    });

    it('does not show error indicator for other statuses', () => {
      useSaveStore.getState().setSaved();

      render(<SaveStatus />);

      expect(screen.queryByText('!')).not.toBeInTheDocument();
    });
  });
});

describe('SaveButton', () => {
  beforeEach(() => {
    useSaveStore.getState().reset();
  });

  it('renders save button', () => {
    render(<SaveButton />);

    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByText('저장')).toBeInTheDocument();
  });

  it('is disabled when status is saving', () => {
    useSaveStore.getState().setSaving();

    render(<SaveButton />);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is disabled when not dirty and status is saved', () => {
    useSaveStore.getState().setSaved();

    render(<SaveButton />);

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is enabled when dirty', async () => {
    useSaveStore.getState().markDirty();

    render(<SaveButton />);

    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('shows saving text when status is saving', () => {
    useSaveStore.getState().setSaving();

    render(<SaveButton />);

    expect(screen.getByText('저장 중...')).toBeInTheDocument();
  });

  it('calls onSave when clicked and enabled', async () => {
    let saveCalled = false;
    const onSave = async () => {
      saveCalled = true;
    };

    useSaveStore.getState().markDirty();

    render(<SaveButton onSave={onSave} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(saveCalled).toBe(true);
  });

  it('does not call onSave when clicked and disabled', async () => {
    let saveCalled = false;
    const onSave = async () => {
      saveCalled = true;
    };

    useSaveStore.getState().setSaved();

    render(<SaveButton onSave={onSave} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(saveCalled).toBe(false);
  });

  it('applies custom className', () => {
    render(<SaveButton className="custom-class" />);

    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });
});
