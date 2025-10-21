import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/account/profile" 
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <Profile />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/account/settings" 
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <Settings />
            </ProtectedRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App
