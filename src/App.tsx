import { useState, useEffect, useMemo } from 'react'
import { fetchItinerary, type Itinerary } from './services/sheets'
import heroImg from './assets/hero.png'
import './App.css'

function App() {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDayIndex, setSelectedDayIndex] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')

  // --- MOCK TODAY FOR TESTING ---
  // You can set this to e.g. "2026/05/26 14:30" to test LIVE indicators
  const MOCK_TODAY: string | null = "2026/05/26 14:30"; 
  const getInitialTime = () => MOCK_TODAY ? new Date(MOCK_TODAY) : new Date();

  const [currentTime, setCurrentTime] = useState(getInitialTime())

  // Update time for LIVE indicators
  useEffect(() => {
    if (MOCK_TODAY) return; // Don't auto-update if we are mocking
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 30000)
    return () => clearInterval(timer)
  }, [MOCK_TODAY])

  useEffect(() => {
    async function loadData() {
      console.log('App: Starting loadData...')
      try {
        const data = await fetchItinerary()
        console.log('App: Data fetched successfully:', data)
        setItinerary(data)

        // --- AUTO-SELECT TODAY ---
        const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
        
        const todayIndex = data.days.findIndex(day => {
          const datePart = day.date.split(', ')[1];
          if (!datePart) return false;
          const [m, d, y] = datePart.split('/');
          const dayDate = new Date(parseInt(y) + 2000, parseInt(m) - 1, parseInt(d));
          return dayDate.toDateString() === currentTime.toDateString();
        });

        if (todayIndex !== -1) {
          setSelectedDayIndex(todayIndex);

          // Find current activity index within today
          const activities = data.days[todayIndex].activities;
          let currentActivityIdx = -1;

          for (let i = 0; i < activities.length; i++) {
            const actMinutes = timeToMinutes(activities[i].time);
            if (nowMinutes >= actMinutes) {
              currentActivityIdx = i;
            } else {
              break; // Found the first activity that hasn't happened yet
            }
          }

          // Delay for DOM render
          setTimeout(() => {
            const dayBtn = document.querySelector(`.day-btn[data-index="${todayIndex}"]`);
            dayBtn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

            if (currentActivityIdx !== -1) {
              const activityCard = document.querySelector(`.timeline-item[data-act-index="${currentActivityIdx}"]`);
              activityCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 200);
        }
      } catch (err) {
        console.error('App: Fetch error:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch itinerary')
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const currentDay = useMemo(() => {
    if (!itinerary || !itinerary.days[selectedDayIndex]) return null
    return itinerary.days[selectedDayIndex]
  }, [itinerary, selectedDayIndex])

  const filteredActivities = useMemo(() => {
    if (!currentDay) return []
    if (!searchTerm.trim()) return currentDay.activities

    const term = searchTerm.toLowerCase()
    return currentDay.activities.filter(act => 
      act.title.toLowerCase().includes(term) ||
      act.location.toLowerCase().includes(term) ||
      act.category.toLowerCase().includes(term) ||
      act.notes.toLowerCase().includes(term)
    )
  }, [currentDay, searchTerm])

  if (loading) {
    return (
      <div className="flex-center" style={{ height: '100vh', background: 'var(--bg-main)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="loader" style={{ margin: '0 auto 20px' }}></div>
          <h2 style={{ fontSize: '20px' }}>Waddling into Japan...</h2>
        </div>
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

  return (
    <div className="app-wrapper">
      {/* Hero */}
      <div className="hero-container">
        <img src={heroImg} alt="Hero" className="hero-image" />
        <div className="hero-overlay">
          <div className="container" style={{ textAlign: 'left', paddingBottom: '10px' }}>
            <h1 className="hero-title">{itinerary?.title || 'Waddling Around Japan'}</h1>
            <p className="hero-subtitle">Japan Trip Itinerary • 2026</p>
          </div>
        </div>
      </div>

      {/* Search Bar - Responsive & Premium */}
      <div className="container" style={{ marginTop: '-20px', position: 'relative', zIndex: 110 }}>
        <div className="search-wrapper glass">
          <SearchIcon />
          <input 
            type="text" 
            placeholder="Search activities, food, locations..." 
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="clear-search" onClick={() => setSearchTerm('')}>×</button>
          )}
        </div>
      </div>

      {/* Day Selector */}
      <nav className="day-selector glass">
        <div className="day-scroll-container">
          {itinerary?.days.map((day, idx) => {
            // Parse date string like "Sun, 5/24/26"
            const dateParts = day.date.split(', ');
            const dayName = dateParts[0]?.toUpperCase() || '';
            const dayMonth = dateParts[1]?.split('/') || [];
            const dayShort = dayMonth[1] || '';

            return (
              <button
                key={day.day}
                data-index={idx}
                className={`day-btn ${selectedDayIndex === idx ? 'active' : ''}`}
                onClick={() => setSelectedDayIndex(idx)}
              >
                <span className="day-label">{dayName}</span>
                <span className="day-num">{dayShort}</span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* Activities */}
      <main className="container fade-in" style={{ paddingBottom: '60px' }}>
        {currentDay ? (
          <>
            <div className="day-header" style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="day-count-badge">DAY {currentDay.day}</span>
                <h2 className="date-display">{currentDay.date}</h2>
              </div>
              <div className="activity-count">
                {searchTerm ? `${filteredActivities.length} found` : `${currentDay.activities.length} activities`}
              </div>
            </div>

            <div className="timeline">
              {filteredActivities.length > 0 ? (
                filteredActivities.map((activity, idx) => {
                  const nowMins = currentTime.getHours() * 60 + currentTime.getMinutes();
                  const actMins = timeToMinutes(activity.time);
                  const nextAct = currentDay.activities[idx + 1];
                  const nextActMins = nextAct ? timeToMinutes(nextAct.time) : 1440;

                  const isToday = currentTime.toDateString() === new Date(itinerary?.days[selectedDayIndex].date.split(', ')[1] || '').toDateString();
                  const isLive = isToday && nowMins >= actMins && nowMins < nextActMins;

                  return (
                    <div key={activity.id} className={`timeline-item ${isLive ? 'is-live' : ''}`} data-act-index={idx}>
                      <div className="timeline-left">
                        <span className="activity-time">{activity.time}</span>
                        <div className={`timeline-dot type-${activity.type} ${isLive ? 'pulse-red' : ''}`}></div>
                        <div className="timeline-connector"></div>
                      </div>

                      <div className={`timeline-content glass ${isLive ? 'active-card' : ''}`}>
                        <div className="card-header">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {isLive && <span className="live-badge">● LIVE NOW</span>}
                            <h3 className="activity-title">{activity.title}</h3>
                          </div>
                          <span className={`category-tag type-${activity.type}`}>{activity.category}</span>
                        </div>

                        {activity.location && (
                          <a
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(activity.location)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="activity-location-link"
                          >
                            <MapIcon />
                            <span>{activity.location}</span>
                          </a>
                        )}

                        {activity.notes && (
                          <div className="activity-notes">
                            {activity.notes}
                          </div>
                        )}

                        <div className="card-footer">
                          {activity.cost && (
                            <div className="activity-cost">
                              <CostIcon />
                              <span>{activity.cost}</span>
                            </div>
                          )}
                          {activity.link && (
                            <a href={activity.link} target="_blank" rel="noopener noreferrer" className="activity-link">
                              View Trip Note
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div style={{ textAlign: 'center', padding: '60px', opacity: 0.6 }}>
                  <p>No matches for "{searchTerm}" on this day.</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <p>No activities planned for this day.</p>
          </div>
        )}
      </main>
    </div>
  )
}

/**
 * Utility to convert "11:30 AM" or "2:00 PM" to minutes from midnight
 */
function timeToMinutes(timeStr: string): number {
  try {
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (modifier === 'PM' && hours < 12) hours += 12;
    if (modifier === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  } catch {
    return 0;
  }
}

// Minimal Icons
const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
)

const MapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
    <circle cx="12" cy="10" r="3"></circle>
  </svg>
)

const CostIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"></line>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
  </svg>
)

export default App
