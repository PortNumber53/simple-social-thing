import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { Features } from './pages/Features';
import { Contact } from './pages/Contact';
import { Pricing } from './pages/Pricing';
import { Integrations } from './pages/Integrations';
import { ContentMusic } from './pages/ContentMusic';
import { ContentPosts } from './pages/ContentPosts';
import { ContentVideos } from './pages/ContentVideos';
import { Library } from './pages/Library';
import { ContentPublished } from './pages/ContentPublished';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { UserDataDeletion } from './pages/UserDataDeletion';
import { InstagramHelp } from './pages/InstagramHelp';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/integrations" element={<Integrations />} />
        <Route
          path="/content/music"
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <ContentMusic />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/posts"
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <ContentPosts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/videos"
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <ContentVideos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/published"
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <ContentPublished />
            </ProtectedRoute>
          }
        />
        <Route
          path="/library"
          element={
            <ProtectedRoute fallback={<Navigate to="/" replace />}>
              <Library />
            </ProtectedRoute>
          }
        />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/terms-of-service" element={<TermsOfService />} />
        <Route path="/user-data-deletion" element={<UserDataDeletion />} />
        <Route path="/help/instagram" element={<InstagramHelp />} />
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
