import { createBrowserRouter, RouterProvider } from 'react-router';
import { RequireAuth } from './components/RequireAuth';
import { AccountPage } from './pages/AccountPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { AuthGate } from './shell/AuthGate';

// The map canvas (React Flow) and the rarely used pages load on demand.
const router = createBrowserRouter([
  { path: 'login', element: <LoginPage /> },
  {
    element: <AuthGate />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'account', element: <AccountPage /> },
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
        lazy: () => import('./pages/MapPage').then(({ MapPage }) => ({ element: <MapPage /> })),
      },
      {
        path: 'm/:slug/settings',
        lazy: () =>
          import('./pages/MapSettingsPage').then(({ MapSettingsPage }) => ({ element: <MapSettingsPage /> })),
      },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
