import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// Versions:
// - App.tsx: Pixel-perfect absolute positioning (original)
// - App.tailwind.tsx: Zero-error Tailwind transpilation
// - App.flexbox.tsx: SAT solver derived flexbox (verified coordinates)
// - App.responsive.tsx: Basic responsive
// - App.final.tsx: Production-ready responsive with golden ratio
// - App.interactive.tsx: Interactive sliders + copy functionality
import App from './App.interactive.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
