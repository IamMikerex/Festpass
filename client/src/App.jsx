import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { HOME_BY_ROLE, useAuth } from './lib/auth';
import Home from './pages/Home';
import Festivals from './pages/Festivals';
import FestivalDetail from './pages/FestivalDetail';
import { Login, Register } from './pages/Auth';
import Checkout from './pages/Checkout';
import MyTickets from './pages/MyTickets';
import Orders from './pages/Orders';
import Transactions from './pages/Transactions';
import Profile from './pages/Profile';
import VendorHome from './pages/vendor/VendorHome';
import StallMarket from './pages/vendor/StallMarket';
import Applications from './pages/vendor/Applications';
import Scanner from './pages/gate/Scanner';
import Dashboard from './pages/admin/Dashboard';
import ManageFestivals from './pages/admin/ManageFestivals';
import FestivalAdmin from './pages/admin/FestivalAdmin';
import VendorReview from './pages/admin/VendorReview';
import Finance from './pages/admin/Finance';
import Audit from './pages/admin/Audit';
import UsersAdmin from './pages/admin/UsersAdmin';

function RequireRole({ roles, children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />;
  return children;
}

const any = ['ATTENDEE', 'ORGANIZER', 'VENDOR_MANAGER', 'GATE_STAFF', 'AUDITOR'];
const staff = ['ORGANIZER', 'AUDITOR'];

export default function App() {
  const { ready } = useAuth();
  if (!ready) return <Loading label="Loading FestPass…" />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="festivals" element={<Festivals />} />
        <Route path="festivals/:id" element={<FestivalDetail />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />

        <Route path="checkout/:orderId" element={<RequireRole roles={any}><Checkout /></RequireRole>} />
        <Route path="tickets" element={<RequireRole roles={any}><MyTickets /></RequireRole>} />
        <Route path="orders" element={<RequireRole roles={any}><Orders /></RequireRole>} />
        <Route path="transactions" element={<RequireRole roles={any}><Transactions /></RequireRole>} />
        <Route path="profile" element={<RequireRole roles={any}><Profile /></RequireRole>} />

        <Route path="vendor" element={<RequireRole roles={['VENDOR_MANAGER']}><VendorHome /></RequireRole>} />
        <Route path="vendor/stalls" element={<RequireRole roles={['VENDOR_MANAGER']}><StallMarket /></RequireRole>} />
        <Route path="vendor/applications" element={<RequireRole roles={['VENDOR_MANAGER']}><Applications /></RequireRole>} />

        <Route path="gate" element={<RequireRole roles={['GATE_STAFF']}><Scanner /></RequireRole>} />

        <Route path="admin" element={<RequireRole roles={staff}><Dashboard /></RequireRole>} />
        <Route path="admin/festivals" element={<RequireRole roles={staff}><ManageFestivals /></RequireRole>} />
        <Route path="admin/festivals/:id" element={<RequireRole roles={staff}><FestivalAdmin /></RequireRole>} />
        <Route path="admin/vendors" element={<RequireRole roles={staff}><VendorReview /></RequireRole>} />
        <Route path="admin/finance" element={<RequireRole roles={staff}><Finance /></RequireRole>} />
        <Route path="admin/audit" element={<RequireRole roles={staff}><Audit /></RequireRole>} />
        <Route path="admin/users" element={<RequireRole roles={['ORGANIZER']}><UsersAdmin /></RequireRole>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
