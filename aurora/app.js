// Aurora's site. Opens the download section on the visitor's own platform, counts each download in
// Supabase, and — when GitHub answers — fills in file sizes and how old the newest build is.
(() => {
  // the public repo is where every downloadable release lives; the app repo stays private
  const REPO = 'BannedVariable/BannedVariable.github.io';
  const API = `https://api.github.com/repos/${REPO}`;
  // SideStore fetches this itself, with no GitHub login, so it lives on the public site rather than
  // in a release on the (private) app repository.
  const SOURCE_URL = 'https://bannedvariable.github.io/aurora/sidestore.json';
  const REFRESH_MS = 60 * 1000; // the counter is one Supabase read a minute
  const DETAILS_MS = 30 * 60 * 1000; // sizes and versions come from GitHub, which changes far less often
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // ---- your device ----
  const ua = navigator.userAgent;
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const os = /iPhone|iPad|iPod/.test(ua) || touchMac ? 'ios'
    : /Android/i.test(ua) ? 'android'
    : /Windows/i.test(ua) ? 'windows'
    : /Macintosh|Linux|X11/i.test(ua) ? 'desktop' : null;
  // SideStore's docs pass the source URL through unencoded; percent-escapes are what its parser chokes on.
  $('dl-sidestore').href = `sidestore://source?url=${SOURCE_URL}`;
  // the same file the source points at: one link for the store, one for Sideloadly
  $('dl-ipa').href = 'https://github.com/BannedVariable/BannedVariable.github.io/releases/download/ios-latest/Aurora.ipa';

  // A signed build is optional: the signing service's install link is kept out of the HTML so a
  // revoked or rotated certificate can be changed in one small file, and the button stays hidden
  // until there is a link to give it. Accepts an itms-services manifest or an https install page.
  async function loadSignedBuild() {
    const row = $('signed-row');
    const btn = $('dl-signed');
    const note = $('signed-note');
    if (!row || !btn) return;
    try {
      const res = await fetch('signed.json', { cache: 'no-store' });
      if (!res.ok) return;
      const cfg = await res.json();
      const url = String(cfg.url || cfg.installUrl || '').trim();
      if (!/^(https:|itms-services:)/i.test(url)) return;
      btn.href = url;
      if (cfg.label) btn.textContent = String(cfg.label);
      if (note) {
        note.textContent = String(cfg.note || '');
        note.hidden = !cfg.note;
      }
      row.hidden = false;
    } catch (e) { /* no signed build configured */ }
  }
  loadSignedBuild();

  // "Download" in the hero and the bar goes to the download section, never straight to one file:
  // Aurora runs on five platforms, so the visitor picks there (and their own tab is already open).

  // ---- platform tabs ----
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(name, focus) {
    tabs.forEach((t) => {
      const on = t.dataset.os === name;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focus) t.focus();
    });
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t.dataset.os));
    t.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      selectTab(tabs[(i + step + tabs.length) % tabs.length].dataset.os, true);
    });
  });
  const mineTab = tabs.find((t) => t.dataset.os === os);
  if (mineTab) mineTab.classList.add('mine');
  selectTab(os || 'android');

  // ---- download counter ----
  // GitHub's release download_count only refreshes about ten minutes after a download and resets
  // whenever a rolling release's file is replaced, so the site counts its own downloads in the same
  // Supabase project as cloud profiles. Both values are public by design: row level security keeps
  // the table unreachable, and only the two counter functions below can be called with this key.
  const CLOUD = {
    url: 'https://bxmeboourjndlxkbqaic.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4bWVib291cmpuZGx4a2JxYWljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDU5MTEsImV4cCI6MjEwODcyMTkxMX0.Tcuh6_VEftc-Bi623D3K9-tuWpzGFpZsDfh8VBIDJys',
  };
  const COUNTS_KEY = 'aurora_site_counts_v3';
  const PLATFORMS = [['android', 'Android'], ['ios', 'iPhone'], ['windows', 'Windows'], ['mac', 'Mac'], ['linux', 'Linux']];
  const BLANK = { android: 0, ios: 0, windows: 0, mac: 0, linux: 0 };

  async function fetchCounts() {
    const res = await fetch(`${CLOUD.url}/rest/v1/rpc/get_download_counts`, {
      method: 'POST',
      headers: {
        apikey: CLOUD.anonKey,
        Authorization: `Bearer ${CLOUD.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(String(res.status));
    const per = { ...BLANK };
    for (const row of await res.json()) {
      if (row.platform in per) per[row.platform] = Number(row.downloads) || 0;
    }
    return per;
  }

  function recordDownload(platform) {
    return fetch(`${CLOUD.url}/rest/v1/rpc/record_download`, {
      method: 'POST',
      headers: {
        apikey: CLOUD.anonKey,
        Authorization: `Bearer ${CLOUD.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_platform: platform }),
      keepalive: true,
    });
  }

  const fmt = (n) => n.toLocaleString('en-US');

  // rolling digits: each digit is a 0-9 strip moved into place
  const odo = $('odo');
  // the counter sits below the first screen: its digits wait at 0 and roll up once it scrolls into view
  let odoSeen = !('IntersectionObserver' in window);
  let odoPending = null;
  if (!odoSeen) {
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      odoSeen = true;
      seen.disconnect();
      if (odoPending) { const run = odoPending; odoPending = null; setTimeout(run, 250); }
    }, { threshold: 0.6 });
    seen.observe(odo);
  }
  function setOdometer(n) {
    const text = fmt(n);
    if (odo.dataset.text === text) return;
    const fresh = odo.dataset.len !== String(text.length);
    if (fresh) {
      odo.innerHTML = '';
      [...text].forEach((ch, i) => {
        const slot = document.createElement('span');
        if (/\d/.test(ch)) {
          slot.className = 'd';
          const strip = document.createElement('span');
          strip.className = 'strip';
          strip.style.transitionDelay = `${i * 60}ms`;
          for (let d = 0; d < 10; d++) { const g = document.createElement('i'); g.textContent = d; strip.appendChild(g); }
          slot.appendChild(strip);
        } else {
          slot.className = 'sep';
          slot.textContent = ch;
        }
        odo.appendChild(slot);
      });
      const plus = document.createElement('span');
      plus.className = 'plus';
      plus.textContent = '+';
      odo.appendChild(plus);
      odo.dataset.len = String(text.length);
    }
    const slots = odo.querySelectorAll('.d .strip, .sep');
    const apply = () => [...text].forEach((ch, i) => {
      if (/\d/.test(ch) && slots[i]) slots[i].style.transform = `translateY(${-Number(ch) * 10}%)`;
    });
    // a new row of digits starts at 0 and rolls up, once it can be seen
    const run = () => (fresh ? requestAnimationFrame(() => requestAnimationFrame(apply)) : apply());
    if (odoSeen) run(); else odoPending = run;
    odo.dataset.text = text;
  }

  function render(per) {
    $('count').hidden = false;
    const total = Object.values(per).reduce((a, b) => a + b, 0);
    setOdometer(total);
    $('count-sr').textContent = `${fmt(total)} downloads`;
    const ranked = PLATFORMS.filter(([k]) => per[k] > 0).sort((a, b) => per[b[0]] - per[a[0]]);
    const top = ranked.length ? per[ranked[0][0]] : 1;
    $('ranks').innerHTML = ranked.map(([k, label]) => `<li><span class="r-name">${label}</span><span class="r-n">${fmt(per[k])}</span><span class="r-bar"><i style="width:${Math.max(2, (per[k] / top) * 100)}%"></i></span></li>`).join('');
    const cardCounts = { android: per.android, ios: per.ios, windows: per.windows, desktop: per.mac + per.linux };
    document.querySelectorAll('[data-count]').forEach((el) => {
      const n = cardCounts[el.dataset.count];
      el.textContent = `${fmt(n)} downloads`;
    });
  }

  // ---- sizes, versions, build age ----
  const mb = (n) => `${(n / 1048576).toFixed(n > 20971520 ? 0 : 1)} MB`;
  const ago = (d) => {
    const h = Math.round((Date.now() - new Date(d)) / 3600000);
    return h < 1 ? 'just now' : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
  };
  function details(releases) {
    const byTag = Object.fromEntries(releases.map((r) => [r.tag_name, r]));
    const size = (tag, file, id) => {
      const a = byTag[tag] && byTag[tag].assets.find((x) => x.name === file);
      if (a && $(id)) $(id).textContent = `· ${mb(a.size)}`;
    };
    size('android-latest', 'Aurora.apk', 'size-android');
    size('windows-latest', 'Aurora.exe', 'size-windows');
    size('ios-latest', 'Aurora.ipa', 'size-ios');
    const newest = ['android-latest', 'ios-latest', 'windows-latest'].map((t) => byTag[t] && byTag[t].published_at).filter(Boolean).sort().pop();
    if (newest) $('build-info').textContent = `Free · newest build ${ago(newest)}`;

    // desktop installers come from the newest versioned release (v1.2.3), not the rolling ones
    // the newest one that has its installers already (a release being built has none yet)
    const rel = releases.find((r) => !r.draft && !r.prerelease && /^v\d/.test(r.tag_name) && r.assets.some((x) => /\.dmg$/i.test(x.name)));
    if (!rel) return;
    const pick = (re) => rel.assets.find((a) => re.test(a.name));
    const set = (id, a) => { if (a && $(id)) $(id).href = a.browser_download_url; };
    set('dl-mac-arm', pick(/mac-arm64\.dmg$/i));
    set('dl-mac-x64', pick(/mac-x64\.dmg$/i));
    const appImage = pick(/\.AppImage$/i);
    set('dl-linux', appImage);
    if (appImage) {
      $('size-linux').textContent = `· ${mb(appImage.size)}`;
      $('linux-line').textContent = `mkdir -p ~/Applications && curl -L -o ~/Applications/Aurora.AppImage ${appImage.browser_download_url} && chmod +x ~/Applications/Aurora.AppImage && ~/Applications/Aurora.AppImage`;
    }
    $('rel-version').textContent = rel.tag_name.replace(/^v/, '');
  }

  // ---- live updates ----
  const cached = store.get(COUNTS_KEY);
  if (cached && cached.per) render(cached.per);
  let lastFetch = 0;
  let timer = 0;
  let soon = 0;
  let detailsAt = 0;
  const refreshSoon = () => { clearTimeout(soon); soon = setTimeout(refresh, 1500); };

  async function refreshDetails() {
    // don't retry GitHub every minute when it is rate-limiting this visitor
    detailsAt = Date.now();
    try {
      const res = await fetch(`${API}/releases?per_page=100`, { headers: { Accept: 'application/vnd.github+json' } });
      if (res.ok) details(await res.json());
    } catch (e) {}
  }

  async function refresh() {
    clearTimeout(soon);
    lastFetch = Date.now();
    try {
      const per = await fetchCounts();
      render(per);
      store.set(COUNTS_KEY, { per, at: Date.now() });
      $('live-text').textContent = 'Live';
      document.querySelector('.pulse').classList.remove('off');
    } catch (e) {
      // Supabase is down or blocked; keep the last numbers instead of showing a false zero
      $('live-text').textContent = cached || odo.dataset.text ? 'Live updates paused for now' : 'Couldn’t reach the counter';
      document.querySelector('.pulse').classList.add('off');
      if (!odo.dataset.text) odo.innerHTML = '<span class="odo-wait">—</span>';
      if (!$('ranks').children.length) $('ranks').innerHTML = '<li class="wait">Couldn’t load the numbers right now.</li>';
    }
    if (!detailsAt || Date.now() - detailsAt > DETAILS_MS) await refreshDetails();
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(refresh, REFRESH_MS);
  }

  // a download is counted when someone takes a build from this page
  const lastHit = {};
  document.querySelectorAll('[data-dl]').forEach((a) => a.addEventListener('click', () => {
    const platform = a.dataset.dl;
    if (!(platform in BLANK)) return;
    const now = Date.now();
    // a double click is still one download
    if (lastHit[platform] && now - lastHit[platform] < 15000) return;
    lastHit[platform] = now;
    // move the number immediately, then settle on the server's total
    const shown = store.get(COUNTS_KEY);
    if (shown && shown.per) {
      shown.per[platform] = (shown.per[platform] || 0) + 1;
      render(shown.per);
      store.set(COUNTS_KEY, { per: shown.per, at: Date.now() });
    }
    recordDownload(platform).then(async (res) => {
      if (!res.ok) return;
      // the function returns the new total, so the shown number is exact even if a refresh is slow
      const total = Number(await res.text());
      const current = store.get(COUNTS_KEY);
      if (current && current.per && Number.isFinite(total)) {
        current.per[platform] = total;
        render(current.per);
        store.set(COUNTS_KEY, { per: current.per, at: Date.now() });
      }
      refreshSoon();
    }).catch(() => {});
  }));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(timer); return; }
    if (Date.now() - lastFetch > REFRESH_MS) refresh();
    else { clearTimeout(timer); timer = setTimeout(refresh, REFRESH_MS - (Date.now() - lastFetch)); }
  });
  refresh();

  // ---- the Dynamic Island preview ----
  const overlayDemo = document.querySelector('[data-overlay-demo]');
  if (overlayDemo) {
    const tracks = [
      { title: 'Midnight City', artist: 'M83', lyric: 'Waiting for the night to come', duration: 244, start: 102 },
      { title: "Boy's a liar Pt. 2", artist: 'PinkPantheress & Ice Spice', lyric: "He doesn't see ya, you're not looking at me", duration: 131, start: 38 },
      { title: 'Sofia', artist: 'Clairo', lyric: 'I think we could do it if we tried', duration: 187, start: 64 },
    ];
    const odTitle = overlayDemo.querySelector('[data-od-title]');
    const odArtist = overlayDemo.querySelector('[data-od-artist]');
    const odLyric = overlayDemo.querySelector('[data-od-lyric]');
    const odPlay = overlayDemo.querySelector('[data-od-play]');
    const odFill = overlayDemo.querySelector('[data-od-fill]');
    const odTime = overlayDemo.querySelector('[data-od-time]');
    const odLeft = overlayDemo.querySelector('[data-od-left]');
    const odIsland = overlayDemo.querySelector('[data-od-island]');
    const odExpand = overlayDemo.querySelector('[data-od-expand]');
    let odTrack = 0;
    let odPlaying = true;
    let odPosition = tracks[0].start;
    const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    const paintProgress = () => {
      const track = tracks[odTrack];
      const done = Math.min(odPosition, track.duration);
      if (odFill) odFill.style.width = `${(done / track.duration) * 100}%`;
      if (odTime) odTime.textContent = clock(done);
      if (odLeft) odLeft.textContent = `-${clock(Math.max(0, track.duration - done))}`;
    };
    const paintOverlay = () => {
      const track = tracks[odTrack];
      odTitle.textContent = track.title;
      odArtist.textContent = track.artist;
      if (odLyric) odLyric.textContent = track.lyric;
      overlayDemo.classList.toggle('is-paused', !odPlaying);
      odPlay.classList.toggle('is-paused', !odPlaying);
      odPlay.setAttribute('aria-label', odPlaying ? 'Pause' : 'Play');
      paintProgress();
    };
    const move = (step) => {
      odTrack = (odTrack + step + tracks.length) % tracks.length;
      odPosition = 0;
      paintOverlay();
    };
    overlayDemo.querySelector('[data-od-prev]').addEventListener('click', () => move(-1));
    overlayDemo.querySelector('[data-od-next]').addEventListener('click', () => move(1));
    odPlay.addEventListener('click', () => { odPlaying = !odPlaying; paintOverlay(); });

    // the compact capsule opens on hover, keyboard focus, or tap; tapping outside closes it
    if (odIsland && odExpand) {
      const hoverable = window.matchMedia('(hover: hover)').matches;
      const syncExpanded = () => odExpand.setAttribute('aria-expanded', String(odIsland.classList.contains('is-open') || odIsland.matches(':focus-within')));
      odExpand.addEventListener('click', () => {
        odIsland.classList.add('is-open');
        syncExpanded();
      });
      if (hoverable) {
        odIsland.addEventListener('mouseenter', () => {
          odIsland.classList.add('is-open');
          syncExpanded();
        });
        odIsland.addEventListener('mouseleave', () => {
          if (odIsland.contains(document.activeElement)) return;
          odIsland.classList.remove('is-open');
          syncExpanded();
        });
      }
      odIsland.addEventListener('focusin', syncExpanded);
      odIsland.addEventListener('focusout', () => setTimeout(syncExpanded, 0));
      odIsland.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        odIsland.classList.remove('is-open');
        if (odIsland.contains(document.activeElement)) document.activeElement.blur();
        syncExpanded();
      });
      document.addEventListener('click', (event) => {
        if (odIsland.contains(event.target)) return;
        odIsland.classList.remove('is-open');
        if (odIsland.contains(document.activeElement)) document.activeElement.blur();
        syncExpanded();
      });
    }

    paintOverlay();
    setInterval(() => {
      if (!odPlaying) return;
      odPosition += 1;
      if (odPosition >= tracks[odTrack].duration) {
        odTrack = (odTrack + 1) % tracks.length;
        odPosition = 0;
      }
      paintOverlay();
    }, 1000);
  }

  // ---- device handoff preview ----
  const handoff = document.querySelector('[data-handoff]');
  if (handoff) {
    const devices = [...handoff.querySelectorAll('[data-device]')];
    const status = handoff.querySelector('[data-hd-status]');
    const names = { phone: 'iPhone', desktop: 'Desktop' };
    const paintHandoff = (device) => {
      handoff.dataset.playing = device;
      devices.forEach((button) => {
        const on = button.dataset.device === device;
        button.classList.toggle('is-on', on);
        button.setAttribute('aria-pressed', String(on));
        const label = button.querySelector('small');
        if (label) label.textContent = on ? 'Playing' : 'Ready';
      });
      if (status) status.textContent = `Playing on ${names[device]} · 1:42`;
    };
    devices.forEach((button) => button.addEventListener('click', () => paintHandoff(button.dataset.device)));
    paintHandoff('phone');
  }

  // ---- a soft lavender spotlight follows the pointer across the feature cards ----
  const bento = document.querySelector('.bento');
  if (bento && window.matchMedia('(hover: hover) and (pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let frame = 0;
    let last = null;
    bento.addEventListener('pointermove', (event) => {
      const tile = event.target.closest('.tile');
      if (!tile) return;
      last = { tile, x: event.clientX, y: event.clientY };
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!last) return;
        const rect = last.tile.getBoundingClientRect();
        last.tile.style.setProperty('--mx', `${last.x - rect.left}px`);
        last.tile.style.setProperty('--my', `${last.y - rect.top}px`);
      });
    }, { passive: true });
  }

  // ---- the bar at the top: where you are, and the menu on small screens ----
  const nav = $('nav');
  const toggle = $('nav-toggle');
  const setMenu = (open) => { nav.classList.toggle('open', open); toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('open')));
  document.querySelectorAll('#nav-links a').forEach((a) => a.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  const sections = [...document.querySelectorAll('#features, #download, #faq')];
  const navLinks = [...document.querySelectorAll('#nav-links a[data-sec]')];
  let ticking = false;
  function onScroll() {
    ticking = false;
    const line = window.innerHeight * 0.4;
    let current = null;
    sections.forEach((s) => { if (s.getBoundingClientRect().top <= line) current = s.id; });
    navLinks.forEach((a) => a.classList.toggle('on', a.dataset.sec === current));
  }
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  // ---- things rise into place as they scroll into view, once ----
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($(b.dataset.copy).textContent);
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy'; }, 1500);
    } catch (e) {}
  }));
})();
