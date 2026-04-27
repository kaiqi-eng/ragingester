import React from 'react';

export function CardDetailsModal({ card, onClose }) {
    if (!card) return null;

    const displayParams = typeof card.params === 'string'
        ? card.params
        : JSON.stringify(card.params, null, 2);

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
        }}>
            <div style={{
                backgroundColor: '#1c1c1c',
                border: '1px solid #333333',
                borderRadius: '8px',
                padding: '24px',
                width: '90%',
                maxWidth: '500px',
                maxHeight: '90vh',
                overflowY: 'auto'
            }}>
                <h2 style={{ marginTop: 0, marginBottom: '16px' }}>Card Details</h2>

                <div className="meta" style={{ marginBottom: '16px' }}>
                    <strong style={{ color: '#ededed' }}>Source URL:</strong><br />
                    <div style={{ marginTop: '4px', wordBreak: 'break-all' }}>{card.source_input}</div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                    <strong className="meta" style={{ color: '#ededed' }}>Params (JSON):</strong>
                    <pre style={{
                        backgroundColor: '#000000',
                        padding: '12px',
                        borderRadius: '4px',
                        overflowX: 'auto',
                        color: '#ededed',
                        fontSize: '13px',
                        marginTop: '8px',
                        border: '1px solid #333333'
                    }}>
                        {displayParams || '{}'}
                    </pre>
                </div>

                <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="secondary" type="button" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
