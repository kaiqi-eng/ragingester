const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function authHeaders(auth) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  } else if (auth.userId) {
    headers['x-user-id'] = auth.userId;
  }
  return headers;
}

async function handle(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `request failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  async listCards(auth) {
    return handle(await fetch(`${API_BASE}/cards`, { headers: authHeaders(auth) }));
  },

  async createCard(auth, payload) {
    return handle(await fetch(`${API_BASE}/cards`, { method: 'POST', headers: authHeaders(auth), body: JSON.stringify(payload) }));
  },

  async updateCard(auth, id, payload) {
    return handle(await fetch(`${API_BASE}/cards/${id}`, { method: 'PATCH', headers: authHeaders(auth), body: JSON.stringify(payload) }));
  },

  async deleteCard(auth, id) {
    return handle(await fetch(`${API_BASE}/cards/${id}`, { method: 'DELETE', headers: authHeaders(auth) }));
  },

  async bulkDeactivateCards(auth, ids) {
    return handle(await fetch(`${API_BASE}/cards/bulk/deactivate`, {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify({ ids })
    }));
  },

  async bulkDeleteCards(auth, ids) {
    return handle(await fetch(`${API_BASE}/cards/bulk/delete`, {
      method: 'POST',
      headers: authHeaders(auth),
      body: JSON.stringify({ ids })
    }));
  },

  async runCard(auth, id) {
    return handle(await fetch(`${API_BASE}/cards/${id}/run`, { method: 'POST', headers: authHeaders(auth) }));
  },

  async scheduleStressTest(auth) {
    return handle(await fetch(`${API_BASE}/cards/stress-test/schedule`, { method: 'POST', headers: authHeaders(auth) }));
  },

  async listRuns(auth, cardId) {
    return handle(await fetch(`${API_BASE}/cards/${cardId}/runs`, { headers: authHeaders(auth) }));
  },

  async listAllRuns(auth) {
    return handle(await fetch(`${API_BASE}/runs`, { headers: authHeaders(auth) }));
  },

  async clearRuns(auth, cardId) {
    return handle(await fetch(`${API_BASE}/cards/${cardId}/runs`, { method: 'DELETE', headers: authHeaders(auth) }));
  },

  async schedulePreview(auth, cardId) {
    return handle(await fetch(`${API_BASE}/cards/${cardId}/schedule/preview`, { headers: authHeaders(auth) }));
  },

  async exportCardsCsv(auth) {
    const response = await fetch(`${API_BASE}/cards/export.csv`, { headers: authHeaders(auth) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `request failed: ${response.status}`);
    }
    return response.text();
  },

  async importCardsCsv(auth, csvText) {
    return handle(await fetch(`${API_BASE}/cards/import.csv`, {
      method: 'POST',
      headers: {
        ...authHeaders(auth),
        'Content-Type': 'text/csv'
      },
      body: csvText
    }));
  }
};
