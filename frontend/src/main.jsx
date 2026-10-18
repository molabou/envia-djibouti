import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';

const API = '/api-server';
const LOGO = '/envia-logo.png';

const avatarKey = username => `envia_avatar_${username || 'user'}`;
const getAvatar = username => { try { return localStorage.getItem(avatarKey(username)) || ''; } catch { return ''; } };
const getSavedUser = () => { try { const value = JSON.parse(localStorage.getItem('envia_user') || 'null'); return value && typeof value === 'object' && value.role && value.username ? value : null; } catch { localStorage.removeItem('envia_user'); return null; } };

const defaultIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

const pointIcon = new L.DivIcon({
  className: 'collection-pin',
  html: '♻',
  iconSize: [28, 28],
  iconAnchor: [14, 14]
});

const STATUS = {
  pending: ['À vérifier', 'warning'],
  to_validate: ['En validation', 'info'],
  validated: ['Validé', 'success'],
  rejected: ['Rejeté', 'danger'],
  processed: ['En traitement', 'purple'],
  closed: ['Clôturé', 'dark']
};

const roleLabel = role => ({
  admin: 'Administrateur',
  expert: 'Expert',
  ecogarde: 'Écogarde',
  citizen: 'Citoyen'
}[role] || role);

const categoryLabel = category => ({
  waste: 'Déchets & pollution',
  marine_pollution: 'Pollution marine',
  water: 'Eau',
  marine_biodiversity: 'Biodiversité marine',
  terrestrial_biodiversity: 'Biodiversité terrestre',
  fire: 'Incendie',
  climate: 'Chaleur / climat',
  habitat: 'Habitat / écosystème',

  // Nouveau nom backend
  shark: 'Pêche / capture de requin',

  // Ancien nom conservé pour compatibilité avec les anciennes données
  shark_fishing: 'Pêche / capture de requin'
}[category] || category || 'Observation environnementale');

const statusLabel = status =>
  STATUS[status]?.[0] || status || 'Inconnu';

const priorityLabel = priority => ({
  critical: 'Critique',
  high: 'Haute',
  medium: 'Normale',
  low: 'Faible'
}[priority] || priority);

const isGlobalRole = role =>
  ['expert', 'admin'].includes(role);

const isFieldRole = role =>
  ['citizen', 'ecogarde'].includes(role);

const canSeeCollectionPoints = role =>
  ['ecogarde', 'expert', 'admin'].includes(role);


/* =========================================================
   API
========================================================= */

async function api(path, options = {}) {
  const token = localStorage.getItem('envia_token');

  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { 'Content-Type': 'application/json' }),
    Accept: 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(API + path, {
    ...options,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Le service API est indisponible. Votre saisie est conservée.');
  }
  const data = await response.json();

  if (!response.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : `Erreur API ${response.status}`);
  }

  return data;
}


/* =========================================================
   APP
========================================================= */

function App() {
  const [user, setUser] = useState(() =>
    getSavedUser()
  );

  const [view, setView] = useState('dashboard');
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [points, setPoints] = useState([]);
  const [stats, setStats] = useState(null);

  const [toast, setToast] = useState('');
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  const [avatar, setAvatar] = useState(() =>
    getAvatar(user?.username)
  );

  /*
   * IMPORTANT :
   * Le backend v2 filtre déjà les événements selon le rôle.
   *
   * citizen   -> ses événements
   * ecogarde  -> ses événements
   * expert    -> tous
   * admin     -> tous
   *
   * On ne refait donc PLUS un filtrage avec reporter/display_name.
   */
  const personalEvents = events;

  const refresh = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const globalAccess = isGlobalRole(user.role);
      const collectionAccess = canSeeCollectionPoints(user.role);

      /*
       * On ne demande plus :
       *
       * /alerts
       * /statistics
       *
       * aux citoyens/écogardes car le backend les protège
       * avec un 403.
       */

      const [
        eventData,
        alertData,
        pointData,
        statisticsData
      ] = await Promise.all([
        api('/api/v1/events'),

        globalAccess
          ? api('/api/v1/alerts')
          : Promise.resolve([]),

        collectionAccess
          ? api('/api/v1/collection-points')
          : Promise.resolve([]),

        globalAccess
          ? api('/api/v1/statistics')
          : Promise.resolve(null)
      ]);

      setEvents(eventData || []);
      setAlerts(alertData || []);
      setPoints(pointData || []);
      setStats(statisticsData || null);

    } catch (err) {
      console.error('ENVIA refresh:', err);

      /*
       * Si le token n'est plus valide, on revient à la connexion.
       */
      if (
        String(err.message).includes('401') ||
        String(err.message).toLowerCase().includes('token') ||
        String(err.message).toLowerCase().includes('session')
      ) {
        localStorage.removeItem('envia_token');
        localStorage.removeItem('envia_user');
        setUser(null);
        return;
      }

      setToast(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      refresh();
      setAvatar(getAvatar(user.username));
      const update = () => { if (document.visibilityState === 'visible') refresh(); };
      const timer = setInterval(update, 15000);
      window.addEventListener('focus', update);
      return () => { clearInterval(timer); window.removeEventListener('focus', update); };
    }
  }, [user]);

  useEffect(() => {
    const openReport = () => setView('report');

    window.addEventListener('focusReport', openReport);

    return () =>
      window.removeEventListener('focusReport', openReport);
  }, []);

  if (!user) {
    return <Login onLogin={u => setUser(u)} />;
  }

  const logout = () => {
    localStorage.removeItem('envia_token');
    localStorage.removeItem('envia_user');

    setUser(null);
    setEvents([]);
    setAlerts([]);
    setPoints([]);
    setStats(null);
    setSelected(null);
  };

  /*
   * Seuls expert/admin ont accès aux alertes globales.
   *
   * Pour citoyen :
   * le compteur de notifications vient de ses événements.
   *
   * Pour écogarde :
   * pas d'alertes globales.
   */
  const openGlobalAlerts = isGlobalRole(user.role)
    ? alerts.filter(a => a.status === 'open').length
    : 0;

  const personalPending = events.filter(e =>
    ['pending', 'to_validate'].includes(e.status)
  ).length;

  const notificationCount =
    user.role === 'citizen'
      ? personalPending
      : openGlobalAlerts;

  const nav = getNavigation(
    user.role,
    notificationCount
  );

  const titles = {
    dashboard:
      user.role === 'ecogarde'
        ? 'Accueil terrain'
        : user.role === 'citizen'
          ? 'Accueil citoyen'
          : user.role === 'expert'
            ? 'Centre d’analyse'
            : 'Vue générale',

    report: 'Nouveau signalement',
    map: 'Carte environnementale',
    events: 'Signalements',
    alerts: 'Centre d’alertes',
    stats: 'Statistiques',
    validation: 'Centre de validation',
    processing: 'Suivi opérationnel',
    ai: 'ENVIA Intelligence',
    users: 'Utilisateurs & rôles',
    collection: 'Points de collecte',
    reports: 'Rapports & indicateurs',
    settings: 'Paramètres système',
    activity: 'Journal d’activité',
    mine: 'Mes signalements',
    terrain: 'Mes observations',
    media: 'Médias terrain',
    notifications: 'Suivi de mes signalements',
    profile: 'Mon profil'
  };

  return (
    <div className={`app role-${user.role}`}>

      {/* =====================================================
          SIDEBAR
      ===================================================== */}

      <aside>

        <div className="brand">
          <img
            src={LOGO}
            alt="ENVIA Djibouti"
          />

          <div>
            <b>ENVIA</b>
            <span>DJIBOUTI</span>
          </div>
        </div>

        <div className="profile">
          <div className="avatar">
            {avatar ? (
              <img
                src={avatar}
                alt="Photo de profil"
              />
            ) : (
              (user.display_name || 'E')
                .slice(0, 1)
                .toUpperCase()
            )}
          </div>

          <div>
            <strong>{user.display_name}</strong>
            <small>{roleLabel(user.role)}</small>
          </div>
        </div>

        <nav>
          {nav.map(item => (
            <button
              key={item.id}
              className={view === item.id ? 'active' : ''}
              onClick={() => setView(item.id)}
            >
              <span>{item.icon}</span>

              {item.label}

              {item.badge ? (
                <em>{item.badge}</em>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="tag">
          Observer. Collecter.<br />
          Comprendre. Alerter. Protéger.
        </div>

        <button
          className="logout"
          onClick={logout}
        >
          ↪ Déconnexion
        </button>

      </aside>


      {/* =====================================================
          MAIN
      ===================================================== */}

      <main>

        <header>
          <div>
            <small>
              PLATEFORME NATIONALE · ENVIA DJIBOUTI
            </small>

            <h1>
              {titles[view] || 'ENVIA'}
            </h1>
          </div>

          <div className="headerRight"><a className="mobileLink" href="/mobile/">ENVIA Mobile ↗</a>
            <div className="live">
              <i></i>
              Système opérationnel
            </div>

            <div className="dateNow">
              {new Date().toLocaleDateString(
                'fr-FR',
                {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                }
              )}
            </div>
          </div>
        </header>

        {loading && (
          <div className="loadingLine">
            Actualisation des données…
          </div>
        )}


        {/* ===================================================
            DASHBOARD
        =================================================== */}

        {view === 'dashboard' &&
          (
            isFieldRole(user.role)
              ? (
                <MobileHome
                  user={user}
                  events={personalEvents}
                  alerts={alerts}
                  setView={setView}
                  onSelect={setSelected}
                />
              )
              : (
                <Dashboard
                  user={user}
                  events={events}
                  alerts={alerts}
                  stats={stats}
                  points={points}
                  setView={setView}
                  onSelect={setSelected}
                />
              )
          )
        }


        {/* ===================================================
            REPORT
        =================================================== */}

        {view === 'report' && (
          <Report
            user={user}
            onDone={async () => {
              await refresh();

              setView(
                user.role === 'citizen'
                  ? 'mine'
                  : user.role === 'ecogarde'
                    ? 'terrain'
                    : 'events'
              );
            }}
          />
        )}


        {/* ===================================================
            MAP
        =================================================== */}

        {view === 'map' && (
          <MapView
            events={personalEvents}
            points={
              canSeeCollectionPoints(user.role)
                ? points
                : []
            }
            onSelect={setSelected}
            simple={isFieldRole(user.role)}
          />
        )}


        {/* ===================================================
            EVENTS
        =================================================== */}

        {view === 'events' && (
          <Events
            events={events}
            user={user}
            refresh={refresh}
            onSelect={setSelected}
          />
        )}

        {view === 'mine' && (
          <Events
            events={personalEvents}
            user={user}
            refresh={refresh}
            onSelect={setSelected}
            mine
          />
        )}


        {/* ===================================================
            EXPERT WORKFLOW
        =================================================== */}

        {view === 'validation' && (
          <Validation
            events={events}
            refresh={refresh}
            onSelect={setSelected}
          />
        )}

        {view === 'processing' && (
          <Processing
            events={events}
            refresh={refresh}
            onSelect={setSelected}
          />
        )}


        {/* ===================================================
            GLOBAL ALERTS
        =================================================== */}

        {view === 'alerts' && isGlobalRole(user.role) && (
          <Alerts
            alerts={alerts}
            refresh={refresh}
          />
        )}


        {/* ===================================================
            STATISTICS
        =================================================== */}

        {view === 'stats' && isGlobalRole(user.role) && (
          <Stats
            stats={stats}
            events={events}
          />
        )}


        {/* ===================================================
            AI
        =================================================== */}

        {view === 'ai' && isGlobalRole(user.role) && (
          <AIView
            events={events}
          />
        )}


        {/* ===================================================
            TERRAIN
        =================================================== */}

        {view === 'terrain' && user.role === 'ecogarde' && (
          <Terrain
            events={personalEvents}
            alerts={[]}
            setView={setView}
          />
        )}


        {/* ===================================================
            MEDIA
        =================================================== */}

        {view === 'media' && isGlobalRole(user.role) && (
          <MediaView
            events={events}
          />
        )}


        {/* ===================================================
            USERS
        =================================================== */}

        {view === 'users' && user.role === 'admin' && (
          <UsersView
            user={user}
          />
        )}


        {/* ===================================================
            COLLECTION
        =================================================== */}

        {view === 'collection' &&
          canSeeCollectionPoints(user.role) && (
            <CollectionView
              points={points}
            />
          )
        }


        {/* ===================================================
            REPORTS
        =================================================== */}

        {view === 'reports' && isGlobalRole(user.role) && (
          <ReportsView
            stats={stats}
            events={events}
            alerts={alerts}
          />
        )}


        {/* ===================================================
            SETTINGS
        =================================================== */}

        {view === 'settings' && user.role === 'admin' && (
          <SettingsView />
        )}


        {/* ===================================================
            ACTIVITY
        =================================================== */}

        {view === 'activity' && user.role === 'admin' && (
          <ActivityView
            events={events}
            alerts={alerts}
          />
        )}


        {/* ===================================================
            CITIZEN NOTIFICATIONS
        =================================================== */}

        {view === 'notifications' && user.role === 'citizen' && (
          <Notifications
            events={personalEvents}
          />
        )}


        {/* ===================================================
            PROFILE
        =================================================== */}

        {view === 'profile' && (
          <Profile
            user={user}
            avatar={avatar}
            onAvatarChange={setAvatar}
          />
        )}

      </main>


      {/* =====================================================
          EVENT MODAL
      ===================================================== */}

      {selected && (
        <EventModal
          event={selected}
          user={user}
          onClose={() => setSelected(null)}
          refresh={refresh}
        />
      )}


      {/* =====================================================
          TOAST
      ===================================================== */}

      {toast && (
        <div
          className="toast"
          onClick={() => setToast('')}
        >
          {toast}
        </div>
      )}

    </div>
  );
}


/* =========================================================
   NAVIGATION
========================================================= */

function getNavigation(role, notificationCount) {

  /*
   * ADMIN
   */

  if (role === 'admin') {
    return [
      ['dashboard', '⌂', 'Vue générale'],
      ['map', '◉', 'Supervision cartographique'],
      ['events', '▣', 'Signalements'],
      ['alerts', '!', 'Alertes', notificationCount],
      ['ai', '✦', 'ENVIA-AI'],
      ['users', '♙', 'Utilisateurs & rôles'],
      ['collection', '♻', 'Points de collecte'],
      ['stats', '◫', 'Statistiques'],
      ['reports', '▤', 'Rapports'],
      ['activity', '◷', 'Journal d’activité'],
      ['settings', '⚙', 'Paramètres'],
      ['profile', '◎', 'Mon profil']
    ].map(x => ({
      id: x[0],
      icon: x[1],
      label: x[2],
      badge: x[3] || null
    }));
  }


  /*
   * EXPERT
   */

  if (role === 'expert') {
    return [
      ['dashboard', '⌂', 'Tableau de bord'],
      ['validation', '✓', 'Centre de validation'],
      ['processing', '↻', 'En traitement'],
      ['events', '▣', 'Tous les signalements'],
      ['map', '◉', 'Carte'],
      ['ai', '✦', 'ENVIA-AI'],
      ['alerts', '!', 'Alertes', notificationCount],
      ['reports', '▤', 'Rapports'],
      ['stats', '◫', 'Statistiques'],
      ['profile', '◎', 'Mon profil']
    ].map(x => ({
      id: x[0],
      icon: x[1],
      label: x[2],
      badge: x[3] || null
    }));
  }


  /*
   * ÉCOGARDE
   *
   * IMPORTANT :
   * Pas d'accès aux alertes globales.
   */

  if (role === 'ecogarde') {
    return [
      ['dashboard', '⌂', 'Accueil terrain'],
      ['report', '+', 'Nouvelle observation'],
      ['terrain', '⌁', 'Mes observations'],
      ['map', '◉', 'Ma carte'],
      ['profile', '◎', 'Mon profil']
    ].map(x => ({
      id: x[0],
      icon: x[1],
      label: x[2],
      badge: null
    }));
  }


  /*
   * CITOYEN
   */

  return [
    ['dashboard', '⌂', 'Accueil'],
    ['report', '+', 'Nouveau signalement'],
    ['mine', '▣', 'Mes signalements'],
    ['map', '◉', 'Ma carte'],
    ['notifications', '!', 'Suivi de mes signalements', notificationCount],
    ['profile', '◎', 'Mon profil']
  ].map(x => ({
    id: x[0],
    icon: x[1],
    label: x[2],
    badge: x[3] || null
  }));
}


/* =========================================================
   LOGIN
========================================================= */

function Login({ onLogin }) {
  const [username, setUsername] = useState('ecogarde');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const go = async e => {
    e.preventDefault();

    setError('');

    try {
      const data = await api(
        '/api/v1/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            username,
            password
          })
        }
      );

      localStorage.setItem(
        'envia_token',
        data.token
      );

      localStorage.setItem(
        'envia_user',
        JSON.stringify(data.user)
      );

      onLogin(data.user);

    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="login">

      <div className="loginGlow one"></div>
      <div className="loginGlow two"></div>

      <div className="loginCard">

        <div className="bigLogo">
          <img
            src={LOGO}
            alt="Logo officiel ENVIA"
          />
        </div>

        <div className="eyebrow">
          PLATEFORME NATIONALE
        </div>

        <h1>
          ENVIA
          <span>DJIBOUTI</span>
        </h1>

        <p>
          Intelligence environnementale ·
          Données · Terrain · Décision
        </p>

        <form onSubmit={go}>

          <label>
            Identifiant

            <input
              value={username}
              onChange={e =>
                setUsername(e.target.value)
              }
            />
          </label>

          <label>
            Mot de passe

            <input
              type="password"
              value={password}
              onChange={e =>
                setPassword(e.target.value)
              }
            />
          </label>

          {error && (
            <div className="error">
              {error}
            </div>
          )}

          <button className="primary loginBtn">
            SE CONNECTER
            <span>→</span>
          </button>

        </form>

        <div className="demo">
          Environnement de démonstration ·
          admin / expert / écogarde
        </div>

      </div>
    </div>
  );
}


/* =========================================================
   DASHBOARD EXPERT / ADMIN
========================================================= */

function Dashboard({
  user,
  events,
  alerts,
  stats,
  points,
  setView,
  onSelect
}) {

  const total = events.length;

  const openAlerts =
    alerts.filter(a => a.status === 'open').length;

  const pending =
    events.filter(e =>
      ['pending', 'to_validate'].includes(e.status)
    ).length;

  const validated =
    events.filter(e =>
      e.status === 'validated'
    ).length;

  const critical =
    events.filter(e =>
      ['high', 'critical'].includes(e.priority)
    ).length;

  const today =
    events.filter(
      e =>
        new Date(e.created_at).toDateString() ===
        new Date().toDateString()
    ).length;

  const title =
    user.role === 'expert'
      ? 'Centre d’analyse environnementale'
      : 'Supervision nationale';

  return (
    <>

      <section className="welcome">

        <div>
          <div className="eyebrow">
            BONJOUR, {String(
              user.display_name || ''
            ).toUpperCase()}
          </div>

          <h2>{title}</h2>

          <p>
            Suivez l’activité environnementale
            de Djibouti depuis un seul espace.
          </p>
        </div>

        <button
          className="primary"
          onClick={() => setView('report')}
        >
          + Nouveau signalement
        </button>

      </section>


      <section className="kpis">

        <Kpi
          label="Signalements"
          value={total}
          hint={`+${today} aujourd’hui`}
          icon="◉"
          tone="cyan"
        />

        <Kpi
          label="À traiter"
          value={pending}
          hint="En attente de validation"
          icon="◷"
          tone="orange"
        />

        <Kpi
          label="Validés"
          value={validated}
          hint="Observations confirmées"
          icon="✓"
          tone="green"
        />

        <Kpi
          label="Alertes actives"
          value={openAlerts}
          hint={`${critical} priorité haute`}
          icon="!"
          tone="red"
        />

      </section>


      <section className="dashboardGrid">

        <div className="panel chartPanel">
          <PanelTitle
            title="Activité environnementale"
            subtitle="Répartition actuelle des signalements"
            action="Voir les statistiques"
            onClick={() => setView('stats')}
          />

          <DonutChart events={events} />
        </div>


        <div className="panel">

          <PanelTitle
            title="État opérationnel"
            subtitle="Flux de traitement"
          />

          <StatusFlow events={events} />

        </div>


        <div className="panel wide">

          <PanelTitle
            title="Activité récente"
            subtitle={`${events.length} signalement(s) dans la plateforme`}
            action="Ouvrir la liste"
            onClick={() =>
              setView(
                user.role === 'expert'
                  ? 'validation'
                  : 'events'
              )
            }
          />

          <EventList
            events={events.slice(0, 7)}
            onSelect={onSelect}
          />

        </div>


        <div className="panel">

          <PanelTitle
            title="Priorités"
            subtitle="Niveau de vigilance"
          />

          <PriorityBars events={events} />

        </div>


        <div className="panel wide">

          <PanelTitle
            title="Aperçu géographique"
            subtitle={`${points.length} point(s) de collecte · ${events.length} observation(s)`}
            action="Ouvrir la carte"
            onClick={() => setView('map')}
          />

          <MiniMap events={events} />

        </div>


        <div className="panel">

          <PanelTitle
            title="Alertes récentes"
            subtitle="Surveillance"
          />

          <AlertMini
            alerts={alerts}
            setView={setView}
          />

        </div>

      </section>

    </>
  );
}


/* =========================================================
   MOBILE HOME CITIZEN / ECOGARDE
========================================================= */

function MobileHome({
  user,
  events,
  alerts,
  setView,
  onSelect
}) {

  const isEco = user.role === 'ecogarde';

  const pending =
    events.filter(e =>
      ['pending', 'to_validate'].includes(e.status)
    ).length;

  const validated =
    events.filter(e =>
      e.status === 'validated'
    ).length;

  const closed =
    events.filter(e =>
      e.status === 'closed'
    ).length;

  const title =
    isEco
      ? 'Espace terrain'
      : 'Mon espace ENVIA';

  return (
    <div className="mobileHome">

      <section className="mobileWelcome">

        <div className="mobileBrand">

          <img
            src={LOGO}
            alt="ENVIA"
          />

          <div>
            <span>ENVIA DJIBOUTI</span>
            <strong>
              {isEco ? 'Agent terrain' : 'Citoyen'}
            </strong>
          </div>

        </div>

        <div className="eyebrow">
          BONJOUR, {String(
            user.display_name || ''
          ).toUpperCase()}
        </div>

        <h2>{title}</h2>

        <p>
          {isEco
            ? 'Signalez rapidement ce que vous observez sur le terrain.'
            : 'Signalez un problème environnemental en quelques secondes.'
          }
        </p>

      </section>


      <button
        className="fieldAction"
        onClick={() => setView('report')}
      >

        <span>📷</span>

        <div>
          <strong>
            {isEco
              ? 'NOUVELLE OBSERVATION'
              : 'NOUVEAU SIGNALEMENT'}
          </strong>

          <small>
            Photo · GPS · IA
          </small>
        </div>

        <b>→</b>

      </button>


      <div className="mobileQuickGrid">

        <button
          onClick={() =>
            setView(isEco ? 'terrain' : 'mine')
          }
        >
          <span>▣</span>
          <b>{events.length}</b>
          <small>
            {isEco
              ? 'Mes observations'
              : 'Mes signalements'}
          </small>
        </button>


        <button
          onClick={() => setView('map')}
        >
          <span>◉</span>
          <b>GPS</b>
          <small>Ma carte</small>
        </button>


        /*
         * IMPORTANT :
         * L'écogarde n'a plus de bouton Alertes.
         * Le backend réserve les alertes globales à expert/admin.
         */

        {isEco ? (
          <button
            onClick={() => setView('profile')}
          >
            <span>◎</span>
            <b>Moi</b>
            <small>Mon profil</small>
          </button>
        ) : (
          <button
            onClick={() => setView('notifications')}
          >
            <span>🔔</span>
            <b>{pending}</b>
            <small>À suivre</small>
          </button>
        )}


        {!isEco && (
          <button
            onClick={() => setView('profile')}
          >
            <span>◎</span>
            <b>Moi</b>
            <small>Mon profil</small>
          </button>
        )}

      </div>


      <div className="mobileStats">

        <div>
          <span>À suivre</span>
          <b>{pending}</b>
        </div>

        <div>
          <span>Validés</span>
          <b>{validated}</b>
        </div>

        <div>
          <span>Clôturés</span>
          <b>{closed}</b>
        </div>

      </div>


      <div className="panel mobileRecent">

        <PanelTitle
          title={
            isEco
              ? 'Mes dernières observations'
              : 'Mes derniers signalements'
          }
          subtitle={`${events.length} dossier(s)`}
          action="Voir tout"
          onClick={() =>
            setView(
              isEco
                ? 'terrain'
                : 'mine'
            )
          }
        />

        <EventList
          events={events.slice(0, 4)}
          onSelect={onSelect}
        />

      </div>


      <div className="mobileTip">

        <span>✦</span>

        <div>
          <strong>ENVIA-AI</strong>

          <p>
            {isEco
              ? 'Prenez simplement une photo. ENVIA vous aide à identifier et classer l’observation.'
              : 'Une photo et votre position peuvent suffire pour documenter un signalement.'
            }
          </p>
        </div>

      </div>

    </div>
  );
}


/* =========================================================
   KPI / PANELS
========================================================= */

function Kpi({
  label,
  value,
  hint,
  icon,
  tone
}) {
  return (
    <div className={`kpi ${tone}`}>

      <div className="kpiIcon">
        {icon}
      </div>

      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{hint}</small>
      </div>

      <div className="spark">
        <i></i>
        <i></i>
        <i></i>
        <i></i>
        <i></i>
      </div>

    </div>
  );
}


function PanelTitle({
  title,
  subtitle,
  action,
  onClick
}) {
  return (
    <div className="panelHead">

      <div>
        <h2>{title}</h2>
        <span>{subtitle}</span>
      </div>

      {action && (
        <button
          className="linkBtn"
          onClick={onClick}
        >
          {action} →
        </button>
      )}

    </div>
  );
}


/* =========================================================
   STATUS FLOW
========================================================= */

function StatusFlow({ events }) {

  const values = [
    'pending',
    'to_validate',
    'validated',
    'processed',
    'closed'
  ];

  return (
    <div className="flow">

      {values.map((status, index) => {

        const count =
          events.filter(
            e => e.status === status
          ).length;

        const percent =
          events.length
            ? count / events.length * 100
            : 0;

        return (
          <div
            className="flowRow"
            key={status}
          >

            <div
              className={`flowDot ${STATUS[status][1]}`}
            >
              {index + 1}
            </div>

            <div className="grow">

              <b>
                {statusLabel(status)}
              </b>

              <small>
                {count} signalement(s)
              </small>

            </div>

            <div className="flowTrack">
              <i
                style={{
                  width: `${Math.min(
                    100,
                    percent
                  )}%`
                }}
              ></i>
            </div>

          </div>
        );
      })}

    </div>
  );
}


/* =========================================================
   PRIORITY
========================================================= */

function PriorityBars({ events }) {

  const values = [
    ['critical', 'Critique'],
    ['high', 'Haute'],
    ['medium', 'Normale'],
    ['low', 'Faible']
  ];

  return (
    <div className="priorityList">

      {values.map(([key, label]) => {

        const count =
          events.filter(
            e => e.priority === key
          ).length;

        const percent =
          events.length
            ? Math.max(
                4,
                count / events.length * 100
              )
            : 4;

        return (
          <div key={key}>

            <div>
              <span>{label}</span>
              <b>{count}</b>
            </div>

            <i
              className={key}
              style={{
                width: `${percent}%`
              }}
            ></i>

          </div>
        );
      })}

    </div>
  );
}


/* =========================================================
   DONUT
========================================================= */

function DonutChart({ events }) {

  const counts = Object.entries(
    events.reduce((acc, event) => {

      const key =
        categoryLabel(event.category);

      acc[key] =
        (acc[key] || 0) + 1;

      return acc;

    }, {})
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const total =
    events.length || 1;

  return (
    <div className="donutWrap">

      <div className="donut">

        <div>
          <strong>{events.length}</strong>
          <span>total</span>
        </div>

      </div>

      <div className="legend">

        {counts.length ? (
          counts.map(([key, value], index) => (
            <div key={key}>

              <i className={`l${index % 6}`}></i>

              <span>{key}</span>

              <b>
                {Math.round(
                  value / total * 100
                )}%
              </b>

            </div>
          ))
        ) : (
          <div className="emptySmall">
            Aucune donnée
          </div>
        )}

      </div>

    </div>
  );
}


/* =========================================================
   MINI MAP
========================================================= */

function MiniMap({ events }) {

  return (
    <div className="miniMap">

      <div className="mapGrid"></div>

      {events
        .slice(0, 18)
        .map((event, index) => (

          <span
            key={event.id}
            className={`mapPoint ${event.priority}`}
            style={{
              left: `${12 + (index * 17) % 78}%`,
              top: `${20 + (index * 31) % 60}%`
            }}
            title={event.description}
          ></span>

        ))}

      <div className="mapOverlay">
        <b>DJIBOUTI</b>
        <span>
          Couverture environnementale
        </span>
      </div>

    </div>
  );
}


/* =========================================================
   ALERT MINI
========================================================= */

function AlertMini({ alerts, setView }) {

  const open =
    alerts
      .filter(a => a.status === 'open')
      .slice(0, 3);

  if (!open.length) {
    return (
      <div className="empty">
        Aucune alerte ouverte.
      </div>
    );
  }

  return (
    <div className="alertMini">

      {open.map(alert => (

        <div key={alert.id}>

          <i className={alert.severity}>
            !
          </i>

          <div className="grow">

            <b>{alert.title}</b>

            <small>
              {alert.message}
            </small>

          </div>

        </div>

      ))}

      <button
        className="linkBtn"
        onClick={() => setView('alerts')}
      >
        Voir toutes les alertes →
      </button>

    </div>
  );
}


/* =========================================================
   EVENT LIST
========================================================= */

function EventList({
  events,
  onSelect
}) {

  if (!events.length) {
    return (
      <div className="empty">
        Aucun signalement pour le moment.
      </div>
    );
  }

  return (
    <div className="list">

      {events.map(event => (

        <button
          className="row eventButton"
          key={event.id}
          onClick={() =>
            onSelect?.(event)
          }
        >

          <div
            className={`dot ${event.priority}`}
          ></div>

          <div className="grow">

            <b>
              {categoryLabel(event.category)}

              {event.subcategory
                ? ` · ${event.subcategory}`
                : ''
              }
            </b>

            <p>
              {event.description ||
                'Sans description'}
            </p>

            <small>
              {event.region ||
                'Localisation GPS'}
              {' · '}
              {new Date(
                event.created_at
              ).toLocaleString('fr-FR')}
            </small>

          </div>

          <span
            className={`badge ${
              STATUS[event.status]?.[1] || ''
            }`}
          >
            {statusLabel(event.status)}
          </span>

        </button>

      ))}

    </div>
  );
}


/* =========================================================
   REPORT
========================================================= */

function Report({
  user,
  onDone
}) {

  const sendReceipt = useRef({payload: '', key: '', mediaKeys: new WeakMap()});
  const isEco =
    user.role === 'ecogarde';

  const [cat, setCat] =
    useState('waste');

  const [desc, setDesc] =
    useState('');

  const [lat, setLat] =
    useState('');

  const [lon, setLon] =
    useState('');

  const [priority, setPriority] =
    useState('medium');

  const [photo, setPhoto] =
    useState(null);

  const [audio, setAudio] =
    useState(null);

  const [ai, setAi] =
    useState(null);

  const [busy, setBusy] =
    useState(false);

  const [msg, setMsg] =
    useState('');

  const gps = () => {

    if (!navigator.geolocation) {
      setMsg(
        'La géolocalisation n’est pas disponible sur cet appareil.'
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => {

        setLat(
          position.coords.latitude.toFixed(6)
        );

        setLon(
          position.coords.longitude.toFixed(6)
        );

        setMsg(
          'Position GPS récupérée.'
        );
      },

      () => {
        setMsg(
          'GPS indisponible : saisissez la position manuellement.'
        );
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  };


  const analyze = async () => {

    if (!desc.trim()) {
      setMsg(
        'Ajoutez d’abord une description ou observation.'
      );
      return;
    }

    try {

      setMsg('');

      const result = await api(
        '/api/v1/ai/analyze',
        {
          method: 'POST',
          body: JSON.stringify({
            description: desc,
            category_hint: isEco ? '' : cat
          })
        }
      );

      setAi(result);

    } catch (error) {
      setMsg(error.message);
    }
  };


  const submit = async event => {

    event.preventDefault();

    setBusy(true);
    setMsg('');

    try {

      if (!lat || !lon) {
        throw new Error(
          'La position GPS est obligatoire.'
        );
      }

      /*
       * Le backend détermine lui-même le propriétaire
       * avec created_by_id.
       *
       * reporter est conservé uniquement comme information
       * d'affichage éventuelle.
       */

      const chosen =
        ai?.category || cat;

      const body = JSON.stringify({
        category: chosen,
        description: desc || 'Observation environnementale.',
        latitude: Number(lat), longitude: Number(lon), priority,
        source: isEco ? 'ecogarde' : 'manual', reporter: user.display_name
      });
      if (sendReceipt.current.payload !== body) {
        sendReceipt.current = {payload: body, key: crypto.randomUUID(), mediaKeys: new WeakMap()};
      }
      const mediaKey = file => {
        if (!sendReceipt.current.mediaKeys.has(file)) sendReceipt.current.mediaKeys.set(file, crypto.randomUUID());
        return sendReceipt.current.mediaKeys.get(file);
      };
      const createdEvent =
        await api(
          '/api/v1/events',
          {
            method: 'POST',

            headers: {'Idempotency-Key': sendReceipt.current.key},
            body
          }
        );


      /* Upload photo */

      if (photo) {

        const formData =
          new FormData();

        formData.append(
          'file',
          photo
        );

        await api(
          `/api/v1/events/${createdEvent.id}/media`,
          {
            method: 'POST',
            headers: {'Idempotency-Key': mediaKey(photo)},
            body: formData
          }
        );
      }


      /* Upload audio */

      if (audio) {

        const formData =
          new FormData();

        formData.append(
          'file',
          audio
        );

        await api(
          `/api/v1/events/${createdEvent.id}/media`,
          {
            method: 'POST',
            headers: {'Idempotency-Key': mediaKey(audio)},
            body: formData
          }
        );
      }


      setMsg(
        'Signalement enregistré avec succès.'
      );

      setTimeout(
        onDone,
        700
      );

    } catch (error) {

      setMsg(error.message);

    } finally {

      setBusy(false);
    }
  };


  return (
    <div className="formLayout">

      <div className="formPanel">

        <div className="formHero">

          <div>

            <div className="eyebrow">
              NOUVELLE OBSERVATION
            </div>

            <h2>
              {isEco
                ? 'Rapport terrain'
                : 'Signaler un événement'}
            </h2>

            <p>
              {isEco
                ? 'Capturez la réalité du terrain. ENVIA structure et assiste votre observation.'
                : 'Déclarez une situation environnementale avec sa localisation et ses éléments de preuve.'
              }
            </p>

          </div>

          <div className="formHeroIcon">
            {isEco ? '⌁' : '+'}
          </div>

        </div>


        {isEco && (
          <div className="ecoMode">

            <strong>
              MODE ÉCOGARDE
            </strong>

            <span>
              Photo · GPS · Audio · IA
            </span>

            <p>
              Une fiche claire est préparée automatiquement.
              La validation humaine reste obligatoire.
            </p>

          </div>
        )}


        <form
          onSubmit={submit}
          className={`form ${
            isEco ? 'ecoForm' : ''
          }`}
        >

          <div className="two">

            <label>
              Catégorie

              <select
                value={cat}
                onChange={e =>
                  setCat(e.target.value)
                }
              >

                {[
                  ['waste', 'Déchets & pollution'],
                  ['marine_pollution', 'Pollution marine'],
                  ['water', 'Eau'],
                  ['marine_biodiversity', 'Biodiversité marine'],
                  ['terrestrial_biodiversity', 'Biodiversité terrestre'],
                  ['fire', 'Incendie'],
                  ['climate', 'Chaleur / climat'],
                  ['habitat', 'Habitat / écosystème'],
                  ['shark', 'Pêche / capture de requin']
                ].map(
                  ([value, label]) => (
                    <option
                      value={value}
                      key={value}
                    >
                      {label}
                    </option>
                  )
                )}

              </select>

            </label>


            <label>
              Priorité

              <select
                value={priority}
                onChange={e =>
                  setPriority(e.target.value)
                }
              >
                <option value="medium">
                  Normale
                </option>

                <option value="high">
                  Haute
                </option>

                <option value="critical">
                  Critique
                </option>

              </select>

            </label>

          </div>


          <label>

            Description / observation

            <textarea
              value={desc}
              onChange={e =>
                setDesc(e.target.value)
              }
              placeholder="Décrivez ce que vous avez observé…"
            />

          </label>


          <div className="captureGrid">

            <label className="captureCard">

              <span>📷</span>

              <b>Photo</b>

              <small>
                {photo
                  ? photo.name
                  : 'Ajouter une preuve visuelle'}
              </small>

              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={e =>
                  setPhoto(
                    e.target.files?.[0] ||
                    null
                  )
                }
              />

            </label>


            <button
              type="button"
              className="captureCard"
              onClick={gps}
            >

              <span>⌖</span>

              <b>Position GPS</b>

              <small>
                {lat
                  ? `${lat}, ${lon}`
                  : 'Récupérer ma position'}
              </small>

            </button>


            <label className="captureCard">

              <span>◉</span>

              <b>Audio</b>

              <small>
                {audio
                  ? audio.name
                  : 'Ajouter une note vocale'}
              </small>

              <input
                type="file"
                accept="audio/*"
                capture
                onChange={e =>
                  setAudio(
                    e.target.files?.[0] ||
                    null
                  )
                }
              />

            </label>

          </div>


          <div className="two geoRow">

            <label>
              Latitude

              <input
                value={lat}
                onChange={e =>
                  setLat(e.target.value)
                }
                required
              />
            </label>

            <label>
              Longitude

              <input
                value={lon}
                onChange={e =>
                  setLon(e.target.value)
                }
                required
              />
            </label>

          </div>


          <div className="aiBox">

            <div>

              <strong>
                ✦ ENVIA-AI
              </strong>

              <p>
                {ai
                  ? `${categoryLabel(ai.category)}${
                      ai.subcategory
                        ? ' · ' + ai.subcategory
                        : ''
                    } · confiance ${
                      Math.round(
                        ai.confidence * 100
                      )
                    }% · validation humaine requise`
                  : 'Analysez la description pour obtenir une suggestion automatique.'
                }
              </p>

            </div>

            <button
              type="button"
              className="secondary"
              onClick={analyze}
            >
              Analyser
            </button>

          </div>


          {msg && (
            <div className="notice">
              {msg}
            </div>
          )}


          <button
            disabled={busy}
            className="primary submitBtn"
          >
            {busy
              ? 'ENREGISTREMENT…'
              : 'CONFIRMER ET ENREGISTRER →'}
          </button>

        </form>

      </div>


      <div className="sideInfo">

        <div className="panel infoCard">

          <div className="infoIcon">
            ✦
          </div>

          <h3>
            Intelligence environnementale
          </h3>

          <p>
            ENVIA centralise les observations
            de terrain pour aider les équipes
            à comprendre les tendances et
            prioriser les interventions.
          </p>

          <div className="infoStat">
            <b>100%</b>
            <span>
              des décisions restent sous
              contrôle humain
            </span>
          </div>

        </div>


        <div className="panel">

          <h3>
            Bon signalement
          </h3>

          <ul className="checkList">
            <li>Localisation précise</li>
            <li>Description factuelle</li>
            <li>Photo lorsque possible</li>
            <li>Priorité adaptée à la situation</li>
          </ul>

        </div>

      </div>

    </div>
  );
}


/* =========================================================
   MAP
========================================================= */

function MapView({
  events,
  points,
  onSelect,
  simple = false
}) {

  const [filter, setFilter] =
    useState('all');

  const shown =
    events.filter(event =>
      filter === 'all' ||
      event.status === filter ||
      event.priority === filter
    );

  return (
    <div className="panel mapPanel">

      <div className="mapToolbar">

        <div>

          <div className="eyebrow">
            {simple
              ? 'MA LOCALISATION'
              : 'SUPERVISION GÉOGRAPHIQUE'}
          </div>

          <h2>
            {simple
              ? 'Carte de mes observations'
              : 'Carte environnementale'}
          </h2>

          <p>
            {shown.length}
            {' '}
            observation(s) affichée(s)

            {!simple &&
              ` · ${points.length} point(s) de collecte`
            }
          </p>

        </div>


        <div className="filterChips">

          {[
            ['all', 'Toutes'],
            ['pending', 'À vérifier'],
            ['validated', 'Validés'],
            ['high', 'Priorité haute'],
            ['critical', 'Critiques']
          ].map(([value, label]) => (

            <button
              key={value}
              className={
                filter === value
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setFilter(value)
              }
            >
              {label}
            </button>

          ))}

        </div>

      </div>


      <div className="mapLegend">

        <span>
          <i className="legendDot warning"></i>
          À vérifier
        </span>

        <span>
          <i className="legendDot success"></i>
          Validé
        </span>

        <span>
          <i className="legendDot red"></i>
          Critique
        </span>

        {points.length > 0 && (
          <span>
            <i className="legendPin">
              ♻
            </i>
            Collecte
          </span>
        )}

      </div>


      <MapContainer
        center={[11.57, 42.95]}
        zoom={8}
        scrollWheelZoom
        className="leafmap"
      >

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />


        {shown.map(event => (

          <Marker
            key={`event-${event.id}`}
            position={[
              event.latitude,
              event.longitude
            ]}
            icon={defaultIcon}
          >

            <Popup>

              <strong>
                {categoryLabel(
                  event.category
                )}
              </strong>

              <br />

              {event.description ||
                'Sans description'}

              <br />

              Statut :
              {' '}
              {statusLabel(event.status)}

              <br />

              <button
                className="popupButton"
                onClick={() =>
                  onSelect?.(event)
                }
              >
                Ouvrir la fiche
              </button>

            </Popup>

          </Marker>

        ))}


        {points.map(point => (

          <Marker
            key={`point-${point.id}`}
            position={[
              point.latitude,
              point.longitude
            ]}
            icon={pointIcon}
          >

            <Popup>

              <strong>
                {point.name}
              </strong>

              <br />

              {point.city}

              <br />

              {point.point_type}
              {' · '}
              {point.status}

              <br />

              {point.info}

            </Popup>

          </Marker>

        ))}

      </MapContainer>

    </div>
  );
}


/* =========================================================
   EVENTS
========================================================= */

function Events({
  events,
  user,
  refresh,
  onSelect,
  mine = false
}) {

  const [q, setQ] =
    useState('');

  const [status, setStatus] =
    useState('all');

  const [priority, setPriority] =
    useState('all');

  const filtered =
    events.filter(event =>

      (
        !q ||
        `${event.description || ''} ${
          event.category || ''
        } ${
          event.region || ''
        }`
          .toLowerCase()
          .includes(q.toLowerCase())
      )

      &&

      (
        status === 'all' ||
        event.status === status
      )

      &&

      (
        priority === 'all' ||
        event.priority === priority
      )

    );


  return (
    <div className="panel">

      <div className="panelHead">

        <div>

          <h2>
            {mine
              ? 'Mes signalements'
              : 'Registre des signalements'}
          </h2>

          <span>
            {filtered.length}
            {' '}
            résultat(s)
          </span>

        </div>

        <button
          className="smallBtn"
          onClick={() =>
            window.dispatchEvent(
              new Event('focusReport')
            )
          }
        >
          + Nouveau
        </button>

      </div>


      <div className="filters">

        <input
          placeholder="Rechercher une observation…"
          value={q}
          onChange={e =>
            setQ(e.target.value)
          }
        />


        <select
          value={status}
          onChange={e =>
            setStatus(e.target.value)
          }
        >

          <option value="all">
            Tous les statuts
          </option>

          {Object.keys(STATUS).map(
            statusKey => (
              <option
                value={statusKey}
                key={statusKey}
              >
                {statusLabel(statusKey)}
              </option>
            )
          )}

        </select>


        <select
          value={priority}
          onChange={e =>
            setPriority(e.target.value)
          }
        >

          <option value="all">
            Toutes priorités
          </option>

          <option value="critical">
            Critique
          </option>

          <option value="high">
            Haute
          </option>

          <option value="medium">
            Normale
          </option>

          <option value="low">
            Faible
          </option>

        </select>

      </div>


      <div className="tableWrap">

        <table>

          <thead>

            <tr>
              <th>ID</th>
              <th>Observation</th>
              <th>Localisation</th>
              <th>Priorité</th>
              <th>Statut</th>
              <th>Date</th>
              <th></th>
            </tr>

          </thead>


          <tbody>

            {filtered.map(event => (

              <tr key={event.id}>

                <td>
                  #{event.id}
                </td>

                <td>

                  <b>
                    {categoryLabel(
                      event.category
                    )}
                  </b>

                  <small>
                    {event.description ||
                      'Sans description'}
                  </small>

                </td>

                <td>
                  {event.region ||
                    'GPS'}
                </td>

                <td>

                  <span
                    className={`priorityTag ${
                      event.priority
                    }`}
                  >
                    {priorityLabel(
                      event.priority
                    )}
                  </span>

                </td>

                <td>

                  <span
                    className={`badge ${
                      STATUS[event.status]?.[1] ||
                      ''
                    }`}
                  >
                    {statusLabel(
                      event.status
                    )}
                  </span>

                </td>

                <td>
                  {new Date(
                    event.created_at
                  ).toLocaleDateString(
                    'fr-FR'
                  )}
                </td>

                <td>

                  <button
                    className="iconButton"
                    onClick={() =>
                      onSelect?.(event)
                    }
                  >
                    Voir
                  </button>

                </td>

              </tr>

            ))}

          </tbody>

        </table>


        {!filtered.length && (
          <div className="empty">
            Aucun résultat correspondant
            aux filtres.
          </div>
        )}

      </div>

    </div>
  );
}


/* =========================================================
   VALIDATION
========================================================= */

function Validation({
  events,
  refresh,
  onSelect
}) {

  const list =
    events.filter(event =>
      ['pending', 'to_validate']
        .includes(event.status)
    );

  return (
    <WorkflowPanel
      title="Centre de validation"
      subtitle="Les observations nécessitant une décision humaine"
      events={list}
      actions={event => (
        <>
          <button
            onClick={() =>
              changeStatus(
                event.id,
                'validated',
                refresh
              )
            }
            className="approve"
          >
            ✓ Valider
          </button>

          <button
            onClick={() =>
              changeStatus(
                event.id,
                'rejected',
                refresh
              )
            }
            className="reject"
          >
            × Rejeter
          </button>
        </>
      )}
      onSelect={onSelect}
    />
  );
}


/* =========================================================
   PROCESSING
========================================================= */

function Processing({
  events,
  refresh,
  onSelect
}) {

  const list =
    events.filter(event =>
      ['validated', 'processed']
        .includes(event.status)
    );

  return (
    <WorkflowPanel
      title="Suivi opérationnel"
      subtitle="Piloter les observations validées jusqu’à leur clôture"
      events={list}
      actions={event =>
        event.status === 'validated'
          ? (
            <button
              onClick={() =>
                changeStatus(
                  event.id,
                  'processed',
                  refresh
                )
              }
              className="approve"
            >
              → Mettre en traitement
            </button>
          )
          : (
            <button
              onClick={() =>
                changeStatus(
                  event.id,
                  'closed',
                  refresh
                )
              }
              className="approve"
            >
              ✓ Clôturer
            </button>
          )
      }
      onSelect={onSelect}
    />
  );
}


async function changeStatus(
  id,
  status,
  refresh
) {

  try {

    await api(
      `/api/v1/events/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status
        })
      }
    );

    await refresh();

  } catch (error) {

    alert(error.message);

  }
}


/* =========================================================
   WORKFLOW PANEL
========================================================= */

function WorkflowPanel({
  title,
  subtitle,
  events,
  actions,
  onSelect
}) {

  return (
    <div className="panel">

      <div className="panelHead">

        <div>

          <h2>{title}</h2>

          <span>
            {subtitle}
          </span>

        </div>

        <div className="workflowCount">
          {events.length}
          {' '}
          dossier(s)
        </div>

      </div>


      {events.length ? (

        <div className="workflowList">

          {events.map(event => (

            <div
              className="workflowCard"
              key={event.id}
            >

              <div className="workflowTop">

                <span className="eventId">
                  ENVIA-
                  {String(event.id)
                    .padStart(4, '0')}
                </span>

                <span
                  className={`badge ${
                    STATUS[event.status]?.[1]
                  }`}
                >
                  {statusLabel(
                    event.status
                  )}
                </span>

              </div>


              <h3>
                {categoryLabel(
                  event.category
                )}
              </h3>


              <p>
                {event.description ||
                  'Sans description'}
              </p>


              <div className="workflowMeta">

                <span>
                  📍 {event.region ||
                    'Localisation GPS'}
                </span>

                <span>
                  ⚑ {priorityLabel(
                    event.priority
                  )}
                </span>

                <span>
                  ◷ {new Date(
                    event.created_at
                  ).toLocaleString(
                    'fr-FR'
                  )}
                </span>

              </div>


              <div className="workflowActions">

                <button
                  className="linkBtn"
                  onClick={() =>
                    onSelect?.(event)
                  }
                >
                  Voir le dossier
                </button>

                {actions(event)}

              </div>

            </div>

          ))}

        </div>

      ) : (

        <div className="empty">
          Aucun dossier dans cette étape.
        </div>

      )}

    </div>
  );
}


/* =========================================================
   EVENT MODAL
========================================================= */

function EventModal({
  event,
  user,
  onClose,
  refresh
}) {

  const canManage =
    ['admin', 'expert']
      .includes(user.role);

  const next =
    event.status === 'pending'
      ? 'to_validate'
      : event.status === 'to_validate'
        ? 'validated'
        : event.status === 'validated'
          ? 'processed'
          : event.status === 'processed'
            ? 'closed'
            : null;

  return (
    <div
      className="modalBackdrop"
      onClick={onClose}
    >

      <div
        className="modal"
        onClick={e =>
          e.stopPropagation()
        }
      >

        <button
          className="modalClose"
          onClick={onClose}
        >
          ×
        </button>


        <div className="modalHero">

          <div>

            <span className="eventId">
              ENVIA-
              {String(event.id)
                .padStart(4, '0')}
            </span>

            <h2>
              {categoryLabel(
                event.category
              )}
            </h2>

            <p>
              {event.description ||
                'Aucune description'}
            </p>

          </div>


          <span
            className={`badge ${
              STATUS[event.status]?.[1]
            }`}
          >
            {statusLabel(
              event.status
            )}
          </span>

        </div>


        <div className="detailGrid">

          <Detail
            label="Priorité"
            value={priorityLabel(
              event.priority
            )}
          />

          <Detail
            label="Région"
            value={
              event.region ||
              'Non renseignée'
            }
          />

          <Detail
            label="Source"
            value={
              event.source || '—'
            }
          />

          <Detail
            label="Rapporteur"
            value={
              event.reporter || '—'
            }
          />

          <Detail
            label="Latitude"
            value={event.latitude}
          />

          <Detail
            label="Longitude"
            value={event.longitude}
          />

        </div>


        <div className="timeline">

          <h3>
            Parcours du signalement
          </h3>


          {[
            'pending',
            'to_validate',
            'validated',
            'processed',
            'closed'
          ].map(
            (status, index) => (

              <div
                className={
                  event.status === status
                    ? 'timelineItem active'
                    : 'timelineItem'
                }
                key={status}
              >

                <i>
                  {index + 1}
                </i>

                <span>
                  {statusLabel(status)}
                </span>

              </div>

            )
          )}


          {event.status === 'rejected' && (
            <div className="timelineItem active">
              <i>×</i>
              <span>Rejeté</span>
            </div>
          )}

        </div>


        {canManage && (

          <div className="modalActions">

            {event.status === 'to_validate' && (
              <>
                <button
                  className="approve"
                  onClick={async () => {
                    await changeStatus(
                      event.id,
                      'validated',
                      refresh
                    );
                    onClose();
                  }}
                >
                  ✓ Valider
                </button>

                <button
                  className="reject"
                  onClick={async () => {
                    await changeStatus(
                      event.id,
                      'rejected',
                      refresh
                    );
                    onClose();
                  }}
                >
                  × Rejeter
                </button>
              </>
            )}


            {next === 'processed' && (
              <button
                className="approve"
                onClick={async () => {
                  await changeStatus(
                    event.id,
                    'processed',
                    refresh
                  );
                  onClose();
                }}
              >
                → Mettre en traitement
              </button>
            )}


            {next === 'closed' && (
              <button
                className="approve"
                onClick={async () => {
                  await changeStatus(
                    event.id,
                    'closed',
                    refresh
                  );
                  onClose();
                }}
              >
                ✓ Clôturer
              </button>
            )}


            {event.status === 'pending' && (
              <button
                className="secondary"
                onClick={async () => {
                  await changeStatus(
                    event.id,
                    'to_validate',
                    refresh
                  );
                  onClose();
                }}
              >
                Envoyer en validation
              </button>
            )}

          </div>

        )}

      </div>

    </div>
  );
}


function Detail({
  label,
  value
}) {

  return (
    <div className="detail">

      <small>{label}</small>

      <b>
        {String(value ?? '—')}
      </b>

    </div>
  );
}


/* =========================================================
   ALERTS
   Expert / Admin uniquement
========================================================= */

function Alerts({
  alerts,
  refresh
}) {

  return (
    <div className="panel">

      <PanelTitle
        title="Centre d’alertes"
        subtitle={`${
          alerts.filter(
            a => a.status === 'open'
          ).length
        } alerte(s) ouverte(s)`}
      />


      <div className="alertList">

        {!alerts.length ? (

          <div className="empty">
            Aucune alerte générée.
          </div>

        ) : (

          alerts.map(alert => (

            <div
              className={`alert ${alert.severity}`}
              key={alert.id}
            >

              <div className="alertIcon">
                !
              </div>


              <div className="grow">

                <div className="alertTop">

                  <strong>
                    {alert.title}
                  </strong>

                  <span>
                    {alert.severity === 'critical'
                      ? 'CRITIQUE'
                      : 'SURVEILLANCE'}
                  </span>

                </div>


                <p>
                  {alert.message}
                </p>

                <small>
                  {new Date(
                    alert.created_at
                  ).toLocaleString(
                    'fr-FR'
                  )}
                </small>

              </div>


              {alert.status === 'open' && (

                <button
                  className="secondary"
                  onClick={async () => {

                    await api(
                      `/api/v1/alerts/${alert.id}/close`,
                      {
                        method: 'PATCH'
                      }
                    );

                    await refresh();

                  }}
                >
                  Clôturer
                </button>

              )}

            </div>

          ))

        )}

      </div>

    </div>
  );
}


/* =========================================================
   STATS
========================================================= */

function Stats({
  stats,
  events
}) {

  const categories =
    Object.entries(
      stats?.by_category || {}
    );

  return (
    <div className="statsPage">

      <div className="statsHero">

        <div>

          <div className="eyebrow">
            ANALYSE NATIONALE
          </div>

          <h2>
            Les données ENVIA en un coup d’œil
          </h2>

          <p>
            Transformez les observations terrain
            en indicateurs lisibles pour orienter
            l’action.
          </p>

        </div>


        <div className="bigNumber">

          <b>
            {stats?.total ||
              events.length}
          </b>

          <span>
            signalements enregistrés
          </span>

        </div>

      </div>


      <div className="statsGrid">

        <div className="panel">

          <h2>
            Par catégorie
          </h2>

          {categories.map(
            ([key, value]) => (

              <Bar
                key={key}
                label={categoryLabel(key)}
                value={value}
                max={Math.max(
                  ...categories.map(
                    item => item[1]
                  ),
                  1
                )}
              />

            )
          )}

        </div>


        <div className="panel">

          <h2>
            Par statut
          </h2>

          {Object.entries(
            stats?.by_status || {}
          ).map(
            ([key, value]) => (

              <Bar
                key={key}
                label={statusLabel(key)}
                value={value}
                max={
                  stats?.total || 1
                }
              />

            )
          )}

        </div>


        <div className="panel">

          <h2>
            Priorités
          </h2>

          {Object.entries(
            stats?.by_priority || {}
          ).map(
            ([key, value]) => (

              <Bar
                key={key}
                label={priorityLabel(key)}
                value={value}
                max={
                  stats?.total || 1
                }
              />

            )
          )}

        </div>

      </div>


      <div className="panel">

        <h2>
          Indicateurs de traitement
        </h2>

        <div className="metricCards">

          <Metric
            label="En attente"
            value={
              events.filter(e =>
                ['pending', 'to_validate']
                  .includes(e.status)
              ).length
            }
          />

          <Metric
            label="Validés"
            value={
              events.filter(
                e =>
                  e.status === 'validated'
              ).length
            }
          />

          <Metric
            label="En traitement"
            value={
              events.filter(
                e =>
                  e.status === 'processed'
              ).length
            }
          />

          <Metric
            label="Clôturés"
            value={
              events.filter(
                e =>
                  e.status === 'closed'
              ).length
            }
          />

        </div>

      </div>

    </div>
  );
}


function Bar({
  label,
  value,
  max
}) {

  return (
    <div className="bar">

      <div>
        <span>{label}</span>
        <b>{value}</b>
      </div>

      <i
        style={{
          width: `${Math.max(
            4,
            (value / max) * 100
          )}%`
        }}
      ></i>

    </div>
  );
}


function Metric({
  label,
  value
}) {

  return (
    <div className="metric">

      <span>{label}</span>

      <b>{value}</b>

    </div>
  );
}


/* =========================================================
   AI
========================================================= */

function AIView({
  events
}) {

  /*
   * media est un tableau.
   * On utilise .length au lieu de Object.keys().
   */

  const withAi =
    events.filter(
      event =>
        Array.isArray(event.media)
          ? event.media.length > 0
          : event.media &&
            Object.keys(event.media).length > 0
    );

  return (
    <div className="aiPage">

      <div className="aiHero">

        <div className="aiOrb">
          ✦
        </div>

        <div>

          <div className="eyebrow">
            ENVIA INTELLIGENCE
          </div>

          <h2>
            Assistance à l’analyse environnementale
          </h2>

          <p>
            Classification, sous-catégorie,
            confiance et recommandations —
            toujours soumises à validation humaine.
          </p>

        </div>

      </div>


      <div className="aiCards">

        <div className="panel">

          <span className="aiMetricIcon">
            ✦
          </span>

          <b>
            Analyse descriptive
          </b>

          <p>
            Les observations textuelles
            peuvent être analysées avant
            leur enregistrement.
          </p>

        </div>


        <div className="panel">

          <span className="aiMetricIcon">
            ◌
          </span>

          <b>
            Classification
          </b>

          <p>
            Catégorie et sous-catégorie
            suggérées pour accélérer le tri.
          </p>

        </div>


        <div className="panel">

          <span className="aiMetricIcon">
            ✓
          </span>

          <b>
            Contrôle humain
          </b>

          <p>
            Aucune suggestion automatique
            ne remplace la décision de l’expert.
          </p>

        </div>

      </div>


      <div className="panel">

        <PanelTitle
          title="Dernières observations analysables"
          subtitle={`${withAi.length} dossier(s) avec médias`}
        />

        <EventList
          events={events.slice(0, 8)}
        />

      </div>

    </div>
  );
}


/* =========================================================
   TERRAIN ECOGARDE
========================================================= */

function Terrain({
  events,
  alerts,
  setView
}) {

  const mine = events;

  return (
    <div>

      <div className="terrainHero">

        <div>

          <div className="eyebrow">
            MODE TERRAIN
          </div>

          <h2>
            Observer vite. Documenter juste.
          </h2>

          <p>
            Un espace conçu pour les écogardes
            et les interventions sur le terrain.
          </p>

        </div>

        <button
          className="primary"
          onClick={() =>
            setView('report')
          }
        >
          + Nouvelle observation
        </button>

      </div>


      <div className="terrainGrid">

        <Metric
          label="Mes observations terrain"
          value={mine.length}
        />

        <Metric
          label="Priorités hautes"
          value={
            mine.filter(e =>
              ['high', 'critical']
                .includes(e.priority)
            ).length
          }
        />

        <Metric
          label="À suivre"
          value={
            mine.filter(e =>
              ['pending', 'to_validate']
                .includes(e.status)
            ).length
          }
        />

        <Metric
          label="Validées"
          value={
            mine.filter(
              e =>
                e.status === 'validated'
            ).length
          }
        />

      </div>


      <div className="panel">

        <PanelTitle
          title="Dernières observations terrain"
          subtitle="Activité écogarde"
        />

        <EventList
          events={mine.slice(0, 10)}
        />

      </div>

    </div>
  );
}


/* =========================================================
   MEDIA
========================================================= */

function MediaView({
  events
}) {

  const mediaEvents =
    events.filter(event =>
      Array.isArray(event.media)
        ? event.media.length > 0
        : event.media &&
          Object.keys(event.media).length > 0
    );

  return (
    <div className="panel">

      <PanelTitle
        title="Médias terrain"
        subtitle="Photos et éléments de preuve associés aux observations"
      />


      {mediaEvents.length ? (

        <div className="mediaGrid">

          {mediaEvents.map(event => (

            <div
              className="mediaCard"
              key={event.id}
            >

              <div className="mediaPlaceholder">
                ENVIA
                <br />
                <span>MEDIA</span>
              </div>

              <div>

                <b>
                  {categoryLabel(
                    event.category
                  )}
                </b>

                <small>
                  Signalement #{event.id}
                  {' · '}
                  {new Date(
                    event.created_at
                  ).toLocaleDateString(
                    'fr-FR'
                  )}
                </small>

              </div>

            </div>

          ))}

        </div>

      ) : (

        <div className="empty">
          Aucun média associé pour le moment.
        </div>

      )}

    </div>
  );
}


/* =========================================================
   USERS
========================================================= */

function UsersView({
  user
}) {

  return (
    <div className="panel">

      <PanelTitle
        title="Utilisateurs & rôles"
        subtitle="Vue d’administration des comptes ENVIA"
      />


      <div className="roleCards">

        <RoleCard
          role="Administrateur"
          desc="Supervision, configuration, utilisateurs et opérations."
          icon="◆"
        />

        <RoleCard
          role="Expert"
          desc="Validation, analyse, traitement et clôture."
          icon="✦"
        />

        <RoleCard
          role="Écogarde"
          desc="Observation terrain, médias et GPS."
          icon="⌁"
        />

        <RoleCard
          role="Citoyen"
          desc="Signalement et suivi de ses observations."
          icon="○"
        />

      </div>


      <div className="notice">

        Gestion complète des comptes :
        l’interface est préparée.
        Les endpoints utilisateurs dédiés
        pourront être ajoutés au backend
        dans une prochaine étape sans toucher
        aux données actuelles.

      </div>

    </div>
  );
}


function RoleCard({
  role,
  desc,
  icon
}) {

  return (
    <div className="roleCard">

      <div>{icon}</div>

      <b>{role}</b>

      <p>{desc}</p>

      <span>
        Permissions différenciées
      </span>

    </div>
  );
}


/* =========================================================
   COLLECTION
========================================================= */

function CollectionView({
  points
}) {

  return (
    <div className="panel">

      <PanelTitle
        title="Points de collecte"
        subtitle={`${points.length} point(s) référencé(s)`}
      />


      <div className="collectionGrid">

        {points.map(point => (

          <div
            className="collectionCard"
            key={point.id}
          >

            <div className="collectionIcon">
              ♻
            </div>

            <div>

              <b>{point.name}</b>

              <small>
                {point.city}
                {' · '}
                {point.point_type}
              </small>

              <p>
                {point.info ||
                  'Point de collecte environnemental'}
              </p>

            </div>

            <span className="statusPill">
              {point.status}
            </span>

          </div>

        ))}


        {!points.length && (
          <div className="empty">
            Aucun point de collecte.
          </div>
        )}

      </div>

    </div>
  );
}


/* =========================================================
   REPORTS
========================================================= */

function ReportsView({
  stats,
  events,
  alerts
}) {

  return (
    <div>

      <div className="reportsHero">

        <div>

          <div className="eyebrow">
            PILOTAGE
          </div>

          <h2>
            Rapports & indicateurs
          </h2>

          <p>
            Une synthèse opérationnelle
            de l’activité ENVIA.
          </p>

        </div>

        <button
          className="secondary"
          onClick={() =>
            window.print()
          }
        >
          Imprimer / PDF
        </button>

      </div>


      <div className="reportCards">

        <Metric
          label="Signalements"
          value={
            stats?.total ||
            events.length
          }
        />

        <Metric
          label="Alertes"
          value={alerts.length}
        />

        <Metric
          label="Validés"
          value={
            events.filter(
              e =>
                e.status === 'validated'
            ).length
          }
        />

        <Metric
          label="Clôturés"
          value={
            events.filter(
              e =>
                e.status === 'closed'
            ).length
          }
        />

      </div>


      <div className="panel">

        <h2>Résumé</h2>

        <p className="reportText">
          La plateforme ENVIA centralise
          les observations environnementales,
          leur localisation, leur priorité
          et leur progression dans le cycle
          de traitement. Ces indicateurs
          constituent une base de suivi
          opérationnel et doivent être
          interprétés avec le contexte terrain.
        </p>

      </div>

    </div>
  );
}


/* =========================================================
   SETTINGS
========================================================= */

function SettingsView() {

  return (
    <div className="settingsGrid">

      <div className="panel">

        <h2>
          Paramètres système
        </h2>

        <Setting
          label="Mode opérationnel"
          value="Actif"
        />

        <Setting
          label="API ENVIA"
          value="Connectée · localhost:8000"
        />

        <Setting
          label="Cartographie"
          value="OpenStreetMap"
        />

        <Setting
          label="Validation humaine"
          value="Obligatoire"
        />

      </div>


      <div className="panel">

        <h2>
          Principes ENVIA
        </h2>

        <div className="principle">

          <b>
            Traçabilité
          </b>

          <span>
            Chaque observation suit
            un cycle de traitement.
          </span>

        </div>


        <div className="principle">

          <b>
            Human-in-the-loop
          </b>

          <span>
            L’IA assiste mais ne décide pas seule.
          </span>

        </div>


        <div className="principle">

          <b>
            Données terrain
          </b>

          <span>
            GPS, médias et contexte renforcent
            la qualité des observations.
          </span>

        </div>

      </div>

    </div>
  );
}


function Setting({
  label,
  value
}) {

  return (
    <div className="setting">

      <span>{label}</span>

      <b>{value}</b>

    </div>
  );
}


/* =========================================================
   ACTIVITY
========================================================= */

function ActivityView({
  events,
  alerts
}) {

  const items = [
    ...events.map(event => ({
      date: event.created_at,
      title: `Signalement #${event.id}`,
      text:
        `${categoryLabel(event.category)} · ${
          statusLabel(event.status)
        }`
    })),

    ...alerts.map(alert => ({
      date: alert.created_at,
      title: alert.title,
      text: alert.message
    }))

  ]
    .sort(
      (a, b) =>
        new Date(b.date) -
        new Date(a.date)
    )
    .slice(0, 15);


  return (
    <div className="panel">

      <PanelTitle
        title="Journal d’activité"
        subtitle="Dernières opérations visibles"
      />


      {items.length ? (

        <div className="activityList">

          {items.map((item, index) => (

            <div
              className="activityItem"
              key={index}
            >

              <i></i>

              <div>

                <b>
                  {item.title}
                </b>

                <p>
                  {item.text}
                </p>

                <small>
                  {new Date(
                    item.date
                  ).toLocaleString(
                    'fr-FR'
                  )}
                </small>

              </div>

            </div>

          ))}

        </div>

      ) : (

        <div className="empty">
          Aucune activité.
        </div>

      )}

    </div>
  );
}


/* =========================================================
   CITIZEN NOTIFICATIONS
========================================================= */

function Notifications({
  events
}) {

  /*
   * IMPORTANT :
   * Il ne s'agit PLUS des alertes nationales.
   *
   * Le citoyen voit uniquement l'évolution
   * de SES signalements.
   */

  const items = events
    .filter(event =>
      [
        'validated',
        'rejected',
        'processed',
        'closed'
      ].includes(event.status)
    )
    .map(event => ({
      id: event.id,
      title:
        event.status === 'validated'
          ? 'Signalement validé'
          : event.status === 'rejected'
            ? 'Signalement rejeté'
            : event.status === 'processed'
              ? 'Signalement en traitement'
              : 'Signalement clôturé',

      text:
        `Votre signalement #${event.id} · ${
          categoryLabel(event.category)
        }`,

      date:
        event.updated_at ||
        event.created_at,

      status:
        event.status
    }))
    .sort(
      (a, b) =>
        new Date(b.date) -
        new Date(a.date)
    );


  return (
    <div className="panel">

      <PanelTitle
        title="Suivi de mes signalements"
        subtitle="Évolution de vos propres observations"
      />


      {items.length ? (

        items.map(item => (

          <div
            className="notification"
            key={item.id}
          >

            <div
              className={`notifIcon ${
                item.status === 'validated'
                  ? 'success'
                  : item.status === 'rejected'
                    ? 'danger'
                    : ''
              }`}
            >
              {item.status === 'validated'
                ? '✓'
                : item.status === 'rejected'
                  ? '×'
                  : '!'}
            </div>


            <div>

              <b>
                {item.title}
              </b>

              <p>
                {item.text}
              </p>

              <small>
                {new Date(
                  item.date
                ).toLocaleString(
                  'fr-FR'
                )}
              </small>

            </div>

          </div>

        ))

      ) : (

        <div className="empty">
          Aucun changement récent sur vos signalements.
        </div>

      )}

    </div>
  );
}


/* =========================================================
   PROFILE
========================================================= */

function Profile({
  user,
  avatar,
  onAvatarChange
}) {

  const [msg, setMsg] =
    useState('');


  const changePhoto = event => {

    const file =
      event.target.files?.[0];

    if (!file) return;


    if (!file.type.startsWith('image/')) {

      setMsg(
        'Choisissez une image.'
      );

      return;
    }


    if (file.size > 3 * 1024 * 1024) {

      setMsg(
        'Photo trop lourde. 3 Mo maximum.'
      );

      return;
    }


    const reader =
      new FileReader();

    reader.onload = () => {

      localStorage.setItem(
        avatarKey(user.username),
        reader.result
      );

      onAvatarChange(
        reader.result
      );

      setMsg(
        'Photo de profil mise à jour.'
      );
    };

    reader.readAsDataURL(file);
  };


  return (
    <div className="profilePage">

      <div className="profileHero">

        <div className="profileAvatar">

          {avatar ? (
            <img
              src={avatar}
              alt="Photo de profil"
            />
          ) : (
            (user.display_name || 'E')
              .slice(0, 1)
              .toUpperCase()
          )}

          <label className="avatarEdit">

            📷

            <input
              type="file"
              accept="image/*"
              onChange={changePhoto}
            />

          </label>

        </div>


        <div>

          <div className="eyebrow">
            COMPTE ENVIA
          </div>

          <h2>
            {user.display_name}
          </h2>

          <p>
            {roleLabel(user.role)}
          </p>

          <small className="profileHint">
            Ajoutez une photo pour
            personnaliser votre compte.
          </small>

          {msg && (
            <div className="profileMsg">
              {msg}
            </div>
          )}

        </div>

      </div>


      <div className="panel">

        <div className="detailGrid">

          <Detail
            label="Nom affiché"
            value={user.display_name}
          />

          <Detail
            label="Rôle"
            value={roleLabel(user.role)}
          />

          <Detail
            label="Identifiant"
            value={user.username}
          />

          <Detail
            label="Plateforme"
            value="ENVIA Djibouti"
          />

        </div>

      </div>


      <div className="panel profileSecurity">

        <h3>
          Identité ENVIA
        </h3>

        <p>
          La photo est conservée localement
          sur cet appareil dans cette première
          version. La synchronisation serveur
          pourra être ajoutée avec le profil
          utilisateur du backend.
        </p>

      </div>

    </div>
  );
}


/* =========================================================
   ROOT
========================================================= */

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('ENVIA interface:', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div style={{padding:40,fontFamily:'Arial,sans-serif',maxWidth:750,margin:'60px auto'}}><h1>ENVIA — erreur d'affichage</h1><p>L'interface a rencontré une erreur. Vous pouvez réinitialiser la session locale sans effacer les données du serveur.</p><pre style={{whiteSpace:'pre-wrap',background:'#f5f5f5',padding:16}}>{String(this.state.error.message)}</pre><button onClick={() => { localStorage.removeItem('envia_user'); localStorage.removeItem('envia_token'); window.location.reload(); }} style={{padding:14,cursor:'pointer'}}>Réinitialiser la session</button></div>;
  }
}
createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);