import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'

const rootElement = document.getElementById('app')

if (!rootElement) {
  throw new Error('Elemento raiz #app não encontrado')
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
