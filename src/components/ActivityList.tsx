import React from 'react';
import type { ItineraryActivity } from '../services/sheets';
import { ActivityCard } from './ActivityCard';

interface ActivityListProps {
  date: string;
  activities: ItineraryActivity[];
  currentTime: Date;
  activeCardRef: React.RefObject<HTMLDivElement | null>;
  timeToMinutes: (timeStr: string) => number;
  isToday: boolean;
}

export const ActivityList: React.FC<ActivityListProps> = ({ 
  date, 
  activities, 
  currentTime, 
  activeCardRef,
  timeToMinutes,
  isToday
}) => {
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

  // Find which activity should be live based on time ranges
  const getLiveActivityId = () => {
    for (let i = 0; i < activities.length; i++) {
      const activityMinutes = timeToMinutes(activities[i].time);
      const nextActivity = activities[i + 1];
      const nextMinutes = nextActivity ? timeToMinutes(nextActivity.time) : 1440;
      
      if (currentMinutes >= activityMinutes && currentMinutes < nextMinutes) {
        return activities[i].id;
      }
    }
    return null;
  };

  const liveActivityId = isToday ? getLiveActivityId() : null;
  
  // Logic to handle "Instant Snap" on first load or activity change
  const lastLiveIdRef = React.useRef<string | null>(null);
  const [isInstant, setIsInstant] = React.useState(true);

  React.useEffect(() => {
    if (liveActivityId !== lastLiveIdRef.current) {
      setIsInstant(true);
      lastLiveIdRef.current = liveActivityId;
      const timer = setTimeout(() => setIsInstant(false), 50);
      return () => clearTimeout(timer);
    }
  }, [liveActivityId]);

  return (
    <div className="container" style={{ paddingBottom: '40px' }}>
      <div className="day-header">
        <h2 className="date-display">{date}</h2>
        <span className="activity-count">{activities.length} activities</span>
      </div>

      <div className="timeline">
        {activities.map((activity, index) => {
          const isLive = liveActivityId === activity.id;
          let progress = 0;

          if (isLive) {
            const startMins = timeToMinutes(activity.time);
            const nextActivity = activities[index + 1];
            const endMins = nextActivity ? timeToMinutes(nextActivity.time) : 1440;
            progress = Math.min(100, Math.max(0, ((currentMinutes - startMins) / (endMins - startMins)) * 100));
          }

          return (
            <div className="timeline-item" key={activity.id}>
              <div className="timeline-left">
                <span className="activity-time">{activity.time}</span>
                <div className={`timeline-dot type-${activity.type} ${isLive ? 'pulse-red' : ''}`}></div>
                <div className="timeline-connector">
                  {isLive && (
                    <div 
                      className={`timeline-progress-fill ${isInstant ? 'instant' : ''}`} 
                      style={{ height: `${progress}%` }}
                    ></div>
                  )}
                </div>
              </div>
              <ActivityCard 
                activity={activity} 
                isLive={isLive} 
                activeCardRef={activeCardRef} 
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};
