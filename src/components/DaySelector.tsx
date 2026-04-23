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
  const [paddingX, setPaddingX] = React.useState(0);

  // Calculate padding to allow items to be centered
  React.useEffect(() => {
    const updatePadding = () => {
      if (containerRef.current) {
        // (viewport width / 2) - (button width / 2)
        const pad = (containerRef.current.clientWidth / 2) - 32;
        setPaddingX(pad);
      }
    };
    
    updatePadding();
    window.addEventListener('resize', updatePadding);
    return () => window.removeEventListener('resize', updatePadding);
  }, []);

  // Real-time synchronization of the day selector scroll with the carousel progress
  React.useLayoutEffect(() => {
    if (containerRef.current) {
      // Current progress * step (64 width + 12 gap)
      containerRef.current.scrollLeft = scrollProgress * 76;
    }
  }, [scrollProgress]);

  return (
    <nav className="day-selector glass" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Fixed central highlight */}
      <div className="day-selector-center-track">
        <div className="day-selector-highlight fixed-center" />
      </div>

      <div 
        className="day-scroll-container" 
        ref={containerRef} 
        style={{ 
          paddingLeft: `${paddingX}px`, 
          paddingRight: `${paddingX}px`,
          scrollSnapType: 'none', // Disable internal snapping to follow carousel perfectly
          pointerEvents: 'auto' // Allow clicks
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
