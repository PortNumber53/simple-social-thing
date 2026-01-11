import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { Features } from './pages/Features';
import { Contact } from './pages/Contact';
import { Pricing } from './pages/Pricing';
import { Integrations } from './pages/Integrations';
import { ContentMusic } from './pages/ContentMusic';
import { ContentPosts } from './pages/ContentPosts';
import { ContentVideos } from './pages/ContentVideos';
import { ContentVideoEditor } from './pages/ContentVideoEditor';
import { Library } from './pages/Library';
import { ContentPublished } from './pages/ContentPublished';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { UserDataDeletion } from './pages/UserDataDeletion';
import { InstagramHelp } from './pages/InstagramHelp';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { Billing } from './pages/Billing';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route
          path="/integrations"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <Integrations />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/music"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <ContentMusic />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/posts"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <ContentPosts />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/videos"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <ContentVideos />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/video-editor"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <ContentVideoEditor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/content/published"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <ContentPublished />
            </ProtectedRoute>
          }
        />
        <Route
          path="/library"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
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
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/profile"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/settings"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account/billing"
          element={
            <ProtectedRoute fallback={<Navigate to="/login" replace />}>
              <ErrorBoundary>
                <Billing />
              </ErrorBoundary>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<Home />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App
