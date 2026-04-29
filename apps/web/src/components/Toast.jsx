import React, { useEffect, useState } from 'react';

export function Toast({ message, onHide }) {
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (message) {
            setVisible(true);
            const fadeTimer = setTimeout(() => {
                setVisible(false);
            }, 2700);

            const removeTimer = setTimeout(() => {
                if (onHide) onHide();
            }, 3000);

            return () => {
                clearTimeout(fadeTimer);
                clearTimeout(removeTimer);
            };
        }
    }, [message, onHide]);

    if (!message) return null;

    return (
        <div style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#1c1c1c',
            color: '#ffffff',
            padding: '12px 20px',
            borderRadius: '6px',
            borderLeft: '4px solid #34d399',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
            zIndex: 9999,
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out',
            pointerEvents: visible ? 'auto' : 'none',
            fontWeight: 500,
            fontSize: '14px'
        }}>
            {message}
        </div>
    );
}
