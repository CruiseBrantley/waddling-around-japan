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

  return (
    <div className="container" style={{ paddingBottom: '100px' }}>
      <div className="day-header">
        <h2 className="date-display">{date}</h2>
        <span className="activity-count">{activities.length} activities</span>
      </div>

      <div className="timeline">
        {activities.map((activity, index) => {
          // Check if it's the current activity (only if viewing today)
          const activityMinutes = timeToMinutes(activity.time);
          const nextActivity = activities[index + 1];
          const nextMinutes = nextActivity ? timeToMinutes(nextActivity.time) : 1440; // End of day

          const isLive = isToday && currentMinutes >= activityMinutes && currentMinutes < nextMinutes;

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
