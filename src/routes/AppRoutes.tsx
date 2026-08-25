import { Routes, Route } from 'react-router-dom'
import Home from '../pages/Home/Home'
import Archivo from '../pages/Archivo/Archivo'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/archivo" element={<Archivo />} />
    </Routes>
  )
}

export default AppRoutes
