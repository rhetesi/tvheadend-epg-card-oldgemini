class TvheadendEpgCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._hass = null;
    this._epg = [];
    this._entryId = null;
    this._loading = false;
    this._error = null;

    // Megjelenítési beállítások
    this.PX_PER_MIN = 6;            // Szélesebb kártyák a jobb olvashatóságért
    this.CHANNEL_COL_WIDTH = 150;
    this.ROW_HEIGHT = 90;           // Kicsit magasabb sorok a leírásnak
    this.CARD_GAP = 4;              // FIX rés a kártyák között (pixelben)

    // Időablak (A backendtől kapott összes adatot megjelenítjük, nem csak egy szeletet)
    this._now = Math.floor(Date.now() / 1000);
    
    // Frissítés percenként a "MOST" vonal miatt
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

  connectedCallback() {
    if (this._entryId) this._fetchEpg();
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
      // A beküldött kódod alapján a válasz formátuma: result.epg
      this._epg = Array.isArray(result.epg) ? result.epg : [];
    } catch {
      this._error = "EPG betöltési hiba";
    } finally {
      this._loading = false;
      this._render();
    }
  }

  // Segédfüggvény a színekhez a képen látható stílus érdekében
  _getCategoryColor(title) {
    const t = title.toLowerCase();
    if (t.includes("híradó") || t.includes("hírek")) return "#44739e";
    if (t.includes("film") || t.includes("mozi")) return "#723232";
    if (t.includes("sport") || t.includes("foci")) return "#2e7d32";
    return "#3d3d3d"; // Alapértelmezett sötétszürke
  }

  _render() {
    if (!this.shadowRoot) return;

    // Adatok csoportosítása csatornák szerint
    const byChannel = {};
    let minStart = Infinity;
    let maxEnd = -Infinity;

    for (const e of this._epg) {
      const start = Number(e.start);
      const stop = Number(e.stop);
      
      if (start < minStart) minStart = start;
      if (stop > maxEnd) maxEnd = stop;

      byChannel[e.channelUuid] ??= {
        number: Number(e.channelNumber),
        name: e.channelName,
        events: [],
      };
      byChannel[e.channelUuid].events.push(e);
    }

    const channels = Object.values(byChannel).sort((a, b) => a.number - b.number);

    // Ha nincs adat, ne számoljunk tovább
    if (channels.length === 0 || minStart === Infinity) {
      this.shadowRoot.innerHTML = `<ha-card><div style="padding:16px;">${this._loading ? "Betöltés..." : "Nincs EPG adat"}</div></ha-card>`;
      return;
    }

    // Teljes skála kiszámítása (ez biztosítja, hogy ne csússzanak el a kártyák)
    const totalMinutes = (maxEnd - minStart) / 60;
    const gridWidth = totalMinutes * this.PX_PER_MIN;
    const nowLeft = ((this._now - minStart) / 60) * this.PX_PER_MIN;

    const style = `
      <style>
        ha-card { height: 100%; display: flex; flex-direction: column; background: #1a1a1a; color: white; overflow: hidden; }
        .header { padding: 12px 16px; font-size: 18px; font-weight: 600; border-bottom: 1px solid #333; }
        .container { flex: 1; display: flex; overflow: auto; position: relative; }
        
        .channels { position: sticky; left: 0; z-index: 10; background: #222; min-width: ${this.CHANNEL_COL_WIDTH}px; border-right: 2px solid #333; }
        .channel { height: ${this.ROW_HEIGHT}px; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #333; font-size: 14px; }
        
        .grid { position: relative; flex: 1; background: #111; }
        .row { position: relative; height: ${this.ROW_HEIGHT}px; border-bottom: 1px solid #333; width: ${gridWidth}px; }
        
        .event {
          position: absolute;
          top: 6px;
          height: ${this.ROW_HEIGHT - 12}px;
          padding: 8px;
          border-radius: 4px;
          font-size: 12px;
          overflow: hidden;
          box-sizing: border-box;
          border-left: 4px solid rgba(255,255,255,0.3);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .event-title { font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .event-time { font-size: 10px; opacity: 0.8; }
        
        .now-line {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: #ff4444;
          z-index: 5;
          pointer-events: none;
          box-shadow: 0 0 8px #ff4444;
        }
        .now-line::before {
          content: ""; position: absolute; top: 0; left: -4px;
          border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid #ff4444;
        }
      </style>
    `;

    const rows = channels.map(c => {
      const events = c.events.map(e => {
        const start = Number(e.start);
        const stop = Number(e.stop);
        
        const left = ((start - minStart) / 60) * this.PX_PER_MIN;
        const width = ((stop - start) / 60) * this.PX_PER_MIN - this.CARD_GAP; // Kivonjuk a fix rést

        const startTimeStr = new Date(start * 1000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        return `
          <div class="event" style="left:${left}px; width:${Math.max(width, 10)}px; background:${this._getCategoryColor(e.title)};">
            <div class="event-title">${e.title}</div>
            <div class="event-time">${startTimeStr} (${Math.round((stop-start)/60)} p)</div>
          </div>
        `;
      }).join("");

      return `<div class="row">${events}</div>`;
    }).join("");

    this.shadowRoot.innerHTML = `
      ${style}
      <ha-card>
        <div class="header">TVHeadend EPG</div>
        <div class="container">
          <div class="channels">
            ${channels.map(c => `<div class="channel"><strong>${c.number}</strong> &nbsp; ${c.name}</div>`).join("")}
          </div>
          <div class="grid" style="width:${gridWidth}px">
            <div class="now-line" style="left:${nowLeft}px"></div>
            ${rows}
          </div>
        </div>
      </ha-card>
    `;

    // Automatikus görgetés az aktuális időhöz
    if (!this._initialScrolled) {
      requestAnimationFrame(() => {
        const container = this.shadowRoot.querySelector(".container");
        if (container) {
          container.scrollLeft = nowLeft - 100;
          this._initialScrolled = true;
        }
      });
    }
  }

  getCardSize() { return 8; }
}

customElements.define("tvheadend-epg-card", TvheadendEpgCard);
