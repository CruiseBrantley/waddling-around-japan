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

  // Auto-scroll to active card
  useEffect(() => {
    if (activeCardRef.current && !loading) {
      setTimeout(() => {
        activeCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 500);
    }
  }, [loading, selectedDayIndex]);

  // Filtering Logic
  const currentDay = itinerary?.days[selectedDayIndex];
  const filteredActivities = currentDay?.activities.filter(activity => {
    const term = searchTerm.toLowerCase();
    return (
      activity.title.toLowerCase().includes(term) ||
      activity.location.toLowerCase().includes(term) ||
      activity.notes.toLowerCase().includes(term) ||
      activity.category.toLowerCase().includes(term)
    );
  }) || [];

  // Check if selected day is today
  const isToday = currentDay ? (() => {
    // Extract date parts: "Wed, 5/28/26" -> extract 5/28/26
    const dateMatch = currentDay.date.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
    if (!dateMatch) return false;
    
    const [, month, dayOfMonth, year] = dateMatch;
    const currentMonth = String(currentTime.getMonth() + 1);
    const currentDayOfMonth = String(currentTime.getDate());
    const currentYear = String(currentTime.getFullYear()).slice(-2);
    
    return month === currentMonth && dayOfMonth === currentDayOfMonth && year === currentYear;
  })() : false;

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

  // Swipe Gesture Handling
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const minSwipeDistance = 70;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchEndX.current = null;
    touchStartX.current = e.targetTouches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (!touchStartX.current || !touchEndX.current) return;
    
    const distance = touchStartX.current - touchEndX.current;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && selectedDayIndex < (itinerary?.days.length || 0) - 1) {
      setSelectedDayIndex(prev => prev + 1);
    } else if (isRightSwipe && selectedDayIndex > 0) {
      setSelectedDayIndex(prev => prev - 1);
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="swipe-container"
      >
        {filteredActivities.length > 0 ? (
          <ActivityList 
            date={currentDay?.date || ''} 
            activities={filteredActivities} 
            currentTime={currentTime}
            activeCardRef={activeCardRef}
            timeToMinutes={timeToMinutes}
            isToday={isToday}
          />
        ) : (
          <div className="container" style={{ textAlign: 'center', paddingTop: '40px', opacity: 0.5 }}>
            <p>No matches found for your search.</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
