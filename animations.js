/**
 * ANIMATIONS ENGINE v1.0
 * IntersectionObserver + Ripple + Counter + Tilt + Magnetic
 */
(function() {
  'use strict';

  // Проверяем prefers-reduced-motion
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    console.log('[Animations] Reduced motion enabled — отключаем анимации');
    return;
  }

  // ═══════════════════════════════════════
  //  1. SCROLL ANIMATIONS (IntersectionObserver)
  // ═══════════════════════════════════════
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -80px 0px',
    threshold: 0.1
  };

  const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        // После анимации перестаём наблюдать (одноразовая анимация)
        if (!entry.target.classList.contains('animate-repeat')) {
          scrollObserver.unobserve(entry.target);
        }
      } else if (entry.target.classList.contains('animate-repeat')) {
        entry.target.classList.remove('is-visible');
      }
    });
  }, observerOptions);

  // Наблюдаем за всеми элементами с классом animate-on-scroll
  function initScrollAnimations() {
    document.querySelectorAll('.animate-on-scroll').forEach(el => {
      scrollObserver.observe(el);
    });
  }

  // ═══════════════════════════════════════
  //  2. RIPPLE EFFECT (волна при клике)
  // ═══════════════════════════════════════
  function createRipple(event) {
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    // Удаляем старые ripple
    const oldRipple = element.querySelector('.ripple');
    if (oldRipple) oldRipple.remove();

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    element.appendChild(ripple);

    // Удаляем после анимации
    setTimeout(() => ripple.remove(), 600);
  }

  function initRipple() {
    document.querySelectorAll('.ripple-element').forEach(el => {
      el.addEventListener('click', createRipple);
    });
  }

  // ═══════════════════════════════════════
  //  3. NUMBER COUNTER (анимация чисел)
  // ═══════════════════════════════════════
  function animateCounter(element, target, duration = 1500) {
    const start = 0;
    const startTime = performance.now();
    const isFloat = target % 1 !== 0;
    const decimals = isFloat ? (target.toString().split('.')[1] || '').length : 0;

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Easing: ease-out-cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = start + (target - start) * easeOut;

      element.textContent = isFloat ? current.toFixed(decimals) : Math.floor(current);

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = isFloat ? target.toFixed(decimals) : target;
      }
    }

    requestAnimationFrame(update);
  }

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !entry.target.dataset.counted) {
        const target = parseFloat(entry.target.dataset.counter);
        if (!isNaN(target)) {
          entry.target.dataset.counted = 'true';
          animateCounter(entry.target, target);
        }
      }
    });
  }, { threshold: 0.3 });

  function initCounters() {
    document.querySelectorAll('[data-counter]').forEach(el => {
      counterObserver.observe(el);
    });
  }

  // ═══════════════════════════════════════
  //  4. TILT 3D EFFECT (наклон карточек при hover)
  // ═══════════════════════════════════════
  function initTilt() {
    if ('ontouchstart' in window) return; // Отключаем на тач-устройствах

    document.querySelectorAll('.tilt-card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = ((y - centerY) / centerY) * -6;
        const rotateY = ((x - centerX) / centerX) * 6;

        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`;
      });

      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateZ(0)';
      });
    });
  }

  // ═══════════════════════════════════════
  //  5. MAGNETIC BUTTONS (притягиваются к курсору)
  // ═══════════════════════════════════════
  function initMagnetic() {
    if ('ontouchstart' in window) return;

    document.querySelectorAll('.magnetic-btn').forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;

        btn.style.transform = `translate(${x * 0.25}px, ${y * 0.25}px)`;
      });

      btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'translate(0, 0)';
      });
    });
  }

  // ═══════════════════════════════════════
  //  6. PARALLAX (для hero и background)
  // ═══════════════════════════════════════
  function initParallax() {
    if ('ontouchstart' in window) return;

    const parallaxElements = document.querySelectorAll('[data-parallax]');
    if (parallaxElements.length === 0) return;

    let ticking = false;

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrolled = window.pageYOffset;
          parallaxElements.forEach(el => {
            const speed = parseFloat(el.dataset.parallax) || 0.5;
            const yPos = -(scrolled * speed);
            el.style.transform = `translate3d(0, ${yPos}px, 0)`;
          });
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  // ═══════════════════════════════════════
  //  7. STAGGERED ANIMATIONS (для сеток)
  // ═══════════════════════════════════════
  function initStagger() {
    document.querySelectorAll('.stagger').forEach(container => {
      const children = Array.from(container.children);
      children.forEach((child, index) => {
        child.style.animationDelay = `${index * 0.08}s`;
        if (!child.classList.contains('animate-on-scroll')) {
          child.classList.add('animate-on-scroll', 'animate-fade-up');
        }
      });
    });
    // Переинициализируем observer
    initScrollAnimations();
  }

  // ═══════════════════════════════════════
  //  8. SMOOTH SCROLL (для якорных ссылок)
  // ═══════════════════════════════════════
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;

        const target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });
  }

  // ═══════════════════════════════════════
  //  9. AUTO-ADD ANIMATION CLASSES
  //     для существующих элементов
  // ═══════════════════════════════════════
  function autoAddAnimationClasses() {
    // Карточки — fade-up при скролле
    const cardSelectors = [
      '.v-card',
      '.other-card',
      '.sleep-card',
      '.doctor-card',
      '.schedule-card',
      '.notif-card',
      '.appt-card',
      '.med-tracker',
      '.spec-card',
      '.patient-full'
    ];

    cardSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (!el.classList.contains('animate-on-scroll')) {
          el.classList.add('animate-on-scroll', 'animate-fade-up');
        }
        // Добавляем ripple и tilt
        el.classList.add('ripple-element', 'ripple-dark', 'tilt-card');
      });
    });

    // Quick actions — stagger + magnetic
    const quickGrid = document.querySelector('.quick-grid');
    if (quickGrid) {
      quickGrid.classList.add('stagger');
      quickGrid.querySelectorAll('.qi').forEach(qi => {
        qi.classList.add('magnetic-btn');
      });
    }

    // Кнопки — ripple + click-scale
    const buttonSelectors = [
      '.pill',
      '.next-btn',
      '.empty-btn',
      '.chat-send',
      '.period-btn'
    ];

    buttonSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(btn => {
        btn.classList.add('ripple-element', 'click-scale');
      });
    });

    // FAB — magnetic + pulse
    const fab = document.querySelector('.nav-fab');
    if (fab) {
      fab.classList.add('magnetic-btn');
    }

    // Section headers — slide in
    document.querySelectorAll('.sec-hd').forEach(header => {
      header.classList.add('animate-on-scroll', 'animate-slide-left');
    });

    // Patient card — уже анимируется через CSS
    // Vitals grid — stagger
    const vitalsGrid = document.querySelector('.vitals-grid');
    if (vitalsGrid) {
      vitalsGrid.classList.add('stagger');
    }
  }

  // ═══════════════════════════════════════
  //  10. PAGE TRANSITIONS
  // ═══════════════════════════════════════
  function initPageTransitions() {
    // Добавляем класс анимации при загрузке страницы
    document.body.classList.add('page-loaded');

    // Плавный переход при клике на ссылки (не для внешних и якорей)
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      link.addEventListener('click', function(e) {
        // Пропускаем если модификаторы клавиш
        if (e.ctrlKey || e.metaKey || e.shiftKey) return;

        e.preventDefault();
        document.body.style.opacity = '0';
        document.body.style.transition = 'opacity 0.3s ease';

        setTimeout(() => {
          window.location.href = href;
        }, 300);
      });
    });
  }

  // ═══════════════════════════════════════
  //  11. TYPEWRITER EFFECT
  // ═══════════════════════════════════════
  function initTypewriter() {
    document.querySelectorAll('[data-typewriter]').forEach(el => {
      const text = el.dataset.typewriter;
      const speed = parseInt(el.dataset.typewriterSpeed) || 50;
      el.textContent = '';
      el.style.visibility = 'visible';

      let i = 0;
      function type() {
        if (i < text.length) {
          el.textContent += text.charAt(i);
          i++;
          setTimeout(type, speed);
        }
      }

      // Запускаем когда элемент виден
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          type();
          observer.disconnect();
        }
      });
      observer.observe(el);
    });
  }

  // ═══════════════════════════════════════
  //  INITIALIZATION
  // ═══════════════════════════════════════
  function init() {
    autoAddAnimationClasses();
    initScrollAnimations();
    initRipple();
    initCounters();
    initTilt();
    initMagnetic();
    initParallax();
    initStagger();
    initSmoothScroll();
    initPageTransitions();
    initTypewriter();

    console.log('[Animations] ✨ Инициализированы все анимации');
  }

  // Запускаем когда DOM готов
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Экспорт для использования из других скриптов
  window.AnimationsEngine = {
    animateCounter,
    createRipple,
    reinit: init
  };

})();