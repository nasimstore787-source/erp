import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './styles.css';
import App from './App';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && import.meta.env.MODE === 'design') {
  root.render(<main className="center muted" role="status">جارٍ تحميل المعاينة…</main>);
  void import('./DesignPreview').then(({ default: Preview }) => root.render(<Preview />));
} else {
  root.render(<App />);
}
