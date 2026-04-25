import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchItinerary, type Itinerary } from './services/sheets'
import heroImg from './assets/hero_optimized.jpg'
import { useRegisterSW } from 'virtual:pwa-register/react'
import './App.css'

/// <reference types="vite-plugin-pwa/react" />

// Modular Components
import { Hero } from './components/Hero'
import { SearchBar } from './components/SearchBar'
import { DaySelector } from './components/DaySelector'
import { ActivityList } from './components/ActivityList'
import { timeToMinutes } from './utils/time'

function App() {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(() => {
    return sessionStorage.getItem('itinerary_searchTerm') || '';
  });
  
  // Clear search term from session storage after initialization
  useEffect(() => {
    sessionStorage.removeItem('itinerary_searchTerm');
  }, []);
  
  // Support URL parameter for testing specific dates (e.g., ?date=2026-05-28T14:30:00)
  // We calculate an offset so that time "flows" naturally from the mock date
  const [timeOffset] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const mockDateStr = params.get('date');
    if (mockDateStr) {
      const mockDate = new Date(mockDateStr);
      if (!isNaN(mockDate.getTime())) {
        return mockDate.getTime() - Date.now();
      }
    }
    return 0;
  });

  const getInitialTime = useCallback(() => new Date(Date.now() + timeOffset), [timeOffset]);

  const [currentTime, setCurrentTime] = useState(() => getInitialTime());
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const daySelectorRef = useRef<HTMLDivElement>(null);
  const hasInitialScrolled = useRef(false);
  const hasInitialDayScrolled = useRef(false);
  const activeScrollerRef = useRef<'main' | 'day' | null>(null);
  const scrollEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r: ServiceWorkerRegistration | undefined) {
      console.log('SW Registered:', r);
    }
  });

  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const isManualJumpingRef = useRef(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  // Handle Orientation Change by reloading (Ensures perfect alignment on mobile)
  useEffect(() => {
    const mql = window.matchMedia('(orientation: portrait)');
    
    const handleOrientationChange = () => {
      // Save current search term to sessionStorage before reload
      sessionStorage.setItem('itinerary_searchTerm', searchTerm);
      window.location.reload();
    };

    // Modern browsers use 'change' event on the media query list
    mql.addEventListener('change', handleOrientationChange);
    return () => mql.removeEventListener('change', handleOrientationChange);
  }, [searchTerm]);

  // Initial & Triggered Auto-scroll to active card
  useEffect(() => {
    if (activeCardRef.current && !loading) {
      // Only scroll if we haven't scrolled initially yet, OR if this was an explicit trigger (NOW button)
      if (!hasInitialScrolled.current || scrollTrigger > 0) {
        // If we are currently performing a manual horizontal jump, wait slightly for the DOM to settle.
        // If it's a same-day jump or initial load, trigger instantly.
        const delay = isManualJumpingRef.current ? 50 : 0;
        
        setTimeout(() => {
          activeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          hasInitialScrolled.current = true;
        }, delay); 
      }
    }
  }, [loading, scrollTrigger]);

  // Load Itinerary
  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchItinerary();
      setItinerary(data);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load itinerary');
    } finally {
      setLoading(false);
      if (isRefresh) {
        setTimeout(() => setRefreshing(false), 1000);
      }
    }
  }, []);

  useEffect(() => {
    // Calling loadData in a timeout to avoid strict 'set-state-in-effect' errors
    const initTimer = setTimeout(() => {
      loadData();
    }, 0);
    
    // Silent background sync when user returns to app
    const handleFocus = () => loadData(true);
    window.addEventListener('focus', handleFocus);
    return () => {
      clearTimeout(initTimer);
      window.removeEventListener('focus', handleFocus);
    };
   }, [loadData]);

// Handle initial scroll to today's day
  useEffect(() => {
    // Keep a reference to the initial timer so we can clear it
    let initialTimer: ReturnType<typeof setTimeout> | undefined;

    if (!loading && itinerary && scrollRef.current && !hasInitialDayScrolled.current) {
      const now = getInitialTime();
      
      let todayIdx = itinerary.days.findIndex(d => {
        const dateMatch = d.date.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
        if (!dateMatch) return false;
        const m = parseInt(dateMatch[1], 10);
        const d_num = parseInt(dateMatch[2], 10);
        const y = dateMatch[3];
        const fullYear = y.length === 2 ? `20${y}` : y;
        
        return m === now.getMonth() + 1 && 
               d_num === now.getDate() && 
               fullYear === String(now.getFullYear());
      });

      if (todayIdx === -1 && itinerary.days.length > 0) {
        todayIdx = 0;
      }

      if (todayIdx === 0) {
        // Wrap in a timeout to satisfy strict set-state-in-effect rules
        initialTimer = setTimeout(() => {
          hasInitialDayScrolled.current = true;
          setActiveIndex(0);
          setScrollTrigger(prev => prev + 1);
        }, 0);
      } else if (todayIdx !== -1) {
        
        initialTimer = setTimeout(() => {
          if (scrollRef.current) {
            activeScrollerRef.current = 'main';
            
            if (window.innerWidth < 1024) {
              scrollRef.current.scrollTo({
                left: todayIdx * scrollRef.current.offsetWidth,
                behavior: 'auto'
              });
            } else {
              const slides = scrollRef.current.querySelectorAll('.swipe-slide');
              // Fix: Use inline: 'start' for horizontal, block: 'nearest' to stop vertical jumps
              slides[todayIdx]?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'start' });
            }
            
            if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
            
            scrollEndTimeoutRef.current = setTimeout(() => {
              activeScrollerRef.current = null;
              setScrollTrigger(prev => prev + 1);
              hasInitialDayScrolled.current = true;
            }, 150);
          }
        }, 100);
      }
    }

    // Cleanup function handles BOTH timeouts to prevent memory leaks on unmount
    return () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    };
  }, [loading, itinerary, getInitialTime]);

  // High-efficiency "Live Now" tracking
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    let intervalId: ReturnType<typeof setInterval>;
    
    const updateTime = () => setCurrentTime(getInitialTime());

    const startSync = () => {
      const now = getInitialTime();
      updateTime();
      
      // Calculate ms until the next full minute starts based on the mocked timeline
      const msUntilNextMinute = 60000 - (now.getTime() % 60000);
      
      timeoutId = setTimeout(() => {
        updateTime();
        intervalId = setInterval(updateTime, 60000);
      }, msUntilNextMinute);
    };

    startSync();

    // Instant refresh when user returns to tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        startSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [timeOffset, getInitialTime]);

  const [isLiveCardInView, setIsLiveCardInView] = useState(true);

  // Monitor if the Live card is in view (using viewport as root to correctly detect visibility)
  useEffect(() => {
    if (!activeCardRef.current) {
      setIsLiveCardInView(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsLiveCardInView(entry.isIntersecting);
      },
      { 
        root: null,
        threshold: 0.1 
      }
    );

    observer.observe(activeCardRef.current);
    return () => observer.disconnect();
  }, [currentTime, loading]);

  const intersectingRef = useRef<Set<number>>(new Set());

  // Update active index based on intersection
  useEffect(() => {
    if (loading || !itinerary) return;

    const isDesktop = window.innerWidth >= 1024;
    intersectingRef.current.clear();
    
    const options = {
      root: scrollRef.current,
      // Desktop: trigger as soon as it enters the top 40% of the screen
      // Mobile: trigger when 50% visible for snapping
      threshold: isDesktop ? 0 : 0.5,
      rootMargin: isDesktop ? '0% 0% -75% 0%' : '0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const index = Number(entry.target.getAttribute('data-index'));
        if (entry.isIntersecting) {
          intersectingRef.current.add(index);
        } else {
          intersectingRef.current.delete(index);
        }
      });

      const allIntersecting = Array.from(intersectingRef.current).sort((a, b) => a - b);
      if (allIntersecting.length > 0) {
        // The active day is the one with the highest index that is currently in the trigger zone
        const newIndex = allIntersecting[allIntersecting.length - 1];
        setActiveIndex(newIndex);
      }
    }, options);

    // We need to wait for the DOM to be ready
    const timer = setTimeout(() => {
      const slides = scrollRef.current?.querySelectorAll('.swipe-slide');
      slides?.forEach(slide => observer.observe(slide));
    }, 150);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [loading, itinerary, retryKey]);

  useEffect(() => {
    if (!scrollRef.current || loading || !itinerary) return;
    
    // Only adjust vertical scroll if we are deep enough that the DaySelector is stuck at the top.
    // If we are still viewing the Hero/Search area, we don't want to jump.
    const daySelector = daySelectorRef.current?.closest('.day-selector') as HTMLElement;
    const stickyPoint = daySelector ? daySelector.offsetTop : 0;
    if (window.scrollY < stickyPoint - 5) return; 

    const container = scrollRef.current;
    const slides = container.querySelectorAll('.swipe-slide');
    const activeSlide = slides[activeIndex] as HTMLElement;
    
    if (!activeSlide) return;

    const updateScrollPosition = () => {
      const slideHeight = activeSlide.offsetHeight;
      const rect = container.getBoundingClientRect();
      const absoluteMainTop = rect.top + window.scrollY;
      const viewportHeight = window.innerHeight;
      
      const contentBottom = absoluteMainTop + slideHeight;
      const currentViewBottom = window.scrollY + viewportHeight;
      
      if (currentViewBottom > contentBottom) {
        const targetScroll = contentBottom - viewportHeight;
        window.scrollTo({
          top: Math.max(0, targetScroll),
          behavior: 'smooth'
        });
      }
    };

    const timer = setTimeout(updateScrollPosition, 50);
    return () => clearTimeout(timer);
  }, [activeIndex, loading, itinerary]);
  
  // Detect when refs are ready and attach listeners
  useEffect(() => {

    const container = scrollRef.current;
    const daySelector = daySelectorRef.current;
    
    if (!container || !daySelector) {
      const timeout = setTimeout(() => setRetryKey((prev: number) => prev + 1), 50);
      return () => clearTimeout(timeout);
    }

    const ITEM_WIDTH = 76; // 64px width + 12px gap

    const onMainScroll = () => {
      if (activeScrollerRef.current === 'day') return;
      
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
      scrollEndTimeoutRef.current = setTimeout(() => {
        if (isManualJumpingRef.current) {
          isManualJumpingRef.current = false;
          setScrollTrigger(prev => prev + 1);
        }
      }, 150);

      requestAnimationFrame(() => {
        if (window.innerWidth < 1024) {
          const progress = container.scrollLeft / container.clientWidth;
          daySelector.scrollLeft = progress * ITEM_WIDTH;
        } else {
          // On desktop, we could sync vertical scroll if needed, 
          // but for now let IntersectionObserver handle activeIndex
        }
      });
    };

    const onDayScroll = () => {
      if (activeScrollerRef.current === 'main') return;
      
      requestAnimationFrame(() => {
        if (window.innerWidth < 1024) {
          const progress = daySelector.scrollLeft / ITEM_WIDTH;
          container.scrollLeft = progress * container.clientWidth;
        }
      });
    };

    const onInteractionStart = (type: 'main' | 'day') => {
      activeScrollerRef.current = type;
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    };

    const onInteractionEnd = () => {
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
      scrollEndTimeoutRef.current = setTimeout(() => {
        activeScrollerRef.current = null;
      }, 150);
    };

    container.addEventListener('scroll', onMainScroll, { passive: true });
    container.addEventListener('touchstart', () => onInteractionStart('main'), { passive: true });
    container.addEventListener('pointerdown', () => onInteractionStart('main'));
    window.addEventListener('touchend', onInteractionEnd);
    window.addEventListener('pointerup', onInteractionEnd);
    
    daySelector.addEventListener('scroll', onDayScroll, { passive: true });
    daySelector.addEventListener('touchstart', () => onInteractionStart('day'), { passive: true });
    daySelector.addEventListener('pointerdown', () => onInteractionStart('day'));

    return () => {
      container.removeEventListener('scroll', onMainScroll);
      window.removeEventListener('touchend', onInteractionEnd);
      window.removeEventListener('pointerup', onInteractionEnd);
      daySelector.removeEventListener('scroll', onDayScroll);
    };
  }, [itinerary, retryKey]); // Update listeners if itinerary changes or retry is triggered

  if (loading) {
    return (
      <div className="loader-container">
        <div className="shimmer-card"></div>
        <div className="shimmer-card" style={{ opacity: 0.6 }}></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container" style={{ paddingTop: '80px', textAlign: 'center' }}>
        <div className="glass" style={{ padding: '32px', borderRadius: '24px' }}>
          <h2 style={{ color: 'var(--primary)', marginBottom: '12px' }}>Connection Error</h2>
          <p style={{ marginBottom: '24px', opacity: 0.8 }}>{error}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Retry Connection
          </button>
        </div>
      </div>
    )
  }


  const getTodayIdx = () => {
    if (!itinerary) return -1;
    const now = currentTime;
    const targetMonth = now.getMonth() + 1;
    const targetDay = now.getDate();
    const targetYear = String(now.getFullYear()).slice(-2);

    return itinerary.days.findIndex(d => {
      // Use the robust date matching to prevent year-confusion and satisfy ESLint
      const dateMatch = d.date.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
      if (!dateMatch) return false;
      
      const m = parseInt(dateMatch[1], 10);
      const d_num = parseInt(dateMatch[2], 10);
      const y = dateMatch[3];
      const fullYear = y.length === 2 ? `20${y}` : y;
      
      return m === targetMonth && 
             d_num === targetDay && 
             fullYear === `20${targetYear}`;
    });
  };

  const getNextEvent = () => {
    if (!itinerary) return null;
    const now = currentTime;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    
    // 1. Check remaining events for Today
    const todayIdx = getTodayIdx();
    if (todayIdx !== -1) {
      const today = itinerary.days[todayIdx];
      const nextToday = today.activities.find(a => timeToMinutes(a.time) > nowMinutes);
      if (nextToday) {
        return { 
          title: nextToday.title, 
          minutes: timeToMinutes(nextToday.time) - nowMinutes 
        };
      }
      
      // 2. If today is done, check tomorrow's first event
      const tomorrow = itinerary.days[todayIdx + 1];
      if (tomorrow && tomorrow.activities.length > 0) {
        const firstTomorrow = tomorrow.activities[0];
        const minsRemainingToday = 1440 - nowMinutes;
        return { 
          title: firstTomorrow.title, 
          minutes: minsRemainingToday + timeToMinutes(firstTomorrow.time) 
        };
      }
    }
    return null;
  };

  const nextEvent = getNextEvent();
  const todayIdx = getTodayIdx();
  const isTripActive = todayIdx !== -1;

  // Jump to today and current activity
  const jumpToNow = () => {
    if (itinerary && scrollRef.current) {
      const now = getInitialTime();
      const todayIdx = itinerary.days.findIndex(d => {
        // More robust date matching: handles MM/DD/YY, M/D/YY, and MM/DD/YYYY
        const dateMatch = d.date.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
        if (!dateMatch) return false;
        
        const m = parseInt(dateMatch[1], 10);
        const d_num = parseInt(dateMatch[2], 10);
        const y = dateMatch[3];
        
        // Normalize 2-digit years to 4-digits for accurate matching
        const fullYear = y.length === 2 ? `20${y}` : y;
        
        return m === now.getMonth() + 1 && 
               d_num === now.getDate() && 
               fullYear === String(now.getFullYear());
      });

      if (todayIdx !== -1) {
        const isSameDay = activeIndex === todayIdx;

        if (isSameDay) {
          // If already on the right day, just trigger the vertical snap
          setScrollTrigger(prev => prev + 1);
        } else {
          // Calculate exact pixel target for horizontal scroll
          const container = scrollRef.current;
          const targetX = todayIdx * container.offsetWidth;
          
          activeScrollerRef.current = 'main';
          isManualJumpingRef.current = true;
          
          // Force pixel-perfect horizontal scroll
          container.scrollTo({
            left: targetX,
            behavior: 'smooth'
          });

          // Sync the DaySelector immediately as well
          const daySelector = daySelectorRef.current;
          if (daySelector) {
            const ITEM_WIDTH = 76; // 64px width + 12px gap
            daySelector.scrollTo({
              left: todayIdx * ITEM_WIDTH,
              behavior: 'smooth'
            });
          }

          // Safety fallback for vertical jump
          if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
          scrollEndTimeoutRef.current = setTimeout(() => {
            if (isManualJumpingRef.current) {
              isManualJumpingRef.current = false;
              setScrollTrigger(prev => prev + 1);
            }
          }, 600); // Slightly longer safety for multi-day glides
        }
      }
    }
  };

  const scrollToDay = (index: number) => {
    // Early return to keep the rest of the code clean
    if (!scrollRef.current) return;

    activeScrollerRef.current = 'main';
    
    const slides = scrollRef.current.querySelectorAll('.swipe-slide');
    const targetSlide = slides[index];

    if (targetSlide) {
      if (window.innerWidth < 1024) {
        const daySelector = daySelectorRef.current;
        if (daySelector) {
          const ITEM_WIDTH = 76; // 64px width + 12px gap
          daySelector.scrollTo({
            left: index * ITEM_WIDTH,
            behavior: 'smooth'
          });
        }

        const daySelectorContainer = daySelectorRef.current?.closest('.day-selector') as HTMLElement;
        const stickyPoint = daySelectorContainer ? daySelectorContainer.offsetTop : 0;
        const shouldScrollVertically = window.scrollY >= (stickyPoint - 5);

        if (shouldScrollVertically) {
          targetSlide.scrollIntoView({ 
            behavior: 'smooth', 
            inline: 'start', 
            block: 'start' 
          });
        } else {
          scrollRef.current.scrollTo({
            left: index * scrollRef.current.offsetWidth,
            behavior: 'smooth'
          });
        }
      } else {
        targetSlide.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'start' });
      }
    }
    
    if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    
    // 500ms is usually the sweet spot. 1000ms leaves the scroll locked for too long.
    scrollEndTimeoutRef.current = setTimeout(() => {
      activeScrollerRef.current = null;
    }, 500); 
  };


  return (
    <div 
      className="app-wrapper" 
      style={{ touchAction: 'manipulation', '--hero-url': `url(${heroImg})` } as React.CSSProperties}
    >
      {/* Syncing Indicator */}
      <div className={`sync-indicator ${refreshing ? 'visible' : ''}`}>
        <span className="sync-dot"></span>
        Syncing...
      </div>

      <div className="main-layout">
        <aside className="sidebar">
          <Hero image={heroImg} />
          <SearchBar 
            title={itinerary?.title || 'Waddling Around Japan'} 
            searchTerm={searchTerm} 
            setSearchTerm={setSearchTerm} 
          />

          <div className="mobile-sync-status">
            <span>Last sync: {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <DaySelector 
            ref={daySelectorRef}
            days={itinerary?.days || []} 
            searchTerm={searchTerm}
            activeIndex={activeIndex}
            onDayClick={scrollToDay}
          />
        </aside>

        <main 
          ref={scrollRef}
          className="swipe-container-outer"
        >
          {itinerary?.days.map((day, index) => {
            const dayFilteredActivities = day.activities.filter(activity => {
              const term = searchTerm.toLowerCase();
              return (
                activity.title.toLowerCase().includes(term) ||
                activity.location.toLowerCase().includes(term) ||
                activity.notes.toLowerCase().includes(term) ||
                activity.category.toLowerCase().includes(term)
              );
            });

            // Check if it's the current day for "isToday" logic
            const dayIsToday = (() => {
              const dateMatch = day.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
              if (!dateMatch) return false;
              const [, month, dayOfMonth, year] = dateMatch;
              return parseInt(month, 10) === currentTime.getMonth() + 1 && 
                     parseInt(dayOfMonth, 10) === currentTime.getDate() && 
                     year === String(currentTime.getFullYear()).slice(-2);
            })();

            return (
              <div 
                key={day.date} 
                className={`swipe-slide ${activeIndex === index ? 'active' : ''}`} 
                data-index={index}
              >
                {dayFilteredActivities.length > 0 ? (
                  <ActivityList 
                    date={day.date} 
                    activities={dayFilteredActivities} 
                    currentTime={currentTime}
                    activeCardRef={activeCardRef}
                    timeToMinutes={timeToMinutes}
                    isToday={dayIsToday}
                  />
                ) : (
                  <div className="container" style={{ textAlign: 'center', paddingTop: '80px', opacity: 0.5 }}>
                    <p>{searchTerm ? 'No search results for this day.' : 'No activities planned.'}</p>
                  </div>
                )}
              </div>
            )
          })}
        </main>

      </div>

      {needRefresh && (
        <div className="update-toast glass">
          <div className="update-toast-content">
            <span className="update-icon">🚀</span>
            <div className="update-text">
              <strong>New version available!</strong>
              <span>Update now for the latest features.</span>
            </div>
          </div>
          <button className="update-btn" onClick={() => updateServiceWorker(true)}>
            RELOAD
          </button>
        </div>
      )}

      {itinerary && isTripActive && (
        <div className="floating-actions">
          <button 
            className={`floating-now-btn glass ${!isLiveCardInView ? 'visible' : ''}`} 
            onClick={jumpToNow}
          >
            <span className="pulse-dot"></span>
            NOW
          </button>
          {nextEvent && (
            <div className="upcoming-pill glass fade-in">
              <span className="upcoming-label">NEXT: {nextEvent.title}</span>
              <span className="upcoming-time">
                in {nextEvent.minutes >= 60 
                  ? `${Math.floor(nextEvent.minutes / 60)}h ${nextEvent.minutes % 60}m` 
                  : `${nextEvent.minutes}m`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
