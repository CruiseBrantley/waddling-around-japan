import React from 'react';
import type { ItineraryDay } from '../services/sheets';

interface DaySelectorProps {
  days: ItineraryDay[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  searchTerm: string;
  scrollProgress: number;
}

export const DaySelector: React.FC<DaySelectorProps> = ({ 
  days, 
  onSelect, 
  searchTerm,
  scrollProgress 
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const isUserScrolling = React.useRef(false);
  const [paddingX, setPaddingX] = React.useState(0);

  // Calculate padding to allow items to be centered
  React.useEffect(() => {
    const updatePadding = () => {
      if (containerRef.current) {
        const pad = (containerRef.current.clientWidth / 2) - 32;
        setPaddingX(pad);
      }
    };
    
    updatePadding();
    window.addEventListener('resize', updatePadding);
    return () => window.removeEventListener('resize', updatePadding);
  }, []);

  // Sync Top -> Bottom (When user scrolls the DaySelector)
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let scrollTimeout: number;
    const onScroll = () => {
      if (!isUserScrolling.current) return;
      
      window.clearTimeout(scrollTimeout);
      scrollTimeout = window.setTimeout(() => {
        const index = Math.round(container.scrollLeft / 76);
        if (index >= 0 && index < days.length) {
          onSelect(index);
        }
      }, 100);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      window.clearTimeout(scrollTimeout);
    };
  }, [days.length, onSelect]);

  // Sync Bottom -> Top (When carousel moves)
  React.useLayoutEffect(() => {
    if (containerRef.current && !isUserScrolling.current) {
      containerRef.current.scrollLeft = scrollProgress * 76;
    }
  }, [scrollProgress]);

  return (
    <nav className="day-selector glass" style={{ overflow: 'hidden' }}>
      <div className="day-selector-center-track">
        <div className="day-selector-highlight fixed-center" />
      </div>

      <div 
        className="day-scroll-container" 
        ref={containerRef} 
        onTouchStart={() => { isUserScrolling.current = true; }}
        onTouchEnd={() => { 
          // Longer lockout to allow the bottom carousel to settle
          setTimeout(() => { isUserScrolling.current = false; }, 1000); 
        }}
        onMouseDown={() => { isUserScrolling.current = true; }}
        onMouseUp={() => { 
          setTimeout(() => { isUserScrolling.current = false; }, 1000); 
        }}
        style={{ 
          paddingLeft: `${paddingX}px`, 
          paddingRight: `${paddingX}px`,
          pointerEvents: 'auto'
        }}
      >
        {days.map((day, idx) => {
          const dateParts = day.date.split(', ');
          const dayName = dateParts[0]?.toUpperCase() || '';
          const dayMonth = dateParts[1]?.split('/') || [];
          const dayShort = dayMonth[1] || '';

          const hasMatch = searchTerm.trim() && day.activities.some(act => 
            act.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            act.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
            act.notes.toLowerCase().includes(searchTerm.toLowerCase())
          );

          return (
            <button
              key={day.day}
              data-index={idx}
              className={`day-btn ${Math.round(scrollProgress) === idx ? 'is-active' : ''}`}
              onClick={() => onSelect(idx)}
              style={{ zIndex: 1 }}
            >
              <span className="day-label">{dayName}</span>
              <span className="day-num">{dayShort}</span>
              {hasMatch && <div className="match-indicator"></div>}
            </button>
          )
        })}
      </div>
    </nav>
  );
};
