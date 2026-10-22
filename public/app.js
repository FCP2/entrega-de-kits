(() => {
  'use strict';

  const icon = {
    success: '<div class="kit-icon success"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div>',
    warning: '<div class="kit-icon warning"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/></svg></div>',
    error: '<div class="kit-icon error"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg></div>'
  };

  function alertBox(type, title, text, options = {}) {
    return Swal.fire({
      title, text, iconHtml: icon[type], icon: undefined,
      buttonsStyling: false,
      confirmButtonText: options.confirmButtonText || 'Entendido',
      showCancelButton: Boolean(options.showCancelButton),
      cancelButtonText: 'Cancelar',
      reverseButtons: true,
      backdrop: 'rgba(30, 22, 28, .62)',
      customClass: {
        popup: 'kit-popup', confirmButton: 'kit-confirm', cancelButton: 'kit-cancel',
        icon: 'swal2-icon-borderless'
      }
    });
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin', cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && data.code === 'SESSION_EXPIRED') {
        await alertBox('warning', 'Sesión terminada', data.message);
        window.location.assign('/');
      }
      const error = new Error(data.message || 'No fue posible completar la solicitud.');
      error.code = data.code;
      error.data = data;
      throw error;
    }
    return data;
  }

  const loginForm = document.getElementById('loginForm');
  const loginButton = document.getElementById('loginButton');
  const loginView = document.getElementById('loginView');
  const dashboardView = document.getElementById('dashboardView');
  const loadingView = document.getElementById('loadingView');
  const headerActions = document.getElementById('headerActions');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  const scanButton = document.getElementById('scanButton');
  const scannerPanel = document.getElementById('scannerPanel');
  const scannerStatus = document.getElementById('scannerStatus');
  const closeScannerButton = document.getElementById('closeScanner');
  const results = document.getElementById('results');
  const logoutButton = document.getElementById('logoutButton');
  const activeDeliveries = new Set();
  const REFRESH_INTERVAL_MS = 30_000;
  let refreshTimer = null;
  let refreshInFlight = false;
  let csrf = '';
  let loggingIn = false;
  let searchTimer = null;
  let searchController = null;
  let searchRevision = 0;
  let loggingOut = false;
  let scanner = null;
  let scannerStartPromise = null;
  let scannerStopPromise = null;
  let scannerStopRequested = false;
  let scanHandled = false;

  async function initialize() {
    try {
      const session = await request('/api/session');
      const authenticated = session.authenticated === true;
      csrf = authenticated ? session.csrf : '';
      document.getElementById('operatorName').textContent = authenticated ? session.operator : '';
      headerActions.hidden = !authenticated;
      loginView.hidden = authenticated;
      dashboardView.hidden = !authenticated;
      loadingView.hidden = true;
      if (authenticated) {
        await loadSummary();
        refreshTimer = window.setInterval(() => { void refreshVisibleData(); }, REFRESH_INTERVAL_MS);
      }
    } catch (error) {
      loadingView.hidden = true;
      loginView.hidden = false;
      await alertBox('error', 'No se pudo comprobar el acceso', error.message);
    }
  }

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (loggingIn) return;
    const operator = document.getElementById('operator').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (operator.length < 2) return void alertBox('warning', 'Falta tu nombre', 'Escribe el nombre de quien entregará los kits.');
    if (!username) return void alertBox('warning', 'Falta el usuario', 'Escribe el usuario compartido.');
    if (!password) return void alertBox('warning', 'Falta la contraseña', 'Escribe la contraseña de acceso.');
    loggingIn = true;
    loginButton.disabled = true;
    try {
      await request('/api/login', { method: 'POST', body: JSON.stringify({ operator, username, password }) });
      window.location.assign('/');
    } catch (error) {
      await alertBox('error', 'No se pudo ingresar', error.message);
    } finally {
      loggingIn = false;
      loginButton.disabled = false;
    }
  });

  async function closeScanner() {
    scannerStopRequested = true;
    scannerPanel.hidden = true;
    scanButton.setAttribute('aria-expanded', 'false');
    if (scannerStopPromise) return scannerStopPromise;
    const stopping = (async () => {
      if (scannerStartPromise) await scannerStartPromise.catch(() => {});
      const current = scanner;
      scanner = null;
      if (current) {
        try { await current.stop(); } catch (_) { /* Puede no haber iniciado. */ }
        try { current.clear(); } catch (_) { /* Ya estaba limpio. */ }
      }
      scanButton.disabled = false;
      scannerStopRequested = false;
    })();
    scannerStopPromise = stopping;
    try { await stopping; }
    finally { if (scannerStopPromise === stopping) scannerStopPromise = null; }
  }

  async function handleDecodedQr(decodedText) {
    if (scanHandled || scannerStopRequested) return;
    scanHandled = true;
    const folio = String(decodedText).match(/\bVC-\d{4}-\d{1,8}\b/i)?.[0];
    await closeScanner();
    if (!folio) {
      await alertBox('warning', 'QR no reconocido', 'Este código no contiene un folio válido de Voces que Corren.');
      return;
    }
    searchInput.value = folio.toUpperCase();
    await search();
  }

  async function openScanner() {
    if (scanner || scannerStartPromise || scannerStopPromise) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      await alertBox('warning', 'Cámara no disponible', 'Abre esta página con HTTPS en un navegador que permita usar la cámara.');
      return;
    }
    if (typeof window.Html5Qrcode !== 'function') {
      await alertBox('error', 'Lector no disponible', 'No se cargó el lector QR. Actualiza la página e intenta de nuevo.');
      return;
    }
    scanButton.disabled = true;
    scannerPanel.hidden = false;
    scanButton.setAttribute('aria-expanded', 'true');
    scannerStatus.textContent = 'Solicitando acceso a la cámara…';
    scanHandled = false;
    scannerStopRequested = false;
    try {
      const qrFormat = window.Html5QrcodeSupportedFormats?.QR_CODE;
      const current = new window.Html5Qrcode('qrReader',
        qrFormat === undefined ? {} : { formatsToSupport: [qrFormat] });
      scanner = current;
      scannerStartPromise = current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (width, height) => {
          const side = Math.max(1, Math.min(260, Math.floor(Math.min(width, height) * .72)));
          return { width: side, height: side };
        } },
        decodedText => { void handleDecodedQr(decodedText); }
      );
      await scannerStartPromise;
      scannerStatus.textContent = 'Cámara activa. Coloca el QR dentro del recuadro.';
    } catch (error) {
      if (!scannerStopRequested) {
        const denied = String(error?.name || error).includes('NotAllowed');
        await alertBox('error', denied ? 'Permiso de cámara denegado' : 'No se pudo abrir la cámara',
          denied ? 'Permite el acceso a la cámara en tu navegador y vuelve a intentarlo.'
            : 'Comprueba que otra aplicación no esté usando la cámara y vuelve a intentarlo.');
      }
      void closeScanner();
    } finally {
      scannerStartPromise = null;
      if (scannerStopRequested) await closeScanner();
    }
  }

  function dateTime(value) {
    return new Intl.DateTimeFormat('es-MX', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City'
    }).format(new Date(value));
  }

  async function loadSummary({ quiet = false } = {}) {
    try {
      const summary = await request('/api/resumen');
      const confirmed = Number(summary.confirmados) || 0;
      const delivered = Number(summary.entregados) || 0;
      const pending = Math.max(0, confirmed - delivered);
      const capacity = Number(summary.capacidad) || 0;
      document.getElementById('statConfirmed').textContent = confirmed.toLocaleString('es-MX');
      document.getElementById('statDelivered').textContent = delivered.toLocaleString('es-MX');
      document.getElementById('statPending').textContent = pending.toLocaleString('es-MX');
      document.getElementById('statConfirmedContext').textContent = capacity
        ? `De ${capacity.toLocaleString('es-MX')} cupos` : 'Cupo no configurado';
      updateRing('Confirmed', confirmed, capacity);
      updateRing('Delivered', delivered, confirmed);
      updateRing('Pending', pending, confirmed);
    } catch (error) {
      if (!quiet && error.code !== 'SESSION_EXPIRED') await alertBox('error', 'No se pudo cargar el resumen', error.message);
    }
  }

  function updateRing(id, value, total) {
    const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
    const ring = document.getElementById(`ring${id}`);
    ring.style.setProperty('--ring-value', `${Math.min(100, Math.max(0, percentage))}%`);
    ring.setAttribute('aria-valuenow', String(Math.min(100, Math.max(0, percentage))));
    document.getElementById(`stat${id}Percent`).textContent = `${percentage}%`;
  }

  function emptyState(title, message) {
    results.replaceChildren();
    const wrapper = document.createElement('div');
    wrapper.className = 'empty-state';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const text = document.createElement('p');
    text.textContent = message;
    wrapper.append(strong, text);
    results.append(wrapper);
  }

  function renderPeople(people) {
    results.replaceChildren();
    for (const person of people) {
      const card = document.createElement('article');
      card.className = 'person-card';
      const info = document.createElement('div');
      info.className = 'person-info';
      const head = document.createElement('div');
      head.className = 'person-head';
      const folio = document.createElement('span');
      folio.className = 'folio';
      folio.textContent = person.folio;
      const state = document.createElement('span');
      const done = Boolean(person.entregado_at);
      state.className = `badge rounded-pill border shadow-sm d-inline-flex align-items-center gap-2 px-3 py-2 fw-semibold status-badge ${done
        ? 'bg-success-subtle text-success-emphasis border-success-subtle'
        : 'bg-warning-subtle text-warning-emphasis border-warning-subtle'}`;
      const statusDot = document.createElement('span');
      statusDot.className = `status-dot ${done ? 'bg-success' : 'bg-warning'}`;
      statusDot.setAttribute('aria-hidden', 'true');
      state.append(statusDot, document.createTextNode(done ? 'Kit entregado' : 'Pendiente de entrega'));
      head.append(folio, state);
      const name = document.createElement('h3');
      name.textContent = person.nombre;
      const details = document.createElement('div');
      details.className = 'person-detail';
      for (const value of [person.categoria_competencia === 'femenil' ? 'Femenil' : 'Varonil', `Playera ${person.talla}`, person.es_menor_edad ? 'Menor de edad' : 'Mayor de edad']) {
        const item = document.createElement('span');
        item.textContent = value;
        details.append(item);
      }
      info.append(head, name, details);
      if (person.entregado_at) {
        const note = document.createElement('p');
        note.className = 'delivery-note';
        note.textContent = `Entregado el ${dateTime(person.entregado_at)} por ${person.entregado_por}.`;
        info.append(note);
      } else {
        const button = document.createElement('button');
        button.className = 'deliver-button';
        button.type = 'button';
        button.textContent = 'Marcar kit entregado';
        button.addEventListener('click', () => deliverKit(person, button));
        card.append(button);
      }
      card.prepend(info);
      results.append(card);
    }
  }

  async function search({ quiet = false, background = false } = {}) {
    clearTimeout(searchTimer);
    searchTimer = null;
    const q = searchInput.value.trim();
    if (q.length < 2) {
      if (!quiet) await alertBox('warning', 'Falta el dato de búsqueda', 'Escribe al menos 2 caracteres del nombre o un folio.');
      return;
    }
    const revision = ++searchRevision;
    searchController?.abort();
    const controller = new AbortController();
    searchController = controller;
    if (!background) searchButton.disabled = true;
    try {
      const { results: people } = await request(`/api/buscar?q=${encodeURIComponent(q)}`, { signal: controller.signal });
      if (revision !== searchRevision || (background && (activeDeliveries.size || Swal.isVisible()))) return;
      if (!people.length) {
        emptyState('Sin coincidencias', 'Revisa el folio o el nombre. Solo aparecen registros confirmados con folio.');
        if (!quiet) await alertBox('warning', 'No encontramos el registro', 'Comprueba el folio o el nombre. La inscripción debe estar confirmada.');
      } else {
        renderPeople(people);
      }
    } catch (error) {
      if (error.name === 'AbortError' || revision !== searchRevision) return;
      if (error.code !== 'SESSION_EXPIRED') {
        if (quiet) {
          if (!background) emptyState('No se pudo buscar', 'Comprueba tu conexión e intenta de nuevo.');
        } else await alertBox('error', 'No se pudo buscar', error.message);
      }
    } finally {
      if (revision === searchRevision) {
        searchController = null;
        if (!background) searchButton.disabled = false;
      }
    }
  }

  async function refreshVisibleData() {
    if (document.hidden || dashboardView.hidden || loggingOut || refreshInFlight ||
        activeDeliveries.size || searchController || searchTimer || Swal.isVisible()) return;
    refreshInFlight = true;
    try {
      await loadSummary({ quiet: true });
      if (searchInput.value.trim().length >= 2 && !searchController && !searchTimer &&
          !activeDeliveries.size && !Swal.isVisible()) {
        await search({ quiet: true, background: true });
      }
    } finally {
      refreshInFlight = false;
    }
  }

  async function deliverKit(person, button) {
    if (activeDeliveries.has(person.registro_id)) return;
    const decision = await alertBox('warning', 'Confirmar entrega del kit', `Verifica: ${person.nombre}. Folio ${person.folio}. Playera ${person.talla}. Esta acción quedará registrada.`, {
      showCancelButton: true, confirmButtonText: 'Sí, entregar kit'
    });
    if (!decision.isConfirmed || activeDeliveries.has(person.registro_id)) return;
    activeDeliveries.add(person.registro_id);
    button.disabled = true;
    try {
      await request('/api/entregas', {
        method: 'POST', headers: { 'X-CSRF-Token': csrf },
        body: JSON.stringify({ registroId: person.registro_id })
      });
      await alertBox('success', 'Kit entregado', `La entrega del folio ${person.folio} quedó registrada.`);
      await Promise.all([search(), loadSummary()]);
    } catch (error) {
      if (error.code === 'ALREADY_DELIVERED') {
        await alertBox('warning', 'Kit ya entregado', 'Otro equipo o integrante ya registró la entrega de este folio.');
        await search();
      } else if (error.code === 'NOT_CONFIRMED') {
        await alertBox('warning', 'Registro no disponible', error.message);
        await search();
      } else if (error.code !== 'SESSION_EXPIRED') {
        await alertBox('error', 'No se registró la entrega', error.message);
      }
    } finally {
      activeDeliveries.delete(person.registro_id);
      button.disabled = false;
    }
  }

  searchForm.addEventListener('submit', event => { event.preventDefault(); void search(); });
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = null;
    searchRevision++;
    searchController?.abort();
    searchController = null;
    searchButton.disabled = false;
    const q = searchInput.value.trim();
    if (!q) {
      emptyState('Listo para buscar', 'Escribe un nombre o folio para ver los resultados.');
    } else if (q.length < 2) {
      emptyState('Sigue escribiendo', 'Escribe al menos 2 caracteres para buscar.');
    } else {
      emptyState('Buscando coincidencias', 'Actualizaremos los resultados en un momento.');
      searchTimer = setTimeout(() => { void search({ quiet: true }); }, 350);
    }
  });
  scanButton.addEventListener('click', () => { void openScanner(); });
  closeScannerButton.addEventListener('click', () => { void closeScanner(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && scanner) void closeScanner();
    if (!document.hidden) void refreshVisibleData();
  });
  window.addEventListener('pagehide', () => {
    if (refreshTimer) window.clearInterval(refreshTimer);
    if (scanner) void closeScanner();
  });
  logoutButton.addEventListener('click', async () => {
    if (loggingOut) return;
    loggingOut = true;
    logoutButton.disabled = true;
    try {
      if (scanner) await closeScanner();
      await request('/api/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf } });
      window.location.assign('/');
    } catch (error) {
      await alertBox('error', 'No se pudo cerrar sesión', error.message);
      logoutButton.disabled = false;
      loggingOut = false;
    }
  });
  void initialize();
})();
