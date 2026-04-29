import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { supabase, isSupabaseConfigured } from './supabase.js';
import { CardForm } from './components/CardForm.jsx';
import { CardList } from './components/CardList.jsx';
import { CardFilters } from './components/CardFilters.jsx';
import { RunList } from './components/RunList.jsx';
import { Toast } from './components/Toast.jsx';

function AuthBarrier({ error }) {
  async function signInWithGoogle() {
    if (!supabase) return;
    const configuredRedirect = import.meta.env.VITE_SUPABASE_REDIRECT_URL;
    const redirectTo = configuredRedirect || window.location.origin;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if (oauthError) {
      // eslint-disable-next-line no-console
      console.error(oauthError);
    }
  }

  return (
    <div className="container">
      <div className="panel">
        <h1>Ragingester</h1>
        <div className="meta">Sign in with Google to access card management.</div>
        {!isSupabaseConfigured && (
          <div className="meta" style={{ marginTop: 12 }}>
            Missing `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`.
          </div>
        )}
        {error && <div className="meta" style={{ marginTop: 12 }}>Error: {error}</div>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" onClick={signInWithGoogle} disabled={!isSupabaseConfigured}>
            Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}

function CardsWorkspace({ auth, userEmail, onSignOut }) {
  const [cards, setCards] = useState([]);
  const [runs, setRuns] = useState([]);
  const [preview, setPreview] = useState(null);
  const [selectedCardId, setSelectedCardId] = useState('');
  const [editingCard, setEditingCard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [filters, setFilters] = useState({ jobType: 'all', jobName: '' });
  const [viewMode, setViewMode] = useState('grid');

  async function refreshCards() {
    const nextCards = await api.listCards(auth);
    setCards(nextCards);
  }

  async function refreshRuns(cardId) {
    if (!cardId) return;
    const [runRows, previewData] = await Promise.all([
      api.listRuns(auth, cardId),
      api.schedulePreview(auth, cardId).catch(() => null)
    ]);
    setRuns(runRows);
    setPreview(previewData);
  }

  useEffect(() => {
    refreshCards().catch((err) => setError(err.message));
  }, [auth.token]);

  async function handleCreate(payload) {
    setLoading(true);
    try {
      await api.createCard(auth, payload);
      await refreshCards();
      setToast('Card created successfully!');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate(payload) {
    if (!editingCard) return;
    setLoading(true);
    try {
      await api.updateCard(auth, editingCard.id, payload);
      setEditingCard(null);
      await refreshCards();
      if (selectedCardId === editingCard.id) {
        await refreshRuns(editingCard.id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRun(cardId) {
    setError('');
    try {
      await api.runCard(auth, cardId);
      await refreshCards();
      if (selectedCardId === cardId) {
        await refreshRuns(cardId);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(cardId) {
    setError('');
    try {
      await api.deleteCard(auth, cardId);
      if (selectedCardId === cardId) {
        setSelectedCardId('');
        setRuns([]);
        setPreview(null);
      }
      await refreshCards();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeactivate(cardId) {
    setError('');
    try {
      await api.updateCard(auth, cardId, { active: false });
      await refreshCards();
      if (selectedCardId === cardId) {
        await refreshRuns(cardId);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSelect(cardId) {
    setSelectedCardId(cardId);
    try {
      await refreshRuns(cardId);
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredCards = useMemo(() => {
    const nameNeedle = filters.jobName.trim().toLowerCase();
    return cards.filter((card) => {
      const typeMatch = filters.jobType === 'all' || card.source_type === filters.jobType;
      const jobName = String(card.params?.job_name || '').toLowerCase();
      const sourceName = String(card.source_input || '').toLowerCase();
      const nameMatch = !nameNeedle || jobName.includes(nameNeedle) || sourceName.includes(nameNeedle);
      return typeMatch && nameMatch;
    });
  }, [cards, filters]);

  return (
    <div className="container">
      <div className="panel">
        <h1>Ragingester</h1>
        <div className="meta">Card-based data collection with per-source cron schedules</div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <div className="meta">Signed in as: {userEmail || auth.userId}</div>
          <button className="secondary" type="button" onClick={onSignOut}>Sign out</button>
        </div>
        {error && <div className="meta" style={{ marginTop: 8 }}>Error: {error}</div>}
      </div>

      <CardForm onSubmit={handleCreate} loading={loading} />
      {editingCard && (
        <CardForm
          mode="edit"
          initialCard={editingCard}
          onSubmit={handleUpdate}
          onCancel={() => setEditingCard(null)}
          loading={loading}
        />
      )}
      <CardFilters filters={filters} onChange={setFilters} viewMode={viewMode} onViewModeChange={setViewMode} />
      <div className="content-grid">
        <CardList
          cards={filteredCards}
          onRun={handleRun}
          onDelete={handleDelete}
          onDeactivate={handleDeactivate}
          onSelect={handleSelect}
          onEdit={setEditingCard}
          selectedId={selectedCardId}
          viewMode={viewMode}
        />
        <RunList runs={runs} preview={preview} />
      </div>
      <Toast message={toast} onHide={() => setToast('')} />
    </div>
  );
}

export function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [auth, setAuth] = useState({ token: '', userId: '' });
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    let mounted = true;

    async function init() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;
      if (error) {
        setAuthError(error.message);
        setAuthLoading(false);
        return;
      }

      const session = data.session;
      if (session) {
        setAuth({ token: session.access_token, userId: session.user?.id || '' });
        setUserEmail(session.user?.email || '');
      }
      setAuthLoading(false);
    }

    init().catch((error) => {
      if (mounted) {
        setAuthError(error instanceof Error ? error.message : String(error));
        setAuthLoading(false);
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      if (session) {
        setAuth({ token: session.access_token, userId: session.user?.id || '' });
        setUserEmail(session.user?.email || '');
      } else {
        setAuth({ token: '', userId: '' });
        setUserEmail('');
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  if (authLoading) {
    return (
      <div className="container">
        <div className="panel">
          <h1>Ragingester</h1>
          <div className="meta">Loading authentication...</div>
        </div>
      </div>
    );
  }

  if (!auth.token) {
    return <AuthBarrier error={authError} />;
  }

  return <CardsWorkspace auth={auth} userEmail={userEmail} onSignOut={signOut} />;
}
