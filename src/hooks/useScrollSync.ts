import { useState, useEffect, useRef, useCallback } from 'react';
import { triggerHaptic, triggerTick } from '../utils/native';

interface ScrollSyncProps {
  dayCount: number;
  onIndexChange?: (index: number, type: 'manual' | 'programmatic' | 'daySelector' | 'void') => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  daySelectorRef?: React.RefObject<HTMLDivElement | null>;
  hapticsEnabled?: boolean;
  soundEnabled?: boolean;
}

export function useScrollSync({ 
  dayCount, 
  onIndexChange, 
  scrollRef: externalScrollRef, 
  daySelectorRef: externalDaySelectorRef,
  hapticsEnabled = true,
  soundEnabled = true
}: ScrollSyncProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const internalDaySelectorRef = useRef<HTMLDivElement>(null);
  
  const scrollRef = externalScrollRef || internalScrollRef;
  const daySelectorRef = externalDaySelectorRef || internalDaySelectorRef;

  const activeScrollerRef = useRef<'main' | 'day' | null>(null);
  const isDraggingRef = useRef(false);

  const ITEM_WIDTH = 76; // 64px width + 12px gap

  // Keep ref in sync for the scroll listeners to use without re-binding
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    const container = scrollRef.current;
    const daySelector = daySelectorRef.current;
    if (!container || !daySelector || dayCount === 0) return;

    const updateContainerHeight = () => {
      const isDesktop = window.innerWidth >= 800;
      if (isDesktop) return; // Desktop uses internal scrolling, no height syncing needed

      const slides = Array.from(container.querySelectorAll('.swipe-slide'));
      if (slides.length === 0) return;

      const scrollLeft = container.scrollLeft;
      const width = container.clientWidth;
      if (width === 0) return;

      const progress = scrollLeft / width;
      const index1 = Math.max(0, Math.floor(progress));
      const index2 = Math.min(slides.length - 1, Math.ceil(progress));
      const fraction = progress - index1;

      const h1 = (slides[index1] as HTMLElement)?.offsetHeight || 0;
      const h2 = (slides[index2] as HTMLElement)?.offsetHeight || 0;

      if (h1 > 0 || h2 > 0) {
        const currentHeight = h1 + (h2 - h1) * fraction;
        container.style.height = `${currentHeight}px`;
      }
    };

    const onMainScroll = () => {
        const isDesktop = window.innerWidth >= 800;
        
        // If we are actively scrolling the day selector on mobile, don't let scroll listener trigger loop
        if (activeScrollerRef.current === 'day' && !isDesktop) return;

        // Prevent layout thrashing: Do NOT dynamically sync height on every single scroll frame 
        // during active drag swiping. Doing so triggers forced synchronous layout reflows, 
        // which clashes with WebKit's scrolling thread and causes horizontal snapping to overshoot and bounce.
        // Height will instead sync cleanly when the active index changes or when the snap settles.

        const slides = Array.from(container.querySelectorAll('.swipe-slide'));
        let bestIndex = 0;
        let minDistance = Infinity;
        
        if (isDesktop) {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          if (maxScroll <= 0) return;

          const scrollTop = container.scrollTop;
          const scrollPercentage = maxScroll > 0 ? scrollTop / maxScroll : 0;
          const triggerPoint = scrollTop + 40 + scrollPercentage * (container.clientHeight - 80); 
          
          slides.forEach((slide, i) => {
            const el = slide as HTMLElement;
            if (triggerPoint >= el.offsetTop) {
              bestIndex = i;
            }
          });
        } else {
          const scrollLeft = container.scrollLeft;
          const containerCenter = scrollLeft + container.clientWidth / 2;
          
          slides.forEach((slide, i) => {
            const el = slide as HTMLElement;
            const slideCenter = el.offsetLeft + el.offsetWidth / 2;
            const distance = Math.abs(slideCenter - containerCenter);
            if (distance < minDistance) {
              minDistance = distance;
              bestIndex = i;
            }
          });
        }

        if (bestIndex !== activeIndexRef.current) {
          const type = activeScrollerRef.current === 'main' ? 'manual' : 
                       activeScrollerRef.current === 'day' ? 'daySelector' : 'manual';
          
          activeIndexRef.current = bestIndex;
          setActiveIndex(bestIndex);
          onIndexChange?.(bestIndex, type);
          updateContainerHeight();

          // Sync haptics and ticks inside the active scroll user-dragging gesture
          if (isDraggingRef.current) {
            if (hapticsEnabled) triggerHaptic('light');
            if (soundEnabled) triggerTick();
          }
        }
    };

    const onDayScroll = () => {
      if (activeScrollerRef.current === 'main') return;
      
      requestAnimationFrame(() => {
        if (activeScrollerRef.current === 'main') return;

        if (window.innerWidth < 800) {
          const scrollLeft = daySelector.scrollLeft;
          const firstBtn = daySelector.querySelector('.day-btn') as HTMLElement;
          const secondBtn = daySelector.querySelectorAll('.day-btn')[1] as HTMLElement;
          let actualItemWidth = ITEM_WIDTH;
          if (firstBtn && secondBtn) {
            actualItemWidth = secondBtn.offsetLeft - firstBtn.offsetLeft;
          }

          const progress = scrollLeft / actualItemWidth;
          const bestIndex = Math.max(0, Math.min(dayCount - 1, Math.round(progress)));
          
          if (bestIndex !== activeIndexRef.current) {
            const slides = container.querySelectorAll('.swipe-slide');
            const targetSlide = slides[bestIndex] as HTMLElement;
            let targetX = bestIndex * container.clientWidth;
            if (targetSlide) {
              const slideRect = targetSlide.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              if (containerRect.width > 0 && slideRect.width > 0) {
                targetX = slideRect.left - containerRect.left + container.scrollLeft;
              }
            }

            activeIndexRef.current = bestIndex;
            setActiveIndex(bestIndex);
            onIndexChange?.(bestIndex, 'daySelector');
            
            // Sync haptics and ticks inside the active day selector user-dragging gesture
            if (isDraggingRef.current) {
              if (hapticsEnabled) triggerHaptic('light');
              if (soundEnabled) triggerTick();
            }
            
            container.scrollTo({
              left: targetX,
              behavior: 'auto'
            });
          }
        }
      });
    };

    const onInteractionStart = (type: 'main' | 'day') => {
      activeScrollerRef.current = type;
      isDraggingRef.current = true;
    };

    const onInteractionEnd = () => {
      isDraggingRef.current = false;
      
      const settleAfterSnap = () => {
        activeScrollerRef.current = null;
        requestAnimationFrame(() => {
          updateContainerHeight();

          const isDesktop = window.innerWidth >= 800;
          if (!isDesktop) {
            const docHeight = document.documentElement.scrollHeight;
            const viewportBottom = window.scrollY + window.innerHeight;
            if (viewportBottom > docHeight + 20) {
              const targetY = Math.max(0, docHeight - window.innerHeight);
              window.scrollTo({ top: targetY, behavior: 'auto' });
            }
          }
        });
      };

      // Let CSS snapping complete before doing a final height alignment check
      setTimeout(settleAfterSnap, 300);
    };

    // Initial height sync
    setTimeout(() => {
      requestAnimationFrame(updateContainerHeight);
    }, 50);

    container.addEventListener('scroll', onMainScroll, { passive: true });
    container.addEventListener('touchstart', () => onInteractionStart('main'), { passive: true });
    container.addEventListener('mousedown', () => onInteractionStart('main'));
    window.addEventListener('touchend', onInteractionEnd);
    window.addEventListener('mouseup', onInteractionEnd);
    
    daySelector.addEventListener('scroll', onDayScroll, { passive: true });
    daySelector.addEventListener('touchstart', () => onInteractionStart('day'), { passive: true });
    daySelector.addEventListener('mousedown', () => onInteractionStart('day'));

    return () => {
      container.removeEventListener('scroll', onMainScroll);
      window.removeEventListener('touchend', onInteractionEnd);
      window.removeEventListener('mouseup', onInteractionEnd);
      daySelector.removeEventListener('scroll', onDayScroll);
    };
  }, [dayCount, onIndexChange, scrollRef, daySelectorRef, hapticsEnabled, soundEnabled]); 

  const scrollToDay = useCallback((index: number) => {
    if (!scrollRef.current) return;
    
    if (index !== activeIndexRef.current) {
      console.log(`[ScrollSync] Scrolling to index ${index} (instant)`);
    }
    const container = scrollRef.current;
    const daySelector = daySelectorRef.current;
    const isDesktop = window.innerWidth >= 800;
    
    // Calculate targets correctly using exact floating-point subpixel coordinates via getBoundingClientRect
    const slides = container.querySelectorAll('.swipe-slide');
    const targetSlide = slides[index] as HTMLElement;
    let targetX = index * container.clientWidth;
    if (targetSlide) {
      const slideRect = targetSlide.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (containerRect.width > 0 && slideRect.width > 0) {
        targetX = slideRect.left - containerRect.left + container.scrollLeft;
      }
    }
    let targetY = 0;
    
    if (isDesktop) {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      if (targetSlide) targetY = Math.max(0, Math.min(maxScroll, targetSlide.offsetTop - 20));
    }
    
    const targetValue = isDesktop ? targetY : targetX;
    const currentPos = isDesktop ? container.scrollTop : container.scrollLeft;
    
    if (Math.abs(currentPos - targetValue) < 2) {
      // Already there, just update state and return
      setActiveIndex(index);
      onIndexChange?.(index, 'programmatic');
      activeIndexRef.current = index;
      return;
    }

    activeIndexRef.current = index; 
    setActiveIndex(index);
    onIndexChange?.(index, 'programmatic');

    if (!isDesktop) {
      // Instant horizontal scroll
      container.scrollTo({
        left: targetX,
        behavior: 'auto'
      });

      // Force immediate height sync
      if (targetSlide) {
        container.style.height = `${targetSlide.offsetHeight}px`;
      }

      if (daySelector) {
        daySelector.scrollTo({
          left: index * ITEM_WIDTH,
          behavior: 'auto'
        });
      }
    } else {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      if (targetSlide) {
        const scrollTarget = Math.max(0, Math.min(maxScroll, targetSlide.offsetTop - 20)); 
        container.scrollTo({
          top: scrollTarget,
          behavior: 'auto'
        });
      }
    }
  }, [onIndexChange]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    scrollRef,
    daySelectorRef,
    activeIndex,
    setActiveIndex,
    scrollToDay
  };
}
