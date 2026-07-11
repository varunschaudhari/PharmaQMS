import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../features/auth/context/auth-context';
import { AppProviders } from './providers';
import { AppRouter } from './router';

export function App() {
  return (
    <AppProviders>
      <AuthProvider>
        <BrowserRouter>
          <AppRouter />
        </BrowserRouter>
      </AuthProvider>
    </AppProviders>
  );
}
