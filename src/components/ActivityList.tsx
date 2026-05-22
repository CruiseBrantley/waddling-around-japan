/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import type { ItineraryActivity } from '../services/sheets';
import { ActivityCard } from './ActivityCard';
import { DayWeather } from './DayWeather';
import type { AppSettings } from '../utils/settings';
import { parseTimeToHour } from '../utils/time';

const REGION_KEYWORD_MAP: Record<string, string[]> = {
  'chicago': ['ord', 'mdw', "o'hare", 'midway', 'chicago'],
  'bentonville': ['xna', 'bentonville'],
  'centerton': ['centerton'],
  'tokyo': ['hnd', 'nrt', 'haneda', 'narita', 'tokyo'],
  'osaka': ['kix', 'itm', 'kansai', 'itami', 'osaka'],
  'kyoto': ['kyoto'],
  'kobe': ['ukb', 'kobe'],
  'sapporo': ['cts', 'chitose', 'sapporo'],
  'hakodate': ['hkd', 'hakodate'],
  'fukuoka': ['fuk', 'fukuoka'],
  'nagoya': ['ngo', 'nagoya'],
  'hiroshima': ['hij', 'hiroshima']
};

 
const findBestRegionForActivity = (activity: any, regions: string[], previousRegion?: string): string => {
  if (!regions || regions.length === 0) return 'Tokyo';
  if (regions.length === 1) return regions[0];
  
  let locationText = '';
  let titleText = '';
  let notesText = '';
  let linkText = '';
  let resolvedNameText = '';
  let resolvedAddressText = '';

  if (activity && typeof activity === 'object') {
    locationText = (activity.location || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    titleText = (activity.title || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    notesText = (activity.notes || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    linkText = ((activity.locationLink || '') + ' ' + (activity.link || '')).toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    resolvedNameText = (activity.resolvedName || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
    resolvedAddressText = (activity.resolvedAddress || '').toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
  } else if (typeof activity === 'string') {
    locationText = activity.toLowerCase().replace(/kyoto\s*katsugyu|gyukatsu\s+kyoto/g, '');
  }

  // 1. Direct substring check on location and resolved fields first
  if (locationText || resolvedNameText || resolvedAddressText) {
    for (const region of regions) {
      const regionLower = region.toLowerCase();
      if (
        (locationText && locationText.includes(regionLower)) ||
        (resolvedNameText && resolvedNameText.includes(regionLower)) ||
        (resolvedAddressText && resolvedAddressText.includes(regionLower))
      ) {
        return region;
      }
    }
  }

  // 2. Alias mapping check on location and resolved fields
  if (locationText || resolvedNameText || resolvedAddressText) {
    for (const region of regions) {
      const regionLower = region.toLowerCase();
      
      // Find matching alias configuration
      let aliases: string[] = [];
      for (const key of Object.keys(REGION_KEYWORD_MAP)) {
        if (regionLower.includes(key) || key.includes(regionLower)) {
          aliases = REGION_KEYWORD_MAP[key];
          break;
        }
      }
      
      // Check if any alias matches the location/resolved fields with word boundary protection for short codes
      for (const alias of aliases) {
        if (alias.length <= 3) {
          const regex = new RegExp(`\\b${alias}\\b`, 'i');
          if (
            (locationText && regex.test(locationText)) ||
            (resolvedNameText && regex.test(resolvedNameText)) ||
            (resolvedAddressText && regex.test(resolvedAddressText))
          ) {
            return region;
          }
        } else {
          if (
            (locationText && locationText.includes(alias)) ||
            (resolvedNameText && resolvedNameText.includes(alias)) ||
            (resolvedAddressText && resolvedAddressText.includes(alias))
          ) {
            return region;
          }
        }
      }
    }
  }

  // 3. Direct substring check on other fields (title, notes, links)
  for (const region of regions) {
    const regionLower = region.toLowerCase();
    if (titleText.includes(regionLower) || notesText.includes(regionLower) || linkText.includes(regionLower)) {
      return region;
    }
  }

  // 4. Alias mapping check on other fields (title, notes, links)
  for (const region of regions) {
    const regionLower = region.toLowerCase();
    
    let aliases: string[] = [];
    for (const key of Object.keys(REGION_KEYWORD_MAP)) {
      if (regionLower.includes(key) || key.includes(regionLower)) {
        aliases = REGION_KEYWORD_MAP[key];
        break;
      }
    }
    
    for (const alias of aliases) {
      if (alias.length <= 3) {
        const regex = new RegExp(`\\b${alias}\\b`, 'i');
        if (regex.test(titleText) || regex.test(notesText) || regex.test(linkText)) {
          return region;
        }
      } else {
        if (titleText.includes(alias) || notesText.includes(alias) || linkText.includes(alias)) {
          return region;
        }
      }
    }
  }
  if (previousRegion && regions.includes(previousRegion)) {
    return previousRegion;
  }
  
  return regions[0];
};

interface ActivityListProps {
  date: string;
  activities: ItineraryActivity[];
  allActivities: ItineraryActivity[];
  regions?: string[];
  currentTime: Date;
  activeCardRef: React.RefObject<HTMLDivElement | null>;
  timeToMinutes: (timeStr: string) => number;
  isToday: boolean;
  categoryColors: Record<string, { bg: string, fg?: string }>;
  onCardClick?: () => void;
  nextEvent?: { id?: string; minutes: number; isLive?: boolean } | null;
  settings: AppSettings;
  isActive?: boolean;
}

export const ActivityList: React.FC<ActivityListProps> = ({ 
  date, 
  activities,
  allActivities,
  regions,
  currentTime, 
  activeCardRef,
  timeToMinutes,
  isToday,
  categoryColors,
  onCardClick,
  nextEvent,
  settings,
  isActive
}) => {
  const [cacheVersion, setCacheVersion] = useState(0);

  useEffect(() => {
    const handleCacheUpdate = () => {
      setCacheVersion(v => v + 1);
    };
    window.addEventListener('advisor_cache_updated', handleCacheUpdate);
    return () => {
      window.removeEventListener('advisor_cache_updated', handleCacheUpdate);
    };
  }, []);

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
  }, [activities, cacheVersion]);

  const activityRegionsMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    if (!activities || !regions || regions.length === 0) return map;

    let lastResolvedRegion = regions[0];
    
    activities.forEach((activity) => {
      const resolved = findBestRegionForActivity(activity, regions, lastResolvedRegion);
      lastResolvedRegion = resolved;
      map[activity.id] = resolved;
    });
    
    return map;
  }, [activities, regions]);

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

      <DayWeather 
        date={date} 
        regions={regions}
        currentTime={currentTime} 
        settings={settings} 
        isActive={isActive}
      />

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

                const weatherInfo = (() => {
                  if (!regions || regions.length === 0) return undefined;
                  const actRegion = activityRegionsMap[activity.id] || regions[0];
                  const weatherCacheKey = `real_weather_${date.replace(/[^a-zA-Z0-9]/g, '_')}_${actRegion.toLowerCase()}`;
                  
                  try {
                    const cached = localStorage.getItem(weatherCacheKey);
                    if (cached) {
                      const weatherData = JSON.parse(cached);
                      if (weatherData.condition === 'Unknown') {
                        return undefined;
                      }
                      const startMin = timeToMinutes(activity.time || '');
                      const hour = parseTimeToHour(activity.time || '');
                      
                      let maxPrecipProb = 0;
                      let hasPrecipProb = false;
                      
                      if (startMin > 0 && weatherData.hourly) {
                        const actIdx = activities.findIndex(a => a.id === activity.id);
                        let nextStartMin = 0;
                        for (let i = actIdx + 1; i < activities.length; i++) {
                          const t = timeToMinutes(activities[i].time || '');
                          if (t > startMin) {
                            nextStartMin = t;
                            break;
                          }
                        }
                        const durationMinutes = nextStartMin > 0 ? (nextStartMin - startMin) : 180; // default to 3 hours if last event
                        const maxDuration = 240; // cap duration search at 4 hours
                        const duration = Math.min(durationMinutes, maxDuration);
                        
                        const startHour = hour !== null ? hour : Math.floor(startMin / 60);
                        const endHour = Math.min(23, Math.floor((startMin + duration - 1) / 60));
                        
                        for (let h = startHour; h <= endHour; h++) {
                          const clampedHour = Math.max(0, Math.min(23, h));
                          const hourlyForecast = weatherData.hourly[clampedHour];
                          if (hourlyForecast && hourlyForecast.precipProb !== undefined) {
                            maxPrecipProb = Math.max(maxPrecipProb, hourlyForecast.precipProb);
                            hasPrecipProb = true;
                          }
                        }
                      }
                      
                      const resolvedPrecipProb = hasPrecipProb ? maxPrecipProb : (weatherData.precipProb || 0);

                      if (hour !== null && weatherData.hourly && weatherData.hourly[hour]) {
                        const hourlyForecast = weatherData.hourly[hour];
                        return {
                          temp: hourlyForecast.temp,
                          emoji: hourlyForecast.emoji,
                          condition: hourlyForecast.condition || weatherData.condition,
                          precipProb: resolvedPrecipProb
                        };
                      } else {
                        return {
                          temp: weatherData.tempMax,
                          emoji: weatherData.emoji,
                          condition: weatherData.condition,
                          precipProb: resolvedPrecipProb
                        };
                      }
                    }
                  } catch (e) {
                    console.warn('Failed to parse cached weather for activity badge:', e);
                  }
                  return undefined;
                })();

                return (
                  <div className={`timeline-item ${!isFirstInGroup ? 'untimed-item' : ''}`} key={activity.id}>
                    <div className="timeline-left">
                      {isFirstInGroup ? (
                        <>
                          {weatherInfo && (
                            <div className="timeline-weather-badge" title={`${weatherInfo.condition} (Max rain chance: ${weatherInfo.precipProb}%)`}>
                              <div className="weather-row">
                                <span className="weather-emoji">{weatherInfo.emoji}</span>
                                <span className="weather-temp">{weatherInfo.temp}°</span>
                              </div>
                              {weatherInfo.precipProb > 0 && (
                                <span className="weather-precip">{weatherInfo.precipProb}%</span>
                              )}
                            </div>
                          )}
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
