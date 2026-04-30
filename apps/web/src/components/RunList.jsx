import React from 'react';

export function RunList({ runs, preview, onClear, clearDisabled }) {
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginBottom: 0 }}>Run History</h2>
        <button className="secondary" type="button" onClick={onClear} disabled={clearDisabled}>
          Clear run history
        </button>
      </div>
      {preview?.next_runs?.length > 0 && (
        <div className="meta">Next scheduled runs: {preview.next_runs.join(', ')}</div>
      )}
      {runs.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          color: '#888888',
          border: '1px dashed #333333',
          borderRadius: '6px',
          marginTop: '16px'
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.6 }}>📊</div>
          <div>No runs yet.</div>
        </div>
      )}
      {runs.map((run) => (
        <div key={run.id} className="card-item">
          <div><strong>{run.status}</strong> ({run.trigger_mode})</div>
          <div className="meta">started: {run.started_at || 'n/a'} | ended: {run.ended_at || 'n/a'}</div>
          <div className="meta">attempts: {run.attempts || 0}</div>
          {run.error && <div className="meta">error: {run.error}</div>}
        </div>
      ))}
    </div>
  );
}
