'use strict';
/* Role gateway: one archive, two terminals. One card turns to show each side. */
(() => {
  const KEY = 'niti-role-v1';
  const gate = document.getElementById('gate');
  const roles = document.getElementById('roles');
  const skip = document.getElementById('gateSkip');
  const status = document.getElementById('gateStatus');
  const statuses = ['Инициализация архива', 'Сверка нитей', 'Загрузка терминала'];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let done = false;
  function reveal() {
    if (done) return;
    done = true;
    gate?.classList.add('is-done');
    if (roles) {
      roles.hidden = false;
      // Let the browser paint the hidden tree before the entrance animation.
      requestAnimationFrame(() => roles.classList.add('is-ready'));
    }
  }

  // The last used side starts facing the visitor and becomes a one-click continuation.
  let last = '';
  try { last = localStorage.getItem(KEY) || ''; } catch {}
  const lastLink = last ? document.querySelector(`[data-role="${last}"]`) : null;
  const badge = lastLink?.closest('.flick-face')?.querySelector('[data-badge]');
  if (badge) { badge.classList.add('is-last'); badge.textContent = 'Открыт последним'; }
  const cont = document.getElementById('continueRole');
  if (cont && last) {
    cont.hidden = false;
    cont.href = last === 'player' ? 'player/' : 'gm.html';
    cont.textContent = 'Продолжить как ' + (last === 'player' ? 'участник' : 'ведущий') + ' →';
  }

  document.querySelectorAll('[data-role]').forEach(link => {
    link.addEventListener('click', () => {
      try { localStorage.setItem(KEY, link.dataset.role); } catch {}
    });
  });

  /* ---------- the flipping card ---------- */

  const DEG_PER_PX = 0.6;         // degrees of turn per px of drag
  const STIFFNESS = 170;          // spring that lands the card on a face
  const DAMPING = 20;
  const PROJECTION = 0.22;        // seconds of release velocity used to pick the landing face
  const FLICK_SPEED = 450;        // deg/s that always turns at least one face
  const MAX_HALF_TURNS = 6;
  const DRAG_SLOP = 4;            // px before a press becomes a drag
  const LIFT = 36;                // px the card rises toward the viewer at 90°
  const TILT = 6;                 // degrees of hover pre-tilt
  const VELOCITY_WINDOW = 80;     // ms of recent motion used for release velocity
  const SUBSTEP = 1 / 240;
  const THICKNESS = 6;
  const SLICES = 7;
  const INTERACTIVE = 'button, a, input, select, textarea, [data-no-flip]';

  const mod2 = n => ((n % 2) + 2) % 2;
  const sideOf = angle => mod2(Math.round(angle / 180)) === 1;
  const nearestFace = angle => Math.round(angle / 180) * 180;

  function mountFlip(root, startFlipped) {
    const tilt = root.querySelector('.flick-tilt');
    const cardEl = root.querySelector('.flick-card');
    const shadow = root.querySelector('.flick-shadow');
    const front = root.querySelector('.flick-front');
    const back = root.querySelector('.flick-back');
    const hint = root.querySelector('.sr-only');
    const arrow = document.getElementById('flipArrow');
    if (!tilt || !cardEl || !shadow || !front || !back) return null;

    // The edge: thin slices stacked between the two faces.
    for (let i = 0; i < SLICES; i++) {
      const slice = document.createElement('div');
      slice.className = 'flick-slice';
      slice.setAttribute('aria-hidden', 'true');
      const z = -THICKNESS / 2 + (THICKNESS * (i + 0.5)) / SLICES;
      slice.style.transform = `translateZ(${z.toFixed(3)}px)`;
      cardEl.insertBefore(slice, front);
    }

    const bands = [...root.querySelectorAll('.flick-band')];
    const shades = [...root.querySelectorAll('.flick-shade')];
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const sim = {
      angle: startFlipped ? 180 : 0,
      velocity: 0,
      target: startFlipped ? 180 : 0,
      raf: 0,
      last: 0,
      reduceMotion: motionQuery.matches,
      pointerId: null,
      startX: 0,
      startY: 0,
      startAngle: 0,
      dragging: false,
      samples: []
    };
    let backVisible = startFlipped;

    motionQuery.addEventListener('change', () => { sim.reduceMotion = motionQuery.matches; });

    function applyFaces(showBack, force) {
      if (!force && showBack === backVisible) return;
      backVisible = showBack;
      front.inert = showBack;
      back.inert = !showBack;
      if (showBack) {
        front.setAttribute('aria-hidden', 'true');
        back.removeAttribute('aria-hidden');
      } else {
        back.setAttribute('aria-hidden', 'true');
        front.removeAttribute('aria-hidden');
      }
      if (hint) {
        hint.textContent = `Сейчас показан ${showBack ? 'участник' : 'ведущий'}. Перетащи карточку или нажми Enter, чтобы перевернуть.`;
      }
      if (arrow) arrow.setAttribute('aria-label', showBack ? 'Показать ведущего' : 'Показать участника');
    }

    function paint(sin) {
      const turn = Math.abs(sin);
      const shift = `${(sin * 140).toFixed(1)}%`;
      const transform = `translateX(${shift}) rotate(18deg)`;
      for (const band of bands) {
        band.style.opacity = (turn * 0.12).toFixed(3);
        band.style.transform = transform;
      }
      for (const shade of shades) shade.style.opacity = (turn * 0.14).toFixed(3);
    }

    function render() {
      const rad = (sim.angle * Math.PI) / 180;
      const sin = Math.sin(rad);
      const turn = Math.abs(sin);
      const facing = Math.abs(Math.cos(rad));

      cardEl.style.transform = `translateZ(${(turn * LIFT).toFixed(2)}px) rotateY(${sim.angle.toFixed(2)}deg)`;
      shadow.style.transform = `scale(${(0.16 + 0.84 * facing).toFixed(3)}, ${(1 - turn * 0.12).toFixed(3)})`;
      shadow.style.opacity = (1 - turn * 0.45).toFixed(3);
      paint(sin);
      applyFaces(sideOf(sim.angle));
    }

    function step(now) {
      const dt = Math.min(0.05, (now - sim.last) / 1000);
      sim.last = now;
      const n = Math.max(1, Math.ceil(dt / SUBSTEP));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const force = -STIFFNESS * (sim.angle - sim.target) - DAMPING * sim.velocity;
        sim.velocity += force * h;
        sim.angle += sim.velocity * h;
      }
      if (Math.abs(sim.angle - sim.target) < 0.05 && Math.abs(sim.velocity) < 0.5) {
        // Park on 0 or 180 so the numbers never grow, then sleep.
        sim.target = sideOf(sim.target) ? 180 : 0;
        sim.angle = sim.target;
        sim.velocity = 0;
        sim.raf = 0;
        render();
        return;
      }
      render();
      sim.raf = requestAnimationFrame(step);
    }

    function settle() {
      if (sim.reduceMotion) {
        cancelAnimationFrame(sim.raf);
        sim.raf = 0;
        sim.target = sideOf(sim.target) ? 180 : 0;
        sim.angle = sim.target;
        sim.velocity = 0;
        render();
        return;
      }
      if (!sim.raf) {
        sim.last = performance.now();
        sim.raf = requestAnimationFrame(step);
      }
    }

    function aim(target) {
      sim.target = target;
      settle();
    }

    function flipBy(direction) {
      aim(nearestFace(sim.target) + 180 * direction);
    }

    function setTilt(x, y) {
      tilt.style.transform = `rotateX(${(-y * TILT).toFixed(2)}deg) rotateY(${(x * TILT).toFixed(2)}deg)`;
    }

    function releaseVelocity(now) {
      const lastSample = sim.samples[sim.samples.length - 1];
      if (!lastSample || now - lastSample.t > VELOCITY_WINDOW) return 0;
      const first = sim.samples.find(point => lastSample.t - point.t <= VELOCITY_WINDOW);
      if (!first || lastSample.t <= first.t) return 0;
      return ((lastSample.a - first.a) / (lastSample.t - first.t)) * 1000;
    }

    function onPointerDown(event) {
      if (sim.pointerId !== null || event.button !== 0 || event.target.closest(INTERACTIVE)) return;
      sim.pointerId = event.pointerId;
      sim.startX = event.clientX;
      sim.startY = event.clientY;
      sim.startAngle = sim.angle;
      sim.dragging = false;
      sim.samples = [{ t: event.timeStamp, a: sim.angle }];
      root.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event) {
      if (sim.pointerId !== event.pointerId) {
        // Hover pre-tilt follows the cursor; it is motion, so reduced motion skips it.
        if (event.pointerType !== 'mouse' || sim.reduceMotion) return;
        const rect = root.getBoundingClientRect();
        setTilt(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          ((event.clientY - rect.top) / rect.height) * 2 - 1
        );
        return;
      }
      const dx = event.clientX - sim.startX;
      const dy = event.clientY - sim.startY;
      if (!sim.dragging) {
        if (Math.hypot(dx, dy) < DRAG_SLOP) return;
        sim.dragging = true;
        cancelAnimationFrame(sim.raf);
        sim.raf = 0;
        sim.velocity = 0;
        setTilt(0, 0);
      }
      // One to one: the card stays under the finger.
      sim.angle = sim.startAngle + dx * DEG_PER_PX;
      sim.samples.push({ t: event.timeStamp, a: sim.angle });
      if (sim.samples.length > 8) sim.samples.shift();
      render();
    }

    function release(event, cancelled) {
      if (sim.pointerId !== event.pointerId) return;
      sim.pointerId = null;
      if (!sim.dragging) {
        if (!cancelled) {
          // A click pushes the half you pressed away from you.
          const rect = root.getBoundingClientRect();
          const pushed = event.clientX > rect.left + rect.width / 2;
          flipBy(pushed ? 1 : -1);
        }
        return;
      }
      sim.dragging = false;

      const velocity = cancelled ? 0 : releaseVelocity(event.timeStamp);
      const from = nearestFace(sim.startAngle);
      let target = nearestFace(sim.angle + velocity * PROJECTION);
      if (Math.abs(velocity) > FLICK_SPEED && target === from) {
        target = from + 180 * Math.sign(velocity);
      }
      const limit = MAX_HALF_TURNS * 180;
      target = Math.max(from - limit, Math.min(from + limit, target));
      sim.velocity = velocity;
      aim(target);
    }

    function onKeyDown(event) {
      if (event.target !== root) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        flipBy(1);
      }
    }

    root.addEventListener('pointerdown', onPointerDown);
    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerup', event => release(event, false));
    root.addEventListener('pointercancel', event => release(event, true));
    root.addEventListener('lostpointercapture', event => release(event, true));
    root.addEventListener('pointerleave', () => {
      if (sim.pointerId === null) setTilt(0, 0);
    });
    root.addEventListener('keydown', onKeyDown);

    arrow?.addEventListener('click', () => flipBy(-1));

    applyFaces(startFlipped, true);
    render();

    return { flipBy };
  }

  mountFlip(document.getElementById('roleCard'), last === 'player');

  /* ---------- player terminal availability ---------- */

  // On the combined site the player terminal lives at /player/. A standalone
  // deployment keeps the external terminal instead of showing a dead link.
  const standalone = 'https://niti-players.thegromvel.chatgpt.site/';
  const playerLinks = [...document.querySelectorAll('[data-role="player"], a[href="player/"]')];
  if (playerLinks.length) {
    fetch('player/player-ticker.js', {method: 'HEAD', cache: 'no-store'})
      .then(response => {
        const type = response.headers.get('content-type') || '';
        if (response.ok && /javascript/i.test(type)) return;
        playerLinks.forEach(link => { link.href = standalone; });
      })
      .catch(() => playerLinks.forEach(link => { link.href = standalone; }));
  }

  /* ---------- intro ---------- */

  skip?.addEventListener('click', reveal);

  if (reduced) {
    // Static intro for people who asked the system for less motion.
    if (status) status.textContent = 'Загрузка терминала';
    setTimeout(reveal, 1100);
  } else {
    let step = 0;
    const ticker = setInterval(() => {
      step = (step + 1) % statuses.length;
      if (status) status.textContent = statuses[step];
    }, 900);
    const finish = () => { clearInterval(ticker); reveal(); };
    // Short intro; the page is usable immediately after it.
    const timer = setTimeout(finish, 2500);
    const cut = () => { clearTimeout(timer); finish(); };
    window.addEventListener('keydown', cut, {once: true});
    window.addEventListener('pointerdown', cut, {once: true});
  }

  // Coming back with the browser cache (bfcache) should not replay the intro.
  window.addEventListener('pageshow', event => { if (event.persisted) reveal(); });
})();
