import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/AccountPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';

// The map canvas (React Flow) and the rarely used pages load on demand.
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: 'login', element: <LoginPage /> },
      {
        index: true,
        element: (
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        ),
      },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      {
        path: 'admin',
        lazy: () =>
          import('./pages/AdminPage').then(({ AdminPage }) => ({
            element: (
              <RequireAuth admin>
                <AdminPage />
              </RequireAuth>
            ),
          })),
      },
      {
        path: 'm/:slug',
        lazy: () =>
          import('./pages/MapPage').then(({ MapPage }) => ({
            element: (
              <RequireAuth>
                <MapPage />
              </RequireAuth>
            ),
          })),
      },
      {
        path: 'm/:slug/settings',
        lazy: () =>
          import('./pages/MapSettingsPage').then(({ MapSettingsPage }) => ({
            element: (
              <RequireAuth>
                <MapSettingsPage />
              </RequireAuth>
            ),
          })),
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
