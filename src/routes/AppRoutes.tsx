import { Routes, Route, Navigate } from 'react-router-dom'
import Home from '../pages/Home/Home'
import Archivo from '../pages/Archivo/Archivo'
import Placeholder from '../pages/Archivo/Placeholder'
import AdminLayout from '../pages/Archivo/AdminLayout'
import PermisosPage from '../pages/Archivo/PermisosPage'
import InvitacionesPage from '../pages/Archivo/InvitacionesPage'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/archivo" element={<Archivo />} />
      <Route path="/archivo/cantina" element={<Placeholder title="La Cantina" need="cantina" />} />
      <Route path="/archivo/aportaciones" element={<Placeholder title="Aportaciones" need="aportaciones" />} />
      <Route path="/archivo/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="permisos" replace />} />
        <Route path="permisos" element={<PermisosPage />} />
        <Route path="invitaciones" element={<InvitacionesPage />} />
      </Route>
    </Routes>
  )
}

export default AppRoutes
