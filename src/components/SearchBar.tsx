import React from 'react';

interface SearchBarProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  categories: string[];
  categoryColors: Record<string, { bg: string, fg?: string }>;
  selectedCategory: string | null;
  setSelectedCategory: (category: string | null) => void;
}

const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

export const SearchBar: React.FC<SearchBarProps> = ({ 
  searchTerm, setSearchTerm, categories, categoryColors, selectedCategory, setSelectedCategory 
}) => {
  return (
    <div className="search-section">
      <div className="search-wrapper glass">
        <SearchIcon />
        <input 
          type="text" 
          placeholder="Search events..." 
          className="search-input"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button className="clear-search" onClick={() => setSearchTerm('')}>×</button>
        )}
      </div>
      
      {categories.length > 0 && (
        <div className="category-filter-container">
          <button 
            className={`filter-chip ${!selectedCategory ? 'active' : ''}`}
            onClick={() => setSelectedCategory(null)}
          >
            All
          </button>
          {categories.map(cat => {
            const colors = categoryColors[cat];
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                className={`filter-chip ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedCategory(isActive ? null : cat)}
                style={isActive && colors ? { 
                  backgroundColor: colors.bg, 
                  color: colors.fg || '#fff',
                  borderColor: 'transparent',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                } : {}}
              >
                {!isActive && colors && (
                  <span className="chip-color-dot" style={{ backgroundColor: colors.bg }}></span>
                )}
                {cat}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
