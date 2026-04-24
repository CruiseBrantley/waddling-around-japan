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
  const [activeIndex, setActiveIndex] = useState(0);
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

  // Update active index based on intersection
  useEffect(() => {
    if (loading || !itinerary) return;

    const options = {
      root: scrollRef.current,
      threshold: 0.5
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Number(entry.target.getAttribute('data-index'));
          setActiveIndex(index);
        }
      });
    }, options);

    // We need to wait for the DOM to be ready
    const timer = setTimeout(() => {
      const slides = scrollRef.current?.querySelectorAll('.swipe-slide');
      slides?.forEach(slide => observer.observe(slide));
    }, 100);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [loading, itinerary]);

  const [retryKey, setRetryKey] = useState(0);
  const listenersAttachedRef = useRef(false);
  const activeScrollerRef = useRef<'main' | 'day' | null>(null);
  const scrollEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect when refs are ready and attach listeners
  useEffect(() => {
    if (listenersAttachedRef.current) return;

    const container = scrollRef.current;
    const daySelector = daySelectorRef.current;
    
    if (!container || !daySelector) {
      const timeout = setTimeout(() => setRetryKey(prev => prev + 1), 50);
      return () => clearTimeout(timeout);
    }

    listenersAttachedRef.current = true;

    const ITEM_WIDTH = 76; // 64px width + 12px gap

    const onMainScroll = () => {
      if (activeScrollerRef.current !== 'main') return;
      
      requestAnimationFrame(() => {
        const progress = container.scrollLeft / container.clientWidth;
        daySelector.scrollLeft = progress * ITEM_WIDTH;
      });
    };

    const onDayScroll = () => {
      if (activeScrollerRef.current !== 'day') return;
      
      requestAnimationFrame(() => {
        const progress = daySelector.scrollLeft / ITEM_WIDTH;
        container.scrollLeft = progress * container.clientWidth;
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

  const scrollToDay = (index: number) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        left: index * scrollRef.current.offsetWidth,
        behavior: 'smooth'
      });
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
        activeIndex={activeIndex}
        onDayClick={scrollToDay}
      />

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
            return month === String(currentTime.getMonth() + 1) && 
                   dayOfMonth === String(currentTime.getDate()) && 
                   year === String(currentTime.getFullYear()).slice(-2);
          })();

          return (
            <div key={day.date} className="swipe-slide" data-index={index}>
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
