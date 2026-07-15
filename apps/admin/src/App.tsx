import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthBootstrap } from './components/AuthBootstrap';
import { MainLayout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { TemplateList, TemplateEditor, TemplateImport } from './pages/Templates';
import { TemplateSetList, TemplateSetForm } from './pages/TemplateSets';
import { FormatPresetList } from './pages/FormatPresets';
import { ProductTemplateSetList } from './pages/ProductTemplateSets';
import { CategoryManagement } from './pages/Categories';
import { ProductList } from './pages/Products';
import { ReviewList, ReviewDetail } from './pages/Reviews';
import {
  FontList,
  BackgroundList,
  ClipartList,
  ShapeList,
  FrameList,
  CategoryManagement as LibraryCategoryManagement,
} from './pages/Library';
import { EditSessionList, DeletedSessionList } from './pages/EditSessions';
import { WorkerJobList } from './pages/WorkerJobs';
import { WorkerTestPage } from './pages/WorkerTest';
import { SiteList } from './pages/Sites';
import { OperatorList } from './pages/Operators';
import { MySitePage } from './pages/MySite';
import { StorageSettings } from './pages/StorageSettings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={koKR}>
        <BrowserRouter basename={import.meta.env.VITE_ROUTER_BASE || '/'}>
          <AuthBootstrap />
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* 템플릿 에디터 - 전체화면, MainLayout 외부 */}
            <Route
              path="/templates/editor"
              element={
                <ProtectedRoute>
                  <TemplateEditor />
                </ProtectedRoute>
              }
            />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              <Route path="profile" element={<Profile />} />
              {/* 기본설정 (Phase A) */}
              <Route path="sites" element={<SiteList />} />
              {/* 운영자 관리 (P3a 멀티테넌시) */}
              <Route path="operators" element={<OperatorList />} />
              {/* 내 사이트 — 파트너 포털 v0 (S2-4, SITE_ADMIN 셀프 뷰) */}
              <Route path="my-site" element={<MySitePage />} />
              <Route path="storage-settings" element={<StorageSettings />} />
              {/* 템플릿 그룹 */}
              <Route path="templates" element={<TemplateList />} />
              <Route path="templates/import" element={<TemplateImport />} />
              <Route path="template-sets" element={<TemplateSetList />} />
              <Route path="template-sets/new" element={<TemplateSetForm />} />
              <Route path="template-sets/:id" element={<TemplateSetForm />} />
              <Route path="product-template-sets" element={<ProductTemplateSetList />} />
              <Route path="categories" element={<CategoryManagement />} />
              {/* 판형 프리셋 관리 (format_presets — 저작측 정본) */}
              <Route path="format-presets" element={<FormatPresetList />} />
              {/* 라이브러리 그룹 */}
              <Route path="library/categories" element={<LibraryCategoryManagement />} />
              <Route path="library/fonts" element={<FontList />} />
              <Route path="library/backgrounds" element={<BackgroundList />} />
              <Route path="library/shapes" element={<ShapeList />} />
              <Route path="library/frames" element={<FrameList />} />
              <Route path="library/cliparts" element={<ClipartList />} />
              {/* 편집관리 그룹 */}
              <Route path="edit-sessions" element={<EditSessionList />} />
              <Route path="edit-sessions/deleted" element={<DeletedSessionList />} />
              <Route path="reviews" element={<ReviewList />} />
              <Route path="reviews/:id" element={<ReviewDetail />} />
              {/* 기타 */}
              <Route path="worker-jobs" element={<WorkerJobList />} />
              <Route path="worker-test" element={<WorkerTestPage />} />
              <Route path="products" element={<ProductList />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
