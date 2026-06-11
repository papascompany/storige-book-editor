import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Typography, Button, Dropdown, Space, Avatar } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  FolderOutlined,
  PictureOutlined,
  CloudServerOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  AppstoreOutlined,
  LinkOutlined,
  EditOutlined,
  FontSizeOutlined,
  BorderOutlined,
  BlockOutlined,
  StarOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../api/auth';
import './MainLayout.css';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

export const MainLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clearAuth } = useAuthStore();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await authApi.logout();
    clearAuth();
    navigate('/login');
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: '프로필',
      onClick: () => navigate('/profile'),
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '로그아웃',
      onClick: handleLogout,
    },
  ];

  const menuItems: MenuProps['items'] = [
    {
      key: '/',
      icon: <DashboardOutlined />,
      label: '대시보드',
      onClick: () => navigate('/'),
    },
    {
      key: '/sites',
      icon: <GlobalOutlined />,
      label: '기본설정',
      onClick: () => navigate('/sites'),
    },
    {
      key: '/templates-group',
      icon: <FileTextOutlined />,
      label: '템플릿',
      children: [
        {
          key: '/categories',
          icon: <FolderOutlined />,
          label: '템플릿분류',
          onClick: () => navigate('/categories'),
        },
        {
          key: '/templates',
          label: '템플릿관리',
          onClick: () => navigate('/templates'),
        },
        {
          key: '/template-sets',
          icon: <AppstoreOutlined />,
          label: '템플릿셋관리',
          onClick: () => navigate('/template-sets'),
        },
        {
          key: '/product-template-sets',
          icon: <LinkOutlined />,
          label: '상품-템플릿 연결',
          onClick: () => navigate('/product-template-sets'),
        },
        {
          key: '/products',
          icon: <AppstoreOutlined />,
          label: '상품관리',
          onClick: () => navigate('/products'),
        },
      ],
    },
    {
      key: '/library',
      icon: <PictureOutlined />,
      label: '라이브러리',
      children: [
        {
          key: '/library/categories',
          icon: <FolderOutlined />,
          label: '카테고리관리',
          onClick: () => navigate('/library/categories'),
        },
        {
          key: '/library/fonts',
          icon: <FontSizeOutlined />,
          label: '폰트',
          onClick: () => navigate('/library/fonts'),
        },
        {
          key: '/library/backgrounds',
          icon: <PictureOutlined />,
          label: '배경',
          onClick: () => navigate('/library/backgrounds'),
        },
        {
          key: '/library/shapes',
          icon: <BorderOutlined />,
          label: '도형',
          onClick: () => navigate('/library/shapes'),
        },
        {
          key: '/library/frames',
          icon: <BlockOutlined />,
          label: '사진틀',
          onClick: () => navigate('/library/frames'),
        },
        {
          key: '/library/cliparts',
          icon: <StarOutlined />,
          label: '클립아트',
          onClick: () => navigate('/library/cliparts'),
        },
      ],
    },
    {
      key: '/edit-management',
      icon: <EditOutlined />,
      label: '편집관리',
      children: [
        {
          key: '/edit-sessions',
          label: '편집데이터관리',
          onClick: () => navigate('/edit-sessions'),
        },
        {
          key: '/reviews',
          label: '편집검토',
          onClick: () => navigate('/reviews'),
        },
        {
          key: '/edit-sessions/deleted',
          label: '삭제 리스트',
          onClick: () => navigate('/edit-sessions/deleted'),
        },
      ],
    },
    {
      key: '/worker',
      icon: <CloudServerOutlined />,
      label: '워커관리',
      children: [
        {
          key: '/worker-jobs',
          label: '작업 목록',
          onClick: () => navigate('/worker-jobs'),
        },
        {
          key: '/worker-test',
          label: '테스트',
          onClick: () => navigate('/worker-test'),
        },
      ],
    },
  ];

  // Get current selected key based on pathname
  const getSelectedKey = () => {
    const { pathname } = location;
    if (pathname.startsWith('/library')) {
      return pathname;
    }
    return pathname;
  };

  // Get open keys based on current pathname
  const getOpenKeys = () => {
    const { pathname } = location;
    const openKeys: string[] = [];

    if (pathname.startsWith('/library')) {
      openKeys.push('/library');
    } else if (pathname.startsWith('/templates') || pathname.startsWith('/template-sets') || pathname.startsWith('/categories') || pathname.startsWith('/product-template-sets') || pathname.startsWith('/products')) {
      openKeys.push('/templates-group');
    } else if (pathname.startsWith('/edit-sessions') || pathname.startsWith('/reviews')) {
      openKeys.push('/edit-management');
    } else if (pathname.startsWith('/worker')) {
      openKeys.push('/worker');
    }

    return openKeys;
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider trigger={null} collapsible collapsed={collapsed} theme="dark">
        <div className="logo">
          <Text strong style={{ color: '#fff', fontSize: collapsed ? 16 : 20 }}>
            {collapsed ? 'S' : 'Storige'}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
        />
      </Sider>

      <Layout>
        <Header className="site-layout-header">
          <Space>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              style={{ fontSize: '16px', width: 64, height: 64 }}
            />
          </Space>

          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Space style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} />
              <Text>{user?.email}</Text>
            </Space>
          </Dropdown>
        </Header>

        <Content className="site-layout-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};
