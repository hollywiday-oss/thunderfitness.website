(function () {
  const KEYS = {
    seeded: "tf_seeded",
    users: "tf_users",
    currentClient: "tf_current_client",
    consultations: "tf_consultations",
    bookings: "tf_bookings",
    messages: "tf_messages",
    assignments: "tf_assignments",
    reviews: "tf_reviews",
    siteSettings: "tf_site_settings",
    pendingSignups: "tf_pending_signups",
    availability: "tf_availability",
    availabilityDefaults: "tf_availability_defaults",
    pendingAction: "tf_pending_action"
  };

  function buildHourlySlots(startHour, endHourInclusive) {
    const slots = [];
    const safeStart = Math.max(0, Math.min(23, Number(startHour) || 0));
    const safeEnd = Math.max(safeStart, Math.min(23, Number(endHourInclusive) || safeStart));
    for (let hour = safeStart; hour <= safeEnd; hour += 1) {
      const hh = String(hour).padStart(2, "0");
      slots.push(hh + ":00");
    }
    return slots;
  }

  const SLOT_TIMES = buildHourlySlots(6, 20);
  const OTP_LENGTH = 6;
  const OTP_TTL_MINUTES = 10;

  const DEFAULT_HOME_HERO_IMAGE = "assets/logo.png";
  const DEFAULT_ABOUT_PHOTO = "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1200&q=80";

  const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function uid(prefix) {
    return prefix + "_" + Math.random().toString(36).slice(2, 9);
  }

  function isoDateFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function formatDate(value) {
    const d = new Date(value + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  function formatDateTime(value) {
    const d = new Date(value);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function to12Hour(time24) {
    const [hRaw, m] = time24.split(":");
    const h = Number(hRaw);
    const ampm = h >= 12 ? "PM" : "AM";
    const normalized = h % 12 || 12;
    return normalized + ":" + m + " " + ampm;
  }

  function stars(rating) {
    return "*".repeat(Math.max(1, Math.min(5, Number(rating) || 5)));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusClass(value) {
    if (!value) return "pending";
    const v = value.toLowerCase();
    if (v.includes("confirm") || v.includes("reply")) return "confirmed";
    if (v.includes("complete") || v.includes("done")) return "complete";
    return "pending";
  }

  function buildDefaultDayAvailability() {
    const day = {};
    SLOT_TIMES.forEach((slot) => {
      day[slot] = true;
    });
    return day;
  }

  function defaultAvailabilityDefaults() {
    const defaults = {};
    for (let day = 0; day < 7; day += 1) {
      defaults[String(day)] = buildDefaultDayAvailability();
    }
    return defaults;
  }

  function sanitizeDayAvailability(rawDay) {
    const day = buildDefaultDayAvailability();
    if (!rawDay || typeof rawDay !== "object" || Array.isArray(rawDay)) return day;
    SLOT_TIMES.forEach((slot) => {
      if (slot in rawDay) {
        day[slot] = rawDay[slot] !== false;
      }
    });
    return day;
  }

  function getAvailabilityDefaultsMap() {
    const raw = load(KEYS.availabilityDefaults, null);
    const fallback = defaultAvailabilityDefaults();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      save(KEYS.availabilityDefaults, fallback);
      return fallback;
    }

    const next = {};
    for (let day = 0; day < 7; day += 1) {
      const key = String(day);
      next[key] = sanitizeDayAvailability(raw[key]);
    }
    return next;
  }

  function saveAvailabilityDefaultsMap(map) {
    const next = {};
    for (let day = 0; day < 7; day += 1) {
      const key = String(day);
      next[key] = sanitizeDayAvailability(map ? map[key] : null);
    }
    save(KEYS.availabilityDefaults, next);
    return next;
  }

  function getWeekdayIndexFromIsoDate(date) {
    if (!date) return null;
    const d = new Date(date + "T00:00:00");
    return Number.isNaN(d.getTime()) ? null : d.getDay();
  }

  function getDefaultSlotOpenForDate(date, time, defaultsMap) {
    if (!date || !time) return true;
    const dayIndex = getWeekdayIndexFromIsoDate(date);
    if (dayIndex == null) return true;
    const source = defaultsMap && typeof defaultsMap === "object" && !Array.isArray(defaultsMap)
      ? defaultsMap
      : getAvailabilityDefaultsMap();
    const dayDefaults = source[String(dayIndex)];
    if (!dayDefaults || typeof dayDefaults !== "object" || Array.isArray(dayDefaults)) return true;
    if (!(time in dayDefaults)) return true;
    return dayDefaults[time] !== false;
  }

  function getAvailabilityMap() {
    const raw = load(KEYS.availability, {});
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      save(KEYS.availability, {});
      return {};
    }

    const next = {};
    Object.keys(raw).forEach((date) => {
      const dayRaw = raw[date];
      if (!dayRaw || typeof dayRaw !== "object" || Array.isArray(dayRaw)) return;
      const day = {};
      SLOT_TIMES.forEach((slot) => {
        if (slot in dayRaw) {
          day[slot] = dayRaw[slot] !== false;
        }
      });
      if (Object.keys(day).length) {
        next[date] = day;
      }
    });
    return next;
  }

  function isSlotOpenByAvailability(date, time, availabilityMap, defaultsMap) {
    if (!date || !time) return true;
    const source = availabilityMap && typeof availabilityMap === "object" && !Array.isArray(availabilityMap)
      ? availabilityMap
      : getAvailabilityMap();
    const day = source[date];
    if (day && typeof day === "object" && !Array.isArray(day) && time in day) {
      return day[time] !== false;
    }
    return getDefaultSlotOpenForDate(date, time, defaultsMap);
  }

  function setSlotAvailability(date, time, isOpen) {
    if (!date || !time) return getAvailabilityMap();
    const map = { ...getAvailabilityMap() };
    const defaults = getAvailabilityDefaultsMap();
    const daySource = map[date];
    const day = daySource && typeof daySource === "object" && !Array.isArray(daySource) ? { ...daySource } : {};
    const normalizedOpen = Boolean(isOpen);
    const defaultOpen = getDefaultSlotOpenForDate(date, time, defaults);

    if (normalizedOpen === defaultOpen) {
      delete day[time];
    } else {
      day[time] = normalizedOpen;
    }

    if (Object.keys(day).length) {
      map[date] = day;
    } else {
      delete map[date];
    }

    save(KEYS.availability, map);
    return map;
  }

  function defaultSiteSettings() {
    return {
      homeHeroTitle: "Charge your body. Build your strongest routine.",
      homeHeroText: "Personal coaching designed for real schedules. New clients can request a consultation, existing clients can book sessions, track progress, and stay connected with your trainer in one place.",
      homeHeroImage: DEFAULT_HOME_HERO_IMAGE,
      aboutPhoto: DEFAULT_ABOUT_PHOTO,
      aboutHeading: "Meet your Thunder Fitness coach",
      aboutIntro: "The Thunder Fitness approach combines accountable coaching, high-energy sessions, and practical habits to help clients feel stronger and stay consistent.",
      aboutSpecialties: "Specialties: strength training, body composition, beginner confidence building, athletic conditioning, and long-term routine design.",
      aboutCertifications: "NASM-CPT, CPR/AED, Precision Nutrition L1 (placeholder)",
      aboutCoachingStyle: "Positive accountability, progress tracking, and clear weekly targets",
      aboutServing: "In-person and online (placeholder region)",
      aboutLocationNote: "Placeholder studio location map for Thunder Fitness.",
      aboutMapQuery: "Manhattan, New York"
    };
  }

  function getSiteSettings() {
    return { ...defaultSiteSettings(), ...load(KEYS.siteSettings, {}) };
  }

  function saveSiteSettings(partialSettings) {
    const next = { ...getSiteSettings(), ...partialSettings };
    save(KEYS.siteSettings, next);
    return next;
  }

  function normalizeImageSrc(value, fallback) {
    const src = (value || "").trim();
    return src || fallback;
  }

  function normalizeHomeMediaSrc(value) {
    return normalizeImageSrc(value, DEFAULT_HOME_HERO_IMAGE);
  }

  function normalizeAboutPhotoSrc(value) {
    return normalizeImageSrc(value, DEFAULT_ABOUT_PHOTO);
  }

  function normalizeAboutMapQuery(value) {
    const query = (value || "").trim();
    return query || "Manhattan, New York";
  }

  function buildAboutMapSrc(value) {
    const query = normalizeAboutMapQuery(value);
    if (/^https?:\/\//i.test(query)) {
      return query;
    }
    return "https://www.google.com/maps?q=" + encodeURIComponent(query) + "&output=embed";
  }

  function readImageFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve("");
        return;
      }

      if (!file.type || !file.type.startsWith("image/")) {
        reject(new Error("Please choose an image file."));
        return;
      }

      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("Could not read selected image."));
      };
      reader.readAsDataURL(file);
    });
  }
  function applySiteCustomization() {
    const settings = getSiteSettings();
    const page = document.body && document.body.dataset ? document.body.dataset.page : "";

    if (page === "home") {
      const title = document.getElementById("homeHeroTitle");
      const text = document.getElementById("homeHeroText");
      const heroImage = document.getElementById("homeHeroImage");

      if (title) title.textContent = settings.homeHeroTitle;
      if (text) text.textContent = settings.homeHeroText;
      if (heroImage) {
        heroImage.src = normalizeHomeMediaSrc(settings.homeHeroImage);
      }
    }

    if (page === "about") {
      const heading = document.getElementById("aboutHeading");
      const intro = document.getElementById("aboutIntro");
      const specialties = document.getElementById("aboutSpecialties");
      const certifications = document.getElementById("aboutCertifications");
      const coachingStyle = document.getElementById("aboutCoachingStyle");
      const serving = document.getElementById("aboutServing");
      const locationNote = document.getElementById("aboutLocationNote");
      const aboutPhoto = document.getElementById("aboutPhoto");
      const mapEmbed = document.getElementById("aboutMapEmbed");

      if (heading) heading.textContent = settings.aboutHeading;
      if (intro) intro.textContent = settings.aboutIntro;
      if (specialties) specialties.textContent = settings.aboutSpecialties;
      if (certifications) certifications.innerHTML = "<strong>Certifications:</strong> " + escapeHtml(settings.aboutCertifications);
      if (coachingStyle) coachingStyle.innerHTML = "<strong>Coaching style:</strong> " + escapeHtml(settings.aboutCoachingStyle);
      if (serving) serving.innerHTML = "<strong>Serving:</strong> " + escapeHtml(settings.aboutServing);
      if (locationNote) locationNote.textContent = settings.aboutLocationNote;
      if (aboutPhoto) aboutPhoto.src = normalizeAboutPhotoSrc(settings.aboutPhoto);
      if (mapEmbed) mapEmbed.src = buildAboutMapSrc(settings.aboutMapQuery);
    }
  }
  function defaultSeedReviews() {
    return [
      {
        id: uid("review"),
        name: "Anonymous Client",
        anonymous: true,
        rating: 5,
        text: "Calvin is amazing. I've had three joint replacements and had my torso sutured back together. I wouldn't be where I am if he wasn't helping me. He's a lot of fun, encouraging, and if something is too much, he can easily modify it for you.",
        createdAt: new Date().toISOString(),
        showOnHome: true
      },
      {
        id: uid("review"),
        name: "Anonymous Client",
        anonymous: true,
        rating: 5,
        text: "This gym location is clean with many workout options. I especially appreciate Calvin as my trainer. He does a great job and tailors the workouts to your requests as he learns what you want to do.",
        createdAt: new Date().toISOString(),
        showOnHome: true
      }
    ];
  }

  function migrateLegacySeedReviews() {
    const rows = load(KEYS.reviews, []);
    if (!Array.isArray(rows) || !rows.length) return;

    const legacyTexts = new Set([
      "I feel stronger and way more confident in six weeks than I have in years.",
      "Flexible scheduling and clear workout plans made this easy to stick to.",
      "The check-ins and custom programming helped me finally stay consistent."
    ]);

    const hasLegacyPlaceholders = rows.some((row) => {
      const text = (row && row.text ? String(row.text) : "").trim();
      const name = (row && row.name ? String(row.name) : "").trim();
      return legacyTexts.has(text) || name === "Alex R." || name === "Sam K.";
    });

    if (!hasLegacyPlaceholders) return;
    save(KEYS.reviews, defaultSeedReviews());
  }

  function seedData() {
    if (localStorage.getItem(KEYS.seeded)) return;

    const users = [
      { id: "c_001", name: "Jordan Lane", email: "jordan@example.com", phone: "(555) 101-2001", pin: "1234", plan: "Strength Build", requiresConsultation: false },
      { id: "c_002", name: "Taylor Brooks", email: "taylor@example.com", phone: "(555) 101-2002", pin: "5678", plan: "Conditioning Reset", requiresConsultation: false },
      { id: "c_003", name: "Morgan Diaz", email: "morgan@example.com", phone: "(555) 101-2003", pin: "2468", plan: "Athletic Core", requiresConsultation: false }
    ];

    const reviews = defaultSeedReviews();

    const assignments = [
      {
        id: uid("asg"),
        clientId: "c_001",
        clientName: "Jordan Lane",
        clientEmail: "jordan@example.com",
        title: "Week 1 Foundation",
        description: "3 full body sessions + 2 recovery walks (30 min).",
        dueDate: isoDateFromNow(6),
        progress: 40,
        status: "In Progress",
        createdAt: new Date().toISOString()
      },
      {
        id: uid("asg"),
        clientId: "c_002",
        clientName: "Taylor Brooks",
        clientEmail: "taylor@example.com",
        title: "Conditioning Circuit A",
        description: "4 rounds EMOM + mobility finish. Track average heart rate.",
        dueDate: isoDateFromNow(4),
        progress: 75,
        status: "In Progress",
        createdAt: new Date().toISOString()
      }
    ];

    const bookings = [
      {
        id: uid("book"),
        date: isoDateFromNow(1),
        time: "18:00",
        type: "Session",
        clientName: "Jordan Lane",
        clientEmail: "jordan@example.com",
        notes: "Lower body focus",
        status: "Confirmed",
        createdAt: new Date().toISOString()
      }
    ];

    const messages = [
      {
        id: uid("msg"),
        fromName: "Taylor Brooks",
        fromEmail: "taylor@example.com",
        subject: "Program question",
        message: "Can I swap treadmill intervals for a bike day this week?",
        fromType: "Existing Client",
        createdAt: new Date().toISOString(),
        status: "New",
        response: "",
        respondedAt: ""
      }
    ];

    const consultations = [
      {
        id: uid("consult"),
        name: "Casey Moore",
        email: "casey@example.com",
        phone: "555-0123",
        goal: "Weight loss",
        message: "Looking for accountability and a beginner plan.",
        preferredDate: isoDateFromNow(3),
        status: "Pending",
        createdAt: new Date().toISOString()
      }
    ];

    save(KEYS.users, users);
    save(KEYS.reviews, reviews);
    save(KEYS.assignments, assignments);
    save(KEYS.bookings, bookings);
    save(KEYS.messages, messages);
    save(KEYS.consultations, consultations);
    save(KEYS.siteSettings, defaultSiteSettings());
    save(KEYS.pendingSignups, []);
    save(KEYS.availability, {});
    save(KEYS.availabilityDefaults, defaultAvailabilityDefaults());
    localStorage.setItem(KEYS.seeded, "true");
  }

  function getCurrentClient() {
    return load(KEYS.currentClient, null);
  }

  function getUserByEmail(email) {
    const normalizedEmail = (email || "").trim().toLowerCase();
    if (!normalizedEmail) return null;
    return load(KEYS.users, []).find((user) => (user.email || "").trim().toLowerCase() === normalizedEmail) || null;
  }

  function normalizeEmail(value) {
    return (value || "").trim().toLowerCase();
  }

  function getPendingSignups() {
    return load(KEYS.pendingSignups, []);
  }

  function savePendingSignups(rows) {
    save(KEYS.pendingSignups, rows);
  }

  function getPendingSignupByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return null;
    return getPendingSignups().find((item) => normalizeEmail(item.email) === normalizedEmail) || null;
  }

  function getMostRecentPendingSignup() {
    const rows = getPendingSignups().slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return rows[0] || null;
  }

  function upsertPendingSignup(record) {
    const normalizedEmail = normalizeEmail(record && record.email);
    if (!normalizedEmail) return null;
    const rows = getPendingSignups().filter((item) => normalizeEmail(item.email) !== normalizedEmail);
    const pending = { ...record, email: normalizedEmail };
    rows.unshift(pending);
    savePendingSignups(rows);
    return pending;
  }

  function removePendingSignup(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;
    const rows = getPendingSignups().filter((item) => normalizeEmail(item.email) !== normalizedEmail);
    savePendingSignups(rows);
  }

  function generateOtpCode() {
    const min = Math.pow(10, OTP_LENGTH - 1);
    const max = Math.pow(10, OTP_LENGTH) - 1;
    return String(Math.floor(Math.random() * (max - min + 1) + min));
  }

  function getOtpExpiryIso() {
    return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
  }

  function isPendingSignupExpired(pending) {
    if (!pending || !pending.expiresAt) return true;
    return new Date(pending.expiresAt).getTime() <= Date.now();
  }

  function maskEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !normalizedEmail.includes("@")) return normalizedEmail;
    const parts = normalizedEmail.split("@");
    const name = parts[0];
    const domain = parts[1];
    const visible = name.slice(0, 2);
    const hiddenCount = Math.max(1, name.length - 2);
    return visible + "*".repeat(hiddenCount) + "@" + domain;
  }

  async function sendSignupOtpEmail(pending) {
    const endpoint = (window.THUNDER_OTP_ENDPOINT || "").trim();
    if (!endpoint) {
      return { sent: true, mode: "demo" };
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: pending.email,
          name: pending.name,
          code: pending.otpCode,
          ttlMinutes: OTP_TTL_MINUTES,
          brand: "Thunder Fitness"
        })
      });

      return { sent: response.ok, mode: "api" };
    } catch (_error) {
      return { sent: false, mode: "api" };
    }
  }

  function buildOtpNoticeText(pending, deliveryResult) {
    const baseText = "Enter the " + OTP_LENGTH + "-digit code sent to " + maskEmail(pending.email) + ".";
    if (deliveryResult.mode === "demo") {
      return baseText + " Demo OTP: " + pending.otpCode;
    }
    if (deliveryResult.sent) {
      return baseText + " It expires in " + OTP_TTL_MINUTES + " minutes.";
    }
    return "We could not deliver the OTP email right now. Please use Resend OTP.";
  }

  function clientHasConsultationBooking(client) {
    if (!client || !client.email) return false;
    const normalizedEmail = client.email.trim().toLowerCase();
    return load(KEYS.bookings, []).some((booking) => {
      const sameEmail = (booking.clientEmail || "").trim().toLowerCase() === normalizedEmail;
      const isConsult = (booking.type || "").toLowerCase() === "consultation";
      return sameEmail && isConsult;
    });
  }

  function clientNeedsConsultation(client) {
    return Boolean(client && client.requiresConsultation);
  }

  function markConsultationCompleteForEmail(email) {
    const normalizedEmail = (email || "").trim().toLowerCase();
    if (!normalizedEmail) return;

    const users = load(KEYS.users, []);
    let changed = false;
    const updatedUsers = users.map((user) => {
      if ((user.email || "").trim().toLowerCase() !== normalizedEmail) {
        return user;
      }
      changed = true;
      return { ...user, requiresConsultation: false };
    });

    if (changed) {
      save(KEYS.users, updatedUsers);
    }

    const current = getCurrentClient();
    if (current && (current.email || "").trim().toLowerCase() === normalizedEmail) {
      save(KEYS.currentClient, { ...current, requiresConsultation: false });
    }
  }

  function getPendingAction() {
    const pending = load(KEYS.pendingAction, null);
    if (!pending || typeof pending !== "object" || Array.isArray(pending)) {
      return null;
    }
    return pending;
  }

  function savePendingAction(action) {
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      localStorage.removeItem(KEYS.pendingAction);
      return;
    }
    save(KEYS.pendingAction, action);
  }

  function clearPendingAction() {
    localStorage.removeItem(KEYS.pendingAction);
  }

  function submitPendingBookingForClient(client, pendingPayload) {
    const payload = pendingPayload && typeof pendingPayload === "object" ? pendingPayload : {};
    const date = (payload.date || "").trim();
    const time = (payload.time || "").trim();
    const type = (payload.type || "Session").trim() || "Session";

    if (!date || !time) {
      return { ok: false, message: "Your saved booking draft was missing date/time. Please choose a slot again." };
    }

    if (!client || !client.email || !client.name || !client.phone) {
      return { ok: false, message: "Your account needs name, email, and phone before booking." };
    }

    const rows = load(KEYS.bookings, []);
    const slotTaken = rows.some((row) => row.date === date && row.time === time);
    const trainerOpen = isSlotOpenByAvailability(date, time);
    if (slotTaken || !trainerOpen) {
      return { ok: false, message: "That saved booking slot is no longer open. Please choose another available time." };
    }

    const booking = {
      id: uid("book"),
      date: date,
      time: time,
      type: type,
      clientName: client.name,
      clientEmail: client.email,
      clientPhone: client.phone,
      notes: (payload.notes || "").trim(),
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    const recurring = payload.recurring;
    if (recurring && recurring.requested) {
      booking.recurring = {
        requested: true,
        frequency: recurring.frequency || "Weekly",
        count: Number(recurring.count || 4),
        status: "Pending Approval",
        requestedAt: new Date().toISOString()
      };
      booking.status = "Needs Review";
    }

    const needsFirstSessionReview = Boolean(clientNeedsConsultation(client) && type === "Session");
    if (needsFirstSessionReview) {
      booking.status = "Needs Review";
    }

    rows.push(booking);
    save(KEYS.bookings, rows);

    if (type === "Consultation" && clientNeedsConsultation(client)) {
      markConsultationCompleteForEmail(client.email);
      return { ok: true, message: "Consultation booking submitted and added to your portal." };
    }

    if (needsFirstSessionReview) {
      return { ok: true, message: "First session request submitted. The trainer will review it in the dashboard." };
    }

    if (booking.recurring && booking.recurring.requested) {
      return { ok: true, message: "Recurring booking request submitted. The trainer will review and confirm." };
    }

    return { ok: true, message: "Booking request submitted and added to your portal." };
  }

  function submitPendingConsultationForClient(client, pendingPayload) {
    const payload = pendingPayload && typeof pendingPayload === "object" ? pendingPayload : {};
    const preferredDate = (payload.preferredDate || "").trim();
    const preferredTime = (payload.preferredTime || "").trim();

    if (!preferredDate || !preferredTime) {
      return { ok: false, message: "Your saved consultation draft was missing a selected slot. Please choose a new slot." };
    }

    if (!client || !client.email || !client.name || !client.phone) {
      return { ok: false, message: "Your account needs name, email, and phone before requesting a consultation." };
    }

    const goal = (payload.goal || "").trim();
    if (!goal) {
      return { ok: false, message: "Please choose a goal for your consultation request." };
    }

    const bookings = load(KEYS.bookings, []);
    const slotTaken = bookings.some((row) => row.date === preferredDate && row.time === preferredTime);
    const trainerOpen = isSlotOpenByAvailability(preferredDate, preferredTime);
    if (slotTaken || !trainerOpen) {
      return { ok: false, message: "That saved consultation slot is no longer open. Please choose another available time." };
    }

    const consultation = {
      id: uid("consult"),
      name: client.name,
      email: client.email,
      phone: client.phone,
      goal: goal,
      message: (payload.message || "").trim(),
      preferredDate: preferredDate,
      preferredTime: preferredTime,
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    const consultations = load(KEYS.consultations, []);
    consultations.unshift(consultation);
    save(KEYS.consultations, consultations);

    bookings.push({
      id: uid("book"),
      date: preferredDate,
      time: preferredTime,
      type: "Consultation",
      clientName: client.name,
      clientEmail: client.email,
      clientPhone: client.phone,
      notes: consultation.message,
      status: "Pending",
      createdAt: new Date().toISOString(),
      consultationRequestId: consultation.id
    });
    save(KEYS.bookings, bookings);

    markConsultationCompleteForEmail(client.email);
    return {
      ok: true,
      message: "Consultation request submitted for " + formatDate(preferredDate) + " at " + to12Hour(preferredTime) + "."
    };
  }

  function finalizePendingActionForClient(client) {
    const pending = getPendingAction();
    if (!pending || !client) return null;

    const type = (pending.type || "").trim();
    let result = null;
    if (type === "booking") {
      result = submitPendingBookingForClient(client, pending.payload);
    } else if (type === "consultation") {
      result = submitPendingConsultationForClient(client, pending.payload);
    } else {
      result = { ok: false, message: "Saved booking request type was not recognized." };
    }

    clearPendingAction();
    return result;
  }
  function setNotice(node, type, text) {
    if (!node) return;
    node.className = "notice " + type;
    node.textContent = text;
  }

  function clearNotice(node) {
    if (!node) return;
    node.className = "notice";
    node.textContent = "";
  }

  function populateDateOptions(select, days, startOffset) {
    if (!select) return;
    const offset = Number.isFinite(startOffset) ? Math.max(0, startOffset) : 0;
    select.innerHTML = "";
    for (let i = 0; i < days; i += 1) {
      const d = isoDateFromNow(i + offset);
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = formatDate(d);
      select.appendChild(opt);
    }
  }

  function populateTimeOptions(select, selectedDate) {
    if (!select) return;
    const bookings = load(KEYS.bookings, []);
    const availabilityMap = getAvailabilityMap();
    const blocked = new Set(bookings.filter((b) => b.date === selectedDate).map((b) => b.time));
    const previousValue = select.value;
    select.innerHTML = "";

    const openSlots = SLOT_TIMES.filter((slot) => {
      const isBooked = blocked.has(slot);
      const trainerOpen = isSlotOpenByAvailability(selectedDate, slot, availabilityMap);
      return !isBooked && trainerOpen;
    });

    if (!openSlots.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No available times";
      empty.disabled = true;
      empty.selected = true;
      select.appendChild(empty);
      return;
    }

    openSlots.forEach((slot) => {
      const opt = document.createElement("option");
      opt.value = slot;
      opt.textContent = to12Hour(slot);
      select.appendChild(opt);
    });

    const sameValue = [...select.options].find((opt) => opt.value === previousValue);
    if (sameValue) {
      sameValue.selected = true;
    }
  }

  function renderCalendarBoard(container, options) {
    if (!container) return;

    const opts = typeof options === "function" ? { onPick: options } : options || {};
    const bookings = load(KEYS.bookings, []);
    const availabilityMap = getAvailabilityMap();
    const availabilityDefaultsMap = getAvailabilityDefaultsMap();
    const startOffset = Number.isFinite(opts.startOffset) ? Math.max(0, opts.startOffset) : 0;
    const selectedDate = opts.selectedDate || "";
    const selectedTime = opts.selectedTime || "";
    const adminMode = opts.mode === "admin-availability";

    container.innerHTML = "";

    for (let i = 0; i < 7; i += 1) {
      const date = isoDateFromNow(startOffset + i);
      const day = document.createElement("div");
      day.className = "day-card";
      if (!adminMode && date === selectedDate) {
        day.classList.add("selected-day");
      }

      const title = document.createElement("strong");
      title.textContent = formatDate(date);
      day.appendChild(title);

      const slotsWrap = document.createElement("div");
      slotsWrap.className = "slot-pill-grid";
      let visibleSlots = 0;

      SLOT_TIMES.forEach((slot) => {
        const hasBooking = bookings.some((b) => b.date === date && b.time === slot);
        const trainerOpen = isSlotOpenByAvailability(date, slot, availabilityMap, availabilityDefaultsMap);
        const slotState = hasBooking ? "booked" : trainerOpen ? "open" : "closed";

        if (!adminMode && slotState !== "open") {
          return;
        }

        const isSelected = !adminMode && date === selectedDate && slot === selectedTime;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "slot-pill " + slotState;
        if (isSelected) {
          btn.classList.add("selected");
        }
        btn.setAttribute("aria-pressed", isSelected ? "true" : "false");

        if (adminMode) {
          btn.textContent = slotState === "booked" ? to12Hour(slot) + " booked" : to12Hour(slot);
          btn.disabled = hasBooking;
          btn.title = hasBooking
            ? "Booked (cannot edit)"
            : trainerOpen
              ? "Open (click to mark unavailable)"
              : "Unavailable (click to reopen)";
          btn.setAttribute("aria-label", to12Hour(slot) + " " + slotState);
        } else {
          btn.textContent = to12Hour(slot);
          btn.disabled = false;
          btn.title = "Available";
          btn.setAttribute("aria-label", to12Hour(slot) + " available");
        }

        btn.addEventListener("click", function () {
          if (typeof opts.onPick === "function") {
            opts.onPick(date, slot, {
              isBooked: hasBooking,
              isOpen: trainerOpen,
              state: slotState
            });
          }
        });

        visibleSlots += 1;
        slotsWrap.appendChild(btn);
      });

      if (!adminMode && visibleSlots === 0) {
        const empty = document.createElement("div");
        empty.className = "day-empty";
        empty.textContent = "No open times";
        slotsWrap.appendChild(empty);
      }

      day.appendChild(slotsWrap);
      container.appendChild(day);
    }
  }

  function initHome() {
    const reviews = load(KEYS.reviews, []).filter((item) => item.showOnHome !== false);
    const quote = document.getElementById("rotatorQuote");
    const meta = document.getElementById("rotatorMeta");
    const starsNode = document.getElementById("rotatorStars");
    const extra = document.getElementById("rotatorExtra");
    const adGraphic = document.getElementById("rotatorAdGraphic");
    const panel = document.getElementById("reviewRotatorPanel") || (quote ? quote.closest(".review-rotator") : null);
    const total = document.getElementById("homeReviewCount");

    if (!quote) return;
    if (total) total.textContent = String(reviews.length);

    const classSlide = {
      type: "class",
      title: "CAListhenics with CAL",
      schedule: "Sponsored Class Ad - Wednesdays at 11:00 AM",
      details: "Bodyweight-focused class for coordination, endurance, strength, and mobility. Great for all levels."
    };

    const slides = [];
    let reviewIndex = 0;
    let slot = 1;
    while (reviewIndex < reviews.length) {
      if (slot % 3 === 0) {
        slides.push(classSlide);
      } else {
        slides.push({ type: "review", item: reviews[reviewIndex] });
        reviewIndex += 1;
      }
      slot += 1;
    }

    if (!slides.some((slide) => slide.type === "class")) {
      slides.push(classSlide);
    }

    let index = 0;
    const paint = function () {
      const slide = slides[index];
      if (slide.type === "class") {
        if (panel) panel.classList.add("is-ad");
        if (adGraphic) adGraphic.setAttribute("aria-hidden", "false");
        quote.textContent = slide.title;
        if (meta) meta.textContent = slide.schedule;
        if (extra) extra.textContent = slide.details;
        if (starsNode) starsNode.textContent = "";
      } else {
        const item = slide.item;
        if (panel) panel.classList.remove("is-ad");
        if (adGraphic) adGraphic.setAttribute("aria-hidden", "true");
        quote.textContent = "\"" + item.text + "\"";
        if (meta) meta.textContent = (item.anonymous ? "Anonymous Client" : item.name) + " - " + new Date(item.createdAt).toLocaleDateString();
        if (extra) extra.textContent = "";
        if (starsNode) starsNode.textContent = stars(item.rating);
      }
      index = (index + 1) % slides.length;
    };

    paint();
    if (slides.length > 1) {
      setInterval(paint, 8500);
    }
  }

  function initConsultForm() {
    const form = document.getElementById("consultationForm");
    if (!form) return;

    const current = getCurrentClient();
    const notice = document.getElementById("consultationNotice");
    const slotDateInput = document.getElementById("consultPreferredDate");
    const slotTimeInput = document.getElementById("consultPreferredTime");
    const slotSummary = document.getElementById("consultSlotSummary");
    const board = document.getElementById("consultCalendarBoard");
    const rangeLabel = document.getElementById("consultCalendarRange");
    const prevWeekBtn = document.getElementById("consultPrevWeek");
    const nextWeekBtn = document.getElementById("consultNextWeek");

    const nameField = form.querySelector('input[name="name"]');
    const emailField = form.querySelector('input[name="email"]');
    const phoneField = form.querySelector('input[name="phone"]');
    if (current) {
      if (nameField) nameField.value = current.name || "";
      if (emailField) emailField.value = current.email || "";
      if (phoneField) phoneField.value = current.phone || "";
    }

    const DATE_OPTION_DAYS = 84;
    const MAX_CALENDAR_OFFSET = DATE_OPTION_DAYS - 7;
    let calendarStartOffset = 0;

    function dayOffsetFromToday(dateValue) {
      if (!dateValue) return 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(dateValue + "T00:00:00");
      if (Number.isNaN(target.getTime())) return 0;
      const diff = Math.floor((target.getTime() - today.getTime()) / 86400000);
      return Math.max(0, diff);
    }

    function updateCalendarRangeLabel() {
      if (!rangeLabel) return;
      const startDate = isoDateFromNow(calendarStartOffset);
      const endDate = isoDateFromNow(calendarStartOffset + 6);
      rangeLabel.textContent = "Showing " + formatDate(startDate) + " to " + formatDate(endDate) + ". Click an open slot to choose your consultation time.";
    }

    function ensureSelectedSlotVisible() {
      if (!slotDateInput || !slotDateInput.value) return;
      const selectedOffset = dayOffsetFromToday(slotDateInput.value);
      if (selectedOffset < calendarStartOffset || selectedOffset > calendarStartOffset + 6) {
        const snapped = Math.floor(selectedOffset / 7) * 7;
        calendarStartOffset = Math.max(0, Math.min(MAX_CALENDAR_OFFSET, snapped));
      }
    }

    function clearSelectedSlot() {
      if (slotDateInput) slotDateInput.value = "";
      if (slotTimeInput) slotTimeInput.value = "";
      if (slotSummary) slotSummary.textContent = "No consultation slot selected yet.";
    }

    function setSelectedSlot(date, time) {
      if (slotDateInput) slotDateInput.value = date;
      if (slotTimeInput) slotTimeInput.value = time;
      if (slotSummary) slotSummary.textContent = "Selected: " + formatDate(date) + " at " + to12Hour(time);
    }

    function renderBoard() {
      if (!board) return;
      ensureSelectedSlotVisible();
      renderCalendarBoard(board, {
        startOffset: calendarStartOffset,
        selectedDate: slotDateInput ? slotDateInput.value : "",
        selectedTime: slotTimeInput ? slotTimeInput.value : "",
        onPick: function (date, slot) {
          setSelectedSlot(date, slot);
          renderBoard();
        }
      });

      if (prevWeekBtn) prevWeekBtn.disabled = calendarStartOffset <= 0;
      if (nextWeekBtn) nextWeekBtn.disabled = calendarStartOffset >= MAX_CALENDAR_OFFSET;
      updateCalendarRangeLabel();
    }

    if (prevWeekBtn) {
      prevWeekBtn.addEventListener("click", function () {
        calendarStartOffset = Math.max(0, calendarStartOffset - 7);
        renderBoard();
      });
    }

    if (nextWeekBtn) {
      nextWeekBtn.addEventListener("click", function () {
        calendarStartOffset = Math.min(MAX_CALENDAR_OFFSET, calendarStartOffset + 7);
        renderBoard();
      });
    }

    clearSelectedSlot();
    renderBoard();

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      clearNotice(notice);

      const data = new FormData(form);
      const draft = {
        name: (data.get("name") || "").toString().trim(),
        email: (data.get("email") || "").toString().trim(),
        phone: (data.get("phone") || "").toString().trim(),
        goal: (data.get("goal") || "").toString().trim(),
        message: (data.get("message") || "").toString().trim(),
        preferredDate: (slotDateInput && slotDateInput.value) || "",
        preferredTime: (slotTimeInput && slotTimeInput.value) || ""
      };

      if (!draft.name || !draft.email || !draft.phone || !draft.goal) {
        setNotice(notice, "error", "Please complete name, email, phone, and goal.");
        return;
      }

      if (!draft.preferredDate || !draft.preferredTime) {
        setNotice(notice, "error", "Please select your consultation slot directly from the calendar.");
        return;
      }

      const activeClient = getCurrentClient();
      if (!activeClient) {
        savePendingAction({
          type: "consultation",
          payload: draft,
          createdAt: new Date().toISOString()
        });
        setNotice(notice, "error", "Please sign in or create a client account to submit this consultation request. Redirecting to Client Portal...");
        window.location.href = "client-portal.html";
        return;
      }

      const payload = {
        id: uid("consult"),
        name: activeClient.name || draft.name,
        email: activeClient.email || draft.email,
        phone: activeClient.phone || draft.phone,
        goal: draft.goal,
        message: draft.message,
        preferredDate: draft.preferredDate,
        preferredTime: draft.preferredTime,
        status: "Pending",
        createdAt: new Date().toISOString()
      };

      const bookings = load(KEYS.bookings, []);
      const slotTaken = bookings.some((b) => b.date === payload.preferredDate && b.time === payload.preferredTime);
      const trainerOpen = isSlotOpenByAvailability(payload.preferredDate, payload.preferredTime);
      if (slotTaken || !trainerOpen) {
        setNotice(notice, "error", "That consultation slot is no longer available. Please pick another open time.");
        renderBoard();
        return;
      }

      const consultations = load(KEYS.consultations, []);
      consultations.unshift(payload);
      save(KEYS.consultations, consultations);

      bookings.push({
        id: uid("book"),
        date: payload.preferredDate,
        time: payload.preferredTime,
        type: "Consultation",
        clientName: payload.name,
        clientEmail: payload.email,
        clientPhone: payload.phone,
        notes: payload.message,
        status: "Pending",
        createdAt: new Date().toISOString(),
        consultationRequestId: payload.id
      });
      save(KEYS.bookings, bookings);

      markConsultationCompleteForEmail(payload.email);
      const refreshedClient = getCurrentClient();
      form.reset();
      if (nameField) nameField.value = (refreshedClient && refreshedClient.name) || payload.name;
      if (emailField) emailField.value = (refreshedClient && refreshedClient.email) || payload.email;
      if (phoneField) phoneField.value = (refreshedClient && refreshedClient.phone) || payload.phone;
      clearSelectedSlot();
      renderBoard();
      setNotice(notice, "success", "Consultation request submitted for " + formatDate(payload.preferredDate) + " at " + to12Hour(payload.preferredTime) + ".");
    });
  }

  function renderPrivateBookings(container, viewerEmail) {
    if (!container) return;
    const normalizedEmail = (viewerEmail || "").trim().toLowerCase();
    if (!normalizedEmail) {
      container.innerHTML = '<div class="list-item muted">Bookings are private. Sign into the Client Portal to view your own sessions.</div>';
      return;
    }

    const rows = load(KEYS.bookings, [])
      .filter((row) => (row.clientEmail || "").trim().toLowerCase() === normalizedEmail)
      .sort((a, b) => {
        const aStamp = a.date + "T" + a.time;
        const bStamp = b.date + "T" + b.time;
        return aStamp.localeCompare(bStamp);
      });

    if (!rows.length) {
      container.innerHTML = '<div class="list-item muted">No private bookings found for this email yet.</div>';
      return;
    }

    container.innerHTML = rows
      .slice(0, 8)
      .map((row) => {
        const hasSuggestion = row.suggestedDate && row.suggestedTime;
        const suggestionHtml = hasSuggestion
          ? '<div class="muted"><strong>Trainer suggested:</strong> ' + formatDate(row.suggestedDate) + ' at ' + to12Hour(row.suggestedTime) + '</div>'
          : "";
        return (
          '<div class="list-item">' +
          formatDate(row.date) +
          " at " +
          to12Hour(row.time) +
          ' <span class="badge ' +
          statusClass(row.status) +
          '">' +
          escapeHtml(row.status) +
          '</span><br><span class="muted">' +
          escapeHtml(row.type) +
          "</span>" +
          suggestionHtml +
          "</div>"
        );
      })
      .join("");
  }

  function initBookingPage() {
    const form = document.getElementById("bookingForm");
    if (!form) return;

    const dateSelect = document.getElementById("bookingDate");
    const timeSelect = document.getElementById("bookingTime");
    const nameInput = document.getElementById("bookingName");
    const emailInput = document.getElementById("bookingEmail");
    const phoneInput = document.getElementById("bookingPhone");
    const typeSelect = document.getElementById("bookingType");
    const recurringToggle = document.getElementById("bookingRecurring");
    const recurringFields = document.getElementById("recurringFields");
    const recurringFrequency = document.getElementById("recurringFrequency");
    const recurringCount = document.getElementById("recurringCount");
    const notice = document.getElementById("bookingNotice");
    const board = document.getElementById("calendarBoard");
    const upcoming = document.getElementById("upcomingBookings");
    const rangeLabel = document.getElementById("calendarRangeLabel");
    const prevWeekBtn = document.getElementById("calendarPrevWeek");
    const nextWeekBtn = document.getElementById("calendarNextWeek");

    const DATE_OPTION_DAYS = 84;
    const MAX_CALENDAR_OFFSET = DATE_OPTION_DAYS - 7;
    let calendarStartOffset = 0;

    const current = getCurrentClient();
    const authGate = document.getElementById("bookingAuthGate");
    const authedContent = document.getElementById("bookingAuthedContent");

    if (!current) {
      if (authedContent) authedContent.classList.add("hidden");
      if (authGate) authGate.classList.remove("hidden");
      return;
    }
    if (authGate) authGate.classList.add("hidden");
    if (authedContent) authedContent.classList.remove("hidden");
    if (current) {
      nameInput.value = current.name || "";
      emailInput.value = current.email || "";
      if (phoneInput) phoneInput.value = current.phone || "";
      typeSelect.value = clientNeedsConsultation(current) ? "Consultation" : "Session";
    }

    function dayOffsetFromToday(dateValue) {
      if (!dateValue) return 0;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const target = new Date(dateValue + "T00:00:00");
      if (Number.isNaN(target.getTime())) return 0;
      const diff = Math.floor((target.getTime() - today.getTime()) / 86400000);
      return Math.max(0, diff);
    }

    function syncRecurringUi() {
      if (!recurringToggle || !recurringFields) return;
      const sessionType = typeSelect.value === "Session";
      recurringToggle.disabled = !sessionType;
      if (!sessionType) {
        recurringToggle.checked = false;
      }
      recurringFields.classList.toggle("hidden", !sessionType || !recurringToggle.checked);
    }

    function updateCalendarRangeLabel() {
      if (!rangeLabel) return;
      const startDate = isoDateFromNow(calendarStartOffset);
      const endDate = isoDateFromNow(calendarStartOffset + 6);
      rangeLabel.textContent = "Showing " + formatDate(startDate) + " to " + formatDate(endDate) + ". Click any open time to auto-fill the booking form.";
    }

    function ensureDateVisibleInBoard() {
      const selectedOffset = dayOffsetFromToday(dateSelect.value);
      if (selectedOffset < calendarStartOffset || selectedOffset > calendarStartOffset + 6) {
        const snapped = Math.floor(selectedOffset / 7) * 7;
        calendarStartOffset = Math.max(0, Math.min(MAX_CALENDAR_OFFSET, snapped));
      }
    }

    function renderBoard() {
      renderCalendarBoard(board, {
        startOffset: calendarStartOffset,
        selectedDate: dateSelect.value,
        selectedTime: timeSelect.value,
        onPick: function (date, slot) {
          dateSelect.value = date;
          populateTimeOptions(timeSelect, date);
          const opt = [...timeSelect.options].find((x) => x.value === slot && !x.disabled);
          if (opt) {
            opt.selected = true;
          }
          renderBoard();
          showBookingTypeGuidance();
        }
      });

      if (prevWeekBtn) prevWeekBtn.disabled = calendarStartOffset <= 0;
      if (nextWeekBtn) nextWeekBtn.disabled = calendarStartOffset >= MAX_CALENDAR_OFFSET;
      updateCalendarRangeLabel();
    }

    function showBookingTypeGuidance() {
      const selectedType = typeSelect.value;
      const activeClient = getCurrentClient();
      if (!activeClient) {
        setNotice(
          notice,
          "error",
          "Please sign in or create a client account before booking a consultation or session so your request can be confirmed in your portal."
        );
        return;
      }

      if (selectedType === "Session" && clientNeedsConsultation(activeClient)) {
        if (recurringToggle && recurringToggle.checked) {
          setNotice(notice, "success", "Recurring first-session requests are allowed and will be sent to the trainer for approval.");
          return;
        }
        setNotice(notice, "success", "You can request a first-time session, and it will be sent to the trainer for new-client review.");
        return;
      }

      if (clientNeedsConsultation(activeClient)) {
        setNotice(notice, "success", "Consultation is recommended first for new clients, but a first session request can still be reviewed.");
        return;
      }

      if (selectedType === "Session" && recurringToggle && recurringToggle.checked) {
        setNotice(notice, "success", "Recurring session request selected. Trainer approval is required before recurrence is activated.");
        return;
      }

      clearNotice(notice);
    }

    populateDateOptions(dateSelect, DATE_OPTION_DAYS);
    populateTimeOptions(timeSelect, dateSelect.value);

    dateSelect.addEventListener("change", function () {
      populateTimeOptions(timeSelect, dateSelect.value);
      ensureDateVisibleInBoard();
      renderBoard();
    });

    timeSelect.addEventListener("change", function () {
      renderBoard();
    });

    typeSelect.addEventListener("change", function () {
      syncRecurringUi();
      showBookingTypeGuidance();
    });

    if (recurringToggle) {
      recurringToggle.addEventListener("change", function () {
        syncRecurringUi();
        showBookingTypeGuidance();
      });
    }

    if (prevWeekBtn) {
      prevWeekBtn.addEventListener("click", function () {
        calendarStartOffset = Math.max(0, calendarStartOffset - 7);
        renderBoard();
      });
    }

    if (nextWeekBtn) {
      nextWeekBtn.addEventListener("click", function () {
        calendarStartOffset = Math.min(MAX_CALENDAR_OFFSET, calendarStartOffset + 7);
        renderBoard();
      });
    }

    renderPrivateBookings(upcoming, current ? current.email : "");
    syncRecurringUi();
    ensureDateVisibleInBoard();
    renderBoard();
    showBookingTypeGuidance();

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      clearNotice(notice);

      const payload = {
        id: uid("book"),
        date: dateSelect.value,
        time: timeSelect.value,
        type: typeSelect.value,
        clientName: nameInput.value.trim(),
        clientEmail: emailInput.value.trim(),
        clientPhone: phoneInput ? phoneInput.value.trim() : "",
        notes: document.getElementById("bookingNotes").value.trim(),
        status: "Pending",
        createdAt: new Date().toISOString()
      };

      const activeClient = getCurrentClient();
      if (!activeClient) {
        savePendingAction({
          type: "booking",
          payload: {
            date: payload.date,
            time: payload.time,
            type: payload.type,
            notes: payload.notes,
            recurring: Boolean(payload.type === "Session" && recurringToggle && recurringToggle.checked)
              ? {
                  requested: true,
                  frequency: recurringFrequency ? recurringFrequency.value : "Weekly",
                  count: Number((recurringCount && recurringCount.value) || "4")
                }
              : null
          },
          createdAt: new Date().toISOString()
        });
        setNotice(notice, "error", "Please sign in or create a client account to submit this booking request. Redirecting to Client Portal...");
        window.location.href = "client-portal.html";
        return;
      }

      if (!payload.clientName || !payload.clientEmail || !payload.clientPhone || !payload.date || !payload.time) {
        setNotice(notice, "error", "Please fill in name, email, phone, date, and an available time.");
        return;
      }

      payload.clientName = activeClient.name || payload.clientName;
      payload.clientEmail = activeClient.email || payload.clientEmail;
      payload.clientPhone = activeClient.phone || payload.clientPhone;

      const recurringRequested = Boolean(payload.type === "Session" && recurringToggle && recurringToggle.checked);
      if (recurringRequested) {
        payload.recurring = {
          requested: true,
          frequency: recurringFrequency ? recurringFrequency.value : "Weekly",
          count: Number((recurringCount && recurringCount.value) || "4"),
          status: "Pending Approval",
          requestedAt: new Date().toISOString()
        };
        payload.status = "Needs Review";
      }

      const rows = load(KEYS.bookings, []);
      const slotTaken = rows.some((b) => b.date === payload.date && b.time === payload.time);
      const trainerOpen = isSlotOpenByAvailability(payload.date, payload.time);
      if (slotTaken || !trainerOpen) {
        setNotice(notice, "error", "That slot is no longer available. Please choose a different open time.");
        populateTimeOptions(timeSelect, dateSelect.value);
        renderBoard();
        return;
      }

      const requiresFirstSessionReview = Boolean(clientNeedsConsultation(activeClient) && payload.type === "Session");
      if (requiresFirstSessionReview) {
        payload.status = "Needs Review";
      }

      rows.push(payload);
      save(KEYS.bookings, rows);

      let unlockedNow = false;
      if (clientNeedsConsultation(activeClient) && payload.type === "Consultation") {
        markConsultationCompleteForEmail(activeClient.email);
        unlockedNow = true;
      }

      if (recurringRequested && requiresFirstSessionReview) {
        setNotice(notice, "success", "Recurring first-session request submitted. The trainer must approve this request before recurrence is activated.");
      } else if (recurringRequested) {
        setNotice(notice, "success", "Recurring request submitted. The trainer will review and approve before recurrence is activated.");
      } else if (unlockedNow) {
        setNotice(notice, "success", "Consultation booked. Your client portal tools are now unlocked.");
      } else if (requiresFirstSessionReview) {
        setNotice(notice, "success", "First session request submitted. The trainer will review this new-client session request.");
      } else {
        setNotice(notice, "success", "Booking request submitted. You will see confirmation from the trainer dashboard.");
      }

      const portalClient = getCurrentClient() || activeClient;
      form.reset();
      if (portalClient) {
        nameInput.value = portalClient.name || "";
        emailInput.value = portalClient.email || "";
        if (phoneInput) phoneInput.value = portalClient.phone || "";
        typeSelect.value = clientNeedsConsultation(portalClient) ? "Consultation" : "Session";
      }

      populateDateOptions(dateSelect, DATE_OPTION_DAYS);
      populateTimeOptions(timeSelect, dateSelect.value);
      calendarStartOffset = 0;
      syncRecurringUi();
      ensureDateVisibleInBoard();
      renderBoard();
      renderPrivateBookings(upcoming, portalClient ? portalClient.email : "");
      showBookingTypeGuidance();
    });
  }
function renderClientAssignmentList(container, client) {
    if (!container || !client) return;
    const assignments = load(KEYS.assignments, []).filter((item) => {
      return item.clientId === client.id || item.clientEmail.toLowerCase() === client.email.toLowerCase();
    });

    if (!assignments.length) {
      container.innerHTML = '<div class="list-item muted">No workout assignments yet.</div>';
      return;
    }

    container.innerHTML = assignments
      .map((item) => {
        return (
          '<div class="list-item"><strong>' +
          escapeHtml(item.title) +
          "</strong> - due " +
          formatDate(item.dueDate) +
          '<div class="muted">' +
          escapeHtml(item.description) +
          '</div><div class="star-row">Progress: ' +
          escapeHtml(String(item.progress)) +
          "%</div></div>"
        );
      })
      .join("");
  }

  function renderClientBookings(container, client) {
    if (!container || !client) return;
    const rows = load(KEYS.bookings, [])
      .filter((b) => b.clientEmail.toLowerCase() === client.email.toLowerCase())
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    if (!rows.length) {
      container.innerHTML = '<div class="list-item muted">No sessions booked yet.</div>';
      return;
    }

    container.innerHTML = rows
      .map((row) => {
        return (
          '<div class="list-item">' +
          formatDate(row.date) +
          " at " +
          to12Hour(row.time) +
          ' <span class="badge ' +
          statusClass(row.status) +
          '">' +
          escapeHtml(row.status) +
          '</span><div class="muted">' +
          escapeHtml(row.type) +
          "</div></div>"
        );
      })
      .join("");
  }
  function renderClientMessageHistory(container, client) {
    if (!container || !client) return;

    const rows = load(KEYS.messages, [])
      .filter((item) => (item.fromEmail || "").trim().toLowerCase() === (client.email || "").trim().toLowerCase())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (!rows.length) {
      container.innerHTML = '<div class="list-item muted">No message history yet.</div>';
      return;
    }

    container.innerHTML = rows
      .map((row) => {
        const hasReply = Boolean((row.response || "").trim());
        return (
          '<div class="list-item"><strong>' +
          escapeHtml(row.subject || "General message") +
          '</strong><div class="muted">' +
          formatDateTime(row.createdAt) +
          '</div><div>' +
          escapeHtml(row.message || "") +
          '</div>' +
          (hasReply
            ? '<div class="panel" style="margin-top:0.6rem"><strong>Trainer reply</strong><div class="muted">' +
              (row.respondedAt ? formatDateTime(row.respondedAt) : "") +
              '</div><div>' +
              escapeHtml(row.response) +
              '</div></div>'
            : '<div class="muted" style="margin-top:0.5rem">Awaiting trainer response.</div>') +
          '</div>'
        );
      })
      .join("");
  }
  function initClientPortal() {
    const loginPanel = document.getElementById("clientLoginPanel");
    const dashPanel = document.getElementById("clientDashboard");
    const loginForm = document.getElementById("clientLoginForm");
    const signupForm = document.getElementById("clientSignupForm");
    const loginNotice = document.getElementById("clientLoginNotice");
    const signupNotice = document.getElementById("clientSignupNotice");
    const welcome = document.getElementById("clientWelcome");
    const subtitle = document.getElementById("portalSubtitle");
    const portalActionNotice = document.getElementById("portalActionNotice");
    const gatePanel = document.getElementById("consultationGate");
    const fullAccessArea = document.getElementById("clientFullAccessArea");
    const assignmentList = document.getElementById("clientAssignments");
    const bookingList = document.getElementById("clientBookings");
    const progressForm = document.getElementById("progressForm");
    const progressSelect = document.getElementById("progressAssignmentId");
    const progressNotice = document.getElementById("progressNotice");
    const messageForm = document.getElementById("messageForm");
    const messageNotice = document.getElementById("messageNotice");
    const messageHistory = document.getElementById("clientMessageHistory");
    const quickReviewForm = document.getElementById("quickReviewForm");
    const quickReviewNotice = document.getElementById("quickReviewNotice");
    const otpPanel = document.getElementById("otpVerificationPanel");
    const otpVerifyForm = document.getElementById("otpVerifyForm");
    const otpCodeInput = document.getElementById("otpCode");
    const otpResendBtn = document.getElementById("otpResendBtn");
    const otpNotice = document.getElementById("otpNotice");
    const otpEmailHint = document.getElementById("otpEmailHint");
    const logoutBtn = document.getElementById("clientLogout");
    let activePendingEmail = "";

    function setOtpPanelState(pending) {
      if (!otpPanel) return;
      if (!pending) {
        activePendingEmail = "";
        otpPanel.classList.add("hidden");
        if (otpCodeInput) otpCodeInput.value = "";
        clearNotice(otpNotice);
        return;
      }

      activePendingEmail = normalizeEmail(pending.email);
      otpPanel.classList.remove("hidden");
      if (otpEmailHint) {
        otpEmailHint.textContent =
          "Enter the " + OTP_LENGTH + "-digit code sent to " + maskEmail(pending.email) + ". Code expires in " + OTP_TTL_MINUTES + " minutes.";
      }
      if (otpCodeInput) {
        otpCodeInput.value = "";
      }
    }

    function refreshPortal() {
      let client = getCurrentClient();
      if (!client) {
        if (portalActionNotice) clearNotice(portalActionNotice);
        loginPanel.classList.remove("hidden");
        dashPanel.classList.add("hidden");
        setOtpPanelState(getMostRecentPendingSignup());
        return;
      }

      if (clientNeedsConsultation(client) && clientHasConsultationBooking(client)) {
        markConsultationCompleteForEmail(client.email);
        client = getCurrentClient() || { ...client, requiresConsultation: false };
      }

      const needsConsultation = clientNeedsConsultation(client);

      loginPanel.classList.add("hidden");
      dashPanel.classList.remove("hidden");
      setOtpPanelState(null);
      if (welcome) {
        welcome.textContent = needsConsultation
          ? "Welcome, " + client.name + ". One step left before full access."
          : "Welcome back, " + client.name + ".";
      }
      if (subtitle) {
        subtitle.textContent = needsConsultation
          ? "Book your consultation to unlock messaging, review submission, and progress tracking."
          : "View sessions, update assignment progress, message your trainer, and submit a review.";
      }

      if (gatePanel) gatePanel.classList.toggle("hidden", !needsConsultation);
      if (fullAccessArea) fullAccessArea.classList.toggle("hidden", needsConsultation);

      if (needsConsultation) {
        return;
      }

      renderClientAssignmentList(assignmentList, client);
      renderClientBookings(bookingList, client);
      renderClientMessageHistory(messageHistory, client);

      const assignments = load(KEYS.assignments, []).filter((item) => item.clientId === client.id || item.clientEmail === client.email);
      if (progressSelect) {
        progressSelect.innerHTML = "";
        assignments.forEach((item) => {
          const opt = document.createElement("option");
          opt.value = item.id;
          opt.textContent = item.title + " (" + item.progress + "%)";
          progressSelect.appendChild(opt);
        });
      }
    }

    function applyPendingActionResult(result, fallbackNotice) {
      if (!result) return;
      const node = portalActionNotice || fallbackNotice || loginNotice;
      if (!node) return;
      setNotice(node, result.ok ? "success" : "error", result.message);
    }

    function finalizePendingActionIfNeeded(fallbackNotice) {
      const client = getCurrentClient();
      if (!client) return null;
      const result = finalizePendingActionForClient(client);
      if (!result) return null;
      refreshPortal();
      applyPendingActionResult(result, fallbackNotice);
      return result;
    }
    function isFeatureLocked(client, noticeNode) {
      if (!client) {
        setNotice(noticeNode, "error", "Please log in first.");
        return true;
      }

      if (clientNeedsConsultation(client) && clientHasConsultationBooking(client)) {
        markConsultationCompleteForEmail(client.email);
        return false;
      }

      if (clientNeedsConsultation(client)) {
        setNotice(noticeNode, "error", "Please book your consultation first to unlock this feature.");
        return true;
      }

      return false;
    }

    if (loginForm) {
      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        clearNotice(loginNotice);
        const email = (document.getElementById("clientEmail").value || "").trim().toLowerCase();
        const pin = (document.getElementById("clientPin").value || "").trim();
        const user = load(KEYS.users, []).find((item) => item.email.toLowerCase() === email && item.pin === pin);
        if (!user) {
          const pending = getPendingSignupByEmail(email);
          if (pending) {
            setOtpPanelState(pending);
            setNotice(loginNotice, "error", "Your account is waiting for email OTP verification. Enter the code to finish setup.");
            return;
          }
          setNotice(loginNotice, "error", "Credentials not found. Use sign up if you are a new client.");
          return;
        }
        save(KEYS.currentClient, user);
        loginForm.reset();
        refreshPortal();
        finalizePendingActionIfNeeded(loginNotice);
      });
    }

    if (signupForm) {
      signupForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearNotice(signupNotice);
        clearNotice(otpNotice);

        const name = (document.getElementById("signupName").value || "").trim();
        const email = normalizeEmail(document.getElementById("signupEmail").value || "");
        const phone = (document.getElementById("signupPhone").value || "").trim();
        const pin = (document.getElementById("signupPin").value || "").trim();

        if (!name || !email || !phone || !pin) {
          setNotice(signupNotice, "error", "Please complete name, email, phone, and PIN.");
          return;
        }

        if (pin.length < 4) {
          setNotice(signupNotice, "error", "PIN must be at least 4 characters.");
          return;
        }

        if (getUserByEmail(email)) {
          setNotice(signupNotice, "error", "An account with that email already exists. Please sign in.");
          return;
        }

        const nowIso = new Date().toISOString();
        const pending = upsertPendingSignup({
          id: uid("pending"),
          name: name,
          email: email,
          phone: phone,
          pin: pin,
          otpCode: generateOtpCode(),
          expiresAt: getOtpExpiryIso(),
          attempts: 0,
          createdAt: nowIso,
          lastSentAt: nowIso
        });

        if (!pending) {
          setNotice(signupNotice, "error", "Could not start verification. Please try again.");
          return;
        }

        setOtpPanelState(pending);
        const deliveryResult = await sendSignupOtpEmail(pending);
        setNotice(
          signupNotice,
          deliveryResult.sent ? "success" : "error",
          deliveryResult.sent
            ? "Verification code sent. Enter the OTP below to activate your account."
            : "Could not send OTP email right now. Please try Resend OTP."
        );
        setNotice(otpNotice, deliveryResult.sent ? "success" : "error", buildOtpNoticeText(pending, deliveryResult));
      });
    }

    if (otpVerifyForm) {
      otpVerifyForm.addEventListener("submit", function (event) {
        event.preventDefault();
        clearNotice(otpNotice);
        clearNotice(signupNotice);

        const pendingEmail = activePendingEmail || normalizeEmail(document.getElementById("signupEmail").value || "");
        const pending = getPendingSignupByEmail(pendingEmail);
        if (!pending) {
          setNotice(otpNotice, "error", "Start sign up first so we can send your OTP.");
          return;
        }

        if (isPendingSignupExpired(pending)) {
          setNotice(otpNotice, "error", "This OTP expired. Click Resend OTP for a new code.");
          return;
        }

        const code = ((otpCodeInput && otpCodeInput.value) || "").replace(/\D/g, "");
        if (code.length !== OTP_LENGTH) {
          setNotice(otpNotice, "error", "Enter the full " + OTP_LENGTH + "-digit code.");
          return;
        }

        if (code !== String(pending.otpCode)) {
          const attempts = Number(pending.attempts || 0) + 1;
          upsertPendingSignup({ ...pending, attempts: attempts });
          setNotice(otpNotice, "error", "Incorrect OTP. Please try again.");
          return;
        }

        const users = load(KEYS.users, []);
        let account = users.find((item) => normalizeEmail(item.email) === normalizeEmail(pending.email));

        if (!account) {
          account = {
            id: uid("c"),
            name: pending.name,
            email: pending.email,
            phone: pending.phone || "",
            pin: pending.pin,
            plan: "Pending Consultation",
            requiresConsultation: true,
            createdAt: new Date().toISOString(),
            emailVerifiedAt: new Date().toISOString()
          };
          users.push(account);
          save(KEYS.users, users);
        } else {
          account = {
            ...account,
            name: account.name || pending.name,
            phone: account.phone || pending.phone || ""
          };
          const updatedUsers = users.map((item) => (item.id === account.id ? account : item));
          save(KEYS.users, updatedUsers);
        }

        removePendingSignup(pending.email);
        setOtpPanelState(null);
        if (signupForm) signupForm.reset();
        save(KEYS.currentClient, account);
        refreshPortal();
        const pendingResult = finalizePendingActionIfNeeded(loginNotice);
        if (!pendingResult) {
          setNotice(loginNotice, "success", "Email confirmed. Your account is active.");
        }
      });
    }

    if (otpResendBtn) {
      otpResendBtn.addEventListener("click", async function () {
        clearNotice(otpNotice);

        const pendingEmail = activePendingEmail || normalizeEmail(document.getElementById("signupEmail").value || "");
        const pending = getPendingSignupByEmail(pendingEmail);
        if (!pending) {
          setNotice(otpNotice, "error", "No pending signup found. Create your account first.");
          return;
        }

        const lastSentMs = pending.lastSentAt ? new Date(pending.lastSentAt).getTime() : 0;
        const remainingMs = lastSentMs ? 30000 - (Date.now() - lastSentMs) : 0;
        if (remainingMs > 0) {
          const seconds = Math.ceil(remainingMs / 1000);
          setNotice(otpNotice, "error", "Please wait " + seconds + " seconds before requesting another OTP.");
          return;
        }

        const refreshed = upsertPendingSignup({
          ...pending,
          otpCode: generateOtpCode(),
          expiresAt: getOtpExpiryIso(),
          attempts: 0,
          lastSentAt: new Date().toISOString()
        });
        setOtpPanelState(refreshed);

        const deliveryResult = await sendSignupOtpEmail(refreshed);
        setNotice(otpNotice, deliveryResult.sent ? "success" : "error", buildOtpNoticeText(refreshed, deliveryResult));
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        localStorage.removeItem(KEYS.currentClient);
        refreshPortal();
      });
    }

    if (progressForm) {
      progressForm.addEventListener("submit", function (event) {
        event.preventDefault();
        clearNotice(progressNotice);
        const client = getCurrentClient();
        if (isFeatureLocked(client, progressNotice)) {
          refreshPortal();
          return;
        }

        const assignmentId = progressSelect.value;
        const progress = Number(document.getElementById("progressPercent").value || "0");
        const rows = load(KEYS.assignments, []);
        const row = rows.find((item) => item.id === assignmentId);
        if (!row) {
          setNotice(progressNotice, "error", "Pick an assignment first.");
          return;
        }
        row.progress = Math.max(0, Math.min(100, progress));
        row.status = row.progress >= 100 ? "Completed" : "In Progress";
        save(KEYS.assignments, rows);
        progressForm.reset();
        setNotice(progressNotice, "success", "Progress updated.");
        refreshPortal();
      });
    }

    if (messageForm) {
      messageForm.addEventListener("submit", function (event) {
        event.preventDefault();
        clearNotice(messageNotice);
        const client = getCurrentClient();
        if (isFeatureLocked(client, messageNotice)) {
          refreshPortal();
          return;
        }

        const rows = load(KEYS.messages, []);
        rows.unshift({
          id: uid("msg"),
          fromName: client.name,
          fromEmail: client.email,
          subject: (document.getElementById("messageSubject").value || "").trim(),
          message: (document.getElementById("messageBody").value || "").trim(),
          fromType: "Existing Client",
          createdAt: new Date().toISOString(),
        status: "New",
        response: "",
        respondedAt: ""
        });
        save(KEYS.messages, rows);
        messageForm.reset();
        setNotice(messageNotice, "success", "Message sent to trainer.");
        renderClientMessageHistory(messageHistory, client);
      });
    }

    if (quickReviewForm) {
      quickReviewForm.addEventListener("submit", function (event) {
        event.preventDefault();
        clearNotice(quickReviewNotice);
        const client = getCurrentClient();
        if (isFeatureLocked(client, quickReviewNotice)) {
          refreshPortal();
          return;
        }

        const rating = Number(document.getElementById("quickRating").value || "5");
        const text = (document.getElementById("quickReviewText").value || "").trim();
        if (!text) {
          setNotice(quickReviewNotice, "error", "Write a short review before submitting.");
          return;
        }
        const anonymous = document.getElementById("quickAnonymous").checked;
        const rows = load(KEYS.reviews, []);
        rows.unshift({
          id: uid("review"),
          name: anonymous ? "Anonymous Client" : client.name,
          anonymous: anonymous,
          rating: rating,
          text: text,
          createdAt: new Date().toISOString(),
          showOnHome: true
        });
        save(KEYS.reviews, rows);
        quickReviewForm.reset();
        setNotice(quickReviewNotice, "success", "Thanks for the review.");
      });
    }

    refreshPortal();
    finalizePendingActionIfNeeded(loginNotice);
  }

  function initProgramsPage() {
    const list = document.getElementById("programAssignments");
    if (!list) return;

    const client = getCurrentClient();
    if (!client) {
      list.innerHTML = '<div class="list-item muted">Log into the client portal to see your current workout assignments.</div>';
      return;
    }

    renderClientAssignmentList(list, client);
  }

  function renderReviewFeed(container) {
    if (!container) return;
    const rows = load(KEYS.reviews, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (!rows.length) {
      container.innerHTML = '<div class="list-item muted">No reviews yet.</div>';
      return;
    }

    container.innerHTML = rows
      .map((item) => {
        return (
          '<div class="list-item">' +
          "<strong>" +
          escapeHtml(item.anonymous ? "Anonymous Client" : item.name) +
          "</strong> - " +
          new Date(item.createdAt).toLocaleDateString() +
          '<div class="star-row">' +
          stars(item.rating) +
          "</div><div>" +
          escapeHtml(item.text) +
          "</div></div>"
        );
      })
      .join("");
  }

  function initReviewsPage() {
    const form = document.getElementById("reviewForm");
    const notice = document.getElementById("reviewNotice");
    const feed = document.getElementById("reviewFeed");
    if (!form) return;

    renderReviewFeed(feed);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      clearNotice(notice);

      const name = (document.getElementById("reviewName").value || "").trim();
      const text = (document.getElementById("reviewText").value || "").trim();
      const rating = Number(document.getElementById("reviewRating").value || "5");
      const anonymous = document.getElementById("reviewAnonymous").checked;

      if (!text) {
        setNotice(notice, "error", "Please write a short review.");
        return;
      }

      const rows = load(KEYS.reviews, []);
      rows.unshift({
        id: uid("review"),
        name: anonymous || !name ? "Anonymous Client" : name,
        anonymous: anonymous || !name,
        rating: rating,
        text: text,
        createdAt: new Date().toISOString(),
        showOnHome: true
      });
      save(KEYS.reviews, rows);
      form.reset();
      setNotice(notice, "success", "Review submitted.");
      renderReviewFeed(feed);
    });
  }

  function initAdmin() {
    const loginPanel = document.getElementById("trainerLoginPanel");
    const app = document.getElementById("trainerDashboard");
    const form = document.getElementById("trainerLoginForm");
    const notice = document.getElementById("trainerLoginNotice");

    const consultationsBody = document.getElementById("consultationsBody");
    const bookingsBody = document.getElementById("bookingsBody");
    const bookingsAdminNotice = document.getElementById("bookingsAdminNotice");
    const messagesList = document.getElementById("messagesList");
    const assignmentsBody = document.getElementById("assignmentsBody");
    const adminReviews = document.getElementById("adminReviews");

    const kpiConsults = document.getElementById("kpiConsults");
    const kpiBookings = document.getElementById("kpiBookings");
    const kpiMessages = document.getElementById("kpiMessages");
    const kpiAssignments = document.getElementById("kpiAssignments");

    const assignmentForm = document.getElementById("assignWorkoutForm");
    const assignmentNotice = document.getElementById("assignWorkoutNotice");
    const assignmentClient = document.getElementById("assignmentClient");
    const siteContentForm = document.getElementById("siteContentForm");
    const siteHomeTitle = document.getElementById("siteHomeTitle");
    const siteHomeText = document.getElementById("siteHomeText");
    const siteHeroImageFile = document.getElementById("siteHeroImageFile");
    const siteHeroImagePreview = document.getElementById("siteHeroImagePreview");
    const siteResetHomeImage = document.getElementById("siteResetHomeImage");
    const siteContentNotice = document.getElementById("siteContentNotice");
    const aboutContentForm = document.getElementById("aboutContentForm");
    const aboutAdminHeading = document.getElementById("aboutAdminHeading");
    const aboutAdminIntro = document.getElementById("aboutAdminIntro");
    const aboutAdminSpecialties = document.getElementById("aboutAdminSpecialties");
    const aboutAdminCertifications = document.getElementById("aboutAdminCertifications");
    const aboutAdminCoachingStyle = document.getElementById("aboutAdminCoachingStyle");
    const aboutAdminServing = document.getElementById("aboutAdminServing");
    const aboutAdminLocationNote = document.getElementById("aboutAdminLocationNote");
    const aboutAdminMapQuery = document.getElementById("aboutAdminMapQuery");
    const aboutImageFile = document.getElementById("aboutImageFile");
    const aboutImagePreview = document.getElementById("aboutImagePreview");
    const aboutResetImage = document.getElementById("aboutResetImage");
    const aboutContentNotice = document.getElementById("aboutContentNotice");
    const availabilityBoard = document.getElementById("availabilityBoard");
    const availabilityRangeLabel = document.getElementById("availabilityRangeLabel");
    const availabilityPrevWeek = document.getElementById("availabilityPrevWeek");
    const availabilityNextWeek = document.getElementById("availabilityNextWeek");
    const availabilityNotice = document.getElementById("availabilityNotice");
    const availabilityDefaultDay = document.getElementById("availabilityDefaultDay");
    const availabilityDefaultsBoard = document.getElementById("availabilityDefaultsBoard");
    const availabilityDefaultApplyFuture = document.getElementById("availabilityDefaultApplyFuture");
    const availabilitySaveDefaults = document.getElementById("availabilitySaveDefaults");
    const adminTabButtons = Array.from(document.querySelectorAll("[data-admin-tab]"));
    const adminPanels = Array.from(document.querySelectorAll("[data-admin-panel]"));
    const freshConsultations = document.getElementById("freshConsultations");
    const freshBookings = document.getElementById("freshBookings");
    const freshMessages = document.getElementById("freshMessages");
    const freshReviews = document.getElementById("freshReviews");
    const freshActionNotice = document.getElementById("freshActionNotice");
    const freshTabCount = document.getElementById("freshTabCount");
    const freshMessagesCount = document.getElementById("freshMessagesCount");
    const freshReviewsCount = document.getElementById("freshReviewsCount");

    const AVAILABILITY_DAYS = 84;
    const MAX_AVAILABILITY_OFFSET = AVAILABILITY_DAYS - 7;
    let availabilityStartOffset = 0;
    let availabilityDefaultsDraft = getAvailabilityDefaultsMap();
    let selectedDefaultWeekday = String(new Date().getDay());

    function setAdminTab(tabName) {
      if (!tabName) return;
      adminTabButtons.forEach((button) => {
        const isActive = button.getAttribute("data-admin-tab") === tabName;
        button.classList.toggle("active", isActive);
      });
      adminPanels.forEach((panel) => {
        const isActive = panel.getAttribute("data-admin-panel") === tabName;
        panel.classList.toggle("hidden", !isActive);
      });
    }
    function selectorValue(value) {
      return String(value || "")
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"');
    }
    function openAdminTabAndFocus(tabName, selector) {
      setAdminTab(tabName);
      window.requestAnimationFrame(function () {
        const target = document.querySelector(selector);
        if (!target) return;
        target.classList.add("fresh-jump-focus");
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        window.setTimeout(function () {
          target.classList.remove("fresh-jump-focus");
        }, 1800);
      });
    }
    function hydrateClientSelect() {
      if (!assignmentClient) return;
      assignmentClient.innerHTML = "";
      load(KEYS.users, []).forEach((user) => {
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = user.name + " (" + user.email + ")";
        assignmentClient.appendChild(option);
      });
    }

    function toAdminMediaPreviewSrc(src) {
      const normalized = normalizeHomeMediaSrc(src);
      return /^assets\//i.test(normalized) ? "../" + normalized : normalized;
    }

    function hydrateSiteCustomizationForms() {
      const settings = getSiteSettings();
      if (siteHomeTitle) siteHomeTitle.value = settings.homeHeroTitle;
      if (siteHomeText) siteHomeText.value = settings.homeHeroText;
      if (siteHeroImagePreview) siteHeroImagePreview.src = toAdminMediaPreviewSrc(settings.homeHeroImage);
      if (siteHeroImageFile) siteHeroImageFile.value = "";
      if (aboutAdminHeading) aboutAdminHeading.value = settings.aboutHeading;
      if (aboutAdminIntro) aboutAdminIntro.value = settings.aboutIntro;
      if (aboutAdminSpecialties) aboutAdminSpecialties.value = settings.aboutSpecialties;
      if (aboutAdminCertifications) aboutAdminCertifications.value = settings.aboutCertifications;
      if (aboutAdminCoachingStyle) aboutAdminCoachingStyle.value = settings.aboutCoachingStyle;
      if (aboutAdminServing) aboutAdminServing.value = settings.aboutServing;
      if (aboutAdminLocationNote) aboutAdminLocationNote.value = settings.aboutLocationNote;
      if (aboutAdminMapQuery) aboutAdminMapQuery.value = normalizeAboutMapQuery(settings.aboutMapQuery);
      if (aboutImagePreview) aboutImagePreview.src = toAdminMediaPreviewSrc(normalizeAboutPhotoSrc(settings.aboutPhoto));
      if (aboutImageFile) aboutImageFile.value = "";
    }

    function updateAvailabilityRangeLabel() {
      if (!availabilityRangeLabel) return;
      const start = isoDateFromNow(availabilityStartOffset);
      const end = isoDateFromNow(availabilityStartOffset + 6);
      availabilityRangeLabel.textContent = "Showing " + formatDate(start) + " to " + formatDate(end) + ".";
    }

    function renderAvailabilityBoard() {
      if (!availabilityBoard) return;

      renderCalendarBoard(availabilityBoard, {
        mode: "admin-availability",
        startOffset: availabilityStartOffset,
        onPick: function (date, slot, meta) {
          if (meta && meta.isBooked) {
            setNotice(availabilityNotice, "error", "Booked slots cannot be changed.");
            return;
          }
          const nextOpen = !(meta && meta.isOpen);
          setSlotAvailability(date, slot, nextOpen);
          setNotice(availabilityNotice, "success", nextOpen ? "Slot reopened for booking." : "Slot marked unavailable.");
          renderAvailabilityBoard();
        }
      });

      if (availabilityPrevWeek) availabilityPrevWeek.disabled = availabilityStartOffset <= 0;
      if (availabilityNextWeek) availabilityNextWeek.disabled = availabilityStartOffset >= MAX_AVAILABILITY_OFFSET;
      updateAvailabilityRangeLabel();
    }


    function getDefaultDayDraft(dayIndex) {
      const key = String(dayIndex);
      const source = availabilityDefaultsDraft[key];
      return sanitizeDayAvailability(source);
    }

    function applyDefaultsToFutureDates(dayIndex) {
      const map = { ...getAvailabilityMap() };
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      Object.keys(map).forEach((date) => {
        const d = new Date(date + "T00:00:00");
        if (Number.isNaN(d.getTime())) return;
        if (d < today) return;
        if (d.getDay() !== dayIndex) return;
        delete map[date];
      });

      save(KEYS.availability, map);
    }

    function renderAvailabilityDefaultsEditor() {
      if (!availabilityDefaultsBoard || !availabilityDefaultDay) return;

      const fallbackDay = String(new Date().getDay());
      const nextSelected = String(availabilityDefaultDay.value || selectedDefaultWeekday || fallbackDay);
      selectedDefaultWeekday = /^[0-6]$/.test(nextSelected) ? nextSelected : fallbackDay;
      availabilityDefaultDay.value = selectedDefaultWeekday;

      const dayIndex = Number(selectedDefaultWeekday);
      const dayLabel = WEEKDAY_LABELS[dayIndex] || "Selected";
      const dayDefaults = getDefaultDayDraft(dayIndex);

      availabilityDefaultsBoard.innerHTML = "";
      SLOT_TIMES.forEach((slot) => {
        const isOpen = dayDefaults[slot] !== false;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "slot-pill " + (isOpen ? "open" : "closed");
        btn.textContent = to12Hour(slot);
        btn.title = isOpen
          ? "Open by default on " + dayLabel + " (click to close)"
          : "Closed by default on " + dayLabel + " (click to open)";
        btn.setAttribute("aria-pressed", isOpen ? "true" : "false");
        btn.addEventListener("click", function () {
          const nextDay = { ...dayDefaults };
          nextDay[slot] = !isOpen;
          availabilityDefaultsDraft = { ...availabilityDefaultsDraft, [String(dayIndex)]: nextDay };
          renderAvailabilityDefaultsEditor();
          setNotice(availabilityNotice, "success", dayLabel + " defaults updated. Click Save weekday defaults to apply.");
        });
        availabilityDefaultsBoard.appendChild(btn);
      });
    }
    function renderAdminReviews(container) {
      if (!container) return;
      const reviews = load(KEYS.reviews, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      if (!reviews.length) {
        container.innerHTML = '<div class="list-item muted">No reviews yet.</div>';
        return;
      }

      container.innerHTML = reviews
        .map((item) => {
          const showOnHome = item.showOnHome !== false;
          return (
            '<div class="list-item" data-admin-review-row="' +
            escapeHtml(item.id) +
            '"><strong>' +
            escapeHtml(item.anonymous ? "Anonymous Client" : item.name) +
            '</strong> - ' +
            new Date(item.createdAt).toLocaleDateString() +
            '<div class="star-row">' +
            stars(item.rating) +
            '</div><div>' +
            escapeHtml(item.text) +
            '</div><label style="margin-top:0.6rem">Homepage visibility<select data-review-home="' +
            escapeHtml(item.id) +
            '"><option value="show"' +
            (showOnHome ? ' selected' : '') +
            '>Show on Home</option><option value="hide"' +
            (!showOnHome ? ' selected' : '') +
            '>Hide from Home</option></select></label></div>'
          );
        })
        .join("");
    }
    function renderFreshActionButtons(actions) {
      return (
        '<div class="fresh-item-actions">' +
        actions
          .map((action) => {
            return (
              '<button class="btn btn-light" type="button" data-fresh-action="' +
              escapeHtml(action.action) +
              '" data-fresh-id="' +
              escapeHtml(action.id) +
              '">' +
              escapeHtml(action.label) +
              "</button>"
            );
          })
          .join("") +
        "</div>"
      );
    }

    function renderFreshQueues(consultations, bookings, messages, reviews) {
      const pendingConsults = consultations.filter((row) => row.status === "Pending").slice(0, 8);
      const pendingBookings = bookings.filter((row) => row.status === "Needs Review" || row.status === "Pending").slice(0, 8);
      const newMessages = messages.filter((row) => (row.status || "New") === "New").slice(0, 8);
      const newReviews = reviews.filter((row) => row.reviewModerated !== true).slice(0, 8);

      const totalFresh = pendingConsults.length + pendingBookings.length + newMessages.length + newReviews.length;
      if (freshTabCount) freshTabCount.textContent = String(totalFresh);
      if (freshMessagesCount) freshMessagesCount.textContent = String(newMessages.length);
      if (freshReviewsCount) freshReviewsCount.textContent = String(newReviews.length);

      if (freshConsultations) {
        freshConsultations.innerHTML = pendingConsults.length
          ? pendingConsults
              .map((row) => {
                return (
                  '<div class="list-item"><strong>' +
                  escapeHtml(row.name) +
                  "</strong> - " +
                  escapeHtml(row.goal) +
                  '<div class="muted">' +
                  escapeHtml(row.email) +
                  '</div><div class="muted">' +
                  (row.preferredDate ? formatDate(row.preferredDate) : "No slot selected") +
                  (row.preferredTime ? " at " + to12Hour(row.preferredTime) : "") +
                  "</div>" +
                  renderFreshActionButtons([
                    { action: "open-consult", id: row.id, label: "Open Intake" },
                    { action: "consult-scheduled", id: row.id, label: "Mark Scheduled" }
                  ]) +
                  "</div>"
                );
              })
              .join("")
          : '<div class="list-item muted">No new consultation requests.</div>';
      }

      if (freshBookings) {
        freshBookings.innerHTML = pendingBookings.length
          ? pendingBookings
              .map((row) => {
                return (
                  '<div class="list-item"><strong>' +
                  escapeHtml(row.clientName || "Unknown client") +
                  "</strong> - " +
                  formatDate(row.date) +
                  " at " +
                  to12Hour(row.time) +
                  ' <span class="badge ' +
                  statusClass(row.status) +
                  '">' +
                  escapeHtml(row.status || "Pending") +
                  '</span><div class="muted">' +
                  escapeHtml(row.type || "Session") +
                  "</div>" +
                  renderFreshActionButtons([
                    { action: "open-booking", id: row.id, label: "Open Booking" },
                    { action: "booking-confirm", id: row.id, label: "Confirm" }
                  ]) +
                  "</div>"
                );
              })
              .join("")
          : '<div class="list-item muted">No booking requests waiting for review.</div>';
      }

      if (freshMessages) {
        freshMessages.innerHTML = newMessages.length
          ? newMessages
              .map((row) => {
                return (
                  '<div class="list-item"><strong>' +
                  escapeHtml(row.fromName || "Client") +
                  "</strong> - " +
                  escapeHtml(row.subject || "General message") +
                  '<div class="muted">' +
                  escapeHtml(row.fromEmail || "") +
                  "</div>" +
                  renderFreshActionButtons([
                    { action: "open-message", id: row.id, label: "Open Message" },
                    { action: "message-reviewed", id: row.id, label: "Mark Reviewed" }
                  ]) +
                  "</div>"
                );
              })
              .join("")
          : '<div class="list-item muted">No new client messages.</div>';
      }

      if (freshReviews) {
        freshReviews.innerHTML = newReviews.length
          ? newReviews
              .map((row) => {
                return (
                  '<div class="list-item"><strong>' +
                  escapeHtml(row.anonymous ? "Anonymous Client" : row.name) +
                  "</strong> - " +
                  new Date(row.createdAt).toLocaleDateString() +
                  '<div class="star-row">' +
                  stars(row.rating) +
                  "</div><div>" +
                  escapeHtml(row.text) +
                  "</div>" +
                  renderFreshActionButtons([
                    { action: "open-review", id: row.id, label: "Open Review" },
                    { action: "review-approve-home", id: row.id, label: "Approve on Home" }
                  ]) +
                  "</div>"
                );
              })
              .join("")
          : '<div class="list-item muted">No new reviews waiting for moderation.</div>';
      }
    }
    function renderAdminTables() {
      const consultations = load(KEYS.consultations, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const bookings = load(KEYS.bookings, []).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      const messages = load(KEYS.messages, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const assignments = load(KEYS.assignments, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const reviews = load(KEYS.reviews, []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      if (kpiConsults) kpiConsults.textContent = String(consultations.filter((c) => c.status === "Pending").length);
      if (kpiBookings) kpiBookings.textContent = String(bookings.length);
      if (kpiMessages) kpiMessages.textContent = String(messages.filter((m) => m.status === "New").length);
      if (kpiAssignments) kpiAssignments.textContent = String(assignments.length);

      if (consultationsBody) {
        consultationsBody.innerHTML = consultations
          .map((row) => {
            return (
              '<tr data-consult-row="' +
              escapeHtml(row.id) +
              '"><td>' +
              escapeHtml(row.name) +
              "</td><td>" +
              escapeHtml(row.email) +
              "</td><td>" +
              escapeHtml(row.goal) +
              "</td><td>" +
              (row.preferredDate ? formatDate(row.preferredDate) : "No slot") +
              (row.preferredTime ? " at " + to12Hour(row.preferredTime) : "") +
              '</td><td><select data-consult-status="' +
              escapeHtml(row.id) +
              '"><option' +
              (row.status === "Pending" ? " selected" : "") +
              ">Pending</option><option" +
              (row.status === "Scheduled" ? " selected" : "") +
              ">Scheduled</option><option" +
              (row.status === "Closed" ? " selected" : "") +
              ">Closed</option></select></td></tr>"
            );
          })
          .join("");
      }

      if (bookingsBody) {
        bookingsBody.innerHTML = bookings
          .map((row) => {
            const recurring = row.recurring && row.recurring.requested ? row.recurring : null;
            const recurringSummary = recurring
              ? escapeHtml(recurring.frequency || "Weekly") + " x" + escapeHtml(String(recurring.count || 4))
              : "One-time";
            const recurringStatus = recurring ? recurring.status || "Pending Approval" : "";
            const recurringCell = recurring
              ? '<select data-booking-recurring="' +
                escapeHtml(row.id) +
                '"><option' +
                (recurringStatus === "Pending Approval" ? " selected" : "") +
                '>Pending Approval</option><option' +
                (recurringStatus === "Approved" ? " selected" : "") +
                '>Approved</option><option' +
                (recurringStatus === "Declined" ? " selected" : "") +
                '>Declined</option></select><div class="muted">' +
                recurringSummary +
                '</div>'
              : '<span class="muted">' + recurringSummary + '</span>';

            const suggestedDate = row.suggestedDate || "";
            const suggestedTime = row.suggestedTime || "";
            const suggestionSummary = suggestedDate && suggestedTime
              ? '<div class="muted">Current suggestion: ' + formatDate(suggestedDate) + ' at ' + to12Hour(suggestedTime) + '</div>'
              : '<div class="muted">No reschedule suggestion sent.</div>';
            const suggestionCell =
              '<form class="table-inline-form" data-booking-reschedule-form="' +
              escapeHtml(row.id) +
              '">' +
              '<input type="date" data-booking-suggest-date="' +
              escapeHtml(row.id) +
              '" value="' +
              escapeHtml(suggestedDate) +
              '" />' +
              '<input type="time" step="3600" data-booking-suggest-time="' +
              escapeHtml(row.id) +
              '" value="' +
              escapeHtml(suggestedTime) +
              '" />' +
              '<button class="btn btn-light" type="submit">Save</button>' +
              '</form>' +
              suggestionSummary;

            return (
              '<tr data-booking-row="' +
              escapeHtml(row.id) +
              '"><td>' +
              formatDate(row.date) +
              "</td><td>" +
              to12Hour(row.time) +
              "</td><td>" +
              escapeHtml(row.clientName) +
              "</td><td>" +
              escapeHtml(row.type) +
              "</td><td>" +
              recurringCell +
              "</td><td>" +
              suggestionCell +
              '</td><td><select data-booking-status="' +
              escapeHtml(row.id) +
              '"><option' +
              (row.status === "Needs Review" ? " selected" : "") +
              ">Needs Review</option><option" +
              (row.status === "Pending" ? " selected" : "") +
              ">Pending</option><option" +
              (row.status === "Confirmed" ? " selected" : "") +
              ">Confirmed</option><option" +
              (row.status === "Completed" ? " selected" : "") +
              ">Completed</option></select></td></tr>"
            );
          })
          .join("");
      }

      if (messagesList) {
        messagesList.innerHTML = messages
          .map((msg) => {
            const status = msg.status || (msg.response ? "Replied" : "New");
            const hasResponse = Boolean((msg.response || "").trim());
            return (
              '<div class="list-item" data-message-row="' +
              escapeHtml(msg.id) +
              '"><strong>' +
              escapeHtml(msg.subject || "General message") +
              '</strong> - ' +
              escapeHtml(msg.fromName) +
              ' <span class="badge ' +
              statusClass(status) +
              '">' +
              escapeHtml(status) +
              '</span><div class="muted">' +
              escapeHtml(msg.fromEmail) +
              ' - ' +
              formatDateTime(msg.createdAt) +
              '</div><div>' +
              escapeHtml(msg.message || "") +
              '</div>' +
              (hasResponse
                ? '<div class="panel" style="margin-top:0.6rem"><strong>Current reply</strong><div class="muted">' +
                  (msg.respondedAt ? formatDateTime(msg.respondedAt) : "") +
                  '</div><div>' +
                  escapeHtml(msg.response) +
                  '</div></div>'
                : '<div class="muted" style="margin-top:0.5rem">No reply sent yet.</div>') +
              '<form class="form-grid" data-message-reply-form="' +
              escapeHtml(msg.id) +
              '" style="margin-top:0.6rem"><label class="full">Reply<textarea data-message-reply="' +
              escapeHtml(msg.id) +
              '" placeholder="Type your response to this client">' +
              escapeHtml(msg.response || "") +
              '</textarea></label><div class="full"><button class="btn btn-light" type="submit">Save Reply</button></div></form></div>'
            );
          })
          .join("");
      }

      if (assignmentsBody) {
        assignmentsBody.innerHTML = assignments
          .map((row) => {
            return (
              "<tr><td>" +
              escapeHtml(row.clientName || row.clientEmail) +
              "</td><td>" +
              escapeHtml(row.title) +
              "</td><td>" +
              formatDate(row.dueDate) +
              "</td><td>" +
              escapeHtml(String(row.progress)) +
              "%</td><td>" +
              escapeHtml(row.status) +
              "</td></tr>"
            );
          })
          .join("");
      }

      renderAdminReviews(adminReviews);
      renderFreshQueues(consultations, bookings, messages, reviews);
      renderAvailabilityDefaultsEditor();
      renderAvailabilityBoard();
    }

    function attachDelegatedHandlers() {
      if (consultationsBody) {
        consultationsBody.addEventListener("change", function (event) {
          const target = event.target;
          if (!(target instanceof HTMLSelectElement)) return;
          const id = target.getAttribute("data-consult-status");
          if (!id) return;
          const rows = load(KEYS.consultations, []);
          const row = rows.find((item) => item.id === id);
          if (!row) return;
          row.status = target.value;
          save(KEYS.consultations, rows);
          renderAdminTables();
        });
      }

      if (bookingsBody) {
        bookingsBody.addEventListener("change", function (event) {
          const target = event.target;
          if (!(target instanceof HTMLSelectElement)) return;

          const bookingStatusId = target.getAttribute("data-booking-status");
          const recurringId = target.getAttribute("data-booking-recurring");
          if (!bookingStatusId && !recurringId) return;

          const id = bookingStatusId || recurringId;
          const rows = load(KEYS.bookings, []);
          const row = rows.find((item) => item.id === id);
          if (!row) return;

          if (bookingStatusId) {
            row.status = target.value;
          }

          if (recurringId && row.recurring && row.recurring.requested) {
            row.recurring.status = target.value;
            if (target.value === "Approved" && row.status === "Needs Review") {
              row.status = "Pending";
            }
          }

          save(KEYS.bookings, rows);
          renderAdminTables();
        });

        bookingsBody.addEventListener("submit", function (event) {
          const formTarget = event.target;
          if (!(formTarget instanceof HTMLFormElement)) return;
          const id = formTarget.getAttribute("data-booking-reschedule-form");
          if (!id) return;
          event.preventDefault();

          const dateInput = formTarget.querySelector('input[data-booking-suggest-date="' + id + '"]');
          const timeInput = formTarget.querySelector('input[data-booking-suggest-time="' + id + '"]');
          const nextDate = dateInput instanceof HTMLInputElement ? dateInput.value.trim() : "";
          const nextTime = timeInput instanceof HTMLInputElement ? timeInput.value.trim() : "";

          if ((nextDate && !nextTime) || (!nextDate && nextTime)) {
            setNotice(bookingsAdminNotice || availabilityNotice, "error", "Choose both reschedule date and time, or clear both.");
            return;
          }

          const rows = load(KEYS.bookings, []);
          const row = rows.find((item) => item.id === id);
          if (!row) return;

          row.suggestedDate = nextDate || "";
          row.suggestedTime = nextTime || "";
          row.suggestedAt = nextDate && nextTime ? new Date().toISOString() : "";

          save(KEYS.bookings, rows);
          setNotice(
            bookingsAdminNotice || availabilityNotice,
            "success",
            nextDate && nextTime ? "Reschedule suggestion saved." : "Reschedule suggestion cleared."
          );
          renderAdminTables();
        });
      }

      if (adminReviews) {
        adminReviews.addEventListener("change", function (event) {
          const target = event.target;
          if (!(target instanceof HTMLSelectElement)) return;
          const id = target.getAttribute("data-review-home");
          if (!id) return;

          const rows = load(KEYS.reviews, []);
          const row = rows.find((item) => item.id === id);
          if (!row) return;
          row.showOnHome = target.value === "show";
          row.reviewModerated = true;
          save(KEYS.reviews, rows);
          renderAdminTables();
        });
      }

      if (messagesList) {
        messagesList.addEventListener("submit", function (event) {
          const formTarget = event.target;
          if (!(formTarget instanceof HTMLFormElement)) return;
          const id = formTarget.getAttribute("data-message-reply-form");
          if (!id) return;
          event.preventDefault();

          const replyInput = formTarget.querySelector('textarea[data-message-reply="' + id + '"]');
          if (!(replyInput instanceof HTMLTextAreaElement)) return;

          const rows = load(KEYS.messages, []);
          const row = rows.find((item) => item.id === id);
          if (!row) return;

          const reply = replyInput.value.trim();
          row.response = reply;
          row.respondedAt = reply ? new Date().toISOString() : "";
          row.status = reply ? "Replied" : "New";

          save(KEYS.messages, rows);
          renderAdminTables();
        });
      }

      [freshConsultations, freshBookings, freshMessages, freshReviews].forEach((container) => {
        if (!container) return;
        container.addEventListener("click", function (event) {
          const target = event.target;
          if (!(target instanceof Element)) return;
          const actionButton = target.closest("button[data-fresh-action]");
          if (!(actionButton instanceof HTMLButtonElement)) return;
          event.preventDefault();

          const action = actionButton.getAttribute("data-fresh-action") || "";
          const id = actionButton.getAttribute("data-fresh-id") || "";
          if (!action || !id) return;

          if (action === "open-consult") {
            openAdminTabAndFocus("intake", '[data-consult-row="' + selectorValue(id) + '"]');
            return;
          }
          if (action === "open-booking") {
            openAdminTabAndFocus("intake", '[data-booking-row="' + selectorValue(id) + '"]');
            return;
          }
          if (action === "open-message") {
            openAdminTabAndFocus("messages", '[data-message-row="' + selectorValue(id) + '"]');
            return;
          }
          if (action === "open-review") {
            openAdminTabAndFocus("reviews", '[data-admin-review-row="' + selectorValue(id) + '"]');
            return;
          }

          if (action === "consult-scheduled") {
            const rows = load(KEYS.consultations, []);
            const row = rows.find((item) => item.id === id);
            if (!row) return;
            row.status = "Scheduled";
            save(KEYS.consultations, rows);
            setNotice(freshActionNotice, "success", "Consultation marked scheduled.");
            renderAdminTables();
            return;
          }
          if (action === "booking-confirm") {
            const rows = load(KEYS.bookings, []);
            const row = rows.find((item) => item.id === id);
            if (!row) return;
            row.status = "Confirmed";
            save(KEYS.bookings, rows);
            setNotice(freshActionNotice, "success", "Booking marked confirmed.");
            renderAdminTables();
            return;
          }
          if (action === "message-reviewed") {
            const rows = load(KEYS.messages, []);
            const row = rows.find((item) => item.id === id);
            if (!row) return;
            row.status = "Reviewed";
            save(KEYS.messages, rows);
            setNotice(freshActionNotice, "success", "Message marked reviewed.");
            renderAdminTables();
            return;
          }
          if (action === "review-approve-home") {
            const rows = load(KEYS.reviews, []);
            const row = rows.find((item) => item.id === id);
            if (!row) return;
            row.showOnHome = true;
            row.reviewModerated = true;
            save(KEYS.reviews, rows);
            setNotice(freshActionNotice, "success", "Review approved for homepage.");
            renderAdminTables();
          }
        });
      });
    }


    if (availabilityDefaultDay) {
      availabilityDefaultDay.addEventListener("change", function () {
        selectedDefaultWeekday = String(availabilityDefaultDay.value || selectedDefaultWeekday);
        renderAvailabilityDefaultsEditor();
      });
    }

    if (availabilitySaveDefaults) {
      availabilitySaveDefaults.addEventListener("click", function () {
        const dayIndex = Number(selectedDefaultWeekday);
        const dayLabel = WEEKDAY_LABELS[dayIndex] || "Selected";
        availabilityDefaultsDraft = saveAvailabilityDefaultsMap(availabilityDefaultsDraft);

        if (availabilityDefaultApplyFuture && availabilityDefaultApplyFuture.checked) {
          applyDefaultsToFutureDates(dayIndex);
          setNotice(availabilityNotice, "success", dayLabel + " defaults saved and applied to future " + dayLabel + " dates.");
        } else {
          setNotice(availabilityNotice, "success", dayLabel + " defaults saved for future dates.");
        }

        renderAvailabilityBoard();
        renderAvailabilityDefaultsEditor();
      });
    }
    if (availabilityPrevWeek) {
      availabilityPrevWeek.addEventListener("click", function () {
        availabilityStartOffset = Math.max(0, availabilityStartOffset - 7);
        renderAvailabilityBoard();
      });
    }

    if (availabilityNextWeek) {
      availabilityNextWeek.addEventListener("click", function () {
        availabilityStartOffset = Math.min(MAX_AVAILABILITY_OFFSET, availabilityStartOffset + 7);
        renderAvailabilityBoard();
      });
    }

    adminTabButtons.forEach((button) => {
      button.addEventListener("click", function () {
        setAdminTab(button.getAttribute("data-admin-tab"));
      });
    });

    function showApp() {
      loginPanel.classList.add("hidden");
      app.classList.remove("hidden");
      setAdminTab("fresh");
      availabilityDefaultsDraft = getAvailabilityDefaultsMap();
      if (availabilityDefaultDay) {
        availabilityDefaultDay.value = selectedDefaultWeekday;
      }
      hydrateClientSelect();
      hydrateSiteCustomizationForms();
      renderAdminTables();
    }

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        clearNotice(notice);
        const email = (document.getElementById("trainerEmail").value || "").trim().toLowerCase();
        const password = (document.getElementById("trainerPassword").value || "").trim();
        if (email !== "coach@thunder.fit" || password !== "ThunderAdmin!") {
          setNotice(notice, "error", "Wrong credentials. Demo: coach@thunder.fit / ThunderAdmin!");
          return;
        }
        showApp();
      });
    }

    if (assignmentForm) {
      assignmentForm.addEventListener("submit", function (event) {
        event.preventDefault();
        clearNotice(assignmentNotice);

        const users = load(KEYS.users, []);
        const user = users.find((row) => row.id === assignmentClient.value);
        if (!user) {
          setNotice(assignmentNotice, "error", "Please select a client.");
          return;
        }

        const title = (document.getElementById("assignmentTitle").value || "").trim();
        const description = (document.getElementById("assignmentDescription").value || "").trim();
        const dueDate = document.getElementById("assignmentDueDate").value;

        if (!title || !description || !dueDate) {
          setNotice(assignmentNotice, "error", "Title, description, and due date are required.");
          return;
        }

        const rows = load(KEYS.assignments, []);
        rows.unshift({
          id: uid("asg"),
          clientId: user.id,
          clientName: user.name,
          clientEmail: user.email,
          title: title,
          description: description,
          dueDate: dueDate,
          progress: 0,
          status: "Assigned",
          createdAt: new Date().toISOString()
        });
        save(KEYS.assignments, rows);
        assignmentForm.reset();
        setNotice(assignmentNotice, "success", "Workout assignment sent.");
        renderAdminTables();
      });
    }

    if (siteHeroImageFile && siteHeroImagePreview) {
      siteHeroImageFile.addEventListener("change", async function () {
        const file = siteHeroImageFile.files && siteHeroImageFile.files[0];
        if (!file) {
          const settings = getSiteSettings();
          siteHeroImagePreview.src = toAdminMediaPreviewSrc(settings.homeHeroImage);
          return;
        }

        try {
          const previewSrc = await readImageFileAsDataUrl(file);
          siteHeroImagePreview.src = previewSrc;
        } catch (error) {
          setNotice(siteContentNotice, "error", (error && error.message) || "Could not preview selected image.");
        }
      });
    }


    if (aboutImageFile && aboutImagePreview) {
      aboutImageFile.addEventListener("change", async function () {
        const file = aboutImageFile.files && aboutImageFile.files[0];
        if (!file) {
          const settings = getSiteSettings();
          aboutImagePreview.src = toAdminMediaPreviewSrc(normalizeAboutPhotoSrc(settings.aboutPhoto));
          return;
        }

        try {
          const previewSrc = await readImageFileAsDataUrl(file);
          aboutImagePreview.src = previewSrc;
        } catch (error) {
          setNotice(aboutContentNotice, "error", (error && error.message) || "Could not preview selected image.");
        }
      });
    }
    if (siteResetHomeImage) {
      siteResetHomeImage.addEventListener("click", function () {
        saveSiteSettings({ homeHeroImage: DEFAULT_HOME_HERO_IMAGE });
        hydrateSiteCustomizationForms();
        setNotice(siteContentNotice, "success", "Homepage image reset to the Thunder Fitness logo.");
      });
    }


    if (aboutResetImage) {
      aboutResetImage.addEventListener("click", function () {
        saveSiteSettings({ aboutPhoto: DEFAULT_ABOUT_PHOTO });
        hydrateSiteCustomizationForms();
        setNotice(aboutContentNotice, "success", "About photo reset to the default image.");
      });
    }
    if (siteContentForm) {
      siteContentForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearNotice(siteContentNotice);

        const nextTitle = (siteHomeTitle.value || "").trim();
        const nextText = (siteHomeText.value || "").trim();

        if (!nextTitle || !nextText) {
          setNotice(siteContentNotice, "error", "Please fill out homepage headline and subtext.");
          return;
        }

        const existingSettings = getSiteSettings();
        let nextImage = normalizeHomeMediaSrc(existingSettings.homeHeroImage);
        const selectedFile = siteHeroImageFile && siteHeroImageFile.files ? siteHeroImageFile.files[0] : null;

        if (selectedFile) {
          try {
            nextImage = await readImageFileAsDataUrl(selectedFile);
          } catch (error) {
            setNotice(siteContentNotice, "error", (error && error.message) || "Could not process selected image.");
            return;
          }
        }

        saveSiteSettings({
          homeHeroTitle: nextTitle,
          homeHeroText: nextText,
          homeHeroImage: nextImage
        });
        hydrateSiteCustomizationForms();
        setNotice(siteContentNotice, "success", "Homepage settings saved.");
      });
    }

    if (aboutContentForm) {
      aboutContentForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        clearNotice(aboutContentNotice);

        const nextSettings = {
          aboutHeading: (aboutAdminHeading.value || "").trim(),
          aboutIntro: (aboutAdminIntro.value || "").trim(),
          aboutSpecialties: (aboutAdminSpecialties.value || "").trim(),
          aboutCertifications: (aboutAdminCertifications.value || "").trim(),
          aboutCoachingStyle: (aboutAdminCoachingStyle.value || "").trim(),
          aboutServing: (aboutAdminServing.value || "").trim(),
          aboutLocationNote: (aboutAdminLocationNote.value || "").trim(),
          aboutMapQuery: normalizeAboutMapQuery(aboutAdminMapQuery ? aboutAdminMapQuery.value : "")
        };

        const missing = Object.values(nextSettings).some((value) => !value);
        if (missing) {
          setNotice(aboutContentNotice, "error", "Please complete all About page fields.");
          return;
        }

        const existingSettings = getSiteSettings();
        let nextAboutPhoto = normalizeAboutPhotoSrc(existingSettings.aboutPhoto);
        const selectedFile = aboutImageFile && aboutImageFile.files ? aboutImageFile.files[0] : null;

        if (selectedFile) {
          try {
            nextAboutPhoto = await readImageFileAsDataUrl(selectedFile);
          } catch (error) {
            setNotice(aboutContentNotice, "error", (error && error.message) || "Could not process selected image.");
            return;
          }
        }

        saveSiteSettings({ ...nextSettings, aboutPhoto: nextAboutPhoto });
        hydrateSiteCustomizationForms();
        setNotice(aboutContentNotice, "success", "About page settings saved.");
      });
    }
    attachDelegatedHandlers();
  }

  function applyAuthNavVisibility() {
    const signedIn = Boolean(getCurrentClient());
    document.querySelectorAll("[data-nav=\"booking\"]").forEach((link) => {
      link.classList.toggle("hidden", !signedIn);
      link.setAttribute("aria-hidden", signedIn ? "false" : "true");
    });
  }

  function setActiveNav() {
    const page = document.body.dataset.page;
    if (!page) return;
    document.querySelectorAll("[data-nav]").forEach((link) => {
      if (link.dataset.nav === page) {
        link.classList.add("active");
      }
    });
  }

  function init() {
    seedData();
    if (!localStorage.getItem(KEYS.siteSettings)) {
      save(KEYS.siteSettings, defaultSiteSettings());
    }
    if (!localStorage.getItem(KEYS.availabilityDefaults)) {
      save(KEYS.availabilityDefaults, defaultAvailabilityDefaults());
    }
    migrateLegacySeedReviews();
    applySiteCustomization();
    applyAuthNavVisibility();
    setActiveNav();

    const page = document.body.dataset.page;
    if (page === "home") initHome();
    if (page === "start") initConsultForm();
    if (page === "booking") initBookingPage();
    if (page === "portal") initClientPortal();
    if (page === "programs") initProgramsPage();
    if (page === "reviews") initReviewsPage();
    if (page === "admin") initAdmin();
  }

  document.addEventListener("DOMContentLoaded", init);
})();





















































































































































