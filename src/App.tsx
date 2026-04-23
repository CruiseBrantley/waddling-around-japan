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
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  
  // --- MOCK TODAY FOR TESTING ---
  const MOCK_TODAY: string | null = "2026-05-28T14:30:00"; // Set to a specific date/time for testing
  const getInitialTime = () => MOCK_TODAY ? new Date(MOCK_TODAY) : new Date();

  const [currentTime, setCurrentTime] = useState(getInitialTime())
  const activeCardRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
        
        if (now >= tripStart && now <= tripEnd) {
          const todayStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', year: '2-digit' });
          const todayIdx = data.days.findIndex(d => d.date.includes(todayStr.split(', ')[1]));
          if (todayIdx !== -1) setSelectedDayIndex(todayIdx);
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

  const isProgrammaticScroll = useRef(false);
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
  }, [currentTime, selectedDayIndex, loading]);

  // Sync scroll position when selectedDayIndex changes from outside (e.g. DaySelector)
  useEffect(() => {
    if (scrollRef.current) {
      const container = scrollRef.current;
      const targetScroll = selectedDayIndex * container.offsetWidth;
      
      if (Math.abs(container.scrollLeft - targetScroll) > 10) {
        isProgrammaticScroll.current = true;
        // Temporarily disable snapping for smooth transition
        container.style.scrollSnapType = 'none';
        
        container.scrollTo({
          left: targetScroll,
          behavior: 'smooth'
        });
        
        // Restore snapping after animation finishes
        setTimeout(() => {
          if (container) container.style.scrollSnapType = 'x mandatory';
          isProgrammaticScroll.current = false;
        }, 600);
      }
    }
  }, [selectedDayIndex]);

  const handleScroll = () => {
    if (!scrollRef.current || isProgrammaticScroll.current) return;
    const container = scrollRef.current;
    const index = Math.round(container.scrollLeft / container.offsetWidth);
    
    if (index !== selectedDayIndex && index >= 0 && index < (itinerary?.days.length || 0)) {
      setSelectedDayIndex(index);
    }
  };

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

    if (todayIdx !== undefined && todayIdx !== -1) {
      if (selectedDayIndex === todayIdx) {
        // Just trigger vertical scroll if already on today
        setScrollTrigger(prev => prev + 1);
      } else {
        setSelectedDayIndex(todayIdx);
        setScrollTrigger(prev => prev + 1);
      }
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
        days={itinerary?.days || []} 
        selectedIndex={selectedDayIndex} 
        onSelect={setSelectedDayIndex}
        searchTerm={searchTerm}
      />

      <main 
        ref={scrollRef}
        onScroll={handleScroll}
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
