import React, { useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { shareItinerary, triggerHaptic } from '../utils/native';
import './ShareModal.css';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  url: string;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, url }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      // Prevent touch scroll for mobile Safari
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
    } else {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNativeShare = () => {
    triggerHaptic('medium');
    shareItinerary('Japan Itinerary', 'Check out our Japan trip itinerary!', url);
  };

  return (
    <div className="share-modal-overlay fade-in" onClick={onClose}>
      <div className="share-modal glass" onClick={(e) => e.stopPropagation()}>
        <div className="share-modal-header">
          <h3>Share Itinerary</h3>
          <button className="close-modal" onClick={onClose}>×</button>
        </div>

        <div className="share-modal-content">
          <div className="qr-container">
            <div className="qr-frame">
              <QRCodeSVG 
                value={url} 
                size={200}
                level="H"
                includeMargin={true}
                imageSettings={{
                  src: "/icon.png",
                  x: undefined,
                  y: undefined,
                  height: 40,
                  width: 40,
                  excavate: true,
                }}
              />
            </div>
            <p className="qr-hint">Scan to open on another device</p>
          </div>

          <div className="share-actions">
            <button className="btn btn-primary share-action-btn" onClick={handleNativeShare}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              Open Share Sheet (AirDrop)
            </button>
            
            <button className="btn share-action-btn glass" onClick={() => {
              triggerHaptic('light');
              navigator.clipboard.writeText(url);
              alert('Link copied!');
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              Copy Link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
