import { useState, useEffect, useRef } from 'react'
import { fetchItinerary, type Itinerary } from './services/sheets'
import heroImg from './assets/hero.png'
import mapImg from './assets/map_minimalist.png'
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
  const activeScrollerRef = useRef<'main' | 'day' | null>(null);
  const scrollEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const listenersAttachedRef = useRef(false);

  // Initial & Triggered Auto-scroll to active card
  useEffect(() => {
    if (activeCardRef.current && !loading) {
      setTimeout(() => {
        activeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        hasInitialScrolled.current = true;
      }, 150); 
    }
  }, [loading, scrollTrigger]);

  // Load Itinerary
  useEffect(() => {
    fetchItinerary()
      .then(data => {
        setItinerary(data);
        setLoading(false);
      })
       .catch(err => {
         setError(err.message);
         setLoading(false);
       });
   }, []);

   // Handle initial scroll to today's day
   useEffect(() => {
     if (!loading && itinerary && scrollRef.current) {
       const now = getInitialTime();
       const todayIdx = itinerary.days.findIndex(d => {
         const dateMatch = d.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
         if (!dateMatch) return false;
         const [, month, dayOfMonth, year] = dateMatch;
         return month === String(now.getMonth() + 1) && 
                dayOfMonth === String(now.getDate()) && 
                year === String(now.getFullYear()).slice(-2);
       });

       if (todayIdx !== -1) {
         const timer = setTimeout(() => {
           if (scrollRef.current) {
             activeScrollerRef.current = 'main';
             
             if (window.innerWidth < 1024) {
               scrollRef.current.scrollTo({
                 left: todayIdx * scrollRef.current.offsetWidth,
                 behavior: 'auto'
               });
             } else {
               const slides = scrollRef.current.querySelectorAll('.swipe-slide');
               slides[todayIdx]?.scrollIntoView({ behavior: 'auto', block: 'start' });
             }
             
             if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
             scrollEndTimeoutRef.current = setTimeout(() => {
               activeScrollerRef.current = null;
               // Trigger the vertical card scroll after horizontal/day scroll is done
               setScrollTrigger(prev => prev + 1);
             }, 150);
           }
         }, 100);
         return () => clearTimeout(timer);
       }
     }
   }, [loading, itinerary]);

  // Update time for "Live Now" tracking
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(getInitialTime());
    }, 10000); // 10s check
    return () => clearInterval(timer);
  }, []);

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
  
  // Sidebar sync for desktop: scroll the active day into view
  useEffect(() => {
    if (window.innerWidth >= 1024 && daySelectorRef.current) {
      const activeBtn = daySelectorRef.current.querySelector('.day-btn.is-active');
      if (activeBtn) {
        activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [activeIndex]);

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
      if (activeScrollerRef.current === 'day') return;
      
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
    const targetMonth = now.getMonth() + 1;
    const targetDay = now.getDate();
    const targetYear = String(now.getFullYear()).slice(-2);

    const todayIdx = itinerary?.days.findIndex(d => {
      const dateMatch = d.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
      if (!dateMatch) return false;
      
      const [, month, dayOfMonth, year] = dateMatch;
      // Parse to integers to safely ignore leading zeros (e.g., "04" vs 4)
      return parseInt(month, 10) === targetMonth && 
             parseInt(dayOfMonth, 10) === targetDay && 
             year === targetYear;
    });

    if (todayIdx !== undefined && todayIdx !== -1 && scrollRef.current) {
      activeScrollerRef.current = 'main';
      
      const slides = scrollRef.current.querySelectorAll('.swipe-slide');
      const targetSlide = slides[todayIdx];

      if (targetSlide) {
        // scrollIntoView handles both X and Y axis natively
        if (window.innerWidth < 1024) {
          targetSlide.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        } else {
          targetSlide.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        }
      }

      // Defer the state update so it doesn't interrupt the scroll animation
      requestAnimationFrame(() => {
        setScrollTrigger(prev => prev + 1);
      });
      
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
      
      // Increased timeout to account for the duration of smooth scrolling
      scrollEndTimeoutRef.current = setTimeout(() => {
        activeScrollerRef.current = null;
      }, 500); 
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
        const daySelector = daySelectorRef.current?.closest('.day-selector') as HTMLElement;
        const stickyPoint = daySelector ? daySelector.offsetTop : 0;
        const shouldScrollVertically = window.scrollY >= (stickyPoint - 5);

        if (shouldScrollVertically) {
          targetSlide.scrollIntoView({ 
            behavior: 'smooth', 
            inline: 'start', 
            block: 'start' 
          });
        } else {
          // If at the top, ONLY scroll horizontally.
          // Using scrollRef.current.scrollTo is safer than scrollIntoView(block: 'nearest')
          // because it guarantees the window won't move at all.
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
    <div className="app-wrapper">
      <div className="main-layout">
        <aside className="sidebar">
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
              return month === String(currentTime.getMonth() + 1) && 
                     dayOfMonth === String(currentTime.getDate()) && 
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

        <aside className="info-panel">
          <div className="info-panel-content">
            <div className="map-card glass">
              <img src={mapImg} alt="Japan Map" className="map-image" />
              <div className="map-overlay">
                <span className="location-label">EXPLORING JAPAN</span>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card glass">
                <span className="stat-value">{itinerary?.days[activeIndex]?.activities.length || 0}</span>
                <span className="stat-label">ACTIVITIES</span>
              </div>
              <div className="stat-card glass">
                <span className="stat-value">{activeIndex + 1}</span>
                <span className="stat-label">TRIP DAY</span>
              </div>
            </div>

            <div className="tips-card glass">
              <h3 className="tips-title">Travel Tips</h3>
              <ul className="tips-list">
                <li>Check JR Pass compatibility for today's routes.</li>
                <li>Keep your Pasmo/Suica card topped up.</li>
                <li>Don't forget to try the local specialties!</li>
              </ul>
            </div>
          </div>
        </aside>
      </div>

      {itinerary && (
        <button 
          className={`floating-now-btn glass ${!isLiveCardInView ? 'visible' : ''}`} 
          onClick={jumpToNow}
        >
          <span className="pulse-dot"></span>
          NOW
        </button>
      )}
    </div>
  )
}

export default App
