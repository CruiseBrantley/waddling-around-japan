import React from 'react';
import type { ItineraryActivity } from '../services/sheets';
import { ActivityCard } from './ActivityCard';

interface ActivityListProps {
  date: string;
  activities: ItineraryActivity[];
  allActivities: ItineraryActivity[];
  currentTime: Date;
  activeCardRef: React.RefObject<HTMLDivElement | null>;
  timeToMinutes: (timeStr: string) => number;
  isToday: boolean;
  categoryColors: Record<string, { bg: string, fg?: string }>;
  onCardClick?: () => void;
  nextEvent?: { id?: string; minutes: number; isLive?: boolean } | null;
}

export const ActivityList: React.FC<ActivityListProps> = ({ 
  date, 
  activities,
  allActivities,
  currentTime, 
  activeCardRef,
  timeToMinutes,
  isToday,
  categoryColors,
  onCardClick,
  nextEvent
}) => {
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  // Group activities into "Sessions"
  const sessions = React.useMemo(() => {
    const results: { isGroup: boolean; activities: ItineraryActivity[] }[] = [];
    let currentGroup: ItineraryActivity[] = [];
    
    activities.forEach((act) => {
      if (act.time) {
        if (currentGroup.length > 0) {
          results.push({ isGroup: currentGroup.length > 1, activities: [...currentGroup] });
        }
        currentGroup = [act];
      } else {
        currentGroup.push(act);
      }
    });
    
    if (currentGroup.length > 0) {
      results.push({ isGroup: currentGroup.length > 1, activities: [...currentGroup] });
    }
    
    return results;
  }, [activities]);

  const getLiveInfo = () => {
    if (!isToday || allActivities.length === 0) return null;

    for (let i = 0; i < allActivities.length; i++) {
      const activityMinutes = timeToMinutes(allActivities[i].time);
      if (activityMinutes === 0) continue;

      let nextTimedMin = 0;
      for (let j = i + 1; j < allActivities.length; j++) {
        if (allActivities[j].time) {
          const t = timeToMinutes(allActivities[j].time);
          if (t > activityMinutes) {
            nextTimedMin = t;
            break;
          }
        }
      }
      
      const endMins = nextTimedMin > 0 
        ? Math.min(nextTimedMin, activityMinutes + 150) 
        : activityMinutes + 150;
      
      if (currentMinutes >= activityMinutes && currentMinutes < endMins) {
        return {
          timedActivityId: allActivities[i].id,
          startMins: activityMinutes,
          endMins: endMins
        };
      }
    }
    return null;
  };

  const liveInfo = getLiveInfo();
  const liveTimedId = liveInfo?.timedActivityId;
  
  // Logic to handle "Instant Snap" on first load or activity change
  const lastLiveIdRef = React.useRef<string | null>(null);
  const [isInstant, setIsInstant] = React.useState(true);

  React.useEffect(() => {
    if (liveTimedId !== lastLiveIdRef.current) {
      setIsInstant(true);
      lastLiveIdRef.current = liveTimedId || null;
      const timer = setTimeout(() => setIsInstant(false), 50);
      return () => clearTimeout(timer);
    }
  }, [liveTimedId]);

  return (
    <div className="container" style={{ paddingBottom: '40px' }}>
      <div className="day-header">
        <h2 className="date-display">{date}</h2>
        <span className="activity-count">
          {activities.filter(a => {
            const cat = a.category?.toLowerCase().trim() || '';
            return ['event', 'food', 'shopping'].includes(cat);
          }).length} activities
        </span>
      </div>

      <div className="timeline">
        {sessions.map((session, sIdx) => {
          const firstAct = session.activities[0];
          const isGroupLive = liveTimedId === firstAct.id;
          const isLastSession = sIdx === sessions.length - 1;
          
          let totalProgress = 0;
          if (isGroupLive && liveInfo) {
            totalProgress = Math.min(100, Math.max(0, ((currentMinutes - liveInfo.startMins) / (liveInfo.endMins - liveInfo.startMins)) * 100));
          }

          return (
            <div 
              key={`session-${firstAct.id}`} 
              className={`timeline-session ${session.isGroup ? 'is-group' : ''} ${isGroupLive ? 'is-live' : ''}`}
            >
              
              {session.activities.map((activity, aIdx) => {
                const isFirstInGroup = aIdx === 0;
                const isLastItem = isLastSession && aIdx === session.activities.length - 1;
                const localProgress = isGroupLive ? Math.min(100, Math.max(0, (totalProgress * session.activities.length) - (aIdx * 100))) : 0;
                const isCurrentlyFilling = isGroupLive && localProgress > 0 && localProgress < 100;

                const safeCategoryColors = categoryColors || {};
                const catColors = activity.category ? safeCategoryColors[activity.category] : null;
                const finalBg = catColors?.bg || activity.categoryBackgroundColor;

                return (
                  <div className={`timeline-item ${!isFirstInGroup ? 'untimed-item' : ''}`} key={activity.id}>
                    <div className="timeline-left">
                      {isFirstInGroup ? (
                        <>
                          <span className="activity-time event-time">{activity.time}</span>
                          <div 
                            className={`timeline-dot type-${activity.type} ${isGroupLive ? 'pulse-red' : ''}`}
                            style={finalBg ? { backgroundColor: finalBg } : undefined}
                          ></div>
                        </>
                      ) : (
                        <div className={`timeline-dot-small ${isGroupLive ? 'is-active' : ''}`}></div>
                      )}
                      
                      {/* Connector below dot — only when there's a next item */}
                      {!isLastItem && (
                        <div className="timeline-connector">
                          {isGroupLive && (
                            <div
                              className={`timeline-progress-fill ${isInstant ? 'instant' : ''}`}
                              style={{ transform: `scaleY(${localProgress / 100})` }}
                            ></div>
                          )}
                        </div>
                      )}
                    </div>
                    <ActivityCard 
                      activity={activity} 
                      isLive={isGroupLive && isFirstInGroup}
                      isHeader={isFirstInGroup}
                      showOngoingBadge={isFirstInGroup}
                      isGroupActive={isGroupLive}
                      activeCardRef={isCurrentlyFilling ? activeCardRef : { current: null }} 
                      categoryColors={categoryColors}
                      onClick={onCardClick}
                      isImminentNext={
                        nextEvent !== null && 
                        nextEvent !== undefined && 
                        nextEvent.id === activity.id && 
                        nextEvent.minutes <= 5 && 
                        nextEvent.minutes > 0
                      }
                      nextEventMinutes={nextEvent?.minutes}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
