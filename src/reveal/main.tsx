import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/**
 * Mounts the "opening reveal" motion-graphic section as an isolated React
 * island inside the otherwise static Catena page. Nothing outside
 * #reveal-root is touched, so every pre-existing section keeps working
 * exactly as before even if this bundle fails to load.
 */
function mount() {
  const host = document.getElementById('reveal-root');
  if (!host || host.dataset.mounted === 'true') return;
  host.dataset.mounted = 'true';

  createRoot(host).render(
    <StrictMode>
      <App />
    </StrictMode>
  );

  document.documentElement.classList.add('reveal-ready');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
