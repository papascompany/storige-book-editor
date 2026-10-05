import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './useEditorStore';
import { EditStatus, TemplateType, BindingType } from '@storige/types';
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

    // S8 (2026-09-28): 내지 증감 단위(pageStep) — 물리 페이지 수를 step 배수로 유지
    describe('pageStep (내지 증감 단위)', () => {
      // 로더(useEditorContents)가 적재하는 산정 기준 — 완료 가드와 같은 산식
      const COVER_SPREAD = { isSpreadMode: true, regionScope: 'cover' };
      const INNER_SPREAD = { isSpreadMode: true, regionScope: 'inner' };
      const SINGLE = { isSpreadMode: false, regionScope: null };
      const cover = () =>
        createMockPage({
          id: 'cover',
          deleteable: false,
          required: true,
          templateType: TemplateType.SPREAD,
        });
      const mkInner = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          createMockPage({
            id: `p-${i}`,
            deleteable: true,
            required: false,
            templateType: TemplateType.PAGE,
          })
        );

      it('pageStep=null 이면 기존과 동일 — 1장 단위 추가/삭제', () => {
        useEditorStore.setState({
          pagesPerCanvas: 1,
          pageStepBasis: COVER_SPREAD,
          canAddPage: true,
          pageCountRange: [16, 500],
          bindingType: null,
          pageStep: null,
        });
        useEditorStore.getState().setPages([cover(), ...mkInner(17)]);
        const st = useEditorStore.getState();
        expect(st.getPageAddUnit()).toBe(1);
        expect(st.getPageDeleteUnit()).toBe(1);
        expect(st.getDeleteGroup('p-3')).toEqual(['p-3']);
        expect(st.canDeletePage('p-3')).toBe(true); // 17 → 16 ≥ 16
        expect(st.canAddMorePages()).toBe(true);
      });

      it('pageStep=2 (낱장): 짝수 상태에서는 2장씩 추가/삭제, 하한 16 이면 16p 에서 삭제 불가', () => {
        useEditorStore.setState({
          pagesPerCanvas: 1,
          pageStepBasis: COVER_SPREAD,
          canAddPage: true,
          pageCountRange: [16, 500],
          bindingType: null,
          pageStep: 2,
        });
        useEditorStore.getState().setPages([cover(), ...mkInner(18)]);
        let st = useEditorStore.getState();
        expect(st.getPageAddUnit()).toBe(2);
        expect(st.getPageDeleteUnit()).toBe(2);
        // 뒤 인접 페이지와 묶음
        expect(st.getDeleteGroup('p-3')).toEqual(['p-3', 'p-4']);
        // 마지막 페이지는 앞 인접 페이지와 묶음
        expect(st.getDeleteGroup('p-17')).toEqual(['p-17', 'p-16']);
        expect(st.canDeletePage('p-3')).toBe(true); // 18 → 16

        useEditorStore.getState().setPages([cover(), ...mkInner(16)]);
        st = useEditorStore.getState();
        expect(st.canDeletePage('p-3')).toBe(false); // 16 → 14 < 16
        expect(st.canAddMorePages()).toBe(true); // 16 → 18
      });

      it('pageStep=2: 홀수(호스트 시드 17p)면 1장만 추가/삭제해 배수로 복귀', () => {
        useEditorStore.setState({
          pagesPerCanvas: 1,
          pageStepBasis: COVER_SPREAD,
          canAddPage: true,
          pageCountRange: [16, 500],
          bindingType: null,
          pageStep: 2,
        });
        useEditorStore.getState().setPages([cover(), ...mkInner(17)]);
        const st = useEditorStore.getState();
        expect(st.getPageAddUnit()).toBe(1); // 17 → 18
        expect(st.getPageDeleteUnit()).toBe(1); // 17 → 16
        expect(st.getDeleteGroup('p-0')).toEqual(['p-0']);
        expect(st.canDeletePage('p-0')).toBe(true);
      });

      it('pageStep=2: 상한 직전(499p)은 1장 추가로 500 허용, 500p 는 추가 불가', () => {
        useEditorStore.setState({
          pagesPerCanvas: 1,
          pageStepBasis: COVER_SPREAD,
          canAddPage: true,
          pageCountRange: [16, 500],
          bindingType: null,
          pageStep: 2,
        });
        useEditorStore.getState().setPages([cover(), ...mkInner(499)]);
        expect(useEditorStore.getState().canAddMorePages()).toBe(true);
        useEditorStore.getState().setPages([cover(), ...mkInner(498)]);
        expect(useEditorStore.getState().canAddMorePages()).toBe(true); // 498 → 500
        useEditorStore.getState().setPages([cover(), ...mkInner(500)]);
        expect(useEditorStore.getState().canAddMorePages()).toBe(false);
      });

      it('pageStep=2: 함께 지울 인접 삭제 가능 페이지가 없으면 삭제 불가', () => {
        useEditorStore.setState({
          pagesPerCanvas: 1,
          pageStepBasis: COVER_SPREAD,
          canAddPage: true,
          pageCountRange: [1, 500],
          bindingType: null,
          pageStep: 2,
        });
        const inner = mkInner(4);
        // p-1 양옆이 필수 페이지 → 단독 삭제는 배수를 깨므로 불가
        inner[0] = { ...inner[0], required: true, deleteable: false };
        inner[2] = { ...inner[2], required: true, deleteable: false };
        useEditorStore.getState().setPages([cover(), ...inner]);
        const st = useEditorStore.getState();
        expect(st.getDeleteGroup('p-1')).toEqual([]);
        expect(st.canDeletePage('p-1')).toBe(false);
        // p-3 도 앞(p-2)이 필수라 짝이 없음
        expect(st.canDeletePage('p-3')).toBe(false);
      });

      it('pageStep=2 + 펼침면(pagesPerCanvas=2): 캔버스 1장 = 2p 라 1장 단위 그대로', () => {
        useEditorStore.setState({
          pagesPerCanvas: 2,
          pageStepBasis: INNER_SPREAD,
          canAddPage: true,
          pageCountRange: [4, 8],
          bindingType: null,
          pageStep: 2,
        });
        useEditorStore.getState().setPages(mkInner(3));
        const st = useEditorStore.getState();
        expect(st.getPageAddUnit()).toBe(1);
        expect(st.getPageDeleteUnit()).toBe(1);
        expect(st.canAddMorePages()).toBe(true); // 6 → 8
      });

      it('pageStep=4 + 펼침면(pagesPerCanvas=2): 2장(4p) 단위', () => {
        useEditorStore.setState({
          pagesPerCanvas: 2,
          pageStepBasis: INNER_SPREAD,
          canAddPage: true,
          pageCountRange: [4, 12],
          bindingType: null,
          pageStep: 4,
        });
        useEditorStore.getState().setPages(mkInner(4)); // 8p
        let st = useEditorStore.getState();
        expect(st.getPageAddUnit()).toBe(2); // 8 → 12
        expect(st.canAddMorePages()).toBe(true);
        expect(st.getPageDeleteUnit()).toBe(2); // 8 → 4
        expect(st.canDeletePage('p-0')).toBe(true);

        useEditorStore.getState().setPages(mkInner(5)); // 10p (정렬 깨짐)
        st = useEditorStore.getState();
        expect(st.getPageAddUnit()).toBe(1); // 10 → 12
        expect(st.getPageDeleteUnit()).toBe(1); // 10 → 8
      });

            // S8 리뷰 회귀: 실제 로더는 펼침면 내지를 TemplateType.SPREAD 로 만든다(PAGE 아님).
      // 종전 산식은 PAGE 만 세어 물리 0p 로 보고 항상 2장씩 움직여, 홀수 시드면 배수에 영영 도달 못 했다.
      const mkSpreadInner = (n: number, anchorRequired = true) =>
        Array.from({ length: n }, (_, i) =>
          createMockPage({
            id: `s-${i}`,
            // 내지 전용 펼침면: index 0 = 첫 펼침면(앵커, 삭제 불가), 나머지 삭제 가능
            deleteable: !(anchorRequired && i === 0),
            required: anchorRequired && i === 0,
            templateType: TemplateType.SPREAD,
          })
        );

      it('pageStep=4 + 내지 전용 펼침면(SPREAD 내지, 홀수 시드 3장=6p): 1장 추가로 8p, 1장 삭제로 4p', () => {
        useEditorStore.setState({
          pagesPerCanvas: 2,
          pageStepBasis: INNER_SPREAD,
          canAddPage: true,
          pageCountRange: [2, 40],
          bindingType: null,
          pageStep: 4,
        });
        useEditorStore.getState().setPages(mkSpreadInner(3));
        const st = useEditorStore.getState();
        expect(st.getPageStepPerCanvas()).toBe(2);
        expect(st.getPageAddUnit()).toBe(1); // 6 → 8
        expect(st.getPageDeleteUnit()).toBe(1); // 6 → 4
        expect(st.getDeleteGroup('s-2')).toEqual(['s-2']);
        expect(st.canDeletePage('s-2')).toBe(true);

        // 1장 추가 후(4장=8p) 다시 정렬 상태 → 2장(4p) 단위
        useEditorStore.getState().setPages(mkSpreadInner(4));
        const st2 = useEditorStore.getState();
        expect(st2.getPageAddUnit()).toBe(2);
        expect(st2.getPageDeleteUnit()).toBe(2);
        expect(st2.getDeleteGroup('s-2')).toEqual(['s-2', 's-3']);
      });

      it('pageStep=4 + 표지+펼침면 내지(SPREAD): 내지 캔버스 1장 = 2쪽(2026-09-28 오너 결정)', () => {
        useEditorStore.setState({
          pagesPerCanvas: 2,
          pageStepBasis: COVER_SPREAD,
          canAddPage: true,
          pageCountRange: [1, 100],
          bindingType: null,
          pageStep: 4,
        });
        // 표지 + 펼침면 내지 3장 → (4−1)×2 = 6p
        useEditorStore.getState().setPages([cover(), ...mkSpreadInner(3, false)]);
        const st = useEditorStore.getState();
        expect(st.getPageStepPerCanvas()).toBe(2);
        expect(st.getPageAddUnit()).toBe(1); // 6 → 8
        expect(st.getPageDeleteUnit()).toBe(1); // 6 → 4
      });

      // 2026-09-28: 펼침면 내지는 TemplateType.SPREAD — 유형으로 세면 0p 가 되어 최소/최대가 무력화됐다.
      describe('펼침면 내지 최소/최대 쪽수 (SPREAD 유형 실경로)', () => {
        const setup = (basis: typeof COVER_SPREAD | typeof INNER_SPREAD, range: number[]) =>
          useEditorStore.setState({
            pagesPerCanvas: 2,
            pageStepBasis: basis,
            canAddPage: true,
            pageCountRange: range,
            bindingType: null,
            pageStep: null,
          });

        it('표지+펼침면: 최대 16p(표지+8장)에서 더 추가 불가, 7장이면 추가 가능', () => {
          setup(COVER_SPREAD, [16, 48]);
          useEditorStore.getState().setPages([cover(), ...mkSpreadInner(8, false)]);
          useEditorStore.setState({ pageCountRange: [4, 16] });
          expect(useEditorStore.getState().canAddMorePages()).toBe(false);
          useEditorStore.getState().setPages([cover(), ...mkSpreadInner(7, false)]);
          expect(useEditorStore.getState().canAddMorePages()).toBe(true);
        });

        it('표지+펼침면: 최소 16p(8장)면 추가분이라도 삭제 불가, 9장이면 삭제 가능', () => {
          setup(COVER_SPREAD, [16, 48]);
          useEditorStore.getState().setPages([cover(), ...mkSpreadInner(8, false)]);
          expect(useEditorStore.getState().canDeletePage('s-7')).toBe(false);
          useEditorStore.getState().setPages([cover(), ...mkSpreadInner(9, false)]);
          expect(useEditorStore.getState().canDeletePage('s-8')).toBe(true);
        });

        it('표지 캔버스는 내지 수·삭제 대상에서 빠진다', () => {
          setup(COVER_SPREAD, [2, 48]);
          useEditorStore.getState().setPages([cover(), ...mkSpreadInner(2, false)]);
          expect(useEditorStore.getState().canDeletePage('cover')).toBe(false);
        });

        it('내지 전용 펼침면: 전 캔버스가 내지 — 최대 8p(4장)에서 추가 불가', () => {
          setup(INNER_SPREAD, [4, 8]);
          useEditorStore.getState().setPages(mkSpreadInner(4, false));
          expect(useEditorStore.getState().canAddMorePages()).toBe(false);
          useEditorStore.getState().setPages(mkSpreadInner(2, false));
          expect(useEditorStore.getState().canDeletePage('s-0')).toBe(false);
          useEditorStore.getState().setPages(mkSpreadInner(3, false));
          expect(useEditorStore.getState().canDeletePage('s-0')).toBe(true);
        });
      });

      // R-196 host page limits (2026-09-29): 로더가 호스트 병합 범위(예: [16,300])를 pageCountRange 에
      // 넣었을 때 스토어 게이트가 그대로 따르는지 고정한다. 호스트 범위 표시(hostPageLimitSides)가 없으면
      // 제본 min/max·pageStep 이 계속 위에 얹히고, 표시된 쪽은 제본 값 대신 범위만 적용된다(W5 키별 대체).
      describe('호스트 쪽수 한도 병합 범위 (R-196 회귀 가드)', () => {
        const setupHost = (overrides: Record<string, unknown> = {}) =>
          useEditorStore.setState({
            pagesPerCanvas: 2,
            pageStepBasis: INNER_SPREAD,
            canAddPage: true,
            pageCountRange: [16, 300],
            bindingType: null,
            pageStep: null,
            ...overrides,
          });

        it('[16,300] + 펼침면(2): 100p 를 넘어 추가 가능, 300p 에서 차단', () => {
          setupHost();
          useEditorStore.getState().setPages(mkSpreadInner(51, false)); // 102p
          expect(useEditorStore.getState().canAddMorePages()).toBe(true); // → 104p
          useEditorStore.getState().setPages(mkSpreadInner(149, false)); // 298p
          expect(useEditorStore.getState().canAddMorePages()).toBe(true); // → 300p
          useEditorStore.getState().setPages(mkSpreadInner(150, false)); // 300p
          expect(useEditorStore.getState().canAddMorePages()).toBe(false);
        });

        it('SADDLE + 호스트 범위 표시 없음: [16,300] 이어도 제본 최대 64p 에서 추가 차단', () => {
          setupHost({ bindingType: BindingType.SADDLE });
          useEditorStore.getState().setPages(mkSpreadInner(31, false)); // 62p
          expect(useEditorStore.getState().canAddMorePages()).toBe(true);
          useEditorStore.getState().setPages(mkSpreadInner(32, false)); // 64p
          expect(useEditorStore.getState().canAddMorePages()).toBe(false);
        });

        it('PERFECT + 호스트 범위 표시 없음: [16,300] 이어도 제본 최소 32p 미만으로 삭제 차단', () => {
          setupHost({ bindingType: BindingType.PERFECT });
          useEditorStore.getState().setPages(mkSpreadInner(16, false)); // 32p
          expect(useEditorStore.getState().canDeletePage('s-5')).toBe(false); // → 30p
          useEditorStore.getState().setPages(mkSpreadInner(17, false)); // 34p
          expect(useEditorStore.getState().canDeletePage('s-5')).toBe(true); // → 32p
        });

        it('SADDLE + 호스트 max 표시: 제본 최대 64p 대신 범위 최대 300p 적용', () => {
          setupHost({ bindingType: BindingType.SADDLE, hostPageLimitSides: { min: false, max: true } });
          useEditorStore.getState().setPages(mkSpreadInner(32, false)); // 64p
          expect(useEditorStore.getState().canAddMorePages()).toBe(true); // → 66p
          useEditorStore.getState().setPages(mkSpreadInner(150, false)); // 300p
          expect(useEditorStore.getState().canAddMorePages()).toBe(false);
        });

        it('PERFECT + 호스트 min 표시: 제본 최소 32p 대신 범위 최소 16p 적용', () => {
          setupHost({ bindingType: BindingType.PERFECT, hostPageLimitSides: { min: true, max: false } });
          useEditorStore.getState().setPages(mkSpreadInner(9, false)); // 18p
          expect(useEditorStore.getState().canDeletePage('s-5')).toBe(true); // → 16p
          useEditorStore.getState().setPages(mkSpreadInner(8, false)); // 16p
          expect(useEditorStore.getState().canDeletePage('s-5')).toBe(false); // → 14p
        });

        it('PERFECT + 호스트 max 만 표시: 제본 최소 32p 유지', () => {
          setupHost({ bindingType: BindingType.PERFECT, hostPageLimitSides: { min: false, max: true } });
          useEditorStore.getState().setPages(mkSpreadInner(17, false)); // 34p
          expect(useEditorStore.getState().canDeletePage('s-5')).toBe(true); // → 32p
          useEditorStore.getState().setPages(mkSpreadInner(16, false)); // 32p
          expect(useEditorStore.getState().canDeletePage('s-5')).toBe(false); // → 30p
        });

        it('SADDLE + 호스트 min 만 표시: 제본 최대 64p 유지', () => {
          setupHost({ bindingType: BindingType.SADDLE, hostPageLimitSides: { min: true, max: false } });
          useEditorStore.getState().setPages(mkSpreadInner(32, false)); // 64p
          expect(useEditorStore.getState().canAddMorePages()).toBe(false);
        });

        it('pageStep=4: 단위 추가가 최대 경계를 넘으면 차단', () => {
          setupHost({ pageCountRange: [16, 298], pageStep: 4 });
          useEditorStore.getState().setPages(mkSpreadInner(148, false)); // 296p, 단위 2장(4p) → 300p
          expect(useEditorStore.getState().getPageAddUnit()).toBe(2);
          expect(useEditorStore.getState().canAddMorePages()).toBe(false);
          // 같은 상태에서 단위가 없으면 1장(2p) 추가로 298p — 허용(단위가 차단의 원인임을 대조)
          useEditorStore.setState({ pageStep: null });
          expect(useEditorStore.getState().canAddMorePages()).toBe(true);
        });
      });

      it('pageStep=2 + 단일 모드: 캔버스 수 기준(홀수 17 → 1장, 짝수 18 → 2장)', () => {
        useEditorStore.setState({
          pagesPerCanvas: 1,
          pageStepBasis: SINGLE,
          canAddPage: true,
          pageCountRange: [1, 500],
          bindingType: null,
          pageStep: 2,
        });
        useEditorStore.getState().setPages(mkInner(17));
        expect(useEditorStore.getState().getPageAddUnit()).toBe(1);
        expect(useEditorStore.getState().getPageDeleteUnit()).toBe(1);
        useEditorStore.getState().setPages(mkInner(18));
        expect(useEditorStore.getState().getPageAddUnit()).toBe(2);
        expect(useEditorStore.getState().getPageDeleteUnit()).toBe(2);
      });

it('clearSession 은 pageStep 을 null 로 리셋한다', () => {
        useEditorStore.setState({ pageStep: 2, pageStepBasis: { isSpreadMode: true, regionScope: 'inner' } });
        useEditorStore.getState().clearSession();
        expect(useEditorStore.getState().pageStep).toBeNull();
        expect(useEditorStore.getState().pageStepBasis).toEqual({ isSpreadMode: false, regionScope: null });
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
