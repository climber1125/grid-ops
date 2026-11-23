import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';

// Crew phones (/field, /t/<device>) load only the small field app, not the console.
const isField = /^\/(field|t)(\/|$)/.test(window.location.pathname);
const FieldApp = lazy(() => import('./field/FieldApp'));
const ConsoleApp = lazy(() => import('./ui/App'));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>{isField ? <FieldApp /> : <ConsoleApp />}</Suspense>
  </React.StrictMode>,
);
