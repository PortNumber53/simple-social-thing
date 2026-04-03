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
import { AdminBilling } from './pages/AdminBilling';
import { AdminCustomPlanRequests } from './pages/AdminCustomPlanRequests';
import { AdminUsers } from './pages/AdminUsers';
import { AdminAnalytics } from './pages/AdminAnalytics';
import { AdminSettings } from './pages/AdminSettings';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './components/AppShell';
import { PublicLayout } from './components/PublicLayout';

function App() {
  return (
    <Router>
      <Routes>
        {/* Public routes — marketing layout with top nav + footer */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Home />} />
          <Route path="/features" element={<Features />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/terms-of-service" element={<TermsOfService />} />
          <Route path="/user-data-deletion" element={<UserDataDeletion />} />
          <Route path="/help/instagram" element={<InstagramHelp />} />
        </Route>

        {/* Authenticated routes — sidebar + top bar shell */}
        <Route element={<ProtectedRoute fallback={<Navigate to="/login" replace />}><AppShell /></ProtectedRoute>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/content/posts" element={<ContentPosts />} />
          <Route path="/content/videos" element={<ContentVideos />} />
          <Route path="/content/video-editor" element={<ContentVideoEditor />} />
          <Route path="/content/published" element={<ContentPublished />} />
          <Route path="/content/music" element={<ContentMusic />} />
          <Route path="/library" element={<Library />} />
          <Route path="/account/profile" element={<Profile />} />
          <Route path="/account/settings" element={<Settings />} />
          <Route path="/account/billing" element={<ErrorBoundary><Billing /></ErrorBoundary>} />
          <Route path="/admin/billing" element={<ErrorBoundary><AdminBilling /></ErrorBoundary>} />
          <Route path="/admin/custom-plan-requests" element={<ErrorBoundary><AdminCustomPlanRequests /></ErrorBoundary>} />
          <Route path="/admin/users" element={<ErrorBoundary><AdminUsers /></ErrorBoundary>} />
          <Route path="/admin/analytics" element={<ErrorBoundary><AdminAnalytics /></ErrorBoundary>} />
          <Route path="/admin/settings" element={<ErrorBoundary><AdminSettings /></ErrorBoundary>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App
