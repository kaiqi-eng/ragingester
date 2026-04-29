import React, { useState } from 'react';
import { StatusPill } from './StatusPill';
import { CardDetailsModal } from './CardDetailsModal';

export function CardList({ cards, onRun, onDelete, onToggleActive, onSelect, onEdit, selectedId, viewMode }) {
  const [detailsCard, setDetailsCard] = useState(null);
  return (
    <div className="panel">
      <h2>Cards</h2>
      {cards.length === 0 && (
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
          <div style={{ fontSize: '24px', marginBottom: '8px', opacity: 0.6 }}>📥</div>
          <div>No cards yet.</div>
        </div>
      )}
      {viewMode === 'list' && cards.length > 0 && (
        <div style={{ width: '100%', overflowX: 'auto', marginTop: '16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr>
                <th style={{ padding: '12px 8px', borderBottom: '1px solid #333333', color: '#888888', fontWeight: 500 }}>Source Type</th>
                <th style={{ padding: '12px 8px', borderBottom: '1px solid #333333', color: '#888888', fontWeight: 500 }}>Job Name</th>
                <th style={{ padding: '12px 8px', borderBottom: '1px solid #333333', color: '#888888', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '12px 8px', borderBottom: '1px solid #333333', color: '#888888', fontWeight: 500, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((card) => (
                <tr
                  key={card.id}
                  style={{ borderBottom: '1px solid #333333', transition: 'background-color 0.2s' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1c1c1c'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <td style={{ padding: '12px 8px' }}><strong>{card.source_type}</strong></td>
                  <td style={{ padding: '12px 8px' }}>{card.params?.job_name || 'unnamed'}</td>
                  <td style={{ padding: '12px 8px' }}><StatusPill active={card.active} label={card.active ? 'Active' : 'Inactive'} /></td>
                  <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button className="secondary" style={{ padding: '6px 12px', fontSize: '13px' }} type="button" onClick={() => setDetailsCard(card)}>View Details</button>
                      <button type="button" style={{ padding: '6px 12px', fontSize: '13px' }} onClick={() => onRun(card.id)}>Run</button>
                      <button
                        className="secondary"
                        style={{ padding: '6px 12px', fontSize: '13px' }}
                        type="button"
                        onClick={() => onToggleActive(card.id, !card.active)}
                      >
                        {card.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="secondary" style={{ padding: '6px 12px', fontSize: '13px' }} type="button" onClick={() => onEdit(card)}>Edit</button>
                      <button className="secondary" style={{ padding: '6px 12px', fontSize: '13px' }} type="button" onClick={() => onSelect(card.id)}>{selectedId === card.id ? 'Selected' : 'Runs'}</button>
                      <button className="secondary" style={{ padding: '6px 12px', fontSize: '13px' }} type="button" onClick={() => onDelete(card.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {viewMode !== 'list' && cards.map((card) => (
        <div key={card.id} className="card-item">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <strong>{card.source_type}</strong>
              <div><strong>job:</strong> {card.params?.job_name || 'unnamed'}</div>
              <div className="meta" style={{ marginTop: '4px' }}>
                <StatusPill active={card.active} label={card.active ? 'Active' : 'Inactive'} />
              </div>
            </div>
            <button className="secondary" type="button" onClick={() => setDetailsCard(card)}>
              View Details
            </button>
          </div>

          <div className="row" style={{ marginTop: '16px' }}>
            <button type="button" onClick={() => onRun(card.id)}>Run now</button>
            <button className="secondary" type="button" onClick={() => onToggleActive(card.id, !card.active)}>
              {card.active ? 'Deactivate' : 'Activate'}
            </button>
            <button className="secondary" type="button" onClick={() => onEdit(card)}>
              Edit
            </button>
            <button className="secondary" type="button" onClick={() => onSelect(card.id)}>
              {selectedId === card.id ? 'Selected' : 'View runs'}
            </button>
            <button className="secondary" type="button" onClick={() => onDelete(card.id)}>Delete</button>
          </div>
        </div>
      ))}
      {detailsCard && <CardDetailsModal card={detailsCard} onClose={() => setDetailsCard(null)} />}
    </div>
  );
}
