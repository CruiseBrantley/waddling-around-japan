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

  // Desktop sidebar sync: ensures the active day button is always visible in the sidebar
  React.useEffect(() => {
    if (ref && typeof ref === 'object' && 'current' in ref && ref.current) {
      if (window.innerWidth >= 1024) {
        const activeBtn = ref.current.querySelector('.day-btn.is-active');
        if (activeBtn) {
          activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }, [activeIndex, ref]);

  return (
    <nav className="day-selector glass">
      <div className="day-selector-center-track">
        <div className="day-selector-highlight fixed-center" />
      </div>

      <div 
        className="day-scroll-container" 
        ref={ref}
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
              onClick={(e) => {
                e.preventDefault();
                onDayClick(idx);
              }}
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
