import { Routes, Route } from 'react-router-dom'
import Home from '../pages/Home/Home'
import Archivo from '../pages/Archivo/Archivo'
import Placeholder from '../pages/Archivo/Placeholder'
import AdminPanel from '../pages/Archivo/AdminPanel'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/archivo" element={<Archivo />} />
      <Route path="/archivo/cantina" element={<Placeholder title="La Cantina" need="cantina" />} />
      <Route path="/archivo/aportaciones" element={<Placeholder title="Aportaciones" need="aportaciones" />} />
      <Route path="/archivo/admin" element={<AdminPanel />} />
    </Routes>
  )
}

export default AppRoutes
