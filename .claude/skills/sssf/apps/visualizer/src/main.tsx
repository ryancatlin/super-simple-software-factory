import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource/archivo/600.css'
import '@fontsource/archivo/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/tokens.css'
import './styles/base.css'

import { App } from './App'

const host = document.getElementById('root')
if (!host) throw new Error('#root is missing from index.html')

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
