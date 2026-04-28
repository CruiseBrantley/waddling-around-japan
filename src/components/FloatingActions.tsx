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
          aria-label="Jump to Current Activity"
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
  const progress = isImminent ? (nextEvent.minutes / 5) * 100 : 0;

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
          {/* High-Precision Shrinking Countdown */}
          <svg className="pill-progress-svg" preserveAspectRatio="none" style={{ opacity: isImminent ? 1 : 0 }}>
            <defs>
              <mask id="progress-mask">
                <rect 
                  x="0" y="0" width="100%" height="100%" 
                  rx="20" ry="20"
                  pathLength="100"
                  fill="none"
                  stroke="white"
                  strokeWidth="6"
                  style={{ 
                    strokeDasharray: `${progress} 100`,
                    strokeDashoffset: 0,
                    vectorEffect: 'non-scaling-stroke'
                  } as React.CSSProperties}
                  className="mask-rect"
                />
              </mask>
            </defs>
            
            {/* Background Track */}
            <rect 
              x="0" y="0" width="100%" height="100%" 
              rx="20" ry="20"
              pathLength="100"
              className="pill-progress-track"
              style={{ vectorEffect: 'non-scaling-stroke' } as React.CSSProperties}
            />

            {/* Active Progress */}
            <rect 
              x="0" y="0" width="100%" height="100%" 
              rx="20" ry="20"
              pathLength="100"
              className="pill-progress-rect"
              style={{ 
                strokeDasharray: `${progress} 100`,
                strokeDashoffset: 0,
                vectorEffect: 'non-scaling-stroke'
              } as React.CSSProperties}
            />

            {/* Traveling Pulse (Masked) */}
            <rect 
              x="0" y="0" width="100%" height="100%" 
              rx="20" ry="20"
              pathLength="100"
              mask="url(#progress-mask)"
              className="pill-progress-pulse"
              style={{ 
                vectorEffect: 'non-scaling-stroke',
                '--progress-raw': progress 
              } as React.CSSProperties}
            />
          </svg>

          <span className="upcoming-label">NEXT: {nextEvent.title}</span>
          <span className="upcoming-time">
            {isImminent 
              ? (nextEvent.minutes < 1 
                  ? `in ${Math.max(1, Math.round(nextEvent.minutes * 60))}s`
                  : `in ${Math.ceil(nextEvent.minutes)}m`)
              : (nextEvent.minutes >= 60 
                  ? `in ${Math.floor(nextEvent.minutes / 60)}h ${Math.floor(nextEvent.minutes % 60)}m` 
                  : `in ${Math.floor(nextEvent.minutes)}m`)}
          </span>
        </button>
      </div>
    </div>
  );
};
