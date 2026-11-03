(function () {
  "use strict";

  // ---------- Configuration ----------
  const CH = {
    VISIT: "Teacher visit",
    EVENT: "Event",
    ADS: "Social media ad",
    MEDIA: "Media (reels/YouTube)",
  };
  const AREA = "Area only";
  const NONE = "Unattributed";
  const HOME_STATE = "Karnataka";
  const STAGES = ["Enquired", "Applied", "Admitted", "Fee paid", "Enrolled"];
  const DAY = 86400000;
  const SEASON_START_MONTH = 5; // June (0-based): an admission season runs June to May
  const LAG = [
    [0, 30, "0–30 days"],
    [31, 60, "31–60 days"],
    [61, 90, "61–90 days"],
    [91, 180, "91–180 days"],
    [181, Infinity, "More than 180 days"],
  ];
  // Words ignored when grouping school names ("St. Mary's HS" and "St Marys High School" match)
  const DROP = new Set(["the", "school", "high", "hs", "sch", "college", "pu", "junior", "jr"]);
  const CAMPAIGN_REQ = ["channel", "date", "city", "cost_inr"];
  const STUDENT_REQ = ["city", "enquiry_date", "status"];
  const PERSONAL_COLS = ["name", "phone", "email", "mobile", "address"];
  const CAMPAIGN_COLS = ["channel", "subtype", "date", "school", "city", "district", "state", "cost_inr", "faculty"];
  const STUDENT_COLS = ["student_id", "city", "district", "state", "school", "course", "enquiry_date", "status"];
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_ROWS = 20000;
  const TOP = 15;
  const SERIES = ["#C9D3E3", "#7F9CC4", "#2F5F9E", "#0B2D5B"];
  const PIE = ["#0B2D5B", "#2F5F9E", "#6F8FB8", "#A9BCD6", "#C9A227", "#D9C67A"];

  const TABS = [
    ["overview", "Overview"],
    ["locations", "Locations"],
    ["yoy", "Season comparison"],
    ["faculty", "Faculty"],
    ["channels", "Channels & spend"],
    ["timing", "Visit timing"],
    ["students", "Students"],
    ["data", "Data & import"],
  ];

  // Spend groups: which channels' spend belongs to which attributed group
  const GROUPS = [
    { label: "Teacher visits", channels: [CH.VISIT], attr: CH.VISIT, note: "Matched to students by school name" },
    { label: "Events", channels: [CH.EVENT], attr: CH.EVENT, note: "Matched to students by school name" },
    { label: "Social media ads & media", channels: [CH.ADS, CH.MEDIA], attr: AREA, note: "Matched by city only, so treat as indicative" },
  ];

  // ---------- Synthetic demo data (fictional names and numbers, no real records) ----------
  const DEMO_PLACES = [
    { city: "Bengaluru", district: "Bengaluru Urban", state: "Karnataka" },
    { city: "Mysuru", district: "Mysuru", state: "Karnataka" },
    { city: "Mangaluru", district: "Dakshina Kannada", state: "Karnataka" },
    { city: "Hubballi", district: "Dharwad", state: "Karnataka" },
    { city: "Chennai", district: "Chennai", state: "Tamil Nadu" },
    { city: "Coimbatore", district: "Coimbatore", state: "Tamil Nadu" },
    { city: "Hyderabad", district: "Hyderabad", state: "Telangana" },
    { city: "Pune", district: "Pune", state: "Maharashtra" },
    { city: "Mumbai", district: "Mumbai Suburban", state: "Maharashtra" },
    { city: "Kochi", district: "Ernakulam", state: "Kerala" },
  ];
  const PLACE = {};
  DEMO_PLACES.forEach(p => { PLACE[p.city] = p; });

  const DEMO_SCHOOLS = [
    { names: ["St. Mary's HS", "St Marys High School"], city: "Bengaluru" },
    { names: ["Sacred Heart Public School", "Sacred Heart PS"], city: "Mysuru" },
    { names: ["Greenfield High School"], city: "Mangaluru" },
    { names: ["St. Joseph's HS", "St Josephs High School"], city: "Hubballi" },
    { names: ["Lakeview PU College"], city: "Chennai" },
    { names: ["Rosewood PU College"], city: "Hyderabad" },
    { names: ["Nirmala Convent School"], city: "Pune" },
    { names: ["Bluebell Public School", "Bluebell Public Sch"], city: "Kochi" },
    { names: ["Hillcrest Public School"], city: "Bengaluru" },
    { names: ["Vidya Niketan HS", "Vidya Niketan High School"], city: "Mysuru" },
    { names: ["Coimbatore Model School"], city: "Coimbatore" },
    { names: ["Harbour View PU College"], city: "Mumbai" },
  ];
  const COURSES = ["B.Sc", "B.Com", "BBA", "BCA", "B.A", "B.Tech", "MBA"];
  const FACULTY = ["Faculty A", "Faculty B", "Faculty C", "Faculty D", "Faculty E"];

  // ---------- State ----------
  const state = {
    campaigns: [],
    students: [],
    seasons: [],
    demo: null,
    isDemo: { campaigns: true, students: true },
    raw: new Map(),
    log: [],
    tab: "overview",
    drill: null,        // channel group shown in detail on the Channels tab
    facultySel: "",     // faculty member shown on the Faculty detail page
    compareSeasons: null, // null = all seasons; otherwise the chosen season labels
    compareMetric: "enq",
    filters: { season: null, channel: "", district: "", course: "", from: null, to: null },
  };

  // ---------- Small helpers ----------
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") node.className = v;
        else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.appendChild(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return node;
  }

  const inr = n => "₹" + Math.round(n || 0).toLocaleString("en-IN");
  const num = n => (n === null || n === undefined || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("en-IN"));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
  const fmtDays = v => (v === null || v === undefined ? "—" : Math.round(v) + " days");
  const fmtDate = d => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const total = arr => arr.reduce((a, c) => a + c.cost, 0);
  const sumBy = (arr, fn) => arr.reduce((a, x) => a + (fn(x) || 0), 0);
  const code = t => h("code", null, t);
  const titleCase = t => String(t || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const cleanCity = titleCase;
  const cleanPlace = titleCase;
  const normState = v => {
    const t = String(v || "").trim();
    if (!t) return "Unknown";
    if (/^in$/i.test(t)) return HOME_STATE;
    if (/^out$/i.test(t)) return "Outside home state";
    return titleCase(t);
  };
  const displaySeason = s => String(s).replace("-", "–");

  function dayOf(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function daysBetween(a, b) { return Math.round((dayOf(b) - dayOf(a)) / DAY); }

  function seasonOf(d) {
    const y = d.getMonth() >= SEASON_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
    return y + "-" + String(y + 1).slice(2);
  }
  function seasonYear(label) { return Number(String(label).slice(0, 4)); }
  function priorSeason(label) { return (seasonYear(label) - 1) + "-" + String(seasonYear(label)).slice(2); }

  function parseDate(v) {
    if (!v) return null;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return dayOf(new Date(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) return dayOf(new Date(+m[3], +m[2] - 1, +m[1]));
    return null;
  }

  function median(arr) {
    const a = arr.filter(x => x !== null && x !== undefined).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function mulberry32(seed) {
    let a = seed;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Groups school names that differ only by punctuation, case, "St/Saint" and filler words
  function schoolKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .map(t => (t === "saint" ? "st" : t))
      .filter(t => t && !DROP.has(t))
      .join(" ");
  }

  function normChannel(v) {
    const s = String(v || "").toLowerCase();
    if (/visit/.test(s)) return CH.VISIT;
    if (/event|fair|seminar|counsel/.test(s)) return CH.EVENT;
    if (/ad|social|insta|facebook|google/.test(s)) return CH.ADS;
    if (/media|reel|youtube|video/.test(s)) return CH.MEDIA;
    return null;
  }

  function normStage(v) {
    const s = String(v || "").toLowerCase();
    if (/enrol/.test(s)) return 4;
    if (/fee/.test(s)) return 3;
    if (/admit/.test(s)) return 2;
    if (/appl/.test(s)) return 1;
    if (/enq|inq/.test(s)) return 0;
    return -1;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim() !== ""));
  }

  // ---------- Records ----------
  function makeCampaign(o) {
    const c = Object.assign({ id: "", schoolRaw: "", faculty: "", state: "Unknown", district: "" }, o);
    c.district = c.district || c.city;
    c.key = schoolKey(c.schoolRaw);
    c.season = seasonOf(c.date);
    return c;
  }

  function makeStudent(o) {
    const s = Object.assign({ school: "", district: "", state: "Unknown", course: "" }, o);
    s.district = s.district || s.city;
    s.key = schoolKey(s.school);
    s.season = seasonOf(s.enquiry);
    return s;
  }

  function buildDemo(seed) {
    const rand = mulberry32(seed);
    const pick = a => a[Math.floor(rand() * a.length)];
    const campaigns = [];
    const students = [];
    const add = o => campaigns.push(makeCampaign(Object.assign({ id: "C" + String(campaigns.length + 1).padStart(4, "0") }, o)));
    const roundTo = (x, n) => Math.round(x / n) * n;

    const seasons = [
      { year: 2025, visits: 30, events: 5, ads: 8, media: 5, students: 300 },
      { year: 2026, visits: 46, events: 9, ads: 12, media: 8, students: 430 },
    ];

    seasons.forEach(cfg => {
      const y = cfg.year;
      const between = (a, b) => dayOf(new Date(a.getTime() + rand() * (b - a)));
      const seasonStart = new Date(y, 5, 1), seasonEnd = new Date(y, 8, 30), julyStart = new Date(y, 6, 1);
      const enqStart = new Date(y, 5, 15), enqEnd = new Date(y, 9, 25);

      for (let i = 0; i < cfg.visits; i++) {
        const sc = pick(DEMO_SCHOOLS);
        const pl = PLACE[sc.city];
        const local = pl.state === HOME_STATE;
        add({
          channel: CH.VISIT, subtype: local ? "In-state visit" : "Out-of-state visit",
          date: between(seasonStart, seasonEnd), schoolRaw: pick(sc.names),
          city: pl.city, district: pl.district, state: pl.state,
          cost: roundTo(local ? 800 + rand() * 1200 : 3500 + rand() * 4500, 50), faculty: pick(FACULTY),
        });
      }
      for (let i = 0; i < cfg.events; i++) {
        const sc = pick(DEMO_SCHOOLS);
        const pl = PLACE[sc.city];
        add({
          channel: CH.EVENT, subtype: pick(["School fair", "PU college seminar", "Parent counselling"]),
          date: between(seasonStart, seasonEnd), schoolRaw: pick(sc.names),
          city: pl.city, district: pl.district, state: pl.state,
          cost: roundTo(15000 + rand() * 65000, 500), faculty: pick(FACULTY),
        });
      }
      for (let i = 0; i < cfg.ads; i++) {
        const pl = pick(DEMO_PLACES);
        add({
          channel: CH.ADS, subtype: pick(["Instagram", "Facebook", "Google search"]),
          date: between(julyStart, seasonEnd), schoolRaw: "",
          city: pl.city, district: pl.district, state: pl.state,
          cost: roundTo(5000 + rand() * 25000, 500), faculty: "",
        });
      }
      for (let i = 0; i < cfg.media; i++) {
        const pl = pick(DEMO_PLACES);
        add({
          channel: CH.MEDIA, subtype: pick(["Reel", "YouTube video"]),
          date: between(julyStart, seasonEnd), schoolRaw: "",
          city: pl.city, district: pl.district, state: pl.state,
          cost: roundTo(3000 + rand() * 37000, 500), faculty: "",
        });
      }

      for (let i = 0; i < cfg.students; i++) {
        let school = "", pl;
        const fromSchool = rand() < 0.55;
        if (fromSchool) {
          const sc = pick(DEMO_SCHOOLS);
          school = pick(sc.names);
          pl = PLACE[sc.city];
        } else {
          pl = pick(DEMO_PLACES);
        }
        // Students from school contacts are somewhat more likely to progress (demo shape only)
        const sr = rand() * (fromSchool ? 0.8 : 1);
        const stageIdx = sr < 0.35 ? 0 : sr < 0.65 ? 1 : sr < 0.83 ? 2 : sr < 0.93 ? 3 : 4;
        students.push(makeStudent({
          id: "S" + y + String(i + 1).padStart(4, "0"),
          city: pl.city, district: pl.district, state: pl.state,
          school, course: pick(COURSES),
          enquiry: between(enqStart, enqEnd), stageIdx,
        }));
      }
    });
    return { campaigns, students };
  }

  // ---------- Attribution ----------
  // Index visits/events by school and season, and ads/media by city and season
  function buildIndex() {
    const touch = new Map(), area = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    state.campaigns.forEach(c => {
      if ((c.channel === CH.VISIT || c.channel === CH.EVENT) && c.key) push(touch, c.season + "|" + c.key, c);
      if (c.channel === CH.ADS || c.channel === CH.MEDIA) push(area, c.season + "|" + c.city, c);
    });
    touch.forEach(list => list.sort((a, b) => a.date - b.date));
    return { touch, area };
  }

  // No attribution window is applied: every prior visit or event at the school is recorded, with its lag
  function attribute(s, idx) {
    if (s.key) {
      const list = idx.touch.get(s.season + "|" + s.key) || [];
      const prior = list.filter(c => c.date <= s.enquiry);
      if (prior.length) {
        const last = prior[prior.length - 1];
        return {
          level: "School contact", channel: last.channel, subtype: last.subtype,
          faculty: last.faculty, campaignId: last.id,
          lastDays: daysBetween(last.date, s.enquiry),
          firstDays: daysBetween(prior[0].date, s.enquiry),
          touches: prior.length,
        };
      }
    }
    const areaHit = (idx.area.get(s.season + "|" + s.city) || []).some(c => c.date <= s.enquiry);
    if (areaHit) return { level: "Area only", channel: AREA, subtype: "", faculty: "", campaignId: "", lastDays: null, firstDays: null, touches: 0 };
    return { level: "Unattributed", channel: NONE, subtype: "", faculty: "", campaignId: "", lastDays: null, firstDays: null, touches: 0 };
  }

  function recompute() {
    state.raw = new Map();
    const add = (k, raw) => {
      if (!k) return;
      if (!state.raw.has(k)) state.raw.set(k, new Map());
      const m = state.raw.get(k);
      m.set(raw, (m.get(raw) || 0) + 1);
    };
    state.campaigns.forEach(c => add(c.key, c.schoolRaw));
    state.students.forEach(s => add(s.key, s.school));

    const idx = buildIndex();
    state.students.forEach(s => { s.att = attribute(s, idx); });

    const seasons = new Set([...state.campaigns.map(c => c.season), ...state.students.map(s => s.season)]);
    state.seasons = [...seasons].sort().reverse();
    const latest = state.seasons[0] || "";
    if (state.filters.season === null || (state.filters.season && !state.seasons.includes(state.filters.season))) {
      state.filters.season = latest;
    }
  }

  function displayName(k) {
    const m = state.raw.get(k);
    if (!m) return k;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  function placeKey(r) { return (r.state || "Unknown") + "|" + (r.district || r.city); }

  // ---------- Filtering and summaries ----------
  function filtered() {
    const f = state.filters;
    const inRange = d => (!f.from || d >= f.from) && (!f.to || d <= f.to);
    const seasonOk = r => !f.season || r.season === f.season;
    const students = state.students.filter(s =>
      seasonOk(s) && (!f.district || s.district === f.district) && (!f.course || s.course === f.course) &&
      (!f.channel || s.att.channel === f.channel) && inRange(s.enquiry)
    );
    const campaigns = state.campaigns.filter(c =>
      seasonOk(c) && (!f.district || c.district === f.district) && (!f.channel || c.channel === f.channel) && inRange(c.date)
    );
    return { students, campaigns };
  }

  function summarize(students, spend) {
    const cnt = k => students.filter(s => s.stageIdx >= k).length;
    const admitted = cnt(2), enrolled = cnt(4);
    return {
      n: students.length, applied: cnt(1), admitted, feePaid: cnt(3), enrolled, spend,
      cpa: admitted ? spend / admitted : null,
      cpe: enrolled ? spend / enrolled : null,
    };
  }

  function groupRows(f) {
    const rows = GROUPS.map(g => {
      const campaigns = f.campaigns.filter(c => g.channels.includes(c.channel));
      const spend = total(campaigns);
      const students = f.students.filter(s => s.att.channel === g.attr);
      return { label: g.label, campaigns: campaigns.length, spend, S: summarize(students, spend), note: g.note };
    });
    rows.push({
      label: "Unattributed", campaigns: 0, spend: 0,
      S: summarize(f.students.filter(s => s.att.channel === NONE), 0),
      note: "No school contact and no ad or media in the city before enquiry",
    });
    return rows;
  }

  // Per-district rollup used by the Locations view
  function locationStats(f) {
    const map = new Map();
    const get = r => {
      const k = placeKey(r);
      if (!map.has(k)) {
        map.set(k, { district: r.district || r.city, state: r.state || "Unknown", visits: 0, events: 0, adsMedia: 0, spend: 0, visited: false, students: [] });
      }
      return map.get(k);
    };
    f.campaigns.forEach(c => {
      const p = get(c);
      p.spend += c.cost;
      if (c.channel === CH.VISIT) { p.visits++; p.visited = true; }
      else if (c.channel === CH.EVENT) { p.events++; p.visited = true; }
      else p.adsMedia++;
    });
    f.students.forEach(s => get(s).students.push(s));

    return [...map.values()].map(p => {
      const admitted = p.students.filter(s => s.stageIdx >= 2);
      return Object.assign(p, {
        enquiries: p.students.length,
        admitted: admitted.length,
        marketed: admitted.filter(s => s.att.level === "School contact").length,
        adsOnly: admitted.filter(s => s.att.level === "Area only").length,
        noLink: admitted.filter(s => s.att.level === "Unattributed").length,
        admitRate: p.students.length ? admitted.length / p.students.length : null,
      });
    });
  }

  // Faculty rollup for a set of filtered records
  function facultyStats(f) {
    const people = new Map();
    const get = n => {
      if (!people.has(n)) people.set(n, { name: n, visits: 0, inState: 0, outState: 0, events: 0, schools: new Set(), places: new Set(), spend: 0, credited: [] });
      return people.get(n);
    };
    f.campaigns.forEach(c => {
      if (!c.faculty) return;
      if (c.channel !== CH.VISIT && c.channel !== CH.EVENT) return;
      const p = get(c.faculty);
      p.spend += c.cost;
      p.places.add(placeKey(c));
      if (c.key) p.schools.add(c.key);
      if (c.channel === CH.VISIT) {
        p.visits++;
        if (c.state === HOME_STATE) p.inState++; else p.outState++;
      } else p.events++;
    });
    f.students.forEach(s => {
      if (!s.att.faculty) return;
      get(s.att.faculty).credited.push(s);
    });
    return [...people.values()].map(p => {
      const S = summarize(p.credited, p.spend);
      return Object.assign(p, {
        schoolCount: p.schools.size,
        placeCount: p.places.size,
        enquiries: S.n, admitted: S.admitted, enrolled: S.enrolled,
        admitRate: S.n ? S.admitted / S.n : null,
        cpa: S.cpa,
        medianDays: median(p.credited.map(s => s.att.lastDays)),
      });
    }).sort((x, y) => y.admitted - x.admitted || y.enquiries - x.enquiries || y.visits - x.visits);
  }

  // Faculty results per season across all data (not affected by filters), for the trend charts
  function facultyBySeason() {
    const map = new Map();
    state.students.forEach(s => {
      if (!s.att || !s.att.faculty) return;
      if (!map.has(s.att.faculty)) map.set(s.att.faculty, new Map());
      const bySeason = map.get(s.att.faculty);
      const e = bySeason.get(s.season) || { enq: 0, adm: 0 };
      e.enq++;
      if (s.stageIdx >= 2) e.adm++;
      bySeason.set(s.season, e);
    });
    return map;
  }

  function allFacultyNames() {
    const set = new Set(state.campaigns.map(c => c.faculty).filter(Boolean));
    state.students.forEach(s => { if (s.att && s.att.faculty) set.add(s.att.faculty); });
    return [...set].sort();
  }

  // ---------- UI building blocks ----------
  const kpi = (label, value, sub) => h("div", { class: "kpi" },
    h("div", { class: "kpi-label" }, label),
    h("div", { class: "kpi-value" }, value),
    sub ? h("div", { class: "kpi-sub" }, sub) : null
  );

  const card = (title, ...body) => h("div", { class: "card" }, h("h3", null, title), ...body);

  // Single-value horizontal bars: rows of {label, value, text}
  function bars(rows) {
    const max = Math.max(1, ...rows.map(r => r.value));
    return h("div", null, rows.map(r => {
      const fill = h("div", { class: "bar-fill" });
      fill.style.width = (r.value / max) * 100 + "%";
      return h("div", { class: "bar-row" },
        h("div", null, r.label),
        h("div", { class: "bar-track" }, fill),
        h("div", { class: "bar-value" }, r.text));
    }));
  }

  // Stacked bars: rows of {label, values[], text}; parts of {label, cls}
  function stacked(rows, parts) {
    const max = Math.max(1, ...rows.map(r => sumBy(r.values, x => x)));
    return h("div", null, rows.map(r => {
      const track = h("div", { class: "bar-track stack" });
      r.values.forEach((v, i) => {
        if (!v) return;
        const seg = h("div", { class: "seg " + parts[i].cls, title: parts[i].label + ": " + v });
        seg.style.width = (v / max) * 100 + "%";
        track.appendChild(seg);
      });
      return h("div", { class: "bar-row" }, h("div", null, r.label), track, h("div", { class: "bar-value" }, r.text));
    }));
  }

  // Colour for series i of n: the last series is always the darkest navy
  function serColor(i, n) { return SERIES[Math.max(0, SERIES.length - n) + i] || SERIES[0]; }

  // Several series per row: rows of {label, values[], text}; n = number of series
  function seriesBars(rows, n) {
    const max = Math.max(1, ...rows.flatMap(r => r.values));
    return h("div", null, rows.map(r => h("div", { class: "gbar-row" },
      h("div", { class: "gbar-label" }, r.label),
      h("div", { class: "gbar-tracks" }, r.values.map((v, i) => {
        const t = h("div", { class: "bar-track thin" });
        const f = h("div", { class: "bar-fill" });
        f.style.width = ((v || 0) / max) * 100 + "%";
        f.style.background = serColor(i, n);
        t.appendChild(f);
        return t;
      })),
      h("div", { class: "bar-value" }, r.text))));
  }

  function seriesLegend(labels) {
    return h("div", { class: "legend" }, labels.map((l, i) => {
      const sw = h("span", { class: "swatch" });
      sw.style.background = serColor(i, labels.length);
      return h("span", { class: "legend-item" }, sw, l);
    }));
  }

  function legend(items) {
    return h("div", { class: "legend" }, items.map(i =>
      h("span", { class: "legend-item" }, h("span", { class: "swatch " + i.cls }), i.label)));
  }

  // Pie chart: slices of {label, value}. Colours are set through the CSSOM (allowed by the content policy)
  function pie(slices) {
    const tot = sumBy(slices, s => s.value);
    if (!tot) return h("p", { class: "note" }, "No enquiries in the current filters.");
    let acc = 0;
    const stops = slices.map((s, i) => {
      const a = (acc / tot) * 100;
      acc += s.value;
      return `${PIE[i % PIE.length]} ${a}% ${(acc / tot) * 100}%`;
    });
    const disc = h("div", { class: "pie" });
    disc.style.background = `conic-gradient(${stops.join(", ")})`;
    const list = h("div", { class: "pie-legend" }, slices.map((s, i) => {
      const sw = h("span", { class: "swatch" });
      sw.style.background = PIE[i % PIE.length];
      return h("div", { class: "pie-row" }, sw, h("span", { class: "pie-name" }, s.label),
        h("span", { class: "pie-val" }, `${num(s.value)} · ${Math.round((s.value / tot) * 100)}%`));
    }));
    return h("div", { class: "pie-wrap" }, disc, list);
  }

  // Table; onRowClick(index) makes rows clickable
  function table(headers, rows, onRowClick) {
    return h("div", { class: "table-wrap" },
      h("table", null,
        h("thead", null, h("tr", null, headers.map(x => h("th", null, x)))),
        h("tbody", null, rows.length
          ? rows.map((r, i) => h("tr", onRowClick ? { class: "clickable", onclick: () => onRowClick(i) } : null,
              r.map(c => h("td", null, c))))
          : h("tr", null, h("td", { colspan: headers.length }, "No records match the current filters")))));
  }

  const MARKETING_PARTS = [
    { label: "Via school visit or event", cls: "seg-school" },
    { label: "Via ads or media (indicative)", cls: "seg-ads" },
    { label: "No marketing link found", cls: "seg-none" },
  ];

  // ---------- Views ----------
  function viewOverview(f) {
    const spend = total(f.campaigns);
    const S = summarize(f.students, spend);
    const linked = f.students.filter(s => s.att.level === "School contact").length;
    const groups = groupRows(f);
    const funnel = [
      { label: "Enquired", value: S.n },
      { label: "Applied", value: S.applied },
      { label: "Admitted", value: S.admitted },
      { label: "Fee paid", value: S.feePaid },
      { label: "Enrolled", value: S.enrolled },
    ];

    // Coverage: visited places only
    const visitedCamps = f.campaigns.filter(c => c.channel === CH.VISIT || c.channel === CH.EVENT);
    const statesCovered = new Set(visitedCamps.map(c => c.state));
    const districtsCovered = new Set(visitedCamps.map(placeKey));
    const schoolsCovered = new Set(visitedCamps.map(c => c.key).filter(Boolean));

    // Enquiries by state, top five plus the rest grouped as "Other"
    const byState = new Map();
    f.students.forEach(s => byState.set(s.state, (byState.get(s.state) || 0) + 1));
    const ranked = [...byState.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
    const pieSlices = ranked.length > 6
      ? [...ranked.slice(0, 5), { label: "Other states", value: sumBy(ranked.slice(5), x => x.value) }]
      : ranked;

    return h("div", { class: "view" },
      h("div", { class: "kpis" },
        kpi("Total spend", inr(spend), "Visits, events, ads & media"),
        kpi("Enquiries", num(S.n), `${pct(linked, S.n)} linked to a school visit or event`),
        kpi("Admitted", num(S.admitted), `${pct(S.admitted, S.n)} of enquiries`),
        kpi("Enrolled", num(S.enrolled), `${pct(S.enrolled, S.n)} of enquiries`),
        kpi("Cost per admission", S.cpa ? inr(S.cpa) : "—", "Total spend ÷ admitted"),
        kpi("Cost per enrolment", S.cpe ? inr(S.cpe) : "—", "Total spend ÷ enrolled")),
      h("div", { class: "kpis" },
        kpi("States covered", num(statesCovered.size), "States with a visit or event"),
        kpi("Districts covered", num(districtsCovered.size), "Districts with a visit or event"),
        kpi("Schools covered", num(schoolsCovered.size), "Schools visited or invited to an event")),
      h("div", { class: "grid-2" },
        card("Enquiries by state", pie(pieSlices)),
        card("Spend by channel", bars(groups.slice(0, 3).map(g => ({ label: g.label, value: g.spend, text: inr(g.spend) }))))),
      card("Admission funnel", bars(funnel.map(x => ({ label: x.label, value: x.value, text: `${num(x.value)} · ${pct(x.value, S.n)}` })))));
  }

  function viewLocations(f) {
    const rows = locationStats(f);
    const visited = rows.filter(r => r.visited).sort((a, b) => b.enquiries - a.enquiries);
    const others = rows.filter(r => !r.visited).sort((a, b) => b.enquiries - a.enquiries);
    const visitedStates = new Map();
    visited.forEach(r => {
      if (!visitedStates.has(r.state)) visitedStates.set(r.state, { state: r.state, districts: 0, enquiries: 0 });
      const st = visitedStates.get(r.state);
      st.districts++; st.enquiries += r.enquiries;
    });
    const states = [...visitedStates.values()].sort((a, b) => b.enquiries - a.enquiries);

    const enqAll = sumBy(rows, r => r.enquiries);
    const enqVisited = sumBy(visited, r => r.enquiries);
    const admAll = sumBy(rows, r => r.admitted);
    const marketedAll = sumBy(rows, r => r.marketed);
    const adsAll = sumBy(rows, r => r.adsOnly);
    const top = visited.slice(0, TOP);
    const topAdm = rows.filter(r => r.admitted > 0).sort((a, b) => b.admitted - a.admitted).slice(0, TOP);

    const tableRows = [...visited, ...others].map(r => [
      r.district, r.state, r.visited ? "Yes" : "No",
      r.visits, r.events, r.adsMedia, num(r.enquiries), num(r.admitted),
      r.admitRate === null ? "—" : Math.round(r.admitRate * 100) + "%",
      num(r.marketed), num(r.adsOnly), num(r.noLink),
    ]);

    return h("div", { class: "view" },
      h("div", { class: "kpis" },
        kpi("Districts visited", num(visited.length), `${num(others.length)} other districts sent enquiries`),
        kpi("States visited", num(states.length), states.slice(0, 3).map(s => s.state).join(", ") || "—"),
        kpi("Enquiries from visited districts", num(enqVisited), `${pct(enqVisited, enqAll)} of all enquiries`),
        kpi("Admissions with a marketing link", pct(marketedAll + adsAll, admAll), `${num(marketedAll)} school-linked · ${num(adsAll)} ads/media-linked`)),
      h("div", { class: "grid-2" },
        card("Enquiries by visited district",
          top.length
            ? bars(top.map(r => ({ label: `${r.district}`, value: r.enquiries, text: `${num(r.enquiries)} enquiries · ${r.visits + r.events} visits` })))
            : h("p", { class: "note" }, "No visits or events in the current filters."),
          h("p", { class: "note" }, `Top ${Math.min(TOP, visited.length)} of ${visited.length} visited districts.`)),
        card("Visited states",
          states.length
            ? bars(states.map(s => ({ label: s.state, value: s.enquiries, text: `${s.districts} districts · ${num(s.enquiries)} enquiries` })))
            : h("p", { class: "note" }, "No visits or events in the current filters."))),
      card("Where admissions come from, by district",
        topAdm.length
          ? stacked(topAdm.map(r => ({
              label: r.district,
              values: [r.marketed, r.adsOnly, r.noLink],
              text: `${num(r.admitted)} admitted · ${pct(r.marketed + r.adsOnly, r.admitted)} marketing-linked`,
            })), MARKETING_PARTS)
          : h("p", { class: "note" }, "No admissions in the current filters."),
        legend(MARKETING_PARTS.map(p => ({ label: p.label, cls: p.cls }))),
        h("p", { class: "note" }, "School-linked admissions are matched by school name to a prior visit or event. Ads and media links use city only and are indicative. Admissions with no link are not proof of organic enrolment, only that no marketing record matched.")),
      card("All districts",
        table(
          ["District", "State", "Visited", "Visits", "Events", "Ads / media", "Enquiries", "Admitted", "Admit rate", "School-linked", "Ads-linked", "No link"],
          tableRows
        ),
        h("p", { class: "note" }, "Visited = at least one teacher visit or event in the selected season. Districts with only ads or media are listed as not visited."))
    );
  }

  // ----- Season comparison (any number of seasons, chosen by the user) -----
  const NS = "http://www.w3.org/2000/svg";

  // Percentage change between two values, shown with an arrow
  function deltaText(p, c) {
    if (p === null || c === null || p === undefined || c === undefined) return "—";
    if (!p) return c ? "New" : "—";
    const d = (c - p) / p;
    return (d >= 0 ? "▲ " : "▼ ") + Math.abs(Math.round(d * 100)) + "%";
  }

  // Vertical columns for any number of points: each point is {label, value, text}
  function columns(points) {
    const max = Math.max(1, ...points.map(p => p.value || 0));
    return h("div", { class: "colchart" }, points.map(p => {
      const bar = h("div", { class: "col-bar" });
      bar.style.height = Math.max(2, Math.round(((p.value || 0) / max) * 170)) + "px";
      return h("div", { class: "col" },
        h("div", { class: "col-value" }, p.text),
        h("div", { class: "col-track" }, bar),
        h("div", { class: "col-label" }, p.label));
    }));
  }

  // Small trend line drawn as SVG
  function sparkline(values) {
    const W = 170, H = 42, pad = 5;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const max = Math.max(1, ...values);
    const n = values.length;
    const xs = i => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1));
    const ys = v => H - pad - (v / max) * (H - 2 * pad);
    const line = document.createElementNS(NS, "polyline");
    line.setAttribute("points", values.map((v, i) => `${xs(i)},${ys(v)}`).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "#0B2D5B");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-linejoin", "round");
    svg.appendChild(line);
    values.forEach((v, i) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", xs(i));
      c.setAttribute("cy", ys(v));
      c.setAttribute("r", "3");
      c.setAttribute("fill", "#0B2D5B");
      svg.appendChild(c);
    });
    return svg;
  }

  const METRICS = [
    { key: "enq", label: "Enquiries", get: s => s.S.n, fmt: num },
    { key: "app", label: "Applied", get: s => s.S.applied, fmt: num },
    { key: "adm", label: "Admitted", get: s => s.S.admitted, fmt: num },
    { key: "fee", label: "Fee paid", get: s => s.S.feePaid, fmt: num },
    { key: "enr", label: "Enrolled", get: s => s.S.enrolled, fmt: num },
    { key: "rate", label: "Admit rate", get: s => (s.S.n ? s.S.admitted / s.S.n : null), fmt: v => (v === null || v === undefined ? "—" : Math.round(v * 100) + "%") },
    { key: "spend", label: "Total spend", get: s => s.spend, fmt: inr },
    { key: "cpa", label: "Cost per admission", get: s => s.S.cpa, fmt: v => (v ? inr(v) : "—") },
    { key: "visits", label: "Teacher visits", get: s => s.visits, fmt: num },
    { key: "events", label: "Events", get: s => s.events, fmt: num },
    { key: "districts", label: "Districts visited", get: s => s.districts, fmt: num },
    { key: "states", label: "States visited", get: s => s.states, fmt: num },
  ];

  // Full-season numbers for one season
  function seasonSummary(season) {
    const campaigns = state.campaigns.filter(c => c.season === season);
    const students = state.students.filter(s => s.season === season);
    const spend = total(campaigns);
    const visitedCampaigns = campaigns.filter(c => c.channel === CH.VISIT || c.channel === CH.EVENT);
    const byDistrict = new Map();
    students.forEach(s => {
      const k = placeKey(s);
      const e = byDistrict.get(k) || { name: s.district, count: 0 };
      e.count++;
      byDistrict.set(k, e);
    });
    return {
      season, spend, S: summarize(students, spend),
      visits: campaigns.filter(c => c.channel === CH.VISIT).length,
      events: campaigns.filter(c => c.channel === CH.EVENT).length,
      districts: new Set(visitedCampaigns.map(placeKey)).size,
      states: new Set(visitedCampaigns.map(c => c.state)).size,
      byDistrict,
    };
  }

  // Seasons the user has chosen to compare, oldest first (null means all seasons)
  function compareSeasons() {
    const all = state.seasons.slice().sort();
    const base = state.compareSeasons === null ? all : state.compareSeasons.filter(s => all.includes(s));
    return base.slice().sort();
  }

  function viewYoY() {
    const all = state.seasons.slice().sort();
    if (all.length < 2) {
      return h("div", { class: "view" }, card("Season comparison",
        h("p", { class: "note" }, "Load at least two seasons in Data & import to compare them. The season is detected from each row's date.")));
    }

    const selected = compareSeasons();
    if (!selected.length) {
      return h("div", { class: "view" }, card("Season comparison",
        h("p", { class: "note" }, "Select at least one season below.")));
    }
    const metric = METRICS.find(m => m.key === state.compareMetric) || METRICS[0];
    const sums = selected.map(seasonSummary);
    const span = vals => (selected.length < 2 ? "—" : deltaText(vals[0], vals[vals.length - 1]));

    const chip = (label, onclick, active) => h("button", { type: "button", class: "chip" + (active ? " on" : ""), onclick }, label);

    const toggles = h("div", { class: "chips" }, all.map(s => chip(displaySeason(s), () => {
      const cur = compareSeasons();
      const next = cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s];
      state.compareSeasons = next.length ? next : cur;
      render();
    }, selected.includes(s))));

    const isAll = state.compareSeasons === null;
    const presets = h("div", { class: "chips" },
      chip("All seasons", () => { state.compareSeasons = null; render(); }, isAll),
      chip("Last 3", () => { state.compareSeasons = all.slice(-3); render(); }, false),
      chip("Last 5", () => { state.compareSeasons = all.slice(-5); render(); }, false),
      chip("Last 10", () => { state.compareSeasons = all.slice(-10); render(); }, false));

    const metricSel = h("select", { onchange: e => { state.compareMetric = e.target.value; render(); } },
      METRICS.map(m => h("option", { value: m.key, selected: m.key === metric.key ? true : null }, m.label)));

    const vals = sums.map(s => metric.get(s));
    const chart = columns(sums.map((s, i) => ({
      label: displaySeason(s.season), value: vals[i] || 0, text: metric.fmt(vals[i]),
    })));

    const metricTable = table(
      ["Measure", ...selected.map(displaySeason), "Change (first → last)"],
      METRICS.map(m => {
        const v = sums.map(s => m.get(s));
        return [m.label, ...v.map(x => m.fmt(x)), span(v)];
      })
    );

    // District enquiries across the selected seasons, shaded by volume
    const keys = new Set();
    sums.forEach(s => s.byDistrict.forEach((_, k) => keys.add(k)));
    const drows = [...keys].map(k => {
      const v = sums.map(s => (s.byDistrict.get(k) || { count: 0 }).count);
      const name = (sums.map(s => s.byDistrict.get(k)).find(Boolean) || { name: k }).name;
      return { name, v, total: v.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.total - a.total).slice(0, 12);
    const maxCell = Math.max(1, ...drows.flatMap(r => r.v));
    const heat = h("div", { class: "table-wrap" },
      h("table", null,
        h("thead", null, h("tr", null, ["District", ...selected.map(displaySeason), "Change (first → last)"].map(x => h("th", null, x)))),
        h("tbody", null, drows.map(r => h("tr", null,
          h("td", null, r.name),
          r.v.map(x => {
            const td = h("td", null, num(x));
            td.style.background = `rgba(11, 45, 91, ${((x / maxCell) * 0.45).toFixed(3)})`;
            return td;
          }),
          h("td", null, span(r.v)))))));

    return h("div", { class: "view" },
      card("Choose the seasons to compare", toggles, presets,
        h("p", { class: "note" }, `Comparing ${selected.length} season(s): ${selected.map(displaySeason).join(", ")}.`)),
      card(metric.label + " by season",
        h("div", { class: "toolbar" }, h("label", { class: "field" }, h("span", null, "Measure"), metricSel)),
        chart),
      card("All measures", metricTable),
      card("Districts by enquiries across the selected seasons (top 12)", heat,
        h("p", { class: "note" }, "Darker cells mean more enquiries in that season.")),
      h("p", { class: "note" }, "Season comparisons use full seasons and ignore the district, channel, course and date filters. Change compares the first and last selected seasons."));
  }

  // ----- Faculty: list page with search, then a detail page per person -----
  function viewFaculty(f) {
    if (state.facultySel) return viewFacultyDetail(f, state.facultySel);

    const stats = facultyStats(f);
    const headers = ["Faculty", "Institutions visited", "Visits", "Events", "Districts", "Enquiries credited", "Admitted", "Admit rate"];
    const listBox = h("div");

    const fill = q => {
      const term = q.trim().toLowerCase();
      const rows = stats.filter(x => !term || x.name.toLowerCase().includes(term));
      listBox.replaceChildren(table(headers,
        rows.map(x => [
          x.name, x.schoolCount, x.visits, x.events, x.placeCount,
          num(x.enquiries), num(x.admitted),
          x.admitRate === null ? "—" : Math.round(x.admitRate * 100) + "%",
        ]),
        i => { state.facultySel = rows[i].name; render(); }));
    };

    const search = h("input", {
      type: "search", class: "search", placeholder: "Search faculty name", "aria-label": "Search faculty by name",
      oninput: e => fill(e.target.value),
    });
    fill("");

    // Season-by-season trend across all data (not affected by filters)
    const bySeason = facultyBySeason();
    const seasonsAsc = state.seasons.slice().sort();
    const trend = [...bySeason.entries()].map(([name, m]) => {
      const vals = seasonsAsc.map(s => (m.get(s) || { adm: 0 }).adm);
      return { name, vals, total: vals.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.total - a.total);

    const trendTable = h("div", { class: "table-wrap" },
      h("table", null,
        h("thead", null, h("tr", null,
          ["Faculty", "Trend", ...seasonsAsc.map(displaySeason), "Change (first → last)"].map(x => h("th", null, x)))),
        h("tbody", null, trend.length
          ? trend.map(r => h("tr", { class: "clickable", onclick: () => { state.facultySel = r.name; render(); } },
              h("td", null, r.name),
              h("td", null, sparkline(r.vals)),
              r.vals.map(v => h("td", null, num(v))),
              h("td", null, seasonsAsc.length < 2 ? "—" : deltaText(r.vals[0], r.vals[r.vals.length - 1]))))
          : h("tr", null, h("td", { colspan: seasonsAsc.length + 3 }, "No faculty-credited admissions are loaded yet.")))));

    return h("div", { class: "view" },
      card("Faculty",
        h("div", { class: "toolbar" }, search,
          h("span", { class: "note" }, `${stats.length} faculty in the current filters · select a name to open their details`)),
        listBox),
      card("Admitted students credited to each faculty member, by season",
        trendTable,
        h("p", { class: "note" }, "Each row shows the season-by-season trend across all loaded seasons. Select a row to open that person's details.")),
      h("p", { class: "note" }, "Individual performance is shown for review by college administration only. Figures describe marketing activity and enquiries, and should not be used alone to judge a person's work."));
  }

  function viewFacultyDetail(f, name) {
    const back = h("button", { class: "btn btn-ghost", type: "button", onclick: () => { state.facultySel = ""; render(); } }, "← All faculty");
    const allNames = allFacultyNames();
    const chips = h("div", { class: "chips" });
    const search = h("input", {
      type: "search", class: "search", placeholder: "Search another faculty name", "aria-label": "Search faculty by name",
      oninput: e => {
        const t = e.target.value.trim().toLowerCase();
        const matches = t ? allNames.filter(n => n.toLowerCase().includes(t)).slice(0, 8) : [];
        chips.replaceChildren(...matches.map(n => h("button", {
          type: "button", class: "chip",
          onclick: () => { state.facultySel = n; render(); },
        }, n)));
      },
    });

    const person = facultyStats(f).find(x => x.name === name);
    const header = h("div", { class: "toolbar" }, back, search);

    if (!person) {
      return h("div", { class: "view" },
        card(name, header, chips,
          h("p", { class: "note" }, `${name} has no visits, events or credited enquiries in the current filters.`)));
    }

    // Results by season for this person
    const bySeason = facultyBySeason().get(name) || new Map();
    const seasonsAsc = state.seasons.slice().reverse();
    const seasonRows = seasonsAsc.map(s => {
      const e = bySeason.get(s) || { enq: 0, adm: 0 };
      return { label: displaySeason(s), values: [e.enq, e.adm], text: `${num(e.enq)} enquiries · ${num(e.adm)} admitted` };
    });

    // Visit log, filtered like the rest of the page
    const log = f.campaigns
      .filter(c => c.faculty === name && (c.channel === CH.VISIT || c.channel === CH.EVENT))
      .sort((x, y) => x.date - y.date);
    const credit = new Map();
    person.credited.forEach(s => {
      const e = credit.get(s.att.campaignId) || { enq: 0, adm: 0, enr: 0 };
      e.enq++;
      if (s.stageIdx >= 2) e.adm++;
      if (s.stageIdx >= 4) e.enr++;
      credit.set(s.att.campaignId, e);
    });

    // Institutions this person visited
    const schoolMap = new Map();
    f.campaigns.filter(c => c.faculty === name && c.key && (c.channel === CH.VISIT || c.channel === CH.EVENT)).forEach(c => {
      const e = schoolMap.get(c.key) || { key: c.key, visits: 0, events: 0, last: null, district: c.district, state: c.state };
      if (c.channel === CH.VISIT) e.visits++; else e.events++;
      if (!e.last || c.date > e.last) e.last = c.date;
      schoolMap.set(c.key, e);
    });
    const schoolRows = [...schoolMap.values()].sort((a, b) => (b.visits + b.events) - (a.visits + a.events)).map(e => {
      const enq = person.credited.filter(s => s.key === e.key);
      return [displayName(e.key), e.visits, e.events, e.district, e.state, fmtDate(e.last), num(enq.length), num(enq.filter(s => s.stageIdx >= 2).length)];
    });

    return h("div", { class: "view" },
      card(name, header, chips,
        h("div", { class: "kpis" },
          kpi("Institutions visited", num(person.schoolCount), `${person.placeCount} districts`),
          kpi("Visits", num(person.visits), `${person.inState} in-state · ${person.outState} out-of-state`),
          kpi("Events", num(person.events), "Fairs, seminars and counselling"),
          kpi("Enquiries credited", num(person.enquiries), `median ${fmtDays(person.medianDays)} after visit`),
          kpi("Admitted", num(person.admitted), `${person.admitRate === null ? "—" : Math.round(person.admitRate * 100) + "%"} admit rate`),
          kpi("Cost per admission", person.cpa ? inr(person.cpa) : "—", `Spend ${inr(person.spend)}`))),
      card("Results by season",
        seriesBars(seasonRows, 2),
        seriesLegend(["Enquiries credited", "Admitted"])),
      card("Institutions visited",
        table(["School / college", "Visits", "Events", "District", "State", "Last contact", "Enquiries credited", "Admitted"], schoolRows)),
      card("Visit log",
        table(["Date", "Type", "School / college", "District", "State", "Cost", "Enquiries credited", "Admitted", "Enrolled"],
          log.map(c => {
            const e = credit.get(c.id) || { enq: 0, adm: 0, enr: 0 };
            return [fmtDate(c.date), c.subtype || c.channel, c.schoolRaw || "—", c.district, c.state, inr(c.cost), num(e.enq), num(e.adm), num(e.enr)];
          }))));
  }

  // ----- Channels: summary table, click a row for who went where -----
  function viewChannels(f) {
    if (state.drill) {
      const g = GROUPS.find(x => x.label === state.drill);
      if (g) return viewChannelDetail(f, g);
      state.drill = null;
    }
    const rows = groupRows(f);
    return h("div", { class: "view" },
      card("Channel performance",
        table(
          ["Channel", "Campaigns", "Spend", "Students", "Admitted", "Enrolled", "Cost / admission", "Cost / enrolment"],
          rows.map(r => [r.label, r.campaigns, inr(r.spend), r.S.n, r.S.admitted, r.S.enrolled,
            r.S.cpa ? inr(r.S.cpa) : "—", r.S.cpe ? inr(r.S.cpe) : "—"]),
          i => { if (i < GROUPS.length) { state.drill = GROUPS[i].label; render(); } }
        ),
        h("p", { class: "note" }, "Click a channel to see each visit, event or ad with its details.")),
      h("p", { class: "note" }, "Students are assigned to one channel: their most recent school visit or event before enquiry."),
      h("p", { class: "note" }, "Teacher visits and events are matched by school name. Ads and media are matched by city only, so their cost per admission is indicative."));
  }

  function viewChannelDetail(f, g) {
    const back = h("button", { class: "btn btn-ghost", type: "button", onclick: () => { state.drill = null; render(); } }, "← All channels");
    const camps = f.campaigns
      .filter(c => g.channels.includes(c.channel))
      .sort((a, b) => a.date - b.date || String(a.faculty).localeCompare(String(b.faculty)));
    const isAds = g.attr === AREA;

    // Credit per campaign for visits and events
    const credit = new Map();
    f.students.forEach(s => {
      if (!s.att.campaignId) return;
      const e = credit.get(s.att.campaignId) || { enq: 0, adm: 0 };
      e.enq++;
      if (s.stageIdx >= 2) e.adm++;
      credit.set(s.att.campaignId, e);
    });

    const spend = total(camps);
    const schools = new Set(camps.map(c => c.key).filter(Boolean)).size;
    const districts = new Set(camps.map(placeKey)).size;
    const faculty = new Set(camps.map(c => c.faculty).filter(Boolean)).size;

    const kpis = h("div", { class: "kpis" },
      kpi("Campaigns", num(camps.length), g.label),
      kpi("Spend", inr(spend), `${num(districts)} districts`),
      isAds
        ? kpi("Formats", num(new Set(camps.map(c => c.subtype)).size), "Instagram, Facebook, reels, YouTube and others")
        : kpi("Schools / colleges", num(schools), `${num(faculty)} faculty members involved`),
      isAds
        ? kpi("Students in same city after", num(camps.reduce((a, c) => a + f.students.filter(s => s.district === c.district && s.enquiry >= c.date).length, 0)), "Indicative only")
        : kpi("Enquiries credited", num(f.students.filter(s => s.att.channel === g.attr).length), "Matched by school name"));

    let body;
    if (isAds) {
      body = card(g.label + ": each ad and media piece",
        table(["Date", "Channel", "Format", "City", "District", "State", "Cost", "Enquiries after (indicative)", "Admitted after (indicative)"],
          camps.map(c => {
            const after = f.students.filter(s => s.district === c.district && s.enquiry >= c.date);
            return [fmtDate(c.date), c.channel, c.subtype || "—", c.city, c.district, c.state, inr(c.cost),
              num(after.length), num(after.filter(s => s.stageIdx >= 2).length)];
          })));
    } else {
      // Who went where, grouped by faculty
      const byFaculty = new Map();
      camps.forEach(c => {
        const name = c.faculty || "Not recorded";
        const e = byFaculty.get(name) || { visits: 0, schools: new Set(), districts: new Set(), spend: 0 };
        e.visits++;
        if (c.key) e.schools.add(c.key);
        e.districts.add(placeKey(c));
        e.spend += c.cost;
        byFaculty.set(name, e);
      });
      const facRows = [...byFaculty.entries()]
        .sort((a, b) => b[1].visits - a[1].visits)
        .map(([name, e]) => [name, e.visits, e.schools.size, e.districts.size, inr(e.spend)]);

      const logRows = camps.map(c => {
        const e = credit.get(c.id) || { enq: 0, adm: 0 };
        return [fmtDate(c.date), c.faculty || "—", c.subtype || c.channel, c.schoolRaw || "—", c.district, c.state, inr(c.cost), num(e.enq), num(e.adm)];
      });
      body = h("div", { class: "view" },
        card("Faculty and where they went", table(["Faculty", "Visits / events", "Institutions", "Districts", "Spend"], facRows)),
        card(g.label + ": each visit or event",
          table(["Date", "Faculty", "Type", "School / college", "District", "State", "Cost", "Enquiries credited", "Admitted"], logRows)));
    }

    return h("div", { class: "view" },
      card(g.label, h("div", { class: "toolbar" }, back), kpis),
      body);
  }

  function viewTiming(f) {
    const linked = f.students.filter(s => s.att.level === "School contact");
    const buckets = LAG.map(([lo, hi, label]) => {
      const g = linked.filter(s => s.att.lastDays >= lo && s.att.lastDays <= hi);
      return { label, n: g.length, adm: g.filter(s => s.stageIdx >= 2).length };
    });
    const schoolKeys = [...new Set(
      f.campaigns.map(c => c.key).concat(f.students.map(s => s.key)).filter(Boolean)
    )];
    const schoolRows = schoolKeys.map(k => {
      const camps = f.campaigns.filter(c => c.key === k);
      const studs = f.students.filter(s => s.key === k);
      const linkedK = studs.filter(s => s.att.level === "School contact");
      return {
        name: displayName(k),
        visits: camps.filter(c => c.channel === CH.VISIT).length,
        events: camps.filter(c => c.channel === CH.EVENT).length,
        spend: total(camps),
        enq: studs.length,
        adm: studs.filter(s => s.stageIdx >= 2).length,
        med: median(linkedK.map(s => s.att.lastDays)),
        medFirst: median(linkedK.map(s => s.att.firstDays)),
      };
    }).sort((a, b) => b.enq - a.enq || b.visits - a.visits);

    return h("div", { class: "view" },
      h("div", { class: "kpis" },
        kpi("Students linked to a school", num(linked.length), `${pct(linked.length, f.students.length)} of enquiries`),
        kpi("Median days since last contact", fmtDays(median(linked.map(s => s.att.lastDays))), "Latest visit or event before enquiry"),
        kpi("Median days since first contact", fmtDays(median(linked.map(s => s.att.firstDays))), "Earliest visit or event before enquiry"),
        kpi("Median contacts before enquiry", median(linked.map(s => s.att.touches)) ?? "—", "Visits and events at that school")),
      h("div", { class: "grid-2" },
        card("Days from last school contact to enquiry",
          bars(buckets.map(b => ({ label: b.label, value: b.n, text: `${b.n} students · ${b.adm} admitted` })))),
        card("Admission rate by timing",
          table(["Days since last contact", "Students", "Admitted", "Admit rate"],
            buckets.map(b => [b.label, b.n, b.adm, pct(b.adm, b.n)])))),
      card("School-wise visit timing",
        table(
          ["School / college", "Visits", "Events", "Spend", "Enquiries", "Admitted", "Median days since last contact", "Median days since first contact"],
          schoolRows.map(r => [r.name, r.visits, r.events, inr(r.spend), r.enq, r.adm, fmtDays(r.med), fmtDays(r.medFirst)])
        )),
      h("p", { class: "note" }, "No attribution window is applied. Every prior visit or event is shown with its lag. Schools with zero visits are students from schools that were never visited."));
  }

  function viewStudents(f) {
    const sorted = f.students.slice().sort((a, b) => b.enquiry - a.enquiry);
    const rows = sorted.slice(0, 200).map(s => [
      s.id, fmtDate(s.enquiry), s.city, s.district, s.school || "—", s.course, STAGES[s.stageIdx],
      s.att.level, s.att.channel, s.att.faculty || "—",
      s.att.lastDays === null ? "—" : s.att.lastDays,
      s.att.touches,
    ]);
    return h("div", { class: "view" },
      h("p", { class: "note" }, `Showing ${Math.min(200, sorted.length)} of ${sorted.length} students matching the filters. Students are identified by pseudonymous ID only.`),
      card("Students",
        table(
          ["ID", "Enquiry date", "City", "District", "School / college", "Course", "Status", "Attribution", "Channel", "Faculty", "Days since last contact", "Contacts"],
          rows
        )));
  }

  function reviewTable() {
    const keys = [...state.raw.keys()].sort();
    const head = k => k.split(" ").slice(0, 2).join(" ");
    const flagged = new Set();
    keys.forEach(k => keys.forEach(o => { if (o !== k && head(o) === head(k)) { flagged.add(k); flagged.add(o); } }));
    return table(
      ["School key", "Names as entered (rows)", "Check?"],
      keys.map(k => {
        const m = state.raw.get(k);
        const names = [...m.entries()].map(([n, c]) => `${n} (${c})`).join("; ");
        const check = flagged.has(k) ? "Possible duplicate: confirm" : (m.size > 1 ? "Grouped variants: confirm" : "");
        return [k, names, check];
      })
    );
  }

  function viewData() {
    const demo = state.isDemo.campaigns && state.isDemo.students;
    const up = (label, kind) => h("label", { class: "upload" },
      h("span", null, label),
      h("input", { type: "file", accept: ".csv,text/csv", onchange: e => handleFile(e.target.files[0], kind) }));

    return h("div", { class: "view" },
      h("p", { class: "note" },
        `Loaded: ${num(state.campaigns.length)} campaign rows and ${num(state.students.length)} student rows across ${state.seasons.length} season(s) (${demo ? "synthetic demo data" : "includes uploaded spreadsheets"}). Files are read in your browser and are never sent to a server.`),
      card("Upload spreadsheets (CSV)",
        up("Campaign spend sheet (visits, events, ads, media)", "campaigns"),
        up("Student admissions sheet", "students"),
        h("button", { class: "btn", onclick: resetDemo }, "Reset to demo data")),
      card("Expected columns",
        h("p", null, "Campaign sheet: ", code(CAMPAIGN_COLS.join(", "))),
        h("p", null, "Student sheet: ", code(STUDENT_COLS.join(", "))),
        h("p", { class: "note" }, "Dates can be YYYY-MM-DD or DD/MM/YYYY. Costs are in rupees. The season (for example 2026–27) is worked out from each row's date, June to May. The 'faculty' column is the teacher or coordinator who made the visit. District and state are optional; if the district is missing the city is used. The state is compared with " + HOME_STATE + " to tell in-state from out-of-state visits. Columns named name, phone, email, mobile or address are ignored. Export Excel files as CSV first.")),
      card("School-name review", reviewTable(),
        h("p", { class: "note" }, "Names that look alike are grouped automatically. Confirm each flagged group before relying on school-level numbers.")),
      card("Import messages",
        state.log.length
          ? h("ul", { class: "log" }, state.log.slice(0, 30).map(m => h("li", null, m)))
          : h("p", { class: "note" }, "No import messages."))
    );
  }

  const views = {
    overview: viewOverview,
    locations: viewLocations,
    yoy: viewYoY,
    faculty: viewFaculty,
    channels: viewChannels,
    timing: viewTiming,
    students: viewStudents,
    data: viewData,
  };

  // ---------- Rendering and filters ----------
  function render() {
    const badge = document.getElementById("source-badge");
    const demo = state.isDemo.campaigns && state.isDemo.students;
    badge.textContent = demo ? "Synthetic demo data" : "Uploaded data: review before use";
    const main = document.getElementById("main");
    main.replaceChildren(views[state.tab](filtered()));
    syncTabs();
  }

  function syncTabs() {
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
  }

  function buildTabs() {
    const box = document.querySelector(".tabs");
    box.replaceChildren(...TABS.map(([id, label]) => h("button", {
      type: "button", "data-tab": id,
      onclick: () => { state.tab = id; state.drill = null; state.facultySel = ""; render(); },
    }, label)));
  }

  function buildFilters() {
    const districts = [...new Set([...state.campaigns.map(c => c.district), ...state.students.map(s => s.district)].filter(Boolean))].sort();
    const courses = [...new Set(state.students.map(s => s.course).filter(Boolean))].sort();
    const box = document.getElementById("filters");

    const select = (label, key, options, allLabel) => {
      const s = h("select", {
        onchange: e => { state.filters[key] = e.target.value; render(); },
      }, h("option", { value: "" }, allLabel || "All"), options.map(o =>
        typeof o === "string" ? h("option", { value: o }, o) : h("option", { value: o.value }, o.label)));
      s.value = state.filters[key] || "";
      return h("label", { class: "field" }, h("span", null, label), s);
    };
    const dateField = (label, key) => h("label", { class: "field" }, h("span", null, label),
      h("input", {
        type: "date",
        onchange: e => { state.filters[key] = e.target.value ? parseDate(e.target.value) : null; render(); },
      }));

    const seasonOpts = state.seasons.map(s => ({ value: s, label: displaySeason(s) }));

    box.replaceChildren(
      select("Season", "season", seasonOpts, "All seasons"),
      select("Attributed channel", "channel", [...Object.values(CH), AREA, NONE]),
      select("District", "district", districts),
      select("Course", "course", courses),
      dateField("Enquiries / campaigns from", "from"),
      dateField("to", "to"),
      h("button", {
        class: "btn",
        onclick: () => {
          state.filters = { season: state.seasons[0] || "", channel: "", district: "", course: "", from: null, to: null };
          buildFilters();
          render();
        },
      }, "Clear filters")
    );
  }

  // ---------- Import ----------
  function flash(msg) {
    state.log.unshift(msg);
    state.tab = "data";
    render();
  }

  function handleFile(file, kind) {
    if (!file) return;
    if (file.size > MAX_BYTES) return flash(`${file.name}: larger than 2 MB. Split it into smaller sheets.`);
    if (!/\.csv$/i.test(file.name)) return flash(`${file.name}: please save the sheet as CSV (File > Download > CSV, or Save as > CSV).`);
    const reader = new FileReader();
    reader.onload = () => importText(String(reader.result), kind, file.name);
    reader.readAsText(file);
  }

  function importText(text, kind, name) {
    const rows = parseCSV(text);
    if (rows.length < 2) return flash(`${name}: no data rows found.`);
    if (rows.length - 1 > MAX_ROWS) return flash(`${name}: more than ${MAX_ROWS} rows. Split the sheet.`);

    const headers = rows[0].map(x => x.trim().toLowerCase().replace(/\s+/g, "_"));
    const required = kind === "campaigns" ? CAMPAIGN_REQ : STUDENT_REQ;
    const missing = required.filter(c => !headers.includes(c));
    if (missing.length) return flash(`${name}: missing column(s) ${missing.join(", ")}.`);

    const records = rows.slice(1).map(r => {
      const o = {};
      headers.forEach((k, i) => { o[k] = (r[i] || "").trim(); });
      return o;
    });

    const msgs = [];
    if (headers.some(x => PERSONAL_COLS.includes(x))) msgs.push("Personal-detail columns were detected and ignored.");

    if (kind === "campaigns") {
      state.campaigns = buildCampaigns(records, msgs);
      state.isDemo.campaigns = false;
    } else {
      state.students = buildStudents(records, msgs);
      state.isDemo.students = false;
    }
    msgs.forEach(m => state.log.unshift(`${name}: ${m}`));
    recompute();
    buildFilters();
    flash(`${name}: import complete.`);
  }

  function buildCampaigns(records, msgs) {
    const out = [];
    records.forEach((r, i) => {
      const row = i + 2;
      const channel = normChannel(r.channel);
      const date = parseDate(r.date);
      const cost = r.cost_inr === "" ? NaN : Number(String(r.cost_inr).replace(/[₹,\s]/g, ""));
      if (!channel) { msgs.push(`Campaign row ${row}: unknown channel "${r.channel}" (skipped).`); return; }
      if (!date) { msgs.push(`Campaign row ${row}: unreadable date "${r.date}" (skipped).`); return; }
      if (!Number.isFinite(cost) || cost < 0) { msgs.push(`Campaign row ${row}: cost "${r.cost_inr}" is not a valid amount (skipped).`); return; }
      const city = cleanCity(r.city);
      out.push(makeCampaign({
        id: "U" + String(i + 1).padStart(4, "0"), channel, subtype: r.subtype || "", date,
        schoolRaw: r.school || "", city,
        district: cleanPlace(r.district) || city,
        state: normState(r.state),
        cost, faculty: r.faculty || r.owner || "",
      }));
    });
    msgs.unshift(`${out.length} campaign rows imported, ${records.length - out.length} skipped.`);
    return out;
  }

  function buildStudents(records, msgs) {
    const out = [];
    records.forEach((r, i) => {
      const row = i + 2;
      const enquiry = parseDate(r.enquiry_date);
      const stageIdx = normStage(r.status);
      if (!enquiry) { msgs.push(`Student row ${row}: unreadable enquiry date "${r.enquiry_date}" (skipped).`); return; }
      if (stageIdx < 0) { msgs.push(`Student row ${row}: unknown status "${r.status}" (skipped).`); return; }
      const city = cleanCity(r.city);
      out.push(makeStudent({
        id: r.student_id || `R${row}`, city,
        district: cleanPlace(r.district) || city,
        state: normState(r.state),
        school: r.school || "", course: r.course || "", enquiry, stageIdx,
      }));
    });
    msgs.unshift(`${out.length} student rows imported, ${records.length - out.length} skipped.`);
    return out;
  }

  function resetDemo() {
    state.campaigns = state.demo.campaigns;
    state.students = state.demo.students;
    state.isDemo = { campaigns: true, students: true };
    state.log = ["Demo data restored."];
    state.filters.season = null;
    recompute();
    buildFilters();
    render();
  }

  // ---------- Start ----------
  function init() {
    state.demo = buildDemo(20260);
    state.campaigns = state.demo.campaigns;
    state.students = state.demo.students;
    recompute();
    buildTabs();
    buildFilters();
    render();
  }

  init();
})();
