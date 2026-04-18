import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initAdminSentry } from './sentry';
import './styles.css';

initAdminSentry();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
