# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
## Google OAuth Setup

This project includes Google OAuth authentication for user sign-in.

### 1. Google Cloud Console Setup

1. **Create a Google Cloud Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select an existing one

2. **Enable Google+ API:**
   - Navigate to "APIs & Services" > "Library"
   - Search for "Google+ API" and enable it

3. **Create OAuth 2.0 Credentials:**
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth 2.0 Client IDs"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - For development: `http://localhost:18911/auth/google/callback`
     - For production: `https://your-backend-api-domain/auth/google/callback`
   - Note down your **Client ID** and **Client Secret**

4. **Configure OAuth Consent Screen:**
   - Go to "OAuth consent screen"
   - Choose "External" for testing or "Internal" for workspace
   - Fill in required fields (app name, support email, etc.)
   - Add scopes: `openid`, `email`, `profile`

### 2. Environment Variables Setup

Update your `.env` file with your Google OAuth credentials:

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here
VITE_GOOGLE_CLIENT_SECRET=your_google_client_secret_here
```

**Note:** The backend also needs these credentials in `backend/.env`:

```env
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
GOOGLE_CLIENT_CALLBACK_URL=/auth/google/callback
BACKEND_URL=http://localhost:18911
FRONTEND_URL=http://localhost:18910
```

### 3. How It Works (Backend-Based Flow)

1. **Login Flow:**
   - User clicks "Sign in with Google" button
   - Redirects to Google OAuth with backend as callback URL
   - Google redirects to backend's `/auth/google/callback` endpoint
   - Backend exchanges authorization code for user data
   - Backend upserts user, sets session cookie, and redirects to frontend with user data in URL
   - Frontend processes user data and logs user in

2. **Security Benefits:**
   - OAuth token exchange happens server-side in the Go backend
   - Client secret stays secure in the backend environment
   - No sensitive tokens exposed to the frontend

3. **Development vs Production:**
   - **Frontend:** Runs on `http://localhost:18910` (Vite dev server)
   - **Worker:** Runs on `http://localhost:18912` (Wrangler dev server)
   - **Backend:** Runs on `http://localhost:18911` (Go API)
   - **OAuth Flow:** Frontend → Google OAuth → Backend (port 18911) → Frontend (port 18910)

### 4. Deployment

When deploying:

1. **Update Google OAuth redirect URIs:**
   - Add your production backend URL: `https://your-backend-api-domain/auth/google/callback`

2. **Set production environment variables** on the backend server (via config.ini or env):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CLIENT_CALLBACK_URL`, `BACKEND_URL`, `FRONTEND_URL`

### 5. Usage Examples

```tsx
import { useAuth } from './contexts/AuthContext';
import { GoogleLoginButton } from './components/GoogleLoginButton';
import { ProtectedRoute } from './components/ProtectedRoute';

function MyComponent() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div>
      <GoogleLoginButton />

      <ProtectedRoute fallback={<div>Please sign in</div>}>
        <div>Welcome, {user?.name}!</div>
      </ProtectedRoute>
    </div>
  );
}
```

### 6. Security Notes

⚠️ **Important for Production:**
- The current implementation exchanges OAuth codes server-side in the worker
- Client secrets are stored securely in worker environment variables
- Access tokens are handled server-side for better security
- Use HTTPS in production
- Consider implementing token refresh mechanisms

### 7. Troubleshooting

- **CORS errors:** Verify redirect URIs match exactly in Google Console
- **Token exchange fails:** Check that client secret is correct in wrangler.jsonc
- **Worker not found:** Run `wrangler dev` to start the worker locally
- **User data not persisting:** Check localStorage is enabled in browser
- **Redirect issues:** Ensure worker is running and accessible
