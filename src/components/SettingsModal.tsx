import React, { useEffect, useState } from 'react';
import { triggerHaptic, triggerTick, requestNotificationPermission, triggerAlertSound } from '../utils/native';
import { saveSettings, supportsNotifications, isIOS, isStandalone, supportsHaptics, supportsSound } from '../utils/settings';
import type { AppSettings } from '../utils/settings';
import './SettingsModal.css';

const TIMING_OPTIONS = [
  { label: '5 min', value: 5 },
  { label: '10 min', value: 10 },
  { label: '15 min', value: 15 },
  { label: '20 min', value: 20 },
  { label: '30 min', value: 30 },
];

const URGENT_OPTIONS = [
  { label: 'At start', value: 0 },
  { label: '1 min', value: 1 },
  { label: '2 min', value: 2 },
  { label: '5 min', value: 5 },
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ 
  isOpen, onClose, settings, onSettingsChange 
}) => {
  const [permissionState, setPermissionState] = useState<NotificationPermission | 'unsupported'>(() => {
    if (!supportsNotifications()) return 'unsupported';
    return typeof Notification !== 'undefined' ? Notification.permission : 'default';
  });

  // Re-sync permission state when modal opens
  useEffect(() => {
    if (isOpen && supportsNotifications()) {
      // Wrap in rAF to avoid "setState synchronously within an effect" lint error
      requestAnimationFrame(() => {
        setPermissionState(Notification.permission);
      });
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const update = (partial: Partial<AppSettings>) => {
    const next = { ...settings, ...partial };
    onSettingsChange(next);
    saveSettings(next);
    if (next.hapticsEnabled) {
      triggerHaptic('light');
    }
  };

  const handleNotificationToggle = async () => {
    if (settings.notificationsEnabled) {
      // Turning off
      update({ notificationsEnabled: false });
      return;
    }

    // Turning on — request permission if needed
    if (Notification.permission !== 'granted') {
      if (settings.hapticsEnabled) triggerHaptic('medium');
      const result = await requestNotificationPermission();
      setPermissionState(result === 'granted' ? 'granted' : result === 'denied' ? 'denied' : 'default');
      if (result === 'granted') {
        update({ notificationsEnabled: true });
      } else if (result === 'denied') {
        // Permission denied, can't enable
        return;
      }
    } else {
      update({ notificationsEnabled: true });
    }
  };

  const handleSoundToggle = () => {
    const newVal = !settings.soundEnabled;
    update({ soundEnabled: newVal });
    if (newVal) triggerTick(); // Play a tick so they hear what it sounds like
  };

  const handleHapticsToggle = () => {
    const newVal = !settings.hapticsEnabled;
    update({ hapticsEnabled: newVal });
    if (newVal) triggerHaptic('heavy'); // Demonstrate the strength
  };

  const showNotifications = supportsNotifications();
  const iosAndNotStandalone = isIOS() && !isStandalone();
  const hasHaptics = supportsHaptics();
  const hasSound = supportsSound();

  return (
    <div className="settings-modal-overlay fade-in" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h3>Settings</h3>
          <button className="close-modal" onClick={onClose}>×</button>
        </div>

        <div className="settings-modal-content">
          {/* Sound Toggle */}
          {hasSound && (
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-icon">🔊</span>
                <div>
                  <div className="settings-label">Day Change Sound</div>
                  <div className="settings-hint">Play a subtle tick when swiping between days</div>
                </div>
              </div>
              <button 
                className={`settings-toggle ${settings.soundEnabled ? 'active' : ''}`}
                onClick={handleSoundToggle}
                aria-label="Toggle sound"
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          )}

          {/* Haptics Toggle */}
          {hasHaptics && (
            <div className="settings-row">
              <div className="settings-row-info">
                <span className="settings-icon">📳</span>
                <div>
                  <div className="settings-label">Haptic Vibration</div>
                  <div className="settings-hint">Tactile feedback on interactions and day changes</div>
                </div>
              </div>
              <button 
                className={`settings-toggle ${settings.hapticsEnabled ? 'active' : ''}`}
                onClick={handleHapticsToggle}
                aria-label="Toggle haptics"
              >
                <span className="settings-toggle-knob" />
              </button>
            </div>
          )}

          {/* Notifications Section */}
          {showNotifications ? (
            <>
              <div className="settings-divider" />

              <div className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-icon">🔔</span>
                  <div>
                    <div className="settings-label">Activity Alerts</div>
                    <div className="settings-hint">
                      {iosAndNotStandalone 
                        ? 'Requires "Add to Home Screen"' 
                        : (permissionState === 'denied' 
                            ? 'Blocked — enable in browser settings' 
                            : 'Get notified before upcoming activities')}
                    </div>
                  </div>
                </div>
                <button 
                  className={`settings-toggle ${settings.notificationsEnabled ? 'active' : ''} ${(permissionState === 'denied' || iosAndNotStandalone) ? 'disabled' : ''}`}
                  onClick={handleNotificationToggle}
                  disabled={permissionState === 'denied' || iosAndNotStandalone}
                  aria-label="Toggle notifications"
                >
                  <span className="settings-toggle-knob" />
                </button>
              </div>

              {/* iOS standalone helper */}
              {iosAndNotStandalone && (
                <div className="settings-ios-helper">
                  To enable alerts on iPhone:
                  <ol>
                    <li>Tap the <strong>Share</strong> button <span className="share-icon-mini">⎋</span></li>
                    <li>Select <strong>Add to Home Screen</strong></li>
                    <li>Open this app from your home screen</li>
                  </ol>
                </div>
              )}

              {/* Timing and Feedback — only shown when notifications are on */}
              {settings.notificationsEnabled && permissionState !== 'denied' && !iosAndNotStandalone && (
                <div className="settings-timing-section">
                  <div className="settings-timing-row">
                    <div className="settings-timing-header">
                      <span className="settings-timing-label">Heads up alert</span>
                      <div className="settings-timing-feedback">
                        {hasHaptics && (
                          <div className="settings-feedback-item-mini">
                            <span className="mini-icon">📳</span>
                            <button 
                              className={`settings-toggle mini vibrate ${settings.notifyHeadsUpVibrate ? 'active' : ''}`}
                              onClick={() => update({ notifyHeadsUpVibrate: !settings.notifyHeadsUpVibrate })}
                              title="Vibrate"
                            />
                          </div>
                        )}
                        {hasSound && (
                          <div className="settings-feedback-item-mini">
                            <span className="mini-icon">🔊</span>
                            <button 
                              className={`settings-toggle mini chime ${settings.notifyHeadsUpChime ? 'active' : ''}`}
                              onClick={() => {
                                const newVal = !settings.notifyHeadsUpChime;
                                update({ notifyHeadsUpChime: newVal });
                                if (newVal) triggerAlertSound('info');
                              }}
                              title="Chime"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="settings-chip-group">
                      <button
                        className={`settings-chip ${!settings.notifyHeadsUpEnabled ? 'active' : ''}`}
                        onClick={() => update({ notifyHeadsUpEnabled: false })}
                      >
                        Off
                      </button>
                      {TIMING_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          className={`settings-chip ${settings.notifyHeadsUpEnabled && settings.notifyMinutesBefore === opt.value ? 'active' : ''}`}
                          onClick={() => update({ notifyHeadsUpEnabled: true, notifyMinutesBefore: opt.value })}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="settings-timing-row">
                    <div className="settings-timing-header">
                      <span className="settings-timing-label">Urgent alert</span>
                      <div className="settings-timing-feedback">
                        {hasHaptics && (
                          <div className="settings-feedback-item-mini">
                            <span className="mini-icon">📳</span>
                            <button 
                              className={`settings-toggle mini vibrate ${settings.notifyUrgentVibrate ? 'active' : ''}`}
                              onClick={() => update({ notifyUrgentVibrate: !settings.notifyUrgentVibrate })}
                              title="Vibrate"
                            />
                          </div>
                        )}
                        {hasSound && (
                          <div className="settings-feedback-item-mini">
                            <span className="mini-icon">🔊</span>
                            <button 
                              className={`settings-toggle mini chime ${settings.notifyUrgentChime ? 'active' : ''}`}
                              onClick={() => {
                                const newVal = !settings.notifyUrgentChime;
                                update({ notifyUrgentChime: newVal });
                                if (newVal) triggerAlertSound('urgent');
                              }}
                              title="Chime"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="settings-chip-group">
                      <button
                        className={`settings-chip ${!settings.notifyUrgentEnabled ? 'active' : ''}`}
                        onClick={() => update({ notifyUrgentEnabled: false })}
                      >
                        Off
                      </button>
                      {URGENT_OPTIONS.map(opt => (
                        <button
                          key={opt.value}
                          className={`settings-chip ${settings.notifyUrgentEnabled && settings.notifyUrgentMinutesBefore === opt.value ? 'active' : ''}`}
                          onClick={() => update({ notifyUrgentEnabled: true, notifyUrgentMinutesBefore: opt.value })}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* Developer Tools */}
          <div className="settings-divider" />
          <div className="settings-dev-section">
            <div className="settings-label dev">Developer Tools</div>
            <div className="settings-row dev">
              <div className="settings-row-info">
                <div>
                  <div className="settings-label">Time Override</div>
                  <div className="settings-hint">Set manual time for testing (e.g. 14:30)</div>
                </div>
              </div>
              <div className="settings-dev-input-group">
                <input 
                  type="time" 
                  className="settings-dev-input"
                  value={settings.debugTime || ''}
                  onChange={(e) => update({ debugTime: e.target.value || null })}
                />
                {settings.debugTime && (
                  <button 
                    className="settings-dev-clear"
                    onClick={() => update({ debugTime: null })}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
