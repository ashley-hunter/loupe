import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { TooltipProvider } from './ui/Tooltip.js';
import './app.css';
import '../shared/bridge.js';

/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition --
   The preload bridge is declared as always present, but it genuinely is not
   when this page is opened outside Electron. */
document.body.dataset['platform'] = window.loupe?.platform ?? 'web';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
