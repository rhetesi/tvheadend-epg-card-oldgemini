class TvheadendEpgCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._epg = [];
    this._entryId = null;
    this._loading = false;
    this._lastRenderTime = 0;

    this.PX_PER_MIN = 15; 
    this.CHANNEL_COL_WIDTH = 130;
    this.ROW_HEIGHT = 80;
    this.CARD_GAP = 2;

    // Színskála a beküldött kép és a numerikus kódok (DVB genre codes) alapján
    this.GENRE_MAP = {
      // Film / Dráma (Kód: 16-31)
      'movie': { color: '#a6611a', codes: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
      'drama': { color: '#a6611a', codes: [] },
      // Hírek (Kód: 32-47)
      'news': { color: '#5e8e65', codes: [32, 33, 34, 35] },
      'current': { color: '#5e8e65', codes: [] },
      // Show / Játék (Kód: 48-63)
      'show': { color: '#b2b21a', codes: [48, 49, 50, 51, 52] },
      // Sport (Kód: 64-79)
      'sport': { color: '#d62728', codes: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75] },
      // Gyerek / Ifjúsági (Kód: 80-95)
      'children': { color: '#17a2b8', codes: [80, 81, 82, 83, 84, 85] },
      // Zene / Balett (Kód: 96-111)
      'music': { color: '#44bd32', codes: [96, 97, 98, 99, 100, 101, 102] },
      // Művészet / Kultúra (Kód: 112-127)
      'culture': { color: '#0044cc', codes: [112, 113, 114, 115, 116, 117, 118, 119, 120] },
      // Társadalom / Politika (Kód: 128-143)
      'social': { color: '#95a5a6', codes: [128, 129, 130, 131, 132] },
      // Oktatás / Tudomány (Kód: 144-159)
      'science': { color: '#8e44ad', codes: [144, 145, 146, 147, 148] },
      // Szabadidő (Kód: 160-175)
      'leisure': { color: '#7f8fa6', codes: [160, 161, 162, 163] },
      // Egyéb / Speciális
      'special': { color: '#2980b9', codes: [] }
    };

    this._now = Math.floor(Date.now() / 1000);
    this._timer = setInterval(() => {
      this._now = Math.floor(Date.now() / 1000);
      this._render(true);
    }, 60000);
  }

  setConfig(config) { this.config = config || {}; }

  set hass(hass) {
    this._hass = hass;
    if (!this._entryId && hass) this._resolveEntryId();
    if (Date.now() - this._lastRenderTime >= 60000) this._render();
  }

  async _resolveEntryId() {
    try {
      const entries = await this._hass.connection.sendMessagePromise({
        type: "config_entries/get", domain: "tvheadend_epg",
      });
      if (entries?.length) {
        this._entryId = entries[0].entry_id;
        await this._fetchEpg();
      }
    } catch (e) { console.error("EPG hiba", e); }
  }

  async _fetchEpg() {
    if (!this._hass || !this._entryId) return;
    this._loading = true;
    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "tvheadend_epg/fetch", entry_id: this._entryId,
      });
      this._epg = Array.isArray(result.epg) ? result.epg : [];
    } finally {
      this._loading = false;
      this._render(true);
    }
  }

  _getGenreColor(genreData) {
    if (genreData === undefined || genreData === null) return 'var(--primary-color)';

    const genres = Array.isArray(genreData) ? genreData : [genreData];
    
    for (const g of genres) {
      const gNum = parseInt(g);
      // Szám alapú keresés (DVB kódok)
      if (!isNaN(gNum)) {
        for (const config of Object.values(this.GENRE_MAP)) {
          if (config.codes.includes(gNum)) return config.color;
        }
      }
      // Szöveg alapú keresés (ha mégis szöveg jönne)
      const gStr = String(g).toLowerCase();
      for (const [key, config] of Object.entries(this.GENRE_MAP)) {
        if (gStr.includes(key)) return config.color;
      }
    }
    return 'var(--primary-color)';
  }

  _showTooltip(e, content) {
    const tooltip = this.shadowRoot.getElementById('custom-tooltip');
    tooltip.innerHTML = content.replace(/\n/g, '<br>');
    tooltip.style.display = 'block';
    const rect = this.getBoundingClientRect();
    const clientX = e.touches ? (e.changedTouches ? e.changedTouches[0].clientX : e.touches[0].clientX) : e.clientX;
    const clientY = e.touches ? (e.changedTouches ? e.changedTouches[0].clientY : e.touches[0].clientY) : e.clientY;
    tooltip.style.left = `${Math.max(10, Math.min(clientX - rect.left, rect.width - 180))}px`;
    tooltip.style.top = `${Math.max(10, clientY - rect.top - 60)}px`;
    clearTimeout(this._tooltipTimeout);
    this._tooltipTimeout = setTimeout(() => { tooltip.style.display = 'none'; }, 4000);
  }

  _showDetails(eventData) {
    const modal = this.shadowRoot.getElementById('details-modal');
    const start = new Date(Number(eventData.start) * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    const stop = new Date(Number(eventData.stop) * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    modal.querySelector('.modal-title').innerText = eventData.title;
    modal.querySelector('.modal-time').innerText = `${start} - ${stop} (${Math.round((eventData.stop-eventData.start)/60)} perc)`;
    modal.querySelector('.modal-desc').innerText = eventData.description || "Nincs leírás.";
    modal.style.display = 'flex';
  }

  _closeDetails() { this.shadowRoot.getElementById('details-modal').style.display = 'none'; }

  _render(force = false) {
    if (!this.shadowRoot || (!force && Date.now() - this._lastRenderTime < 60000)) return;
    this._lastRenderTime = Date.now();

    const byChannel = {};
    let minStart = Infinity, maxEnd = -Infinity;

    for (const e of this._epg) {
      const start = Number(e.start), stop = Number(e.stop);
      if (start < minStart) minStart = start;
      if (stop > maxEnd) maxEnd = stop;
      byChannel[e.channelUuid] ??= { number: e.channelNumber, name: e.channelName, events: [] };
      byChannel[e.channelUuid].events.push(e);
    }

    const channels = Object.values(byChannel).sort((a, b) => a.number - b.number);
    if (channels.length === 0) return;

    const gridWidth = ((maxEnd - minStart) / 60) * this.PX_PER_MIN;
    const nowPos = ((this._now - minStart) / 60) * this.PX_PER_MIN;

    const style = `
      <style>
        * { box-sizing: border-box; }
        ha-card { display: block; background: var(--ha-card-background, var(--card-background-color, white)); color: var(--primary-text-color); overflow: hidden; position: relative; }
        .modal-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: none; justify-content: center; align-items: center; z-index: 300; backdrop-filter: blur(2px); }
        .modal-content { background: var(--ha-card-background, var(--card-background-color, #1c1c1c)); width: 85%; max-width: 500px; padding: 20px; border-radius: 12px; position: relative; box-shadow: 0 5px 20px rgba(0,0,0,0.5); border: 1px solid var(--divider-color); }
        .modal-close { position: absolute; top: 10px; right: 15px; font-size: 28px; cursor: pointer; color: var(--secondary-text-color); line-height: 1; }
        .modal-title { font-size: 1.4em; font-weight: bold; margin-bottom: 5px; padding-right: 25px; }
        .modal-time { color: var(--accent-color); font-weight: 500; margin-bottom: 15px; font-size: 0.9em; }
        .modal-desc { font-size: 1em; line-height: 1.5; max-height: 300px; overflow-y: auto; }
        #custom-tooltip { position: absolute; display: none; background: #333; color: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; z-index: 200; pointer-events: none; max-width: 250px; }
        .outer-wrapper { overflow: auto; max-height: 750px; position: relative; }
        .epg-grid { display: grid; grid-template-columns: ${this.CHANNEL_COL_WIDTH}px 1fr; position: relative; width: max-content; }
        .corner-spacer { position: sticky; top: 0; left: 0; z-index: 10; background: var(--secondary-background-color); border-bottom: 2px solid var(--divider-color); border-right: 2px solid var(--divider-color); height: 45px; display: flex; align-items: center; padding-left: 10px; font-weight: bold; font-size: 12px; }
        .time-header { position: sticky; top: 0; z-index: 8; background: var(--secondary-background-color); height: 45px; border-bottom: 2px solid var(--divider-color); }
        .channel-col { position: sticky; left: 0; z-index: 7; background: var(--ha-card-background, var(--card-background-color, white)); border-right: 2px solid var(--divider-color); }
        .now-marker { position: absolute; bottom: 0; width: 0; height: 0; left: ${nowPos}px; border-left: 7px solid transparent; border-right: 7px solid transparent; border-top: 10px solid var(--error-color, #ff4444); transform: translateX(-50%); z-index: 9; }
        .now-line { position: absolute; top: 0; bottom: 0; left: ${nowPos}px; width: 2px; background: var(--error-color, #ff4444); z-index: 5; pointer-events: none; transform: translateX(-50%); }
        .program-grid { position: relative; width: ${gridWidth}px; }
        .event { position: absolute; top: 8px; height: ${this.ROW_HEIGHT - 16}px; padding: 8px; border-radius: 4px; font-size: 11px; overflow: hidden; color: white; border-left: 3px solid rgba(0,0,0,0.2); cursor: pointer; }
        .event.current { border: 2px solid white; font-weight: bold; }
        .event-title { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 1px 1px 2px rgba(0,0,0,0.5); }
        .channel-cell { height: ${this.ROW_HEIGHT}px; display: flex; flex-direction: column; justify-content: center; padding: 0 10px; border-bottom: 1px solid var(--divider-color); font-size: 13px; }
        .row { height: ${this.ROW_HEIGHT}px; border-bottom: 1px solid var(--divider-color); position: relative; }
        .time-label { position: absolute; border-left: 1px solid var(--divider-color); height: 45px; padding-left: 5px; font-size: 11px; line-height: 45px; color: var(--secondary-text-color); }
      </style>
    `;

    const timeLabels = [];
    for (let t = Math.floor(minStart / 3600) * 3600; t < maxEnd; t += 3600) {
      const left = ((t - minStart) / 60) * this.PX_PER_MIN;
      if (left >= 0) timeLabels.push(`<div class="time-label" style="left:${left}px">${new Date(t * 1000).getHours()}:00</div>`);
    }

    this.shadowRoot.innerHTML = `${style}<ha-card><div id="custom-tooltip"></div><div id="details-modal" class="modal-overlay"><div class="modal-content"><span class="modal-close">&times;</span><div class="modal-title"></div><div class="modal-time"></div><div class="modal-desc"></div></div></div><div class="outer-wrapper"><div class="epg-grid"><div class="corner-spacer">Csatorna</div><div class="time-header"><div class="now-marker"></div>${timeLabels.join("")}</div><div class="channel-col">${channels.map(c => `<div class="channel-cell"><strong>${c.number}</strong><span>${c.name}</span></div>`).join("")}</div><div class="program-grid"><div class="now-line"></div>${channels.map(c => `<div class="row">${c.events.map((e, idx) => {
      const left = ((e.start - minStart) / 60) * this.PX_PER_MIN;
      const width = ((e.stop - e.start) / 60) * this.PX_PER_MIN - this.CARD_GAP;
      const bgColor = this._getGenreColor(e.genre);
      return `<div class="event ${e.start <= this._now && this._now < e.stop ? 'current' : ''}" style="left:${left}px; width:${Math.max(width, 10)}px; background-color: ${bgColor};" data-index="${idx}" data-channel="${c.number}"><div class="event-title">${e.title}</div><div style="font-size:0.9em; opacity:0.9;">${new Date(e.start * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div></div>`;
    }).join("")}</div>`).join("")}</div></div></div></ha-card>`;

    this.shadowRoot.querySelectorAll('.event').forEach(el => {
      const eventData = channels.find(c => c.number == el.dataset.channel).events[el.dataset.index];
      let touchTimer, isLongPress = false;

      el.addEventListener('mouseenter', (ev) => {
        if (ev.sourceCapabilities && !ev.sourceCapabilities.firesTouchEvents) {
          this._showTooltip(ev, `${eventData.title}\n${new Date(eventData.start * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`);
        }
      });
      el.addEventListener('mouseleave', () => { this.shadowRoot.getElementById('custom-tooltip').style.display = 'none'; });
      el.addEventListener('click', (ev) => { if (ev.detail !== 0) this._showDetails(eventData); });

      el.addEventListener('touchstart', (ev) => {
        isLongPress = false;
        touchTimer = setTimeout(() => { isLongPress = true; this._showDetails(eventData); if (navigator.vibrate) navigator.vibrate(50); }, 1000);
      }, { passive: true });

      el.addEventListener('touchend', (ev) => {
        clearTimeout(touchTimer);
        if (!isLongPress) this._showTooltip(ev, `${eventData.title}\n${new Date(eventData.start * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}`);
        if (isLongPress) ev.preventDefault();
      }, { passive: false });

      el.addEventListener('touchmove', () => clearTimeout(touchTimer), { passive: true });
    });

    this.shadowRoot.querySelector('.modal-close').addEventListener('click', () => this._closeDetails());
    this.shadowRoot.getElementById('details-modal').addEventListener('click', (e) => { if (e.target.id === 'details-modal') this._closeDetails(); });

    requestAnimationFrame(() => {
      const wrapper = this.shadowRoot.querySelector(".outer-wrapper");
      if (wrapper) wrapper.scrollLeft = nowPos - (wrapper.clientWidth * 0.2);
    });
  }
}
customElements.define("tvheadend-epg-card", TvheadendEpgCard);
