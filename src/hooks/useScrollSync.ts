import { useState, useEffect, useRef, useCallback } from 'react';

interface ScrollSyncProps {
  dayCount: number;
  onIndexChange?: (index: number, type: 'manual' | 'programmatic' | 'daySelector' | 'void') => void;
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  daySelectorRef?: React.RefObject<HTMLDivElement | null>;
}

export function useScrollSync({ dayCount, onIndexChange, scrollRef: externalScrollRef, daySelectorRef: externalDaySelectorRef }: ScrollSyncProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  
  const internalScrollRef = useRef<HTMLDivElement>(null);
  const internalDaySelectorRef = useRef<HTMLDivElement>(null);
  
  const scrollRef = externalScrollRef || internalScrollRef;
  const daySelectorRef = externalDaySelectorRef || internalDaySelectorRef;

  const activeScrollerRef = useRef<'main' | 'day' | 'programmatic' | null>(null);
  const scrollEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetMainScrollRef = useRef<number | null>(null);

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
      const isDesktop = window.innerWidth >= 1024;
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
      requestAnimationFrame(() => {
        const isDesktop = window.innerWidth >= 1024;
        
        // PROXIMITY LOCK: If we have a target, don't sync until we are close.
        if (targetMainScrollRef.current !== null) {
          const currentPos = isDesktop ? container.scrollTop : container.scrollLeft;
          const dist = Math.abs(currentPos - targetMainScrollRef.current);
          if (dist <= 5) {
            targetMainScrollRef.current = null;
            activeScrollerRef.current = null;
            updateContainerHeight(); // Force update when we arrive at the target
          } else {
            if (activeScrollerRef.current === 'day' || activeScrollerRef.current === 'programmatic') return;
          }
        } else if (activeScrollerRef.current === 'day' || activeScrollerRef.current === 'programmatic') {
          return;
        }

        // 1. ALWAYS sync visual height during any manual scroll
        updateContainerHeight();

        const slides = Array.from(container.querySelectorAll('.swipe-slide'));
        let bestIndex = 0;
        let minDistance = Infinity;
        
        if (isDesktop) {
          const scrollTop = container.scrollTop;
          const triggerPoint = scrollTop + (container.clientHeight / 2); 
          
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
                       activeScrollerRef.current === 'day' ? 'daySelector' : 
                       (activeScrollerRef.current === null ? 'manual' : 'void');
          
          if (type === 'void') return; 

          activeIndexRef.current = bestIndex;
          setActiveIndex(bestIndex);
          onIndexChange?.(bestIndex, type);
        }
      });
    };

    const onDayScroll = () => {
      if (activeScrollerRef.current === 'main' || activeScrollerRef.current === 'programmatic') return;
      
      requestAnimationFrame(() => {
        if (activeScrollerRef.current === 'main' || activeScrollerRef.current === 'programmatic') return;

        if (window.innerWidth < 1024) {
          const scrollLeft = daySelector.scrollLeft;
          const progress = scrollLeft / ITEM_WIDTH;
          const bestIndex = Math.max(0, Math.min(dayCount - 1, Math.round(progress)));
          
          if (bestIndex !== activeIndexRef.current) {
            const targetX = bestIndex * container.clientWidth;
            targetMainScrollRef.current = targetX;

            activeIndexRef.current = bestIndex;
            setActiveIndex(bestIndex);
            onIndexChange?.(bestIndex, 'daySelector');
            
            container.scrollTo({
              left: targetX,
              behavior: 'auto'
            });
          }
        }
      });
    };

    const onInteractionStart = (type: 'main' | 'day') => {
      // If user starts interacting, ALWAYS break the programmatic lock and clear targets
      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
      activeScrollerRef.current = type;
      targetMainScrollRef.current = null;
      
      // Prevent snapping from fighting the sync during active drag
      if (type === 'day' && container) container.style.scrollSnapType = 'none';
      if (type === 'main' && daySelector) daySelector.style.scrollSnapType = 'none';
    };

    const onInteractionEnd = () => {
      if (activeScrollerRef.current === 'programmatic') return;
      
      // Restore snapping
      if (container) container.style.scrollSnapType = '';
      if (daySelector) daySelector.style.scrollSnapType = '';

      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
      scrollEndTimeoutRef.current = setTimeout(() => {
        activeScrollerRef.current = null;
        targetMainScrollRef.current = null;
      }, 200);
    };

    // Initial height sync (setTimeout to ensure DOM is fully rendered/images loaded)
    setTimeout(() => {
      requestAnimationFrame(updateContainerHeight);
    }, 100);

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
  }, [dayCount, onIndexChange, scrollRef, daySelectorRef]); 

  const scrollToDay = useCallback((index: number, isInstant = false) => {
    if (!scrollRef.current) return;
    
    if (index !== activeIndexRef.current) {
      console.log(`[ScrollSync] Scrolling to index ${index}${isInstant ? ' (instant)' : ''}`);
    }
    const container = scrollRef.current;
    const daySelector = daySelectorRef.current;
    const isDesktop = window.innerWidth >= 1024;
    
    // Calculate targets correctly for the orientation
    const targetX = index * container.clientWidth;
    let targetY = 0;
    
    if (isDesktop) {
      const targetSlide = container.querySelectorAll('.swipe-slide')[index] as HTMLElement;
      if (targetSlide) targetY = targetSlide.offsetTop;
    }
    
    // 1. Commit to the target
    targetMainScrollRef.current = isDesktop ? targetY : targetX;
    activeScrollerRef.current = 'programmatic';
    activeIndexRef.current = index; 
    
    // 2. Immediate UI update
    setActiveIndex(index);
    onIndexChange?.(index, 'programmatic');

    if (!isDesktop) {
      container.scrollTo({
        left: targetX,
        behavior: isInstant ? 'auto' : 'smooth'
      });

      if (daySelector) {
        daySelector.scrollTo({
          left: index * ITEM_WIDTH,
          behavior: isInstant ? 'auto' : 'smooth'
        });
      }
    } else {
      const targetSlide = container.querySelectorAll('.swipe-slide')[index] as HTMLElement;
      if (targetSlide) {
        // If we want it sticky at the top, we might need to account for padding
        const scrollTarget = targetSlide.offsetTop - 20; // Small margin
        container.scrollTo({
          top: scrollTarget,
          behavior: isInstant ? 'auto' : 'smooth'
        });
      }
    }

    if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
    scrollEndTimeoutRef.current = setTimeout(() => {
      activeScrollerRef.current = null;
      targetMainScrollRef.current = null;
    }, isInstant ? 50 : 10000);
  }, [onIndexChange]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    scrollRef,
    daySelectorRef,
    activeIndex,
    setActiveIndex,
    scrollToDay
  };
}
