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

  return (
    <div className="container" style={{ paddingBottom: '100px' }}>
      <div className="day-header">
        <h2 className="date-display">{date}</h2>
        <span className="activity-count">{activities.length} activities</span>
      </div>

      <div className="timeline">
        {activities.map((activity) => {
          const isLive = liveActivityId === activity.id;

          return (
            <div className="timeline-item" key={activity.id}>
              <div className="timeline-left">
                <span className="activity-time">{activity.time}</span>
                <div className={`timeline-dot type-${activity.type} ${isLive ? 'pulse-red' : ''}`}></div>
                <div className="timeline-connector"></div>
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
