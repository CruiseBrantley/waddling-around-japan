import React from 'react';
import type { ItineraryActivity } from '../services/sheets';

interface ActivityCardProps {
  activity: ItineraryActivity;
  isLive: boolean;
  activeCardRef: React.RefObject<HTMLDivElement | null>;
}

export const ActivityCard: React.FC<ActivityCardProps> = ({
  activity,
  isLive,
  activeCardRef,
}) => {
  return (
    <div
      className={`activity-card glass ${isLive ? 'active-card' : ''}`}
      ref={isLive ? (activeCardRef as any) : null}
    >
      <div className="card-header">
        <h3 className="activity-title">
          {activity.title}
          {isLive && <span className="live-badge">● LIVE NOW</span>}
        </h3>
        <span className={`category-tag type-${activity.type}`}>
          {activity.category}
        </span>
      </div>

      <div className="activity-details">
        {activity.location && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="activity-location-link"
          >
            <span className="detail-icon">📍</span>
            <span>{activity.location}</span>
          </a>
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
          <a
            href={activity.link}
            target="_blank"
            rel="noopener noreferrer"
            className="activity-link"
          >
            View Trip Note
          </a>
        )}
      </div>
    </div>
  );
};
