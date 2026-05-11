import React from 'react';
import type { ItineraryActivity } from '../services/sheets';

interface ActivityCardProps {
  activity: ItineraryActivity;
  isLive: boolean;
  activeCardRef: React.RefObject<HTMLDivElement | null>;
  categoryColors: Record<string, { bg: string, fg?: string }>;
}

export const ActivityCard: React.FC<ActivityCardProps> = ({
  activity,
  isLive,
  activeCardRef,
  categoryColors,
}) => {
  const safeCategoryColors = categoryColors || {};
  const catColors = activity.category ? safeCategoryColors[activity.category] : null;
  const finalBg = catColors?.bg || activity.categoryBackgroundColor;
  const finalFg = catColors?.fg || activity.categoryForegroundColor;

  return (
  <div
    className={`activity-card glass ${isLive ? 'is-live' : ''} ${activity.requiresReservation ? 'is-reservation' : ''}`}
    ref={isLive ? activeCardRef : undefined}
  >
      <div className="card-header">
        <div className="title-row">
          <h3 className="activity-title">
            {activity.title}
            {isLive && <span className="live-badge">● ONGOING</span>}
          </h3>
          {activity.requiresReservation && (
            <span className="reservation-badge">🎟️ RESERVATION REQUIRED</span>
          )}
        </div>
        {activity.category && (
          <span 
            className={`category-tag type-${activity.type}`}
            style={{
              ...(finalBg ? { 
                backgroundColor: finalBg, 
                border: 'none',
                textShadow: '0 1px 2px rgba(0,0,0,0.3)' 
              } : {}),
              ...(finalFg ? { 
                color: finalFg 
              } : { color: 'white' }) // Fallback to white if no custom foreground but custom background is used
            }}
          >
            {activity.category}
          </span>
        )}
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
