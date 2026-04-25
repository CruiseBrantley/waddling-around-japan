import React from 'react';

interface HeroProps {
  image: string;
}

export const Hero: React.FC<HeroProps> = ({ image }) => {
  return (
    <div className="hero-container">
      <img 
        src={image} 
        alt="Hero" 
        className="hero-image" 
        fetchPriority="high" 
        decoding="async" 
      />
    </div>
  );
};
