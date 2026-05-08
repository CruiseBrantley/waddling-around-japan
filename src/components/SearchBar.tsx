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

export const SearchBar: React.FC<SearchBarProps> = ({ searchTerm, setSearchTerm }) => {
  return (
    <div className="search-section">
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
    </div>
  );
};
