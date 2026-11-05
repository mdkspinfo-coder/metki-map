import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/base.css';
import './moderation.css';
import { ModerationApp } from './ModerationApp';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ModerationApp />
  </StrictMode>,
);
