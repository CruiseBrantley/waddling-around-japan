import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { AppSettings } from '../utils/settings';
import { getWeatherData, type WeatherData } from '../utils/weather';

import './DayWeather.css';

interface DayWeatherProps {
  date: string;
  regions?: string[];
  currentTime: Date;
  settings: AppSettings;
  isActive?: boolean;
}

const LOADING_MESSAGES = [
  "Mapping your travel destinations...",
  "Consulting the simulated forecast...",
  "Analyzing schedule walking demands...",
  "Optimizing footwear recommendation...",
  "Curating perfect daypack essentials...",
  "Generating custom local travel tips..."
];

export const DayWeather: React.FC<DayWeatherProps> = ({
  date,
  regions = ['Tokyo'],
  currentTime
}) => {
  const [selectedRegion, setSelectedRegion] = useState<string>('Tokyo');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiAdvisory, setAiAdvisory] = useState<string | null>(null);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState<number>(0);

  const hourlyScrollRef = useRef<HTMLDivElement | null>(null);
  const currentHourRef = useRef<HTMLDivElement | null>(null);
  const activeHour = currentTime.getHours();

  // Sync selected region when list of resolved regions changes
  useEffect(() => {
    if (regions.length > 0 && !regions.includes(selectedRegion)) {
      requestAnimationFrame(() => {
        setSelectedRegion(regions[0]);
      });
    }
  }, [regions, selectedRegion]);

  // Load weather and check local cache for AI advisory
  const [weather, setWeather] = useState<WeatherData>(() => {
    // Initial value: fall back immediately to simulated climate so we have instant data!
    return getWeatherData(selectedRegion, date, currentTime);
  });

  const cacheKey = useMemo(() => {
    return `ai_advisory_${date.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }, [date]);

  // Effect to load weather (region dependent) from local cache
  useEffect(() => {
    const loadWeather = () => {
      const weatherCacheKey = `real_weather_${date.replace(/[^a-zA-Z0-9]/g, '_')}_${selectedRegion.toLowerCase()}`;

      try {
        const cachedWeather = localStorage.getItem(weatherCacheKey);
        if (cachedWeather) {
          const weatherObj = JSON.parse(cachedWeather);
          const activeHour = currentTime.getHours();
          if (weatherObj.hourly && weatherObj.hourly[activeHour]) {
            weatherObj.currentTemp = weatherObj.hourly[activeHour].temp;
          }
          setWeather(weatherObj);
        } else {
          setWeather(getWeatherData(selectedRegion, date, currentTime));
        }
      } catch (e) {
        console.warn('Failed to load cached weather:', e);
        setWeather(getWeatherData(selectedRegion, date, currentTime));
      }
    };

    loadWeather();
    window.addEventListener('advisor_cache_updated', loadWeather);
    return () => window.removeEventListener('advisor_cache_updated', loadWeather);
     
  }, [selectedRegion, date, currentTime]);

  // Effect to load unified AI Travel Advisor note from local cache
  useEffect(() => {
    const loadAdvisor = () => {
      try {
        const cachedAdvisor = localStorage.getItem(cacheKey);
        if (cachedAdvisor) {
          setAiAdvisory(cachedAdvisor);
          setAiLoading(false);
        } else {
          setAiAdvisory(null);
          setAiLoading(false);
        }
      } catch (e) {
        console.warn('Failed to load cached advisor:', e);
        setAiAdvisory(null);
        setAiLoading(false);
      }
    };

    loadAdvisor();
    window.addEventListener('advisor_cache_updated', loadAdvisor);
    return () => window.removeEventListener('advisor_cache_updated', loadAdvisor);
  }, [date, cacheKey]);

  // Auto-scroll current hour into view in the hourly forecast slider
  useEffect(() => {
    if (isExpanded && currentHourRef.current && hourlyScrollRef.current) {
      const timer = setTimeout(() => {
        if (currentHourRef.current && hourlyScrollRef.current) {
          const container = hourlyScrollRef.current;
          const target = currentHourRef.current;
          const containerWidth = container.offsetWidth;
          const targetLeft = target.offsetLeft;
          const targetWidth = target.offsetWidth;

          // Center the active hour item in the slider viewport
          container.scrollTo({
            left: targetLeft - containerWidth / 2 + targetWidth / 2,
            behavior: 'smooth'
          });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isExpanded, selectedRegion, activeHour]);

  // Rotate loading messages during AI generation
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (aiLoading) {
      interval = setInterval(() => {
        setLoadingMsgIdx(prev => (prev + 1) % LOADING_MESSAGES.length);
      }, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [aiLoading]);

  // Simple Markdown Parser to render structured LLM advice safely and elegantly
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="markdown-rendered-content">
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={idx} className="md-spacing" />;

          // Headers: ### or ## or #
          if (trimmed.startsWith('###')) {
            return <h4 key={idx} className="md-h3">{trimmed.replace(/^###\s*/, '')}</h4>;
          }
          if (trimmed.startsWith('##') || trimmed.startsWith('#')) {
            return <h3 key={idx} className="md-h2">{trimmed.replace(/^##?\s*/, '')}</h3>;
          }

          // Bold title list items like: "1. 👕 **Outfit Recommendation**:" or "- **Outfit**:"
          const listMatch = trimmed.match(/^(\d+\.|-|\*)\s*(.*)$/);
          if (listMatch) {
            const content = listMatch[2];
            // Check if there is bold text to render cleanly
            return (
              <div key={idx} className="md-list-item">
                <span className="md-bullet">•</span>
                <span className="md-list-content">
                  {renderInlineFormatting(content)}
                </span>
              </div>
            );
          }

          // Standard paragraph line
          return (
            <p key={idx} className="md-p">
              {renderInlineFormatting(trimmed)}
            </p>
          );
        })}
      </div>
    );
  };

  // Helper to parse double asterisks for bold inline text
  const renderInlineFormatting = (text: string) => {
    const parts = text.split('**');
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <strong key={index} className="md-strong">{part}</strong>;
      }
      return part;
    });
  };

  const displayTemp = useMemo(() => {
    if (weather && weather.hourly && weather.hourly[activeHour]) {
      return weather.hourly[activeHour].temp;
    }
    if (weather) {
      return weather.currentTemp;
    }
    return 0;
  }, [weather, activeHour]);

  // Pick condition specific theme color modifier for beautiful styling
  const getWeatherClass = (cond: string) => {
    const c = cond.toLowerCase();
    if (c.includes('rain') || c.includes('shower')) return 'weather-rain';
    if (c.includes('cloud') || c.includes('breezy')) return 'weather-cloud';
    if (c.includes('cold') || c.includes('cool')) return 'weather-cold';
    return 'weather-clear'; // Default sunny/clear
  };

  return (
    <div className={`day-weather-widget ${getWeatherClass(weather.condition)} ${isExpanded ? 'expanded' : ''}`}>
      {/* Tab selection if multiple regions scheduled */}
      {regions.length > 1 && (
        <div className="weather-tabs">
          {regions.map(r => (
            <button
              key={r}
              className={`weather-tab-btn ${selectedRegion === r ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedRegion(r);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      )}

      {/* Main Glassmorphic Weather Panel */}
      <div className="weather-main-panel" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="weather-primary-info">
          <div className="weather-temp-block">
            <span className="weather-current-degree">{weather.condition === 'Unknown' ? '--' : `${displayTemp}°`}</span>
            <span className="weather-emoji-large">{weather.emoji}</span>
          </div>
          <div className="weather-meta-block">
            <span className="weather-region-name">{selectedRegion}</span>
            <div className="weather-range-badge">
              <span className="weather-condition-text">{weather.condition === 'Unknown' ? 'Forecast Unavailable' : weather.condition}</span>
              {weather.condition !== 'Unknown' && (
                <>
                  <span className="weather-range-divider">•</span>
                  <span className="weather-hi-low">H: {weather.tempMax}°  L: {weather.tempMin}°</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="weather-interactive-indicator">
          <span className="weather-brief-adv">{weather.advisory}</span>
          <span className={`weather-chevron-arrow ${isExpanded ? 'rotated' : ''}`}>▼</span>
        </div>
      </div>

      {/* Expandable detailed weather drawer */}
      {isExpanded && (
        <div className="weather-drawer-content fade-in-up">
          <div className="weather-section-divider" />

          {/* 24-Hour Slider */}
          <div className="weather-hourly-section">
            <h4 className="weather-subtitle">Hourly Trend</h4>
            <div className="weather-hourly-slider" ref={hourlyScrollRef}>
              {weather.hourly.map((hData: { hour: number; temp: number; emoji: string }) => {
                const isActive = hData.hour === activeHour;
                return (
                  <div
                    key={hData.hour}
                    className={`hourly-item ${isActive ? 'active-hour' : ''}`}
                    ref={isActive ? currentHourRef : null}
                  >
                    <span className="hourly-time">{hData.hour === 0 ? '12a' : hData.hour === 12 ? '12p' : hData.hour > 12 ? `${hData.hour - 12}p` : `${hData.hour}a`}</span>
                    <span className="hourly-emoji">{hData.emoji}</span>
                    <span className="hourly-temp">{hData.temp}°</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Key Metrics Grid */}
          <div className="weather-metrics-grid">
            <div className="metric-box">
              <span className="metric-icon">☔</span>
              <span className="metric-value">{weather.precipProb}%</span>
              <span className="metric-label">Precipitation</span>
            </div>
            <div className="metric-box">
              <span className="metric-icon">💧</span>
              <span className="metric-value">{weather.humidity}%</span>
              <span className="metric-label">Humidity</span>
            </div>
            <div className="metric-box">
              <span className="metric-icon">💨</span>
              <span className="metric-value">{weather.windSpeed} km/h</span>
              <span className="metric-label">Wind Speed</span>
            </div>
          </div>

          <div className="weather-section-divider" />

          {/* AI Advisor Panel */}
          <div className="weather-ai-panel">
            <div className="ai-panel-header">
              <span className="ai-badge-glowing">✨ AI Travel Advisor</span>
              {regions.length > 0 && (
                <span className="ai-panel-regions-tag">{regions.join(' • ')}</span>
              )}
            </div>

            <div className="ai-active-container">
              {aiLoading ? (
                <div className="ai-loading-card">
                  <div className="ai-spinner-ring" />
                  <span className="ai-spinner-message">{LOADING_MESSAGES[loadingMsgIdx]}</span>
                  <span className="ai-spinner-sub">Proactively fetching premium travel advice...</span>
                </div>
              ) : aiAdvisory ? (
                <div className="ai-advisory-output fade-in">
                  {renderMarkdown(aiAdvisory)}
                </div>
              ) : (
                <div className="ai-disabled-card">
                  <p>Preparing daily tailored outfits, shoe strategies, and packing checklists specific to this day's weather and scheduled activities...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
