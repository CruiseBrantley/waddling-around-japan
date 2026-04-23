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
  selectedIndex, 
  onSelect, 
  searchTerm,
  scrollProgress 
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll the day selector to keep the active day in view
  React.useEffect(() => {
    if (containerRef.current) {
      const activeBtn = containerRef.current.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
      if (activeBtn) {
        containerRef.current.scrollTo({
          left: activeBtn.offsetLeft - (containerRef.current.clientWidth / 2) + (activeBtn.offsetWidth / 2),
          behavior: 'smooth'
        });
      }
    }
  }, [selectedIndex]);

  return (
    <nav className="day-selector glass">
      <div className="day-scroll-container" ref={containerRef} style={{ position: 'relative' }}>
        {/* The sliding highlight */}
        <div 
          className="day-selector-highlight" 
          style={{ 
            transform: `translateX(${scrollProgress * 76}px)`,
          }}
        />

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
