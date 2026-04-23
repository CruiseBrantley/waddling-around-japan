import React from 'react';
import { ItineraryDay } from '../services/sheets';

interface DaySelectorProps {
  days: ItineraryDay[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  searchTerm: string;
}

export const DaySelector: React.FC<DaySelectorProps> = ({ days, selectedIndex, onSelect, searchTerm }) => {
  return (
    <nav className="day-selector glass">
      <div className="day-scroll-container">
        {days.map((day, idx) => {
          const dateParts = day.date.split(', ');
          const dayName = dateParts[0]?.toUpperCase() || '';
          const dayMonth = dateParts[1]?.split('/') || [];
          const dayShort = dayMonth[1] || '';

          // Global search matching for this day
          const hasMatch = searchTerm.trim() && day.activities.some(act => 
            act.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
            act.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
            act.notes.toLowerCase().includes(searchTerm.toLowerCase())
          );

          return (
            <button
              key={day.day}
              data-index={idx}
              className={`day-btn ${selectedIndex === idx ? 'active' : ''}`}
              onClick={() => onSelect(idx)}
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
