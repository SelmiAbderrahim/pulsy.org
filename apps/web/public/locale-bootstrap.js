// Resolve locale before the first application paint.
// Keep this small and independent of the application bundle and locale fetches.
(() => {
  const supported = ['en', 'ar', 'fr', 'de', 'es'];
  let saved;
  try { saved = localStorage.getItem('i18nextLng'); } catch { /* Storage can be disabled. */ }
  const candidates = [new URLSearchParams(location.search).get('lng'), saved, ...navigator.languages, navigator.language, 'en'];
  const language = candidates.map(value => value?.toLowerCase().split('-')[0]).find(value => supported.includes(value)) || 'en';
  const root = document.documentElement;
  root.lang = language;
  root.dir = language === 'ar' ? 'rtl' : 'ltr';
  root.dataset.initialLocale = language;
  root.dataset.localePending = '';
  document.title = 'Pulsy';
  // Optional build-time labels are shared with the application locale files.
  const metadata = document.getElementById('pulsy-private-titles');
  if (metadata && location.pathname.startsWith('/dashboard')) {
    const labels = JSON.parse(metadata.textContent)[language];
    const search = new URLSearchParams(location.search), pathname = location.pathname.replace(/\/+$/, '');
    const routes = { '/dashboard': 'monitors', '/dashboard/incidents': 'incidents', '/dashboard/configuration': 'portability', '/dashboard/import-export': 'portability', '/dashboard/api-keys': 'apiKeys', '/dashboard/api-docs': 'apiDocs' };
    const panels = { notifications: 'notifications', 'status-pages': 'statusPages', templates: 'templates', 'share-links': 'shareLinks', 'saved-views': 'savedViews' };
    let title = labels.nav[routes[pathname]];
    if (pathname === '/dashboard' && panels[search.get('panel')]) title = labels.nav[panels[search.get('panel')]];
    if (pathname.startsWith('/dashboard/help/')) title = labels.help;
    if (pathname.startsWith('/dashboard/uptime/')) {
      let tab = search.get('tab');
      if (tab === 'reports') tab = 'slaReport';
      title = `${labels.nav.monitors} — ${labels.monitorTabs[tab] || labels.monitorTabs.overview}`;
    }
    if (pathname.startsWith('/dashboard/status-pages/')) title = `${labels.nav.statusPages} — ${labels.statusTabs[search.get('tab')] || labels.statusTabs.general}`;
    if (title) document.title = `${title} | Pulsy`;
  }
  document.addEventListener('DOMContentLoaded', () => {
    const loading = document.getElementById('locale-loading');
    if (loading) loading.textContent = {
      en: 'Loading…', ar: 'جارٍ التحميل…', fr: 'Chargement…',
      de: 'Wird geladen…', es: 'Cargando…',
    }[language];
  }, { once: true });
})();
