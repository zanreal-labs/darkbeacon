import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { HomePage } from './pages/HomePage';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      // The map canvas (React Flow) loads on demand.
      { path: 'm/:slug', lazy: () => import('./pages/MapPage').then((m) => ({ Component: m.MapPage })) },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
