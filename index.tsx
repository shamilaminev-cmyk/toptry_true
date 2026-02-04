import React from 'react';
import "./index.css";
import ReactDOM from 'react-dom/client';
import App from './App';
import { patchFetchForApi } from './fetchPatch';
import './index.css';

patchFetchForApi();

import { patchFetchForApi } from './fetchPatch';
patchFetchForApi();

ReactDOM.createRoot(document.getElementById('root')!).render(
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
