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
## Xata Database Setup

This project uses Xata as the database service. To set up Xata:

1. **Create a Xata account and database:**
   - Go to [xata.io](https://xata.io) and create an account
   - Create a new database and note down your database URL

2. **Set up environment variables:**
   - Copy `.env.example` to `.env` (if not already done)
   - Replace `your_xata_api_key_here` with your actual Xata API key
   - Replace `your_xata_database_url_here` with your actual database URL

3. **Using Xata in your code:**
   ```typescript
   import { xata } from './lib/xata';

   // Example usage
   const users = await xata.db.users.getAll();
   ```

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
     - For development: `http://localhost:8788/api/auth/google/callback`
     - For production: `https://your-worker.your-subdomain.workers.dev/api/auth/google/callback`
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

**Note:** The worker also needs these credentials. Update `wrangler.jsonc`:

```jsonc
"vars": {
  "GOOGLE_CLIENT_ID": "your_google_client_id_here",
  "GOOGLE_CLIENT_SECRET": "your_google_client_secret_here"
}
```

### 3. How It Works (Worker-Based Flow)

1. **Login Flow:**
   - User clicks "Sign in with Google" button
   - Redirects to Google OAuth with worker as callback URL
   - Google redirects to your worker's `/oauth/callback` endpoint
   - Worker exchanges authorization code for user data
   - Worker redirects back to frontend with user data in URL
   - Frontend processes user data and logs user in

2. **Security Benefits:**
   - OAuth token exchange happens server-side in the worker
   - Client secret stays secure in the worker environment
   - No sensitive tokens exposed to the frontend
   - Production-ready for Cloudflare deployment

3. **Development vs Production:**
   - **Frontend:** Runs on `http://localhost:5173` (Vite dev server)
   - **Worker:** Runs on `http://localhost:8788` (Wrangler dev server)
   - **OAuth Flow:** Frontend → Google OAuth → Worker (port 8788) → Frontend (port 5173)

### 4. Deployment

When deploying to Cloudflare:

1. **Deploy the worker:**
   ```bash
   wrangler deploy
   ```

2. **Update Google OAuth redirect URIs:**
   - Add your production worker URL: `https://your-worker.your-subdomain.workers.dev/api/auth/google/callback`

3. **Set production environment variables:**
   ```bash
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```

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
