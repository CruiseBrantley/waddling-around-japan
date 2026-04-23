import { useState, useEffect, useMemo } from 'react'
import { fetchItinerary, type Itinerary } from './services/sheets'
import heroImg from './assets/hero.png'
import './App.css'

function App() {
  const [itinerary, setItinerary] = useState<Itinerary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDayIndex, setSelectedDayIndex] = useState(0)

  useEffect(() => {
    async function loadData() {
      console.log('App: Starting loadData...')
      try {
        const data = await fetchItinerary()
        console.log('App: Data fetched successfully:', data)
        setItinerary(data)
        
        // --- AUTO-SELECT TODAY'S DATE ---
        // For testing, you can change MOCK_TODAY to any date string, e.g., "2026/05/26"
        const MOCK_TODAY: string | null = null; 
        const today = MOCK_TODAY ? new Date(MOCK_TODAY) : new Date();
        
        const todayIndex = data.days.findIndex(day => {
          const datePart = day.date.split(', ')[1]; // "5/24/26"
          if (!datePart) return false;
          const [m, d, y] = datePart.split('/');
          const dayDate = new Date(parseInt(y) + 2000, parseInt(m) - 1, parseInt(d));
          return dayDate.toDateString() === today.toDateString();
        });

        if (todayIndex !== -1) {
          setSelectedDayIndex(todayIndex);
          // Small delay to allow DOM to render before scrolling
          setTimeout(() => {
            const btn = document.querySelector(`.day-btn[data-index="${todayIndex}"]`);
            btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }, 100);
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
          <div className="container">
            <h1 className="hero-title">{itinerary?.title || 'Waddling Around Japan'}</h1>
            <p className="hero-subtitle">Travel Itinerary</p>
          </div>
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
              <div className="activity-count">{currentDay.activities.length} activities</div>
            </div>

            <div className="timeline">
              {currentDay.activities.map((activity) => (
                <div key={activity.id} className="timeline-item">
                  <div className="timeline-left">
                    <span className="activity-time">{activity.time}</span>
                    <div className={`timeline-dot type-${activity.type}`}></div>
                    <div className="timeline-connector"></div>
                  </div>
                  
                  <div className="timeline-content glass">
                    <div className="card-header">
                      <h3 className="activity-title">{activity.title}</h3>
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
              ))}
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

// Minimal Icons
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
