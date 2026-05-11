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
      requestAnimationFrame(() => {
        const isDesktop = window.innerWidth >= 800;
        
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

        // 1. Sync visual height ONLY while dragging to prevent killing momentum/glide on iOS
        if (isDraggingRef.current) {
          updateContainerHeight();
        }
        


        const slides = Array.from(container.querySelectorAll('.swipe-slide'));
        let bestIndex = 0;
        let minDistance = Infinity;
        
        if (isDesktop) {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          
          if (maxScroll <= 0) {
            // Container doesn't scroll because all content fits on screen.
            // Do not override active index with scroll events.
            return;
          }

          const scrollTop = container.scrollTop;
          
          // The trigger point dynamically glides from the top to the bottom of the viewport
          // based on the overall scroll percentage. This perfectly maintains middle-focus 
          // normally, while naturally handling short items at the top and bottom bounds.
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
                       activeScrollerRef.current === 'day' ? 'daySelector' : 
                       (activeScrollerRef.current === null ? 'manual' : 'void');
          
          if (type === 'void') return; 

          activeIndexRef.current = bestIndex;
          setActiveIndex(bestIndex);
          onIndexChange?.(bestIndex, type);

          // Sync container height to new active slide (prevents stranding on short days)
          updateContainerHeight();
        }
      });
    };

    const onDayScroll = () => {
      if (activeScrollerRef.current === 'main' || activeScrollerRef.current === 'programmatic') return;
      
      requestAnimationFrame(() => {
        if (activeScrollerRef.current === 'main' || activeScrollerRef.current === 'programmatic') return;

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
      isDraggingRef.current = true;
    };

    const onInteractionEnd = () => {
      isDraggingRef.current = false;
      if (activeScrollerRef.current === 'programmatic') return;
      
      // Final sync after CSS snap completes: update height + fix vertical scroll
      const settleAfterSnap = () => {
        activeScrollerRef.current = null;
        targetMainScrollRef.current = null;
        requestAnimationFrame(() => {
          updateContainerHeight();

          // After height shrinks, correct window.scrollY if user is stranded below content
          const isDesktop = window.innerWidth >= 800;
          if (!isDesktop) {
            const docHeight = document.documentElement.scrollHeight;
            const viewportBottom = window.scrollY + window.innerHeight;
            if (viewportBottom > docHeight + 20) {
              const targetY = Math.max(0, docHeight - window.innerHeight);
              window.scrollTo({ top: targetY, behavior: 'smooth' });
            }
          }
        });
      };

      if (scrollEndTimeoutRef.current) clearTimeout(scrollEndTimeoutRef.current);
      
      // Use scrollend (fires when CSS snap completes) if available
      if ('onscrollend' in container) {
        container.addEventListener('scrollend', settleAfterSnap, { once: true });
        // Safety fallback in case scrollend doesn't fire
        scrollEndTimeoutRef.current = setTimeout(settleAfterSnap, 800);
      } else {
        // Fallback: wait long enough for CSS snap to complete
        scrollEndTimeoutRef.current = setTimeout(settleAfterSnap, 600);
      }
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
    const isDesktop = window.innerWidth >= 800;
    
    // Calculate targets correctly for the orientation
    const targetX = index * container.clientWidth;
    let targetY = 0;
    
    if (isDesktop) {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const targetSlide = container.querySelectorAll('.swipe-slide')[index] as HTMLElement;
      // Bound the target to maxScroll so the proximity lock releases correctly when hitting the bottom
      if (targetSlide) targetY = Math.max(0, Math.min(maxScroll, targetSlide.offsetTop - 20));
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

      // Force immediate height sync for programmatic jumps to ensure vertical scrolling room
      const targetSlide = container.querySelectorAll('.swipe-slide')[index] as HTMLElement;
      if (targetSlide) {
        container.style.height = `${targetSlide.offsetHeight}px`;
      }

      if (daySelector) {
        daySelector.scrollTo({
          left: index * ITEM_WIDTH,
          behavior: isInstant ? 'auto' : 'smooth'
        });
      }
    } else {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const targetSlide = container.querySelectorAll('.swipe-slide')[index] as HTMLElement;
      if (targetSlide) {
        // Use the exact same calculation as targetY so the proximity lock safely disengages
        const scrollTarget = Math.max(0, Math.min(maxScroll, targetSlide.offsetTop - 20)); 
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
