import { useState, useEffect, useRef } from 'react'
import { fetchItinerary, type Itinerary } from './services/sheets'
import heroImg from './assets/hero.png'
import './App.css'

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
  const [searchTerm, setSearchTerm] = useState('');
  
  // --- MOCK TODAY FOR TESTING ---
  const MOCK_TODAY: string | null = "2026-05-28T14:30:00"; // Set to a specific date/time for testing
  const getInitialTime = () => MOCK_TODAY ? new Date(MOCK_TODAY) : new Date();

  const [currentTime, setCurrentTime] = useState(getInitialTime())
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const daySelectorRef = useRef<HTMLDivElement>(null);
  const hasInitialScrolled = useRef(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);

  // Initial & Triggered Auto-scroll to active card
  useEffect(() => {
    if (activeCardRef.current && !loading) {
      setTimeout(() => {
        activeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hasInitialScrolled.current = true;
      }, 800); 
    }
  }, [loading, scrollTrigger]);

  // Load Itinerary
  useEffect(() => {
    fetchItinerary()
      .then(data => {
        setItinerary(data);
        
        // Auto-select today if it falls within the trip dates
        const now = getInitialTime();
        const tripStart = new Date(data.days[0].date);
        const tripEnd = new Date(data.days[data.days.length - 1].date);
        
        // Auto-scroll to today on load
        if (now >= tripStart && now <= tripEnd) {
          const todayStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', year: '2-digit' });
          const todayIdx = data.days.findIndex(d => d.date.includes(todayStr.split(', ')[1]));
          if (todayIdx !== -1 && scrollRef.current) {
            setTimeout(() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTo({
                  left: todayIdx * scrollRef.current.offsetWidth,
                  behavior: 'smooth'
                });
              }
            }, 100);
          }
        }
        
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Update time for "Live Now" tracking
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getInitialTime());
    }, 30000); // 30s check
    return () => clearInterval(timer);
  }, []);

  const [isLiveCardInView, setIsLiveCardInView] = useState(true);

  // Monitor if the Live card is in view
  useEffect(() => {
    if (!activeCardRef.current) {
      setIsLiveCardInView(false);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsLiveCardInView(entry.isIntersecting);
      },
      { threshold: 0.1 }
    );

    observer.observe(activeCardRef.current);
    return () => observer.disconnect();
  }, [currentTime, loading]);

  const [scrollProgress, setScrollProgress] = useState(0);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingRef = useRef(false);

  const [retryKey, setRetryKey] = useState(0);
  const listenersAttachedRef = useRef(false);
  const activeScrollerRef = useRef<'main' | 'day' | null>(null);
  const scrollEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Detect when refs are ready and attach listeners
  useEffect(() => {
    // If listeners are already attached, don't do it again
    if (listenersAttachedRef.current) return;

    const container = scrollRef.current;
    const daySelector = daySelectorRef.current;
    
    // If refs aren't ready yet, retry after a short delay
    if (!container || !daySelector) {
      const timeout = setTimeout(() => {
        setRetryKey(prev => prev + 1);
      }, 50);
      return () => clearTimeout(timeout);
    }

    listenersAttachedRef.current = true;

    // Restore snapping and reset active scroller
    const endScroll = () => {
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
      scrollEndTimeoutRef.current = setTimeout(() => {
        if (container) {
          container.style.scrollSnapType = 'x mandatory';
          container.style.willChange = 'auto';
          // Update state only at the end to refresh UI highlights/active states
          const finalProgress = container.scrollLeft / container.offsetWidth;
          setScrollProgress(finalProgress);
        }
        if (daySelector) {
          daySelector.style.scrollSnapType = 'x proximity';
          daySelector.style.willChange = 'auto';
        }
        activeScrollerRef.current = null;
      }, 150);
    };

    // Main carousel: Update DaySelector directly via DOM
    const onMainScroll = () => {
      if (!container || !daySelector || activeScrollerRef.current !== 'main') return;
      
      requestAnimationFrame(() => {
        if (activeScrollerRef.current === 'main') {
          const progress = container.scrollLeft / container.offsetWidth;
          daySelector.scrollLeft = progress * 76;
        }
      });
      
      endScroll();
    };

    // Day selector: Update Main carousel directly via DOM
    const onDayScroll = () => {
      if (!daySelector || !container || activeScrollerRef.current !== 'day') return;
      
      requestAnimationFrame(() => {
        if (activeScrollerRef.current === 'day') {
          const progress = daySelector.scrollLeft / 76;
          container.scrollLeft = progress * container.offsetWidth;
        }
      });
      
      endScroll();
    };

    // Track which element user started dragging and disable snapping + hint GPU
    const onMainInteractionStart = () => {
      activeScrollerRef.current = 'main';
      if (container) {
        container.style.scrollSnapType = 'none';
        container.style.willChange = 'scroll-position';
      }
      if (daySelector) {
        daySelector.style.scrollSnapType = 'none';
        daySelector.style.willChange = 'scroll-position';
      }
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    };

    const onDayInteractionStart = () => {
      activeScrollerRef.current = 'day';
      if (container) {
        container.style.scrollSnapType = 'none';
        container.style.willChange = 'scroll-position';
      }
      if (daySelector) {
        daySelector.style.scrollSnapType = 'none';
        daySelector.style.willChange = 'scroll-position';
      }
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    };

    // Attach main carousel listeners
    container.addEventListener('scroll', onMainScroll, { passive: true });
    container.addEventListener('pointerdown', onMainInteractionStart);
    container.addEventListener('touchstart', onMainInteractionStart, { passive: true });
    
    // Attach day selector listeners
    daySelector.addEventListener('scroll', onDayScroll, { passive: true });
    daySelector.addEventListener('pointerdown', onDayInteractionStart);
    daySelector.addEventListener('touchstart', onDayInteractionStart, { passive: true });

    return () => {
      container.removeEventListener('scroll', onMainScroll);
      container.removeEventListener('pointerdown', onMainInteractionStart);
      container.removeEventListener('touchstart', onMainInteractionStart);
      
      daySelector.removeEventListener('scroll', onDayScroll);
      daySelector.removeEventListener('pointerdown', onDayInteractionStart);
      daySelector.removeEventListener('touchstart', onDayInteractionStart);
      
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    };
  }, [retryKey]);

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


  // Jump to today and current activity
  const jumpToNow = () => {
    const now = getInitialTime();
    const todayIdx = itinerary?.days.findIndex(d => {
      const dateMatch = d.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
      if (!dateMatch) return false;
      const [, month, dayOfMonth, year] = dateMatch;
      return month === String(now.getMonth() + 1) && 
             dayOfMonth === String(now.getDate()) && 
             year === String(now.getFullYear()).slice(-2);
    });

    if (todayIdx !== undefined && todayIdx !== -1 && scrollRef.current) {
      scrollRef.current.scrollTo({
        left: todayIdx * scrollRef.current.offsetWidth,
        behavior: 'smooth'
      });
      setScrollTrigger(prev => prev + 1);
    }
  };


  return (
    <div className="app-wrapper">
      <Hero image={heroImg} />

      <SearchBar 
        title={itinerary?.title || 'Waddling Around Japan'} 
        searchTerm={searchTerm} 
        setSearchTerm={setSearchTerm} 
      />

      <DaySelector 
        ref={daySelectorRef}
        days={itinerary?.days || []} 
        searchTerm={searchTerm}
        scrollProgress={scrollProgress}
      />

      <main 
        ref={scrollRef}
        className="swipe-container-outer"
      >
        {itinerary?.days.map((day) => {
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
            return month === String(currentTime.getMonth() + 1) && 
                   dayOfMonth === String(currentTime.getDate()) && 
                   year === String(currentTime.getFullYear()).slice(-2);
          })();

          return (
            <div key={day.date} className="swipe-slide">
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

      {itinerary && !isLiveCardInView && (
        <button className="floating-now-btn glass" onClick={jumpToNow}>
          <span className="pulse-dot"></span>
          NOW
        </button>
      )}
    </div>
  )
}

export default App
