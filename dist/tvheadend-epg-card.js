class TvheadendEpgCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._epg = [];
    this._entryId = null;
    this._loading = false;
    this._error = null;

    // Megjelenítési alapértékek
    this.PX_PER_MIN = 6;
    this.CHANNEL_COL_WIDTH = 150;
    this.ROW_HEIGHT = 80;
    this.CARD_GAP = 4;

    this._now = Math.floor(Date.now() / 1000);
    this._initialScrolled = false;

    setInterval(() => {
      this._now = Math.floor(Date.now() / 1000);
      this._render();
    }, 60000);
  }

  setConfig(config) {
    this.config = config || {};
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._entryId && hass) this._resolveEntryId();
    this._render();
  }

  async _resolveEntryId() {
    try {
      const entries = await this._hass.connection.sendMessagePromise({
        type: "config_entries/get",
        domain: "tvheadend_epg",
      });
      if (!entries?.length) throw new Error();
      this._entryId = entries[0].entry_id;
      await this._fetchEpg();
    } catch {
      this._error = "TVHeadend EPG integráció nem található";
      this._render();
    }
  }

  async _fetchEpg() {
    if (!this._hass || !this._entryId) return;
    this._loading = true;
    this._render();

    try {
      const result = await this._hass.connection.sendMessagePromise({
        type: "tvheadend_epg/fetch",
        entry_id: this._entryId,
      });
      this._epg = Array.isArray(result.epg) ? result.epg : [];
    } catch {
      this._error = "EPG betöltési hiba";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _render() {
    if (!this.shadowRoot) return;

    // Adatok előkészítése
    const byChannel = {};
    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const e of this._epg) {
      const start = Number(e.start);
      const stop = Number(e.stop);
      if (start < minStart) minStart = start;
      if (stop > maxEnd) maxEnd = stop;

      byChannel[e.channelUuid] ??= {
        number: e.channelNumber,
        name: e.channelName,
        events: [],
      };
      byChannel[e.channelUuid].events.push(e);
    }

    const channels = Object.values(byChannel).sort((a, b) => a.number - b.number);
    if (channels.length === 0 || minStart === Infinity) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;">${this._loading ? "Betöltés..." : "Nincs EPG adat"}</div></ha-card>`;
      return;
    }

    const gridWidth = ((maxEnd - minStart) / 60) * this.PX_PER_MIN;
    const nowLeft = ((this._now - minStart) / 60) * this.PX_PER_MIN;

    const style = `
      <style>
        ha-card {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--ha-card-background, var(--card-background-color, white));
          color: var(--primary-text-color);
          overflow: hidden;
          --divider: var(--divider-color, #e0e0e0);
        }

        /* 2. pont: Sticky fejléc és fix title */
        .sticky-header {
          position: sticky;
          top: 0;
          z-index: 100;
          background: var(--ha-card-background, var(--card-background-color, white));
        }

        .header-title {
          padding: 12px 16px;
          font-size: 18px;
          font-weight: 600;
          border-bottom: 1px solid var(--divider);
        }

        .time-ruler {
          display: flex;
          margin-left: ${this.CHANNEL_COL_WIDTH}px;
          height: 30px;
          border-bottom: 1px solid var(--divider);
          background: var(--secondary-background-color);
          position: relative;
          overflow: hidden;
        }

        .container {
          flex: 1;
          display: flex;
          overflow: auto; /* Itt görgetünk mindent */
          position: relative;
        }

        /* 2. pont: Csatorna lista fixálása balra */
        .channels {
          position: sticky;
          left: 0;
          z-index: 20;
          background: var(--ha-card-background, var(--card-background-color, white));
          min-width: ${this.CHANNEL_COL_WIDTH}px;
          border-right: 2px solid var(--divider);
        }

        .channel {
          height: ${this.ROW_HEIGHT}px;
          display: flex;
          align-items: center;
          padding: 0 12px;
          border-bottom: 1px solid var(--divider);
          box-sizing: border-box;
          font-size: 13px;
        }

        .grid {
          position: relative;
          flex: 1;
        }

        .row {
          position: relative;
          height: ${this.ROW_HEIGHT}px;
          border-bottom: 1px solid var(--divider);
          width: ${gridWidth}px;
        }

        .event {
          position: absolute;
          top: 8px;
          height: ${this.ROW_HEIGHT - 16}px;
          padding: 8px;
          border-radius: 4px;
          font-size: 11px;
          overflow: hidden;
          box-sizing: border-box;
          background: var(--primary-color);
          color: var(--text-primary-color, white);
          border-left: 3px solid rgba(0,0,0,0.2);
          display: flex;
          flex-direction: column;
        }

        .event-title { font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .event-time { font-size: 0.9em; opacity: 0.9; margin-top: 2px; }

        /* Most vonal */
        .now-line {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: var(--error-color, #ff4444);
          z-index: 50;
          pointer-events: none;
        }
      </style>
    `;

    // Idősáv generálása (óránként)
    const timeCells = [];
    for (let t = minStart; t < maxEnd; t += 3600) {
      const left = ((t - minStart) / 60) * this.PX_PER_MIN;
      timeCells.push(`<div style="position:absolute; left:${left}px; font-size:10px; padding: 6px; color: var(--secondary-text-color); border-left: 1px solid var(--divider); height: 100%;">${new Date(t * 1000).getHours()}:00</div>`);
    }

    const rows = channels.map(c => {
      const events = c.events.map(e => {
        const start = Number(e.start);
        const stop = Number(e.stop);
        const left = ((start - minStart) / 60) * this.PX_PER_MIN;
        const width = ((stop - start) / 60) * this.PX_PER_MIN - this.CARD_GAP;

        return `
          <div class="event" style="left:${left}px; width:${Math.max(width, 5)}px;">
            <div class="event-title">${e.title}</div>
            <div class="event-time">${new Date(start * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
          </div>
        `;
      }).join("");
      return `<div class="row">${events}</div>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      ${style}
      <ha-card>
        <div class="sticky-header">
          <div class="header-title">TVHeadend EPG</div>
          <div class="time-ruler">
            <div style="position:relative; width:${gridWidth}px; height:100%;">
              ${timeCells.join("")}
            </div>
          </div>
        </div>
        <div class="container">
          <div class="channels">
            ${channels.map(c => `<div class="channel"><strong>${c.number}</strong>&nbsp;${c.name}</div>`).join("")}
          </div>
          <div class="grid" style="width:${gridWidth}px">
            <div class="now-line" style="left:${nowLeft}px"></div>
            ${rows}
          </div>
        </div>
      </ha-card>
    `;

    // 3. pont: Automatikus igazítás a Now Line-hoz + 1-2% eltolás
    if (!this._initialScrolled) {
      requestAnimationFrame(() => {
        const container = this.shadowRoot.querySelector(".container");
        if (container) {
          // A látható szélesség 2%-a mint extra margó
          const offset = container.clientWidth * 0.02; 
          container.scrollLeft = nowLeft - offset;
          this._initialScrolled = true;
        }
      });
    }
  }

  getCardSize() { return 8; }
}

customElements.define("tvheadend-epg-card", TvheadendEpgCard);
