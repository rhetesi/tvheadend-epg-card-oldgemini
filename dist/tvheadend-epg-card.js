class TvheadendEpgCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._epg = [];
    this._entryId = null;
    this._loading = false;
    this._lastRenderTime = 0;

    this.PX_PER_MIN = 6;
    this.CHANNEL_COL_WIDTH = 130;
    this.ROW_HEIGHT = 80;
    this.CARD_GAP = 2; // Kisebb rés a pontosabb illeszkedésért

    this._now = Math.floor(Date.now() / 1000);

    this._timer = setInterval(() => {
      this._now = Math.floor(Date.now() / 1000);
      this._render(true);
    }, 120000);
  }

  setConfig(config) {
    this.config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._entryId && hass) this._resolveEntryId();

    const now = Date.now();
    if (now - this._lastRenderTime >= 120000) {
      this._render();
    }
  }

  async _resolveEntryId() {
    try {
      const entries = await this._hass.connection.sendMessagePromise({
        type: "config_entries/get", domain: "tvheadend_epg",
      });
      if (!entries?.length) throw new Error();
      this._entryId = entries[0].entry_id;
      await this._fetchEpg();
    } catch {
      this._error = "Integráció nem található";
      this._render(true);
    }
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

  _render(force = false) {
    if (!this.shadowRoot || (!force && Date.now() - this._lastRenderTime < 120000)) return;
    this._lastRenderTime = Date.now();

    const byChannel = {};
    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const e of this._epg) {
      const start = Number(e.start);
      const stop = Number(e.stop);
      if (start < minStart) minStart = start;
      if (stop > maxEnd) maxEnd = stop;

      byChannel[e.channelUuid] ??= {
        number: e.channelNumber, name: e.channelName, events: [],
      };
      byChannel[e.channelUuid].events.push(e);
    }

    const channels = Object.values(byChannel).sort((a, b) => a.number - b.number);
    if (channels.length === 0) return;

    const gridWidth = ((maxEnd - minStart) / 60) * this.PX_PER_MIN;
    const nowLeft = ((this._now - minStart) / 60) * this.PX_PER_MIN;

    const style = `
      <style>
        * { box-sizing: border-box; }
        ha-card {
          display: block;
          background: var(--ha-card-background, var(--card-background-color, white));
          color: var(--primary-text-color);
          overflow: hidden;
        }

        .outer-wrapper {
          overflow: auto;
          max-height: 750px;
          position: relative;
        }

        .epg-grid {
          display: grid;
          grid-template-columns: ${this.CHANNEL_COL_WIDTH}px 1fr;
          position: relative;
          width: max-content;
        }

        /* Rétegződés beállítása */
        .corner-spacer {
          position: sticky; top: 0; left: 0; z-index: 100;
          background: var(--secondary-background-color);
          border-bottom: 2px solid var(--divider-color);
          border-right: 2px solid var(--divider-color);
          height: 45px; display: flex; align-items: center; padding-left: 10px;
          font-weight: bold; font-size: 12px;
        }

        .time-header {
          position: sticky; top: 0; z-index: 90;
          background: var(--secondary-background-color);
          height: 45px; border-bottom: 2px solid var(--divider-color);
          width: ${gridWidth}px;
        }

        .channel-col {
          position: sticky; left: 0; z-index: 80;
          background: var(--ha-card-background, var(--card-background-color, white));
          border-right: 2px solid var(--divider-color);
        }

        .channel-cell {
          height: ${this.ROW_HEIGHT}px; display: flex; flex-direction: column; justify-content: center;
          padding: 0 10px; border-bottom: 1px solid var(--divider-color); font-size: 13px;
        }

        .program-grid { 
          position: relative; 
          width: ${gridWidth}px; 
          z-index: 10;
        }

        .row { height: ${this.ROW_HEIGHT}px; border-bottom: 1px solid var(--divider-color); position: relative; }

        .event {
          position: absolute; top: 6px; height: ${this.ROW_HEIGHT - 12}px;
          padding: 6px; border-radius: 4px; font-size: 11px; overflow: hidden;
          background: var(--primary-color); color: var(--text-primary-color, white);
          border-left: 3px solid rgba(0,0,0,0.1);
          z-index: 20;
        }

        .event.current {
          background: var(--accent-color);
          color: var(--text-accent-color, white);
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2);
        }

        /* Now Line és Marker */
        .now-marker {
          position: absolute; bottom: 0; width: 0; height: 0;
          border-left: 6px solid transparent; border-right: 6px solid transparent;
          border-top: 10px solid var(--error-color, #ff4444);
          transform: translateX(-50%); z-index: 95;
        }

        .now-line {
          position: absolute; top: 0; bottom: 0; width: 2px;
          background: var(--error-color, #ff4444); z-index: 70;
          pointer-events: none;
        }

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

    const rows = channels.map(c => {
      const events = c.events.map(e => {
        const start = Number(e.start);
        const stop = Number(e.stop);
        const left = ((start - minStart) / 60) * this.PX_PER_MIN;
        const width = ((stop - start) / 60) * this.PX_PER_MIN - this.CARD_GAP;
        const isCurrent = start <= this._now && this._now < stop;

        return `<div class="event ${isCurrent ? 'current' : ''}" style="left:${left}px; width:${Math.max(width, 5)}px;">
          <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${e.title}</div>
          <div style="font-size:0.9em; opacity:0.8;">${new Date(start * 1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
        </div>`;
      }).join("");
      return `<div class="row">${events}</div>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      ${style}
      <ha-card>
        <div class="outer-wrapper">
          <div class="epg-grid">
            <div class="corner-spacer">Csatorna</div>
            <div class="time-header">
              <div class="now-marker" style="left:${nowLeft}px"></div>
              ${timeLabels.join("")}
            </div>
            <div class="channel-col">
              ${channels.map(c => `<div class="channel-cell"><strong>${c.number}</strong><span>${c.name}</span></div>`).join("")}
            </div>
            <div class="program-grid">
              <div class="now-line" style="left:${nowLeft}px"></div>
              ${rows}
            </div>
          </div>
        </div>
      </ha-card>
    `;

    requestAnimationFrame(() => {
      const wrapper = this.shadowRoot.querySelector(".outer-wrapper");
      if (wrapper) {
        const offset = wrapper.clientWidth * 0.02;
        wrapper.scrollLeft = nowLeft - offset;
      }
    });
  }

  disconnectedCallback() { clearInterval(this._timer); }
  getCardSize() { return 10; }
}
customElements.define("tvheadend-epg-card", TvheadendEpgCard);
