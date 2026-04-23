import React from 'react';
import { ItineraryActivity } from '../services/sheets';

interface ActivityCardProps {
  activity: ItineraryActivity;
  isLive: boolean;
  activeCardRef: React.RefObject<HTMLDivElement> | null;
}

export const ActivityCard: React.FC<ActivityCardProps> = ({ activity, isLive, activeCardRef }) => {
  return (
    <div 
      className={`activity-card glass ${isLive ? 'active-card' : ''}`}
      ref={isLive ? (activeCardRef as any) : null}
    >
      <div className="activity-meta">
        <span className="activity-time">{activity.time}</span>
        <span className={`category-tag type-${activity.type}`}>{activity.category}</span>
      </div>
      
      <h3 className="activity-title">
        {activity.title}
        {isLive && <span className="live-badge">● LIVE NOW</span>}
      </h3>
      
      <div className="activity-details">
        {activity.location && (
          <div className="detail-item">
            <span className="detail-icon">📍</span>
            <span className="detail-text">{activity.location}</span>
          </div>
        )}
        {activity.cost && (
          <div className="detail-item">
            <span className="detail-icon">💰</span>
            <span className="detail-text">{activity.cost}</span>
          </div>
        )}
        {activity.notes && (
          <div className="activity-notes">
            <p>{activity.notes}</p>
          </div>
        )}
        {activity.link && (
          <a href={activity.link} target="_blank" rel="noopener noreferrer" className="activity-link">
            View Trip Note
          </a>
        )}
      </div>
    </div>
  );
};
