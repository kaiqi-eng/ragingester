import React from 'react';

export function StatusPill({ active, label }) {
    const activeStyle = {
        display: 'inline-block',
        backgroundColor: '#064e3b',
        color: '#34d399',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px'
    };

    const inactiveStyle = {
        display: 'inline-block',
        backgroundColor: '#333333',
        color: '#888888',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px'
    };

    return (
        <span style={active ? activeStyle : inactiveStyle}>
            {label || (active ? 'Active' : 'Inactive')}
        </span>
    );
}
