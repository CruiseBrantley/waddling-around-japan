import React from 'react';
import type { ItineraryActivity } from '../services/sheets';

const getLinkText = (url: string, category: string) => {
  const isFood = category?.toLowerCase().trim() === 'food';
  
  try {
    const domain = new URL(url).hostname.toLowerCase();
    
    if (domain.includes('google.com/maps') || domain.includes('maps.app.goo.gl')) {
      if (url.includes('/place/') || url.includes('/search/')) {
        return isFood ? 'View Menu on Maps' : 'View Place';
      }
      return 'View Map';
    }
    
    if (domain.includes('tabelog.com')) return 'View on Tabelog';
    if (domain.includes('klook.com')) return 'View Tickets';
    if (domain.includes('navitime.com')) return 'View Route';
    if (domain.includes('instagram.com')) return 'View on Instagram';
    if (domain.includes('gurunavi.com')) return 'View on Gurunavi';
    if (domain.includes('hotpepper.jp')) return 'View on Hotpepper';
  } catch {
    // Fallback handled below
  }
  
  return isFood ? 'View Menu' : 'View Website';
};

interface ActivityCardProps {
  activity: ItineraryActivity;
  isLive: boolean;
  isGroupActive?: boolean;
  isHeader?: boolean;
  showOngoingBadge?: boolean;
  activeCardRef: React.RefObject<HTMLDivElement | null>;
  categoryColors: Record<string, { bg: string, fg?: string }>;
  onClick?: () => void;
}

export const ActivityCard: React.FC<ActivityCardProps> = ({
  activity,
  isLive,
  isGroupActive,
  isHeader,
  showOngoingBadge,
  activeCardRef,
  categoryColors,
  onClick,
}) => {
  const safeCategoryColors = categoryColors || {};
  const catColors = activity.category ? safeCategoryColors[activity.category] : null;
  const finalBg = catColors?.bg || activity.categoryBackgroundColor;
  const finalFg = catColors?.fg || activity.categoryForegroundColor;

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a') || (e.target as HTMLElement).closest('button')) {
      return; // Do not trigger card click if clicking a link or button
    }
    if (onClick) {
      onClick();
    }
  };

  return (
  <div
    className={`activity-card glass ${isLive ? 'is-live' : ''} ${isHeader ? 'is-header' : ''} ${isGroupActive ? 'is-group-active' : ''} ${activity.requiresReservation ? 'is-reservation' : ''}`}
    ref={isLive ? activeCardRef : undefined}
    onClick={handleCardClick}
    data-title={activity.fullTitle}
    data-id={activity.id}
    style={onClick ? { cursor: 'pointer' } : undefined}
  >
      <div className="card-header">
        <div className="title-row">
          <h3 className="activity-title">
            {activity.titleHtml ? (
              <span dangerouslySetInnerHTML={{ __html: activity.titleHtml }} />
            ) : (
              activity.title
            )}
            {activity.smartChip && (
              <span className="smart-chip">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{marginTop: '1px'}}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                {activity.smartChip}
              </span>
            )}
            {showOngoingBadge && isLive && <span className="live-badge">● ONGOING</span>}
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
        <div className="activity-metadata">
          {activity.location && (
            <a
              href={activity.locationLink || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="metadata-item location-link"
              onClick={e => e.stopPropagation()}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>{activity.location}</span>
            </a>
          )}
          {activity.cost && (
            <div className="metadata-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
              <span>{activity.cost}</span>
            </div>
          )}
        </div>
        {activity.notes && (
          <div className="activity-notes">
            <p>{activity.notes}</p>
          </div>
        )}
        {activity.link && (
          <div className="activity-action-links" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
            <a
              href={activity.link}
              target="_blank"
              rel="noopener noreferrer"
              className="activity-link"
            >
              🔗 {getLinkText(activity.link, activity.category)}
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
