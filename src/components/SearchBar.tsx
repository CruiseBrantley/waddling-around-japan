import React from 'react';

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

export const SearchBar: React.FC<SearchBarProps> = ({ title, searchTerm, setSearchTerm }) => {
  return (
    <div className="container" style={{ marginTop: '24px', marginBottom: '24px' }}>
      <div style={{ marginBottom: '16px' }}>
        <span className="brand-badge">2026 TRIP</span>
        <h1 className="brand-title">{title}</h1>
      </div>
      
      <div className="search-wrapper glass">
        <SearchIcon />
        <input 
          type="text" 
          placeholder="Search activities, food, locations..." 
          className="search-input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button className="clear-search" onClick={() => setSearchTerm('')}>×</button>
        )}
      </div>
    </div>
  );
};
