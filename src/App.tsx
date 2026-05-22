import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './App.css'

// Modular Components
import { Hero } from './components/Hero'
import { ShareModal } from './components/ShareModal';
import { SettingsModal } from './components/SettingsModal';
import { loadSettings, APP_VERSION } from './utils/settings';
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
import { getApiUrl } from './utils/api';
import { timeToMinutes } from './utils/time'
import { clearAppBadge, showLocalNotification, setHapticsEnabled, clearEventNotifications, subscribeToPushNotifications } from './utils/native'
import heroImg from './assets/hero_optimized.jpg'
import type { ItineraryActivity } from './services/sheets'


const findActivityAtTime = (activities: ItineraryActivity[], nowMin: number): ItineraryActivity | null => {
  if (activities.length === 0) return null;

  // No buffer: activities go live at exact start time

  for (let i = 0; i < activities.length; i++) {
    const act = activities[i];
    const startMin = timeToMinutes(act.time);
    if (startMin === 0) continue;

    let nextValidMin = 0;
    for (let j = i + 1; j < activities.length; j++) {
      const t = timeToMinutes(activities[j].time);
      if (t > startMin) {
        nextValidMin = t;
        break;
      }
    }
    
    const endMin = nextValidMin > 0 
      ? Math.min(nextValidMin, startMin + 150) 
      : startMin + 150;
    
    if (nowMin >= startMin && nowMin < endMin) {
      return act;
    }
  }
  return null;
};

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
  const [showSplash, setShowSplash] = useState(true);
  const [isSplashFading, setIsSplashFading] = useState(false);

  // 3. Data Hook
  const {
    itinerary,
    loading,
    error,
    refreshing,
    lastUpdated,
    currentTime,
    isTripActive,
    loadData
  } = useItinerary(settings.debugOffset);

  // Helper to pre-populate and synchronize the daily AI Advisor local storage cache in full
  const syncAdvisorCache = useCallback(async () => {
    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/advisor`, {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'Bypass-Tunnel-Reminder': 'true'
        }
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.cache) {
          Object.keys(data.cache).forEach(serverKey => {
            const entry = data.cache[serverKey];
            const content = entry && typeof entry === 'object' ? entry.content : entry;
            const weather = entry && typeof entry === 'object' ? entry.weather : null;
            const lastUnderscore = serverKey.lastIndexOf('_');
            if (lastUnderscore !== -1) {
              const date = serverKey.substring(0, lastUnderscore);
              const region = serverKey.substring(lastUnderscore + 1);
              const clientCacheKey = `ai_advisory_${date.replace(/[^a-zA-Z0-9]/g, '_')}_${region.toLowerCase()}`;
              const weatherCacheKey = `real_weather_${date.replace(/[^a-zA-Z0-9]/g, '_')}_${region.toLowerCase()}`;
              try {
                if (content) {
                  localStorage.setItem(clientCacheKey, content);
                }
                if (weather) {
                  localStorage.setItem(weatherCacheKey, JSON.stringify(weather));
                }
              } catch (e) {
                console.warn('Failed to pre-populate advisor item locally:', e);
              }
            } else {
              // Full day advisor key
              const date = serverKey;
              const clientCacheKey = `ai_advisory_${date.replace(/[^a-zA-Z0-9]/g, '_')}`;
              try {
                if (content) {
                  localStorage.setItem(clientCacheKey, content);
                }
              } catch (e) {
                console.warn('Failed to pre-populate unified advisor item locally:', e);
              }
            }
          });
          console.log(`Pre-populated local storage advisor cache with ${Object.keys(data.cache).length} entries`);
          window.dispatchEvent(new Event('advisor_cache_updated'));
        }
      }
    } catch (err) {
      console.warn('Failed to pre-populate local advisor cache from server:', err);
    }
  }, []);

  // Pre-populate advisor cache once on boot
  useEffect(() => {
    void syncAdvisorCache();
  }, [syncAdvisorCache]);

  // Splash Screen Fade-out Effect
  useEffect(() => {
    if ((!loading && itinerary) || error) {
      const frameId = requestAnimationFrame(() => {
        setIsSplashFading(true);
      });
      const timer = setTimeout(() => {
        setShowSplash(false);
      }, 600);
      return () => {
        cancelAnimationFrame(frameId);
        clearTimeout(timer);
      };
    }
  }, [loading, itinerary, error]);

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


  // Synchronize dynamic device timezone with push notification server in the background
  useEffect(() => {
    if (
      !settings.notificationsEnabled || 
      !('Notification' in window) || 
      Notification.permission !== 'granted'
    ) {
      return;
    }

    const syncTimezone = () => {
      console.log('Synchronizing device timezone with push server...');
      subscribeToPushNotifications({
        notifyMinutesBefore: settings.notifyMinutesBefore,
        notifyUrgentMinutesBefore: settings.notifyUrgentMinutesBefore,
        disabledCategories: settings.disabledCategories,
        devMode: settings.devMode,
        debugOffset: settings.debugOffset
      }).catch(err => {
        console.warn('Failed to background sync timezone with push server:', err);
      });
    };

    // Sync on mount or when dependencies change
    syncTimezone();

    // Listen for visibility/focus changes to sync immediately when user wakes the app in a new timezone
    window.addEventListener('focus', syncTimezone);
    document.addEventListener('visibilitychange', syncTimezone);

    return () => {
      window.removeEventListener('focus', syncTimezone);
      document.removeEventListener('visibilitychange', syncTimezone);
    };
  }, [
    settings.notificationsEnabled,
    settings.notifyMinutesBefore,
    settings.notifyUrgentMinutesBefore,
    settings.disabledCategories,
    settings.devMode,
    settings.debugOffset
  ]);

  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const hasInitialJumpFiredRef = useRef(false);
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
    if (type !== 'void' && !hasInitialJumpFiredRef.current) {
      // We don't set it to true here anymore, we let the useEffect or handleDayClick do it.
      // But if they just manually scrolled without clicking anything, we should probably set it.
      if (type === 'manual') hasInitialJumpFiredRef.current = true;
    }

    // 4. Vertical alignment when dragging DaySelector (same as clicking a day)
    const isDesktop = window.innerWidth >= 800;
    if (!isDesktop && (type === 'daySelector' || type === 'manual')) {
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
        } else if (window.scrollY < 10) {
          window.scrollTo({ top: 0, behavior: 'auto' });
        }
      }, 50);
    }
  }, [daySelectorRef, scrollRef]);

  const { 
    activeIndex, 
    setActiveIndex, 
    scrollToDay 
  } = useScrollSync({ 
    dayCount: filteredDays.length,
    onIndexChange: handleIndexChange,
    scrollRef,
    daySelectorRef,
    hapticsEnabled: settings.hapticsEnabled,
    soundEnabled: settings.soundEnabled
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
    scrollToDay(index); 
    
    // Enable haptics for subsequent interactions if not already enabled
    hasInitialJumpFiredRef.current = true;

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
          const targetTime = new Date(dayDate);
          targetTime.setHours(h, m, 0);
          
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

  const performSmartJump = useCallback((index: number, targetActivity?: { title?: string; id?: string } | string | null | undefined, isInitial: boolean = false) => {
    if (index === -1) return;
    void isInitial; // Ignored since all programmatic scrolls are now instant by definition
    
    scrollToDay(index);

    // Instant jump: wait just a small 50ms layout settle tick
    const verticalDelay = 50;

    setTimeout(() => {
      // 1. Try to find the specific target activity if provided
      let targetCard: HTMLElement | null = null;
      
      // Support both old signature (targetTitle: string) and new (targetActivity: { title, id })
      let targetTitle: string | undefined;
      let targetId: string | undefined;
      if (typeof targetActivity === 'string') {
        targetTitle = targetActivity;
      } else if (targetActivity && typeof targetActivity === 'object') {
        targetTitle = targetActivity.title;
        targetId = targetActivity.id;
      }
      
      if (targetTitle || targetId) {
        const activeSlide = document.querySelector(`.swipe-slide[data-index="${index}"]`);
        if (activeSlide) {
          // First try exact ID match (most precise)
          if (targetId) {
            targetCard = activeSlide.querySelector(`.activity-card[data-id="${targetId}"]`) as HTMLElement;
          }
          
          // Try exact title match
          if (!targetCard && targetTitle) {
            targetCard = activeSlide.querySelector(`.activity-card[data-title="${targetTitle}"]`) as HTMLElement;
          }
          
          // Fallback: if title match failed, try to find the best match by comparing full titles
          if (!targetCard && targetTitle) {
            const candidates = activeSlide.querySelectorAll('.activity-card');
            for (const card of candidates) {
              const cardTitle = card.getAttribute('data-title') || '';
              if (targetTitle.startsWith(cardTitle) || cardTitle.startsWith(targetTitle)) {
                const targetLen = targetTitle.length;
                const cardLen = cardTitle.length;
                if (Math.abs(targetLen - cardLen) >= 5) {
                  targetCard = card as HTMLElement;
                  break;
                }
              }
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
        const scrollerRect = isDesktop ? scrollRef.current?.getBoundingClientRect() : document.documentElement.getBoundingClientRect();
        const cardRect = targetCard.getBoundingClientRect();
        const absoluteTop = cardRect.top - (scrollerRect?.top || 0) + (isDesktop ? (scrollRef.current?.scrollTop || 0) : 0);
        
        const viewportHeight = isDesktop ? (scrollRef.current?.offsetHeight || window.innerHeight) : window.innerHeight;
        const headerEl = document.querySelector('.day-selector');
        const headerHeight = isDesktop ? 0 : (headerEl?.getBoundingClientRect().height || 96);
        const targetY = absoluteTop - headerHeight - (viewportHeight * 0.15);
        
        scroller?.scrollTo({ 
          top: Math.max(0, targetY), 
          behavior: 'auto' 
        });
      }
    }, verticalDelay);
  }, [scrollToDay, scrollRef]);

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
        const container = document.querySelector('.swipe-container-outer');
        if (container) {
          container.scrollLeft = 0;
          container.scrollTop = 0;
        }
        const daySelector = document.querySelector('.day-selector');
        if (daySelector) {
          daySelector.scrollLeft = 0;
        }
      }
    }
  }, [searchTerm, setActiveIndex]);

  // Live Pill Tracking
  const activeEvents = useMemo(() => {
    if (!itinerary) return { currentEvent: null, nextEvent: null };
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const todayIdx = filteredDays.findIndex(d => isSameDay(d.date, currentTime));
    if (todayIdx === -1) return { currentEvent: null, nextEvent: null };

    const today = filteredDays[todayIdx];
    
    // 1. Find CURRENT (Unified Logic)
    const currentAct = findActivityAtTime(today.activities, nowMin);
    const current = currentAct ? { ...currentAct, dayIdx: todayIdx } : null;

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

    return { currentEvent: current, nextEvent: next };
  }, [itinerary, filteredDays, currentTime, isSameDay]);

  // One-time initialization - reuse activeEvents logic for consistency with pill click
  useEffect(() => {
    if (!loading && itinerary && !hasInitialJumpFiredRef.current) {
      hasInitialJumpFiredRef.current = true;
      
      // Use the same activeEvents logic as the pill click for consistency
      const target = activeEvents.currentEvent || activeEvents.nextEvent;
      if (target && typeof target.dayIdx === 'number') {
        setTimeout(() => performSmartJump(target.dayIdx, { title: target.fullTitle || target.title, id: target.id }, true), 300);
      }
    }
  }, [loading, itinerary, activeEvents, performSmartJump]);


  
  const jumpToNow = useCallback((isInitial: boolean = false) => {
    const target = activeEvents.currentEvent || activeEvents.nextEvent;
    if (target && typeof target.dayIdx === 'number') {
      // Pass full activity object with fullTitle for precise matching
      performSmartJump(target.dayIdx, { title: target.fullTitle || target.title, id: target.id }, isInitial);
    } else {
      const todayIdx = filteredDays.findIndex(d => isSameDay(d.date, currentTime));
      if (todayIdx !== -1) performSmartJump(todayIdx, null, isInitial);
    }
  }, [activeEvents, filteredDays, isSameDay, currentTime, performSmartJump]);

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

  // Synchronize Day Changes Index Ref
  useEffect(() => {
    prevIndexRef.current = activeIndex;
  }, [activeIndex]);

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
    // If data is ready and we have a pending jump, do it now
    if (!loading && itinerary && pendingJump) {
      jumpToNow(true);
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
            jumpToNow(true);
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
          jumpToNow(true);
        }
      }
    };

    // Check immediately on mount for deep link
    const params = new URLSearchParams(window.location.search);
    if (params.get('from_notification')) {
      if (loading) {
        setTimeout(() => setPendingJump(true), 0);
      } else {
        jumpToNow(true);
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
  }, [filteredDays, currentTime, performSmartJump, loading, itinerary, pendingJump, isSameDay, jumpToNow]);

  // Automatic Notifications for upcoming activities removed!
  // Notifications are now completely driven by the backend server via Web Push.





  if (loading && !itinerary) {
    return (
      <div className="splash-screen">
        <div className="splash-backdrop" style={{ backgroundImage: `url(${heroImg})` }}></div>
        <div className="splash-overlay"></div>
        <div className="splash-content">
          <h1 className="splash-title">Waddling Around Japan</h1>
          <p className="splash-subtitle">Your Premium Travel Guide</p>
          <div className="splash-loader">
            <div className="splash-loader-bar"></div>
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
            <div className="sidebar-meta">
              <span>Last sync: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="sidebar-version">v{APP_VERSION}</span>
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
            <SearchBar 
              searchTerm={searchTerm} 
              setSearchTerm={setSearchTerm} 
              categories={categoryData.names}
              categoryColors={categoryData.colors}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
            />
          </div>



          <DaySelector 
            ref={daySelectorRef} 
            days={filteredDays} 
            searchTerm={searchTerm} 
            activeIndex={activeIndex} 
            onDayClick={handleDayClick} 
            hapticsEnabled={settings.hapticsEnabled}
            soundEnabled={settings.soundEnabled}
          />
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
                    regions={day.regions}
                    currentTime={currentTime}
                    activeCardRef={activeCardRef}
                    timeToMinutes={timeToMinutes}
                    isToday={isSameDay(day.date, currentTime)}
                    categoryColors={categoryData.colors}
                    nextEvent={activeEvents.nextEvent}
                    onCardClick={() => {
                      if (window.innerWidth >= 800) {
                        handleDayClick(index);
                      }
                    }}
                    settings={settings}
                    isActive={index === activeIndex}
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
        nextEvent={activeEvents.nextEvent} 
        isLiveCardInView={isLiveCardInView} 
        jumpToNow={() => jumpToNow(true)} 
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
        onSyncAll={async () => {
          // Clear all local weather & advisor caches first
          Object.keys(localStorage).forEach(key => {
            if (key.startsWith('real_weather_') || key.startsWith('ai_advisory_')) {
              localStorage.removeItem(key);
            }
          });
          window.dispatchEvent(new Event('advisor_cache_updated'));

          // Reload itinerary from sheets
          await loadData(true);
          // Sync advisor/weather cache from server
          await syncAdvisorCache();
          // Check for PWA/service worker updates
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then(async r => {
              if (r) await r.update();
            });
          }
        }}
        onRegenerate={async () => {
          try {
            const apiUrl = getApiUrl();
            const response = await fetch(`${apiUrl}/regenerate`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'Bypass-Tunnel-Reminder': 'true'
              }
            });
            const data = await response.json();
            if (response.ok) {
              alert(`✅ ${data.message}`);
              
              // Clear all local weather & advisor caches first
              Object.keys(localStorage).forEach(key => {
                if (key.startsWith('real_weather_') || key.startsWith('ai_advisory_')) {
                  localStorage.removeItem(key);
                }
              });
              window.dispatchEvent(new Event('advisor_cache_updated'));

              // After server regenerates, pull fresh data
              await loadData(true);
              await syncAdvisorCache();
            } else {
              alert(`❌ Regeneration failed: ${data.error}`);
            }
          } catch (err) {
            console.error('Failed to call regenerate endpoint:', err);
            alert('❌ Failed to reach server. Check your connection.');
          }
        }}
      />

      {showSplash && (
        <div className={`splash-screen ${isSplashFading ? 'fade-out' : ''}`}>
          <div className="splash-backdrop" style={{ backgroundImage: `url(${heroImg})` }}></div>
          <div className="splash-overlay"></div>
          <div className="splash-content">
            <h1 className="splash-title">Waddling Around Japan</h1>
            <p className="splash-subtitle">Your Premium Travel Guide</p>
            <div className="splash-loader">
              <div className="splash-loader-bar done"></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
