import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './useEditorStore';
import { EditStatus, TemplateType } from '@storige/types';
import type { EditSession, EditPage } from '@storige/types';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: mockLocalStorage,
});

describe('useEditorStore', () => {
  const createMockSession = (overrides?: Partial<EditSession>): EditSession => ({
    id: 'session-1',
    templateSetId: 'template-set-1',
    orderId: 'order-1',
    userId: 'user-1',
    status: EditStatus.DRAFT,
    pages: [createMockPage({ id: 'page-1' })],
    lockedBy: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const createMockPage = (overrides?: Partial<EditPage>): EditPage => ({
    id: 'page-' + Math.random().toString(36).substr(2, 9),
    templateId: 'template-1',
    templateType: TemplateType.PAGE,
    sortOrder: 0,
    canvasData: { version: '5.3.0', width: 210, height: 297, objects: [] },
    required: false,
    deleteable: true,
    ...overrides,
  });

  beforeEach(() => {
    // Reset store before each test
    useEditorStore.getState().clearSession();
    mockLocalStorage.clear();
  });

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useEditorStore.getState();

      expect(state.sessionId).toBeNull();
      expect(state.session).toBeNull();
      expect(state.pages).toEqual([]);
      expect(state.currentPageIndex).toBe(0);
      expect(state.status).toBe(EditStatus.DRAFT);
      expect(state.isLocked).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('session management', () => {
    it('setSession should update all session-related state', () => {
      const session = createMockSession({
        lockedBy: 'user-2',
        lockedAt: new Date(),
      });

      useEditorStore.getState().setSession(session);
      const state = useEditorStore.getState();

      expect(state.sessionId).toBe('session-1');
      expect(state.session).toBe(session);
      expect(state.templateSetId).toBe('template-set-1');
      expect(state.orderId).toBe('order-1');
      expect(state.userId).toBe('user-1');
      expect(state.pages).toEqual(session.pages);
      expect(state.status).toBe(EditStatus.DRAFT);
      expect(state.isLocked).toBe(true);
      expect(state.lockedBy).toBe('user-2');
    });

    it('clearSession should reset to initial state', () => {
      const session = createMockSession();
      useEditorStore.getState().setSession(session);
      useEditorStore.getState().clearSession();
      const state = useEditorStore.getState();

      expect(state.sessionId).toBeNull();
      expect(state.pages).toEqual([]);
    });
  });

  describe('page navigation', () => {
    it('setCurrentPageIndex should update index within bounds', () => {
      const pages = [createMockPage(), createMockPage(), createMockPage()];
      useEditorStore.getState().setPages(pages);

      useEditorStore.getState().setCurrentPageIndex(2);
      expect(useEditorStore.getState().currentPageIndex).toBe(2);
    });

    it('setCurrentPageIndex should not update if out of bounds', () => {
      const pages = [createMockPage(), createMockPage()];
      useEditorStore.getState().setPages(pages);

      useEditorStore.getState().setCurrentPageIndex(5);
      expect(useEditorStore.getState().currentPageIndex).toBe(0);
    });

    it('goToNextPage should increment index', () => {
      const pages = [createMockPage(), createMockPage(), createMockPage()];
      useEditorStore.getState().setPages(pages);

      useEditorStore.getState().goToNextPage();
      expect(useEditorStore.getState().currentPageIndex).toBe(1);

      useEditorStore.getState().goToNextPage();
      expect(useEditorStore.getState().currentPageIndex).toBe(2);
    });

    it('goToNextPage should not exceed max index', () => {
      const pages = [createMockPage(), createMockPage()];
      useEditorStore.getState().setPages(pages);
      useEditorStore.getState().setCurrentPageIndex(1);

      useEditorStore.getState().goToNextPage();
      expect(useEditorStore.getState().currentPageIndex).toBe(1);
    });

    it('goToPrevPage should decrement index', () => {
      const pages = [createMockPage(), createMockPage(), createMockPage()];
      useEditorStore.getState().setPages(pages);
      useEditorStore.getState().setCurrentPageIndex(2);

      useEditorStore.getState().goToPrevPage();
      expect(useEditorStore.getState().currentPageIndex).toBe(1);
    });

    it('goToPrevPage should not go below 0', () => {
      const pages = [createMockPage(), createMockPage()];
      useEditorStore.getState().setPages(pages);

      useEditorStore.getState().goToPrevPage();
      expect(useEditorStore.getState().currentPageIndex).toBe(0);
    });
  });

  describe('page CRUD', () => {
    it('addPage should add page at end by default', () => {
      const page1 = createMockPage({ id: 'page-1' });
      const page2 = createMockPage({ id: 'page-2' });
      useEditorStore.getState().setPages([page1]);

      useEditorStore.getState().addPage(page2);
      const pages = useEditorStore.getState().pages;

      expect(pages).toHaveLength(2);
      expect(pages[1].id).toBe('page-2');
    });

    it('addPage should add page at specific position', () => {
      const page1 = createMockPage({ id: 'page-1' });
      const page2 = createMockPage({ id: 'page-2' });
      const page3 = createMockPage({ id: 'page-3' });
      useEditorStore.getState().setPages([page1, page3]);

      useEditorStore.getState().addPage(page2, 1);
      const pages = useEditorStore.getState().pages;

      expect(pages).toHaveLength(3);
      expect(pages[1].id).toBe('page-2');
    });

    it('addPage should update sortOrder for all pages', () => {
      const page1 = createMockPage({ id: 'page-1' });
      const page2 = createMockPage({ id: 'page-2' });
      useEditorStore.getState().setPages([page1]);

      useEditorStore.getState().addPage(page2, 0);
      const pages = useEditorStore.getState().pages;

      expect(pages[0].sortOrder).toBe(0);
      expect(pages[1].sortOrder).toBe(1);
    });

    it('updatePage should update page data', () => {
      const page = createMockPage({ id: 'page-1', sortOrder: 5 });
      useEditorStore.getState().setPages([page]);

      useEditorStore.getState().updatePage('page-1', { sortOrder: 10 });

      expect(useEditorStore.getState().pages[0].sortOrder).toBe(10);
    });

    it('updatePageCanvasData should update canvas data', () => {
      const page = createMockPage({ id: 'page-1' });
      useEditorStore.getState().setPages([page]);

      const newCanvasData = { version: '5.3.0', width: 300, height: 400, objects: [] };
      useEditorStore.getState().updatePageCanvasData('page-1', newCanvasData);

      expect(useEditorStore.getState().pages[0].canvasData).toEqual(newCanvasData);
    });

    it('deletePage should remove page and adjust currentPageIndex', () => {
      const pages = [
        createMockPage({ id: 'page-1' }),
        createMockPage({ id: 'page-2' }),
        createMockPage({ id: 'page-3' }),
      ];
      useEditorStore.getState().setPages(pages);
      useEditorStore.getState().setCurrentPageIndex(2);

      useEditorStore.getState().deletePage('page-2');
      const state = useEditorStore.getState();

      expect(state.pages).toHaveLength(2);
      expect(state.currentPageIndex).toBe(1);
    });

    it('deletePage should update sortOrder', () => {
      const pages = [
        createMockPage({ id: 'page-1', sortOrder: 0 }),
        createMockPage({ id: 'page-2', sortOrder: 1 }),
        createMockPage({ id: 'page-3', sortOrder: 2 }),
      ];
      useEditorStore.getState().setPages(pages);

      useEditorStore.getState().deletePage('page-2');
      const updatedPages = useEditorStore.getState().pages;

      expect(updatedPages[0].sortOrder).toBe(0);
      expect(updatedPages[1].sortOrder).toBe(1);
    });

    it('reorderPages should reorder pages by ids', () => {
      const pages = [
        createMockPage({ id: 'page-1' }),
        createMockPage({ id: 'page-2' }),
        createMockPage({ id: 'page-3' }),
      ];
      useEditorStore.getState().setPages(pages);

      useEditorStore.getState().reorderPages(['page-3', 'page-1', 'page-2']);
      const reorderedPages = useEditorStore.getState().pages;

      expect(reorderedPages[0].id).toBe('page-3');
      expect(reorderedPages[1].id).toBe('page-1');
      expect(reorderedPages[2].id).toBe('page-2');
      expect(reorderedPages[0].sortOrder).toBe(0);
      expect(reorderedPages[1].sortOrder).toBe(1);
      expect(reorderedPages[2].sortOrder).toBe(2);
    });
  });

  describe('status management', () => {
    it('setStatus should update status', () => {
      useEditorStore.getState().setStatus(EditStatus.SUBMITTED);

      expect(useEditorStore.getState().status).toBe(EditStatus.SUBMITTED);
    });

    it('setLock should update lock state', () => {
      const lockedAt = new Date();
      useEditorStore.getState().setLock('user-2', lockedAt);
      const state = useEditorStore.getState();

      expect(state.isLocked).toBe(true);
      expect(state.lockedBy).toBe('user-2');
      expect(state.lockedAt).toBe(lockedAt);
    });

    it('setLock with null should unlock', () => {
      useEditorStore.getState().setLock('user-2', new Date());
      useEditorStore.getState().setLock(null, null);
      const state = useEditorStore.getState();

      expect(state.isLocked).toBe(false);
      expect(state.lockedBy).toBeNull();
      expect(state.lockedAt).toBeNull();
    });
  });

  describe('loading/error', () => {
    it('setLoading should update loading state', () => {
      useEditorStore.getState().setLoading(true);

      expect(useEditorStore.getState().isLoading).toBe(true);
    });

    it('setError should update error state', () => {
      useEditorStore.getState().setError('Error message');

      expect(useEditorStore.getState().error).toBe('Error message');
    });
  });

  describe('helper functions', () => {
    it('getCurrentPage should return current page', () => {
      const pages = [
        createMockPage({ id: 'page-1' }),
        createMockPage({ id: 'page-2' }),
      ];
      useEditorStore.getState().setPages(pages);
      useEditorStore.getState().setCurrentPageIndex(1);

      const currentPage = useEditorStore.getState().getCurrentPage();

      expect(currentPage?.id).toBe('page-2');
    });

    it('getCurrentPage should return null for empty pages', () => {
      const currentPage = useEditorStore.getState().getCurrentPage();

      expect(currentPage).toBeNull();
    });

    it('getPageById should return correct page', () => {
      const pages = [
        createMockPage({ id: 'page-1' }),
        createMockPage({ id: 'page-2' }),
      ];
      useEditorStore.getState().setPages(pages);

      const page = useEditorStore.getState().getPageById('page-2');

      expect(page?.id).toBe('page-2');
    });

    it('getPageById should return null for non-existent page', () => {
      const page = useEditorStore.getState().getPageById('non-existent');

      expect(page).toBeNull();
    });

    it('getPagesByType should filter pages by type', () => {
      const pages = [
        createMockPage({ id: 'page-1', templateType: TemplateType.COVER }),
        createMockPage({ id: 'page-2', templateType: TemplateType.PAGE }),
        createMockPage({ id: 'page-3', templateType: TemplateType.PAGE }),
      ];
      useEditorStore.getState().setPages(pages);

      const pageTypePages = useEditorStore.getState().getPagesByType(TemplateType.PAGE);

      expect(pageTypePages).toHaveLength(2);
    });

    it('getPageCount should return correct count', () => {
      const pages = [createMockPage(), createMockPage(), createMockPage()];
      useEditorStore.getState().setPages(pages);

      expect(useEditorStore.getState().getPageCount()).toBe(3);
    });

    it('canDeletePage should return true for deleteable pages', () => {
      const page = createMockPage({
        id: 'page-1',
        deleteable: true,
        required: false,
        templateType: TemplateType.PAGE,
      });
      const page2 = createMockPage({
        id: 'page-2',
        deleteable: true,
        required: false,
        templateType: TemplateType.PAGE,
      });
      useEditorStore.getState().setPages([page, page2]);

      expect(useEditorStore.getState().canDeletePage('page-1')).toBe(true);
    });

    // 펼침면(2-up) 내지: 캔버스 1장 = 물리 2페이지 (2026-08-03)
    // pageCountRange/제본 제약은 물리 페이지 기준이라 캔버스 수를 그대로 비교하면 상·하한이
    // 정확히 절반으로 잘못 걸린다.
    describe('pagesPerCanvas (펼침면 2-up 환산)', () => {
      const mkPages = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          createMockPage({
            id: `p-${i}`,
            deleteable: true,
            required: false,
            templateType: TemplateType.PAGE,
          })
        );

      it('낱장(1)은 종전과 동일하게 캔버스 수로 비교한다', () => {
        useEditorStore.setState({
          pagesPerCanvas: 1,
          canAddPage: true,
          pageCountRange: [2, 4],
          bindingType: null,
        });
        useEditorStore.getState().setPages(mkPages(4));
        // 4장 = 4p = 상한 → 더 못 넣음
        expect(useEditorStore.getState().canAddMorePages()).toBe(false);

        useEditorStore.getState().setPages(mkPages(2));
        // 2장 = 2p = 하한 → 지우면 미만이라 불가
        expect(useEditorStore.getState().canDeletePage('p-0')).toBe(false);
        expect(useEditorStore.getState().canAddMorePages()).toBe(true);
      });

      it('펼침면(2)은 캔버스 수 × 2 로 상·하한을 판정한다', () => {
        useEditorStore.setState({
          pagesPerCanvas: 2,
          canAddPage: true,
          pageCountRange: [4, 8],
          bindingType: null,
        });

        // 2장 = 4p = 하한 → 삭제 불가(지우면 2p), 추가는 가능(6p)
        useEditorStore.getState().setPages(mkPages(2));
        expect(useEditorStore.getState().canDeletePage('p-0')).toBe(false);
        expect(useEditorStore.getState().canAddMorePages()).toBe(true);

        // 4장 = 8p = 상한 → 추가 불가, 삭제는 가능(6p)
        useEditorStore.getState().setPages(mkPages(4));
        expect(useEditorStore.getState().canAddMorePages()).toBe(false);
        expect(useEditorStore.getState().canDeletePage('p-0')).toBe(true);

        // 3장 = 6p → 추가 시 8p 로 상한 딱 맞음 → 허용
        useEditorStore.getState().setPages(mkPages(3));
        expect(useEditorStore.getState().canAddMorePages()).toBe(true);
      });

      it('환산이 없으면 상한이 절반으로 잘못 걸린다 — 회귀 감지용 대조', () => {
        // 같은 4장을 pagesPerCanvas=1 로 보면 4p 라 상한(8p) 여유가 있다고 오판한다.
        useEditorStore.setState({
          pagesPerCanvas: 1,
          canAddPage: true,
          pageCountRange: [4, 8],
          bindingType: null,
        });
        useEditorStore.getState().setPages(mkPages(4));
        expect(useEditorStore.getState().canAddMorePages()).toBe(true); // 오판 재현
      });
    });

    it('canDeletePage should return false for required pages', () => {
      const page = createMockPage({
        id: 'page-1',
        deleteable: true,
        required: true,
      });
      useEditorStore.getState().setPages([page]);

      expect(useEditorStore.getState().canDeletePage('page-1')).toBe(false);
    });

    it('canDeletePage should return false for non-deleteable pages', () => {
      const page = createMockPage({
        id: 'page-1',
        deleteable: false,
        required: false,
      });
      useEditorStore.getState().setPages([page]);

      expect(useEditorStore.getState().canDeletePage('page-1')).toBe(false);
    });

    it('canAddMorePages should return true when under max', () => {
      const page = createMockPage({ templateType: TemplateType.PAGE });
      useEditorStore.getState().setPages([page]);

      expect(useEditorStore.getState().canAddMorePages()).toBe(true);
    });

    it('canAddMorePages should return false when canAddPage is false', () => {
      useEditorStore.setState({ canAddPage: false });

      expect(useEditorStore.getState().canAddMorePages()).toBe(false);
    });
  });
});
