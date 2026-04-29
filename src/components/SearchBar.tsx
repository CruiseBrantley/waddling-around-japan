import React, { useState } from 'react';
import { triggerHaptic } from '../utils/native';
import { ShareModal } from './ShareModal';

interface SearchBarProps {
  title: string;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
}

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

export const SearchBar: React.FC<SearchBarProps> = ({ searchTerm, setSearchTerm }) => {
  const [isShareOpen, setIsShareOpen] = useState(false);

  return (
    <div className="search-section">
      <div className="search-row">
        <div className="search-wrapper glass">
          <SearchIcon />
          <input 
            type="text" 
            placeholder="Search activities..." 
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="clear-search" onClick={() => setSearchTerm('')}>×</button>
          )}
        </div>

        <button 
          className="share-btn-compact glass"
          onClick={() => {
            triggerHaptic('medium');
            setIsShareOpen(true);
          }}
          aria-label="Share Itinerary"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      </div>

      <ShareModal 
        isOpen={isShareOpen} 
        onClose={() => setIsShareOpen(false)} 
        url={window.location.href} 
      />
    </div>
  );
};
