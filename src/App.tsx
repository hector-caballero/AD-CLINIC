import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { AuthProvider } from './features/auth/AuthProvider'
import { RequireAdmin } from './features/auth/RequireAdmin'
import { RequireAuth } from './features/auth/RequireAuth'
import AppointmentsPage from './pages/AppointmentsPage'
import CashPage from './pages/CashPage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import OdontogramPage from './pages/OdontogramPage'
import PatientsPage from './pages/PatientsPage'
import TeamPage from './pages/TeamPage'
import TreatmentsPage from './pages/TreatmentsPage'

/**
 * Rutas de la aplicación.
 *
 * `/login` es pública; el resto vive dentro de `<RequireAuth>` + `<AppLayout>`,
 * así que quien llegue sin sesión vuelve al login recordando la ruta de origen
 * (el guard la pasa en `state.from`).
 */
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="pacientes" element={<PatientsPage />} />
              <Route path="citas" element={<AppointmentsPage />} />
              <Route path="tratamientos" element={<TreatmentsPage />} />
              <Route path="odontograma" element={<OdontogramPage />} />
              <Route path="caja" element={<CashPage />} />
              <Route
                path="equipo"
                element={
                  <RequireAdmin>
                    <TeamPage />
                  </RequireAdmin>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
