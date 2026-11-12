import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// No StrictMode on purpose: the scene owns a WebGL context and pointer lock and must not mount twice.
createRoot(document.getElementById('root')!).render(<App />)
