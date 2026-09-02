import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createSystem, SystemProvider } from './state/system';
import './styles/base.css';

const system = createSystem();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SystemProvider system={system}>
      <App />
    </SystemProvider>
  </StrictMode>,
);
