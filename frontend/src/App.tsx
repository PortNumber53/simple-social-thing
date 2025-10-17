import { useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import cloudflareLogo from './assets/Cloudflare_Logo.svg'
import { GoogleLoginButton } from './components/GoogleLoginButton'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'
import './App.css'

function App() {
  const [count, setCount] = useState(0)
  const [name, setName] = useState('unknown')
  const { isAuthenticated, user } = useAuth()

  return (
    <>
      <div>
        <a href='https://vite.dev' target='_blank'>
          <img src={viteLogo} className='logo' alt='Vite logo' />
        </a>
        <a href='https://react.dev' target='_blank'>
          <img src={reactLogo} className='logo react' alt='React logo' />
        </a>
        <a href='https://workers.cloudflare.com/' target='_blank'>
          <img src={cloudflareLogo} className='logo cloudflare' alt='Cloudflare logo' />
        </a>
      </div>
      <h1>Vite + React + Cloudflare</h1>

      {/* Google OAuth Section */}
      <div className="mb-8 p-4 border rounded-lg">
        <h2 className="text-xl font-semibold mb-4">Authentication</h2>
        <div className="flex justify-center">
          <GoogleLoginButton />
        </div>

        {isAuthenticated && user && (
          <div className="mt-4 p-4 bg-green-50 rounded-lg">
            <div className="flex items-center gap-3">
              <img
                src={user.imageUrl || 'https://via.placeholder.com/150'}
                alt={user.name}
                className="w-8 h-8 rounded-full"
              />
              <p className="text-green-800">
                Welcome back, <strong>{user.name}</strong>! ({user.email})
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Protected Content */}
      <ProtectedRoute
        fallback={
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">
              Please sign in to access the counter and API features.
            </p>
          </div>
        }
      >
        <div className='card'>
          <button
            onClick={() => setCount((count) => count + 1)}
            aria-label='increment'
          >
            count is {count}
          </button>
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR
          </p>
        </div>
        <div className='card'>
          <button
            onClick={() => {
              fetch('/api/')
                .then((res) => res.json() as Promise<{ name: string }>)
                .then((data) => setName(data.name))
            }}
            aria-label='get name'
          >
            Name from API is: {name}
          </button>
          <p>
            Edit <code>worker/index.ts</code> to change the name
          </p>
        </div>
      </ProtectedRoute>

      <p className='read-the-docs'>
        Click on the Vite and React logos to learn more
      </p>
    </>
  )
}

export default App
