(function () {
  "use strict";

  const BOOT = performance.now();
  const SPLASH_MIN_MS = 1800; // the opening animation plays for at least this long

  // ============ Configuration ============
  const CH = {
    VISIT: "Teacher visit",
    EVENT: "Event",
    ADS: "Social media ad",
    MEDIA: "Media (reels/YouTube)",
  };
  const AREA = "Area only";
  const NONE = "Unattributed";
  const HOME_STATE = "Karnataka";
  const NOT_RECORDED = "Not recorded";
  const STAGES = ["Enquired", "Applied", "Admitted", "Fee paid", "Enrolled"];
  const DAY = 86400000;
  const SEASON_START_MONTH = 5; // June (0-based): a season runs June to May
  const TOP = 10;
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_ROWS = 20000;
  const LAG = [
    [0, 30, "0–30 days"],
    [31, 60, "31–60 days"],
    [61, 90, "61–90 days"],
    [91, 180, "91–180 days"],
    [181, Infinity, "More than 180 days"],
  ];
  // Words ignored when matching school names ("St. Mary's HS" = "St Marys High School")
  const DROP = new Set(["the", "school", "high", "hs", "sch", "college", "pu", "junior", "jr"]);
  const REQUIRED = {
    campaigns: ["channel", "date", "city", "cost_inr"],
    students: ["city", "enquiry_date", "status"],
  };
  const PERSONAL_COLS = ["name", "phone", "email", "mobile", "address"];
  const CAMPAIGN_COLS = ["channel", "subtype", "date", "school", "city", "district", "state", "cost_inr", "faculty"];
  const STUDENT_COLS = ["student_id", "city", "district", "state", "school", "course", "enquiry_date", "status"];
  const PIE = ["#0B2D5B", "#2F5F9E", "#6F8FB8", "#A9BCD6", "#C9A227", "#D9C67A"];
  const SERIES = ["#C9D3E3", "#7F9CC4", "#2F5F9E", "#0B2D5B"];

  const TABS = [
    ["overview", "Overview"],
    ["locations", "Locations"],
    ["seasons", "Season comparison"],
    ["faculty", "Faculty"],
    ["channels", "Channels & spend"],
    ["timing", "Visit timing"],
    ["students", "Students"],
    ["reports", "Reports"],
    ["entry", "Enter records"],
    ["data", "Import & backup"],
  ];

  // Marketing channels grouped for spend and attribution
  const GROUPS = [
    { label: "Teacher visits", channels: [CH.VISIT], attr: CH.VISIT },
    { label: "Events", channels: [CH.EVENT], attr: CH.EVENT },
    { label: "Social media ads & media", channels: [CH.ADS, CH.MEDIA], attr: AREA },
  ];

  const inr = n => "₹" + Math.round(n || 0).toLocaleString("en-IN");
  const num = n => (n === null || n === undefined || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("en-IN"));

  const METRICS = [
    { key: "enq", label: "Enquiries", get: s => s.S.n, fmt: num },
    { key: "app", label: "Applied", get: s => s.S.applied, fmt: num },
    { key: "adm", label: "Admitted", get: s => s.S.admitted, fmt: num },
    { key: "fee", label: "Fee paid", get: s => s.S.feePaid, fmt: num },
    { key: "enr", label: "Enrolled", get: s => s.S.enrolled, fmt: num },
    { key: "rate", label: "Admit rate", get: s => (s.S.n ? s.S.admitted / s.S.n : null), fmt: v => (v === null ? "—" : Math.round(v * 100) + "%") },
    { key: "spend", label: "Total spend", get: s => s.spend, fmt: inr },
    { key: "cpa", label: "Cost per admission", get: s => s.S.cpa, fmt: v => (v ? inr(v) : "—") },
    { key: "visits", label: "Teacher visits", get: s => s.visits, fmt: num },
    { key: "events", label: "Events", get: s => s.events, fmt: num },
    { key: "districts", label: "Districts visited", get: s => s.districts, fmt: num },
    { key: "states", label: "States visited", get: s => s.states, fmt: num },
  ];

  // ============ State ============
  const state = {
    campaigns: [],
    students: [],
    demo: null,
    isDemo: true,
    seasons: [],          // newest first
    raw: new Map(),       // school key -> Map(name as typed -> rows)
    bySeason: new Map(),  // season -> { campaigns, students }
    credit: new Map(),    // campaign id -> { enq, adm, enr } (all data)
    facultySeason: new Map(), // faculty -> Map(season -> { enq, adm })
    faculty: [],          // all faculty names
    log: [],
    tab: "overview",
    drill: null,          // channel group open on the Channels tab
    facultySel: "",       // faculty member open on the Faculty tab
    compareSeasons: null, // null = all seasons
    compareMetric: "enq",
    filters: { season: "", channel: "", district: "", course: "", from: null, to: null },
    notice: "",           // one-line confirmation shown on the entry and data pages
    savedAt: null,        // when the working data was last saved in this browser
    saveFailed: false,
    store: { campaigns: [], students: [] }, // the full data held in this browser
    user: null,            // signed-in account (null when signed out)
    accounts: [],          // accounts stored in this browser
    presets: [],           // saved report setups
    report: { type: "season" },
    authError: false,    // true when browser storage is unavailable
  };

  // ============ Helpers ============
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

  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
  const days = v => (v === null || v === undefined ? "—" : Math.round(v) + " days");
  const fmtDate = d => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
  const sumBy = (arr, fn) => arr.reduce((a, x) => a + (fn(x) || 0), 0);
  const titleCase = t => String(t || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  const season = s => String(s).replace("-", "–");
  const median = arr => {
    const a = arr.filter(x => x !== null && x !== undefined).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  function dayOf(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function daysBetween(a, b) { return Math.round((dayOf(b) - dayOf(a)) / DAY); }
  function seasonOf(d) {
    const y = d.getMonth() >= SEASON_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
    return y + "-" + String(y + 1).slice(2);
  }
  function priorSeason(label) {
    const y = Number(label.slice(0, 4)) - 1;
    return y + "-" + String(y + 1).slice(2);
  }
  function parseDate(v) {
    const s = String(v || "").trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return dayOf(new Date(+m[1], +m[2] - 1, +m[3]));
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) return dayOf(new Date(+m[3], +m[2] - 1, +m[1]));
    return null;
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

  // Same school written differently ("St. Mary's HS" / "St Marys High School") gets the same key
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
  function normState(v) {
    const t = String(v || "").trim();
    if (!t) return NOT_RECORDED;
    if (/^in$/i.test(t)) return HOME_STATE;
    if (/^out$/i.test(t)) return "Other states";
    return titleCase(t);
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

  // ============ Records ============
  function makeCampaign(o) {
    const c = Object.assign({ id: "", school: "", faculty: "", state: NOT_RECORDED, district: "" }, o);
    c.district = c.district || c.city;
    c.key = schoolKey(c.school);
    c.season = seasonOf(c.date);
    return c;
  }
  function makeStudent(o) {
    const s = Object.assign({ school: "", district: "", state: NOT_RECORDED, course: "" }, o);
    s.district = s.district || s.city;
    s.key = schoolKey(s.school);
    s.season = seasonOf(s.enquiry);
    return s;
  }

  // ============ Synthetic demo data (fictional, for testing the layout) ============
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
  const DEMO_COURSES = ["B.Sc", "B.Com", "BBA", "BCA", "B.A", "B.Tech", "MBA"];
  const DEMO_FACULTY = ["Faculty A", "Faculty B", "Faculty C", "Faculty D", "Faculty E"];
  const DEMO_SEASONS = [
    { year: 2025, visits: 30, events: 5, ads: 8, media: 5, students: 300 },
    { year: 2026, visits: 46, events: 9, ads: 12, media: 8, students: 430 },
  ];

  function buildDemo(seed) {
    const rand = mulberry32(seed);
    const pick = a => a[Math.floor(rand() * a.length)];
    const place = {};
    DEMO_PLACES.forEach(p => { place[p.city] = p; });
    const roundTo = (x, n) => Math.round(x / n) * n;
    const campaigns = [], students = [];

    DEMO_SEASONS.forEach(cfg => {
      const y = cfg.year;
      const between = (a, b) => dayOf(new Date(a.getTime() + rand() * (b - a)));
      const seasonStart = new Date(y, 5, 1), seasonEnd = new Date(y, 8, 30), julyStart = new Date(y, 6, 1);
      const enqStart = new Date(y, 5, 15), enqEnd = new Date(y, 9, 25);
      const add = o => campaigns.push(makeCampaign(Object.assign({ id: "C" + String(campaigns.length + 1).padStart(4, "0") }, o)));

      for (let i = 0; i < cfg.visits; i++) {
        const sc = pick(DEMO_SCHOOLS), pl = place[sc.city];
        const local = pl.state === HOME_STATE;
        add({ channel: CH.VISIT, subtype: local ? "In-state visit" : "Out-of-state visit", date: between(seasonStart, seasonEnd),
          school: pick(sc.names), city: pl.city, district: pl.district, state: pl.state,
          cost: roundTo(local ? 800 + rand() * 1200 : 3500 + rand() * 4500, 50), faculty: pick(DEMO_FACULTY) });
      }
      for (let i = 0; i < cfg.events; i++) {
        const sc = pick(DEMO_SCHOOLS), pl = place[sc.city];
        add({ channel: CH.EVENT, subtype: pick(["School fair", "PU college seminar", "Parent counselling"]), date: between(seasonStart, seasonEnd),
          school: pick(sc.names), city: pl.city, district: pl.district, state: pl.state,
          cost: roundTo(15000 + rand() * 65000, 500), faculty: pick(DEMO_FACULTY) });
      }
      for (let i = 0; i < cfg.ads; i++) {
        const pl = pick(DEMO_PLACES);
        add({ channel: CH.ADS, subtype: pick(["Instagram", "Facebook", "Google search"]), date: between(julyStart, seasonEnd),
          city: pl.city, district: pl.district, state: pl.state, cost: roundTo(5000 + rand() * 25000, 500) });
      }
      for (let i = 0; i < cfg.media; i++) {
        const pl = pick(DEMO_PLACES);
        add({ channel: CH.MEDIA, subtype: pick(["Reel", "YouTube video"]), date: between(julyStart, seasonEnd),
          city: pl.city, district: pl.district, state: pl.state, cost: roundTo(3000 + rand() * 37000, 500) });
      }
      for (let i = 0; i < cfg.students; i++) {
        let school = "", pl;
        const fromSchool = rand() < 0.55;
        if (fromSchool) { const sc = pick(DEMO_SCHOOLS); school = pick(sc.names); pl = place[sc.city]; }
        else pl = pick(DEMO_PLACES);
        const sr = rand() * (fromSchool ? 0.8 : 1);
        const stageIdx = sr < 0.35 ? 0 : sr < 0.65 ? 1 : sr < 0.83 ? 2 : sr < 0.93 ? 3 : 4;
        students.push(makeStudent({ id: "S" + y + String(i + 1).padStart(4, "0"), city: pl.city, district: pl.district, state: pl.state,
          school, course: pick(DEMO_COURSES), enquiry: between(enqStart, enqEnd), stageIdx }));
      }
    });
    return { campaigns, students };
  }

  // ============ Data preparation ============
  // Each student is linked to the most recent visit or event at their school before enquiry.
  // No attribution window is applied; the lag is shown instead.
  function attributeAll() {
    const touch = new Map(), area = new Map();
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    state.campaigns.forEach(c => {
      if ((c.channel === CH.VISIT || c.channel === CH.EVENT) && c.key) push(touch, c.season + "|" + c.key, c);
      if (c.channel === CH.ADS || c.channel === CH.MEDIA) push(area, c.season + "|" + c.city, c);
    });
    touch.forEach(list => list.sort((a, b) => a.date - b.date));

    state.students.forEach(s => {
      const none = { level: "Unattributed", channel: NONE, faculty: "", campaignId: "", lastDays: null, firstDays: null, touches: 0 };
      if (s.key) {
        const prior = (touch.get(s.season + "|" + s.key) || []).filter(c => c.date <= s.enquiry);
        if (prior.length) {
          const last = prior[prior.length - 1];
          s.att = {
            level: "School contact", channel: last.channel, faculty: last.faculty, campaignId: last.id,
            lastDays: daysBetween(last.date, s.enquiry), firstDays: daysBetween(prior[0].date, s.enquiry), touches: prior.length,
          };
          return;
        }
      }
      const areaHit = (area.get(s.season + "|" + s.city) || []).some(c => c.date <= s.enquiry);
      s.att = areaHit ? Object.assign({}, none, { level: "Area only", channel: AREA }) : none;
    });
  }

  // Everything derived from the raw rows, computed once after each load
  function prepare() {
    state.raw = new Map();
    const note = (k, name) => {
      if (!k) return;
      if (!state.raw.has(k)) state.raw.set(k, new Map());
      const m = state.raw.get(k);
      m.set(name, (m.get(name) || 0) + 1);
    };
    state.campaigns.forEach(c => note(c.key, c.school));
    state.students.forEach(s => note(s.key, s.school));

    attributeAll();

    state.bySeason = new Map();
    const slot = s => {
      if (!state.bySeason.has(s)) state.bySeason.set(s, { campaigns: [], students: [] });
      return state.bySeason.get(s);
    };
    state.campaigns.forEach(c => slot(c.season).campaigns.push(c));
    state.students.forEach(s => slot(s.season).students.push(s));
    state.seasons = [...state.bySeason.keys()].sort().reverse();

    state.credit = new Map();
    state.facultySeason = new Map();
    state.students.forEach(s => {
      const id = s.att.campaignId;
      if (id) {
        const e = state.credit.get(id) || { enq: 0, adm: 0, enr: 0 };
        e.enq++;
        if (s.stageIdx >= 2) e.adm++;
        if (s.stageIdx >= 4) e.enr++;
        state.credit.set(id, e);
      }
      const fac = s.att.faculty;
      if (fac) {
        if (!state.facultySeason.has(fac)) state.facultySeason.set(fac, new Map());
        const bySeason = state.facultySeason.get(fac);
        const e = bySeason.get(s.season) || { enq: 0, adm: 0 };
        e.enq++;
        if (s.stageIdx >= 2) e.adm++;
        bySeason.set(s.season, e);
      }
    });
    state.faculty = [...new Set([...state.campaigns.map(c => c.faculty), ...state.facultySeason.keys()].filter(Boolean))].sort();

    if (!state.filters.season || !state.seasons.includes(state.filters.season)) {
      state.filters.season = state.seasons[0] || "";
    }
  }

  function schoolName(k) {
    const m = state.raw.get(k);
    if (!m) return k;
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  function placeKey(r) { return r.state + "|" + r.district; }

  // Records that match the sidebar filters
  function filtered() {
    const f = state.filters;
    const inRange = d => (!f.from || d >= f.from) && (!f.to || d <= f.to);
    const students = state.students.filter(s =>
      (!f.season || s.season === f.season) && (!f.district || s.district === f.district) &&
      (!f.course || s.course === f.course) && (!f.channel || s.att.channel === f.channel) && inRange(s.enquiry));
    const campaigns = state.campaigns.filter(c =>
      (!f.season || c.season === f.season) && (!f.district || c.district === f.district) &&
      (!f.channel || c.channel === f.channel) && inRange(c.date));
    return { students, campaigns };
  }

  function summarize(students, spend) {
    const count = k => students.filter(s => s.stageIdx >= k).length;
    const admitted = count(2), enrolled = count(4);
    return {
      n: students.length, applied: count(1), admitted, feePaid: count(3), enrolled, spend,
      cpa: admitted ? spend / admitted : null,
      cpe: enrolled ? spend / enrolled : null,
    };
  }

  function channelRows(f) {
    return GROUPS.map(g => {
      const campaigns = f.campaigns.filter(c => g.channels.includes(c.channel));
      const spend = sumBy(campaigns, c => c.cost);
      return { group: g, label: g.label, campaigns, spend, S: summarize(f.students.filter(s => s.att.channel === g.attr), spend) };
    });
  }

  function districtRows(f) {
    const map = new Map();
    const get = r => {
      const k = placeKey(r);
      if (!map.has(k)) map.set(k, { district: r.district, state: r.state, visits: 0, events: 0, adsMedia: 0, visited: false, students: [] });
      return map.get(k);
    };
    f.campaigns.forEach(c => {
      const p = get(c);
      if (c.channel === CH.VISIT) { p.visits++; p.visited = true; }
      else if (c.channel === CH.EVENT) { p.events++; p.visited = true; }
      else p.adsMedia++;
    });
    f.students.forEach(s => get(s).students.push(s));
    return [...map.values()].map(p => {
      const adm = p.students.filter(s => s.stageIdx >= 2);
      return Object.assign(p, {
        enquiries: p.students.length,
        admitted: adm.length,
        school: adm.filter(s => s.att.level === "School contact").length,
        ads: adm.filter(s => s.att.level === "Area only").length,
        none: adm.filter(s => s.att.level === "Unattributed").length,
      });
    });
  }

  function facultyRows(f) {
    const people = new Map();
    const get = n => {
      if (!people.has(n)) people.set(n, { name: n, visits: 0, events: 0, inState: 0, outState: 0, schools: new Set(), places: new Set(), spend: 0, credited: [] });
      return people.get(n);
    };
    f.campaigns.forEach(c => {
      if (!c.faculty || (c.channel !== CH.VISIT && c.channel !== CH.EVENT)) return;
      const p = get(c.faculty);
      p.spend += c.cost;
      p.places.add(placeKey(c));
      if (c.key) p.schools.add(c.key);
      if (c.channel === CH.VISIT) {
        p.visits++;
        if (c.state === HOME_STATE) p.inState++; else p.outState++;
      } else p.events++;
    });
    f.students.forEach(s => { if (s.att.faculty) get(s.att.faculty).credited.push(s); });
    return [...people.values()].map(p => {
      const S = summarize(p.credited, p.spend);
      return Object.assign(p, {
        institutions: p.schools.size, districts: p.places.size,
        enquiries: S.n, admitted: S.admitted, enrolled: S.enrolled,
        rate: S.n ? S.admitted / S.n : null, cpa: S.cpa,
        medianDays: median(p.credited.map(s => s.att.lastDays)),
      });
    }).sort((a, b) => b.admitted - a.admitted || b.enquiries - a.enquiries || b.visits - a.visits);
  }

  function seasonSummary(season) {
    const bucket = state.bySeason.get(season) || { campaigns: [], students: [] };
    const spend = sumBy(bucket.campaigns, c => c.cost);
    const visited = bucket.campaigns.filter(c => c.channel === CH.VISIT || c.channel === CH.EVENT);
    const byDistrict = new Map();
    bucket.students.forEach(s => {
      const k = placeKey(s);
      const e = byDistrict.get(k) || { name: s.district, count: 0 };
      e.count++;
      byDistrict.set(k, e);
    });
    return {
      season, spend, S: summarize(bucket.students, spend), byDistrict,
      visits: bucket.campaigns.filter(c => c.channel === CH.VISIT).length,
      events: bucket.campaigns.filter(c => c.channel === CH.EVENT).length,
      districts: new Set(visited.map(placeKey)).size,
      states: new Set(visited.map(c => c.state)).size,
    };
  }

  // ============ Building blocks ============
  function kpi(label, value, sub) {
    return h("div", { class: "kpi" },
      h("div", { class: "kpi-label" }, label),
      h("div", { class: "kpi-value" }, value),
      sub ? h("div", { class: "kpi-sub" }, sub) : null);
  }
  const kpis = items => h("div", { class: "kpis" }, items);
  const card = (title, ...body) => h("section", { class: "card" }, h("h3", { class: "card-title" }, title), ...body);
  const page = (...body) => h("div", { class: "view" }, ...body);
  const emptyNote = text => h("p", { class: "note" }, text);

  // Horizontal bars: rows of { label, value, text }
  function bars(rows) {
    if (!rows.length) return emptyNote("No records in the current filters.");
    const max = Math.max(1, ...rows.map(r => r.value));
    return h("div", null, rows.map(r => {
      const fill = h("div", { class: "bar-fill" });
      fill.style.width = (r.value / max) * 100 + "%";
      return h("div", { class: "bar-row" }, h("div", null, r.label), h("div", { class: "bar-track" }, fill), h("div", { class: "bar-value" }, r.text));
    }));
  }

  // Stacked horizontal bars: rows of { label, values[], text }; parts of { label, cls }
  function stacked(rows, parts) {
    if (!rows.length) return emptyNote("No admissions in the current filters.");
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

  function legend(items) {
    return h("div", { class: "legend" }, items.map(i => {
      const sw = h("span", { class: "swatch" });
      sw.style.background = i.color;
      return h("span", { class: "legend-item" }, sw, i.label);
    }));
  }

  // Vertical columns: points of { label, value, text }
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

  // Pie chart: slices of { label, value }. Colours are set through the CSS object model.
  function pie(slices) {
    const tot = sumBy(slices, s => s.value);
    if (!tot) return emptyNote("No enquiries in the current filters.");
    let acc = 0;
    const stops = slices.map((s, i) => {
      const a = (acc / tot) * 100;
      acc += s.value;
      return `${PIE[i % PIE.length]} ${a}% ${(acc / tot) * 100}%`;
    });
    const disc = h("div", { class: "pie", "aria-hidden": "true" });
    disc.style.background = `conic-gradient(${stops.join(", ")})`;
    const list = h("div", { class: "pie-legend" }, slices.map((s, i) => {
      const sw = h("span", { class: "swatch" });
      sw.style.background = PIE[i % PIE.length];
      return h("div", { class: "pie-row" }, sw, h("span", { class: "pie-name" }, s.label),
        h("span", { class: "pie-val" }, `${num(s.value)} · ${Math.round((s.value / tot) * 100)}%`));
    }));
    return h("div", { class: "pie-wrap" }, disc, list);
  }

  // Small trend line as SVG
  function sparkline(values) {
    const NS = "http://www.w3.org/2000/svg";
    const W = 170, H = 40, pad = 5;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "spark");
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
    line.setAttribute("pathLength", "1");
    line.setAttribute("class", "spark-line");
    svg.appendChild(line);
    values.forEach((v, i) => {
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", xs(i));
      dot.setAttribute("cy", ys(v));
      dot.setAttribute("r", "3");
      dot.setAttribute("fill", "#0B2D5B");
      dot.setAttribute("class", "spark-dot");
      svg.appendChild(dot);
    });
    return svg;
  }

  // Table: rows are arrays of cell values. onRowClick(index) makes rows clickable.
  function table(headers, rows, onRowClick) {
    return h("div", { class: "table-wrap" },
      h("table", null,
        h("thead", null, h("tr", null, headers.map(x => h("th", null, x)))),
        h("tbody", null, rows.length
          ? rows.map((r, i) => h("tr", onRowClick ? { class: "clickable", onclick: () => onRowClick(i) } : null,
              r.map(c => h("td", null, c))))
          : h("tr", null, h("td", { colspan: headers.length }, "No records match the current filters")))));
  }

  // Percentage change with an arrow; "—" when it cannot be calculated
  function change(p, c) {
    if (p === null || c === null || p === undefined || c === undefined) return "—";
    if (!p) return c ? "New" : "—";
    const d = (c - p) / p;
    if (Math.round(d * 100) === 0) return "No change";
    return (d > 0 ? "▲ " : "▼ ") + Math.abs(Math.round(d * 100)) + "%";
  }

  const MARKETING_PARTS = [
    { label: "Via school visit or event", cls: "seg-school", color: "#0B2D5B" },
    { label: "Via ads or media (indicative)", cls: "seg-ads", color: "#6F8FB8" },
    { label: "No marketing link found", cls: "seg-none", color: "#C9D0DB" },
  ];

  // ============ Views ============
  function viewOverview(f) {
    const spend = sumBy(f.campaigns, c => c.cost);
    const S = summarize(f.students, spend);
    const linked = f.students.filter(s => s.att.level === "School contact").length;
    const visited = f.campaigns.filter(c => c.channel === CH.VISIT || c.channel === CH.EVENT);
    const states = new Set(visited.map(c => c.state));
    const districts = new Set(visited.map(placeKey));
    const schools = new Set(visited.map(c => c.key).filter(Boolean));

    const byState = new Map();
    f.students.forEach(s => byState.set(s.state, (byState.get(s.state) || 0) + 1));
    const ranked = [...byState.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
    const slices = ranked.length > 6
      ? [...ranked.slice(0, 5), { label: "Other states", value: sumBy(ranked.slice(5), x => x.value) }]
      : ranked;

    const funnel = [
      { label: "Enquired", value: S.n }, { label: "Applied", value: S.applied }, { label: "Admitted", value: S.admitted },
      { label: "Fee paid", value: S.feePaid }, { label: "Enrolled", value: S.enrolled },
    ].map(x => ({ label: x.label, value: x.value, text: `${num(x.value)} · ${pct(x.value, S.n)}` }));

    return page(
      kpis([
        kpi("Enquiries", num(S.n), `${pct(linked, S.n)} linked to a school visit or event`),
        kpi("Admitted", num(S.admitted), `${pct(S.admitted, S.n)} of enquiries`),
        kpi("Enrolled", num(S.enrolled), `${pct(S.enrolled, S.n)} of enquiries`),
        kpi("Total spend", inr(spend), S.cpa ? `${inr(S.cpa)} per admission` : "No admissions yet"),
      ]),
      kpis([
        kpi("States covered", num(states.size), "With a visit or event"),
        kpi("Districts covered", num(districts.size), "With a visit or event"),
        kpi("Schools covered", num(schools.size), "Visited or invited to an event"),
        kpi("Visits and events", num(visited.length), `${num(f.campaigns.filter(c => c.channel === CH.VISIT).length)} visits`),
      ]),
      h("div", { class: "grid-2" },
        card("Enquiries by state", pie(slices)),
        card("Admission funnel", bars(funnel))),
      card("Spend by channel", bars(channelRows(f).map(r => ({ label: r.label, value: r.spend, text: inr(r.spend) })))));
  }

  function viewLocations(f) {
    const rows = districtRows(f);
    const visited = rows.filter(r => r.visited).sort((a, b) => b.enquiries - a.enquiries);
    const others = rows.filter(r => !r.visited).sort((a, b) => b.enquiries - a.enquiries);
    const stateSet = new Set(visited.map(r => r.state));
    const enqAll = sumBy(rows, r => r.enquiries);
    const enqVisited = sumBy(visited, r => r.enquiries);
    const admAll = sumBy(rows, r => r.admitted);
    const linkedAdm = sumBy(rows, r => r.school + r.ads);
    const top = visited.slice(0, TOP);
    const topAdm = rows.filter(r => r.admitted > 0).sort((a, b) => b.admitted - a.admitted).slice(0, TOP);

    return page(
      kpis([
        kpi("Districts visited", num(visited.length), `${num(others.length)} other districts sent enquiries`),
        kpi("States visited", num(stateSet.size), [...stateSet].slice(0, 3).join(", ") || "—"),
        kpi("Enquiries from visited districts", num(enqVisited), `${pct(enqVisited, enqAll)} of all enquiries`),
        kpi("Admissions with a marketing link", pct(linkedAdm, admAll), `${num(sumBy(rows, r => r.school))} school-linked · ${num(sumBy(rows, r => r.ads))} ads-linked`),
      ]),
      h("div", { class: "grid-2" },
        card(`Enquiries by visited district (top ${TOP})`, bars(top.map(r => ({
          label: r.district, value: r.enquiries, text: `${num(r.enquiries)} · ${r.visits + r.events} visits`,
        })))),
        card(`Admissions by origin (top ${TOP} districts)`,
          stacked(topAdm.map(r => ({
            label: r.district, values: [r.school, r.ads, r.none],
            text: `${num(r.admitted)} · ${pct(r.school + r.ads, r.admitted)} linked`,
          })), MARKETING_PARTS),
          legend(MARKETING_PARTS))),
      card("All districts",
        table(
          ["District", "State", "Visited", "Visits", "Events", "Ads / media", "Enquiries", "Admitted", "Admit rate", "School-linked", "Ads-linked", "No link"],
          [...visited, ...others].map(r => [
            r.district, r.state, r.visited ? "Yes" : "No", r.visits, r.events, r.adsMedia,
            num(r.enquiries), num(r.admitted), pct(r.admitted, r.enquiries), num(r.school), num(r.ads), num(r.none),
          ])),
        emptyNote("Visited means at least one teacher visit or event in the selected season. Admissions with no link are not proof of organic enrolment; they only mean no marketing record matched.")));
  }

  function viewSeasons() {
    const all = state.seasons.slice().reverse(); // oldest first
    if (all.length < 2) {
      return page(card("Season comparison", emptyNote("Load at least two seasons in Data & import to compare them. Each row's date decides its season.")));
    }
    const base = state.compareSeasons === null ? all : state.compareSeasons.filter(s => all.includes(s));
    const selected = base.slice().sort();
    if (!selected.length) return page(card("Season comparison", emptyNote("Select at least one season above.")));

    const metric = METRICS.find(m => m.key === state.compareMetric) || METRICS[0];
    const sums = selected.map(seasonSummary);
    const span = vals => (selected.length < 2 ? "—" : change(vals[0], vals[vals.length - 1]));

    const toggle = (label, active, onclick) => h("button", { type: "button", class: "chip" + (active ? " on" : ""), "data-key": label, onclick }, label);
    const seasonChips = h("div", { class: "chips" }, all.map(s => toggle(season(s), selected.includes(s), () => {
      const next = selected.includes(s) ? selected.filter(x => x !== s) : [...selected, s];
      state.compareSeasons = next.length ? next : selected;
      render();
    })));
    const preset = (label, active, onclick) => h("button", { type: "button", class: "seg-btn" + (active ? " on" : ""), onclick }, label);
    // A preset is highlighted when the selected seasons are exactly its latest seasons
    const isLast = n => state.compareSeasons !== null && selected.length === Math.min(n, all.length)
      && all.slice(-n).every(x => selected.includes(x));
    const presets = h("div", { class: "segmented", "data-glide": "season-presets" },
      h("span", { class: "seg-thumb", "aria-hidden": "true" }),
      preset("All seasons", state.compareSeasons === null, () => { state.compareSeasons = null; render(); }),
      preset("Last 3", isLast(3), () => { state.compareSeasons = all.slice(-3); render(); }),
      preset("Last 5", isLast(5), () => { state.compareSeasons = all.slice(-5); render(); }),
      preset("Last 10", isLast(10), () => { state.compareSeasons = all.slice(-10); render(); }));

    const measure = h("select", { onchange: e => { state.compareMetric = e.target.value; render(); } },
      METRICS.map(m => h("option", { value: m.key, selected: m.key === metric.key ? true : null }, m.label)));

    const values = sums.map(s => metric.get(s));
    const chart = columns(sums.map((s, i) => ({ label: season(s.season), value: values[i] || 0, text: metric.fmt(values[i]) })));

    // District enquiries across the selected seasons, shaded by volume
    const keys = new Set();
    sums.forEach(s => s.byDistrict.forEach((_, k) => keys.add(k)));
    const districts = [...keys].map(k => {
      const v = sums.map(s => (s.byDistrict.get(k) || { count: 0 }).count);
      const name = (sums.map(s => s.byDistrict.get(k)).find(Boolean) || { name: k }).name;
      return { name, v, total: sumBy(v, x => x) };
    }).sort((a, b) => b.total - a.total).slice(0, TOP);
    const maxCell = Math.max(1, ...districts.flatMap(r => r.v));
    const heat = h("div", { class: "table-wrap" },
      h("table", null,
        h("thead", null, h("tr", null, ["District", ...selected.map(season), "Change"].map(x => h("th", null, x)))),
        h("tbody", null, districts.map(r => h("tr", null,
          h("td", { class: "text" }, r.name),
          r.v.map(x => {
            const td = h("td", null, num(x));
            td.style.background = `rgba(11, 45, 91, ${((x / maxCell) * 0.4).toFixed(3)})`;
            return td;
          }),
          h("td", null, span(r.v)))))));

    return page(
      card("Seasons to compare",
        h("div", { class: "control-group" }, h("span", { class: "control-label" }, "Pick seasons"), seasonChips),
        h("div", { class: "control-group" }, h("span", { class: "control-label" }, "Quick select"), presets),
        emptyNote(`Comparing ${selected.length} season(s): ${selected.map(season).join(", ")}.`)),
      card(`${metric.label} by season`,
        h("div", { class: "toolbar" }, h("label", { class: "field" }, "Measure", measure)),
        chart),
      card("All measures",
        table(["Measure", ...selected.map(season), "Change (first → last)"],
          METRICS.map(m => {
            const v = sums.map(s => m.get(s));
            return [m.label, ...v.map(x => m.fmt(x)), span(v)];
          }))),
      card(`Top ${TOP} districts by enquiries`, heat,
        emptyNote("Darker cells mean more enquiries in that season.")),
      emptyNote("Season comparisons use full seasons and ignore the district, channel, course and date filters. Change compares the first and last selected seasons."));
  }

  function viewFaculty(f) {
    return state.facultySel ? facultyDetail(f, state.facultySel) : facultyList(f);
  }

  function facultyList(f) {
    const rows = facultyRows(f);
    const listBox = h("div");
    const fill = q => {
      const term = q.trim().toLowerCase();
      const shown = rows.filter(x => !term || x.name.toLowerCase().includes(term));
      listBox.replaceChildren(table(
        ["Faculty", "Institutions visited", "Visits", "Events", "Districts", "Enquiries credited", "Admitted", "Admit rate"],
        shown.map(x => [x.name, x.institutions, x.visits, x.events, x.districts, num(x.enquiries), num(x.admitted), pct(x.admitted, x.enquiries)]),
        i => { state.facultySel = shown[i].name; render(); }));
    };
    fill("");

    const seasons = state.seasons.slice().reverse();
    const trend = [...state.facultySeason.entries()].map(([name, m]) => {
      const v = seasons.map(s => (m.get(s) || { adm: 0 }).adm);
      return { name, v, total: sumBy(v, x => x) };
    }).sort((a, b) => b.total - a.total);

    return page(
      card("Faculty",
        h("div", { class: "toolbar" },
          h("input", { type: "search", class: "search", placeholder: "Search faculty name", "aria-label": "Search faculty by name", oninput: e => fill(e.target.value) }),
          emptyNote(`${rows.length} faculty in the current filters. Select a name to open their details.`)),
        listBox),
      card("Admitted students credited, by season",
        seasons.length < 2
          ? emptyNote("Load at least two seasons to see the trend.")
          : h("div", { class: "table-wrap" },
              h("table", null,
                h("thead", null, h("tr", null, ["Faculty", "Trend", ...seasons.map(season), "Change (first → last)"].map(x => h("th", null, x)))),
                h("tbody", null, trend.map(r => h("tr", { class: "clickable", onclick: () => { state.facultySel = r.name; render(); } },
                  h("td", { class: "text" }, r.name),
                  h("td", null, sparkline(r.v)),
                  r.v.map(x => h("td", null, num(x))),
                  h("td", null, change(r.v[0], r.v[r.v.length - 1]))))))),
        emptyNote("Trends use all loaded seasons and ignore the filters. Select a row to open that person's details.")),
      emptyNote("Individual performance is for review by college administration only. Figures describe enquiries and marketing activity, and should not be used alone to judge a person's work."));
  }

  function facultyDetail(f, name) {
    const back = h("button", { class: "btn btn-ghost", type: "button", onclick: () => { state.facultySel = ""; render(); } }, "← All faculty");
    const chips = h("div", { class: "chips" });
    const search = h("input", {
      type: "search", class: "search", placeholder: "Search another faculty name", "aria-label": "Search faculty by name",
      oninput: e => {
        const t = e.target.value.trim().toLowerCase();
        const matches = t ? state.faculty.filter(n => n.toLowerCase().includes(t)).slice(0, 8) : [];
        chips.replaceChildren(...matches.map(n => h("button", { type: "button", class: "chip", onclick: () => { state.facultySel = n; render(); } }, n)));
      },
    });
    const header = card(name, h("div", { class: "toolbar" }, back, search, chips));

    const person = facultyRows(f).find(x => x.name === name);
    if (!person) return page(header, emptyNote(`${name} has no visits, events or credited enquiries in the current filters.`));

    const seasons = state.seasons.slice().reverse();
    const bySeason = state.facultySeason.get(name) || new Map();
    const visitsBy = new Map();
    f.campaigns.filter(c => c.faculty === name).forEach(c => {
      const e = visitsBy.get(c.season) || { visits: 0, events: 0 };
      if (c.channel === CH.VISIT) e.visits++; else if (c.channel === CH.EVENT) e.events++;
      visitsBy.set(c.season, e);
    });

    const schools = new Map();
    f.campaigns.filter(c => c.faculty === name && c.key && (c.channel === CH.VISIT || c.channel === CH.EVENT)).forEach(c => {
      const e = schools.get(c.key) || { visits: 0, events: 0, last: null, district: c.district, state: c.state };
      if (c.channel === CH.VISIT) e.visits++; else e.events++;
      if (!e.last || c.date > e.last) e.last = c.date;
      schools.set(c.key, e);
    });
    const schoolRows = [...schools.entries()].sort((a, b) => (b[1].visits + b[1].events) - (a[1].visits + a[1].events)).map(([key, e]) => {
      const credited = person.credited.filter(s => s.key === key);
      return [schoolName(key), e.visits, e.events, e.district, e.state, fmtDate(e.last), num(credited.length), num(credited.filter(s => s.stageIdx >= 2).length)];
    });

    const log = f.campaigns.filter(c => c.faculty === name && (c.channel === CH.VISIT || c.channel === CH.EVENT)).sort((a, b) => a.date - b.date);

    return page(
      header,
      kpis([
        kpi("Institutions visited", num(person.institutions), `${person.districts} districts`),
        kpi("Visits", num(person.visits), `${person.inState} in-state · ${person.outState} out-of-state`),
        kpi("Enquiries credited", num(person.enquiries), `Median ${days(person.medianDays)} after the visit`),
        kpi("Admitted", num(person.admitted), `${person.rate === null ? "—" : Math.round(person.rate * 100) + "%"} admit rate`),
      ]),
      card("Results by season",
        table(["Season", "Visits", "Events", "Enquiries credited", "Admitted"],
          seasons.map(s => {
            const v = visitsBy.get(s) || { visits: 0, events: 0 };
            const e = bySeason.get(s) || { enq: 0, adm: 0 };
            return [season(s), v.visits, v.events, num(e.enq), num(e.adm)];
          }))),
      card("Institutions visited", table(["School / college", "Visits", "Events", "District", "State", "Last contact", "Enquiries credited", "Admitted"], schoolRows)),
      card("Visit log", table(["Date", "Type", "School / college", "District", "State", "Cost", "Enquiries credited", "Admitted", "Enrolled"],
        log.map(c => {
          const e = state.credit.get(c.id) || { enq: 0, adm: 0, enr: 0 };
          return [fmtDate(c.date), c.subtype || c.channel, c.school || "—", c.district, c.state, inr(c.cost), num(e.enq), num(e.adm), num(e.enr)];
        }))));
  }

  function viewChannels(f) {
    if (state.drill) {
      const g = GROUPS.find(x => x.label === state.drill);
      if (g) return channelDetail(f, g);
      state.drill = null;
    }
    const rows = channelRows(f);
    return page(
      card("Channel performance",
        table(["Channel", "Campaigns", "Spend", "Students", "Admitted", "Enrolled", "Cost per admission", "Cost per enrolment"],
          rows.map(r => [r.label, r.campaigns.length, inr(r.spend), num(r.S.n), num(r.S.admitted), num(r.S.enrolled),
            r.S.cpa ? inr(r.S.cpa) : "—", r.S.cpe ? inr(r.S.cpe) : "—"]),
          i => { state.drill = GROUPS[i].label; render(); }),
        emptyNote("Click a channel to see each visit, event or ad. Students are assigned to their most recent school visit or event before enquiry. Ads and media are matched by city only, so their figures are indicative.")));
  }

  function channelDetail(f, g) {
    const back = h("button", { class: "btn btn-ghost", type: "button", onclick: () => { state.drill = null; render(); } }, "← All channels");
    const camps = f.campaigns.filter(c => g.channels.includes(c.channel))
      .sort((a, b) => a.date - b.date || String(a.faculty).localeCompare(String(b.faculty)));
    const spend = sumBy(camps, c => c.cost);
    const header = card(g.label, h("div", { class: "toolbar" }, back));

    if (g.attr === AREA) {
      const byDistrict = new Map();
      f.students.forEach(s => {
        if (!byDistrict.has(s.district)) byDistrict.set(s.district, []);
        byDistrict.get(s.district).push(s);
      });
      const after = c => (byDistrict.get(c.district) || []).filter(s => s.enquiry >= c.date);
      const totalAfter = sumBy(camps, c => after(c).length);
      return page(header,
        kpis([
          kpi("Campaigns", num(camps.length), g.label),
          kpi("Spend", inr(spend), `${new Set(camps.map(c => c.district)).size} districts`),
          kpi("Enquiries after", num(totalAfter), "In the same districts (indicative)"),
          kpi("Cost per enquiry", totalAfter ? inr(spend / totalAfter) : "—", "Indicative only"),
        ]),
        card("Each ad and media piece",
          table(["Date", "Channel", "Format", "City", "District", "State", "Cost", "Enquiries after", "Admitted after"],
            camps.map(c => {
              const list = after(c);
              return [fmtDate(c.date), c.channel, c.subtype || "—", c.city, c.district, c.state, inr(c.cost),
                num(list.length), num(list.filter(s => s.stageIdx >= 2).length)];
            }))));
    }

    // Visits and events: who went where
    const credit = new Map();
    f.students.forEach(s => {
      const id = s.att.campaignId;
      if (!id) return;
      const e = credit.get(id) || { enq: 0, adm: 0 };
      e.enq++;
      if (s.stageIdx >= 2) e.adm++;
      credit.set(id, e);
    });
    const byFaculty = new Map();
    camps.forEach(c => {
      const name = c.faculty || NOT_RECORDED;
      const e = byFaculty.get(name) || { count: 0, schools: new Set(), districts: new Set(), spend: 0 };
      e.count++;
      if (c.key) e.schools.add(c.key);
      e.districts.add(placeKey(c));
      e.spend += c.cost;
      byFaculty.set(name, e);
    });

    return page(header,
      kpis([
        kpi("Campaigns", num(camps.length), g.label),
        kpi("Spend", inr(spend), `${new Set(camps.map(c => c.district)).size} districts`),
        kpi("Institutions", num(new Set(camps.map(c => c.key).filter(Boolean)).size), `${byFaculty.size} faculty members`),
        kpi("Enquiries credited", num(sumBy(camps, c => (credit.get(c.id) || { enq: 0 }).enq)), "Matched by school name"),
      ]),
      card("Faculty and where they went",
        table(["Faculty", "Visits / events", "Institutions", "Districts", "Spend"],
          [...byFaculty.entries()].sort((a, b) => b[1].count - a[1].count)
            .map(([name, e]) => [name, e.count, e.schools.size, e.districts.size, inr(e.spend)]))),
      card("Each visit or event",
        table(["Date", "Faculty", "Type", "School / college", "District", "State", "Cost", "Enquiries credited", "Admitted"],
          camps.map(c => {
            const e = credit.get(c.id) || { enq: 0, adm: 0 };
            return [fmtDate(c.date), c.faculty || "—", c.subtype || c.channel, c.school || "—", c.district, c.state, inr(c.cost), num(e.enq), num(e.adm)];
          }))));
  }

  function viewTiming(f) {
    const linked = f.students.filter(s => s.att.level === "School contact");
    const buckets = LAG.map(([lo, hi, label]) => {
      const list = linked.filter(s => s.att.lastDays >= lo && s.att.lastDays <= hi);
      return { label, n: list.length, adm: list.filter(s => s.stageIdx >= 2).length };
    });
    const keys = new Set([...f.campaigns.map(c => c.key), ...f.students.map(s => s.key)].filter(Boolean));
    const schoolRows = [...keys].map(k => {
      const camps = f.campaigns.filter(c => c.key === k);
      const studs = f.students.filter(s => s.key === k);
      const lk = studs.filter(s => s.att.level === "School contact");
      return {
        name: schoolName(k),
        visits: camps.filter(c => c.channel === CH.VISIT).length,
        events: camps.filter(c => c.channel === CH.EVENT).length,
        spend: sumBy(camps, c => c.cost),
        enq: studs.length,
        adm: studs.filter(s => s.stageIdx >= 2).length,
        lastMed: median(lk.map(s => s.att.lastDays)),
        firstMed: median(lk.map(s => s.att.firstDays)),
      };
    }).sort((a, b) => b.enq - a.enq || b.visits - a.visits);

    return page(
      kpis([
        kpi("Students linked to a school", num(linked.length), `${pct(linked.length, f.students.length)} of enquiries`),
        kpi("Median days since last contact", days(median(linked.map(s => s.att.lastDays))), "Latest visit or event before enquiry"),
        kpi("Median days since first contact", days(median(linked.map(s => s.att.firstDays))), "Earliest visit or event before enquiry"),
        kpi("Median contacts before enquiry", median(linked.map(s => s.att.touches)) ?? "—", "Visits and events at the same school"),
      ]),
      h("div", { class: "grid-2" },
        card("Days from last school contact to enquiry", bars(buckets.map(b => ({ label: b.label, value: b.n, text: `${num(b.n)} · ${num(b.adm)} admitted` })))),
        card("Admission rate by timing", table(["Days since last contact", "Students", "Admitted", "Admit rate"],
          buckets.map(b => [b.label, num(b.n), num(b.adm), pct(b.adm, b.n)])))),
      card("Institution-wise timing",
        table(["School / college", "Visits", "Events", "Spend", "Enquiries", "Admitted", "Median days since last contact", "Median days since first contact"],
          schoolRows.map(r => [r.name, r.visits, r.events, inr(r.spend), num(r.enq), num(r.adm), days(r.lastMed), days(r.firstMed)])),
        emptyNote("No attribution window is applied, so every earlier visit or event is shown with its lag.")));
  }

  function viewStudents(f) {
    const sorted = f.students.slice().sort((a, b) => b.enquiry - a.enquiry);
    return page(
      card(`Students (${num(sorted.length)} in the current filters)`,
        table(["ID", "Enquiry date", "City", "District", "School / college", "Course", "Status", "Attribution", "Channel", "Faculty", "Days since last contact", "Contacts"],
          sorted.slice(0, 200).map(s => [
            s.id, fmtDate(s.enquiry), s.city, s.district, s.school || "—", s.course, STAGES[s.stageIdx],
            s.att.level, s.att.channel, s.att.faculty || "—", s.att.lastDays === null ? "—" : s.att.lastDays, s.att.touches,
          ])),
        emptyNote(sorted.length > 200 ? "The first 200 rows are shown. Use the filters to narrow the list." : "Students are identified by pseudonymous ID only.")));
  }

  // ============ Saving and backup ============
  // Working data is kept in this browser (IndexedDB). The downloaded backup file is the
  // reliable copy, because browsers and IT policies can clear site storage.
  const DB_NAME = "admissions-insights";
  const DB_STORE = "data";
  const DB_KEY = "working";
  const BACKUP_FORMAT = "admissions-insights-backup";

  const ACCOUNT_STORE = "accounts";
  const SETTINGS_STORE = "settings";

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        [DB_STORE, ACCOUNT_STORE, SETTINGS_STORE].forEach(name => {
          if (req.result.objectStoreNames.contains(name)) return;
          req.result.createObjectStore(name, name === ACCOUNT_STORE ? { keyPath: "username" } : undefined);
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbRun(store, mode, action) {
    return openDB().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = action(tx.objectStore(store));
      tx.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    }));
  }

  // Local calendar date as YYYY-MM-DD (avoids the UTC shift of toISOString in India)
  const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const uid = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function toBackup() {
    return {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      isDemo: state.isDemo,
      campaigns: state.store.campaigns.map(c => ({
        id: c.id, channel: c.channel, subtype: c.subtype, date: ymd(c.date), school: c.school,
        city: c.city, district: c.district, state: c.state, cost: c.cost, faculty: c.faculty, manual: !!c.manual,
      })),
      students: state.store.students.map(s => ({
        id: s.id, city: s.city, district: s.district, state: s.state, school: s.school,
        course: s.course, enquiry: ymd(s.enquiry), stageIdx: s.stageIdx, manual: !!s.manual,
      })),
    };
  }

  // Validates a backup and rebuilds the records. Throws a readable error when the file is not usable.
  function fromBackup(data) {
    if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.campaigns) || !Array.isArray(data.students)) {
      throw new Error("This file is not an Admissions Insights backup.");
    }
    const campaigns = data.campaigns.map(r => {
      const channel = Object.values(CH).includes(r.channel) ? r.channel : normChannel(r.channel);
      const date = parseDate(r.date);
      if (!channel || !date) throw new Error("The backup has an invalid activity row.");
      return makeCampaign({
        id: String(r.id || uid("C")), channel, subtype: String(r.subtype || ""), date,
        school: String(r.school || ""), city: String(r.city || ""), district: String(r.district || ""),
        state: String(r.state || NOT_RECORDED), cost: Number(r.cost) || 0, faculty: String(r.faculty || ""),
        manual: !!r.manual,
      });
    });
    const students = data.students.map(r => {
      const enquiry = parseDate(r.enquiry);
      const stageIdx = Number(r.stageIdx);
      if (!enquiry || !(stageIdx >= 0 && stageIdx < STAGES.length)) throw new Error("The backup has an invalid student row.");
      return makeStudent({
        id: String(r.id || uid("S")), city: String(r.city || ""), district: String(r.district || ""),
        state: String(r.state || NOT_RECORDED), school: String(r.school || ""), course: String(r.course || ""),
        enquiry, stageIdx, manual: !!r.manual,
      });
    });
    return { campaigns, students, isDemo: !!data.isDemo, exportedAt: data.exportedAt || null };
  }

  function setData(data) {
    state.store = { campaigns: data.campaigns, students: data.students };
    state.isDemo = data.isDemo;
    applyScope();
  }

  function useDemo() {
    setData({ campaigns: state.demo.campaigns, students: state.demo.students, isDemo: true });
  }

  // Replaces the demo data the first time the user enters or restores their own records
  function ownData() {
    if (state.isDemo) { state.store = { campaigns: [], students: [] }; state.isDemo = false; }
  }

  function loadSaved() {
    return dbRun(DB_STORE, "readonly", s => s.get(DB_KEY)).catch(() => {
      state.saveFailed = true;
      return null;
    });
  }

  function saveText() {
    if (state.isDemo) return "Demo data is not saved. Enter or import your own records and they will be kept in this browser.";
    if (state.saveFailed) return "This browser cannot keep records between visits. Download a backup before you close the page.";
    if (state.savedAt) {
      const when = state.savedAt.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      return `Kept in this browser. Last saved ${when}.`;
    }
    return "Not saved yet.";
  }

  function updateSaveStatus() {
    const el = document.getElementById("save-status");
    if (el) el.textContent = saveText();
  }

  function persist() {
    const job = state.isDemo
      ? dbRun(DB_STORE, "readwrite", s => s.delete(DB_KEY)).then(() => { state.savedAt = null; })
      : dbRun(DB_STORE, "readwrite", s => s.put(toBackup(), DB_KEY)).then(() => { state.savedAt = new Date(); });
    return job
      .then(() => { state.saveFailed = false; })
      .catch(() => { state.saveFailed = true; })
      .then(updateSaveStatus);
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(toBackup(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: `admissions-backup-${ymd(new Date())}.json` });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function restoreFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return flash(`${file.name}: larger than 20 MB, so it is not a normal backup.`);
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = fromBackup(JSON.parse(String(reader.result)));
      } catch (e) {
        return flash(`${file.name}: ${e.message}`);
      }
      const parts = `${num(data.campaigns.length)} activity rows and ${num(data.students.length)} student rows`;
      if (!window.confirm(`Replace the current records with ${file.name} (${parts})?`)) return;
      setData(data);
      state.notice = `Restored ${file.name}: ${parts}.`;
      persist();
      render();
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!window.confirm("Delete all records held in this browser? Download a backup first if you need them.")) return;
    setData({ campaigns: [], students: [], isDemo: false });
    state.notice = "All records were deleted.";
    persist();
    render();
  }

  function removeRecord(kind, rec) {
    if (kind === "activity") state.store.campaigns = state.store.campaigns.filter(c => c !== rec);
    else state.store.students = state.store.students.filter(s => s !== rec);
    applyScope();
    state.notice = "Record removed.";
    persist();
    render();
  }

  // ============ Entering records by hand ============
  function coordinatorFaculty(r) {
    return state.user && state.user.role === "coordinator" ? state.user.faculty : r.faculty.trim();
  }

  function addActivity(r) {
    if (!r.channel || !r.date || !r.city.trim() || r.cost === "") return "Please fill in activity, date, city and cost.";
    if (!Object.values(CH).includes(r.channel)) return "Choose an activity from the list.";
    const date = parseDate(r.date);
    if (!date) return "The date is not valid.";
    const cost = Number(r.cost);
    if (!Number.isFinite(cost) || cost < 0) return "Cost must be zero or more, in rupees.";
    const city = titleCase(r.city);
    ownData();
    state.store.campaigns.push(makeCampaign({
      id: uid("C"), channel: r.channel, subtype: r.subtype.trim(), date,
      school: r.school.trim(), city, district: titleCase(r.district) || city,
      state: normState(r.state), cost, faculty: coordinatorFaculty(r), manual: true,
    }));
    return null;
  }

  function addStudent(r) {
    if (!r.city.trim() || !r.enquiry_date || !r.status) return "Please fill in city, enquiry date and status.";
    const stageIdx = STAGES.indexOf(r.status);
    if (stageIdx < 0) return "Choose a status from the list.";
    const enquiry = parseDate(r.enquiry_date);
    if (!enquiry) return "The enquiry date is not valid.";
    const city = titleCase(r.city);
    ownData();
    state.store.students.push(makeStudent({
      id: r.student_id.trim() || uid("S"), city, district: titleCase(r.district) || city,
      state: normState(r.state), school: r.school.trim(), course: r.course.trim(),
      enquiry, stageIdx, manual: true,
    }));
    return null;
  }

  // Saves a manual record, then refreshes every view and the backup status
  function afterEntry(error, message) {
    if (error) return error;
    applyScope();
    state.notice = message;
    persist();
    render();
    return null;
  }

  function viewEntry() {
    const field = (label, control, hint) => h("label", { class: "field" }, label, control, hint ? h("span", { class: "hint" }, hint) : null);
    const text = (name, placeholder, required) => h("input", { type: "text", name, placeholder, autocomplete: "off", required: required || null });
    const select = (name, options, required) => h("select", { name, required: required || null },
      h("option", { value: "" }, "Choose…"), options.map(o => h("option", { value: o }, o)));
    const dateIn = (name, required) => h("input", { type: "date", name, required: required || null });
    const numberIn = (name, placeholder) => h("input", { type: "number", name, min: "0", step: "1", placeholder, required: true });

    const entryForm = (onSubmit, ...fields) => {
      const msg = h("p", { class: "form-msg", role: "status" });
      const el = h("form", {
        class: "form-grid",
        onsubmit: e => {
          e.preventDefault();
          const err = onSubmit(Object.fromEntries(new FormData(el)));
          msg.dataset.state = err ? "error" : "";
          msg.textContent = err || "";
        },
      },
        fields,
        h("div", { class: "form-actions" },
          h("button", { class: "btn", type: "submit" }, "Save record"),
          h("span", { class: "hint" }, "Saved in this browser. Download a backup to keep a copy.")),
        msg);
      return el;
    };

    const coord = state.user && state.user.role === "coordinator";
    const facultyIn = coord
      ? h("input", { type: "text", name: "faculty", value: state.user.faculty, readonly: true, title: "Coordinators record activities under their own name" })
      : text("faculty", "Who made the visit or ran the event");
    const activityCard = card("Add an activity (visit, event, ad or media)",
      entryForm(data => afterEntry(addActivity(data), "Activity saved."),
        field("Activity", select("channel", Object.values(CH), true)),
        field("Type or detail", text("subtype", "e.g. In-state visit, Instagram")),
        field("Date", dateIn("date", true)),
        field("School or college", text("school", "Leave blank for ads and media")),
        field("City", text("city", "", true)),
        field("District", text("district", "Defaults to the city")),
        field("State", text("state", "e.g. Karnataka")),
        field("Cost (₹)", numberIn("cost", "e.g. 1450")),
        field("Faculty member", facultyIn)));

    const studentCard = card("Add a student enquiry",
      entryForm(data => afterEntry(addStudent(data), "Student enquiry saved."),
        field("Student ID", text("student_id", "Optional")),
        field("Enquiry date", dateIn("enquiry_date", true)),
        field("Status", select("status", STAGES, true)),
        field("City", text("city", "", true)),
        field("District", text("district", "Defaults to the city")),
        field("State", text("state", "e.g. Karnataka")),
        field("School or college", text("school", "Where the student studied")),
        field("Course applied for", text("course", "e.g. B.Com"))));

    const recent = [
      ...state.campaigns.filter(c => c.manual).map(c => ({
        kind: "activity", rec: c, date: c.date, type: "Activity", what: c.channel,
        place: c.school || c.city, detail: `${inr(c.cost)}${c.faculty ? " · " + c.faculty : ""}`,
      })),
      ...state.students.filter(s => s.manual).map(s => ({
        kind: "student", rec: s, date: s.enquiry, type: "Student", what: STAGES[s.stageIdx],
        place: s.school || s.city, detail: s.course,
      })),
    ].sort((a, b) => b.date - a.date).slice(0, 25);

    const recentCard = card("Your recent entries (latest 25)",
      recent.length
        ? table(["Type", "Date", "Record", "School or place", "Detail", ""],
            recent.map(r => [r.type, fmtDate(r.date), r.what, r.place, r.detail,
              h("button", { class: "btn-link", type: "button", onclick: () => removeRecord(r.kind, r.rec) }, "Remove")]))
        : emptyNote("Activities and enquiries you enter appear here, newest first."),
      emptyNote("Remove is for mistakes. Changes are saved in this browser; download a backup to keep a copy."));

    return page(
      state.notice ? h("div", { class: "notice", role: "status" }, state.notice) : null,
      activityCard,
      studentCard,
      recentCard);
  }

  // ============ Import and backup page ============
  function viewData() {
    const flagged = [...state.raw.entries()].filter(([, names]) => names.size > 1);
    const up = (label, kind) => h("label", { class: "upload" }, label,
      h("input", { type: "file", accept: ".csv,text/csv", onchange: e => handleFile(e.target.files[0], kind) }));

    return page(
      state.notice ? h("div", { class: "notice", role: "status" }, state.notice) : null,
      emptyNote(`Loaded: ${num(state.campaigns.length)} activity rows and ${num(state.students.length)} student rows across ${state.seasons.length} season(s) (${state.isDemo ? "synthetic demo data" : "your records"}). Files are read in your browser and are not sent to any server.`),
      h("div", { class: "grid-2" },
        card("Import spreadsheets (CSV)",
          up("Campaign spend sheet (visits, events, ads, media)", "campaigns"),
          up("Student admissions sheet", "students"),
          emptyNote("Importing a sheet replaces the records of that sheet. Download a backup first if you want to keep the current ones."),
          h("button", { class: "btn btn-ghost", type: "button", onclick: resetDemo }, "Reset to demo data")),
        card("Expected columns",
          h("p", { class: "note" }, "Campaign sheet"), h("p", null, code(CAMPAIGN_COLS.join(", "))),
          h("p", { class: "note" }, "Student sheet"), h("p", null, code(STUDENT_COLS.join(", "))),
          emptyNote("Dates can be YYYY-MM-DD or DD/MM/YYYY. Costs are in rupees. The season (for example 2026–27) is worked out from each date, June to May. District and state are optional: a missing district uses the city. Columns named name, phone, email, mobile or address are ignored. Save Excel files as CSV first."))),
      card("Backup and restore",
        h("p", { class: "note", id: "save-status" }, saveText()),
        h("div", { class: "toolbar" },
          h("button", { class: "btn", type: "button", onclick: downloadBackup }, "Download backup (.json)"),
          h("label", { class: "btn btn-ghost file-btn" }, "Restore from backup",
            h("input", { type: "file", accept: ".json,application/json", class: "visually-hidden", onchange: e => restoreFile(e.target.files[0]) })),
          h("button", { class: "btn btn-danger", type: "button", onclick: clearData }, "Delete all records")),
        emptyNote("Browser storage can be cleared by the browser or by IT policy, so the downloaded file is the safe copy. Download one after each import, and keep the file on the college drive. Restoring replaces the current records.")),
      accountsCard(),
      card("School names to check",
        flagged.length
          ? table(["School key", "Names as entered (rows)"],
              flagged.map(([k, names]) => [k, [...names.entries()].map(([n, c]) => `${n} (${c})`).join("; ")]))
          : emptyNote("No school name needs checking."),
        emptyNote("Names that differ only in spelling or punctuation are grouped. Confirm the groups above before relying on school-level figures.")),
      card("Import messages",
        state.log.length
          ? h("ul", { class: "log" }, state.log.slice(0, 30).map(m => h("li", null, m)))
          : emptyNote("No import messages yet.")));
  }

  function code(t) { return h("code", null, t); }


  const VIEWS = {
    overview: viewOverview,
    locations: viewLocations,
    seasons: viewSeasons,
    faculty: viewFaculty,
    channels: viewChannels,
    timing: viewTiming,
    students: viewStudents,
    reports: viewReports,
    entry: viewEntry,
    data: viewData,
  };

  // ============ Rendering ============
  // ============ Rendering ============
  let lastTab = null;

  function render() {
    document.getElementById("source-badge").textContent = state.isDemo ? "Synthetic demo data" : "Your data · review before use";
    if (!visibleTabs().some(t => t[0] === state.tab)) state.tab = "overview";
    const view = VIEWS[state.tab](filtered());
    // Slide only when the section changes, from the side the user is moving towards
    if (state.tab !== lastTab) {
      const from = TABS.findIndex(t => t[0] === lastTab);
      const to = TABS.findIndex(t => t[0] === state.tab);
      view.classList.add("view-enter", to >= from ? "from-right" : "from-left");
      lastTab = state.tab;
    }
    view.classList.add("grow"); // bars and columns grow from zero each time a section is drawn
    document.getElementById("main").replaceChildren(view);
    document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
    moveIndicator();
    playGlides();
    markChips();
  }

  // Segmented controls keep a sliding thumb. The thumb starts where it was last drawn, so it glides to the new option.
  const glideMemory = new Map();
  function playGlides() {
    document.querySelectorAll(".segmented[data-glide]").forEach(seg => {
      const thumb = seg.querySelector(".seg-thumb");
      const on = seg.querySelector(".seg-btn.on");
      if (!thumb || !on) return;
      const to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight };
      const from = glideMemory.get(seg.dataset.glide);
      glideMemory.set(seg.dataset.glide, to);
      const place = p => {
        thumb.style.width = p.w + "px";
        thumb.style.height = p.h + "px";
        thumb.style.transform = `translate(${p.x}px, ${p.y}px)`;
      };
      if (!from) return place(to);
      thumb.style.transition = "none";
      place(from);
      void thumb.offsetWidth;
      thumb.style.transition = "";
      place(to);
    });
  }

  // Chips that switch on get a small pop; chips that stay on do not
  const chipsOn = new Set();
  function markChips() {
    const now = new Set();
    document.querySelectorAll(".chip.on[data-key]").forEach(c => {
      const k = c.dataset.key;
      now.add(k);
      if (!chipsOn.has(k)) c.classList.add("chip-pop");
    });
    chipsOn.clear();
    now.forEach(k => chipsOn.add(k));
  }

  // The liquid pill in the sidebar glides to the active section
  function moveIndicator() {
    const glow = document.querySelector(".tab-glow");
    const btn = document.querySelector(`.tabs button[data-tab="${state.tab}"]`);
    if (!glow || !btn) return;
    const first = !glow.classList.contains("on");
    if (first) glow.style.transition = "none";
    glow.style.width = btn.offsetWidth + "px";
    glow.style.height = btn.offsetHeight + "px";
    glow.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
    if (first) {
      void glow.offsetWidth;
      glow.style.transition = "";
      glow.classList.add("on");
    }
  }

  function buildTabs() {
    const glow = h("span", { class: "tab-glow", "aria-hidden": "true" });
    document.querySelector(".tabs").replaceChildren(glow, ...visibleTabs().map(([id, label]) => h("button", {
      type: "button", "data-tab": id,
      onclick: () => { state.tab = id; state.drill = null; state.facultySel = ""; state.notice = ""; render(); },
    }, label)));
  }

  function buildFilters() {
    const districts = [...new Set([...state.campaigns.map(c => c.district), ...state.students.map(s => s.district)])].sort();
    const courses = [...new Set(state.students.map(s => s.course).filter(Boolean))].sort();
    const select = (label, key, options, allLabel) => {
      const sel = h("select", { onchange: e => { state.filters[key] = e.target.value; render(); } },
        h("option", { value: "" }, allLabel || "All"),
        options.map(o => (typeof o === "string" ? h("option", { value: o }, o) : h("option", { value: o.value }, o.label))));
      sel.value = state.filters[key] || "";
      return h("label", { class: "field" }, label, sel);
    };
    const dateField = (label, key) => h("label", { class: "field" }, label,
      h("input", { type: "date", onchange: e => { state.filters[key] = e.target.value ? parseDate(e.target.value) : null; render(); } }));

    document.getElementById("filters").replaceChildren(
      select("Season", "season", state.seasons.map(s => ({ value: s, label: season(s) })), "All seasons"),
      select("Attributed channel", "channel", [...Object.values(CH), AREA, NONE]),
      select("District", "district", districts),
      select("Course", "course", courses),
      dateField("From", "from"),
      dateField("To", "to"),
      h("button", {
        class: "btn btn-ghost", type: "button",
        onclick: () => {
          state.filters = { season: state.seasons[0] || "", channel: "", district: "", course: "", from: null, to: null };
          buildFilters();
          render();
        },
      }, "Clear filters"));
  }

  // ============ Import ============
  function flash(msg) {
    state.log.unshift(msg);
    state.tab = "data";
    render();
  }

  function handleFile(file, kind) {
    if (!file) return;
    if (file.size > MAX_BYTES) return flash(`${file.name}: larger than 2 MB. Split it into smaller sheets.`);
    if (!/\.csv$/i.test(file.name)) return flash(`${file.name}: save the sheet as CSV first.`);
    const reader = new FileReader();
    reader.onload = () => importText(String(reader.result), kind, file.name);
    reader.readAsText(file);
  }

  function importText(text, kind, name) {
    const rows = parseCSV(text);
    if (rows.length < 2) return flash(`${name}: no data rows found.`);
    if (rows.length - 1 > MAX_ROWS) return flash(`${name}: more than ${MAX_ROWS} rows. Split the sheet.`);

    const headers = rows[0].map(x => x.trim().toLowerCase().replace(/\s+/g, "_"));
    const missing = REQUIRED[kind].filter(c => !headers.includes(c));
    if (missing.length) return flash(`${name}: missing column(s) ${missing.join(", ")}.`);

    const records = rows.slice(1).map(r => {
      const o = {};
      headers.forEach((k, i) => { o[k] = (r[i] || "").trim(); });
      return o;
    });
    const msgs = [];
    if (headers.some(x => PERSONAL_COLS.includes(x))) msgs.push("Personal-detail columns were ignored.");

    if (kind === "campaigns") state.store.campaigns = buildCampaigns(records, msgs);
    else state.store.students = buildStudents(records, msgs);
    state.isDemo = false;

    applyScope();
    persist();
    msgs.forEach(m => state.log.unshift(`${name}: ${m}`));
    flash(`${name}: imported.`);
  }

  function buildCampaigns(records, msgs) {
    const out = [];
    records.forEach((r, i) => {
      const row = i + 2;
      const channel = normChannel(r.channel);
      const date = parseDate(r.date);
      const cost = r.cost_inr === "" ? NaN : Number(String(r.cost_inr).replace(/[₹,\s]/g, ""));
      if (!channel) return msgs.push(`Campaign row ${row}: unknown channel "${r.channel}" (skipped).`);
      if (!date) return msgs.push(`Campaign row ${row}: unreadable date "${r.date}" (skipped).`);
      if (!Number.isFinite(cost) || cost < 0) return msgs.push(`Campaign row ${row}: invalid cost "${r.cost_inr}" (skipped).`);
      const city = titleCase(r.city);
      out.push(makeCampaign({
        id: "U" + String(i + 1).padStart(4, "0"), channel, subtype: r.subtype || "", date,
        school: r.school || "", city, district: titleCase(r.district) || city,
        state: normState(r.state), cost, faculty: r.faculty || r.owner || "",
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
      if (!enquiry) return msgs.push(`Student row ${row}: unreadable enquiry date "${r.enquiry_date}" (skipped).`);
      if (stageIdx < 0) return msgs.push(`Student row ${row}: unknown status "${r.status}" (skipped).`);
      const city = titleCase(r.city);
      out.push(makeStudent({
        id: r.student_id || `R${row}`, city, district: titleCase(r.district) || city,
        state: normState(r.state), school: r.school || "", course: r.course || "", enquiry, stageIdx,
      }));
    });
    msgs.unshift(`${out.length} student rows imported, ${records.length - out.length} skipped.`);
    return out;
  }

  // Reset to demo data replaces the records in this browser, so it asks first
  function resetDemo() {
    if (!window.confirm("Replace the current records with the demo data? Records saved in this browser will be removed.")) return;
    useDemo();
    state.compareSeasons = null;
    state.notice = "Demo data restored. Saved records were removed from this browser.";
    persist();
    render();
  }

  // ============ Accounts and sign-in ============
  // Accounts are stored in this browser. Passwords are kept only as PBKDF2 hashes.
  // This is a prototype gate: real access control needs a server (see README).
  const PBKDF2_ITER = 210000;
  const SESSION_MINUTES = 20;
  const MAX_TRIES = 5;
  const LOCK_MS = 60000;
  const enc = new TextEncoder();
  const toB64 = bytes => btoa(String.fromCharCode(...bytes));
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const norm = v => String(v || "").trim().toLowerCase();
  const auth = { tries: 0, lockedUntil: 0 };
  let idleTimer = null;

  function getAccounts() { return dbRun(ACCOUNT_STORE, "readonly", s => s.getAll()); }
  function putAccount(acc) { return dbRun(ACCOUNT_STORE, "readwrite", s => s.put(acc)); }
  function deleteAccount(username) { return dbRun(ACCOUNT_STORE, "readwrite", s => s.delete(username)); }
  function loadAccounts() {
    return getAccounts()
      .then(a => { state.accounts = a; })
      .catch(() => { state.authError = true; state.accounts = []; });
  }

  async function hashPassword(password, salt, iterations) {
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
    return new Uint8Array(bits);
  }
  async function makeAccount(username, password, role, faculty) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt, PBKDF2_ITER);
    return { username, role, faculty, salt: toB64(salt), hash: toB64(hash), iterations: PBKDF2_ITER, createdAt: new Date().toISOString() };
  }
  async function checkPassword(acc, password) {
    const hash = await hashPassword(password, fromB64(acc.salt), acc.iterations);
    const expected = fromB64(acc.hash);
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ hash[i];
    return diff === 0;
  }
  const roleLabel = u => (u.role === "admin" ? "Administrator" : `Coordinator · ${u.faculty}`);

  function newAccountProblem(username, password, repeat, role, faculty) {
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) return "Username: 3 to 32 letters, numbers, dots, dashes or underscores.";
    if (state.accounts.some(a => a.username === username)) return "That username already exists.";
    if (role === "coordinator" && !norm(faculty)) return "Enter the faculty name exactly as it appears in the activity records.";
    if (String(password).length < 10) return "Use a password of at least 10 characters.";
    if (password !== repeat) return "The two passwords do not match.";
    return null;
  }

  // Coordinators see only their own activities and the students credited to them.
  // Admins see everything. The full data always stays in state.store.
  function applyScope() {
    const u = state.user;
    if (!u) {
      state.campaigns = [];
      state.students = [];
    } else if (u.role === "admin") {
      state.campaigns = state.store.campaigns;
      state.students = state.store.students;
    } else {
      const me = norm(u.faculty);
      state.campaigns = me ? state.store.campaigns.filter(c => norm(c.faculty) === me) : [];
      const keys = new Set(state.campaigns.map(c => c.key).filter(Boolean));
      state.students = state.store.students.filter(s => keys.has(s.key));
    }
    prepare();
    buildFilters();
  }

  const COORDINATOR_HIDDEN = ["faculty", "data"];
  function visibleTabs() {
    return state.user && state.user.role === "coordinator"
      ? TABS.filter(([id]) => !COORDINATOR_HIDDEN.includes(id))
      : TABS;
  }

  function showAuth(mode, message) {
    const box = document.getElementById("auth");
    const setup = mode === "setup";
    const msg = h("p", { class: "auth-msg", role: "alert" },
      message || (state.authError ? "This browser cannot store accounts, so sign-in is not available here." : ""));
    const username = h("input", { type: "text", name: "username", autocomplete: "username", autocapitalize: "none", required: true });
    const password = h("input", { type: "password", name: "password", autocomplete: setup ? "new-password" : "current-password", required: true });
    const repeat = h("input", { type: "password", name: "repeat", autocomplete: "new-password", required: true });
    const submit = h("button", { class: "btn auth-submit", type: "submit" }, setup ? "Create administrator account" : "Sign in");
    const form = h("form", {
      class: "auth-form",
      onsubmit: e => {
        e.preventDefault();
        handleAuth(mode, norm(username.value), password.value, repeat.value, msg, submit);
      },
    },
      h("label", { class: "field" }, "Username", username),
      h("label", { class: "field" }, "Password", password),
      setup ? h("label", { class: "field" }, "Confirm password", repeat) : null,
      submit);
    box.replaceChildren(h("div", { class: "auth-card" },
      h("img", { class: "auth-logo", src: "logos/logo-emblem-gold.png", alt: "" }),
      h("h2", { class: "auth-title" }, setup ? "Set up Admissions Insights" : "Sign in"),
      h("p", { class: "note auth-sub" }, setup
        ? "Create the first administrator account. It can add coordinator accounts later."
        : "Enter your username and password to continue."),
      form,
      msg));
    box.hidden = false;
    setTimeout(() => username.focus(), 50);
  }

  async function handleAuth(mode, username, password, repeat, msg, submit) {
    const say = t => { msg.textContent = t; };
    if (!window.crypto || !crypto.subtle) return say("Sign-in needs this page to be opened over HTTPS or on localhost.");
    submit.disabled = true;
    try {
      if (mode === "setup") {
        const problem = newAccountProblem(username, password, repeat, "admin", "");
        if (problem) return say(problem);
        const acc = await makeAccount(username, password, "admin", "");
        await putAccount(acc);
        state.accounts = await getAccounts();
        return enterApp(acc);
      }
      const wait = auth.lockedUntil - Date.now();
      if (wait > 0) return say(`Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`);
      const acc = state.accounts.find(a => a.username === username);
      // Hash even for unknown usernames, so the reply takes the same time either way
      const ok = acc ? await checkPassword(acc, password) : (await hashPassword(password, new Uint8Array(16), PBKDF2_ITER), false);
      if (!ok) {
        auth.tries++;
        if (auth.tries >= MAX_TRIES) {
          auth.tries = 0;
          auth.lockedUntil = Date.now() + LOCK_MS;
          return say("Too many attempts. Wait one minute and try again.");
        }
        return say("Username or password is not right.");
      }
      enterApp(acc);
    } catch (e) {
      say("Something went wrong while checking the account. Please try again.");
    } finally {
      submit.disabled = false;
    }
  }

  function enterApp(acc) {
    state.user = { username: acc.username, role: acc.role, faculty: (acc.faculty || "").trim() };
    auth.tries = 0;
    const box = document.getElementById("auth");
    box.hidden = true;
    box.replaceChildren();
    state.tab = "overview";
    applyScope();
    buildTabs();
    buildWho();
    resetIdle();
    render();
  }

  function signOut(reason) {
    state.user = null;
    clearTimeout(idleTimer);
    applyScope();
    buildWho();
    showAuth("login", reason || "");
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    if (state.user) idleTimer = setTimeout(() => signOut(`Signed out after ${SESSION_MINUTES} minutes without activity.`), SESSION_MINUTES * 60000);
  }

  function buildWho() {
    const el = document.getElementById("who");
    if (!el) return;
    if (!state.user) return el.replaceChildren();
    el.replaceChildren(
      h("div", { class: "who-name" }, state.user.username),
      h("div", null, roleLabel(state.user)),
      h("button", { class: "btn-link who-out", type: "button", onclick: () => signOut("") }, "Sign out"));
  }

  // Admin-only card on the Import & backup page
  function accountsCard() {
    const me = state.user ? state.user.username : "";
    const admins = state.accounts.filter(a => a.role === "admin").length;
    const msg = h("p", { class: "form-msg", role: "status" });
    const rows = state.accounts.map(a => {
      const protectedRow = a.username === me || (a.role === "admin" && admins <= 1);
      return [a.username, a.role === "admin" ? "Administrator" : "Coordinator", a.faculty || "—",
        protectedRow ? "" : h("button", { class: "btn-link", type: "button", onclick: () => removeAccount(a.username) }, "Remove")];
    });
    const form = h("form", {
      class: "form-grid",
      onsubmit: e => { e.preventDefault(); submitAccount(form, msg); },
    },
      h("label", { class: "field" }, "Username", h("input", { type: "text", name: "username", autocapitalize: "none", required: true, placeholder: "e.g. faculty.a" })),
      h("label", { class: "field" }, "Role", h("select", { name: "role" },
        h("option", { value: "coordinator" }, "Coordinator"),
        h("option", { value: "admin" }, "Administrator"))),
      h("label", { class: "field" }, "Faculty name (coordinators)",
        h("input", { type: "text", name: "faculty", list: "faculty-names", placeholder: "Exactly as in the records" })),
      h("label", { class: "field" }, "Password (10+ characters)", h("input", { type: "password", name: "password", autocomplete: "new-password", required: true })),
      h("label", { class: "field" }, "Repeat password", h("input", { type: "password", name: "repeat", autocomplete: "new-password", required: true })),
      h("div", { class: "form-actions" }, h("button", { class: "btn", type: "submit" }, "Add account")),
      msg);
    return card("Accounts",
      table(["Username", "Role", "Faculty", ""], rows),
      h("datalist", { id: "faculty-names" }, state.faculty.map(f => h("option", { value: f }))),
      form,
      emptyNote("Coordinators see only their own activities and the students credited to them. Passwords are stored as hashes, and accounts are not included in backup files."));
  }

  async function submitAccount(form, msg) {
    const d = Object.fromEntries(new FormData(form));
    const username = norm(d.username);
    const problem = newAccountProblem(username, d.password, d.repeat, d.role, d.faculty);
    if (problem) {
      msg.dataset.state = "error";
      msg.textContent = problem;
      return;
    }
    try {
      const acc = await makeAccount(username, d.password, d.role, d.role === "coordinator" ? d.faculty.trim() : "");
      await putAccount(acc);
      state.accounts = await getAccounts();
      state.notice = `Account ${username} added.`;
      render();
    } catch (e) {
      msg.dataset.state = "error";
      msg.textContent = "The account could not be saved in this browser.";
    }
  }

  async function removeAccount(username) {
    if (!window.confirm(`Remove the account "${username}"? That person will no longer be able to sign in from this browser.`)) return;
    await deleteAccount(username);
    state.accounts = await getAccounts();
    state.notice = `Account ${username} removed.`;
    render();
  }

  // ============ Reports ============
  const REPORTS = [
    { key: "season", label: "Season summary", sheet: "Season summary" },
    { key: "channels", label: "Channels and spend", sheet: "Channels and spend" },
    { key: "locations", label: "Locations", sheet: "Locations" },
    { key: "faculty", label: "Faculty performance", sheet: "Faculty" },
    { key: "activities", label: "Activities", sheet: "Activities" },
    { key: "students", label: "Student enquiries", sheet: "Students" },
  ];
  const PREVIEW_ROWS = 200;
  const round1 = v => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
  const slug = t => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function selectedSeasons() {
    const all = state.seasons.slice().sort();
    return (state.compareSeasons === null ? all : state.compareSeasons.filter(s => all.includes(s))).slice().sort();
  }

  // Each report: a title, a note, columns [{ h, t }] and rows of raw values (numbers stay numbers for Excel)
  function buildReport(key, f) {
    const make = (title, note, columns, rows) => ({ key, title, note, columns, rows });
    switch (key) {
      case "season":
        return make("Season summary",
          "Full seasons, as in Season comparison. The district, channel, course and date filters do not apply to this report.",
          [{ h: "Season", t: "text" }, { h: "Enquiries", t: "int" }, { h: "Applied", t: "int" }, { h: "Admitted", t: "int" },
            { h: "Fee paid", t: "int" }, { h: "Enrolled", t: "int" }, { h: "Admit rate", t: "pct" }, { h: "Total spend", t: "inr" },
            { h: "Cost per admission", t: "inr" }, { h: "Teacher visits", t: "int" }, { h: "Events", t: "int" },
            { h: "Districts visited", t: "int" }, { h: "States visited", t: "int" }],
          selectedSeasons().map(s => {
            const x = seasonSummary(s);
            return [season(s), x.S.n, x.S.applied, x.S.admitted, x.S.feePaid, x.S.enrolled,
              x.S.n ? round1((x.S.admitted / x.S.n) * 100) : null, Math.round(x.spend),
              x.S.cpa === null ? null : Math.round(x.S.cpa), x.visits, x.events, x.districts, x.states];
          }));
      case "channels":
        return make("Channels and spend", "Spend and outcomes for the current filters.",
          [{ h: "Activity", t: "text" }, { h: "Activities", t: "int" }, { h: "Spend", t: "inr" }, { h: "Enquiries", t: "int" },
            { h: "Applied", t: "int" }, { h: "Admitted", t: "int" }, { h: "Enrolled", t: "int" }, { h: "Cost per admission", t: "inr" }],
          channelRows(f).map(r => [r.label, r.campaigns.length, Math.round(r.spend), r.S.n, r.S.applied, r.S.admitted,
            r.S.enrolled, r.S.cpa === null ? null : Math.round(r.S.cpa)]));
      case "locations":
        return make("Locations",
          "Visits, events and enquiries by district. Ads and media are matched by city, so their links are indicative only.",
          [{ h: "State", t: "text" }, { h: "District", t: "text" }, { h: "Visits", t: "int" }, { h: "Events", t: "int" },
            { h: "Ads and media", t: "int" }, { h: "Enquiries", t: "int" }, { h: "Admitted", t: "int" },
            { h: "Via school visit or event", t: "int" }, { h: "Via ads or media (indicative)", t: "int" }, { h: "No marketing link", t: "int" }],
          districtRows(f).sort((a, b) => b.enquiries - a.enquiries)
            .map(r => [r.state, r.district, r.visits, r.events, r.adsMedia, r.enquiries, r.admitted, r.school, r.ads, r.none]));
      case "faculty":
        return make("Faculty performance",
          "Credit goes to the last visit or event before each enquiry. For review by college administration only; figures describe marketing activity.",
          [{ h: "Faculty", t: "text" }, { h: "Institutions visited", t: "int" }, { h: "Visits", t: "int" }, { h: "Events", t: "int" },
            { h: "Spend", t: "inr" }, { h: "Enquiries credited", t: "int" }, { h: "Admitted", t: "int" }, { h: "Enrolled", t: "int" },
            { h: "Admit rate", t: "pct" }, { h: "Median days, visit to enquiry", t: "days" }],
          facultyRows(f).map(r => [r.name, r.institutions, r.visits, r.events, Math.round(r.spend), r.enquiries, r.admitted,
            r.enrolled, r.rate === null ? null : round1(r.rate * 100), r.medianDays === null ? null : Math.round(r.medianDays)]));
      case "activities":
        return make("Activities", "Every visit, event, ad and media piece in the current filters.",
          [{ h: "Date", t: "date" }, { h: "Activity", t: "text" }, { h: "Detail", t: "text" }, { h: "School or college", t: "text" },
            { h: "City", t: "text" }, { h: "District", t: "text" }, { h: "State", t: "text" }, { h: "Cost", t: "inr" },
            { h: "Faculty", t: "text" }, { h: "Enquiries credited", t: "int" }],
          f.campaigns.slice().sort((a, b) => a.date - b.date).map(c => [c.date, c.channel, c.subtype, c.school, c.city,
            c.district, c.state, Math.round(c.cost), c.faculty, (state.credit.get(c.id) || { enq: 0 }).enq]));
      case "students":
        return make("Student enquiries", "Each enquiry with its attribution. Ads and media links are indicative only.",
          [{ h: "Student ID", t: "text" }, { h: "Enquiry date", t: "date" }, { h: "Status", t: "text" }, { h: "City", t: "text" },
            { h: "District", t: "text" }, { h: "State", t: "text" }, { h: "School or college", t: "text" }, { h: "Course", t: "text" },
            { h: "Attribution", t: "text" }, { h: "Channel", t: "text" }, { h: "Faculty credited", t: "text" },
            { h: "Days since last contact", t: "days" }],
          f.students.slice().sort((a, b) => b.enquiry - a.enquiry).map(s => [s.id, s.enquiry, STAGES[s.stageIdx], s.city,
            s.district, s.state, s.school, s.course, s.att.level, s.att.channel || "", s.att.faculty || "",
            s.att.lastDays === null || s.att.lastDays === undefined ? null : Math.round(s.att.lastDays)]));
    }
    return null;
  }

  function allReports(f) {
    return REPORTS.map(r => Object.assign(buildReport(r.key, f), { sheet: r.sheet }));
  }

  // Text as shown on screen
  function cellText(v, t) {
    if (v === null || v === undefined || v === "") return "—";
    if (t === "inr") return inr(v);
    if (t === "pct") return `${v}%`;
    if (t === "date") return fmtDate(v);
    if (t === "days") return `${Math.round(v)} days`;
    if (t === "int") return num(v);
    return String(v);
  }

  // Value as written to a file
  const exportValue = v => {
    if (v instanceof Date) return ymd(v);
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return Number.isFinite(v) ? v : "";
    return String(v);
  };

  function toCsv(report) {
    const q = v => {
      const s = String(exportValue(v));
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return "﻿" + [report.columns.map(c => c.h), ...report.rows].map(r => r.map(q).join(",")).join("\r\n");
  }

  // ----- Excel workbook (.xlsx), written by hand: a zip of XML parts -----
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Stores each file without compression, which every spreadsheet program can read
  function makeZip(files) {
    const parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = enc.encode(f.text);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
      ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const cenSize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const xmlEsc = s => String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const colName = i => {
    let s = "", n = i + 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const STYLES_XML = XML_HEAD +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function sheetXml(headers, rows) {
    const all = [headers, ...rows.map(r => r.map(exportValue))];
    const widths = headers.map((_, ci) => all.reduce((w, r) => Math.max(w, String(r[ci] === undefined ? "" : r[ci]).length + 2), 10))
      .map(w => Math.min(42, w));
    const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
    const body = all.map((r, ri) => {
      const cells = r.map((v, ci) => {
        const ref = colName(ci) + (ri + 1);
        const s = ri === 0 ? ' s="1"' : "";
        if (v === "" || v === null || v === undefined) return "";
        if (typeof v === "number") return `<c r="${ref}"${s}><v>${v}</v></c>`;
        return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      }).join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join("");
    return XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      `<cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
  }

  function workbookBlob(reports) {
    const sheets = reports.map(r => ({
      name: r.sheet.replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31),
      xml: sheetXml(r.columns.map(c => c.h), r.rows),
    }));
    const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
    const files = [
      { name: "[Content_Types].xml", text: XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        "</Types>" },
      { name: "_rels/.rels", text: XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rel("rId1", "officeDocument", "xl/workbook.xml") + "</Relationships>" },
      { name: "xl/workbook.xml", text: XML_HEAD +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        "</sheets></workbook>" },
      { name: "xl/_rels/workbook.xml.rels", text: XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => rel(`rId${i + 1}`, "worksheet", `worksheets/sheet${i + 1}.xml`)).join("") +
        rel(`rId${sheets.length + 1}`, "styles", "styles.xml") + "</Relationships>" },
      { name: "xl/styles.xml", text: STYLES_XML },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml })),
    ];
    return makeZip(files);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: filename });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ----- Saved report setups (kept in this browser) -----
  function loadPresets() {
    return dbRun(SETTINGS_STORE, "readonly", s => s.get("reportPresets"))
      .then(v => { state.presets = v || []; })
      .catch(() => { state.presets = []; });
  }
  function savePresets() {
    return dbRun(SETTINGS_STORE, "readwrite", s => s.put(state.presets, "reportPresets"))
      .catch(() => { state.notice = "Saved setups could not be stored in this browser."; });
  }
  function presetFromState(name) {
    const f = state.filters;
    return {
      name, type: state.report.type, compareSeasons: state.compareSeasons,
      filters: { season: f.season, channel: f.channel, district: f.district, course: f.course,
        from: f.from ? ymd(f.from) : null, to: f.to ? ymd(f.to) : null },
    };
  }
  function applyPreset(p) {
    const f = p.filters || {};
    state.filters = {
      season: f.season || "", channel: f.channel || "", district: f.district || "", course: f.course || "",
      from: f.from ? parseDate(f.from) : null, to: f.to ? parseDate(f.to) : null,
    };
    state.report.type = p.type;
    state.compareSeasons = p.compareSeasons || null;
    state.notice = `Opened "${p.name}".`;
    buildFilters();
    render();
  }
  function savePreset(name) {
    const clean = name.trim();
    if (!clean) {
      state.notice = "Give the setup a name first.";
      return render();
    }
    state.presets = [...state.presets, presetFromState(clean)];
    savePresets();
    state.notice = `Saved "${clean}".`;
    render();
  }
  function deletePreset(i) {
    state.presets = state.presets.filter((_, j) => j !== i);
    savePresets();
    state.notice = "Saved setup deleted.";
    render();
  }

  function viewReports(f) {
    const r = state.report;
    const rep = buildReport(r.type, f);
    const who = state.user ? `${state.user.username} (${roleLabel(state.user)})` : "";
    const scope = [
      state.filters.season ? `Season ${season(state.filters.season)}` : "All seasons",
      state.filters.district && `District: ${state.filters.district}`,
      state.filters.channel && `Channel: ${state.filters.channel}`,
      state.filters.course && `Course: ${state.filters.course}`,
      state.filters.from && `From ${fmtDate(state.filters.from)}`,
      state.filters.to && `To ${fmtDate(state.filters.to)}`,
    ].filter(Boolean).join(" · ");

    const select = h("select", { onchange: e => { state.report.type = e.target.value; render(); } },
      REPORTS.map(x => h("option", { value: x.key, selected: x.key === r.type ? true : null }, x.label)));
    const preview = rep.rows.length
      ? table(rep.columns.map(c => c.h), rep.rows.slice(0, PREVIEW_ROWS).map(row => row.map((v, i) => cellText(v, rep.columns[i].t))))
      : emptyNote("No records in the current filters.");
    // This block is the only part that prints
    const printable = h("section", { class: "card", id: "report-print" },
      h("div", { class: "print-head" },
        h("img", { src: "logos/logo-emblem-gold.png", alt: "" }),
        h("div", null,
          h("div", { class: "print-title" }, rep.title),
          h("div", { class: "note" }, `Admissions Insights · generated ${fmtDate(new Date())}${who ? " by " + who : ""}`),
          h("div", { class: "note" }, scope))),
      rep.note ? emptyNote(rep.note) : null,
      preview,
      rep.rows.length > PREVIEW_ROWS
        ? emptyNote(`Showing the first ${num(PREVIEW_ROWS)} of ${num(rep.rows.length)} rows. The Excel download has all of them.`)
        : null);
    const nameIn = h("input", { type: "text", placeholder: "e.g. Karnataka teacher visits 2026–27", "aria-label": "Name for this setup" });
    const saved = state.presets.length
      ? table(["Saved setup", "Report", ""], state.presets.map((p, i) => [p.name, REPORTS.find(x => x.key === p.type)?.label || "",
          h("span", null,
            h("button", { class: "btn-link", type: "button", onclick: () => applyPreset(p) }, "Open"), " · ",
            h("button", { class: "btn-link", type: "button", onclick: () => deletePreset(i) }, "Delete"))]))
      : emptyNote("Save a setup to reopen this report with the same filters later.");

    return page(
      state.notice ? h("div", { class: "notice", role: "status" }, state.notice) : null,
      card("Choose a report",
        h("div", { class: "toolbar" }, h("label", { class: "field" }, "Report", select)),
        h("div", { class: "toolbar" },
          h("button", { class: "btn", type: "button",
            onclick: () => saveBlob(workbookBlob(allReports(f)), `admissions-reports-${ymd(new Date())}.xlsx`) },
            "Download Excel workbook (all reports)"),
          h("button", { class: "btn btn-ghost", type: "button",
            onclick: () => saveBlob(new Blob([toCsv(rep)], { type: "text/csv" }), `${slug(rep.title)}-${ymd(new Date())}.csv`) },
            "Download this report (.csv)"),
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => window.print() }, "Print or save as PDF")),
        emptyNote("Reports use the filters above. The Excel workbook has one sheet per report.")),
      printable,
      card("Saved setups",
        h("div", { class: "toolbar" }, nameIn,
          h("button", { class: "btn btn-ghost", type: "button", onclick: () => savePreset(nameIn.value) }, "Save current setup")),
        saved));
  }

  // ============ Start ============
  function init() {
    state.demo = buildDemo(20260);
    buildTabs();
    window.addEventListener("resize", moveIndicator);
    document.addEventListener("pointerdown", resetIdle, { passive: true });
    document.addEventListener("keydown", resetIdle);
    useDemo();
    Promise.all([loadSaved(), loadAccounts(), loadPresets()])
      .then(([saved]) => {
        if (!saved || saved.isDemo) return;
        try {
          setData(fromBackup(saved));
          state.savedAt = saved.exportedAt ? new Date(saved.exportedAt) : null;
          state.notice = "Your records were restored from this browser.";
        } catch (e) {
          state.notice = "Records saved in this browser could not be read, so the demo is shown. Restore a backup file to continue.";
        }
      })
      .then(() => showAuth(state.accounts.length ? "login" : "setup"))
      .then(render)
      .then(hideSplash);
  }

  // Fades out the opening splash once the first view is drawn
  function hideSplash() {
    const el = document.getElementById("splash");
    if (!el) return;
    const wait = Math.max(0, SPLASH_MIN_MS - (performance.now() - BOOT));
    setTimeout(() => {
      el.classList.add("done");
      setTimeout(() => el.remove(), 900);
    }, wait);
  }

  init();
})();
