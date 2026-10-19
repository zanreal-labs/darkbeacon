/**
 * The site's micro-interactions (styles/motion.css). Tiny on purpose: one IntersectionObserver
 * for scroll reveals and one passive pointer listener for the card spotlight.
 *
 * Only blocks below the fold are marked pending, so nothing on the first screen ever starts
 * hidden or flickers, and without JavaScript every block is simply there.
 */

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduce && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-revealed', '');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -15% 0px' },
  );
  for (const el of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
    if (el.getBoundingClientRect().top < window.innerHeight) continue;
    el.setAttribute('data-reveal-pending', '');
    observer.observe(el);
  }
}

// The spotlight follows the pointer over a card; one write per frame at most.
let frame = 0;
document.addEventListener(
  'pointermove',
  (event) => {
    if (event.pointerType !== 'mouse' || frame) return;
    const card = (event.target as Element | null)?.closest?.<HTMLElement>('.card');
    if (!card) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - box.left}px`);
      card.style.setProperty('--my', `${event.clientY - box.top}px`);
    });
  },
  { passive: true },
);
