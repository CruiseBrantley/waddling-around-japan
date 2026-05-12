import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './App.css'

// Modular Components
import { Hero } from './components/Hero'
import { ShareModal } from './components/ShareModal';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings } from './utils/settings';
import type { AppSettings } from './utils/settings';
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
import { setAppBadge, clearAppBadge, triggerHaptic, triggerTick, showLocalNotification, setHapticsEnabled, clearEventNotifications } from './utils/native'
import heroImg from './assets/hero_optimized.jpg'

function App() {
  // 1. Core State
  const [searchTerm, setSearchTerm] = useState(() => {
    return sessionStorage.getItem('itinerary_searchTerm') || '';
  });
  const [selectedCategory, setSelectedCategory] = useState<string | null>(() => {
    return sessionStorage.getItem('itinerary_selectedCategory') || null;
  });

  // 2. Settings & UI State
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [isLiveCardInView, setIsLiveCardInView] = useState(true);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 3. Data Hook
  const {
    itinerary,
    loading,
    error,
    refreshing,
    lastUpdated,
    currentTime,
    isTripActive,
    getInitialTime
  } = useItinerary(settings.debugOffset);

  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegistered(r) {
      if (r) {
        console.log('SW Registered. Forcing update check...');
        // Force a check on launch
        void r.update();
        // Check every hour
        setInterval(() => {
          console.log('Periodic SW update check...');
          void r.update();
        }, 3600000);
      }
    },
    onRegisterError(error) {
      console.error('SW registration error', error);
    }
  });

  // Automatically apply PWA updates the moment they are detected
  useEffect(() => {
    if (needRefresh) {
      console.log('PWA update detected. Applying immediately...');
      void updateServiceWorker(true);
    }
  }, [needRefresh, updateServiceWorker]);

  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const hasScrolledRef = useRef(false);
  const prevSearchTerm = useRef(searchTerm);
  const scrollRef = useRef<HTMLDivElement>(null);
  const daySelectorRef = useRef<HTMLDivElement>(null);

  // 4. Derived Data
  const filteredDays = useMemo(() => {
    if (!itinerary) return [];
    if (!searchTerm.trim() && !selectedCategory) return itinerary.days;

    const term = searchTerm.toLowerCase();
    return itinerary.days
      .map(day => {
        const dateMatches = searchTerm.trim() && day.date.toLowerCase().includes(term);
        const filteredActivities = day.activities.filter(act => {
          const searchMatch = !searchTerm.trim() || 
            act.title.toLowerCase().includes(term) ||
            act.location.toLowerCase().includes(term) ||
            act.notes.toLowerCase().includes(term);
            
          const categoryMatch = !selectedCategory || act.category === selectedCategory;
          
          return searchMatch && categoryMatch;
        });
        
        return {
          ...day,
          activities: (dateMatches && !selectedCategory) ? day.activities : filteredActivities
        };
      })
      .filter(day => day.activities.length > 0);
  }, [itinerary, searchTerm, selectedCategory]);
  
  const categoryData = useMemo(() => {
    if (!itinerary) return { names: [], colors: {} as Record<string, { bg: string, fg?: string }> };
    const cats = new Set<string>();
    const colorMap: Record<string, { bg: string, fg?: string }> = {};
    
    itinerary.days.forEach(day => {
      day.activities.forEach(act => {
        if (act.category) {
          cats.add(act.category);
          if (act.categoryBackgroundColor && !colorMap[act.category]) {
            colorMap[act.category] = {
              bg: act.categoryBackgroundColor,
              fg: act.categoryForegroundColor
            };
          }
        }
      });
    });
    
    return {
      names: Array.from(cats).sort(),
      colors: colorMap
    };
  }, [itinerary]);

  // 5. Scroll Hook
  const handleIndexChange = useCallback((index: number, type: 'manual' | 'programmatic' | 'daySelector' | 'void') => {


    // 2. Day Selector Sync
    // IMPORTANT: Only scroll the daySelector if the index change came from the main carousel or a button.
    // If the user is currently dragging the DaySelector itself (type === 'daySelector'), 
    // we MUST NOT tell it to scroll programmatically, or it will jitter and fight the user's finger.
    if (daySelectorRef.current && type !== 'daySelector') {
      daySelectorRef.current.scrollTo({
        left: index * 76,
        behavior: 'auto'
      });
    }

    // 3. Initialization: Enable haptics after the first interaction
    if (type !== 'void' && !hasScrolledRef.current) {
      hasScrolledRef.current = true;
    }
  }, [daySelectorRef]);

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

  const handleDayClick = useCallback((index: number) => {
    const startY = window.scrollY;
    // 1. Trigger the horizontal/vertical jump immediately
    scrollToDay(index, true); 
    
    // Enable haptics for subsequent interactions if not already enabled
    hasScrolledRef.current = true;

    // 2. Debug Sync: If we have ?debug=1, jump the clock to this day via settings
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug')) {
      const targetDay = filteredDays[index];
      if (targetDay && targetDay.activities.length > 0) {
        const firstAct = targetDay.activities[0];
        const dayDate = parseSheetDate(targetDay.date);
        const totalMinutes = timeToMinutes(firstAct.time);
        const h = Math.floor(totalMinutes / 60);
        const m = totalMinutes % 60;
        
        if (!isNaN(h) && !isNaN(m) && !isNaN(dayDate.getTime())) {
          // Calculate 10 mins before
          const targetTime = new Date(dayDate);
          targetTime.setHours(h, m - 10, 0);
          
          const debugDate = targetTime.toISOString().split('T')[0];
          const debugTime = `${String(targetTime.getHours()).padStart(2, '0')}:${String(targetTime.getMinutes()).padStart(2, '0')}`;
          const debugOffset = targetTime.getTime() - Date.now();
          
          setSettings(prev => ({
            ...prev,
            debugDate,
            debugTime,
            debugOffset
          }));
        }
      }
    }

    const isDesktop = window.innerWidth >= 800;
    if (isDesktop) return; // Desktop uses independent column scrolling, no window scroll needed

    // 3. Perform vertical alignment (Mobile Only)
    setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const stickyPoint = rect.top + window.scrollY;
      const safeAreaOffset = window.innerWidth < 768 ? 96 : 0;
      const finalPoint = Math.max(0, stickyPoint - safeAreaOffset);

      // Only scroll UP to the sticky point.
      // If we are already above it (near the hero), don't force a scroll down.
      if (window.scrollY > finalPoint + 5) {
        window.scrollTo({ top: finalPoint, behavior: 'smooth' });
      } else if (startY < 10) {
        // If we were at the very top, make sure we stay there even if the browser tried to jump us
        // Use 'auto' (instant) to override browser jump immediately
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    }, 50);
  }, [scrollToDay, scrollRef, filteredDays, parseSheetDate]);

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

      const isDesktop = window.innerWidth >= 800;
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

  // --- Effects ---

  // Sync global alert settings
  useEffect(() => {
    setHapticsEnabled(settings.hapticsEnabled);
  }, [settings.hapticsEnabled]);

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
      if (startMin === 0) continue;

      let nextValidMin = 0;
      for (let j = i + 1; j < today.activities.length; j++) {
        const t = timeToMinutes(today.activities[j].time);
        if (t > startMin) {
          nextValidMin = t;
          break;
        }
      }
      
      const endMin = nextValidMin > 0 ? nextValidMin : startMin + 150;
      
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

  const prevIndexRef = useRef<number>(activeIndex);

  // Tactile Feedback for Day Changes
  useEffect(() => {
    // Only pulse if the index actually changed (prevents feedback on first load)
    if (prevIndexRef.current !== activeIndex) {
      triggerHaptic('light');
      if (settings.soundEnabled) {
        triggerTick();
      }
      prevIndexRef.current = activeIndex;
    }
  }, [activeIndex, settings.soundEnabled, settings.hapticsEnabled]);

  // --- Render ---

  // 6. Native Integrations
  // --- Notifications ---


  // Handle Query Param Testing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const testNotify = params.get('notify');
    if (testNotify) {
      // Small delay to ensure SW is ready and permission is checked
      const timer = setTimeout(() => {
        void showLocalNotification(
          'Test Notification', 
          testNotify === '1' ? 'This is a test notification from query params.' : testNotify
        );
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const [pendingJump, setPendingJump] = useState(false);

  // Clear notifications on initial launch
  useEffect(() => {
    void clearEventNotifications();
    clearAppBadge();
  }, []);

  // Clear notifications and handle navigation when app is opened or resumed
  useEffect(() => {
    const jumpToNow = () => {
      // Find current day index
      const nowDayIdx = filteredDays.findIndex(d => isSameDay(d.date, currentTime));
      if (nowDayIdx !== -1) {
        performSmartJump(nowDayIdx);
      }
    };

    // If data is ready and we have a pending jump, do it now
    if (!loading && itinerary && pendingJump) {
      jumpToNow();
      setTimeout(() => setPendingJump(false), 0);
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void clearEventNotifications();
        clearAppBadge();
        
        // Check for SW updates whenever we become visible
        if ('serviceWorker' in navigator) {
          navigator.serviceWorker.getRegistration().then(r => {
            if (r) {
              console.log('Visibility check: Triggering SW update check...');
              void r.update();
            }
          });
        }

        // If they just clicked a notification (detected via flag/param)
        const params = new URLSearchParams(window.location.search);
        if (params.get('from_notification')) {
          if (loading) {
            setTimeout(() => setPendingJump(true), 0);
          } else {
            jumpToNow();
          }
          // Clean up the URL
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    };

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'NOTIFICATION_CLICK') {
        if (loading) {
          setTimeout(() => setPendingJump(true), 0);
        } else {
          jumpToNow();
        }
      }
    };

    // Check immediately on mount for deep link
    const params = new URLSearchParams(window.location.search);
    if (params.get('from_notification')) {
      if (loading) {
        setTimeout(() => setPendingJump(true), 0);
      } else {
        jumpToNow();
      }
      window.history.replaceState({}, '', window.location.pathname);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSWMessage);
    }

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      }
    };
  }, [filteredDays, currentTime, performSmartJump, loading, itinerary, pendingJump, isSameDay]);

  // Automatic Notifications for upcoming activities removed!
  // Notifications are now completely driven by the backend server via Web Push.

  useEffect(() => {
    // Show remaining activities today as a badge
    const todayIdx = filteredDays.findIndex(d => isSameDay(d.date, currentTime));
    if (todayIdx !== -1) {
      const today = filteredDays[todayIdx];
      const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
      const remainingCount = today.activities.filter(act => act.category.toLowerCase() === 'event' && timeToMinutes(act.time) > nowMin).length;
      
      if (remainingCount > 0) {
        setAppBadge(remainingCount);
      } else {
        clearAppBadge();
      }
    } else {
      clearAppBadge();
    }
  }, [filteredDays, currentTime, isSameDay]);



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
          <div className="sidebar-header">
            <SearchBar 
              searchTerm={searchTerm} 
              setSearchTerm={setSearchTerm} 
              categories={categoryData.names}
              categoryColors={categoryData.colors}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
            />
            <div className="sidebar-meta">
              <span>Last sync: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <div className="sidebar-meta-actions">
                <button className="share-btn-sidebar glass" onClick={() => setIsShareOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                  Share
                </button>
                <button className="settings-toggle-btn" onClick={() => setIsSettingsOpen(true)} title="Settings">
                  ⚙️
                </button>
              </div>
            </div>
          </div>



          <DaySelector ref={daySelectorRef} days={filteredDays} searchTerm={searchTerm} activeIndex={activeIndex} onDayClick={handleDayClick} />
        </aside>

        <div className="itinerary-column">
          <BackgroundAura />
          <main ref={scrollRef} className="swipe-container-outer">
            {filteredDays.length > 0 ? (
              filteredDays.map((day, index) => (
                <div key={day.day} className={`swipe-slide ${index === activeIndex ? 'active' : ''}`} data-index={index}>
                  <ActivityList 
                    date={day.date}
                    activities={day.activities}
                    allActivities={itinerary?.days.find(d => d.date === day.date)?.activities || day.activities}
                    currentTime={currentTime}
                    activeCardRef={activeCardRef}
                    timeToMinutes={timeToMinutes}
                    isToday={isSameDay(day.date, currentTime)}
                    categoryColors={categoryData.colors}
                    onCardClick={() => {
                      if (window.innerWidth >= 800) {
                        handleDayClick(index);
                      }
                    }}
                  />
                </div>
              ))
            ) : (
              <div className="no-results-container fade-in">
                <div className="no-results-icon">🔍</div>
                <h3>No activities found</h3>
                <p>We couldn't find anything matching "<strong>{searchTerm}</strong>"</p>
                <button className="btn btn-secondary" onClick={() => setSearchTerm('')}>
                  Clear Search
                </button>
              </div>
            )}
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

      <ShareModal 
        isOpen={isShareOpen} 
        onClose={() => setIsShareOpen(false)} 
        url={window.location.href} 
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSettingsChange={setSettings}
        currentTime={currentTime}
        categories={categoryData.names}
        categoryColors={categoryData.colors}
      />
    </div>
  );
}

export default App;
