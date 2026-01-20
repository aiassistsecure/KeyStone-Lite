'use strict';

// Smooth scroll for anchor links (avoid breaking external links like href="#")
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');

    // Allow empty hash links (e.g., "#") to behave normally
    if (!href || href === '#') return;

    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Intersection Observer for fade-in animations
const observerOptions = {
  threshold: 0.1,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, observerOptions);

// Apply to feature cards
document.querySelectorAll('.feature-card').forEach((card, i) => {
  card.style.opacity = '0';
  card.style.transform = 'translateY(20px)';
  card.style.transition = `all 0.6s cubic-bezier(0.19, 1, 0.22, 1) ${i * 0.1}s`;
  observer.observe(card);
});

// Testimonials carousel
const carousel = document.querySelector('[data-testimonials]');
if (carousel) {
  const track = carousel.querySelector('.testimonials-track');
  const slides = Array.from(carousel.querySelectorAll('.testimonial-slide'));
  const dots = Array.from(carousel.querySelectorAll('.testimonials-dot'));

  let index = 0;
  let timerId = null;
  const ROTATE_MS = 5000;

  function clampIndex(next) {
    const len = slides.length;
    return ((next % len) + len) % len;
  }

  function updateDots(activeIndex) {
    dots.forEach((dot, i) => {
      const selected = i === activeIndex;
      dot.setAttribute('aria-selected', selected ? 'true' : 'false');
      dot.tabIndex = selected ? 0 : -1;
    });
  }

  function goTo(nextIndex) {
    index = clampIndex(nextIndex);
    track.style.transform = `translateX(-${index * 100}%)`;
    updateDots(index);
  }

  function start() {
    stop();
    timerId = window.setInterval(() => goTo(index + 1), ROTATE_MS);
  }

  function stop() {
    if (timerId) window.clearInterval(timerId);
    timerId = null;
  }

  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      goTo(i);
      start();
    });

    dot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goTo(i);
        start();
      }
    });
  });

  // Pause rotation while hovering/focusing inside carousel (nice UX, still auto-rotates otherwise)
  carousel.addEventListener('mouseenter', stop);
  carousel.addEventListener('mouseleave', start);
  carousel.addEventListener('focusin', stop);
  carousel.addEventListener('focusout', start);

  goTo(0);
  start();
}