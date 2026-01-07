import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { IntegrationsProvider } from './contexts/IntegrationsContext.tsx'
import { ThemeProvider } from './contexts/ThemeContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <IntegrationsProvider>
          <App />
        </IntegrationsProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
