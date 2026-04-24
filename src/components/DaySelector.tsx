import React from 'react';
import type { ItineraryDay } from '../services/sheets';

interface DaySelectorProps {
  days: ItineraryDay[];
  searchTerm: string;
  activeIndex: number;
  onDayClick: (index: number) => void;
}

const DaySelectorComponent = React.forwardRef<HTMLDivElement, DaySelectorProps>(({ 
  days, 
  searchTerm,
  activeIndex,
  onDayClick
}, ref) => {
  const [paddingX, setPaddingX] = React.useState(0);

  // Calculate padding to allow items to be centered
  React.useEffect(() => {
    const updatePadding = () => {
      if (ref && typeof ref === 'object' && 'current' in ref) {
        // Only apply horizontal centering padding on mobile/tablet
        if (window.innerWidth < 1024) {
          const pad = (ref.current?.clientWidth || 0) / 2 - 32;
          setPaddingX(pad);
        } else {
          setPaddingX(0);
        }
      }
    };
    
    updatePadding();
    window.addEventListener('resize', updatePadding);
    return () => window.removeEventListener('resize', updatePadding);
  }, [ref]);

  return (
    <nav className="day-selector glass" style={{ overflow: 'hidden' }}>
      <div className="day-selector-center-track">
        <div className="day-selector-highlight fixed-center" />
      </div>

      <div 
        className="day-scroll-container" 
        ref={ref}
        style={{ 
          paddingLeft: `${paddingX}px`, 
          paddingRight: `${paddingX}px`
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
            <div
              key={day.day}
              data-index={idx}
              className={`day-btn ${activeIndex === idx ? 'is-active' : ''}`}
              style={{ zIndex: 1 }}
              onClick={() => onDayClick(idx)}
            >
              <span className="day-label">{dayName}</span>
              <span className="day-num">{dayShort}</span>
              {hasMatch && <div className="match-indicator"></div>}
            </div>
          )
        })}
      </div>
    </nav>
  );
});

DaySelectorComponent.displayName = 'DaySelector';
export const DaySelector = DaySelectorComponent;
