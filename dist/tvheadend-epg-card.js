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

    this._now = Math.floor(Date.now() / 1000);

    this._timer = setInterval(() => {
      this._now = Math.floor(Date.now() / 1000);
      this._render(true);
    }, 60000); // 1 perces frissítés a pontosabb vonalért
  }

  setConfig(config) {
    this.config = config || {};
  }

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
    } catch (e) { console.error("Entry error", e); }
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

  _showTooltip(e, content) {
    const tooltip = this.shadowRoot.getElementById('custom-tooltip');
    tooltip.innerHTML = content.replace(/\n/g, '<br>');
    tooltip.style.display = 'block';
    
    // Pozicionálás az egér/érintés közelébe, de a kártyán belül tartva
    const rect = this.getBoundingClientRect();
    const x = (e.clientX || e.touches[0].clientX) - rect.left;
    const y = (e.clientY || e.touches[0].clientY) - rect.top - 60;
    
    tooltip.style.left = `${Math.max(10, Math.min(x, rect.width - 150))}px`;
    tooltip.style.top = `${Math.max(10, y)}px`;

    // Automatikus elrejtés mobilon
    clearTimeout(this._tooltipTimeout);
    this._tooltipTimeout = setTimeout(() => {
      tooltip.style.display = 'none';
    }, 4000);
  }

  _render(force = false) {
    if (!this.shadowRoot || (!force && Date.now() - this._lastRenderTime < 60000)) return;
    this._lastRenderTime = Date.now();

    const byChannel = {};
    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const e of this._epg) {
      const start = Number(e.start);
      const stop = Number(e.stop);
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
        ha-card {
          display: block;
          background: var(--ha-card-background, var(--card-background-color, white));
          color: var(--primary-text-color);
          overflow: hidden;
          position: relative;
          z-index: 1;
        }

        /* EGYEDI TOOLTIP STÍLUS */
        #custom-tooltip {
          position: absolute;
          display: none;
          background: var(--paper-dialog-background-color, #333);
          color: white;
          padding: 8px 12px;
          border-radius: 4px;
          font-size: 12px;
          z-index: 200;
          pointer-events: none;
          box-shadow: 0 2px 10px rgba(0,0,0,0.5);
          max-width: 250px;
          border: 1px solid var(--divider-color);
        }

        .outer-wrapper {
          overflow: auto;
          max-height: 750px;
          position: relative;
          scroll-snap-type: x proximity;
        }

        .epg-grid {
          display: grid;
          grid-template-columns: ${this.CHANNEL_COL_WIDTH}px 1fr;
          position: relative;
          width: max-content;
          --now-x: ${nowPos}px;
        }

        .corner-spacer {
          position: sticky; top: 0; left: 0; z-index: 10;
          background: var(--secondary-background-color);
          border-bottom: 2px solid var(--divider-color);
          border-right: 2px solid var(--divider-color);
          height: 45px; display: flex; align-items: center; padding-left: 10px;
          font-weight: bold; font-size: 12px;
        }

        .time-header {
          position: sticky; top: 0; z-index: 8;
          background: var(--secondary-background-color);
          height: 45px; border-bottom: 2px solid var(--divider-color);
        }

        .channel-col {
          position: sticky; left: 0; z-index: 7;
          background: var(--ha-card-background, var(--card-background-color, white));
          border-right: 2px solid var(--divider-color);
        }

        .now-marker {
          position: absolute; bottom: 0; width: 0; height: 0;
          left: var(--now-x);
          border-left: 7px solid transparent;
          border-right: 7px solid transparent;
          border-top: 10px solid var(--error-color, #ff4444);
          transform: translateX(-50%);
          z-index: 9;
        }

        .now-line {
          position: absolute; top: 0; bottom: 0; 
          left: var(--now-x);
          width: 2px;
          background: var(--error-color, #ff4444); 
          z-index: 5;
          pointer-events: none;
          transform: translateX(-50%);
          scroll-snap-align: center;
        }

        .program-grid { position: relative; width: ${gridWidth}px; z-index: 1; }

        .event {
          position: absolute; top: 8px; height: ${this.ROW_HEIGHT - 16}px;
          padding: 8px; border-radius: 4px; font-size: 11px; overflow: hidden;
          background: var(--primary-color); color: var(--text-primary-color, white);
          border-left: 3px solid rgba(0,0,0,0.1);
          z-index: 2;
        }
        .event.current { background: var(--accent-color); color: var(--text-accent-color, white); font-weight: 500; }
        .event-title { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .channel-cell {
          height: ${this.ROW_HEIGHT}px; display: flex; flex-direction: column; justify-content: center;
          padding: 0 10px; border-bottom: 1px solid var(--divider-color); font-size: 13px;
        }
        .row { height: ${this.ROW_HEIGHT}px; border-bottom: 1px solid var(--divider-color); position: relative; }
        .time-label {
          position: absolute; border-left: 1px solid var(--divider-color);
          height: 45px; padding-left: 5px; font-size: 11px; line-height: 45px;
          color: var(--secondary-text-color);
        }
      </style>
    `;

    const timeLabels = [];
    for (let t = Math.floor(minStart / 3600) * 3600; t < maxEnd; t += 3600) {
      const left = ((t - minStart) / 60) * this.PX_PER_MIN;
      if (left >= 0) {
        timeLabels.push(`<div class="time-label" style="left:${left}px">${new Date(t * 1000).getHours()}:00</div>`);
      }
    }

    this.shadowRoot.innerHTML = `
      ${style}
      <ha-card>
        <div id="custom-tooltip"></div>
        <div class="outer-wrapper">
          <div class="epg-grid">
            <div class="corner-spacer">Csatorna</div>
            <div class="time-header">
              <div class="now-marker"></div>
              ${timeLabels.join("")}
            </div>
            <div class="channel-col">
              ${channels.map(c => `<div class="channel-cell"><strong>${c.number}</strong><span>${c.name}</span></div>`).join("")}
            </div>
            <div class="program-grid">
              <div class="now-line"></div>
              ${channels.map(c => {
                const events = c.events.map(e => {
                  const start = Number(e.start);
                  const stop = Number(e.stop);
                  const left = ((start - minStart) / 60) * this.PX_PER_MIN;
                  const width = ((stop - start) / 60) * this.PX_PER_MIN - this.CARD_GAP;
                  const isCurrent = start <= this._now && this._now < stop;
                  const timeStr = new Date(start * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                  const stopStr = new Date(stop * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                  const tooltipContent = `${e.title}\n${timeStr} - ${stopStr}\n${Math.round((stop-start)/60)} perc`;

                  return `<div class="event ${isCurrent ? 'current' : ''}" 
                               style="left:${left}px; width:${Math.max(width, 10)}px;"
                               data-tooltip="${tooltipContent}">
                    <div class="event-title">${e.title}</div>
                    <div style="font-size:0.9em; opacity:0.8;">${timeStr}</div>
                  </div>`;
                }).join("");
                return `<div class="row">${events}</div>`;
              }).join("")}
            </div>
          </div>
        </div>
      </ha-card>
    `;

    // Tooltip eseménykezelők hozzáadása (mobil és asztali barát)
    this.shadowRoot.querySelectorAll('.event').forEach(el => {
      const content = el.getAttribute('data-tooltip');
      el.addEventListener('mouseenter', (ev) => this._showTooltip(ev, content));
      el.addEventListener('touchstart', (ev) => this._showTooltip(ev, content));
      el.addEventListener('mouseleave', () => {
        this.shadowRoot.getElementById('custom-tooltip').style.display = 'none';
      });
    });

    // POZICIONÁLÁS: Now line az 1/5-nél (20%)
    requestAnimationFrame(() => {
      const wrapper = this.shadowRoot.querySelector(".outer-wrapper");
      if (wrapper) {
        const scrollTarget = nowPos - (wrapper.clientWidth * 0.2);
        wrapper.scrollLeft = Math.max(0, scrollTarget);
      }
    });
  }

  disconnectedCallback() { clearInterval(this._timer); }
}
customElements.define("tvheadend-epg-card", TvheadendEpgCard);
