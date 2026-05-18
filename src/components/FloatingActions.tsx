import React from 'react';
import { triggerHaptic } from '../utils/native';

interface FloatingActionsProps {
  isTripActive: boolean;
  nextEvent: { title: string; minutes: number; isLive?: boolean } | null;
  isLiveCardInView: boolean;
  jumpToNow: () => void;
}

export const FloatingActions: React.FC<FloatingActionsProps> = ({
  isTripActive,
  nextEvent,
  isLiveCardInView,
  jumpToNow
}) => {
  if (!isTripActive) return null;

  if (!nextEvent) {
    if (isLiveCardInView) return null;
    return (
      <div className="floating-actions">
        <button 
          className="jump-to-now-btn fade-in"
          onClick={jumpToNow}
          aria-label="Jump to Current Event"
          style={{
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(255,51,102,0.3)',
            cursor: 'pointer'
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        </button>
      </div>
    );
  }

  const isImminent = nextEvent && nextEvent.minutes <= 5 && nextEvent.minutes > 0;

  return (
    <div className="floating-actions">
      <div className="upcoming-pill-wrapper">
        <div className={`upcoming-pill-glow ${!isLiveCardInView ? 'visible' : ''}`} />
        <button 
          className={`upcoming-pill glass fade-in ${!isLiveCardInView ? 'is-navigation-hint' : ''}`}
          onClick={() => {
            triggerHaptic('light');
            jumpToNow();
          }}
        >
          <span className="upcoming-label">{nextEvent.isLive ? 'LIVE NOW' : 'NEXT'}: {nextEvent.title}</span>
          <span className="upcoming-time">
            {nextEvent.isLive 
              ? 'Ongoing'
              : (isImminent 
                  ? (nextEvent.minutes < 1 
                      ? `in ${Math.max(1, Math.round(nextEvent.minutes * 60))}s`
                      : `in ${Math.ceil(nextEvent.minutes)}m`)
                  : (nextEvent.minutes >= 60 
                      ? `in ${Math.floor(nextEvent.minutes / 60)}h ${Math.floor(nextEvent.minutes % 60)}m` 
                      : `in ${Math.floor(nextEvent.minutes)}m`))}
          </span>
        </button>
      </div>
    </div>
  );
};
