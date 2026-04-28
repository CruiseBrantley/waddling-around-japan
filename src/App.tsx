import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './App.css'

// Modular Components
import { Hero } from './components/Hero'
import { SearchBar } from './components/SearchBar'
import { DaySelector } from './components/DaySelector'
import { ActivityList } from './components/ActivityList'
import { BackgroundAura } from './components/BackgroundAura'
import { FloatingActions } from './components/FloatingActions'

// Custom Hooks
import { useItinerary } from './hooks/useItinerary'
import { useScrollSync } from './hooks/useScrollSync'

// Utils
import { timeToMinutes } from './utils/time'
import { setAppBadge, clearAppBadge, requestNotificationPermission, triggerHaptic } from './utils/native'
import heroImg from './assets/hero_optimized.jpg'

function App() {
  // 1. Core State
  const [searchTerm, setSearchTerm] = useState(() => {
    return sessionStorage.getItem('itinerary_searchTerm') || '';
  });

  const [timeOffset] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const mockDateStr = params.get('date');
    if (mockDateStr) {
      const mockDate = new Date(mockDateStr);
      if (!isNaN(mockDate.getTime())) return mockDate.getTime() - Date.now();
    }
    return 0;
  });

  // 2. Data Hook
  const {
    itinerary,
    loading,
    error,
    refreshing,
    lastUpdated,
    currentTime,
    isTripActive,
    getInitialTime
  } = useItinerary(timeOffset);

  // 3. PWA & UI State
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();
  const [isLiveCardInView, setIsLiveCardInView] = useState(true);
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = useRef(false);
  const prevSearchTerm = useRef(searchTerm);
  const scrollRef = useRef<HTMLDivElement>(null);
  const daySelectorRef = useRef<HTMLDivElement>(null);

  // 4. Derived Data
  const filteredDays = useMemo(() => {
    if (!itinerary) return [];
    if (!searchTerm.trim()) return itinerary.days;

    const term = searchTerm.toLowerCase();
    return itinerary.days
      .map(day => {
        const dateMatches = day.date.toLowerCase().includes(term);
        const filteredActivities = day.activities.filter(act => 
          act.title.toLowerCase().includes(term) ||
          act.location.toLowerCase().includes(term) ||
          act.notes.toLowerCase().includes(term)
        );
        
        return {
          ...day,
          activities: dateMatches ? day.activities : filteredActivities
        };
      })
      .filter(day => day.activities.length > 0);
  }, [itinerary, searchTerm]);

  // 5. Scroll Hook
  const handleIndexChange = useCallback((index: number, type: 'manual' | 'programmatic' | 'daySelector' | 'void') => {
    // Smart Bottom Snapping: Avoid the "void" after horizontal motion settles
    // ONLY apply this if the user manually swiped (to fix the void issue).
    // If it's a programmatic jump or day selector click, we already handled vertical alignment.
    if (type !== 'manual') return;

    // Safety: don't snap if we are already looking at the hero
    if (window.scrollY < 200) return;

    const handleSettle = () => {
      requestAnimationFrame(() => {
        const isDesktop = window.innerWidth >= 1024;
        if (isDesktop) return;

        const activeSlide = document.querySelector(`.swipe-slide[data-index="${index}"]`) as HTMLElement;
        if (!activeSlide) return;

        const rect = activeSlide.getBoundingClientRect();
        const contentBottom = rect.top + window.scrollY + activeSlide.offsetHeight;
        const viewportBottom = window.scrollY + window.innerHeight;

        if (viewportBottom > contentBottom + 20) {
          const targetY = Math.max(0, contentBottom - window.innerHeight + 40);
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }
      });
    };

    if (scrollRef.current) {
      scrollRef.current.addEventListener('scrollend', handleSettle, { once: true });
    }

    if (daySelectorRef.current) {
      daySelectorRef.current.scrollTo({
        left: index * 76,
        behavior: 'auto'
      });
    }
  }, [scrollRef, daySelectorRef]);

  const { 
    activeIndex, 
    setActiveIndex, 
    scrollToDay 
  } = useScrollSync({ 
    dayCount: filteredDays.length,
    onIndexChange: handleIndexChange,
    scrollRef,
    daySelectorRef
  });

  // --- Handlers & Helpers ---

  const handleDayClick = useCallback((index: number) => {
    // 1. Trigger the horizontal jump immediately (behavior: 'auto' for instant feel)
    scrollToDay(index, true); 
    
    // 2. Perform vertical alignment
    // Use a small timeout to ensure horizontal jump has initiated
    setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const stickyPoint = rect.top + window.scrollY;
      const safeAreaOffset = window.innerWidth < 768 ? 96 : 0;
      const finalPoint = Math.max(0, stickyPoint - safeAreaOffset);

      // Always scroll to sticky point if we are not already there
      if (Math.abs(window.scrollY - finalPoint) > 5) {
        window.scrollTo({ top: finalPoint, behavior: 'smooth' });
      }
    }, 10);
  }, [scrollToDay, scrollRef]);

  const performSmartJump = useCallback((index: number, targetTitle?: string) => {
    if (index === -1) return;
    
    const isAlreadyOnDay = activeIndex === index;
    scrollToDay(index);

    // If same day: jump INSTANTLY. If different day: wait for horizontal slide (400ms)
    const verticalDelay = isAlreadyOnDay ? 0 : 450;

    setTimeout(() => {
      // 1. Try to find the specific target activity if provided
      let targetCard: HTMLElement | null = null;
      if (targetTitle) {
        const activeSlide = document.querySelector(`.swipe-slide[data-index="${index}"]`);
        if (activeSlide) {
          const cards = activeSlide.querySelectorAll('.activity-card');
          for (const card of Array.from(cards)) {
            const titleEl = card.querySelector('.activity-title');
            if (titleEl && titleEl.textContent?.includes(targetTitle)) {
              targetCard = card as HTMLElement;
              break;
            }
          }
        }
      }

      // 2. Fallback to the live card (but only in the target slide)
      if (!targetCard) {
        const activeSlide = document.querySelector(`.swipe-slide[data-index="${index}"]`);
        targetCard = (activeCardRef.current || activeSlide?.querySelector('.activity-card.is-live')) as HTMLElement;
      }

      const isDesktop = window.innerWidth >= 1024;
      const scroller = isDesktop ? scrollRef.current : window;

      if (targetCard) {
        const rect = targetCard.getBoundingClientRect();
        const absoluteTop = rect.top + window.scrollY;
        
        // On desktop, we are scrolling an internal container, so we need to account for its position
        const scrollerRect = isDesktop ? scrollRef.current?.getBoundingClientRect() : null;
        const relativeTop = isDesktop && scrollerRect ? (absoluteTop - scrollerRect.top + (scrollRef.current?.scrollTop || 0)) : absoluteTop;

        const viewHeight = isDesktop ? (scrollRef.current?.offsetHeight || window.innerHeight) : window.innerHeight;
        const targetY = Math.max(0, relativeTop - (viewHeight / 2) + (targetCard.offsetHeight / 2));

        scroller?.scrollTo({ 
          top: targetY, 
          behavior: 'smooth' 
        });
      }
    }, verticalDelay);
  }, [scrollToDay, scrollRef, activeIndex]);

  const parseSheetDate = useCallback((dateStr: string) => {
    let cleanDateStr = dateStr;
    const match = dateStr.match(/\d/);
    if (match) cleanDateStr = dateStr.substring(match.index!);
    if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(cleanDateStr)) {
      const parts = cleanDateStr.split('T')[0].split(/[-/]/).map(s => parseInt(s, 10));
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    const parts = cleanDateStr.split('/');
    if (parts.length >= 3) {
      const m = parseInt(parts[0], 10);
      const d = parseInt(parts[1], 10);
      let y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      if (d > 12) return new Date(y, m - 1, d);
      if (m > 12) return new Date(y, d - 1, m);
      return new Date(y, m - 1, d);
    }
    let d = new Date(dateStr);
    if (isNaN(d.getTime())) d = new Date(dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1'));
    return d;
  }, []);

  const isSameDay = useCallback((dateStr: string, targetDate: Date) => {
    const d = parseSheetDate(dateStr);
    if (isNaN(d.getTime())) return false;
    return d.getMonth() === targetDate.getMonth() && d.getDate() === targetDate.getDate();
  }, [parseSheetDate]);

  // --- Effects ---

  // Search Reset
  useEffect(() => {
    if (searchTerm !== prevSearchTerm.current) {
      prevSearchTerm.current = searchTerm;
      if (searchTerm.trim()) {
        setActiveIndex(0);
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = 0;
          scrollRef.current.scrollTop = 0;
        }
        if (daySelectorRef.current) daySelectorRef.current.scrollLeft = 0;
      }
    }
  }, [searchTerm, setActiveIndex, scrollRef, daySelectorRef]);

  // One-time initialization
  useEffect(() => {
    if (!loading && itinerary && !hasScrolledRef.current) {
      const now = getInitialTime();
      const todayIdx = filteredDays.findIndex(day => isSameDay(day.date, now));
      if (todayIdx !== -1) {
        hasScrolledRef.current = true;
        setTimeout(() => performSmartJump(todayIdx), 50);
      }
    }
  }, [loading, itinerary, filteredDays, getInitialTime, isSameDay, performSmartJump]);

  // Live Pill Tracking
  const activeEvents = useMemo(() => {
    if (!itinerary) return { current: null, next: null };
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes() + (currentTime.getSeconds() / 60);
    const todayIdx = filteredDays.findIndex(d => isSameDay(d.date, currentTime));
    if (todayIdx === -1) return { current: null, next: null };

    const today = filteredDays[todayIdx];
    
    // 1. Find CURRENT
    let current = null;
    for (let i = 0; i < today.activities.length; i++) {
      const act = today.activities[i];
      const startMin = timeToMinutes(act.time);
      const nextAct = today.activities[i + 1];
      const endMin = nextAct ? timeToMinutes(nextAct.time) : 1440;
      
      if (nowMin >= startMin && nowMin < endMin) {
        current = { ...act, dayIdx: todayIdx };
        break;
      }
    }

    // 2. Find NEXT
    let next = null;
    const upcomingToday = today.activities
      .map(act => ({ ...act, minutes: timeToMinutes(act.time) - nowMin }))
      .filter(act => act.minutes > 0)
      .sort((a, b) => a.minutes - b.minutes);

    if (upcomingToday.length > 0) {
      next = { ...upcomingToday[0], dayIdx: todayIdx };
    } else {
      for (let i = todayIdx + 1; i < filteredDays.length; i++) {
        const nextDay = filteredDays[i];
        if (nextDay.activities.length > 0) {
          const firstActivity = nextDay.activities[0];
          const daysBetween = i - todayIdx;
          const minutesUntil = (daysBetween * 24 * 60) - nowMin + timeToMinutes(firstActivity.time);
          next = { ...firstActivity, minutes: minutesUntil, dayIdx: i };
          break;
        }
      }
    }

    return { current, next };
  }, [itinerary, filteredDays, currentTime, isSameDay]);
  
  const jumpToNow = () => {
    const target = activeEvents.current || activeEvents.next;
    if (target && typeof target.dayIdx === 'number') {
      performSmartJump(target.dayIdx, target.title);
    } else {
      const todayIdx = filteredDays.findIndex(d => isSameDay(d.date, currentTime));
      if (todayIdx !== -1) performSmartJump(todayIdx);
    }
  };

  useEffect(() => {
    if (!activeCardRef.current) {
      setIsLiveCardInView(false);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setIsLiveCardInView(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(activeCardRef.current);
    return () => observer.disconnect();
  }, [itinerary, activeIndex, currentTime]);

  // --- Render ---

  // 6. Native Integrations
  useEffect(() => {
    if (activeEvents.next) {
      setAppBadge(1);
    } else {
      clearAppBadge();
    }
  }, [activeEvents.next]);

  const handleEnableNotifications = async () => {
    triggerHaptic('medium');
    const result = await requestNotificationPermission();
    
    if (result === 'granted') {
      alert('Notifications enabled! We will alert you before your next activity.');
    } else if (result === 'denied') {
      alert('Notifications are blocked. Please enable them in your browser settings to receive alerts.');
    } else if (result === 'unsupported') {
      alert('Notifications are not supported on this browser or connection. (Note: Most browsers require a secure HTTPS connection for alerts).');
    }
  };

  if (loading) {
    return (
      <div className="app-wrapper">
        <BackgroundAura />
        <div className="main-layout container">
          <div className="loader-container">
            <div className="shimmer-card"></div>
            <div className="shimmer-card" style={{ opacity: 0.6 }}></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <div className="glass" style={{ padding: '32px', borderRadius: '24px' }}>
          <h2 style={{ color: 'var(--primary)', marginBottom: '12px' }}>Connection Error</h2>
          <p style={{ marginBottom: '24px', opacity: 0.8 }}>{error}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry Connection</button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-wrapper" style={{ touchAction: 'manipulation', '--hero-url': `url(${heroImg})` } as React.CSSProperties}>
      <div className={`sync-indicator ${refreshing ? 'visible' : ''}`}>
        <span className="sync-dot"></span> Syncing...
      </div>

      <div className="main-layout">
        <aside className="sidebar">
          <Hero image={heroImg} />
          <SearchBar title={itinerary?.title || 'Japan Itinerary'} searchTerm={searchTerm} setSearchTerm={setSearchTerm} />
          <div className="mobile-sync-status">
            <span>Last sync: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          {(!('Notification' in window) || Notification.permission !== 'granted') && (
            <div className="settings-card glass">
              <div className="settings-card-content">
                <p>Stay updated with arrival alerts on your lock screen.</p>
                <button 
                  className={`notify-btn ${!('Notification' in window) ? 'unsupported' : ''}`} 
                  onClick={handleEnableNotifications}
                >
                  {!('Notification' in window) ? '⚠️ Alerts Unavailable' : '🔔 Enable Alerts'}
                </button>
              </div>
            </div>
          )}

          <DaySelector ref={daySelectorRef} days={filteredDays} searchTerm={searchTerm} activeIndex={activeIndex} onDayClick={handleDayClick} />
        </aside>

        <div className="itinerary-column">
          <BackgroundAura />
          <main ref={scrollRef} className="swipe-container-outer">
            {filteredDays.map((day, index) => (
              <div key={day.day} className={`swipe-slide ${index === activeIndex ? 'active' : ''}`} data-index={index}>
                <ActivityList 
                  date={day.date}
                  activities={day.activities}
                  allActivities={itinerary?.days.find(d => d.date === day.date)?.activities || day.activities}
                  currentTime={currentTime}
                  activeCardRef={activeCardRef}
                  timeToMinutes={timeToMinutes}
                  isToday={isSameDay(day.date, currentTime)}
                />
              </div>
            ))}
          </main>
        </div>
      </div>

      {needRefresh && (
        <div className="pwa-toast glass">
          <div className="pwa-toast-content">New version available!</div>
          <button className="update-btn" onClick={() => updateServiceWorker(true)}>RELOAD</button>
        </div>
      )}

      <FloatingActions 
        isTripActive={isTripActive} 
        nextEvent={activeEvents.next} 
        isLiveCardInView={isLiveCardInView} 
        jumpToNow={jumpToNow} 
      />
    </div>
  );
}

export default App;
