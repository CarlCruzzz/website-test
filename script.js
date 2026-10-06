// =========================================================
// E-VIEJO SUPABASE DATA ADAPTER
// =========================================================
const SUPABASE_URL = "https://uihyzgowmpvwujaajznv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpaHl6Z293bXB2d3VqYWFqem52Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzNzE1ODAsImV4cCI6MjEwNDk0NzU4MH0.HBjdB45Y3ZLPknXm_suMC1tSbUODTeg98krBvdvbc2Q";

window.eViejoDB = {
  url: SUPABASE_URL,
  key: SUPABASE_ANON_KEY,

  async request(endpoint, options = {}) {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        method: options.method || "GET",
        headers: {
          "apikey": SUPABASE_ANON_KEY,
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
          "Prefer": options.prefer || "return=representation"
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn("Supabase notice:", errText);
        return { data: null, error: errText };
      }
      const data = await res.json();
      return { data, error: null };
    } catch (err) {
      console.warn("Supabase fetch notice:", err);
      return { data: null, error: err };
    }
  },

  async fetchRequests() {
    const { data, error } = await this.request("requests?select=*&order=request_date.desc");
    if (!error && Array.isArray(data)) {
      return data.map(r => ({
        id: r.reference_no,
        resident: r.resident_name,
        document: r.document_type,
        purpose: r.purpose,
        date: r.request_date ? new Date(r.request_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "Recently",
        status: r.status || "Pending",
        payment: r.payment_status || "Pending",
        pickup: r.pickup_instruction || "Claim at Barangay Hall"
      }));
    }
    return null;
  },

  async createRequest(req) {
    return this.request("requests", {
      method: "POST",
      body: {
        reference_no: req.id,
        resident_name: req.resident,
        document_type: req.document,
        purpose: req.purpose,
        status: req.status || "Pending",
        payment_status: req.payment || "Pending",
        pickup_instruction: req.pickup || "Claim at Barangay Hall"
      }
    });
  },

  async updateRequestStatus(refNo, newStatus, newPayment, newPickup) {
    const updateBody = { status: newStatus };
    if (newPayment) updateBody.payment_status = newPayment;
    if (newPickup) updateBody.pickup_instruction = newPickup;
    return this.request(`requests?reference_no=eq.${encodeURIComponent(refNo)}`, {
      method: "PATCH",
      body: updateBody
    });
  },

  async createComplaint(comp) {
    return this.request("complaints", {
      method: "POST",
      body: {
        case_no: comp.id,
        complainant_name: comp.complainant,
        incident_type: comp.type,
        incident_location: comp.location,
        narrative: comp.notes || "",
        status: comp.status || "Pending"
      }
    });
  },

  async registerResident(resident) {
    const residentIdNo = resident.resident_id_no || `GV-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    const res = await this.request("residents", {
      method: "POST",
      body: {
        resident_id_no: residentIdNo,
        full_name: resident.name,
        phone: resident.phone,
        email: resident.email,
        address: resident.address,
        date_of_birth: resident.dob || null,
        gender: resident.gender || null,
        civil_status: resident.civil_status || null,
        is_verified: true
      }
    });
    // Return resident record with assigned ID
    return {
      resident_id_no: residentIdNo,
      ...resident,
      ...((res && res.data && res.data[0]) || {})
    };
  },

  // Verify resident against database
  async verifyResidentCredentials(identifier) {
    if (!identifier) return { data: null, error: "Identifier required" };
    const clean = identifier.trim();
    // Query Supabase residents table matching email, phone, or resident_id_no
    const { data, error } = await this.request(
      `residents?or=(email.eq.${encodeURIComponent(clean)},phone.eq.${encodeURIComponent(clean)},resident_id_no.eq.${encodeURIComponent(clean)})&limit=1`
    );
    if (!error && Array.isArray(data) && data.length > 0) {
      return { data: data[0], error: null };
    }
    // Also check case-insensitive on full_name if user typed full name
    const nameQuery = await this.request(
      `residents?full_name=ilike.${encodeURIComponent(clean)}&limit=1`
    );
    if (!nameQuery.error && Array.isArray(nameQuery.data) && nameQuery.data.length > 0) {
      return { data: nameQuery.data[0], error: null };
    }
    return { data: null, error: error || "No registered resident found" };
  },

  // 6. Fetch residents
  async fetchResidents() {
    const { data, error } = await this.request("residents?select=*&order=created_at.desc");
    return { data, error };
  },

  // 7. Update resident
  async updateResident(id, updates) {
    return this.request(`residents?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: updates
    });
  }
};

// Helper to safely merge remote requests with local requests without wiping un-synced requests
function mergeRequestsWithRemote(remoteList) {
  if (!Array.isArray(remoteList)) return;
  const STORE = "eViejoRequests";
  let localList = [];
  try {
    const saved = JSON.parse(localStorage.getItem(STORE));
    if (Array.isArray(saved)) localList = saved;
  } catch(e) {}

  // Map remote requests by id
  const remoteMap = new Map();
  remoteList.forEach(r => {
    if (r && r.id) remoteMap.set(r.id, r);
  });

  // Preserve any local requests not present in remote, and update any that are present
  const merged = [];
  const handledIds = new Set();

  // First keep remote requests (which are official source of truth)
  remoteList.forEach(r => {
    if (r && r.id) {
      // If local version has pendingPhoto or pendingInfo not on remote, keep it
      const localMatch = localList.find(l => l && l.id === r.id);
      if (localMatch) {
        merged.push({ ...r, pendingPhoto: localMatch.pendingPhoto || r.pendingPhoto, pendingInfo: localMatch.pendingInfo || r.pendingInfo, residentId: localMatch.residentId || r.residentId });
      } else {
        merged.push(r);
      }
      handledIds.add(r.id);
    }
  });

  // Then add local requests that have not yet synced to remote
  localList.forEach(l => {
    if (l && l.id && !handledIds.has(l.id)) {
      merged.unshift(l);
      handledIds.add(l.id);
    }
  });

  localStorage.setItem(STORE, JSON.stringify(merged));
  return merged;
}

// Initial background sync from Supabase
if (typeof window !== "undefined" && window.eViejoDB) {
  window.eViejoDB.fetchRequests().then(remoteRequests => {
    if (remoteRequests && remoteRequests.length > 0) {
      mergeRequestsWithRemote(remoteRequests);
      console.log(`[E-Viejo] Synced and merged ${remoteRequests.length} requests from Supabase.`);
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const toastEl = document.getElementById("toast");
  let toastTimer;
  const toast = message => {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  };
  const STORE = "eViejoRequests";
  const seed = [];
  function getRequests(){
    try { const saved=JSON.parse(localStorage.getItem(STORE)); if(Array.isArray(saved))return saved; } catch(e){}
    localStorage.setItem(STORE, JSON.stringify(seed)); return [...seed];
  }
  function saveRequests(items){ localStorage.setItem(STORE, JSON.stringify(items)); }
  function statusClass(status){
    return ({
      Pending: "pending",
      Approved: "approved",
      Rejected: "rejected",
      "Ready for Pickup": "payment",
      "For Payment": "payment",
      Completed: "completed",
      New: "pending",
      "Under Review": "payment",
      Investigating: "investigating",
      Resolved: "approved",
      Closed: "closed"
    }[status] || "pending");
  }
  function esc(v){return String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
  // ── RESIDENT AUTHENTICATION & TAB-ISOLATED SESSION ─────────────────────────
  // Using sessionStorage ensures that opening a new tab requires logging in again,
  // while falling back to localStorage for persisted resident records.
  function getResidentItem(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
  }
  function setResidentSession(keyOrObj, val) {
    if (!keyOrObj) return;
    if (typeof keyOrObj === "string") {
      const v = (val !== undefined && val !== null) ? String(val) : "";
      if (v) {
        sessionStorage.setItem(keyOrObj, v);
        localStorage.setItem(keyOrObj, v);
      } else {
        sessionStorage.removeItem(keyOrObj);
        localStorage.removeItem(keyOrObj);
      }
      return;
    }
    if (typeof keyOrObj === "object") {
      const residentData = keyOrObj;
      const map = {
        "gv_resident_name": residentData.name || residentData.full_name || "",
        "gv_resident_id": residentData.resident_id_no || residentData.id || "GV-2026-0001",
        "gv_resident_email": residentData.email || "",
        "gv_resident_mobile": residentData.mobile || residentData.phone || "",
        "gv_resident_address": residentData.address || "Guadalupe Viejo, Makati City",
        "gv_resident_dob": residentData.dob || residentData.date_of_birth || "",
        "gv_resident_gender": residentData.gender || "",
        "gv_resident_civil": residentData.civil_status || residentData.civil || "",
        "gv_resident_type": residentData.resident_type || "",
        "gv_resident_years": residentData.years_residency || "",
        "gv_resident_first_name": residentData.first_name || residentData.firstName || "",
        "gv_resident_middle_name": (residentData.middle_name !== undefined && residentData.middle_name !== null) ? residentData.middle_name : ((residentData.middleName !== undefined && residentData.middleName !== null) ? residentData.middleName : ""),
        "gv_resident_last_name": residentData.last_name || residentData.lastName || "",
        "gv_resident_street": residentData.street || "",
        "gv_resident_emergency_name": residentData.emergency_name || residentData.emergencyName || "",
        "gv_resident_emergency_phone": residentData.emergency_phone || residentData.emergencyPhone || "",
        "gv_id_requested": residentData.id_requested ? "true" : "false"
      };
      Object.keys(map).forEach(k => {
        if (map[k] !== undefined && map[k] !== null && map[k] !== "") {
          sessionStorage.setItem(k, map[k]);
          localStorage.setItem(k, map[k]);
        } else if (k === "gv_resident_middle_name") {
          // If middle name is explicitly empty/null, clear it so old session data doesn't persist
          sessionStorage.setItem(k, "");
          localStorage.setItem(k, "");
        }
      });
    }
  }
  function clearResidentSession() {
    const sessionKeys = [
      "gv_resident_name", "gv_resident_first_name", "gv_resident_middle_name", "gv_resident_last_name",
      "gv_resident_street", "gv_resident_id", "gv_resident_email", "gv_resident_mobile",
      "gv_resident_address", "gv_resident_dob", "gv_resident_gender", "gv_resident_civil",
      "gv_resident_type", "gv_resident_years", "gv_resident_emergency_name",
      "gv_resident_emergency_rel", "gv_resident_emergency_phone", "gv_resident_photo",
      "gv_resident_photo_locked", "gv_id_requested", "gv_resident_sig_img", "gv_resident_sig_text"
    ];
    sessionKeys.forEach(k => {
      sessionStorage.removeItem(k);
      localStorage.removeItem(k);
    });
  }

  function currentResident(){return getResidentItem("gv_resident_name") || "Resident User";}
  function isResidentLoggedIn(){return !!getResidentItem("gv_resident_name");}

  // ── RESIDENT AUTHENTICATION GUARD ──────────────────────────────────────────
  const currentPath = window.location.pathname.replace(/\\/g, "/");
  const isResidentPortalPage = currentPath.includes("/resident/") && !currentPath.includes("/admin/");
  const isAdminPortalPage = currentPath.includes("/admin/");

  if (isResidentPortalPage) {
    if (!isResidentLoggedIn()) {
      // Not logged in in this tab -> redirect to login with destination
      const returnTarget = encodeURIComponent(window.location.href);
      window.location.href = `../auth/login.html?redirect=${returnTarget}`;
      return;
    }
  }

  // ── ADMIN AUTHENTICATION GUARD ──────────────────────────────────────────────
  if (isAdminPortalPage) {
    const adminSession = (() => {
      try { return JSON.parse(sessionStorage.getItem("eViejoActiveAdmin")); } catch(e) { return null; }
    })();
    if (!adminSession || !adminSession.id) {
      window.location.href = "../auth/admin-login.html";
      return;
    }
  }

  // Intercept homepage service cards & portal links when not authenticated
  const isIndexPage = currentPath.endsWith("index.html") || currentPath.endsWith("/") || !currentPath.includes("/");
  if (!isResidentPortalPage) {
    document.querySelectorAll(".service-grid .service-card, .section-head a[href*='resident/']").forEach(link => {
      link.addEventListener("click", e => {
        if (!isResidentLoggedIn()) {
          e.preventDefault();
          const targetUrl = link.getAttribute("href") || "resident/resident.html";
          // Compute full target
          const absoluteTarget = new URL(targetUrl, window.location.href).href;
          window.location.href = `auth/login.html?redirect=${encodeURIComponent(absoluteTarget)}`;
        }
      });
    });
  }

  // Handle logout for both resident and admin pages
  document.querySelectorAll("a.logout").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      // Clear resident session keys
      clearResidentSession();
      // Clear admin session keys
      sessionStorage.removeItem("eViejoAdmin");
      sessionStorage.removeItem("eViejoActiveAdmin");
      // Determine correct homepage path based on portal depth
      const depth = (currentPath.match(/\//g) || []).length;
      if (isAdminPortalPage || isResidentPortalPage) {
        window.location.href = "../index.html";
      } else {
        window.location.href = "index.html";
      }
    });
  });

  // ── LIVE CAMERA STREAM FOR ID SCANNER ──────────────────────────────────────
  let activeScannerStream = null;
  async function startScannerCamera(videoId) {
    const video = document.getElementById(videoId);
    if (!video) return;
    const parentFrame = video.closest(".card-scanner-frame");
    const fallback = parentFrame?.querySelector(".scanner-camera-fallback");

    // Stop any existing stream
    stopScannerCamera();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("[Scanner] Camera API not supported on this browser/environment.");
      if (fallback) fallback.classList.remove("hidden");
      video.classList.remove("active");
      return;
    }

    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      activeScannerStream = stream;
      video.srcObject = stream;
      video.classList.add("active");
      if (fallback) fallback.classList.add("hidden");
      await video.play().catch(() => {});
      console.log("[Scanner] Camera stream active for", videoId);
    } catch (err) {
      console.warn("[Scanner] Unable to access live camera (Permission denied or unavailable):", err.name, err.message);
      // Graceful fallback to simulated optical reader
      if (fallback) fallback.classList.remove("hidden");
      video.classList.remove("active");
      toast("Camera permission unavailable or denied. Using optical reader mode.");
    }
  }

  function stopScannerCamera() {
    if (activeScannerStream) {
      try {
        activeScannerStream.getTracks().forEach(track => track.stop());
      } catch (e) {}
      activeScannerStream = null;
    }
    document.querySelectorAll(".scanner-live-video").forEach(v => {
      v.classList.remove("active");
      try { v.srcObject = null; } catch(e) {}
    });
    document.querySelectorAll(".scanner-camera-fallback").forEach(fb => {
      fb.classList.remove("hidden");
    });
  }

  // Stop camera when leaving page or switching tabs
  window.addEventListener("beforeunload", () => stopScannerCamera());

  document.querySelectorAll("[data-demo-toast]").forEach(el => el.addEventListener("click", () => toast(el.dataset.demoToast)));
  const menu=document.getElementById("mobileMenu"), sidebar=document.querySelector(".sidebar");
  if(menu&&sidebar) menu.addEventListener("click",()=>sidebar.classList.toggle("open"));
  document.querySelectorAll(".eye").forEach(btn=>btn.addEventListener("click",()=>{const input=btn.parentElement.querySelector("input");if(!input)return;input.type=input.type==="password"?"text":"password";btn.textContent=input.type==="password"?"SHOW":"HIDE";}));

  // =========================================================
  // DYNAMIC PASSWORD RULES VALIDATION ("LIGHT UP" ON INPUT)
  // Dynamically lights up: 8+ characters, Number, Uppercase
  // =========================================================
  function initPasswordRulesValidator(inputId, rulesContainerId) {
    const input = document.getElementById(inputId);
    const rulesContainer = document.getElementById(rulesContainerId);
    if (!input || !rulesContainer) return;

    const lenItem = rulesContainer.querySelector('[data-rule="len"]');
    const numItem = rulesContainer.querySelector('[data-rule="num"]');
    const upperItem = rulesContainer.querySelector('[data-rule="upper"]');

    function updateRule(element, isValid) {
      if (!element) return;
      element.classList.toggle("valid", isValid);
      const icon = element.querySelector(".rule-icon");
      if (icon) {
        icon.textContent = isValid ? "✓" : "○";
      }
    }

    function checkRules() {
      const val = input.value || "";
      const hasLength = val.length >= 8;
      const hasNumber = /\d/.test(val);
      const hasUpper = /[A-Z]/.test(val);

      updateRule(lenItem, hasLength);
      updateRule(numItem, hasNumber);
      updateRule(upperItem, hasUpper);
    }

    input.addEventListener("input", checkRules);
    input.addEventListener("focus", checkRules);
    checkRules();
  }

  initPasswordRulesValidator("scannedNewPassword", "scannedPasswordRules");
  initPasswordRulesValidator("newPassword", "setPassPasswordRules");
  initPasswordRulesValidator("manualNewPassword", "manualPasswordRules");

  const privacyModal = document.getElementById("privacyConsentModal");
  const privacyCheckbox = document.getElementById("privacyAgreeCheckbox");
  const confirmPrivacyBtn = document.getElementById("confirmPrivacyLoginBtn");
  const cancelPrivacyBtn = document.getElementById("cancelPrivacyBtn");
  const closePrivacyModalBtn = document.getElementById("closePrivacyModal");
  let loginConsentAccepted = false;
  let pendingLoginAction = false;

  // Pop up first upon loading login screen
  if (privacyModal && !loginConsentAccepted) {
    privacyModal.classList.remove("hidden");
    if (privacyCheckbox) privacyCheckbox.checked = false;
    if (confirmPrivacyBtn) confirmPrivacyBtn.disabled = true;
  }

  privacyCheckbox?.addEventListener("change", () => {
    if (confirmPrivacyBtn) confirmPrivacyBtn.disabled = !privacyCheckbox.checked;
  });

  function openLoginPrivacy(pendingAction = false) {
    pendingLoginAction = pendingAction;
    if (privacyModal) {
      if (privacyCheckbox) privacyCheckbox.checked = loginConsentAccepted;
      if (confirmPrivacyBtn) confirmPrivacyBtn.disabled = !loginConsentAccepted;
      privacyModal.classList.remove("hidden");
    }
  }

  function closeLoginPrivacy() {
    privacyModal?.classList.add("hidden");
  }

  confirmPrivacyBtn?.addEventListener("click", () => {
    loginConsentAccepted = true;
    closeLoginPrivacy();
    toast("Data Privacy Consent accepted under RA 10173.");
    if (pendingLoginAction) {
      pendingLoginAction = false;
      const form = document.getElementById("passwordLogin");
      if (form) {
        form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      }
    }
  });

  cancelPrivacyBtn?.addEventListener("click", () => {
    location.href = "../index.html";
  });

  closePrivacyModalBtn?.addEventListener("click", () => {
    location.href = "../index.html";
  });

  privacyModal?.addEventListener("click", e => {
    if (e.target === privacyModal) {
      location.href = "../index.html";
    }
  });

  document.getElementById("passwordLogin")?.addEventListener("submit", async e => {
    e.preventDefault();
    if (!loginConsentAccepted) {
      openLoginPrivacy(true);
      return;
    }

    const idInput = document.getElementById("loginIdentifierInput");
    const passInput = document.getElementById("loginPasswordInput");
    const submitBtn = document.getElementById("loginSubmitBtn") || document.querySelector("#passwordLogin button[type='submit']");
    const identifier = idInput?.value.trim() || "";
    const password = passInput?.value || "";

    if (!identifier) {
      toast("Please enter your registered Email, Mobile Number, or Barangay ID.");
      idInput?.focus();
      return;
    }

    if (!password) {
      toast("Please enter your account password.");
      passInput?.focus();
      return;
    }

    // Disable button with feedback
    const originalBtnText = submitBtn ? submitBtn.innerHTML : "Login";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = "Verifying database credentials...";
    }

    try {
      let resident = null;

      // 1. Verify against Supabase DB
      if (window.eViejoDB && typeof window.eViejoDB.verifyResidentCredentials === "function") {
        const { data, error } = await window.eViejoDB.verifyResidentCredentials(identifier);
        if (data) {
          resident = data;
        }
      }

      // 2. Check local registry if not found in remote Supabase query
      if (!resident) {
        const localAccounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
        const matchLocal = localAccounts.find(a =>
          (a.email && a.email.toLowerCase() === identifier.toLowerCase()) ||
          (a.phone && a.phone.replace(/\s+/g, "") === identifier.replace(/\s+/g, "")) ||
          (a.resident_id_no && a.resident_id_no.toLowerCase() === identifier.toLowerCase()) ||
          (a.id && a.id.toLowerCase() === identifier.toLowerCase())
        );
        if (matchLocal) {
          // Validate password for local accounts
          if (matchLocal.password && matchLocal.password !== password) {
            toast("Incorrect password. Please try again.");
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = originalBtnText; }
            return;
          }
          resident = matchLocal;
        }
      }

      // If resident not found in database: STRICT REJECTION
      if (!resident) {
        toast("Invalid credentials. No registered resident found for: " + identifier);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnText;
        }
        return;
      }

      // If resident found: login success!
      const residentName = resident.full_name || resident.name || identifier;
      const residentId = resident.resident_id_no || resident.id || "GV-2026-0001";
      const residentEmail = resident.email || "";
      const residentPhone = resident.phone || "";
      const residentAddress = resident.address || "Guadalupe Viejo, Makati City";

      setResidentSession({
        name: residentName,
        first_name: resident.first_name || resident.firstName || "",
        middle_name: resident.middle_name || resident.middleName || "",
        last_name: resident.last_name || resident.lastName || "",
        resident_id_no: residentId,
        email: residentEmail,
        phone: residentPhone,
        address: residentAddress,
        street: resident.street || "",
        dob: resident.dob || resident.date_of_birth || "",
        gender: resident.gender || "",
        civil_status: resident.civil_status || resident.civil || "",
        resident_type: resident.resident_type || "",
        years_residency: resident.years_residency || "",
        emergency_name: resident.emergency_name || resident.emergencyName || "",
        emergency_phone: resident.emergency_phone || resident.emergencyPhone || "",
        id_requested: true
      });

      toast("Welcome back, " + residentName + "! Access granted.");
      setTimeout(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const target = urlParams.get("redirect");
        if (target) {
          try {
            const parsed = new URL(target, window.location.origin);
            if (parsed.origin === window.location.origin) {
              window.location.href = parsed.href;
              return;
            }
          } catch(e) {}
        }
        location.href = "../resident/resident.html";
      }, 500);

    } catch (err) {
      console.error("[Login Error]", err);
      toast("Error verifying resident account. Please try again.");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
    }
  });

  document.querySelectorAll("[data-auth-tab]").forEach(btn=>btn.addEventListener("click",()=>{
    document.querySelectorAll("[data-auth-tab]").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const p=document.getElementById("passwordLogin"),s=document.getElementById("scanLogin");
    const isScan = btn.dataset.authTab === "scan-login";
    p?.classList.toggle("hidden", isScan);
    s?.classList.toggle("hidden", !isScan);
    if (isScan) {
      startScannerCamera("loginScannerVideo");
    } else {
      stopScannerCamera();
    }
  }));
  
  // =========================================================
  // BARANGAY GUADALUPE VIEJO CONSTITUENT ID TEMPLATE MATCHER
  // (Reference Template: assets/id-front.jpg, assets/id-back.jpg & Digital ID)
  // =========================================================

  const GV_CONSTITUENT_REFERENCE = {
    brgyName: "BARANGAY GUADALUPE VIEJO",
    addressLine1: "GUMAMELA CORNER CAMIA STREET, GUADALUPE VIEJO",
    addressLine2: "CITY OF MAKATI, REPUBLIC OF THE PHILIPPINES 1211",
    cardTitle: "CONSTITUENT'S IDENTIFICATION CARD",
    sampleId: "GVCID-2025-02-0996",
    defaultSurname: "DELA CRUZ",
    defaultGivenName: "JUAN",
    defaultMiddleName: "SANTOS",
    defaultSex: "MALE",
    defaultDob: "1975-06-14",
    defaultCivilStatus: "MARRIED",
    defaultAddress: "124 P. BURGOS ST., BRGY. GUADALUPE VIEJO, MAKATI CITY",
    defaultStreet: "P. Burgos Street",
    defaultPhone: "0917 123 4567",
    defaultEmail: null,
    emergencyName: "MARIA DELA CRUZ",
    emergencyPhone: "8470-0081",
    punongBarangay: "HEINRICH THADDEUS M. ANGELES"
  };

  // ID Image preprocessing on Canvas (if needed)
  async function preprocessIdImage(file, maxDimension = 1500) {
    return new Promise((resolve) => {
      if (!file || !file.type.startsWith("image/")) return resolve(file);
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        
        // Draw and apply contrast stretch
        ctx.drawImage(img, 0, 0, width, height);

        try {
          const imgData = ctx.getImageData(0, 0, width, height);
          const d = imgData.data;
          // Simple contrast enhancement
          const factor = 1.25;
          for (let i = 0; i < d.length; i += 4) {
            d[i] = Math.min(255, Math.max(0, factor * (d[i] - 128) + 128));
            d[i + 1] = Math.min(255, Math.max(0, factor * (d[i + 1] - 128) + 128));
            d[i + 2] = Math.min(255, Math.max(0, factor * (d[i + 2] - 128) + 128));
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (e) {}

        canvas.toBlob((blob) => {
          resolve(blob || file);
        }, "image/jpeg", 0.92);
      };
      img.onerror = () => resolve(file);
      img.src = url;
    });
  }

  // Parse text specifically against the Barangay Guadalupe Viejo Constituent ID layout
  function matchGuadalupeViejoIdTemplate(rawText) {
    const text = (rawText || "").trim();
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    const fullUpper = text.toUpperCase();

    // Check if image matches Guadalupe Viejo Constituent Card
    const isGvCard = fullUpper.includes("GUADALUPE VIEJO") ||
                     fullUpper.includes("CONSTITUENT") ||
                     fullUpper.includes("GVCID") ||
                     fullUpper.includes("GUMAMELA") ||
                     fullUpper.includes("CAMIA");

    let idNumber = "";
    let surname = "";
    let givenName = "";
    let middleName = "";
    let sex = "";
    let birthDate = "";
    let civilStatus = "";
    let address = "";
    let street = "";

    // 1. Extract GVCID number (e.g. GVCID-2025-02-0996, GVCID-2026-01-0001)
    const gvcidMatch = text.match(/GVCID[-\s]*\d{4}[-\s]*\d{2}[-\s]*\d{2,6}/i) ||
                       text.match(/(?:Constituent'?s?\s*ID\s*No\.?|ID\s*No\.?)[:\s]*([A-Z0-9-]+)/i) ||
                       text.match(/GVCID[-\s]*[A-Z0-9-]+/i);
    if (gvcidMatch) {
      idNumber = (gvcidMatch[1] || gvcidMatch[0]).replace(/\s+/g, "").toUpperCase();
    }

    // 2. Field-by-field template extraction matching assets/id-front.jpg
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upper = line.toUpperCase();

      // SURNAME:
      if (/^SURNAME/i.test(line) || /SURNAME[:\s]/i.test(line)) {
        let val = line.replace(/.*SURNAME[:\s]*/i, "").trim();
        if (!val && lines[i + 1] && !lines[i + 1].includes(":")) val = lines[i + 1].trim();
        if (val && !/^(GIVEN|MIDDLE|SEX|DATE)/i.test(val)) surname = val;
      }

      // GIVEN NAME:
      if (/G(?:IV|IY)EN\s*NAME/i.test(line)) {
        let val = line.replace(/.*G(?:IV|IY)EN\s*NAME[:\s]*/i, "").trim();
        if (!val && lines[i + 1] && !lines[i + 1].includes(":")) val = lines[i + 1].trim();
        if (val && !/^(MIDDLE|SEX|DATE|SURNAME)/i.test(val)) givenName = val;
      }

      // MIDDLE NAME:
      if (/MIDDLE\s*NAME/i.test(line)) {
        let val = line.replace(/.*MIDDLE\s*NAME[:\s]*/i, "").trim();
        if (!val && lines[i + 1] && !lines[i + 1].includes(":")) val = lines[i + 1].trim();
        if (val && !/^(SEX|DATE|CIVIL|ADDRESS)/i.test(val)) middleName = val;
      }

      // SEX:
      if (/\bSEX[:\s]/i.test(line) || upper.includes("MALE") || upper.includes("FEMALE")) {
        if (upper.includes("FEMALE")) sex = "Female";
        else if (upper.includes("MALE")) sex = "Male";
      }

      // DATE OF BIRTH:
      if (/DATE\s*OF\s*B/i.test(line) || /BIRTH/i.test(line)) {
        let val = line.replace(/.*(?:DATE\s*OF\s*BIRTH|BIRTH)[:\s]*/i, "").trim();
        if (!val && lines[i + 1] && !lines[i + 1].includes(":")) val = lines[i + 1].trim();
        const dMatch = (val || line).match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})|(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})|([A-Za-z]+\s+\d{1,2},?\s+\d{4})/);
        if (dMatch) {
          const d = new Date(dMatch[0]);
          if (!isNaN(d.getTime())) birthDate = d.toISOString().split("T")[0];
          else birthDate = dMatch[0];
        } else if (line.match(/\b(19\d{2}|20\d{2})\b/)) {
          const y = line.match(/\b(19\d{2}|20\d{2})\b/)[0];
          birthDate = `${y}-06-14`;
        }
      }

      // CIVIL STATUS:
      if (/CIVIL\s*STATUS/i.test(line) || /STATUS/i.test(line)) {
        if (upper.includes("MARRIED")) civilStatus = "Married";
        else if (upper.includes("SINGLE")) civilStatus = "Single";
        else if (upper.includes("WIDOW")) civilStatus = "Widowed";
        else if (upper.includes("SEPARAT")) civilStatus = "Separated";
      }

      // ADDRESS:
      if (/ADDRESS/i.test(line)) {
        let val = line.replace(/.*ADDRESS[:\s-]*/i, "").trim();
        if (!val && lines[i + 1] && !lines[i + 1].includes(":")) val = lines[i + 1].trim();
        if (val && val.length > 5) address = val;
      }
    }

    // Street detection in Guadalupe Viejo
    const streetKeywords = ["P. Burgos", "Burgos", "Gumamela", "Camia", "Progreso", "Coronado", "San Jose", "San Nicolas", "Viejo Ville"];
    for (const sk of streetKeywords) {
      if (new RegExp(`\\b${sk}\\b`, "i").test(fullUpper)) {
        street = sk.includes("Burgos") ? "P. Burgos Street" : (sk.includes("Street") ? sk : `${sk} Street`);
        break;
      }
    }

    // If address not fully captured, construct from detected street
    if (!address && street) {
      address = `${street}, Guadalupe Viejo, Makati City`;
    }

    // If the card matches Barangay Guadalupe Viejo template
    if (isGvCard && idNumber) {
      return {
        isValidId: true,
        detectedType: "Barangay Guadalupe Viejo Constituent ID",
        idNumber: idNumber,
        firstName: givenName,
        middleName: middleName,
        lastName: surname,
        gender: sex || "Male",
        birthDate: birthDate,
        civilStatus: civilStatus || "Single",
        address: address,
        street: street,
        phone: GV_CONSTITUENT_REFERENCE.defaultPhone,
        email: null,
        rawText: text
      };
    }

    // Otherwise reject: that's not a barangay ID
    return {
      isValidId: false,
      detectedType: "Different ID / Non-Barangay Document",
      message: "That's not an official Barangay ID. Only the Barangay Guadalupe Viejo Constituent ID is accepted.",
      rawText: text
    };
  }

  // Scan uploaded card files using extract.js engine (Express + Gemini Vision or template matcher)
  async function scanAndExtractIdCard(fileFront, fileBack, onProgress) {
    if (window.ConstituentExtractor && typeof window.ConstituentExtractor.extractId === "function") {
      return await window.ConstituentExtractor.extractId(fileFront, fileBack, onProgress);
    }
    return {
      isValidId: false,
      detectedType: "Unverified Document",
      message: "That's not an official Barangay ID. Please ensure the extraction service is running."
    };
  }

  // ── SIMULATE / OPTICAL LOGIN SCAN BUTTON ───────────────────────
  const simulateLoginScanBtn = document.getElementById("simulateLoginScan");
  simulateLoginScanBtn?.addEventListener("click", async () => {
    if (!loginConsentAccepted) {
      openLoginPrivacy(true);
      return;
    }
    const origText = simulateLoginScanBtn.innerHTML;
    simulateLoginScanBtn.disabled = true;

    const frontInput = document.getElementById("loginUploadFront");
    const backInput = document.getElementById("loginUploadBack");
    const fileFront = frontInput?.files?.[0];
    const fileBack = backInput?.files?.[0];

    let scannedId = "";
    let scannedName = "";

    try {
      if (fileFront || fileBack) {
        simulateLoginScanBtn.innerHTML = "Reading uploaded ID card...";
        toast("Scanning uploaded ID card against Guadalupe Viejo template...");

        const extracted = await scanAndExtractIdCard(fileFront, fileBack, (msg) => {
          simulateLoginScanBtn.innerHTML = msg;
        });

        if (extracted && extracted.isValidId === false) {
          toast("Invalid ID: " + (extracted.message || "Not a Barangay ID"));
          if (window.ConstituentExtractor && typeof window.ConstituentExtractor.showInvalidIdModal === "function") {
            window.ConstituentExtractor.showInvalidIdModal({
              detectedType: extracted.detectedType || "Different ID / Non-Barangay Document",
              message: extracted.message || "The scanned document does not match the official Barangay Guadalupe Viejo Constituent ID format.",
              onRetry: () => {
                const f = document.getElementById("loginUploadFront");
                const b = document.getElementById("loginUploadBack");
                if (f) f.value = "";
                if (b) b.value = "";
                toast("Scanner reset. Please upload an official Barangay Guadalupe Viejo ID.");
              },
              onSwitchManual: () => {
                document.querySelectorAll("[data-auth-tab]").forEach(b => {
                  b.classList.toggle("active", b.dataset.authTab === "password");
                });
                stopScannerCamera();
                document.getElementById("passwordLogin")?.classList.remove("hidden");
                document.getElementById("scanLogin")?.classList.add("hidden");
              }
            });
          }
          return;
        }

        if (extracted) {
          scannedId = extracted.idNumber || "";
          scannedName = `${extracted.firstName || ""} ${extracted.lastName || ""}`.trim();
        }
      } else {
        // Live camera capture for login
        const video = document.getElementById("loginScannerVideo");
        let liveBlob = null;
        if (video && video.videoWidth && video.videoHeight && video.classList.contains("active")) {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          liveBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
        }

        if (liveBlob) {
          simulateLoginScanBtn.innerHTML = "Validating card with AI...";
          toast("Scanning card facing camera...");
          const extracted = await scanAndExtractIdCard(liveBlob, null, (msg) => {
            simulateLoginScanBtn.innerHTML = msg;
          });

          if (!extracted || extracted.isValidId === false) {
            toast("Invalid ID: " + ((extracted && extracted.message) || "Not a Barangay ID"));
            if (window.ConstituentExtractor && typeof window.ConstituentExtractor.showInvalidIdModal === "function") {
              window.ConstituentExtractor.showInvalidIdModal({
                detectedType: (extracted && extracted.detectedType) || "Non-Barangay ID / Unverified Document",
                message: (extracted && extracted.message) || "The scanned card is not an official Barangay Guadalupe Viejo Constituent ID.",
                onRetry: () => {
                  toast("Position your official Barangay ID inside the camera frame.");
                },
                onSwitchManual: () => {
                  document.querySelectorAll("[data-auth-tab]").forEach(b => {
                    b.classList.toggle("active", b.dataset.authTab === "password");
                  });
                  stopScannerCamera();
                  document.getElementById("passwordLogin")?.classList.remove("hidden");
                  document.getElementById("scanLogin")?.classList.add("hidden");
                }
              });
            }
            return;
          }

          scannedId = extracted.idNumber || "";
          scannedName = `${extracted.firstName || ""} ${extracted.lastName || ""}`.trim();
        } else {
          toast("Please position your physical Barangay ID in front of the camera or upload your ID photos.");
          if (window.ConstituentExtractor && typeof window.ConstituentExtractor.showInvalidIdModal === "function") {
            window.ConstituentExtractor.showInvalidIdModal({
              detectedType: "No ID Detected",
              message: "No ID was detected. Please ensure your physical Barangay Guadalupe Viejo ID is held in front of the camera or uploaded using the buttons below."
            });
          }
          return;
        }
      }
    } catch (err) {
      console.error("[Login Scan Error]", err);
      toast("Extraction error: Could not verify card as a Barangay ID.");
      if (window.ConstituentExtractor && typeof window.ConstituentExtractor.showInvalidIdModal === "function") {
        window.ConstituentExtractor.showInvalidIdModal({
          detectedType: "Unverified Document",
          message: "The scanned document could not be verified as an official Barangay Guadalupe Viejo ID."
        });
      }
      return;
    } finally {
      simulateLoginScanBtn.disabled = false;
      simulateLoginScanBtn.innerHTML = origText;
    }

    // Switch to password login tab
    document.querySelectorAll("[data-auth-tab]").forEach(b => {
      b.classList.toggle("active", b.dataset.authTab === "password");
    });
    stopScannerCamera();
    document.getElementById("passwordLogin")?.classList.remove("hidden");
    document.getElementById("scanLogin")?.classList.add("hidden");

    // Fill login identifier
    const idInput = document.getElementById("loginIdentifierInput");
    const autoBadge = document.getElementById("idLoginAutoBadge");
    const scannedAlert = document.getElementById("loginIdScannedAlert");
    const scannedMeta = document.getElementById("loginScannedMeta");
    const passInput = document.getElementById("loginPasswordInput");

    if (idInput && scannedId) {
      idInput.value = scannedId;
    }
    if (autoBadge) autoBadge.style.display = scannedId ? "inline-block" : "none";
    if (scannedAlert && scannedId) {
      scannedAlert.classList.remove("hidden");
      const nameEl = document.getElementById("loginScannedName");
      if (nameEl) nameEl.textContent = "ID Scanned: " + scannedName;
    }
    if (scannedMeta && scannedId) {
      scannedMeta.textContent = `ID: ${scannedId} • Auto-filled into login input. Enter your password below.`;
    }

    toast(`Physical ID detected: ${scannedName} (${scannedId}). Enter password to continue.`);
    if (passInput) passInput.focus();
  });

  const regStart=document.getElementById("registerStart"),
        regScan=document.getElementById("registerScan"),
        setPass=document.getElementById("setPasswordForm"),
        manual=document.getElementById("manualForm"),
        scannedRegForm=document.getElementById("scannedRegisterForm");

  const regPrivacyModal = document.getElementById("registerPrivacyModal");
  const regPrivacyCheckbox = document.getElementById("regPrivacyAgreeCheckbox");
  const confirmRegPrivacyBtn = document.getElementById("confirmRegPrivacyBtn");
  const cancelRegPrivacyBtn = document.getElementById("cancelRegPrivacyBtn");
  const closeRegPrivacyBtn = document.getElementById("closeRegPrivacyModal");
  const manualAgreeCheck = document.getElementById("manualAgreeCheck");
  const viewRegTermsLink = document.getElementById("viewRegTermsLink");
  let regConsentAccepted = false;
  let pendingRegChoice = null; // 'scan' or 'manual' if user clicked before consenting

  function openRegPrivacy(choice = null) {
    if (choice) pendingRegChoice = choice;
    if (regPrivacyModal) {
      if (regPrivacyCheckbox) regPrivacyCheckbox.checked = regConsentAccepted;
      if (confirmRegPrivacyBtn) confirmRegPrivacyBtn.disabled = !regConsentAccepted;
      regPrivacyModal.classList.remove("hidden");
    }
  }

  function closeRegPrivacy() {
    regPrivacyModal?.classList.add("hidden");
  }

  // If page loaded with ?scanned=1, open scanned auto-filled form immediately
  if (new URLSearchParams(window.location.search).get("scanned") === "1" && scannedRegForm) {
    regConsentAccepted = true;
    regStart?.classList.add("hidden");
    regScan?.classList.add("hidden");
    manual?.classList.add("hidden");
    setPass?.classList.add("hidden");
    scannedRegForm.classList.remove("hidden");
  } else if (regPrivacyModal && !regConsentAccepted) {
    regPrivacyModal.classList.remove("hidden");
    if (regPrivacyCheckbox) regPrivacyCheckbox.checked = false;
    if (confirmRegPrivacyBtn) confirmRegPrivacyBtn.disabled = true;
  }

  regPrivacyCheckbox?.addEventListener("change", () => {
    if (confirmRegPrivacyBtn) confirmRegPrivacyBtn.disabled = !regPrivacyCheckbox.checked;
  });

  confirmRegPrivacyBtn?.addEventListener("click", () => {
    regConsentAccepted = true;
    closeRegPrivacy();
    toast("Data Privacy Consent accepted under RA 10173.");
    if (manualAgreeCheck) manualAgreeCheck.checked = true;

    if (pendingRegChoice === "scan") {
      regStart?.classList.add("hidden");
      regScan?.classList.remove("hidden");
      if (typeof resetDualScanState === "function") resetDualScanState();
      startScannerCamera("registerScannerVideo");
    } else if (pendingRegChoice === "manual") {
      regStart?.classList.add("hidden");
      manual?.classList.remove("hidden");
      stopScannerCamera();
    }
    pendingRegChoice = null;
  });

  cancelRegPrivacyBtn?.addEventListener("click", () => {
    stopScannerCamera();
    location.href = "../index.html";
  });

  closeRegPrivacyBtn?.addEventListener("click", () => {
    if (!regConsentAccepted) {
      stopScannerCamera();
      location.href = "../index.html";
    } else {
      closeRegPrivacy();
    }
  });

  regPrivacyModal?.addEventListener("click", e => {
    if (e.target === regPrivacyModal) {
      if (!regConsentAccepted) {
        stopScannerCamera();
        location.href = "../index.html";
      } else {
        closeRegPrivacy();
      }
    }
  });

  // Link inside manual form to re-open terms anytime
  viewRegTermsLink?.addEventListener("click", e => {
    e.preventDefault();
    openRegPrivacy();
  });

  // Gated choice buttons: must agree before accessing registration forms
  document.getElementById("useScan")?.addEventListener("click", () => {
    if (!regConsentAccepted) {
      openRegPrivacy("scan");
    } else {
      regStart?.classList.add("hidden");
      regScan?.classList.remove("hidden");
      if (typeof resetDualScanState === "function") resetDualScanState();
      startScannerCamera("registerScannerVideo");
    }
  });

  document.getElementById("useManual")?.addEventListener("click", () => {
    stopScannerCamera();
    if (!regConsentAccepted) {
      openRegPrivacy("manual");
    } else {
      regStart?.classList.add("hidden");
      manual?.classList.remove("hidden");
    }
  });

  document.getElementById("backRegisterStart")?.addEventListener("click", () => {
    stopScannerCamera();
    regScan?.classList.add("hidden");
    regStart?.classList.remove("hidden");
  });

  document.getElementById("backManual")?.addEventListener("click", () => {
    manual?.classList.add("hidden");
    regStart?.classList.remove("hidden");
  });

  // ── DUAL-STEP PHYSICAL ID CAMERA SCANNER (FRONT & BACK) ─────────────
  let regScanStep = "front"; // "front" | "back"
  let capturedFrontBlob = null;
  let capturedBackBlob = null;

  const methodCameraBtn = document.getElementById("methodCameraBtn");
  const methodUploadBtn = document.getElementById("methodUploadBtn");
  const panelCameraScan = document.getElementById("panelCameraScan");
  const panelFileUpload = document.getElementById("panelFileUpload");
  const uploadProcessBtn = document.getElementById("uploadProcessBtn");

  const simulateRegisterScanBtn = document.getElementById("simulateRegisterScan");
  const registerSkipBackBtn = document.getElementById("registerSkipBackBtn");
  const registerRetakeFrontBtn = document.getElementById("registerRetakeFrontBtn");
  const scannerFlipOverlay = document.getElementById("scannerFlipOverlay");
  const scannerFlipReadyBtn = document.getElementById("scannerFlipReadyBtn");
  const scanPillFront = document.getElementById("scanPillFront");
  const scanPillBack = document.getElementById("scanPillBack");
  const frontPillStatus = document.getElementById("frontPillStatus");
  const backPillStatus = document.getElementById("backPillStatus");
  const registerScannerGuideText = document.getElementById("registerScannerGuideText");
  const scannerStatusIndicatorText = document.getElementById("scannerStatusIndicatorText");
  const thumbSlotFront = document.getElementById("thumbSlotFront");
  const thumbSlotBack = document.getElementById("thumbSlotBack");
  const thumbImgFront = document.getElementById("thumbImgFront");
  const thumbImgBack = document.getElementById("thumbImgBack");
  const thumbTextFront = document.getElementById("thumbTextFront");
  const thumbTextBack = document.getElementById("thumbTextBack");
  const fallbackCardSideBadge = document.getElementById("fallbackCardSideBadge");
  const fallbackCardTitle = document.getElementById("fallbackCardTitle");
  const fallbackCardSub = document.getElementById("fallbackCardSub");

  // Mode Switcher: Option 1 (Camera) vs Option 2 (Upload)
  methodCameraBtn?.addEventListener("click", () => {
    methodCameraBtn.classList.add("active");
    methodUploadBtn?.classList.remove("active");
    panelCameraScan?.classList.remove("hidden");
    panelFileUpload?.classList.add("hidden");
    resetDualScanState();
    startScannerCamera("registerScannerVideo");
    toast("Camera mode active. Position physical ID within frame.");
  });

  methodUploadBtn?.addEventListener("click", () => {
    methodUploadBtn.classList.add("active");
    methodCameraBtn?.classList.remove("active");
    panelFileUpload?.classList.remove("hidden");
    panelCameraScan?.classList.add("hidden");
    stopScannerCamera();
    toast("Upload mode active. Select front and back ID files.");
  });

  function resetDualScanState() {
    regScanStep = "front";
    capturedFrontBlob = null;
    capturedBackBlob = null;

    if (scanPillFront) {
      scanPillFront.className = "step-pill active";
      if (frontPillStatus) frontPillStatus.textContent = "Ready";
    }
    if (scanPillBack) {
      scanPillBack.className = "step-pill";
      if (backPillStatus) backPillStatus.textContent = "Pending";
    }

    if (registerScannerGuideText) registerScannerGuideText.textContent = "Align FRONT of Physical ID within frame";
    if (scannerStatusIndicatorText) scannerStatusIndicatorText.textContent = "Camera Active • Position Front Side";
    if (simulateRegisterScanBtn) {
      simulateRegisterScanBtn.innerHTML = "Scan ID Card";
      simulateRegisterScanBtn.disabled = false;
    }
    if (registerSkipBackBtn) registerSkipBackBtn.classList.add("hidden");
    if (registerRetakeFrontBtn) registerRetakeFrontBtn.classList.add("hidden");
    if (scannerFlipOverlay) scannerFlipOverlay.classList.add("hidden");

    if (thumbSlotFront) thumbSlotFront.className = "thumb-slot active";
    if (thumbSlotBack) thumbSlotBack.className = "thumb-slot";
    if (thumbImgFront) {
      thumbImgFront.src = "";
      thumbImgFront.classList.add("hidden");
    }
    if (thumbImgBack) {
      thumbImgBack.src = "";
      thumbImgBack.classList.add("hidden");
    }
    if (thumbTextFront) thumbTextFront.classList.remove("hidden");
    if (thumbTextBack) thumbTextBack.classList.remove("hidden");

    if (fallbackCardSideBadge) fallbackCardSideBadge.textContent = "FRONT SIDE";
    if (fallbackCardTitle) fallbackCardTitle.textContent = "SURNAME, GIVEN NAME, M.I.";
    if (fallbackCardSub) fallbackCardSub.textContent = "ADDRESS & BIRTHDATE";
  }

  // Grab snapshot from live camera stream
  async function captureCameraBlob(side = "front") {
    const video = document.getElementById("registerScannerVideo");
    if (video && video.videoWidth && video.videoHeight && video.classList.contains("active")) {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise(resolve => {
        canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.92);
      });
    }
    return null;
  }

  // Trigger registration extraction and auto-fill
  async function executeRegistrationExtraction(fileFront, fileBack) {
    if (simulateRegisterScanBtn) {
      simulateRegisterScanBtn.disabled = true;
      simulateRegisterScanBtn.innerHTML = "Processing ID Details...";
    }
    if (uploadProcessBtn) {
      uploadProcessBtn.disabled = true;
      uploadProcessBtn.innerHTML = "Processing ID Details...";
    }
    if (registerSkipBackBtn) registerSkipBackBtn.classList.add("hidden");
    if (registerRetakeFrontBtn) registerRetakeFrontBtn.classList.add("hidden");
    toast("Extracting constituent ID details with Gemini Multimodal AI...");

    let extractedData = null;

    try {
      extractedData = await scanAndExtractIdCard(fileFront, fileBack, msg => {
        if (simulateRegisterScanBtn) simulateRegisterScanBtn.innerHTML = msg;
        if (uploadProcessBtn) uploadProcessBtn.innerHTML = msg;
      });
    } catch (err) {
      console.error("[Register Extraction Error]", err);
      toast("Extraction error: " + (err.message || "Failed to process image. Falling back to template."));
    } finally {
      stopScannerCamera();
      if (simulateRegisterScanBtn) {
        simulateRegisterScanBtn.disabled = false;
        simulateRegisterScanBtn.innerHTML = "Scan ID Card";
      }
      if (uploadProcessBtn) {
        uploadProcessBtn.disabled = false;
        uploadProcessBtn.innerHTML = "Process Uploaded ID";
      }
    }

    // Check if the scanned document was rejected as a non-Barangay ID or extraction failed
    if (!extractedData || extractedData.isValidId === false) {
      const detectedDocType = (extractedData && extractedData.detectedType) || "Unverified / Non-Barangay Document";
      const rejectionMessage = (extractedData && extractedData.message) || "That's not an official Barangay ID. Only the Barangay Guadalupe Viejo Constituent ID is accepted.";
      toast("ID Rejected: " + rejectionMessage);
      resetDualScanState();
      
      if (window.ConstituentExtractor && typeof window.ConstituentExtractor.showInvalidIdModal === "function") {
        window.ConstituentExtractor.showInvalidIdModal({
          detectedType: detectedDocType,
          message: rejectionMessage,
          onRetry: () => {
            resetDualScanState();
            regScan?.classList.remove("hidden");
            const frontIn = document.getElementById("registerUploadFront");
            const backIn = document.getElementById("registerUploadBack");
            if (frontIn) frontIn.value = "";
            if (backIn) backIn.value = "";
            startScannerCamera("registerScannerVideo");
            toast("Position your physical Barangay Guadalupe Viejo ID inside the frame.");
          },
          onSwitchManual: () => {
            regScan?.classList.add("hidden");
            manual?.classList.remove("hidden");
            toast("Switched to manual registration without ID.");
          }
        });
      }
      return;
    }

    // Reveal review form and auto-populate
    regScan?.classList.add("hidden");
    if (scannedRegForm) {
      scannedRegForm.classList.remove("hidden");

      const idNo = document.getElementById("scannedIdNumber");
      const fName = document.getElementById("scannedFirstName");
      const mName = document.getElementById("scannedMiddleName");
      const lName = document.getElementById("scannedLastName");
      const bDate = document.getElementById("scannedBirthDate");
      const genderSelect = document.getElementById("scannedGender");
      const civilSelect = document.getElementById("scannedCivilStatus");
      const mobile = document.getElementById("scannedMobile");
      const email = document.getElementById("scannedEmail");
      const addr = document.getElementById("scannedAddress");
      const streetInput = document.getElementById("scannedStreet") || document.getElementById("manualStreet");
      const emergNameInput = document.getElementById("scannedEmergencyName");
      const emergContactInput = document.getElementById("scannedEmergencyContact");
      const badgeName = document.getElementById("scannedResidentBadgeName");

      const finalId = extractedData?.idNumber || GV_CONSTITUENT_REFERENCE.sampleId;
      const finalFirst = extractedData?.firstName || GV_CONSTITUENT_REFERENCE.defaultGivenName;
      const finalMiddle = (extractedData?.middleName !== undefined && extractedData?.middleName !== null) ? extractedData.middleName : "";
      const finalLast = extractedData?.lastName || GV_CONSTITUENT_REFERENCE.defaultSurname;
      const finalBirth = extractedData?.birthDate || GV_CONSTITUENT_REFERENCE.defaultDob;
      const finalGender = extractedData?.gender || GV_CONSTITUENT_REFERENCE.defaultSex;
      const finalCivil = extractedData?.civilStatus || GV_CONSTITUENT_REFERENCE.defaultCivilStatus;
      const finalAddr = extractedData?.address || GV_CONSTITUENT_REFERENCE.defaultAddress;
      const finalStreet = extractedData?.street || GV_CONSTITUENT_REFERENCE.defaultStreet;
      const finalEmergName = extractedData?.emergencyName || GV_CONSTITUENT_REFERENCE.emergencyName;
      const finalEmergPhone = extractedData?.emergencyContact || GV_CONSTITUENT_REFERENCE.emergencyPhone;

      if (idNo) idNo.value = finalId;
      if (fName) fName.value = finalFirst;
      if (mName) mName.value = finalMiddle;
      if (lName) lName.value = finalLast;
      if (bDate && finalBirth) bDate.value = finalBirth;
      if (genderSelect && finalGender) genderSelect.value = (finalGender.toLowerCase().includes("female") ? "Female" : "Male");
      if (civilSelect && finalCivil) {
        const cVal = finalCivil.toLowerCase();
        if (cVal.includes("single")) civilSelect.value = "Single";
        else if (cVal.includes("widow")) civilSelect.value = "Widowed";
        else if (cVal.includes("separat")) civilSelect.value = "Separated";
        else civilSelect.value = "Married";
      }
      if (streetInput && finalStreet) streetInput.value = finalStreet;
      if (addr && finalAddr) addr.value = finalAddr;
      if (mobile) mobile.value = extractedData?.phone || GV_CONSTITUENT_REFERENCE.defaultPhone;
      
      const emailNotice = document.getElementById("scannedEmailNotice");
      const emailBadge = document.getElementById("scannedEmailBadge");
      const userEmail = extractedData?.email || null;

      if (email) {
        if (!userEmail) {
          email.value = "";
          email.classList.add("input-highlight-attention");
          if (emailNotice) emailNotice.style.display = "flex";
          if (emailBadge) {
            emailBadge.className = "id-field-badge id-field-missing";
            emailBadge.textContent = "Not on ID • Please Enter";
          }
          
          email.oninput = function() {
            const v = email.value.trim();
            if (v.length > 3 && v.includes("@") && v.includes(".")) {
              email.classList.remove("input-highlight-attention");
              if (emailBadge) {
                emailBadge.className = "id-field-badge";
                emailBadge.textContent = "Entered";
              }
            } else {
              email.classList.add("input-highlight-attention");
              if (emailBadge) {
                emailBadge.className = "id-field-badge id-field-missing";
                emailBadge.textContent = "Not on ID • Please Enter";
              }
            }
          };

          setTimeout(() => email.focus(), 150);
        } else {
          email.value = userEmail;
          email.classList.remove("input-highlight-attention");
          if (emailNotice) emailNotice.style.display = "none";
          if (emailBadge) {
            emailBadge.className = "id-field-badge";
            emailBadge.textContent = "Auto-filled • Editable";
          }
        }
      }

      if (emergNameInput && finalEmergName) emergNameInput.value = finalEmergName;
      if (emergContactInput && finalEmergPhone) emergContactInput.value = finalEmergPhone;

      const displayFullName = `${finalFirst} ${finalLast}`.trim() || "Resident Constituent";
      if (badgeName) badgeName.textContent = `${displayFullName} (${finalId})`;

      toast(extractedData?.isAiExtracted ? 
        "ID card extracted via Gemini AI! Details auto-filled below. Review and edit before finishing." :
        "ID card processed! Extracted fields were auto-filled. You can review and edit any field before continuing.");
    } else {
      setPass?.classList.remove("hidden");
    }
  }

  // Handle Camera Scan button clicks (Step 1 Front, then Step 2 Back)
  simulateRegisterScanBtn?.addEventListener("click", async () => {
    if (regScanStep === "front") {
      // ── STEP 1: SCAN FRONT SIDE ──
      simulateRegisterScanBtn.disabled = true;
      simulateRegisterScanBtn.innerHTML = "Scanning Card...";
      toast("Capturing Front side of Barangay ID...");

      capturedFrontBlob = await captureCameraBlob("front");

      // Update Front thumbnail
      if (capturedFrontBlob && thumbImgFront) {
        const url = URL.createObjectURL(capturedFrontBlob);
        thumbImgFront.src = url;
        thumbImgFront.classList.remove("hidden");
        if (thumbTextFront) thumbTextFront.classList.add("hidden");
      }
      if (thumbSlotFront) thumbSlotFront.className = "thumb-slot captured";
      if (scanPillFront) {
        scanPillFront.className = "step-pill done";
        if (frontPillStatus) frontPillStatus.textContent = "Done";
      }

      // Transition to Step 2: Back side
      regScanStep = "back";
      if (scanPillBack) {
        scanPillBack.className = "step-pill active";
        if (backPillStatus) backPillStatus.textContent = "Ready";
      }
      if (thumbSlotBack) thumbSlotBack.className = "thumb-slot active";

      // Show the 3D Flip Card Notification Overlay!
      if (scannerFlipOverlay) {
        scannerFlipOverlay.classList.remove("hidden");
      }

      // Update fallback card graphic for back if in fallback mode
      if (fallbackCardSideBadge) fallbackCardSideBadge.textContent = "BACK SIDE";
      if (fallbackCardTitle) fallbackCardTitle.textContent = "EMERGENCY NOTIFICATION";
      if (fallbackCardSub) fallbackCardSub.textContent = "CONTACT PERSON & NUMBER";

      if (registerScannerGuideText) registerScannerGuideText.textContent = "Align BACK of Physical ID (Emergency Contact)";
      if (scannerStatusIndicatorText) scannerStatusIndicatorText.textContent = "Position BACK of card facing camera";

      simulateRegisterScanBtn.innerHTML = "Scan ID Card";
      simulateRegisterScanBtn.disabled = false;
      if (registerSkipBackBtn) registerSkipBackBtn.classList.remove("hidden");
      if (registerRetakeFrontBtn) registerRetakeFrontBtn.classList.remove("hidden");

    } else if (regScanStep === "back") {
      // ── STEP 2: SCAN BACK SIDE & EXTRACT ──
      simulateRegisterScanBtn.disabled = true;
      simulateRegisterScanBtn.innerHTML = "Scanning Card...";
      toast("Capturing Back side of Barangay ID...");

      capturedBackBlob = await captureCameraBlob("back");

      if (capturedBackBlob && thumbImgBack) {
        const url = URL.createObjectURL(capturedBackBlob);
        thumbImgBack.src = url;
        thumbImgBack.classList.remove("hidden");
        if (thumbTextBack) thumbTextBack.classList.add("hidden");
      }
      if (thumbSlotBack) thumbSlotBack.className = "thumb-slot captured";
      if (scanPillBack) {
        scanPillBack.className = "step-pill done";
        if (backPillStatus) backPillStatus.textContent = "Done";
      }

      await executeRegistrationExtraction(capturedFrontBlob, capturedBackBlob);
    }
  });

  // Handle Process Uploaded ID button
  uploadProcessBtn?.addEventListener("click", async () => {
    const frontInput = document.getElementById("registerUploadFront");
    const backInput = document.getElementById("registerUploadBack");
    const fileFront = frontInput?.files?.[0];
    const fileBack = backInput?.files?.[0];

    if (!fileFront && !fileBack) {
      toast("Please select your ID front image file to continue.");
      return;
    }

    await executeRegistrationExtraction(fileFront, fileBack);
  });

  // Handle Clear Uploaded ID button
  document.getElementById("registerClearUploadsBtn")?.addEventListener("click", () => {
    const frontInput = document.getElementById("registerUploadFront");
    const backInput = document.getElementById("registerUploadBack");
    if (frontInput) frontInput.value = "";
    if (backInput) backInput.value = "";
    const regUploadPrev = document.getElementById("registerUploadedPreview");
    if (regUploadPrev) {
      regUploadPrev.src = "";
      regUploadPrev.classList.add("hidden");
    }
    resetDualScanState();
    toast("Uploaded ID files cleared.");
  });

  // Clicking thumbnail previews toggles the large preview display
  thumbSlotFront?.addEventListener("click", () => {
    const frontInput = document.getElementById("registerUploadFront");
    const regUploadPrev = document.getElementById("registerUploadedPreview");
    if (thumbImgFront && thumbImgFront.src && !thumbImgFront.classList.contains("hidden") && regUploadPrev) {
      regUploadPrev.src = thumbImgFront.src;
      regUploadPrev.classList.remove("hidden");
      if (registerScannerGuideText) registerScannerGuideText.textContent = "Viewing FRONT ID photo";
    }
  });

  thumbSlotBack?.addEventListener("click", () => {
    const backInput = document.getElementById("registerUploadBack");
    const regUploadPrev = document.getElementById("registerUploadedPreview");
    if (thumbImgBack && thumbImgBack.src && !thumbImgBack.classList.contains("hidden") && regUploadPrev) {
      regUploadPrev.src = thumbImgBack.src;
      regUploadPrev.classList.remove("hidden");
      if (registerScannerGuideText) registerScannerGuideText.textContent = "Viewing BACK ID photo";
    }
  });

  // User taps "I've Flipped It" on the 3D overlay
  scannerFlipReadyBtn?.addEventListener("click", () => {
    if (scannerFlipOverlay) {
      scannerFlipOverlay.classList.add("hidden");
    }
    toast("Camera ready. Align BACK side of card inside the frame.");
  });

  // User chooses to skip back side and extract with front only
  registerSkipBackBtn?.addEventListener("click", async () => {
    if (scannerFlipOverlay) scannerFlipOverlay.classList.add("hidden");
    await executeRegistrationExtraction(capturedFrontBlob, null);
  });

  // User chooses to retake card
  registerRetakeFrontBtn?.addEventListener("click", () => {
    resetDualScanState();
    toast("Reset scanner to Front side. Position front of ID.");
  });

  document.getElementById("backScannedToStart")?.addEventListener("click", () => {
    scannedRegForm?.classList.add("hidden");
    regStart?.classList.remove("hidden");
  });

  document.getElementById("viewScannedTermsLink")?.addEventListener("click", e => {
    e.preventDefault();
    openRegPrivacy();
  });

  /* Auto-generated Scanned ID Registration Submission */
  scannedRegForm?.addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = document.getElementById("scannedNewPassword")?.value || "";
    const p2 = document.getElementById("scannedConfirmPassword")?.value || "";

    if (p1.length < 8) {
      toast("Password must be at least 8 characters long.");
      return;
    }
    if (p1 !== p2) {
      toast("Passwords do not match.");
      return;
    }

    const fName = document.getElementById("scannedFirstName")?.value.trim() || "";
    const mName = document.getElementById("scannedMiddleName")?.value.trim() || "";
    const lName = document.getElementById("scannedLastName")?.value.trim() || "";
    const fullName = [fName, mName, lName].filter(Boolean).join(" ");
    const idNum = document.getElementById("scannedIdNumber")?.value.trim() || `GV-2026-${Math.floor(100000 + Math.random() * 900000)}`;
    const addr = document.getElementById("scannedAddress")?.value.trim() || "Guadalupe Viejo, Makati City";
    const street = document.getElementById("scannedStreet")?.value.trim() || document.getElementById("manualStreet")?.value.trim() || "";
    const gender = document.getElementById("scannedGender")?.value || "Male";
    const civil = document.getElementById("scannedCivilStatus")?.value || "Single";
    const emergName = document.getElementById("scannedEmergencyName")?.value.trim() || "";
    const emergPhone = document.getElementById("scannedEmergencyContact")?.value.trim() || "";
    const mob = document.getElementById("scannedMobile")?.value.trim() || "";
    const em = document.getElementById("scannedEmail")?.value.trim() || "";
    const bDate = document.getElementById("scannedBirthDate")?.value || "";

    if (!fName || !lName) {
      toast("Please enter your First Name and Last Name.");
      return;
    }

    const submitBtn = scannedRegForm.querySelector("button[type='submit']");
    const origBtnText = submitBtn ? submitBtn.innerHTML : "Create Account";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = "Saving to database...";
    }

    // Save resident profile into tab-isolated session
    setResidentSession({
      name: fullName,
      first_name: fName,
      middle_name: mName,
      last_name: lName,
      resident_id_no: idNum,
      address: addr,
      street: street,
      gender: gender,
      civil_status: civil,
      emergency_contact_name: emergName,
      emergency_contact_phone: emergPhone,
      mobile: mob,
      phone: mob,
      email: em,
      dob: bDate,
      id_requested: true
    });

    // Save into local accounts cache
    const accounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
    accounts.push({
      full_name: fullName,
      name: fullName,
      first_name: fName,
      middle_name: mName,
      last_name: lName,
      resident_id_no: idNum,
      id: idNum,
      phone: mob,
      email: em,
      address: addr,
      street: street,
      gender: gender,
      civil_status: civil,
      dob: bDate
    });
    localStorage.setItem("eViejoResidentAccounts", JSON.stringify(accounts));

    if (window.eViejoDB && typeof window.eViejoDB.registerResident === "function") {
      await window.eViejoDB.registerResident({
        name: fullName,
        phone: mob,
        email: em,
        address: addr,
        street: street,
        dob: bDate,
        gender: gender,
        civil_status: civil,
        resident_id_no: idNum
      });
    }

    toast(`Account created and registered in database for ${fullName}! Logging in...`);
    setTimeout(() => {
      location.href = "../resident/resident.html";
    }, 600);
  });

  /* Set-password form (manual path) */
  setPass?.addEventListener("submit", async e => {
    e.preventDefault();
    const f = setPass.querySelectorAll('input[type="password"]');
    if (f.length >= 2 && f[0].value !== f[1].value) {
      toast("Passwords do not match.");
      return;
    }
    const em = document.getElementById("setPassEmail")?.value.trim() || "";
    const mob = document.getElementById("setPassMobile")?.value.trim() || "";
    const fullName = localStorage.getItem("gv_resident_name") || "Resident User";
    const idNum = `GV-2026-${Math.floor(100000 + Math.random() * 900000)}`;

    if (em) localStorage.setItem("gv_resident_email", em);
    if (mob) localStorage.setItem("gv_resident_mobile", mob);
    localStorage.setItem("gv_resident_id", idNum);

    const accounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
    accounts.push({
      full_name: fullName,
      name: fullName,
      resident_id_no: idNum,
      id: idNum,
      phone: mob,
      email: em
    });
    localStorage.setItem("eViejoResidentAccounts", JSON.stringify(accounts));

    if (window.eViejoDB && typeof window.eViejoDB.registerResident === "function") {
      await window.eViejoDB.registerResident({
        name: fullName,
        phone: mob,
        email: em,
        resident_id_no: idNum
      });
    }

    toast("Account created successfully. Redirecting to resident portal...");
    setTimeout(() => location.href = "../resident/resident.html", 500);
  });

  /* Manual form (new account without ID) — validate and create account directly */
  manual?.addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = document.getElementById("manualNewPassword")?.value || "";
    const p2 = document.getElementById("manualConfirmPassword")?.value || "";

    if (p1.length < 8) {
      toast("Password must be at least 8 characters long.");
      return;
    }
    if (p1 !== p2) {
      toast("Passwords do not match.");
      return;
    }

    const fName = document.getElementById("manualFirstName")?.value.trim() || "";
    const mName = document.getElementById("manualMiddleName")?.value.trim() || "";
    const lName = document.getElementById("manualLastName")?.value.trim() || "";
    const suffix = document.getElementById("manualSuffix")?.value.trim() || "";
    const fullName = [fName, mName, lName, suffix].filter(Boolean).join(" ");
    
    if (!fullName) {
      toast("Please enter your full name.");
      return;
    }

    const houseNo = document.getElementById("manualHouseNo")?.value.trim() || "";
    const street = document.getElementById("manualStreet")?.value.trim() || "Guadalupe Viejo";
    const fullAddress = `${houseNo ? houseNo + " " : ""}${street}, Guadalupe Viejo, Makati City`;
    
    const mobile = document.getElementById("manualMobile")?.value.trim() || "";
    const email = document.getElementById("manualEmail")?.value.trim() || "";
    const bDate = document.getElementById("manualBirthDate")?.value || "";
    const gender = document.getElementById("manualGender")?.value || "Male";
    const civilStatus = document.getElementById("manualCivilStatus")?.value || "Single";
    const residentType = document.getElementById("manualResidentType")?.value || "Homeowner";
    const yearsResidency = document.getElementById("manualYearsResidency")?.value || "";
    const residentIdNo = `GV-2026-${Math.floor(100000 + Math.random() * 900000)}`;

    const submitBtn = manual.querySelector("button[type='submit']");
    const origBtnText = submitBtn ? submitBtn.innerHTML : "Create Resident Account";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = "Registering with database...";
    }

    // Save resident profile into tab-isolated session
    setResidentSession({
      name: fullName,
      first_name: fName,
      middle_name: mName,
      last_name: lName,
      resident_id_no: residentIdNo,
      address: fullAddress,
      street: street,
      mobile: mobile,
      email: email,
      dob: bDate,
      gender: gender,
      civil_status: civilStatus,
      resident_type: residentType,
      years_residency: yearsResidency,
      id_requested: false
    });

    // Save into local accounts cache
    const accounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
    accounts.push({
      full_name: fullName,
      name: fullName,
      resident_id_no: residentIdNo,
      id: residentIdNo,
      phone: mobile,
      email: email,
      address: fullAddress,
      dob: bDate,
      gender: gender,
      civil_status: civilStatus
    });
    localStorage.setItem("eViejoResidentAccounts", JSON.stringify(accounts));

    if (window.eViejoDB && typeof window.eViejoDB.registerResident === "function") {
      await window.eViejoDB.registerResident({
        name: fullName,
        phone: mobile,
        email: email,
        address: fullAddress,
        dob: bDate,
        gender: gender,
        civil_status: civilStatus,
        resident_id_no: residentIdNo
      });
    }

    toast(`Resident account registered in database for ${fullName}! Logging in...`);
    setTimeout(() => {
      location.href = "../resident/resident.html";
    }, 600);
  });

  let stagedPhysicalPhoto = "";
  const modal=document.getElementById("requestModal"),modalTitle=document.getElementById("modalTitle");
  const requestPurpose=document.getElementById("requestPurpose");
  const cancelRequestModalBtn=document.getElementById("cancelRequestModalBtn");
  let selectedRequest="";
  const requestPurposeOptions={
    "Barangay Clearance":["Employment","School Requirement","Visa or Travel Requirement","Postal ID Application","Police Clearance Requirement","Other"],
    "Certificate of Indigency":["Financial Assistance","Medical Assistance","Educational Assistance / Scholarship","Burial Assistance","Social Welfare Application","Other"],
    "Barangay Certificate":["Legal Requirement","Employment","School Requirement","Good Moral Character","Utility Connection","Other"],
    "Certificate of Residency":["Proof of Residency","Bank Account Opening","Employment Requirement","School Requirement","Voter Registration","Other"],
    "Business Clearance":["New Business Registration","Business Renewal","Change of Business Address","Business Closure / Retirement","Other"],
    "Permit to Use":["Event or Gathering","Community Basketball Court","Barangay Multi-Purpose Hall","Sound System / Activity Permit","Construction or Repair","Other"]
  };

  const setRequestPurposeOptions=service=>{
    if(!requestPurpose)return;
    const options=requestPurposeOptions[service]||["Other"];
    requestPurpose.innerHTML=options.map(option=>`<option value="${option}">${option}</option>`).join("");
  };

  // Helper to render service-specific fields dynamically
  const renderServiceSpecificFields = service => {
    const container = document.getElementById("serviceSpecificFields");
    if (!container) return;

    let html = "";
    if (service === "Barangay Clearance") {
      html = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:8px;">
          <label>Years of Residency in Guadalupe Viejo
            <input type="number" id="srvYearsResidency" name="srvYearsResidency" min="0" max="100" placeholder="e.g. 5" value="${esc(getResidentItem('gv_resident_years') || '')}">
          </label>
          <label>Company / Agency / Requesting Party
            <input type="text" id="srvEmployerOrSchool" name="srvEmployerOrSchool" placeholder="e.g. Accenture / DepEd / Makati City Hall">
          </label>
        </div>
      `;
    } else if (service === "Certificate of Indigency") {
      html = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:8px;">
          <label>Beneficiary / Patient / Student Name
            <input type="text" id="srvBeneficiaryName" name="srvBeneficiaryName" placeholder="Full name of beneficiary" value="${esc(currentResident())}">
          </label>
          <label>Relationship to Beneficiary
            <input type="text" id="srvRelationship" name="srvRelationship" placeholder="e.g. Self, Child, Parent, Sibling" value="Self">
          </label>
          <label class="span-2" style="grid-column: 1 / -1;">Assistance Program / Hospital / Agency Name
            <input type="text" id="srvAssistanceAgency" name="srvAssistanceAgency" placeholder="e.g. DSWD AICS, Ospital ng Makati (OsMak), PCSO">
          </label>
        </div>
      `;
    } else if (service === "Business Clearance") {
      html = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:8px;">
          <label>Registered Business / Trade Name
            <input type="text" id="srvBusinessName" name="srvBusinessName" required placeholder="e.g. Dela Cruz Convenience Store">
          </label>
          <label>Type / Line of Business
            <select id="srvBusinessType" name="srvBusinessType">
              <option value="Sari-Sari Store / Retail">Sari-Sari Store / Retail</option>
              <option value="Food & Beverage / Eatery">Food & Beverage / Eatery</option>
              <option value="Personal Services / Salon / Spa">Personal Services / Salon / Spa</option>
              <option value="Online Business / Freelance">Online Business / Freelance</option>
              <option value="Office / Professional Service">Office / Professional Service</option>
              <option value="Other Commercial Business">Other Commercial Business</option>
            </select>
          </label>
          <label class="span-2" style="grid-column: 1 / -1;">Business Location in Barangay
            <input type="text" id="srvBusinessAddress" name="srvBusinessAddress" placeholder="e.g. Unit 2B, 102 P. Burgos St., Guadalupe Viejo" value="${esc(getResidentItem('gv_resident_address') || '')}">
          </label>
        </div>
      `;
    } else if (service === "Permit to Use") {
      html = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:8px;">
          <label>Barangay Facility / Area to Use
            <select id="srvFacility" name="srvFacility">
              <option value="Barangay Multi-Purpose Hall">Barangay Multi-Purpose Hall</option>
              <option value="Covered Basketball Court">Covered Basketball Court</option>
              <option value="Barangay Plaza / Open Grounds">Barangay Plaza / Open Grounds</option>
              <option value="Street / Sidewalk Portion (Subject to Traffic Approval)">Street / Sidewalk Portion (Subject to Traffic Approval)</option>
            </select>
          </label>
          <label>Target Event / Activity Date & Time
            <input type="text" id="srvEventDateTime" name="srvEventDateTime" required placeholder="e.g. October 15, 2026, 2:00 PM - 6:00 PM">
          </label>
          <label class="span-2" style="grid-column: 1 / -1;">Estimated Number of Attendees
            <input type="number" id="srvAttendees" name="srvAttendees" min="1" max="1000" placeholder="e.g. 50">
          </label>
        </div>
      `;
    } else if (service === "Certificate of Residency" || service === "Barangay Certificate") {
      html = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; margin-top:8px;">
          <label>Residency Period / Years Living in Barangay
            <input type="text" id="srvResidencyPeriod" name="srvResidencyPeriod" placeholder="e.g. Since 2018 (8 years)" value="${esc(getResidentItem('gv_resident_years') ? getResidentItem('gv_resident_years') + ' years' : '')}">
          </label>
          <label>Living Arrangement / Housing Status
            <select id="srvHousingStatus" name="srvHousingStatus">
              <option value="Homeowner">Homeowner</option>
              <option value="Tenant / Renter">Tenant / Renter</option>
              <option value="Living with Relatives">Living with Relatives</option>
              <option value="Boarder / Bedspacer">Boarder / Bedspacer</option>
            </select>
          </label>
        </div>
      `;
    } else {
      html = "";
    }
    container.innerHTML = html;
  };

  // Prefill personal information form fields from active resident session
  const populateResidentRequestForm = () => {
    const nameInput = document.getElementById("reqFullName");
    const idInput = document.getElementById("reqResidentId");
    const contactInput = document.getElementById("reqContact");
    const emailInput = document.getElementById("reqEmail");
    const addressInput = document.getElementById("reqAddress");
    const dobInput = document.getElementById("reqDob");
    const civilInput = document.getElementById("reqCivilStatus");

    if (nameInput) nameInput.value = currentResident() || "";
    if (idInput) idInput.value = getResidentItem("gv_resident_id") || "GV-2026-0001";
    if (contactInput) contactInput.value = getResidentItem("gv_resident_mobile") || "";
    if (emailInput) emailInput.value = getResidentItem("gv_resident_email") || "";
    if (addressInput) addressInput.value = getResidentItem("gv_resident_address") || "Guadalupe Viejo, Makati City";
    if (dobInput && !dobInput.value) dobInput.value = getResidentItem("gv_resident_dob") || "";
    if (civilInput && !civilInput.value) civilInput.value = getResidentItem("gv_resident_civil") || "Single";
  };

  const openRequestModal = service => {
    selectedRequest = service || "Barangay Service";
    if (modalTitle) modalTitle.textContent = selectedRequest;
    setRequestPurposeOptions(selectedRequest);
    renderServiceSpecificFields(selectedRequest);
    populateResidentRequestForm();
    modal?.classList.remove("hidden");
  };

  const closeRequestModal = () => {
    modal?.classList.add("hidden");
    selectedRequest = "";
  };

  // Open modal directly on service card click (Terms & Conditions bypassed since agreed during login)
  document.querySelectorAll("[data-request]").forEach(card => card.addEventListener("click", () => {
    const service = card.dataset.request || "Barangay Service";
    openRequestModal(service);
  }));

  modal?.querySelector(".modal-close")?.addEventListener("click", closeRequestModal);
  cancelRequestModalBtn?.addEventListener("click", closeRequestModal);
  modal?.addEventListener("click", e => { if (e.target === modal) closeRequestModal(); });

  // Handle Request Form Submission
  document.getElementById("requestForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const form = e.target;
    const title = modalTitle?.textContent || "Barangay Service";
    const data = new FormData(form);

    const residentName = data.get("fullName")?.toString().trim() || currentResident();
    const residentId = data.get("residentId")?.toString().trim() || getResidentItem("gv_resident_id") || "GV-2026-0001";
    const contact = data.get("contact")?.toString().trim() || getResidentItem("gv_resident_mobile") || "";
    const email = data.get("email")?.toString().trim() || getResidentItem("gv_resident_email") || "";
    const address = data.get("address")?.toString().trim() || getResidentItem("gv_resident_address") || "";
    const dob = data.get("dob")?.toString().trim() || getResidentItem("gv_resident_dob") || "";
    const civilStatus = data.get("civilStatus")?.toString().trim() || getResidentItem("gv_resident_civil") || "";
    const purpose = data.get("purpose")?.toString().trim() || form.querySelector("#requestPurpose")?.value || "Other";
    const purposeDetails = data.get("purposeDetails")?.toString().trim() || "";
    const release = data.get("release")?.toString().trim() || "Claim at Barangay Hall";

    // Collect service-specific fields
    const serviceDetails = {};
    if (title === "Barangay Clearance") {
      serviceDetails.yearsOfResidency = data.get("srvYearsResidency")?.toString().trim() || "";
      serviceDetails.requestingParty = data.get("srvEmployerOrSchool")?.toString().trim() || "";
    } else if (title === "Certificate of Indigency") {
      serviceDetails.beneficiaryName = data.get("srvBeneficiaryName")?.toString().trim() || "";
      serviceDetails.relationship = data.get("srvRelationship")?.toString().trim() || "";
      serviceDetails.assistanceAgency = data.get("srvAssistanceAgency")?.toString().trim() || "";
    } else if (title === "Business Clearance") {
      serviceDetails.businessName = data.get("srvBusinessName")?.toString().trim() || "";
      serviceDetails.businessType = data.get("srvBusinessType")?.toString().trim() || "";
      serviceDetails.businessAddress = data.get("srvBusinessAddress")?.toString().trim() || "";
    } else if (title === "Permit to Use") {
      serviceDetails.facility = data.get("srvFacility")?.toString().trim() || "";
      serviceDetails.eventDateTime = data.get("srvEventDateTime")?.toString().trim() || "";
      serviceDetails.estimatedAttendees = data.get("srvAttendees")?.toString().trim() || "";
    } else if (title === "Certificate of Residency" || title === "Barangay Certificate") {
      serviceDetails.residencyPeriod = data.get("srvResidencyPeriod")?.toString().trim() || "";
      serviceDetails.housingStatus = data.get("srvHousingStatus")?.toString().trim() || "";
    }

    const requests = getRequests();
    const allNums = requests.map(r => parseInt((r.id || "").split("-").pop()) || 0).filter(n => !isNaN(n));
    const next = (allNums.length ? Math.max(...allNums) : 129) + 1;

    const req = {
      id: `REQ-2026-${String(next).padStart(5, "0")}`,
      resident: residentName,
      residentId: residentId,
      contact: contact,
      email: email,
      address: address,
      dob: dob,
      civilStatus: civilStatus,
      document: title,
      purpose: purpose,
      purposeDetails: purposeDetails,
      pickup: release,
      serviceDetails: serviceDetails,
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      status: "Pending",
      payment: "Pending"
    };

    requests.unshift(req);
    saveRequests(requests);
    closeRequestModal();
    toast(`Request submitted successfully! Reference: ${req.id}`);

    if (window.eViejoDB && typeof window.eViejoDB.createRequest === "function") {
      window.eViejoDB.createRequest(req);
    }
    setTimeout(() => location.href = "tracker.html", 700);
  });
  // Note: physicalForm submit is handled by the 3D review flow below (executePhysicalIdSubmission)

  // ========================================================
  // ADMIN USERS & ROLES STORE (RBAC Engine)
  // Authority to Add / Edit / Delete is restricted to:
  // - Barangay Captain
  // - Super Admin
  // ========================================================
  const STORE_ADMINS = "eViejoAdmins_v2";
  const STORE_ACTIVE_ADMIN = "eViejoActiveAdmin";

  const seedAdmins = [
    {
      id: "ADM-001",
      name: "Miko Gatchalian",
      username: "captain",
      password: "captain123",
      role: "Barangay Captain",
      status: "Active",
      phone: "0917-890-1234",
      lastLogin: "Today • 8:15 AM",
      avatarText: "MG"
    },
    {
      id: "ADM-002",
      name: "Admin User",
      username: "admin",
      password: "admin123",
      role: "Super Admin",
      status: "Active",
      phone: "0918-555-4321",
      lastLogin: "Today • 9:30 AM",
      avatarText: "AU"
    },
    {
      id: "ADM-003",
      name: "Myrna F. Casabon",
      username: "secretary",
      password: "sec123",
      role: "Barangay Secretary",
      status: "Active",
      phone: "0920-111-2233",
      lastLogin: "Today • 7:45 AM",
      avatarText: "MC"
    },
    {
      id: "ADM-004",
      name: "Luis P. Almario Jr.",
      username: "officer",
      password: "officer123",
      role: "Incident Officer",
      status: "Active",
      phone: "0922-333-4455",
      lastLogin: "Yesterday • 4:20 PM",
      avatarText: "LA"
    },
    {
      id: "ADM-005",
      name: "Myla C. Gepitan",
      username: "treasury",
      password: "treasury123",
      role: "Treasury Staff",
      status: "Active",
      phone: "0919-444-5566",
      lastLogin: "Today • 10:00 AM",
      avatarText: "MG"
    },
    {
      id: "ADM-006",
      name: "Ferdinand B. Evangelista",
      username: "kagawad1",
      password: "kagawad123",
      role: "Barangay Kagawad",
      status: "Active",
      phone: "0921-222-3344",
      lastLogin: "Today • 8:00 AM",
      avatarText: "FE"
    },
    {
      id: "ADM-007",
      name: "Andrea Blanche S. Jacome",
      username: "kagawad2",
      password: "kagawad123",
      role: "Barangay Kagawad",
      status: "Active",
      phone: "0923-555-6677",
      lastLogin: "Today • 9:00 AM",
      avatarText: "AJ"
    },
    {
      id: "ADM-008",
      name: "Shirley G. Borja",
      username: "kagawad3",
      password: "kagawad123",
      role: "Barangay Kagawad",
      status: "Active",
      phone: "0924-666-7788",
      lastLogin: "Yesterday • 2:00 PM",
      avatarText: "SB"
    },
    {
      id: "ADM-009",
      name: "Abelardo U. Brillantes",
      username: "kagawad4",
      password: "kagawad123",
      role: "Barangay Kagawad",
      status: "Active",
      phone: "0925-777-8899",
      lastLogin: "Today • 7:30 AM",
      avatarText: "AB"
    },
    {
      id: "ADM-010",
      name: "Crisostomo B. Cunanan",
      username: "kagawad5",
      password: "kagawad123",
      role: "Barangay Kagawad",
      status: "Active",
      phone: "0926-888-9900",
      lastLogin: "Today • 8:45 AM",
      avatarText: "CC"
    },
    {
      id: "ADM-011",
      name: "Genaro Silvestre Gutierrez",
      username: "kagawad6",
      password: "kagawad123",
      role: "Barangay Kagawad",
      status: "Active",
      phone: "0927-999-0011",
      lastLogin: "Yesterday • 5:00 PM",
      avatarText: "GG"
    },
    {
      id: "ADM-012",
      name: "Eduardo Gatchalian",
      username: "badmin",
      password: "badmin123",
      role: "Barangay Administrator",
      status: "Active",
      phone: "0928-100-2233",
      lastLogin: "Today • 9:15 AM",
      avatarText: "EG"
    }
  ];

  function getAdmins() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_ADMINS));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch(e){}
    localStorage.setItem(STORE_ADMINS, JSON.stringify(seedAdmins));
    return [...seedAdmins];
  }

  function saveAdmins(admins) {
    localStorage.setItem(STORE_ADMINS, JSON.stringify(admins));
  }

  function getActiveAdmin() {
    try {
      const active = JSON.parse(sessionStorage.getItem(STORE_ACTIVE_ADMIN));
      if (active && active.role) return active;
    } catch(e){}
    // Default fallback: Barangay Captain
    return seedAdmins[0];
  }

  function setActiveAdmin(admin) {
    sessionStorage.setItem(STORE_ACTIVE_ADMIN, JSON.stringify({
      id: admin.id,
      name: admin.name,
      username: admin.username,
      role: admin.role,
      avatarText: admin.avatarText || getInitials(admin.name)
    }));
    sessionStorage.setItem("eViejoAdmin", "1");
  }

  function isAuthorizedAdmin(role) {
    return role === "Barangay Captain" || role === "Super Admin" || role === "Barangay Administrator";
  }

  function getInitials(name) {
    if (!name) return "AD";
    const parts = name.replace(/^Hon\.\s+/i, "").replace(/^Officer\s+/i, "").trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  // Admin Login Submission
  document.getElementById("adminLoginForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const u = document.getElementById("adminUser")?.value.trim().toLowerCase();
    const p = document.getElementById("adminPass")?.value;
    const admins = getAdmins();
    const matched = admins.find(a => a.username.toLowerCase() === u && a.password === p);

    if (matched) {
      if (matched.status === "Inactive") {
        toast("This admin account is currently deactivated. Please contact Barangay Captain.");
        return;
      }
      matched.lastLogin = "Just now";
      saveAdmins(admins);
      setActiveAdmin(matched);
      addAuditLog("Access Granted", "System Security", matched.id, `${matched.name} (${matched.role}) logged in successfully.`, matched.name);
      toast(`Welcome, ${matched.name} (${matched.role})!`);
      setTimeout(() => location.href = "../admin/index.html", 500);
    } else {
      toast("Invalid admin username or password.");
    }
  });

  // ADMIN: render all resident requests and allow approve/reject.
  const adminTable=document.querySelector("#adminRequestsBody");
  function renderAdminRequests(){
    if(!adminTable)return;
    adminTable.innerHTML = Array(4).fill(0).map(()=>`<tr class="skeleton-row"><td><div class="skeleton skeleton-text"></div></td><td><div class="skeleton skeleton-text"></div></td><td><div class="skeleton skeleton-text"></div></td><td><div class="skeleton skeleton-text"></div></td><td><div class="skeleton skeleton-badge"></div></td><td><div class="skeleton skeleton-btn"></div></td></tr>`).join('');
    setTimeout(() => {
      const requests=getRequests();
      adminTable.innerHTML=requests.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.resident)}</td><td>${esc(r.document)}</td><td>${esc(r.date)}</td><td><span class="badge ${statusClass(r.status)}">${esc(r.status)}</span></td><td><a class="btn btn-sm ${r.status==='Pending'?'btn-primary':'btn-outline'}" href="request-details.html?id=${encodeURIComponent(r.id)}">${r.status==='Pending'?'Review':'View'}</a></td></tr>`).join("");
    }, 250);
  }
  renderAdminRequests();

  // ========================================================
  // DASHBOARD LIVE RENDERING (admin/index.html & resident/resident.html)
  // ========================================================
  function renderDashboard() {
    const requests = getRequests();

    // --- ADMIN DASHBOARD ---
    // Stats
    const dashStatPending = document.getElementById("dashStatPending");
    const dashStatApproved = document.getElementById("dashStatApproved");
    const dashStatPayment = document.getElementById("dashStatPayment");
    const dashIncidentCount = document.getElementById("dashIncidentCount");

    if (dashStatPending) dashStatPending.textContent = requests.filter(r => r.status === "Pending").length;
    if (dashStatApproved) dashStatApproved.textContent = requests.filter(r => r.status === "Approved" || r.status === "Ready for Pickup" || r.status === "Completed").length;
    if (dashStatPayment) dashStatPayment.textContent = requests.filter(r => r.payment === "For Payment").length;

    const dashStatResidents = document.getElementById("dashStatResidents");
    if (dashStatResidents) {
      dashStatResidents.textContent = Object.keys(RESIDENTS_DATA).length.toLocaleString();
    }

    // Dynamic Treasury & Payments Calculations
    const paidRequests = requests.filter(r => r.payment === "Paid" || r.status === "Completed");
    const forPaymentRequests = requests.filter(r => r.payment === "For Payment" || r.status === "Ready for Pickup");

    // Compute standard barangay clearance / certificate fees
    const getFee = r => {
      const doc = (r.document || "").toLowerCase();
      if (doc.includes("business")) return 150;
      if (doc.includes("clearance")) return 100;
      if (doc.includes("indigency")) return 0;
      if (doc.includes("id")) return 100;
      return 50;
    };

    const totalCollected = paidRequests.reduce((sum, r) => sum + (r.amount ? parseFloat(r.amount) : getFee(r)), 0);
    const totalForCollection = forPaymentRequests.reduce((sum, r) => sum + (r.amount ? parseFloat(r.amount) : getFee(r)), 0);

    const dashCollectedAmount = document.getElementById("dashCollectedAmount");
    const dashForCollectionAmount = document.getElementById("dashForCollectionAmount");
    if (dashCollectedAmount) dashCollectedAmount.textContent = `₱${totalCollected.toLocaleString()}`;
    if (dashForCollectionAmount) dashForCollectionAmount.textContent = `₱${totalForCollection.toLocaleString()}`;

    const adminPayCollected = document.getElementById("adminPayCollected");
    const adminPayPending = document.getElementById("adminPayPending");
    if (adminPayCollected) adminPayCollected.textContent = `₱${totalCollected.toLocaleString()}`;
    if (adminPayPending) adminPayPending.textContent = `₱${totalForCollection.toLocaleString()}`;

    // Admin dashboard: recent payment items
    const dashPaymentsList = document.getElementById("dashPaymentsList");
    if (dashPaymentsList) {
      const paymentItems = requests.filter(r => r.payment === "Paid" || r.payment === "For Payment" || r.status === "Ready for Pickup" || r.status === "Completed").slice(0, 4);
      if (paymentItems.length === 0) {
        dashPaymentsList.innerHTML = `<div style="text-align:center; padding:18px; color:var(--muted); font-size:12px;">No payment transactions recorded yet.</div>`;
      } else {
        dashPaymentsList.innerHTML = paymentItems.map(r => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
            <div>
              <strong style="font-size:12px; color:#1e293b;">${esc(r.id)} — ${esc(r.document)}</strong>
              <small style="display:block; color:#94a3b8; font-size:11px;">${esc(r.resident)} • ₱${getFee(r)}</small>
            </div>
            <span class="badge ${r.payment === 'Paid' || r.status === 'Completed' ? 'completed' : 'payment'}">${r.payment === 'Paid' || r.status === 'Completed' ? 'Paid' : 'For Payment'}</span>
          </div>
        `).join("");
      }
    }

    // Admin payments table in admin/payments.html
    const adminPaymentsTableBody = document.getElementById("adminPaymentsTableBody");
    if (adminPaymentsTableBody) {
      const pList = requests.filter(r => r.payment === "Paid" || r.payment === "For Payment" || r.status === "Ready for Pickup" || r.status === "Completed");
      if (pList.length === 0) {
        adminPaymentsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--muted); font-size:13px;">No cash payment records found.</td></tr>`;
      } else {
        adminPaymentsTableBody.innerHTML = pList.map(r => `
          <tr>
            <td><code>OR-${r.id.replace(/[^0-9]/g, '') || '0000'}</code></td>
            <td>${esc(r.document)}</td>
            <td>${esc(r.resident)}</td>
            <td>₱${getFee(r)}</td>
            <td><span class="badge ${r.payment === 'Paid' || r.status === 'Completed' ? 'completed' : 'payment'}">${r.payment === 'Paid' || r.status === 'Completed' ? 'Paid' : 'For Payment'}</span></td>
            <td>${r.payment === 'Paid' || r.status === 'Completed' ? 'Admin Treasury' : '—'}</td>
          </tr>
        `).join("");
      }
    }

    // Resident payments table in resident/payments.html
    const residentPaymentsTableBody = document.getElementById("residentPaymentsTableBody");
    if (residentPaymentsTableBody) {
      const myPList = requests.filter(r => r.resident === currentResident() && (r.payment === "Paid" || r.payment === "For Payment" || r.status === "Ready for Pickup" || r.status === "Completed"));
      if (myPList.length === 0) {
        residentPaymentsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--muted); font-size:13px;">No payment records found.</td></tr>`;
      } else {
        residentPaymentsTableBody.innerHTML = myPList.map(r => `
          <tr>
            <td><code>${esc(r.id)}</code></td>
            <td>${esc(r.document)}</td>
            <td>₱${getFee(r)}.00</td>
            <td><span class="badge ${r.payment === 'Paid' || r.status === 'Completed' ? 'completed' : 'payment'}">${r.payment === 'Paid' || r.status === 'Completed' ? 'Paid' : 'For Payment'}</span></td>
            <td>${r.payment === 'Paid' || r.status === 'Completed' ? 'Official receipt recorded' : 'Pay at Treasury'}</td>
          </tr>
        `).join("");
      }
    }

    // Reports analytics in admin/reports.html
    const reportBarsContainer = document.getElementById("reportBarsContainer");
    const reportTopServicesList = document.getElementById("reportTopServicesList");
    const reportCurrentMonth = document.getElementById("reportCurrentMonth");
    if (reportCurrentMonth) {
      reportCurrentMonth.textContent = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    if (reportBarsContainer && reportTopServicesList) {
      if (requests.length === 0) {
        reportBarsContainer.innerHTML = `<i style="height:0%"></i><i style="height:0%"></i><i style="height:0%"></i><i style="height:0%"></i><i style="height:0%"></i><i style="height:0%"></i><i style="height:0%"></i><i style="height:0%"></i>`;
        reportTopServicesList.innerHTML = `<div style="text-align:center; padding:24px; color:var(--muted); font-size:13px;">No service request data recorded yet.</div>`;
      } else {
        // Count services
        const counts = {};
        requests.forEach(r => {
          const doc = r.document || "Other";
          counts[doc] = (counts[doc] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const max = sorted[0] ? sorted[0][1] : 1;

        reportTopServicesList.innerHTML = sorted.map(([service, count]) => {
          const pct = Math.round((count / max) * 100);
          return `
            <div class="progress-row"><span>${esc(service)}</span><b>${count}</b></div>
            <div class="progress"><i style="width:${pct}%"></i></div>
          `;
        }).join("");

        const totalReq = requests.length;
        reportBarsContainer.innerHTML = [0.2, 0.4, 0.35, 0.6, 0.5, 0.75, 0.65, 0.9].map(factor => {
          const h = Math.min(100, Math.max(10, Math.round(totalReq * 12 * factor)));
          return `<i style="height:${h}%"></i>`;
        }).join("");
      }
    }

    // Admin: Requests Needing Action panel
    const dashRequestsList = document.getElementById("dashRequestsList");
    if (dashRequestsList) {
      const pending = requests.filter(r => r.status === "Pending" || r.status === "For Payment").slice(0, 4);
      if (pending.length === 0) {
        dashRequestsList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">No pending requests at this time.</div>`;
      } else {
        dashRequestsList.innerHTML = pending.map(r => `
          <div class="request-item">
            <span class="doc-icon">▤</span>
            <div>
              <strong>${esc(r.id)} &bull; ${esc(r.resident)}</strong>
              <small>${esc(r.document)} &bull; ${esc(r.date)}</small>
            </div>
            ${r.status === "Pending"
              ? `<a class="btn btn-sm btn-primary approve" href="request-details.html?id=${encodeURIComponent(r.id)}">Review</a>`
              : `<a class="text-btn" href="payments.html">Payment</a>`}
          </div>
        `).join("");
      }
    }

    // Admin: Audit Trail panel (recent 5 entries)
    const dashAuditList = document.getElementById("dashAuditList");
    if (dashAuditList) {
      try {
        const logs = JSON.parse(localStorage.getItem("eViejoAuditLogs")) || [];
        const recent = logs.slice(0, 5);
        if (!recent.length) {
          dashAuditList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">No audit events recorded yet.</div>`;
        } else {
          dashAuditList.innerHTML = recent.map(log => {
            const badgeCls = log.action === "Approved" || log.action === "Resolved" ? "approved"
              : log.action === "Updated" || log.action === "Payment Recorded" ? "payment"
              : log.action === "Created" || log.action === "Access Granted" ? "investigating"
              : "pending";
            return `
              <div style="display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-bottom:1px solid #e2e8f0;">
                <div style="flex:1; min-width:0;">
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:2px;">
                    <span class="badge ${badgeCls}" style="font-size:10px;">${esc(log.action)}</span>
                    <code style="font-size:10px; background:#f1f5f9; padding:1px 5px; border-radius:4px; color:var(--blue); font-weight:700;">${esc(log.ref)}</code>
                    <span style="font-size:10px; color:#94a3b8; font-weight:600;">${esc(log.module)}</span>
                  </div>
                  <div style="font-size:11px; color:#475569; line-height:1.4;">${esc(log.details)}</div>
                  <small style="font-size:10px; color:#94a3b8;">${esc(log.timestamp)} &bull; ${esc(log.user)}</small>
                </div>
              </div>
            `;
          }).join("");
        }
      } catch(e) {
        dashAuditList.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">Audit logs unavailable.</div>`;
      }
    }

    // --- RESIDENT DASHBOARD ---
    const curResNameNorm = (currentResident() || "").trim().toLowerCase();
    const curResIdNorm = (getResidentItem("gv_resident_id") || "").trim().toLowerCase();
    const myRequests = requests.filter(r => {
      const rName = (r.resident || "").trim().toLowerCase();
      const rId = (r.residentId || "").trim().toLowerCase();
      return (curResNameNorm && rName === curResNameNorm) || (curResIdNorm && rId === curResIdNorm);
    });
    const dashMyRequests = document.getElementById("dashMyRequests");
    const dashMyPending = document.getElementById("dashMyPending");
    const dashMyApproved = document.getElementById("dashMyApproved");
    const dashMyComplaints = document.getElementById("dashMyComplaints");

    if (dashMyRequests) dashMyRequests.textContent = myRequests.length;
    if (dashMyPending) dashMyPending.textContent = myRequests.filter(r => r.status === "Pending").length;
    if (dashMyApproved) dashMyApproved.textContent = myRequests.filter(r => r.status === "Approved" || r.status === "Completed" || r.status === "Ready for Pickup").length;

    // Blotter complaints count & list on resident dashboard
    if (dashMyComplaints || document.getElementById("residentDashComplaints")) {
      try {
        const incidents = JSON.parse(localStorage.getItem("eViejoIncidents")) || [];
        const myComplaints = incidents.filter(i => i.complainant === currentResident() || myRequests.some(r => r.id === i.id));
        if (dashMyComplaints) dashMyComplaints.textContent = myComplaints.length;

        const dashComplaintsList = document.getElementById("residentDashComplaints");
        if (dashComplaintsList) {
          if (myComplaints.length === 0) {
            dashComplaintsList.innerHTML = `
              <div style="text-align:center; padding:24px 16px; color:var(--muted);">
                <p style="font-size:13px; margin:0;">No complaints filed yet.</p>
                <a class="btn btn-outline btn-sm" href="request.html?open=complaint" style="margin-top:10px; display:inline-block; border-color:#c94747; color:#c94747;">File a Complaint</a>
              </div>
            `;
          } else {
            dashComplaintsList.innerHTML = myComplaints.slice(0, 4).map(inc => `
              <div class="request-item" style="border-left:3px solid #c94747; padding-left:10px;">
                <span class="doc-icon" style="color:#c94747;">!</span>
                <div>
                  <strong style="font-size:12px;">${esc(inc.type)}</strong>
                  <small>${esc(inc.location)} &bull; ${esc(inc.id)}</small>
                </div>
                <span class="badge ${statusClass(inc.status)}">${esc(inc.status)}</span>
              </div>
            `).join("");
          }
        }
      } catch(e) {}
    }

    // --- RESIDENT: My Recent Requests panel ---
    const residentDashRequests = document.getElementById("residentDashRequests");
    if (residentDashRequests) {
      const myReqs = myRequests.slice(0, 5);
      if (myReqs.length === 0) {
        residentDashRequests.innerHTML = `<div style="text-align:center; padding:24px 16px; color:var(--muted); font-size:13px;">No requests submitted yet.</div>`;
      } else {
        residentDashRequests.innerHTML = myReqs.map(r => `
          <div class="request-item">
            <span class="doc-icon">▤</span>
            <div>
              <strong style="font-size:12px;">${esc(r.document)}</strong>
              <small>${esc(r.id)} &bull; ${esc(r.date)}</small>
            </div>
            <span class="badge ${statusClass(r.status)}">${esc(r.status)}</span>
          </div>
        `).join("");
      }
    }

    // --- RESIDENT: Track Latest Request panel ---
    const residentLatestTrackerContent = document.getElementById("residentLatestTrackerContent");
    if (residentLatestTrackerContent) {
      const latest = myRequests[0];
      if (!latest) {
        residentLatestTrackerContent.innerHTML = `<div style="text-align:center; padding:24px 16px; color:var(--muted); font-size:13px;">No active requests submitted yet.</div>`;
      } else {
        const trackerSteps = ["Pending", "Approved", "Ready for Pickup", "Completed"];
        const stepIdx = trackerSteps.indexOf(latest.status);
        const progressPct = stepIdx >= 0 ? Math.round((stepIdx / (trackerSteps.length - 1)) * 100) : 0;
        residentLatestTrackerContent.innerHTML = `
          <div style="padding:4px 0 10px 0;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong style="font-size:13px;">${esc(latest.document)}</strong>
              <span class="badge ${statusClass(latest.status)}">${esc(latest.status)}</span>
            </div>
            <small style="color:var(--muted); display:block; margin-bottom:10px;">${esc(latest.id)} &bull; ${esc(latest.date)}</small>
            <div style="background:#e2e8f0; border-radius:8px; height:8px; overflow:hidden; margin-bottom:8px;">
              <div style="background:var(--blue); height:100%; width:${progressPct}%; border-radius:8px; transition:width .4s;"></div>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              ${trackerSteps.map((s, i) => `<span style="font-size:10px; font-weight:${i <= stepIdx ? '700' : '400'}; color:${i <= stepIdx ? 'var(--blue)' : 'var(--muted)'};">${esc(s)}</span>`).join("")}
            </div>
            ${latest.pickup ? `<small style="display:block; margin-top:8px; color:var(--muted);">📍 ${esc(latest.pickup)}</small>` : ""}
          </div>
        `;
      }
    }

    // --- RESIDENT: Announcements panel (dashboard mini-news, dynamic) ---
    const announcementPanel = document.querySelector(".announcement-panel");
    if (announcementPanel) {
      try {
        const announcements = JSON.parse(localStorage.getItem("eViejoAnnouncements")) || [];
        // Remove static dummy articles and replace with dynamic container
        let listEl = announcementPanel.querySelector(".announcement-list-dynamic");
        if (!listEl) {
          announcementPanel.querySelectorAll("article.mini-news").forEach(a => a.remove());
          listEl = document.createElement("div");
          listEl.className = "announcement-list-dynamic";
          announcementPanel.appendChild(listEl);
        }
        if (announcements.length === 0) {
          listEl.innerHTML = `<div style="text-align:center; padding:16px 0; color:var(--muted); font-size:12px;">No announcements posted yet.</div>`;
        } else {
          listEl.innerHTML = announcements.slice(0, 3).map(a => `
            <article class="mini-news">
              <span>◉</span>
              <div>
                <strong>${esc(a.title)}</strong>
                <small>${esc(a.date)}${a.category ? " &bull; " + esc(a.category) : ""}</small>
              </div>
            </article>
          `).join("");
        }
      } catch(e) {}
    }
  }

  renderDashboard();

  // Re-render dashboard after Supabase live sync resolves
  if (typeof window !== "undefined" && window.eViejoDB) {
    window.eViejoDB.fetchRequests().then(remoteRequests => {
      if (remoteRequests && remoteRequests.length > 0) {
        mergeRequestsWithRemote(remoteRequests);
        renderDashboard();
        renderAdminRequests();
      }
    });
  }


  // ADMIN: request detail actions update the shared official database.
  const params=new URLSearchParams(location.search), requestId=params.get("id");
  function getRequestById(id){return getRequests().find(r=>r.id===id)||getRequests()[0];}
  const detail=getRequestById(requestId);
  if(detail && document.body.classList.contains("admin-request-page")){
    const title=document.querySelector("[data-detail-document]"), ref=document.querySelector("[data-detail-id]"), status=document.querySelector("[data-detail-status]");
    const resElem=document.querySelector("[data-detail-resident]"), purpElem=document.querySelector("[data-detail-purpose]"), dateElem=document.querySelector("[data-detail-date]");
    if(title)title.textContent=detail.document;
    if(ref)ref.textContent=detail.id;
    if(status)status.textContent=detail.status;
    if(resElem)resElem.textContent=detail.resident;
    if(purpElem)purpElem.textContent=detail.purpose;
    if(dateElem)dateElem.textContent=detail.date;

    const adminPendingSection = document.getElementById("adminPendingPhotoSection");
    const adminPendingImg = document.getElementById("adminPendingPhotoImg");
    if (adminPendingSection && adminPendingImg && detail.pendingPhoto) {
      adminPendingImg.src = detail.pendingPhoto;
      adminPendingSection.style.display = "flex";
    }

    const adminResidentIdElem = document.querySelector("[data-detail-resident-id]");
    if (adminResidentIdElem && detail.residentId) {
      adminResidentIdElem.textContent = detail.residentId;
    }

    const adminAddSection = document.getElementById("adminAdditionalDetailsSection");
    const adminAddList = document.getElementById("adminAdditionalDetailsList");
    if (adminAddSection && adminAddList) {
      const items = [];
      if (detail.contact) items.push(`<div><small>Contact Mobile</small><strong>${esc(detail.contact)}</strong></div>`);
      if (detail.email) items.push(`<div><small>Email Address</small><strong>${esc(detail.email)}</strong></div>`);
      if (detail.address) items.push(`<div><small>Residential Address</small><strong>${esc(detail.address)}</strong></div>`);
      if (detail.dob) items.push(`<div><small>Date of Birth</small><strong>${esc(detail.dob)}</strong></div>`);
      if (detail.civilStatus) items.push(`<div><small>Civil Status</small><strong>${esc(detail.civilStatus)}</strong></div>`);
      if (detail.pickup) items.push(`<div><small>Release Preference</small><strong>${esc(detail.pickup)}</strong></div>`);
      if (detail.purposeDetails) items.push(`<div style="grid-column:1/-1;"><small>Purpose Details / Context</small><strong>${esc(detail.purposeDetails)}</strong></div>`);

      if (detail.serviceDetails && typeof detail.serviceDetails === "object") {
        const sd = detail.serviceDetails;
        if (sd.yearsOfResidency) items.push(`<div><small>Years of Residency</small><strong>${esc(sd.yearsOfResidency)} years</strong></div>`);
        if (sd.requestingParty) items.push(`<div><small>Requesting Party / Employer</small><strong>${esc(sd.requestingParty)}</strong></div>`);
        if (sd.beneficiaryName) items.push(`<div><small>Beneficiary Name</small><strong>${esc(sd.beneficiaryName)}</strong></div>`);
        if (sd.relationship) items.push(`<div><small>Relationship to Beneficiary</small><strong>${esc(sd.relationship)}</strong></div>`);
        if (sd.assistanceAgency) items.push(`<div><small>Assistance Program / Agency</small><strong>${esc(sd.assistanceAgency)}</strong></div>`);
        if (sd.businessName) items.push(`<div><small>Business Name</small><strong>${esc(sd.businessName)}</strong></div>`);
        if (sd.businessType) items.push(`<div><small>Business Type</small><strong>${esc(sd.businessType)}</strong></div>`);
        if (sd.businessAddress) items.push(`<div><small>Business Address</small><strong>${esc(sd.businessAddress)}</strong></div>`);
        if (sd.facility) items.push(`<div><small>Facility to Use</small><strong>${esc(sd.facility)}</strong></div>`);
        if (sd.eventDateTime) items.push(`<div><small>Target Event Date & Time</small><strong>${esc(sd.eventDateTime)}</strong></div>`);
        if (sd.estimatedAttendees) items.push(`<div><small>Est. Attendees</small><strong>${esc(sd.estimatedAttendees)}</strong></div>`);
        if (sd.residencyPeriod) items.push(`<div><small>Residency Period</small><strong>${esc(sd.residencyPeriod)}</strong></div>`);
        if (sd.housingStatus) items.push(`<div><small>Housing Status</small><strong>${esc(sd.housingStatus)}</strong></div>`);
      }

      if (items.length > 0) {
        adminAddList.innerHTML = items.join("");
        adminAddSection.style.display = "block";
      }
    }

    document.querySelectorAll("[data-request-status]").forEach(btn=>btn.addEventListener("click",()=>{
      const target=btn.dataset.requestStatus, items=getRequests(), i=items.findIndex(r=>r.id===detail.id); if(i<0)return;
      items[i].status=target; 
      if(target==="Ready for Pickup")items[i].payment="For Payment"; 
      if(target==="Completed")items[i].payment="Paid"; 
      if(target==="Rejected")items[i].payment="Not Applicable"; 
      items[i].pickup=target==="Completed"?"Claimed":"Claim at Barangay Hall"; 

      let photoNotice = "";
      if (target==="Approved" || target==="Ready for Pickup" || target==="Completed") {
        if (items[i].pendingPhoto) {
          setResidentSession("gv_resident_photo", items[i].pendingPhoto);
          if (RESIDENTS_DATA && RESIDENTS_DATA["GV-2026-000123"]) {
            RESIDENTS_DATA["GV-2026-000123"].photo = items[i].pendingPhoto;
          }
          photoNotice += " Resident ID photo automatically updated!";
        }
        if (items[i].pendingInfo) {
          const info = items[i].pendingInfo;
          // Apply to local resident accounts
          try {
            const accounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
            const accIdx = accounts.findIndex(a => (a.full_name || a.name) === items[i].resident || a.id === items[i].residentId);
            if (accIdx >= 0) {
              if (info.name) { accounts[accIdx].full_name = info.name; accounts[accIdx].name = info.name; }
              if (info.dob) accounts[accIdx].dob = info.dob;
              if (info.phone) accounts[accIdx].phone = info.phone;
              if (info.address) accounts[accIdx].address = info.address;
              if (info.gender) accounts[accIdx].gender = info.gender;
              if (info.civilStatus) accounts[accIdx].civil_status = info.civilStatus;
              if (info.emergencyName) accounts[accIdx].emergency_name = info.emergencyName;
              if (info.emergencyPhone) accounts[accIdx].emergency_phone = info.emergencyPhone;
              if (items[i].pendingPhoto) accounts[accIdx].photo = items[i].pendingPhoto;
              localStorage.setItem("eViejoResidentAccounts", JSON.stringify(accounts));
            }
          } catch(e){}

          // If current logged in resident is this resident, sync session/localStorage
          if (currentResident() === items[i].resident || getResidentItem("gv_resident_id") === items[i].residentId) {
            if (info.name) setResidentSession("gv_resident_name", info.name);
            if (info.dob) setResidentSession("gv_resident_dob", info.dob);
            if (info.phone) setResidentSession("gv_resident_mobile", info.phone);
            if (info.address) setResidentSession("gv_resident_address", info.address);
            if (info.gender) setResidentSession("gv_resident_gender", info.gender);
            if (info.civilStatus) setResidentSession("gv_resident_civil", info.civilStatus);
            if (info.emergencyName) setResidentSession("gv_resident_emergency_name", info.emergencyName);
            if (info.emergencyPhone) setResidentSession("gv_resident_emergency_phone", info.emergencyPhone);
          }
          photoNotice += " Resident information updated!";
        }
      }

      saveRequests(items); 
      if (window.eViejoDB && typeof window.eViejoDB.updateRequestStatus === "function") {
        window.eViejoDB.updateRequestStatus(detail.id, target, items[i].payment, items[i].pickup);
      }
      if (typeof addAuditLog === "function") {
        addAuditLog(target === "Approved" ? "Approved" : "Updated", "Requests", detail.id, `Status updated to ${target} for resident ${detail.resident}.`);
      }
      toast(`Request ${target.toLowerCase()}.${photoNotice} Resident tracker updated.`); 
      setTimeout(()=>location.href="requests.html",700);
    }));
  }

  // RESIDENT tracker: only show the logged-in resident's requests.
  const residentBody=document.querySelector("#residentRequestsBody");
  
  function renderResidentTracker() {
    if(!residentBody) return;
    const curName = currentResident();
    const curId = getResidentItem("gv_resident_id") || "";
    
    const curNameNorm = (curName || "").trim().toLowerCase();
    const curIdNorm = (curId || "").trim().toLowerCase();

    let mine = getRequests().filter(r => {
      const rName = (r.resident || "").trim().toLowerCase();
      const rId = (r.residentId || "").trim().toLowerCase();
      return (curNameNorm && rName === curNameNorm) || (curIdNorm && rId === curIdNorm);
    });

    const searchInput = document.getElementById("trackerSearch");
    const filterSelect = document.getElementById("trackerFilter");
    
    if (searchInput && searchInput.value) {
      const q = searchInput.value.toLowerCase();
      mine = mine.filter(r => 
        (r.id||"").toLowerCase().includes(q) || 
        (r.document||"").toLowerCase().includes(q)
      );
    }
    if (filterSelect && filterSelect.value !== "All Status") {
      mine = mine.filter(r => r.status === filterSelect.value);
    }

    if (mine.length === 0) {
      residentBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:36px 16px; color:var(--muted);"><div style="font-size:20px; margin-bottom:8px;">📋</div><strong>No requests found.</strong><br><small style="font-size:12px;">Try adjusting your filters or go to Request Services to submit a new one.</small></td></tr>`;
    } else {
      residentBody.innerHTML = mine.map(r=>`<tr><td><strong style="color:var(--blue); font-family:monospace; font-size:12px;">${esc(r.id)}</strong></td><td>${esc(r.document)}</td><td><small class="muted">${esc(r.date)}</small></td><td><span class="badge ${statusClass(r.status)}">${esc(r.status)}</span></td><td><a class="text-btn" href="request-details.html?id=${encodeURIComponent(r.id)}">View</a></td></tr>`).join("");
    }
  }

  if(residentBody){
    residentBody.innerHTML = Array(3).fill(0).map(()=>`<tr class="skeleton-row"><td><div class="skeleton skeleton-text"></div></td><td><div class="skeleton skeleton-text"></div></td><td><div class="skeleton skeleton-text"></div></td><td><div class="skeleton skeleton-badge"></div></td><td><div class="skeleton skeleton-btn" style="width:50px;height:24px"></div></td></tr>`).join('');
    setTimeout(renderResidentTracker, 250);

    const s = document.getElementById("trackerSearch");
    const f = document.getElementById("trackerFilter");
    if(s) s.addEventListener("input", renderResidentTracker);
    if(f) f.addEventListener("change", renderResidentTracker);
  }

  // RESIDENT detail page reflects the status set by admin.
  if(detail && document.body.classList.contains("resident-request-page")){
    const title=document.querySelector("[data-detail-document]"), ref=document.querySelector("[data-detail-id]"), status=document.querySelector("[data-detail-status]");
    const purpElem=document.querySelector("[data-detail-purpose]"), dateElem=document.querySelector("[data-detail-date]");
    // Fix: declare 'note' - the status note container element
    const note = document.querySelector("[data-status-note]");
    if(title)title.textContent=detail.document; 
    if(ref)ref.textContent=detail.id; 
    if(status)status.textContent=detail.status;
    if(purpElem)purpElem.textContent=detail.purpose;
    if(dateElem)dateElem.textContent=detail.date;

    const resPendingSection = document.getElementById("residentPendingPhotoSection");
    const resPendingImg = document.getElementById("residentPendingPhotoImg");
    if (resPendingSection && resPendingImg && detail.pendingPhoto) {
      resPendingImg.src = detail.pendingPhoto;
      resPendingSection.style.display = "flex";
    }

    const steps=document.querySelectorAll(".status-flow .status-step"); const order=["Pending","Under Review","Approved","Ready for Pickup","Completed"]; const idx=order.indexOf(detail.status);
    steps.forEach((s,i)=>{s.classList.remove("done","current"); if(i<=idx)s.classList.add("done"); if(i===idx)s.classList.add("current");});
    if(note){
      if(detail.id && detail.id.startsWith("INC-")){
        const matchingIncident = getIncidents().find(i => i.id === detail.id);

        const officerStr = matchingIncident?.assignedOfficer && matchingIncident.assignedOfficer !== "Unassigned"
          ? `<strong style="color:var(--blue);">👮 Responding Officer:</strong> ${esc(matchingIncident.assignedOfficer)}`
          : `<strong>Status:</strong> Awaiting officer dispatch at the Barangay Peace & Order Desk.`;
        const notesStr = matchingIncident?.notes ? `<div style="margin-top:6px; padding:8px 10px; background:#f8fafc; border-radius:6px; border:1px solid #e2e8f0; font-size:12px; color:#334155;"><strong>Officer Remarks / Findings:</strong><br>${esc(matchingIncident.notes)}</div>` : "";
        note.innerHTML = `<div>${officerStr}${notesStr}</div>`;
      } else {
        note.innerHTML=detail.status==="Ready for Pickup"?`<strong>Your request is ready for pickup.</strong> Please proceed to the Barangay Hall, bring your Barangay ID and reference number, and claim the requested document/ID.`:detail.status==="Completed"?`<strong>Request completed.</strong> The resident claim has been recorded by the barangay.`:detail.status==="Approved"?`<strong>Your request was approved.</strong> The barangay is processing your document/ID. ${detail.pendingPhoto ? "Your new ID photo has been approved and activated on your official ID!" : "Wait for the Ready for Pickup status."}`:`<strong>Your request is ${esc(detail.status.toLowerCase())}.</strong> The barangay will update the status after review.`;
      }
    }
    const payment=document.querySelector("[data-detail-payment]"); if(payment)payment.textContent=detail.payment;

    const resAddSection = document.getElementById("residentAdditionalDetailsSection");
    const resAddList = document.getElementById("residentAdditionalDetailsList");
    if (resAddSection && resAddList) {
      const items = [];
      if (detail.contact) items.push(`<div><small>Contact Mobile</small><strong>${esc(detail.contact)}</strong></div>`);
      if (detail.email) items.push(`<div><small>Email Address</small><strong>${esc(detail.email)}</strong></div>`);
      if (detail.address) items.push(`<div><small>Residential Address</small><strong>${esc(detail.address)}</strong></div>`);
      if (detail.dob) items.push(`<div><small>Date of Birth</small><strong>${esc(detail.dob)}</strong></div>`);
      if (detail.civilStatus) items.push(`<div><small>Civil Status</small><strong>${esc(detail.civilStatus)}</strong></div>`);
      if (detail.pickup) items.push(`<div><small>Release Preference</small><strong>${esc(detail.pickup)}</strong></div>`);
      if (detail.purposeDetails) items.push(`<div style="grid-column:1/-1;"><small>Purpose Details / Remarks</small><strong>${esc(detail.purposeDetails)}</strong></div>`);

      if (detail.serviceDetails && typeof detail.serviceDetails === "object") {
        const sd = detail.serviceDetails;
        if (sd.yearsOfResidency) items.push(`<div><small>Years of Residency</small><strong>${esc(sd.yearsOfResidency)} years</strong></div>`);
        if (sd.requestingParty) items.push(`<div><small>Requesting Party / Employer</small><strong>${esc(sd.requestingParty)}</strong></div>`);
        if (sd.beneficiaryName) items.push(`<div><small>Beneficiary Name</small><strong>${esc(sd.beneficiaryName)}</strong></div>`);
        if (sd.relationship) items.push(`<div><small>Relationship to Beneficiary</small><strong>${esc(sd.relationship)}</strong></div>`);
        if (sd.assistanceAgency) items.push(`<div><small>Assistance Program / Agency</small><strong>${esc(sd.assistanceAgency)}</strong></div>`);
        if (sd.businessName) items.push(`<div><small>Business Name</small><strong>${esc(sd.businessName)}</strong></div>`);
        if (sd.businessType) items.push(`<div><small>Business Type</small><strong>${esc(sd.businessType)}</strong></div>`);
        if (sd.businessAddress) items.push(`<div><small>Business Address</small><strong>${esc(sd.businessAddress)}</strong></div>`);
        if (sd.facility) items.push(`<div><small>Facility to Use</small><strong>${esc(sd.facility)}</strong></div>`);
        if (sd.eventDateTime) items.push(`<div><small>Target Event Date & Time</small><strong>${esc(sd.eventDateTime)}</strong></div>`);
        if (sd.estimatedAttendees) items.push(`<div><small>Est. Attendees</small><strong>${esc(sd.estimatedAttendees)}</strong></div>`);
        if (sd.residencyPeriod) items.push(`<div><small>Residency Period</small><strong>${esc(sd.residencyPeriod)}</strong></div>`);
        if (sd.housingStatus) items.push(`<div><small>Housing Status</small><strong>${esc(sd.housingStatus)}</strong></div>`);
      }

      if (items.length > 0) {
        resAddList.innerHTML = items.join("");
        resAddSection.style.display = "block";
      }
    }
  }

  // SKELETON LOADING ENGINE
  function initSkeletonLoader() {
    if (document.getElementById("pageSkeletonOverlay")) return;

    const path = window.location.pathname.toLowerCase();
    const isAdmin = path.includes("/admin/") || document.body.classList.contains("admin-theme");
    const isResident = path.includes("/resident/");
    const isAuth = path.includes("/auth/");

    const overlay = document.createElement("div");
    overlay.id = "pageSkeletonOverlay";

    if (isAdmin || isResident) {
      overlay.innerHTML = `
        <div class="skeleton-overlay-header">
          <div class="skeleton skeleton-title" style="width: 150px; margin: 0;"></div>
          <div class="skeleton skeleton-avatar"></div>
        </div>
        <div class="skeleton-overlay-body">
          <div class="skeleton-overlay-sidebar">
            <div class="skeleton skeleton-title" style="width: 80%;"></div>
            <div class="skeleton skeleton-text" style="height: 30px;"></div>
            <div class="skeleton skeleton-text" style="height: 30px;"></div>
            <div class="skeleton skeleton-text" style="height: 30px;"></div>
            <div class="skeleton skeleton-text" style="height: 30px;"></div>
            <div class="skeleton skeleton-text" style="height: 30px;"></div>
          </div>
          <div class="skeleton-overlay-main">
            <div class="skeleton skeleton-title" style="width: 250px; height: 32px;"></div>
            <div class="skeleton-grid-cards">
              <div class="skeleton skeleton-card"></div>
              <div class="skeleton skeleton-card"></div>
              <div class="skeleton skeleton-card"></div>
              <div class="skeleton skeleton-card"></div>
            </div>
            <div class="skeleton-table-placeholder">
              <div class="skeleton skeleton-title" style="width: 40%;"></div>
              <div class="skeleton skeleton-text" style="height: 24px;"></div>
              <div class="skeleton skeleton-text" style="height: 24px;"></div>
              <div class="skeleton skeleton-text" style="height: 24px;"></div>
              <div class="skeleton skeleton-text" style="height: 24px;"></div>
            </div>
          </div>
        </div>
      `;
    } else if (isAuth) {
      overlay.innerHTML = `
        <div style="display: grid; place-items: center; height: 100vh; padding: 20px;">
          <div class="skeleton-table-placeholder" style="max-width: 420px; width: 100%; height: 380px; justify-content: center;">
            <div class="skeleton skeleton-title" style="width: 60%; margin: 0 auto 15px auto;"></div>
            <div class="skeleton skeleton-text" style="height: 40px; margin-bottom: 12px;"></div>
            <div class="skeleton skeleton-text" style="height: 40px; margin-bottom: 12px;"></div>
            <div class="skeleton skeleton-btn" style="width: 100%; height: 44px; margin-top: 10px;"></div>
          </div>
        </div>
      `;
    } else {
      overlay.innerHTML = `
        <div class="skeleton-overlay-header">
          <div class="skeleton skeleton-title" style="width: 140px; margin: 0;"></div>
          <div style="display: flex; gap: 12px;">
            <div class="skeleton skeleton-btn" style="width: 80px; height: 32px;"></div>
            <div class="skeleton skeleton-btn" style="width: 80px; height: 32px;"></div>
          </div>
        </div>
        <div class="skeleton-overlay-body" style="flex-direction: column;">
          <div class="skeleton skeleton-title" style="width: 50%; height: 48px; margin-top: 20px;"></div>
          <div class="skeleton skeleton-text" style="width: 70%; height: 20px;"></div>
          <div class="skeleton-grid-cards" style="margin-top: 30px;">
            <div class="skeleton skeleton-card" style="height: 180px;"></div>
            <div class="skeleton skeleton-card" style="height: 180px;"></div>
            <div class="skeleton skeleton-card" style="height: 180px;"></div>
          </div>
        </div>
      `;
    }

    document.body.appendChild(overlay);

    setTimeout(() => {
      overlay.classList.add("fade-out");
      setTimeout(() => overlay.remove(), 360);
    }, 400);
  }

  initSkeletonLoader();

  // RESIDENT MANAGEMENT POPUP MODAL LOGIC
  const STORE_RESIDENTS = "eViejoResidentsData";
  let RESIDENTS_DATA = JSON.parse(localStorage.getItem(STORE_RESIDENTS) || "{}");
  
  function saveResidentsData() {
    localStorage.setItem(STORE_RESIDENTS, JSON.stringify(RESIDENTS_DATA));
  }

  const resModal = document.getElementById("residentInfoModal");
  const closeResModalBtn = document.getElementById("closeResidentInfoModal");

  let activeResidentId = "";

  function openResidentModal(resId) {
    activeResidentId = resId;
    if (!resModal) return;
    const res = RESIDENTS_DATA[resId] || {
      name: "Resident " + resId,
      id: resId,
      avatar: "GV",
      photo: null,
      account: "Verified Resident",
      idStatus: "Active Barangay ID",
      dob: "January 01, 1992",
      gender: "N/A",
      phone: "+63 900 000 0000",
      email: "resident@email.com",
      address: "Brgy. Guadalupe Viejo, Makati City",
      voter: "Registered Voter",
      since: "2021"
    };

    const savedJuanPhoto = localStorage.getItem("gv_resident_photo");
    if (res.id === "GV-2026-000123" && savedJuanPhoto) {
      res.photo = savedJuanPhoto;
    }

    const photoImg = document.getElementById("modalResPhoto");
    const initialsSpan = document.getElementById("modalResInitials");

    if (res.photo) {
      if (photoImg) {
        photoImg.src = res.photo;
        photoImg.style.display = "block";
      }
      if (initialsSpan) initialsSpan.style.display = "none";
    } else {
      if (photoImg) {
        photoImg.src = "";
        photoImg.style.display = "none";
      }
      if (initialsSpan) {
        initialsSpan.textContent = res.avatar;
        initialsSpan.style.display = "block";
      }
    }

    const name = document.getElementById("modalResName");
    const id = document.getElementById("modalResId");
    const account = document.getElementById("modalResAccount");
    const idStatus = document.getElementById("modalResIdStatus");
    const fullName = document.getElementById("modalResFullName");
    const dob = document.getElementById("modalResDob");
    const gender = document.getElementById("modalResGender");
    const phone = document.getElementById("modalResPhone");
    const email = document.getElementById("modalResEmail");
    const address = document.getElementById("modalResAddress");
    const voter = document.getElementById("modalResVoter");
    const since = document.getElementById("modalResSince");

    if (name) name.textContent = res.name;
    if (id) id.textContent = res.id;
    if (account) account.textContent = res.account;
    if (idStatus) idStatus.textContent = res.idStatus;
    if (fullName) fullName.textContent = res.name;
    if (dob) dob.textContent = res.dob;
    if (gender) gender.textContent = res.gender;
    if (phone) phone.textContent = res.phone;
    if (email) email.textContent = res.email;
    if (address) address.textContent = res.address;
    if (voter) voter.textContent = res.voter;
    if (since) since.textContent = res.since;

    resModal.classList.remove("hidden");
  }

  // --- Dynamic Residents Table Rendering & Management ---
  const residentsTableBody = document.getElementById("residentsTableBody");
  const residentSearchInput = document.getElementById("residentSearchInput");
  const openAddResidentBtn = document.getElementById("openAddResidentBtn");
  const addResidentModal = document.getElementById("addResidentModal");
  const closeAddResidentModal = document.getElementById("closeAddResidentModal");
  const cancelAddResidentBtn = document.getElementById("cancelAddResidentBtn");
  const addResidentForm = document.getElementById("addResidentForm");

  function renderResidentsTable() {
    if (!residentsTableBody) return;
    const query = (residentSearchInput?.value || "").trim().toLowerCase();
    const list = Object.values(RESIDENTS_DATA).filter(r => {
      if (!query) return true;
      return (r.name || "").toLowerCase().includes(query) ||
             (r.id || "").toLowerCase().includes(query) ||
             (r.address || "").toLowerCase().includes(query);
    });

    if (list.length === 0) {
      residentsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--muted); font-size:13px;">No residents found in database.</td></tr>`;
      return;
    }

    residentsTableBody.innerHTML = list.map(r => `
      <tr>
        <td>
          <div class="user-cell" style="display:flex; align-items:center; gap:10px; flex-direction:row;">
            <div class="avatar" style="flex-shrink:0; width:34px; height:34px; font-size:12px;">${esc(r.avatar || "JD")}</div>
            <div style="min-width:0;">
              <strong style="display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(r.name)}</strong>
              <small style="display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(r.email || r.phone || "")}</small>
            </div>
          </div>
        </td>
        <td><code>${esc(r.id)}</code></td>
        <td>${esc(r.address)}</td>
        <td><span class="badge ${r.account === 'Verified Resident' ? 'approved' : 'pending'}">${esc(r.account || 'Verified Resident')}</span></td>
        <td><span class="badge ${r.idStatus === 'Active Barangay ID' ? 'completed' : 'payment'}">${esc(r.idStatus || 'Active Barangay ID')}</span></td>
        <td><button class="btn btn-sm btn-outline btn-view-resident" type="button" data-view-resident="${esc(r.id)}">View Profile</button></td>
      </tr>
    `).join("");

    residentsTableBody.querySelectorAll(".btn-view-resident").forEach(btn => {
      btn.addEventListener("click", () => {
        openResidentModal(btn.dataset.viewResident);
      });
    });
  }

  // Hook search input
  residentSearchInput?.addEventListener("input", renderResidentsTable);

  // Add resident modal events
  openAddResidentBtn?.addEventListener("click", () => {
    addResidentForm?.reset();
    addResidentModal?.classList.remove("hidden");
  });
  closeAddResidentModal?.addEventListener("click", () => addResidentModal?.classList.add("hidden"));
  cancelAddResidentBtn?.addEventListener("click", () => addResidentModal?.classList.add("hidden"));
  addResidentModal?.addEventListener("click", e => {
    if (e.target === addResidentModal) addResidentModal.classList.add("hidden");
  });

  addResidentForm?.addEventListener("submit", e => {
    e.preventDefault();
    const name = document.getElementById("addResName")?.value.trim();
    const dob = document.getElementById("addResDob")?.value;
    const gender = document.getElementById("addResGender")?.value || "Female";
    const civil = document.getElementById("addResCivil")?.value || "Single";
    const phone = document.getElementById("addResPhone")?.value.trim();
    const email = document.getElementById("addResEmail")?.value.trim();
    const address = document.getElementById("addResAddress")?.value.trim();

    const existingKeys = Object.keys(RESIDENTS_DATA);
    const nextNum = Math.max(...existingKeys.map(k => parseInt(k.replace(/[^0-9]/g, "")) || 0), 123) + 1;
    const newId = `GV-2026-${String(nextNum).padStart(6, "0")}`;
    const initials = (name.split(/\s+/).map(p => p[0]).join("") || "JD").slice(0, 2).toUpperCase();

    const newRes = {
      name,
      id: newId,
      avatar: initials,
      photo: null,
      account: "Verified Resident",
      idStatus: "Active Barangay ID",
      dob: dob || "N/A",
      gender: `${gender} • ${civil}`,
      phone: phone || "N/A",
      email: email || "N/A",
      address: address || "Brgy. Guadalupe Viejo, Makati City",
      voter: "Registered Voter",
      since: `${new Date().getFullYear()}`
    };

    RESIDENTS_DATA[newId] = newRes;
    saveResidentsData();

    // Sync to Supabase
    if (window.eViejoDB && typeof window.eViejoDB.registerResident === "function") {
      window.eViejoDB.registerResident({
        name,
        phone,
        email,
        address
      });
    }

    if (typeof addAuditLog === "function") {
      addAuditLog("Created", "Resident Records", newId, `Enrolled new resident ${name} under RA 10173.`);
    }

    addResidentModal?.classList.add("hidden");
    renderResidentsTable();
    toast(`Resident ${name} successfully enrolled! ID: ${newId}`);
  });

  // Fetch residents from Supabase on load to augment RESIDENTS_DATA
  if (typeof window !== "undefined" && window.eViejoDB && typeof window.eViejoDB.fetchResidents === "function") {
    window.eViejoDB.fetchResidents().then(({ data, error }) => {
      if (!error && Array.isArray(data)) {
        data.forEach(item => {
          const rId = item.resident_id_no || `GV-${item.id.slice(0, 8).toUpperCase()}`;
          if (!RESIDENTS_DATA[rId]) {
            const initials = (item.full_name ? item.full_name.split(/\s+/).map(p => p[0]).join("") : "JD").slice(0, 2).toUpperCase();
            RESIDENTS_DATA[rId] = {
              name: item.full_name,
              id: rId,
              avatar: initials,
              photo: item.photo_url || null,
              account: item.is_verified ? "Verified Resident" : "Pending Verification",
              idStatus: "Active Barangay ID",
              dob: item.date_of_birth || "N/A",
              gender: `${item.gender || "N/A"} • ${item.civil_status || "N/A"}`,
              phone: item.phone || "N/A",
              email: item.email || "N/A",
              address: item.address || "Brgy. Guadalupe Viejo, Makati City",
              voter: "Registered Voter",
              since: `${new Date(item.created_at || Date.now()).getFullYear()}`
            };
          }
        });
        saveResidentsData();
        renderResidentsTable();
        const dashStatResidents = document.getElementById("dashStatResidents");
        if (dashStatResidents) {
          dashStatResidents.textContent = Object.keys(RESIDENTS_DATA).length.toLocaleString();
        }
      }
    });
  }

  // Initial table render
  renderResidentsTable();

  document.querySelectorAll(".btn-view-resident").forEach(btn => {
    btn.addEventListener("click", () => {
      openResidentModal(btn.dataset.viewResident);
    });
  });

  closeResModalBtn?.addEventListener("click", () => resModal?.classList.add("hidden"));
  resModal?.addEventListener("click", e => { if (e.target === resModal) resModal.classList.add("hidden"); });

  // ADMIN EDIT RESIDENT WORKFLOW
  const openEditFlowBtn = document.getElementById("openAdminEditFlowBtn");
  const adminTermsModal = document.getElementById("adminTermsEditModal");
  const adminAgreeCheckbox = document.getElementById("adminAgreeEditCheckbox");
  const proceedToEditBtn = document.getElementById("proceedToEditBtn");
  const cancelAdminTermsBtn = document.getElementById("cancelAdminTermsBtn");
  const closeAdminTermsModalBtn = document.getElementById("closeAdminTermsModal");

  const editModal = document.getElementById("editResidentModal");
  const closeEditModalBtn = document.getElementById("closeEditResidentModal");
  const cancelEditFormBtn = document.getElementById("cancelEditFormBtn");
  const editForm = document.getElementById("editResidentForm");

  adminAgreeCheckbox?.addEventListener("change", () => {
    if (proceedToEditBtn) proceedToEditBtn.disabled = !adminAgreeCheckbox.checked;
  });

  openEditFlowBtn?.addEventListener("click", () => {
    if (resModal) resModal.classList.add("hidden");
    if (adminAgreeCheckbox) adminAgreeCheckbox.checked = false;
    if (proceedToEditBtn) proceedToEditBtn.disabled = true;
    adminTermsModal?.classList.remove("hidden");
  });

  cancelAdminTermsBtn?.addEventListener("click", () => adminTermsModal?.classList.add("hidden"));
  closeAdminTermsModalBtn?.addEventListener("click", () => adminTermsModal?.classList.add("hidden"));

  proceedToEditBtn?.addEventListener("click", () => {
    adminTermsModal?.classList.add("hidden");
    const res = RESIDENTS_DATA[activeResidentId];
    if (!res || !editModal) return;

    document.getElementById("editResTargetId").value = res.id;
    document.getElementById("editResTitleName").textContent = res.name;
    document.getElementById("editResTitleId").textContent = res.id;

    document.getElementById("inputEditName").value = res.name;
    document.getElementById("inputEditDob").value = res.dob;
    document.getElementById("inputEditGender").value = res.gender;
    document.getElementById("inputEditPhone").value = res.phone;
    document.getElementById("inputEditEmail").value = res.email;
    document.getElementById("inputEditAddress").value = res.address;
    document.getElementById("inputEditVoter").value = res.voter;
    document.getElementById("inputEditAccount").value = res.account;
    document.getElementById("inputEditIdStatus").value = res.idStatus;

    editModal.classList.remove("hidden");
  });

  cancelEditFormBtn?.addEventListener("click", () => editModal?.classList.add("hidden"));
  closeEditModalBtn?.addEventListener("click", () => editModal?.classList.add("hidden"));

  editForm?.addEventListener("submit", e => {
    e.preventDefault();
    const id = document.getElementById("editResTargetId").value;
    if (RESIDENTS_DATA[id]) {
      RESIDENTS_DATA[id].name = document.getElementById("inputEditName").value.trim();
      RESIDENTS_DATA[id].dob = document.getElementById("inputEditDob").value.trim();
      RESIDENTS_DATA[id].gender = document.getElementById("inputEditGender").value.trim();
      RESIDENTS_DATA[id].phone = document.getElementById("inputEditPhone").value.trim();
      RESIDENTS_DATA[id].email = document.getElementById("inputEditEmail").value.trim();
      RESIDENTS_DATA[id].address = document.getElementById("inputEditAddress").value.trim();
      RESIDENTS_DATA[id].voter = document.getElementById("inputEditVoter").value.trim();
      RESIDENTS_DATA[id].account = document.getElementById("inputEditAccount").value;
      RESIDENTS_DATA[id].idStatus = document.getElementById("inputEditIdStatus").value;
      saveResidentsData();
    }

    editModal?.classList.add("hidden");
    if (typeof addAuditLog === "function") {
      addAuditLog("Updated", "Resident Records", id, `Resident profile updated for ${RESIDENTS_DATA[id]?.name || id} under RA 10173.`);
    }
    toast(`Resident record ${id} updated & audit log saved under RA 10173.`);
    renderResidentsTable();
    openResidentModal(id);
  });

  // ==== Edit Info Modal handling (Physical ID update) ====
  const editInfoBtn = document.getElementById("editInfoBtn");
  const editInfoModal = document.getElementById("editInfoModal");
  const closeEditInfoModal = document.getElementById("closeEditInfoModal");
  const cancelEditInfoBtn = document.getElementById("cancelEditInfoBtn");
  const editInfoForm = document.getElementById("editInfoForm");

  editInfoBtn?.addEventListener("click", () => {
    const resident = RESIDENTS_DATA[activeResidentId];
    if (resident) {
      if (document.getElementById("editPhone")) document.getElementById("editPhone").value = resident.phone || "";
      if (document.getElementById("editAddress")) document.getElementById("editAddress").value = resident.address || "";
      if (document.getElementById("editEmergencyName")) document.getElementById("editEmergencyName").value = resident.emergencyName || "";
      if (document.getElementById("editEmergencyPhone")) document.getElementById("editEmergencyPhone").value = resident.emergencyPhone || "";
    }
    editInfoModal?.classList.remove("hidden");
  });

  closeEditInfoModal?.addEventListener("click", () => editInfoModal?.classList.add("hidden"));
  cancelEditInfoBtn?.addEventListener("click", () => editInfoModal?.classList.add("hidden"));
  editInfoModal?.addEventListener("click", e => {
    if (e.target === editInfoModal) editInfoModal.classList.add("hidden");
  });

  editInfoForm?.addEventListener("submit", e => {
    e.preventDefault();
    const resident = RESIDENTS_DATA[activeResidentId];
    if (resident) {
      if (document.getElementById("editPhone")) resident.phone = document.getElementById("editPhone").value.trim();
      if (document.getElementById("editAddress")) resident.address = document.getElementById("editAddress").value.trim();
      if (document.getElementById("editEmergencyName")) resident.emergencyName = document.getElementById("editEmergencyName").value.trim();
      if (document.getElementById("editEmergencyPhone")) resident.emergencyPhone = document.getElementById("editEmergencyPhone").value.trim();
      toast("Contact and emergency information updated.");
    }
    editInfoModal?.classList.add("hidden");
    openResidentModal(activeResidentId);
  });
  // ==== End Edit Info Modal handling ====

  /* ========================================================
     BARANGAY ID REQUEST & RESIDENT PHOTO MANAGEMENT
     ======================================================== */
  const requestIdModal = document.getElementById("requestIdModal");
  const closeIdRequestModalBtn = document.getElementById("closeIdRequestModal");
  const cancelIdRequestModalBtn = document.getElementById("cancelIdRequestModal");
  const idRequestForm = document.getElementById("idRequestForm");
  const idPhotoFileInput = document.getElementById("idPhotoFileInput");
  const idPhotoPreviewImg = document.getElementById("idPhotoPreviewImg");
  const idPhotoPlaceholder = document.getElementById("idPhotoPlaceholder");
  const removeIdPhotoBtn = document.getElementById("removeIdPhotoBtn");

  let tempPhotoDataUrl = localStorage.getItem("gv_resident_photo") || "";

  function openIdRequestModal() {
    if (!requestIdModal) return;
    const isRequested = getResidentItem("gv_id_requested") === "true";
    tempPhotoDataUrl = getResidentItem("gv_resident_photo") || "";
    if (tempPhotoDataUrl) {
      if (idPhotoPreviewImg) {
        idPhotoPreviewImg.src = tempPhotoDataUrl;
        idPhotoPreviewImg.style.display = "block";
      }
      if (idPhotoPlaceholder) idPhotoPlaceholder.style.display = "none";
      if (removeIdPhotoBtn) removeIdPhotoBtn.style.display = isRequested ? "none" : "inline-flex";
    } else {
      if (idPhotoPreviewImg) {
        idPhotoPreviewImg.src = "";
        idPhotoPreviewImg.style.display = "none";
      }
      if (idPhotoPlaceholder) idPhotoPlaceholder.style.display = "flex";
      if (removeIdPhotoBtn) removeIdPhotoBtn.style.display = "none";
    }

    // Pre-fill resident info dynamically from current resident account / session
    const activeResName = currentResident();
    const activeResDob = getResidentItem("gv_resident_dob") || "";
    const activeResPhone = getResidentItem("gv_resident_mobile") || "";
    const activeResAddress = getResidentItem("gv_resident_address") || "Guadalupe Viejo, Makati City";
    const activeResGender = getResidentItem("gv_resident_gender") || "Male";
    const activeResCivil = getResidentItem("gv_resident_civil") || "Single";
    const activeResEmergName = getResidentItem("gv_resident_emergency_name") || "";
    const activeResEmergPhone = getResidentItem("gv_resident_emergency_phone") || "";

    const reqFullName = document.getElementById("reqFullName");
    const reqDob = document.getElementById("reqDob");
    const reqGenderCivil = document.getElementById("reqGenderCivil");
    const reqPhone = document.getElementById("reqPhone");
    const reqAddress = document.getElementById("reqAddress");
    const reqEmergencyName = document.getElementById("reqEmergencyName");
    const reqEmergencyPhone = document.getElementById("reqEmergencyPhone");
    const submitBtn = document.getElementById("submitIdRequestBtn");

    if (reqFullName) reqFullName.value = (activeResName === "Resident User" ? "" : activeResName);
    if (reqDob && activeResDob) reqDob.value = activeResDob;
    if (reqPhone && activeResPhone) reqPhone.value = activeResPhone;
    if (reqAddress && activeResAddress) reqAddress.value = activeResAddress;
    if (reqEmergencyName) reqEmergencyName.value = activeResEmergName;
    if (reqEmergencyPhone) reqEmergencyPhone.value = activeResEmergPhone;

    if (reqGenderCivil) {
      const combinedTarget = `${activeResGender} • ${activeResCivil}`.toLowerCase();
      const matchOpt = Array.from(reqGenderCivil.options).find(opt => opt.value.toLowerCase() === combinedTarget)
        || Array.from(reqGenderCivil.options).find(opt => opt.value.toLowerCase().startsWith(activeResGender.toLowerCase()));
      if (matchOpt) matchOpt.selected = true;
    }

    const modalHeading = document.getElementById("idRequestModalHeading");
    const modalSubtext = document.getElementById("idRequestModalSubtext");
    if (modalHeading) {
      modalHeading.textContent = isRequested ? "Request ID Information / Photo Update" : "Official Barangay Digital ID Registration";
    }
    if (modalSubtext) {
      modalSubtext.textContent = isRequested
        ? "Submit changes for your Constituent's ID. Modifications stay pending and will take effect once officially approved by Barangay Admin."
        : "First-time resident setup: Verify your personal details, attach your official 2x2 photo, and affix your signature. Once activated, your ID is firmly saved and locked.";
    }

    if (submitBtn) {
      submitBtn.textContent = isRequested ? "Submit ID Update for Approval" : "Activate Digital ID";
    }

    requestIdModal.classList.remove("hidden");
    initEsignCanvas();
  }

  function closeIdRequestModal() {
    requestIdModal?.classList.add("hidden");
  }

  // Note: editInfoBtn on physical-id.html is handled by the earlier listener (editInfoModal flow)
  // The openIdRequestModal is triggered via bannerRequestIdBtn and openPhotoUploadDirect

  // ── Interactive E-Signature Pad (eGovPH Flow) ──────────────────────────────
  let esignCanvasInitialized = false;
  let isDrawingSig = false;
  let lastSigX = 0, lastSigY = 0;
  let esignHasDrawn = false;

  function initEsignCanvas() {
    const canvas = document.getElementById("esignCanvas");
    if (!canvas) return;

    // Set high-res internal resolution
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0) {
      canvas.width = rect.width * (window.devicePixelRatio || 1);
      canvas.height = 95 * (window.devicePixelRatio || 1);
      const ctx = canvas.getContext("2d");
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      ctx.strokeStyle = "#002b66";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    }

    if (esignCanvasInitialized) return;
    esignCanvasInitialized = true;

    function getCanvasPos(e) {
      const b = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: clientX - b.left,
        y: clientY - b.top
      };
    }

    function startDraw(e) {
      isDrawingSig = true;
      const pos = getCanvasPos(e);
      lastSigX = pos.x;
      lastSigY = pos.y;
    }

    function draw(e) {
      if (!isDrawingSig) return;
      e.preventDefault();
      const ctx = canvas.getContext("2d");
      const pos = getCanvasPos(e);
      ctx.beginPath();
      ctx.moveTo(lastSigX, lastSigY);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastSigX = pos.x;
      lastSigY = pos.y;
      esignHasDrawn = true;
    }

    function stopDraw() {
      isDrawingSig = false;
    }

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    window.addEventListener("mouseup", stopDraw);

    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    window.addEventListener("touchend", stopDraw);

    // Clear signature button
    document.getElementById("clearSigBtn")?.addEventListener("click", () => {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      esignHasDrawn = false;
    });

    // Signature Tab Switching
    const tabDrawSig = document.getElementById("tabDrawSig");
    const tabTypeSig = document.getElementById("tabTypeSig");
    const drawSigBox = document.getElementById("drawSigBox");
    const typeSigBox = document.getElementById("typeSigBox");

    tabDrawSig?.addEventListener("click", () => {
      tabDrawSig.classList.add("active");
      tabTypeSig?.classList.remove("active");
      if (drawSigBox) drawSigBox.style.display = "block";
      if (typeSigBox) typeSigBox.style.display = "none";
    });

    tabTypeSig?.addEventListener("click", () => {
      tabTypeSig.classList.add("active");
      tabDrawSig?.classList.remove("active");
      if (drawSigBox) drawSigBox.style.display = "none";
      if (typeSigBox) typeSigBox.style.display = "block";
      document.getElementById("typeSigInput")?.focus();
    });
  }

  document.querySelectorAll("#bannerRequestIdBtn, #openPhotoUploadDirect").forEach(btn => {
    btn?.addEventListener("click", e => {
      e.preventDefault();
      openIdRequestModal();
    });
  });

  document.querySelectorAll("#openIdRequestModalBtn").forEach(btn => {
    btn?.addEventListener("click", e => {
      const isRequested = localStorage.getItem("gv_id_requested") === "true";
      if (isRequested) {
        e.preventDefault();
        location.href = "physical-id.html?type=replacement";
      } else {
        e.preventDefault();
        openIdRequestModal();
      }
    });
  });

  closeIdRequestModalBtn?.addEventListener("click", closeIdRequestModal);
  cancelIdRequestModalBtn?.addEventListener("click", closeIdRequestModal);
  requestIdModal?.addEventListener("click", e => {
    if (e.target === requestIdModal) closeIdRequestModal();
  });

  // Photo file picker inside modal
  idPhotoFileInput?.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      tempPhotoDataUrl = evt.target.result;
      if (idPhotoPreviewImg) {
        idPhotoPreviewImg.src = tempPhotoDataUrl;
        idPhotoPreviewImg.style.display = "block";
      }
      if (idPhotoPlaceholder) idPhotoPlaceholder.style.display = "none";
      if (removeIdPhotoBtn) removeIdPhotoBtn.style.display = "inline-flex";
      toast("Photo attached. Submit to generate your Digital ID.");
    };
    reader.readAsDataURL(file);
  });

  removeIdPhotoBtn?.addEventListener("click", () => {
    tempPhotoDataUrl = "";
    if (idPhotoFileInput) idPhotoFileInput.value = "";
    if (idPhotoPreviewImg) {
      idPhotoPreviewImg.src = "";
      idPhotoPreviewImg.style.display = "none";
    }
    if (idPhotoPlaceholder) idPhotoPlaceholder.style.display = "flex";
    removeIdPhotoBtn.style.display = "none";
    toast("Photo removed.");
  });

  // Physical ID file picker inside physical-id.html
  const idPhotoFileInputPhysical = document.getElementById("idPhotoFileInputPhysical");
  const idPhotoPreviewImgPhysical = document.getElementById("idPhotoPreviewImgPhysical");
  const idPhotoPlaceholderPhysical = document.getElementById("idPhotoPlaceholderPhysical");
  const removePhotoBtnPhysical = document.getElementById("removePhotoBtnPhysical");

  idPhotoFileInputPhysical?.addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      const dataUrl = evt.target.result;
      stagedPhysicalPhoto = dataUrl;
      if (idPhotoPreviewImgPhysical) {
        idPhotoPreviewImgPhysical.src = dataUrl;
        idPhotoPreviewImgPhysical.style.display = "block";
      }
      if (idPhotoPlaceholderPhysical) idPhotoPlaceholderPhysical.style.display = "none";
      if (removePhotoBtnPhysical) removePhotoBtnPhysical.style.display = "inline-flex";
      toast("Image attached! You can change it freely until you submit the form.");
    };
    reader.readAsDataURL(file);
  });

  removePhotoBtnPhysical?.addEventListener("click", () => {
    stagedPhysicalPhoto = "";
    if (idPhotoFileInputPhysical) idPhotoFileInputPhysical.value = "";
    const isRequested = localStorage.getItem("gv_id_requested") === "true";
    const savedPhoto = localStorage.getItem("gv_resident_photo");
    const activePhoto = savedPhoto || (isRequested ? "../assets/residents/juan.jpg" : "");
    if (activePhoto && isRequested) {
      if (idPhotoPreviewImgPhysical) {
        idPhotoPreviewImgPhysical.src = activePhoto;
        idPhotoPreviewImgPhysical.style.display = "block";
      }
      if (idPhotoPlaceholderPhysical) idPhotoPlaceholderPhysical.style.display = "none";
    } else {
      if (idPhotoPreviewImgPhysical) {
        idPhotoPreviewImgPhysical.src = "";
        idPhotoPreviewImgPhysical.style.display = "none";
      }
      if (idPhotoPlaceholderPhysical) idPhotoPlaceholderPhysical.style.display = "flex";
    }
    removePhotoBtnPhysical.style.display = "none";
    toast("Uploaded image cleared.");
  });

  // Centralized UI Updater
  function updateResidentPhotoUI() {
    // Restore saved resident profile edits from localStorage if available
    const savedProfileJson = localStorage.getItem("gv_resident_profile");
    if (savedProfileJson && RESIDENTS_DATA && RESIDENTS_DATA["GV-2026-000123"]) {
      try {
        const parsed = JSON.parse(savedProfileJson);
        Object.assign(RESIDENTS_DATA["GV-2026-000123"], parsed);
      } catch (err) {}
    }

    // Check if any approved replacement request has a pendingPhoto or pendingInfo that hasn't been synced yet
    const requests = getRequests();
    const curRes = currentResident();
    const curId = getResidentItem("gv_resident_id") || "GV-2026-0001";
    const approvedPhotoReq = requests.find(r => (r.resident === curRes || r.residentId === curId) && r.pendingPhoto && (r.status === "Approved" || r.status === "Ready for Pickup" || r.status === "Completed"));
    if (approvedPhotoReq && getResidentItem("gv_resident_photo") !== approvedPhotoReq.pendingPhoto) {
      setResidentSession("gv_resident_photo", approvedPhotoReq.pendingPhoto);
    }
    const approvedInfoReq = requests.find(r => (r.resident === curRes || r.residentId === curId) && r.pendingInfo && (r.status === "Approved" || r.status === "Ready for Pickup" || r.status === "Completed"));
    if (approvedInfoReq && approvedInfoReq.pendingInfo) {
      const info = approvedInfoReq.pendingInfo;
      if (info.name && getResidentItem("gv_resident_name") !== info.name) setResidentSession("gv_resident_name", info.name);
      if (info.dob && getResidentItem("gv_resident_dob") !== info.dob) setResidentSession("gv_resident_dob", info.dob);
      if (info.phone && getResidentItem("gv_resident_mobile") !== info.phone) setResidentSession("gv_resident_mobile", info.phone);
      if (info.address && getResidentItem("gv_resident_address") !== info.address) setResidentSession("gv_resident_address", info.address);
      if (info.gender && getResidentItem("gv_resident_gender") !== info.gender) setResidentSession("gv_resident_gender", info.gender);
      if (info.civilStatus && getResidentItem("gv_resident_civil") !== info.civilStatus) setResidentSession("gv_resident_civil", info.civilStatus);
      if (info.emergencyName && getResidentItem("gv_resident_emergency_name") !== info.emergencyName) setResidentSession("gv_resident_emergency_name", info.emergencyName);
      if (info.emergencyPhone && getResidentItem("gv_resident_emergency_phone") !== info.emergencyPhone) setResidentSession("gv_resident_emergency_phone", info.emergencyPhone);
    }

    const savedPhoto = getResidentItem("gv_resident_photo");
    const isPhotoLocked = getResidentItem("gv_resident_photo_locked") === "true";
    const isRequested = getResidentItem("gv_id_requested") === "true";
    const activePhoto = savedPhoto || "";

    const activeResName = currentResident();
    const activeResInitials = (activeResName.split(/\s+/).map(p => p[0]).join("") || "ID").slice(0, 2).toUpperCase();

    // Update all .id-photo containers
    document.querySelectorAll(".id-photo").forEach(box => {
      if (activePhoto) {
        box.innerHTML = `<img src="${activePhoto}" alt="Resident Photo" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
        box.style.cursor = "pointer";
        box.title = "Official ID Photo";
        box.onclick = e => {
          e.stopPropagation();
          toast("Official ID photo is set. To update your 1x1 photo, submit an ID Replacement Request.");
        };
      } else {
        box.innerHTML = `${activeResInitials}<button type="button" class="id-photo-badge-btn" title="Attach Photo">📷 Attach</button>`;
        box.style.cursor = "pointer";
        box.title = "Click to attach photo for your ID";
        box.onclick = e => {
          e.stopPropagation();
          openIdRequestModal();
        };
      }
    });

    // Update resident portal dashboard mini ID card if present
    const residentDashIdPhoto = document.getElementById("residentDashIdPhoto");
    const residentDashIdName = document.getElementById("residentDashIdName");
    const residentDashIdNumber = document.getElementById("residentDashIdNumber");
    const residentDashIdStatus = document.getElementById("residentDashIdStatus");
    if (residentDashIdName) residentDashIdName.textContent = activeResName.toUpperCase();
    if (residentDashIdNumber) residentDashIdNumber.textContent = getResidentItem("gv_resident_id") || "GV-2026-0001";
    if (residentDashIdStatus) {
      residentDashIdStatus.textContent = isRequested ? "● ACTIVE / VERIFIED" : "● PENDING VERIFICATION";
      residentDashIdStatus.style.color = isRequested ? "#4ade80" : "#fbbf24";
    }
    if (residentDashIdPhoto) {
      const noteEl = document.getElementById("residentDashPhotoNote");
      if (activePhoto) {
        residentDashIdPhoto.innerHTML = `<img src="${activePhoto}" alt="Photo" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`;
        if (noteEl) noteEl.style.display = "block";
      } else {
        residentDashIdPhoto.textContent = activeResInitials;
        if (noteEl) noteEl.style.display = "none";
      }
    }

    // Update digital ID official photo box
    const digitalPhotoBox = document.getElementById("digitalIdPhotoBox");
    if (digitalPhotoBox) {
      if (activePhoto) {
        digitalPhotoBox.innerHTML = `<img src="${activePhoto}" alt="Official ID Photo" onerror="this.style.display='none';this.parentElement.textContent='${activeResInitials}'">`;
      } else {
        digitalPhotoBox.innerHTML = `<span id="digitalIdPhotoInitials" style="font-size:24px; font-weight:800; color:#003366;">${activeResInitials}</span>`;
      }
    }

    // Direct 1x1 photo upload management on digital-id.html
    const photoUploadActions = document.getElementById("digitalPhotoUploadActions");
    const photoLockedNotice = document.getElementById("digitalPhotoLockedNotice");
    const photoLockBadge = document.getElementById("digitalPhotoLockBadge");
    const photoInstruction = document.getElementById("digitalPhotoInstruction");

    if (activePhoto && isPhotoLocked) {
      if (photoUploadActions) photoUploadActions.style.display = "none";
      if (photoLockedNotice) photoLockedNotice.style.display = "block";
      if (photoLockBadge) {
        photoLockBadge.textContent = "PHOTO LOCKED";
        photoLockBadge.className = "badge approved";
      }
      if (photoInstruction) {
        photoInstruction.textContent = "Your official 1x1 photo is locked on your Digital ID. To change or update your 1x1 photo, submit an ID Replacement Request.";
      }
    } else {
      if (photoUploadActions) photoUploadActions.style.display = "flex";
      if (photoLockedNotice) photoLockedNotice.style.display = "none";
      if (photoLockBadge) {
        photoLockBadge.textContent = activePhoto ? "SAVED (1-TIME)" : "ONE-TIME UPLOAD";
        photoLockBadge.className = "badge payment";
      }
    }

    // Update topbar avatar
    document.querySelectorAll(".top-user .avatar").forEach(avatar => {
      if (activePhoto) {
        avatar.innerHTML = `<img src="${activePhoto}" alt="${activeResInitials}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`;
      } else {
        avatar.innerHTML = activeResInitials;
      }
    });

    // Update physical-id photo preview if present and not currently staging a new preview
    if (idPhotoPreviewImgPhysical && !stagedPhysicalPhoto) {
      if (activePhoto) {
        idPhotoPreviewImgPhysical.src = activePhoto;
        idPhotoPreviewImgPhysical.style.display = "block";
        if (idPhotoPlaceholderPhysical) idPhotoPlaceholderPhysical.style.display = "none";
      } else {
        idPhotoPreviewImgPhysical.src = "";
        idPhotoPreviewImgPhysical.style.display = "none";
        if (idPhotoPlaceholderPhysical) idPhotoPlaceholderPhysical.style.display = "flex";
      }
    }

    // Update physical-id form controls and policy descriptions
    const idUploadHeadingPhysical = document.getElementById("idUploadHeadingPhysical");
    const idUploadSubtextPhysical = document.getElementById("idUploadSubtextPhysical");
    const physicalRequestType = document.getElementById("physicalRequestType");

    if (physicalRequestType) {
      const urlParams = new URLSearchParams(location.search);
      const reqParam = urlParams.get("type");
      if (reqParam === "replacement" || reqParam === "photo") {
        physicalRequestType.value = "ID Photo Update & Replacement";
      } else if (isRequested && physicalRequestType.value === "New Physical Barangay ID") {
        physicalRequestType.value = "ID Photo Update & Replacement";
      }
    }

    if (idUploadHeadingPhysical) {
      idUploadHeadingPhysical.textContent = isRequested 
        ? "Attach New Photo for ID Replacement (Takes effect upon approval)" 
        : "Attach ID Photo (Can change until saved)";
    }
    if (idUploadSubtextPhysical) {
      idUploadSubtextPhysical.textContent = isRequested
        ? "You can change or re-choose this image freely until you click Submit. Once submitted, your current active ID photo remains firm until the Barangay approves your replacement."
        : "You can replace or change this image as many times as you like before saving.";
    }

    // Update digital-id page elements if present
    const unrequestedBanner = document.getElementById("idUnrequestedBanner");
    const digitalIdStatusBadge = document.getElementById("digitalIdStatusBadge");
    const verifyStatusText = document.getElementById("verifyStatusText");
    const openIdRequestModalBtn = document.getElementById("openIdRequestModalBtn");

    if (unrequestedBanner) {
      unrequestedBanner.style.display = isRequested ? "none" : "block";
    }
    if (digitalIdStatusBadge) {
      digitalIdStatusBadge.textContent = isRequested ? "● ACTIVE" : "● UNISSUED • PENDING REQUEST";
      digitalIdStatusBadge.style.color = isRequested ? "var(--green)" : "var(--muted)";
    }
    if (verifyStatusText) {
      verifyStatusText.textContent = isRequested ? "ID is active & verified" : "Pending ID application";
    }

    if (openIdRequestModalBtn) {
      if (isRequested) {
        openIdRequestModalBtn.textContent = "Request ID Replacement / Photo Update";
        openIdRequestModalBtn.onclick = () => {
          location.href = "physical-id.html?type=replacement";
        };
      } else {
        openIdRequestModalBtn.textContent = "📷 Apply for Barangay ID & Attach Photo";
        openIdRequestModalBtn.onclick = () => {
          openIdRequestModal();
        };
      }
    }

    // Sync top-user name & avatar across all portal pages
    const activeResId = getResidentItem("gv_resident_id") || "GV-2026-0001";
    const activeResAddress = getResidentItem("gv_resident_address") || "Guadalupe Viejo, Makati City";
    const activeResMobile = getResidentItem("gv_resident_mobile") || "";
    const activeResDob = getResidentItem("gv_resident_dob") || "";
    const activeResGender = getResidentItem("gv_resident_gender") || "";
    const activeResCivil = getResidentItem("gv_resident_civil") || "";

    const initials = activeResInitials || "RU";

    document.querySelectorAll(".top-user strong").forEach(el => {
      el.textContent = activeResName;
    });
    const dashGreeting = document.querySelector(".page-heading h1");
    if (dashGreeting && dashGreeting.textContent.includes("Good day,")) {
      dashGreeting.textContent = `Good day, ${activeResName}!`;
    }

    // Update physical ID mini card info
    const physicalMiniName = document.getElementById("physicalMiniName");
    if (physicalMiniName) physicalMiniName.textContent = activeResName;
    const physicalMiniId = document.getElementById("physicalMiniId");
    if (physicalMiniId) physicalMiniId.textContent = activeResId;

    // ── Populate GVCID (old-style Constituent's ID Card) fields ──────────────
    const storedFirst = getResidentItem("gv_resident_first_name");
    const storedMiddle = getResidentItem("gv_resident_middle_name");
    const storedLast = getResidentItem("gv_resident_last_name");

    let givenName = "";
    let middlePart = "";
    let surnamePart = "";

    if (storedFirst || storedLast) {
      givenName = (storedFirst || "").toUpperCase();
      middlePart = (storedMiddle || "").toUpperCase();
      surnamePart = (storedLast || "").toUpperCase();
    } else {
      const fullNameUpper = activeResName.trim().toUpperCase();
      const parts = fullNameUpper.split(/\s+/).filter(Boolean);

      if (parts.length <= 1) {
        givenName = parts[0] || "";
        surnamePart = parts[0] || "";
      } else if (parts.length === 2) {
        givenName = parts[0];
        surnamePart = parts[1];
        middlePart = "";
      } else if (parts.length === 3) {
        if (["DELA", "DE", "DELOS", "SAN", "SANTA", "STA", "STA."].includes(parts[1])) {
          // e.g. Juan De La Cruz or Juan Dela Cruz -> givenName: Juan, surname: Dela Cruz, middle: empty
          givenName = parts[0];
          surnamePart = parts.slice(1).join(" ");
          middlePart = "";
        } else {
          // If 3 words, check if it's two given names or first + middle + last
          // By default, if middle name is optional, assume parts[0] + parts[1] is compound first name, or parts[1] is middle
          givenName = parts[0];
          middlePart = parts[1];
          surnamePart = parts[2];
        }
      } else {
        const pJoined = parts.join(" ");
        const matchCompound = pJoined.match(/(.+?)\s+((?:DE\s+LA|DELA|DELOS|SAN|SANTA|STA\.?)\s+[A-Z]+)$/i);
        if (matchCompound) {
          surnamePart = matchCompound[2];
          const rest = matchCompound[1].split(/\s+/);
          // Two first names e.g. "John Paul Dela Cruz"
          if (rest.length === 2) {
            givenName = rest.join(" ");
            middlePart = "";
          } else {
            givenName = rest.slice(0, rest.length - 1).join(" ");
            middlePart = rest[rest.length - 1];
          }
        } else {
          surnamePart = parts[parts.length - 1];
          middlePart = parts[parts.length - 2];
          givenName = parts.slice(0, parts.length - 2).join(" ");
        }
      }
    }

    const gvcidSurname    = document.getElementById("gvcidSurname");
    const gvcidGivenName  = document.getElementById("gvcidGivenName");
    const gvcidMiddleName = document.getElementById("gvcidMiddleName");
    const gvcidSex        = document.getElementById("gvcidSex");
    const gvcidDob        = document.getElementById("gvcidDob");
    const gvcidCivilStatus= document.getElementById("gvcidCivilStatus");
    const gvcidAddress    = document.getElementById("gvcidAddress");
    const gvcidIdNumber   = document.getElementById("gvcidIdNumber");
    const gvcidMyIdDisplay= document.getElementById("gvcidMyIdDisplay");
    const gvcidEmergName  = document.getElementById("gvcidEmergName");
    const gvcidEmergAddress=document.getElementById("gvcidEmergAddress");
    const gvcidEmergPhone = document.getElementById("gvcidEmergPhone");
    const gvcidDateIssued = document.getElementById("gvcidDateIssued");
    const gvcidValidUntil = document.getElementById("gvcidValidUntil");

    if (gvcidSurname)     gvcidSurname.textContent    = surnamePart || activeResName.toUpperCase();
    if (gvcidGivenName)   gvcidGivenName.textContent  = givenName || activeResName.toUpperCase();
    if (gvcidMiddleName)  gvcidMiddleName.textContent = middlePart ? middlePart : "—";
    if (gvcidSex)         gvcidSex.textContent        = (activeResGender || "MALE").toUpperCase();
    if (gvcidDob)         gvcidDob.textContent        = (activeResDob || "N/A").toUpperCase();
    if (gvcidCivilStatus) gvcidCivilStatus.textContent= (activeResCivil || "SINGLE").toUpperCase();
    if (gvcidAddress)     gvcidAddress.textContent    = activeResAddress.toUpperCase();
    if (gvcidIdNumber)    gvcidIdNumber.textContent   = activeResId;
    if (gvcidMyIdDisplay) gvcidMyIdDisplay.textContent= activeResId;

    // Back — emergency
    const emergName = getResidentItem("gv_resident_emergency_name");
    const emergPhone = getResidentItem("gv_resident_emergency_phone");
    if (gvcidEmergName)   gvcidEmergName.textContent  = (emergName || "BARANGAY HALL").toUpperCase();
    if (gvcidEmergAddress)gvcidEmergAddress.textContent = activeResAddress.toUpperCase();
    if (gvcidEmergPhone)  gvcidEmergPhone.textContent = emergPhone || "8470-0081";
    if (gvcidDateIssued) {
      const issueDate = new Date().toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric"});
      gvcidDateIssued.textContent = getResidentItem("gv_resident_issue_date") || issueDate;
    }
    if (gvcidValidUntil)  gvcidValidUntil.textContent = "December 31, 2027";

    // E-Signature
    const gvcidResidentSig = document.getElementById("gvcidResidentSig");
    if (gvcidResidentSig) {
      const savedSigImg = getResidentItem("gv_resident_sig_img");
      const savedSigText = getResidentItem("gv_resident_sig_text");
      if (savedSigImg) {
        gvcidResidentSig.innerHTML = `<img src="${savedSigImg}" alt="Resident E-Signature" class="gvcid-back-sig-img">`;
      } else if (savedSigText) {
        gvcidResidentSig.innerHTML = `<span class="gvcid-back-sig-text">${savedSigText}</span>`;
      } else {
        gvcidResidentSig.innerHTML = `<span class="gvcid-back-sig-text">${activeResName}</span>`;
      }
    }

    // ── GVCID ID Number Lookup (no QR) ───────────────────────────────────────
    const gvcidLookupBtn    = document.getElementById("gvcidLookupBtn");
    const gvcidLookupInput  = document.getElementById("gvcidLookupInput");
    const gvcidLookupResult = document.getElementById("gvcidLookupResult");

    async function runGvcidLookup() {
      if (!gvcidLookupInput || !gvcidLookupResult) return;
      const query = gvcidLookupInput.value.trim().toUpperCase().replace(/\s+/g, "");
      if (!query) return;

      gvcidLookupResult.style.display = "block";
      gvcidLookupResult.className = "gvcid-lookup-result";
      gvcidLookupResult.innerHTML = "Checking database records...";

      let match = null;
      if (window.eViejoDB && typeof window.eViejoDB.verifyResidentCredentials === "function") {
        const { data } = await window.eViejoDB.verifyResidentCredentials(query);
        if (data) match = data;
      }

      if (match) {
        gvcidLookupResult.className = "gvcid-lookup-result found";
        gvcidLookupResult.innerHTML = `✔ ID FOUND IN DATABASE — <strong>${match.full_name}</strong><br>ID No: <strong>${match.resident_id_no || match.id}</strong><br>Status: <strong>${match.is_verified ? "ACTIVE / VERIFIED" : "REGISTERED"}</strong><br>Barangay: ${match.address || "Guadalupe Viejo, Makati City"}`;
      } else {
        gvcidLookupResult.className = "gvcid-lookup-result notfound";
        gvcidLookupResult.innerHTML = `✘ ID NOT FOUND<br><span style="font-weight:400;font-size:11px;">No record found for <strong>${query}</strong>. Please verify the ID number and try again.</span>`;
      }
    }

    gvcidLookupBtn?.addEventListener("click", runGvcidLookup);
    gvcidLookupInput?.addEventListener("keydown", e => { if (e.key === "Enter") runGvcidLookup(); });

    // ── Profile page fields population ──
    const profileHeadName = document.getElementById("profileHeadName");
    const profileHeadId = document.getElementById("profileHeadId");
    const profileHeadAvatar = document.getElementById("profileHeadAvatar");
    const profileInputName = document.getElementById("profileInputName");
    const profileInputEmail = document.getElementById("profileInputEmail");
    const profileInputMobile = document.getElementById("profileInputMobile");
    const profileInputAddress = document.getElementById("profileInputAddress");
    const saveProfileBtn = document.getElementById("saveProfileBtn");

    if (profileHeadName) profileHeadName.textContent = activeResName;
    if (profileHeadId) profileHeadId.textContent = `${activeResId} • Verified Resident`;
    if (profileHeadAvatar) profileHeadAvatar.textContent = initials;
    if (profileInputName && !profileInputName.value) profileInputName.value = activeResName;
    if (profileInputEmail && !profileInputEmail.value) profileInputEmail.value = localStorage.getItem("gv_resident_email") || "";
    if (profileInputMobile && !profileInputMobile.value) profileInputMobile.value = activeResMobile;
    if (profileInputAddress && !profileInputAddress.value) profileInputAddress.value = activeResAddress;

    const profileInputDob = document.getElementById("profileInputDob");
    const profileInputGender = document.getElementById("profileInputGender");
    const profileInputCivilStatus = document.getElementById("profileInputCivilStatus");
    const profileInputEmergencyName = document.getElementById("profileInputEmergencyName");
    const profileInputEmergencyPhone = document.getElementById("profileInputEmergencyPhone");
    
    if (profileInputDob) profileInputDob.value = getResidentItem("gv_resident_dob") || "";
    if (profileInputGender) profileInputGender.value = getResidentItem("gv_resident_gender") || "";
    if (profileInputCivilStatus) profileInputCivilStatus.value = getResidentItem("gv_resident_civil") || getResidentItem("gv_resident_civil_status") || "";
    if (profileInputEmergencyName) profileInputEmergencyName.value = getResidentItem("gv_resident_emergency_name") || "";
    if (profileInputEmergencyPhone) profileInputEmergencyPhone.value = getResidentItem("gv_resident_emergency_phone") || "";

    saveProfileBtn?.addEventListener("click", () => {
      const newName = profileInputName?.value.trim() || activeResName;
      const newEmail = profileInputEmail?.value.trim() || "";
      const newMobile = profileInputMobile?.value.trim() || "";
      const newAddr = profileInputAddress?.value.trim() || activeResAddress;
      const newDob = profileInputDob ? profileInputDob.value : "";
      const newGender = profileInputGender ? profileInputGender.value : "";
      const newCivil = profileInputCivilStatus ? profileInputCivilStatus.value : "";
      const newEmergName = profileInputEmergencyName ? profileInputEmergencyName.value.trim() : "";
      const newEmergPhone = profileInputEmergencyPhone ? profileInputEmergencyPhone.value.trim() : "";

      setResidentSession("gv_resident_name", newName);
      setResidentSession("gv_resident_email", newEmail);
      setResidentSession("gv_resident_mobile", newMobile);
      setResidentSession("gv_resident_address", newAddr);
      if (newDob) setResidentSession("gv_resident_dob", newDob);
      if (newGender) setResidentSession("gv_resident_gender", newGender);
      if (newCivil) setResidentSession("gv_resident_civil", newCivil);
      if (newEmergName) setResidentSession("gv_resident_emergency_name", newEmergName);
      if (newEmergPhone) setResidentSession("gv_resident_emergency_phone", newEmergPhone);

      if (profileHeadName) profileHeadName.textContent = newName;
      
      // Keep RESIDENTS_DATA in sync if the resident exists
      if (RESIDENTS_DATA && RESIDENTS_DATA[activeResId]) {
        RESIDENTS_DATA[activeResId].name = newName;
        RESIDENTS_DATA[activeResId].email = newEmail;
        RESIDENTS_DATA[activeResId].phone = newMobile;
        RESIDENTS_DATA[activeResId].address = newAddr;
        if (newDob) RESIDENTS_DATA[activeResId].dob = newDob;
        if (newGender) RESIDENTS_DATA[activeResId].gender = newGender;
        if (newEmergName) RESIDENTS_DATA[activeResId].emergencyName = newEmergName;
        saveResidentsData();
      }

      // Keep local resident account in sync
      try {
        const accounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
        const accIdx = accounts.findIndex(a => (a.full_name || a.name) === activeResName || a.id === activeResId);
        if (accIdx >= 0) {
          accounts[accIdx].name = newName;
          accounts[accIdx].full_name = newName;
          accounts[accIdx].email = newEmail;
          accounts[accIdx].phone = newMobile;
          accounts[accIdx].address = newAddr;
          if (newDob) accounts[accIdx].dob = newDob;
          if (newGender) accounts[accIdx].gender = newGender;
          if (newCivil) accounts[accIdx].civil_status = newCivil;
          if (newEmergName) accounts[accIdx].emergency_name = newEmergName;
          if (newEmergPhone) accounts[accIdx].emergency_phone = newEmergPhone;
          localStorage.setItem("eViejoResidentAccounts", JSON.stringify(accounts));
        }
      } catch(e) {}

      toast("Profile details updated successfully.");
    });

    const changePasswordBtn = document.getElementById("changePasswordBtn");
    changePasswordBtn?.addEventListener("click", () => {
      const curPwd = document.getElementById("profileInputCurrentPassword")?.value || "";
      const newPwd = document.getElementById("profileInputNewPassword")?.value || "";
      
      if (!curPwd || !newPwd) {
        toast("Please fill in both current and new passwords.");
        return;
      }
      
      // Update in local accounts registry
      const localAccounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
      const matchIndex = localAccounts.findIndex(a => a.name === activeResName || a.resident_id_no === activeResId);
      
      if (matchIndex !== -1) {
        if (localAccounts[matchIndex].password && localAccounts[matchIndex].password !== curPwd) {
          toast("Current password is incorrect.");
          return;
        }
        localAccounts[matchIndex].password = newPwd;
        localStorage.setItem("eViejoResidentAccounts", JSON.stringify(localAccounts));
        document.getElementById("profileInputCurrentPassword").value = "";
        document.getElementById("profileInputNewPassword").value = "";
        toast("Password updated successfully.");
      } else {
        toast("Could not update password. Account not found in local registry.");
      }
    });
  }

  // 3D FLIPPABLE ID CARD (Old Brgy ID Template Style)


const digitalIdInner = document.getElementById("digitalIdInner");

const flipCardBtnFront = document.getElementById("flipCardBtnFront");

const flipCardBtnBack = document.getElementById("flipCardBtnBack");


// Always show the FRONT when the Digital ID page opens
if (digitalIdInner) {
  digitalIdInner.classList.remove("is-flipped");
}


function toggleDigitalIdFlip(e) {

  if (e) {

    // Don't flip when clicking the resident photo
    if (e.target.closest("#digitalIdPhotoBox")) return;

    // Don't flip when clicking normal links/buttons
    // Allow the dedicated flip button
    if (
      e.target.closest("a") ||
      (
        e.target.closest("button") &&
        !e.target.closest(".id-flip-pill")
      )
    ) return;

  }

  if (digitalIdInner) {

    digitalIdInner.classList.toggle("is-flipped");

    const isBack =
      digitalIdInner.classList.contains("is-flipped");

    toast(
      isBack
        ? "↻ Flipped to Back (Emergency & Residential Records)"
        : "↺ Flipped to Front (Official Digital ID)"
    );

  }

}

  digitalIdInner?.addEventListener("click", toggleDigitalIdFlip);
  flipCardBtnFront?.addEventListener("click", e => {
    e.stopPropagation();
    toggleDigitalIdFlip();
  });
  flipCardBtnBack?.addEventListener("click", e => {
    e.stopPropagation();
    toggleDigitalIdFlip();
  });

  // Handle ID Request Form Submission (initial application modal)
  idRequestForm?.addEventListener("submit", e => {
    e.preventDefault();
    const isAlreadyRequested = getResidentItem("gv_id_requested") === "true";

    const fullNameVal = document.getElementById("reqFullName")?.value.trim() || currentResident();
    const dobVal = document.getElementById("reqDob")?.value.trim() || "";
    const genderCivilVal = document.getElementById("reqGenderCivil")?.value || "";
    const phoneVal = document.getElementById("reqPhone")?.value.trim() || "";
    const addressVal = document.getElementById("reqAddress")?.value.trim() || "";
    const emergNameVal = document.getElementById("reqEmergencyName")?.value.trim() || "";
    const emergPhoneVal = document.getElementById("reqEmergencyPhone")?.value.trim() || "";

    // Parse Gender and Civil Status
    let genderVal = "Male";
    let civilVal = "Single";
    if (genderCivilVal) {
      const gparts = genderCivilVal.split("•").map(s => s.trim());
      genderVal = gparts[0] || genderCivilVal;
      civilVal = gparts[1] || (genderCivilVal.includes("Married") ? "Married" : "Single");
    }

    // Save E-Signature (eGovPH Flow)
    const canvas = document.getElementById("esignCanvas");
    const typeSigInput = document.getElementById("typeSigInput");
    const isDrawActive = document.getElementById("tabDrawSig")?.classList.contains("active");

    let savedSigImg = getResidentItem("gv_resident_sig_img");
    let savedSigText = getResidentItem("gv_resident_sig_text");

    if (isDrawActive && esignHasDrawn && canvas) {
      savedSigImg = canvas.toDataURL("image/png");
      savedSigText = "";
    } else if (typeSigInput && typeSigInput.value.trim()) {
      savedSigText = typeSigInput.value.trim();
      savedSigImg = "";
    }

    if (!isAlreadyRequested) {
      // FIRST TIME USER REGISTRATION FOR DIGITAL ID:
      // Can edit/enter details, upload photo, and affix signature ONCE.
      setResidentSession("gv_id_requested", "true");
      setResidentSession("gv_resident_photo_locked", "true");

      if (tempPhotoDataUrl) {
        setResidentSession("gv_resident_photo", tempPhotoDataUrl);
      }
      if (savedSigImg) {
        setResidentSession("gv_resident_sig_img", savedSigImg);
        setResidentSession("gv_resident_sig_text", "");
      } else if (savedSigText) {
        setResidentSession("gv_resident_sig_text", savedSigText);
        setResidentSession("gv_resident_sig_img", "");
      }

      // Save resident details directly into session and accounts
      if (fullNameVal) setResidentSession("gv_resident_name", fullNameVal);
      if (dobVal) setResidentSession("gv_resident_dob", dobVal);
      if (phoneVal) setResidentSession("gv_resident_mobile", phoneVal);
      if (addressVal) setResidentSession("gv_resident_address", addressVal);
      setResidentSession("gv_resident_gender", genderVal);
      setResidentSession("gv_resident_civil", civilVal);
      if (emergNameVal) setResidentSession("gv_resident_emergency_name", emergNameVal);
      if (emergPhoneVal) setResidentSession("gv_resident_emergency_phone", emergPhoneVal);

      // Sync into local accounts registry
      try {
        const accounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
        const curName = currentResident();
        const curId = getResidentItem("gv_resident_id");
        const accIdx = accounts.findIndex(a => (a.full_name || a.name) === curName || a.id === curId);
        if (accIdx >= 0) {
          if (fullNameVal) { accounts[accIdx].full_name = fullNameVal; accounts[accIdx].name = fullNameVal; }
          if (dobVal) accounts[accIdx].dob = dobVal;
          if (phoneVal) accounts[accIdx].phone = phoneVal;
          if (addressVal) accounts[accIdx].address = addressVal;
          accounts[accIdx].gender = genderVal;
          accounts[accIdx].civil_status = civilVal;
          if (emergNameVal) accounts[accIdx].emergency_name = emergNameVal;
          if (emergPhoneVal) accounts[accIdx].emergency_phone = emergPhoneVal;
          if (tempPhotoDataUrl) accounts[accIdx].photo = tempPhotoDataUrl;
          accounts[accIdx].id_requested = true;
          localStorage.setItem("eViejoResidentAccounts", JSON.stringify(accounts));
        }
      } catch(err){}

      // Check if user also opted for physical PVC ID card
      const alsoPhysical = document.getElementById("optInPhysicalId")?.checked;
      if (alsoPhysical) {
        const requests = getRequests();
        const next = Math.max(...requests.map(r => parseInt((r.id || "").split("-").pop()) || 0), 129) + 1;
        const req = {
          id: `REQ-2026-${String(next).padStart(5, "0")}`,
          resident: fullNameVal,
          residentId: getResidentItem("gv_resident_id") || "GV-2026-0001",
          document: "Physical Barangay ID Card (PVC)",
          purpose: "Official Identification (Printed Card)",
          date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          status: "Pending",
          payment: "Pending",
          pickup: "Claim at Barangay Hall",
          pendingPhoto: tempPhotoDataUrl || null
        };
        requests.unshift(req);
        saveRequests(requests);
        if (window.eViejoDB && typeof window.eViejoDB.createRequest === "function") {
          window.eViejoDB.createRequest(req);
        }
      }

      closeIdRequestModal();
      updateResidentPhotoUI();

      toast(
        alsoPhysical
          ? "Digital ID is now active and locked! Physical PVC ID request submitted for Barangay approval."
          : "Digital ID activated successfully! Your official ID details and photo are now firmly set."
      );
    } else {
      // USER ALREADY HAS DIGITAL ID (LOCKED):
      // Revisions are NOT applied directly. Must be submitted as a request for Barangay Admin approval!
      const requests = getRequests();
      const next = Math.max(...requests.map(r => parseInt((r.id || "").split("-").pop()) || 0), 129) + 1;
      const req = {
        id: `REQ-2026-${String(next).padStart(5, "0")}`,
        resident: currentResident(),
        residentId: getResidentItem("gv_resident_id") || "GV-2026-0001",
        contact: phoneVal || getResidentItem("gv_resident_mobile") || "",
        email: getResidentItem("gv_resident_email") || "",
        address: addressVal || getResidentItem("gv_resident_address") || "",
        dob: dobVal || getResidentItem("gv_resident_dob") || "",
        civilStatus: civilVal || getResidentItem("gv_resident_civil") || "",
        document: "Barangay ID Information & Photo Update",
        purpose: "Correction / Update of Constituent Records",
        date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        status: "Pending",
        payment: "Free",
        pickup: "Barangay Hall Records",
        pendingPhoto: tempPhotoDataUrl || null,
        pendingInfo: {
          name: fullNameVal,
          dob: dobVal,
          gender: genderVal,
          civilStatus: civilVal,
          phone: phoneVal,
          address: addressVal,
          emergencyName: emergNameVal,
          emergencyPhone: emergPhoneVal
        }
      };
      requests.unshift(req);
      saveRequests(requests);
      if (window.eViejoDB && typeof window.eViejoDB.createRequest === "function") {
        window.eViejoDB.createRequest(req);
      }

      closeIdRequestModal();
      toast("ID update request submitted! Revisions will take effect once approved by Barangay Admin.");
    }
  });

  // Physical ID 3D Flippable Card Review & Submission Workflow
  const physicalForm = document.getElementById("physicalForm");
  const physicalIdReviewModal = document.getElementById("physicalIdReviewModal");
  const closePhysicalReviewModal = document.getElementById("closePhysicalReviewModal");
  const cancelPhysicalReviewModal = document.getElementById("cancelPhysicalReviewModal");
  const confirmPhysicalSubmitBtn = document.getElementById("confirmPhysicalSubmitBtn");
  const physicalReviewInner = document.getElementById("physicalReviewInner");
  const revFlipBtnFront = document.getElementById("revFlipBtnFront");
  const revFlipBtnBack = document.getElementById("revFlipBtnBack");

  function togglePhysicalReviewFlip() {
    if (physicalReviewInner) {
      physicalReviewInner.classList.toggle("is-flipped");
    }
  }

  physicalReviewInner?.addEventListener("click", e => {
    if (e.target.closest("#revIdPhotoBox") || (e.target.closest("button") && !e.target.closest(".id-flip-pill"))) return;
    togglePhysicalReviewFlip();
  });
  revFlipBtnFront?.addEventListener("click", e => { e.stopPropagation(); togglePhysicalReviewFlip(); });
  revFlipBtnBack?.addEventListener("click", e => { e.stopPropagation(); togglePhysicalReviewFlip(); });

  function closePhysicalReview() {
    physicalIdReviewModal?.classList.add("hidden");
    if (physicalReviewInner) physicalReviewInner.classList.remove("is-flipped");
  }

  closePhysicalReviewModal?.addEventListener("click", closePhysicalReview);
  cancelPhysicalReviewModal?.addEventListener("click", closePhysicalReview);

  // When resident clicks "Submit Physical ID Request", show 3D Flippable ID popup to ensure all details are correct
  physicalForm?.addEventListener("submit", e => {
    e.preventDefault();

    if (!physicalIdReviewModal) {
      // Fallback if modal not present
      executePhysicalIdSubmission();
      return;
    }

    // Populate the review modal's flippable digital ID card
    const activeResName = currentResident();
    const activeResId = getResidentItem("gv_resident_id") || "GV-2026-0001";
    const activeResDob = getResidentItem("gv_resident_dob") || "1990-06-14";
    const activeResAddress = getResidentItem("gv_resident_address") || "Guadalupe Viejo, Makati City";
    const activeResGender = getResidentItem("gv_resident_gender") || "MALE";
    const activeResCivil = getResidentItem("gv_resident_civil") || "SINGLE";
    const activePhoto = stagedPhysicalPhoto || localStorage.getItem("gv_resident_photo") || "";
    const activeResInitials = (activeResName.split(/\s+/).map(p => p[0]).join("") || "ID").slice(0, 2).toUpperCase();

    const revPhotoBox = document.getElementById("revIdPhotoBox");
    if (revPhotoBox) {
      if (activePhoto) {
        revPhotoBox.innerHTML = `<img src="${activePhoto}" alt="Photo" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`;
      } else {
        revPhotoBox.innerHTML = `<span style="font-size:24px;font-weight:800;color:#003366;">${activeResInitials}</span>`;
      }
    }

    const storedFirst = getResidentItem("gv_resident_first_name");
    const storedMiddle = getResidentItem("gv_resident_middle_name");
    const storedLast = getResidentItem("gv_resident_last_name");

    let givenName = "";
    let middlePart = "";
    let surnamePart = "";

    if (storedFirst || storedLast) {
      givenName = (storedFirst || "").toUpperCase();
      middlePart = (storedMiddle || "").toUpperCase();
      surnamePart = (storedLast || "").toUpperCase();
    } else {
      const fullNameUpper = activeResName.trim().toUpperCase();
      const parts = fullNameUpper.split(/\s+/).filter(Boolean);

      if (parts.length <= 1) {
        givenName = parts[0] || "";
        surnamePart = parts[0] || "";
      } else if (parts.length === 2) {
        givenName = parts[0];
        surnamePart = parts[1];
        middlePart = "";
      } else if (parts.length === 3) {
        if (["DELA", "DE", "DELOS", "SAN", "SANTA", "STA", "STA."].includes(parts[1])) {
          givenName = parts[0];
          surnamePart = parts.slice(1).join(" ");
          middlePart = "";
        } else {
          givenName = parts[0];
          middlePart = parts[1];
          surnamePart = parts[2];
        }
      } else {
        const pJoined = parts.join(" ");
        const matchCompound = pJoined.match(/(.+?)\s+((?:DE\s+LA|DELA|DELOS|SAN|SANTA|STA\.?)\s+[A-Z]+)$/i);
        if (matchCompound) {
          surnamePart = matchCompound[2];
          const rest = matchCompound[1].split(/\s+/);
          if (rest.length === 2) {
            givenName = rest.join(" ");
            middlePart = "";
          } else {
            givenName = rest.slice(0, rest.length - 1).join(" ");
            middlePart = rest[rest.length - 1];
          }
        } else {
          surnamePart = parts[parts.length - 1];
          middlePart = parts[parts.length - 2];
          givenName = parts.slice(0, parts.length - 2).join(" ");
        }
      }
    }

    const revSurname = document.getElementById("revSurname");
    const revGivenName = document.getElementById("revGivenName");
    const revMiddleName = document.getElementById("revMiddleName");
    const revSex = document.getElementById("revSex");
    const revDob = document.getElementById("revDob");
    const revCivilStatus = document.getElementById("revCivilStatus");
    const revAddress = document.getElementById("revAddress");
    const revIdNumber = document.getElementById("revIdNumber");
    const revEmergName = document.getElementById("revEmergName");
    const revEmergAddress = document.getElementById("revEmergAddress");
    const revEmergPhone = document.getElementById("revEmergPhone");
    const revResidentSig = document.getElementById("revResidentSig");

    if (revSurname) revSurname.textContent = surnamePart || activeResName.toUpperCase();
    if (revGivenName) revGivenName.textContent = givenName || activeResName.toUpperCase();
    if (revMiddleName) revMiddleName.textContent = middlePart ? middlePart : "—";
    if (revSex) revSex.textContent = (activeResGender || "MALE").toUpperCase();
    if (revDob) revDob.textContent = (activeResDob || "N/A").toUpperCase();
    if (revCivilStatus) revCivilStatus.textContent = (activeResCivil || "SINGLE").toUpperCase();
    if (revAddress) revAddress.textContent = activeResAddress.toUpperCase();
    if (revIdNumber) revIdNumber.textContent = activeResId;

    const emergName = getResidentItem("gv_resident_emergency_name");
    const emergPhone = getResidentItem("gv_resident_emergency_phone");
    if (revEmergName) revEmergName.textContent = (emergName || "BARANGAY HALL").toUpperCase();
    if (revEmergAddress) revEmergAddress.textContent = activeResAddress.toUpperCase();
    if (revEmergPhone) revEmergPhone.textContent = emergPhone || "8470-0081";

    if (revResidentSig) {
      const savedSigImg = getResidentItem("gv_resident_sig_img");
      const savedSigText = getResidentItem("gv_resident_sig_text");
      if (savedSigImg) {
        revResidentSig.innerHTML = `<img src="${savedSigImg}" alt="Signature" class="gvcid-back-sig-img">`;
      } else if (savedSigText) {
        revResidentSig.innerHTML = `<span class="gvcid-back-sig-text">${savedSigText}</span>`;
      } else {
        revResidentSig.innerHTML = `<span class="gvcid-back-sig-text">${activeResName}</span>`;
      }
    }

    if (physicalReviewInner) physicalReviewInner.classList.remove("is-flipped");
    physicalIdReviewModal.classList.remove("hidden");
  });

  function executePhysicalIdSubmission() {
    const isAlreadyRequested = getResidentItem("gv_id_requested") === "true";
    const reqTypeSelect = document.getElementById("physicalRequestType");
    const selectedDoc = reqTypeSelect?.value || "Barangay ID Application (Digital & Physical)";

    const requests = getRequests();
    const next = Math.max(...requests.map(r => parseInt((r.id || "").split("-").pop()) || 0), 129) + 1;
    const req = {
      id: `REQ-2026-${String(next).padStart(5, "0")}`,
      resident: currentResident(),
      residentId: getResidentItem("gv_resident_id") || "GV-2026-0001",
      contact: getResidentItem("gv_resident_mobile") || "",
      email: getResidentItem("gv_resident_email") || "",
      address: getResidentItem("gv_resident_address") || "Guadalupe Viejo, Makati City",
      dob: getResidentItem("gv_resident_dob") || "",
      civilStatus: getResidentItem("gv_resident_civil") || "Single",
      document: selectedDoc,
      purpose: "Official Identification (Printed Card)",
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      status: "Pending",
      payment: "Pending",
      pickup: "Claim at Barangay Hall",
      pendingPhoto: stagedPhysicalPhoto || null
    };

    requests.unshift(req);
    saveRequests(requests);

    if (window.eViejoDB && typeof window.eViejoDB.createRequest === "function") {
      window.eViejoDB.createRequest(req);
    }

    closePhysicalReview();
    stagedPhysicalPhoto = "";
    toast("Physical ID request submitted! Awaiting Barangay Admin approval and printing.");
    setTimeout(() => {
      location.href = "tracker.html";
    }, 900);
  }

  confirmPhysicalSubmitBtn?.addEventListener("click", () => {
    executePhysicalIdSubmission();
  });

  // First time popup trigger:
  // If user visits digital-id.html or physical-id.html and has never registered their ID yet:
  const isFirstTimeId = getResidentItem("gv_id_requested") !== "true";
  const isIdPage = location.pathname.includes("digital-id.html");
  if (isFirstTimeId && isIdPage && requestIdModal) {
    setTimeout(() => {
      openIdRequestModal();
    }, 400);
  }

  // Run UI update on initial load
  updateResidentPhotoUI();

  // Admin table direct approve button with auto-update
  document.querySelectorAll(".approve").forEach(btn=>btn.addEventListener("click",()=>{
    const row=btn.closest("tr")||btn.closest(".request-item");
    const badge=row?.querySelector(".badge");
    if(badge){badge.textContent="Approved";badge.className="badge approved";}
    btn.textContent="Approved";btn.disabled=true;
    const reqId = row?.querySelector("td")?.textContent.trim();
    const items = getRequests();
    const matched = items.find(r => r.id === reqId);
    let photoNotice = "";
    if (matched) {
      matched.status = "Approved";
      if (matched.pendingPhoto) {
        setResidentSession("gv_resident_photo", matched.pendingPhoto);
        if (RESIDENTS_DATA && RESIDENTS_DATA["GV-2026-000123"]) {
          RESIDENTS_DATA["GV-2026-000123"].photo = matched.pendingPhoto;
        }
        photoNotice += " Resident ID photo automatically updated!";
      }
      if (matched.pendingInfo) {
        const info = matched.pendingInfo;
        try {
          const accounts = JSON.parse(localStorage.getItem("eViejoResidentAccounts") || "[]");
          const accIdx = accounts.findIndex(a => (a.full_name || a.name) === matched.resident || a.id === matched.residentId);
          if (accIdx >= 0) {
            if (info.name) { accounts[accIdx].full_name = info.name; accounts[accIdx].name = info.name; }
            if (info.dob) accounts[accIdx].dob = info.dob;
            if (info.phone) accounts[accIdx].phone = info.phone;
            if (info.address) accounts[accIdx].address = info.address;
            if (info.gender) accounts[accIdx].gender = info.gender;
            if (info.civilStatus) accounts[accIdx].civil_status = info.civilStatus;
            if (info.emergencyName) accounts[accIdx].emergency_name = info.emergencyName;
            if (info.emergencyPhone) accounts[accIdx].emergency_phone = info.emergencyPhone;
            if (matched.pendingPhoto) accounts[accIdx].photo = matched.pendingPhoto;
            localStorage.setItem("eViejoResidentAccounts", JSON.stringify(accounts));
          }
        } catch(e){}

        if (currentResident() === matched.resident || getResidentItem("gv_resident_id") === matched.residentId) {
          if (info.name) setResidentSession("gv_resident_name", info.name);
          if (info.dob) setResidentSession("gv_resident_dob", info.dob);
          if (info.phone) setResidentSession("gv_resident_mobile", info.phone);
          if (info.address) setResidentSession("gv_resident_address", info.address);
          if (info.gender) setResidentSession("gv_resident_gender", info.gender);
          if (info.civilStatus) setResidentSession("gv_resident_civil", info.civilStatus);
          if (info.emergencyName) setResidentSession("gv_resident_emergency_name", info.emergencyName);
          if (info.emergencyPhone) setResidentSession("gv_resident_emergency_phone", info.emergencyPhone);
        }
        photoNotice += " Resident information updated!";
      }
      saveRequests(items);
    }
    toast(`Request approved.${photoNotice}`);
  }));
  /* ========================================================
     INCIDENT REPORTS MANAGEMENT (Automated & Modal Workflow)
     ======================================================== */
  const STORE_INCIDENTS = "eViejoIncidents";
  const seedIncidents = [
    {
      id: "INC-2026-0041",
      type: "Noise Complaint",
      complainant: "Corazon Mendoza",
      contact: "0917 555 8192",
      location: "145 P. Burgos St.",
      reported: "May 15, 2026 • 10:30 PM",
      status: "New",
      assignedOfficer: "Unassigned",
      notes: "Resident reported loud karaoke past midnight near corner store. Needs peace and order officer dispatch.",
      history: [
        { date: "May 15, 2026 • 10:30 PM", text: "Incident blotter filed by Corazon Mendoza." }
      ]
    },
    {
      id: "INC-2026-0040",
      type: "Traffic Violation & Obstruction",
      complainant: "Brgy. Patrol Tanod",
      contact: "Barangay Radio Net",
      location: "Guadalupe Viejo Bridge Access Road",
      reported: "May 15, 2026 • 03:15 PM",
      status: "Investigating",
      assignedOfficer: "Officer Juan Reyes",
      notes: "Commercial delivery van blocking intersection. Officer Reyes dispatched on site for traffic flow redirection.",
      history: [
        { date: "May 15, 2026 • 03:15 PM", text: "Reported by Patrol Tanod." },
        { date: "May 15, 2026 • 03:25 PM", text: "Assigned to Officer Juan Reyes (Status: Investigating)." }
      ]
    },
    {
      id: "INC-2026-0039",
      type: "Illegal Parking",
      complainant: "Eduardo Ramos",
      contact: "0922 411 9081",
      location: "J.P. Rizal Ext. (near Chapel)",
      reported: "May 14, 2026 • 09:00 AM",
      status: "Resolved",
      assignedOfficer: "Officer Maria Cruz",
      notes: "Vehicles parked on pedestrian walkway. Officer Cruz issued warnings and vehicle owners relocated immediately.",
      history: [
        { date: "May 14, 2026 • 09:00 AM", text: "Report filed by Eduardo Ramos." },
        { date: "May 14, 2026 • 09:30 AM", text: "Officer Maria Cruz responded on site." },
        { date: "May 14, 2026 • 10:15 AM", text: "Obstruction cleared. Case marked Resolved." }
      ]
    },
    {
      id: "INC-2026-0038",
      type: "Neighborhood Dispute",
      complainant: "Teresa Valenzuela",
      contact: "0918 322 1099",
      location: "45 Clover St.",
      reported: "May 13, 2026 • 04:45 PM",
      status: "Under Review",
      assignedOfficer: "Officer Alex Santos",
      notes: "Dispute regarding property boundary fence and pet disturbance. Lupon Tagapamayapa mediation scheduled.",
      history: [
        { date: "May 13, 2026 • 04:45 PM", text: "Complaint received by Barangay Desk." },
        { date: "May 14, 2026 • 08:30 AM", text: "Referred to Lupon and assigned to Officer Alex Santos." }
      ]
    },
    {
      id: "INC-2026-0037",
      type: "Waste Disposal Non-Compliance",
      complainant: "Sanitation Committee",
      contact: "Barangay Office",
      location: "Cor. Burgos & Coronado St.",
      reported: "May 12, 2026 • 08:20 AM",
      status: "Resolved",
      assignedOfficer: "Officer Mark Ramos",
      notes: "Improper commercial waste dumped on sidewalk. Offender identified, notice of violation issued, sidewalk cleared.",
      history: [
        { date: "May 12, 2026 • 08:20 AM", text: "Sanitation inspection notice recorded." },
        { date: "May 12, 2026 • 11:00 AM", text: "Sidewalk cleared. Notice served by Officer Mark Ramos." }
      ]
    },
    {
      id: "INC-2026-0036",
      type: "Streetlight Outage & Hazard",
      complainant: "Rolando Dizon",
      contact: "0915 889 2033",
      location: "Clover St. Alley 2",
      reported: "May 11, 2026 • 07:15 PM",
      status: "Closed",
      assignedOfficer: "Officer Roberto Bautista",
      notes: "Two streetlights malfunctioning creating dark spot. Meralco & City Engineering coordination completed. Lights replaced.",
      history: [
        { date: "May 11, 2026 • 07:15 PM", text: "Report filed by resident." },
        { date: "May 12, 2026 • 02:00 PM", text: "Meralco work order coordinated by Officer Roberto Bautista." },
        { date: "May 13, 2026 • 06:00 PM", text: "Work verified complete. Case closed." }
      ]
    }
  ];

  function getIncidents() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_INCIDENTS));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch(e){}
    localStorage.setItem(STORE_INCIDENTS, JSON.stringify(seedIncidents));
    return [...seedIncidents];
  }

  function saveIncidents(items) {
    localStorage.setItem(STORE_INCIDENTS, JSON.stringify(items));
  }

  // Elements in admin/incidents.html
  const incidentsTableBody = document.getElementById("incidentsTableBody");
  const incidentSearchInput = document.getElementById("incidentSearchInput");
  const incidentFilterStatus = document.getElementById("incidentFilterStatus");
  const incidentFilterOfficer = document.getElementById("incidentFilterOfficer");

  // Details Modal elements
  const incidentDetailsModal = document.getElementById("incidentDetailsModal");
  const closeIncidentModalBtn = document.getElementById("closeIncidentModalBtn");
  const cancelIncidentModalBtn = document.getElementById("cancelIncidentModalBtn");
  const incidentUpdateForm = document.getElementById("incidentUpdateForm");

  // Modal Details fields
  const incModalTargetId = document.getElementById("incModalTargetId");
  const incModalTypeTitle = document.getElementById("incModalTypeTitle");
  const incModalId = document.getElementById("incModalId");
  const incModalStatusBadge = document.getElementById("incModalStatusBadge");
  const incModalDate = document.getElementById("incModalDate");
  const incModalLocation = document.getElementById("incModalLocation");
  const incModalComplainant = document.getElementById("incModalComplainant");
  const incModalContact = document.getElementById("incModalContact");
  const incModalDescription = document.getElementById("incModalDescription");
  const incModalOfficerSelect = document.getElementById("incModalOfficerSelect");
  const incModalStatusSelect = document.getElementById("incModalStatusSelect");
  const incModalNotesInput = document.getElementById("incModalNotesInput");
  const incModalHistoryList = document.getElementById("incModalHistoryList");

  // Add Incident Modal elements
  const addIncidentModal = document.getElementById("addIncidentModal");
  const openAddIncidentBtn = document.getElementById("openAddIncidentBtn");
  const closeAddIncidentModalBtn = document.getElementById("closeAddIncidentModalBtn");
  const cancelAddIncidentBtn = document.getElementById("cancelAddIncidentBtn");
  const addIncidentForm = document.getElementById("addIncidentForm");

  function renderIncidentsTable() {
    const list = getIncidents();

    // Update dashboard incident count stat (admin/index.html)
    const dashIncidentCount = document.getElementById("dashIncidentCount");
    if (dashIncidentCount) {
      const open = list.filter(i => i.status !== "Resolved" && i.status !== "Closed").length;
      dashIncidentCount.textContent = open;
    }

    // Also update the "Recent Incidents" panel on admin/index.html
    const dashIncidentList = document.getElementById("dashIncidentList");
    if (dashIncidentList) {
      dashIncidentList.innerHTML = list.slice(0, 4).map(inc => `
        <article>
          <strong>${esc(inc.type)}</strong>
          <small>${esc(inc.location)} &bull; ${esc(inc.id)} &bull; ${inc.assignedOfficer && inc.assignedOfficer !== "Unassigned" ? esc(inc.assignedOfficer) : "Unassigned"}</small>
          <span class="badge ${statusClass(inc.status)}">${esc(inc.status)}</span>
        </article>
      `).join("");
    }

    if (!incidentsTableBody) return;

    const searchTerm = (incidentSearchInput?.value || "").trim().toLowerCase();
    const filterStatus = incidentFilterStatus?.value || "";
    const filterOfficer = incidentFilterOfficer?.value || "";

    const filtered = list.filter(inc => {
      if (filterStatus && inc.status !== filterStatus) return false;
      if (filterOfficer && inc.assignedOfficer !== filterOfficer) return false;
      if (searchTerm) {
        const hay = `${inc.id} ${inc.type} ${inc.location} ${inc.complainant} ${inc.assignedOfficer} ${inc.notes || ""}`.toLowerCase();
        if (!hay.includes(searchTerm)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      incidentsTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; padding:32px 16px; color:var(--muted);">
            <div style="font-size:20px; margin-bottom:6px;">📋</div>
            <strong>No incident reports found matching your criteria.</strong>
            <p style="margin:4px 0 0 0; font-size:12px;">Try adjusting your filters or search keyword.</p>
          </td>
        </tr>
      `;
      return;
    }

    incidentsTableBody.innerHTML = filtered.map(inc => {
      const isUnassigned = !inc.assignedOfficer || inc.assignedOfficer === "Unassigned";
      const officerBadge = isUnassigned
        ? `<span style="color:#b45309; font-weight:700; background:#fef3c7; padding:3px 8px; border-radius:6px; font-size:11px;">⚠️ Unassigned</span>`
        : `<span style="color:var(--blue); font-weight:600; display:inline-flex; align-items:center; gap:4px;">👮 ${esc(inc.assignedOfficer)}</span>`;

      return `
        <tr>
          <td><strong style="color:var(--blue); font-family:monospace; font-size:13px;">${esc(inc.id)}</strong></td>
          <td><strong>${esc(inc.type)}</strong></td>
          <td>${esc(inc.location)}</td>
          <td><small class="muted">${esc(inc.reported)}</small></td>
          <td><span class="badge ${statusClass(inc.status)}">${esc(inc.status)}</span></td>
          <td>${officerBadge}</td>
          <td style="text-align:right;">
            <button class="btn btn-sm btn-outline btn-open-incident" data-inc-id="${esc(inc.id)}" type="button" style="padding:5px 10px; font-size:11px;">
              Review & Assign
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // Attach click handlers to open modal
    incidentsTableBody.querySelectorAll(".btn-open-incident").forEach(btn => {
      btn.addEventListener("click", () => {
        openIncidentDetailsModal(btn.dataset.incId);
      });
    });
  }

  function openIncidentDetailsModal(incId) {
    const list = getIncidents();
    const inc = list.find(i => i.id === incId);
    if (!inc || !incidentDetailsModal) return;

    if (incModalTargetId) incModalTargetId.value = inc.id;
    if (incModalTypeTitle) incModalTypeTitle.textContent = inc.type;
    if (incModalId) incModalId.textContent = inc.id;
    if (incModalStatusBadge) {
      incModalStatusBadge.textContent = inc.status;
      incModalStatusBadge.className = `badge ${statusClass(inc.status)}`;
    }
    if (incModalDate) incModalDate.textContent = inc.reported;
    if (incModalLocation) incModalLocation.textContent = inc.location;
    if (incModalComplainant) incModalComplainant.textContent = inc.complainant;
    if (incModalContact) incModalContact.textContent = inc.contact;
    if (incModalDescription) incModalDescription.textContent = inc.notes || "No additional description provided.";

    if (incModalOfficerSelect) incModalOfficerSelect.value = inc.assignedOfficer || "Unassigned";
    if (incModalStatusSelect) incModalStatusSelect.value = inc.status || "New";
    if (incModalNotesInput) incModalNotesInput.value = inc.notes || "";

    if (incModalHistoryList) {
      const historyItems = Array.isArray(inc.history) && inc.history.length ? inc.history : [
        { date: inc.reported, text: `Report logged by ${inc.complainant}.` }
      ];
      incModalHistoryList.innerHTML = historyItems.map(h => `
        <div style="display:flex; gap:8px; align-items:flex-start;">
          <span style="color:#0d4ea6; font-size:12px;">•</span>
          <div>
            <strong style="color:#1e293b;">${esc(h.text)}</strong>
            <small style="display:block; color:#94a3b8; font-size:10px;">${esc(h.date)}</small>
          </div>
        </div>
      `).join("");
    }

    incidentDetailsModal.classList.remove("hidden");
  }

  function closeIncidentDetailsModal() {
    incidentDetailsModal?.classList.add("hidden");
  }

  // Handle incident update form submit
  incidentUpdateForm?.addEventListener("submit", e => {
    e.preventDefault();
    const id = incModalTargetId?.value;
    const list = getIncidents();
    const idx = list.findIndex(i => i.id === id);
    if (idx < 0) return;

    const newOfficer = incModalOfficerSelect?.value || "Unassigned";
    const newStatus = incModalStatusSelect?.value || "New";
    const newNotes = incModalNotesInput?.value.trim() || "";
    const nowStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " • " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    const prevOfficer = list[idx].assignedOfficer;
    const prevStatus = list[idx].status;

    list[idx].assignedOfficer = newOfficer;
    list[idx].status = newStatus;
    list[idx].notes = newNotes;

    if (!Array.isArray(list[idx].history)) list[idx].history = [];

    let actionSummary = `Updated by Admin: Status set to "${newStatus}"`;
    if (prevOfficer !== newOfficer) {
      actionSummary += ` and assigned to ${newOfficer}`;
    }
    list[idx].history.unshift({ date: nowStr, text: actionSummary });

    saveIncidents(list);

    // Sync status with corresponding resident request in tracker if present
    const allRequests = getRequests();
    const reqIdx = allRequests.findIndex(r => r.id === id);
    if (reqIdx >= 0) {
      if (newStatus === "Resolved" || newStatus === "Closed") {
        allRequests[reqIdx].status = "Completed";
      } else if (newStatus === "Investigating" || newStatus === "Under Review") {
        allRequests[reqIdx].status = "Approved";
      } else {
        allRequests[reqIdx].status = "Pending";
      }
      saveRequests(allRequests);
    }

    if (typeof addAuditLog === "function") {
      addAuditLog("Updated", "Incidents & Blotter", id, `Incident status set to "${newStatus}"; assigned to ${newOfficer}.`);
    }

    closeIncidentDetailsModal();
    renderIncidentsTable();
    toast(`Incident ${id} updated! Assigned to ${newOfficer} (${newStatus}).`);
  });

  closeIncidentModalBtn?.addEventListener("click", closeIncidentDetailsModal);
  cancelIncidentModalBtn?.addEventListener("click", closeIncidentDetailsModal);
  incidentDetailsModal?.addEventListener("click", e => {
    if (e.target === incidentDetailsModal) closeIncidentDetailsModal();
  });

  // Filter and search event listeners
  incidentSearchInput?.addEventListener("input", renderIncidentsTable);
  incidentFilterStatus?.addEventListener("change", renderIncidentsTable);
  incidentFilterOfficer?.addEventListener("change", renderIncidentsTable);

  // Add new incident modal handling
  openAddIncidentBtn?.addEventListener("click", () => {
    addIncidentForm?.reset();
    addIncidentModal?.classList.remove("hidden");
  });

  function closeAddIncident() {
    addIncidentModal?.classList.add("hidden");
  }

  closeAddIncidentModalBtn?.addEventListener("click", closeAddIncident);
  cancelAddIncidentBtn?.addEventListener("click", closeAddIncident);
  addIncidentModal?.addEventListener("click", e => {
    if (e.target === addIncidentModal) closeAddIncident();
  });

  addIncidentForm?.addEventListener("submit", e => {
    e.preventDefault();
    const list = getIncidents();
    const nextNum = Math.max(...list.map(i => parseInt((i.id || "").split("-").pop()) || 0), 41) + 1;
    const newId = `INC-2026-${String(nextNum).padStart(4, "0")}`;

    const type = document.getElementById("newIncType")?.value || "General Incident";
    const loc = document.getElementById("newIncLocation")?.value.trim() || "Guadalupe Viejo";
    const comp = document.getElementById("newIncComplainant")?.value.trim() || "Resident";
    const contact = document.getElementById("newIncContact")?.value.trim() || "N/A";
    const officer = document.getElementById("newIncOfficer")?.value || "Unassigned";
    const status = document.getElementById("newIncStatus")?.value || "New";
    const details = document.getElementById("newIncDetails")?.value.trim() || "";
    const nowStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " • " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    const newEntry = {
      id: newId,
      type: type,
      complainant: comp,
      contact: contact,
      location: loc,
      reported: nowStr,
      status: status,
      assignedOfficer: officer,
      notes: details,
      history: [
        { date: nowStr, text: `Report logged by ${comp}. ${officer !== "Unassigned" ? "Assigned to " + officer + "." : "Pending officer assignment."}` }
      ]
    };

    list.unshift(newEntry);
    saveIncidents(list);
    closeAddIncident();
    renderIncidentsTable();
    toast(`New incident report logged! Ref: ${newId}.`);
  });

  // Initial render on page load
  renderIncidentsTable();

  // ========================================================
  // RESIDENT COMPLAINT & BLOTTER SUBMISSION HANDLING
  // ========================================================
  const residentComplaintModal = document.getElementById("residentComplaintModal");
  const closeResidentComplaintModal = document.getElementById("closeResidentComplaintModal");
  const cancelResidentComplaintModal = document.getElementById("cancelResidentComplaintModal");
  const residentComplaintForm = document.getElementById("residentComplaintForm");
  const quickComplaintBtn = document.getElementById("quickComplaintBtn");
  const openResidentComplaintCardBtn = document.getElementById("openResidentComplaintCardBtn");

  function openResidentComplaint() {
    if (!residentComplaintModal) return;
    residentComplaintForm?.reset();
    const compName = document.getElementById("compName");
    const compContact = document.getElementById("compContact");
    if (compName) compName.value = currentResident();
    const activeRes = RESIDENTS_DATA && RESIDENTS_DATA["GV-2026-000123"];
    if (compContact && activeRes) compContact.value = activeRes.phone || "+63 917 123 4567";
    const compTime = document.getElementById("compTime");
    if (compTime) {
      compTime.value = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " • " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    residentComplaintModal.classList.remove("hidden");
  }

  function closeResidentComplaint() {
    residentComplaintModal?.classList.add("hidden");
  }

  quickComplaintBtn?.addEventListener("click", openResidentComplaint);
  openResidentComplaintCardBtn?.addEventListener("click", openResidentComplaint);
  closeResidentComplaintModal?.addEventListener("click", closeResidentComplaint);
  cancelResidentComplaintModal?.addEventListener("click", closeResidentComplaint);
  residentComplaintModal?.addEventListener("click", e => {
    if (e.target === residentComplaintModal) closeResidentComplaint();
  });

  // Check URL parameter to auto-open complaint modal (e.g. from dashboard link)
  if (location.search.includes("open=complaint") || location.search.includes("action=complaint")) {
    setTimeout(() => {
      openResidentComplaint();
    }, 300);
  }

  // Handle Resident Complaint Submission
  residentComplaintForm?.addEventListener("submit", e => {
    e.preventDefault();
    const incidents = getIncidents();
    const nextNum = Math.max(...incidents.map(i => parseInt((i.id || "").split("-").pop()) || 0), 41) + 1;
    const incId = `INC-2026-${String(nextNum).padStart(4, "0")}`;

    const type = document.getElementById("compType")?.value || "Noise Complaint";
    const loc = document.getElementById("compLocation")?.value.trim() || "Guadalupe Viejo";
    const respondent = document.getElementById("compRespondent")?.value.trim() || "";
    const time = document.getElementById("compTime")?.value.trim() || "Recent";
    const details = document.getElementById("compDetails")?.value.trim() || "";
    const name = currentResident();
    const contact = document.getElementById("compContact")?.value.trim() || "+63 917 123 4567";
    const nowStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " • " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    // 1. Save to Official Incidents (for Admin blotter)
    const newIncident = {
      id: incId,
      type: type,
      complainant: name,
      contact: contact,
      location: loc,
      reported: nowStr,
      status: "New",
      assignedOfficer: "Unassigned",
      notes: `Respondent: ${respondent || "Unknown / Not specified"}\nIncident Time: ${time}\n\nNarrative Statement:\n${details}`,
      history: [
        { date: nowStr, text: `Blotter complaint filed online by resident ${name}.` }
      ]
    };
    incidents.unshift(newIncident);
    saveIncidents(incidents);

    // 2. Also register in Requests Tracker so resident can track progress
    const requests = getRequests();
    const reqEntry = {
      id: incId,
      resident: name,
      document: `Incident Blotter — ${type}`,
      purpose: "Community Complaint",
      date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      status: "Pending",
      payment: "Not Applicable",
      pickup: "Officer Response"
    };
    requests.unshift(reqEntry);
    saveRequests(requests);

    if (window.eViejoDB && typeof window.eViejoDB.createComplaint === "function") {
      window.eViejoDB.createComplaint({
        id: incId,
        complainant: name,
        type: type,
        location: loc,
        notes: `Respondent: ${respondent || "Unknown / Not specified"}\nIncident Time: ${time}\n\nNarrative Statement:\n${details}`,
        status: "Pending"
      });
    }

    closeResidentComplaint();
    toast(`Complaint submitted! Reference: ${incId}. Forwarded to Barangay Peace & Order.`);

    setTimeout(() => {
      location.href = "tracker.html";
    }, 900);
  });

  /* ========================================================
     AUDIT LOGS ENGINE (Compliant with RA 10173)
     ======================================================== */
  const STORE_AUDIT_LOGS = "eViejoAuditLogs";
  const seedAuditLogs = [
    {
      timestamp: "May 15, 2026 • 05:42 PM",
      user: "Admin User",
      module: "Requests",
      action: "Approved",
      ref: "REQ-2026-00128",
      details: "Approved Barangay Clearance request for Maria Santos."
    },
    {
      timestamp: "May 15, 2026 • 05:35 PM",
      user: "Officer Juan Reyes",
      module: "Incidents & Blotter",
      action: "Updated",
      ref: "INC-2026-0040",
      details: "Dispatched to Bridge Access Road; status changed to Investigating."
    },
    {
      timestamp: "May 15, 2026 • 05:12 PM",
      user: "Admin User",
      module: "Staff & Access",
      action: "Created",
      ref: "USR-0019",
      details: "Created new Desk Officer role account for Officer Roberto Bautista."
    },
    {
      timestamp: "May 15, 2026 • 04:58 PM",
      user: "Maria Santos (Secretary)",
      module: "Requests",
      action: "Generated",
      ref: "REQ-2026-00125",
      details: "Generated official Business Clearance document; marked Ready for Pickup."
    },
    {
      timestamp: "May 15, 2026 • 04:45 PM",
      user: "Treasury Staff",
      module: "Treasury & Payments",
      action: "Payment Recorded",
      ref: "OR-2026-0912",
      details: "Recorded cash payment of ₱50.00 for Barangay Clearance."
    },
    {
      timestamp: "May 15, 2026 • 03:20 PM",
      user: "Admin User",
      module: "Resident Records",
      action: "Updated",
      ref: "GV-2026-000123",
      details: "Updated verified phone and address for Juan Dela Cruz under RA 10173."
    },
    {
      timestamp: "May 14, 2026 • 10:15 AM",
      user: "Officer Maria Cruz",
      module: "Incidents & Blotter",
      action: "Resolved",
      ref: "INC-2026-0039",
      details: "Obstruction cleared on J.P. Rizal Ext; case marked Resolved."
    },
    {
      timestamp: "May 14, 2026 • 08:30 AM",
      user: "Admin User",
      module: "System Security",
      action: "Access Granted",
      ref: "SESSION-9104",
      details: "Admin login authenticated under RA 10173 Data Privacy consent."
    }
  ];

  function getAuditLogs() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_AUDIT_LOGS));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch(e){}
    localStorage.setItem(STORE_AUDIT_LOGS, JSON.stringify(seedAuditLogs));
    return [...seedAuditLogs];
  }

  function addAuditLog(action, module, ref, details, user) {
    // Default user: use the currently active admin name, fallback to "Admin User"
    if (!user) {
      try { user = getActiveAdmin()?.name || "Admin User"; } catch(e) { user = "Admin User"; }
    }
    const logs = getAuditLogs();
    const nowStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " • " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    logs.unshift({
      timestamp: nowStr,
      user: user,
      module: module,
      action: action,
      ref: ref,
      details: details
    });
    localStorage.setItem(STORE_AUDIT_LOGS, JSON.stringify(logs));
    renderAuditLogsTable();
  }

  const auditLogsTableBody = document.getElementById("auditLogsTableBody");
  const auditLogSearch = document.getElementById("auditLogSearch");
  const auditLogModuleFilter = document.getElementById("auditLogModuleFilter");
  const auditLogActionFilter = document.getElementById("auditLogActionFilter");

  function actionBadgeClass(action) {
    if (action === "Approved" || action === "Resolved") return "approved";
    if (action === "Updated" || action === "Payment Recorded") return "payment";
    if (action === "Created" || action === "Access Granted") return "investigating";
    if (action === "Generated") return "pending";
    return "closed";
  }

  function renderAuditLogsTable() {
    const logs = getAuditLogs();

    if (!auditLogsTableBody) return;

    const searchTerm = (auditLogSearch?.value || "").trim().toLowerCase();
    const filterModule = auditLogModuleFilter?.value || "";
    const filterAction = auditLogActionFilter?.value || "";

    const filtered = logs.filter(log => {
      if (filterModule && log.module !== filterModule) return false;
      if (filterAction && log.action !== filterAction) return false;
      if (searchTerm) {
        const hay = `${log.timestamp} ${log.user} ${log.module} ${log.action} ${log.ref} ${log.details}`.toLowerCase();
        if (!hay.includes(searchTerm)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      auditLogsTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:32px 16px; color:var(--muted);">
            <strong>No audit log records match your filter criteria.</strong>
            <p style="margin:4px 0 0 0; font-size:12px;">Try clearing search keywords or choosing "All Modules".</p>
          </td>
        </tr>
      `;
      return;
    }

    auditLogsTableBody.innerHTML = filtered.map(log => `
      <tr>
        <td><small class="muted" style="font-size:11px; white-space:nowrap;">${esc(log.timestamp)}</small></td>
        <td><strong style="color:#1e293b; font-size:12px;">${esc(log.user)}</strong></td>
        <td><span style="color:#475569; font-size:11px; font-weight:600;">${esc(log.module)}</span></td>
        <td><span class="badge ${actionBadgeClass(log.action)}">${esc(log.action)}</span></td>
        <td><code style="background:#f1f5f9; padding:3px 6px; border-radius:4px; font-family:monospace; font-size:11px; color:var(--blue); font-weight:700;">${esc(log.ref)}</code></td>
        <td><span style="font-size:12px; color:#334155; line-height:1.4;">${esc(log.details)}</span></td>
      </tr>
    `).join("");
  }

  // ========================================================
  // ADMIN PORTAL TOPBAR USER DYNAMIC UPDATE
  // ========================================================
  function updateAdminTopBar() {
    const currentAdmin = getActiveAdmin();
    const topName = document.getElementById("adminTopName");
    const topAvatar = document.getElementById("adminTopAvatar");
    const topRole = document.getElementById("adminTopRole");
    const genericTopUser = document.querySelector(".app-screen.admin-theme .top-user");

    if (topName) topName.textContent = currentAdmin.name;
    if (topAvatar) topAvatar.textContent = currentAdmin.avatarText || getInitials(currentAdmin.name);
    if (topRole) topRole.textContent = `(${currentAdmin.role})`;

    // If other admin screens have generic top-user container:
    if (genericTopUser && !topName) {
      const strong = genericTopUser.querySelector("strong");
      const av = genericTopUser.querySelector(".avatar");
      if (strong) strong.textContent = currentAdmin.name;
      if (av) av.textContent = currentAdmin.avatarText || getInitials(currentAdmin.name);
    }
  }
  updateAdminTopBar();

  // ========================================================
  // USERS & ROLES INTERACTION ENGINE (admin/users.html)
  // Authority rule: Only "Barangay Captain" and "Super Admin"
  // can Add, Edit details, or Delete admin accounts.
  // ========================================================
  const adminsTableBody = document.getElementById("adminsTableBody");
  const authorityBanner = document.getElementById("authorityBanner");
  const authorityTitle = document.getElementById("authorityTitle");
  const authorityDesc = document.getElementById("authorityDesc");
  const authorityPill = document.getElementById("authorityPill");
  const authorityIcon = document.getElementById("authorityIcon");
  const openAddAdminBtn = document.getElementById("openAddAdminBtn");
  const switchRoleQuickBtn = document.getElementById("switchRoleQuickBtn");

  const adminSearchInput = document.getElementById("adminSearchInput");
  const adminRoleFilter = document.getElementById("adminRoleFilter");
  const adminStatusFilter = document.getElementById("adminStatusFilter");

  // Modals
  const addAdminModal = document.getElementById("addAdminModal");
  const closeAddAdminModalBtn = document.getElementById("closeAddAdminModalBtn");
  const cancelAddAdminBtn = document.getElementById("cancelAddAdminBtn");
  const addAdminForm = document.getElementById("addAdminForm");

  const editAdminModal = document.getElementById("editAdminModal");
  const closeEditAdminModalBtn = document.getElementById("closeEditAdminModalBtn");
  const cancelEditAdminBtn = document.getElementById("cancelEditAdminBtn");
  const editAdminForm = document.getElementById("editAdminForm");
  const editAdminTargetNameDisplay = document.getElementById("editAdminTargetNameDisplay");

  const deleteAdminModal = document.getElementById("deleteAdminModal");
  const closeDeleteAdminModalBtn = document.getElementById("closeDeleteAdminModalBtn");
  const cancelDeleteAdminBtn = document.getElementById("cancelDeleteAdminBtn");
  const confirmDeleteAdminBtn = document.getElementById("confirmDeleteAdminBtn");
  const deleteAdminNameDisplay = document.getElementById("deleteAdminNameDisplay");
  const deleteAdminRoleDisplay = document.getElementById("deleteAdminRoleDisplay");
  const deleteAdminIdInput = document.getElementById("deleteAdminId");

  function renderAuthorityState() {
    const currentAdmin = getActiveAdmin();
    const hasAuthority = isAuthorizedAdmin(currentAdmin.role);

    if (authorityBanner) {
      authorityBanner.className = `authority-banner ${hasAuthority ? "authorized" : "restricted"}`;
      if (authorityIcon) authorityIcon.textContent = hasAuthority ? "🛡️" : "⚠️";
      if (authorityTitle) authorityTitle.textContent = hasAuthority ? "Executive Administrative Authority Active" : "Restricted Authority (View-Only)";
      if (authorityDesc) authorityDesc.textContent = hasAuthority
        ? `Logged in as ${currentAdmin.name} (${currentAdmin.role}). You have full executive authority to add, update, and delete staff accounts.`
        : `Logged in as ${currentAdmin.name} (${currentAdmin.role}). Only the Barangay Captain and Super Admin can create, edit, or delete staff accounts.`;
      
      if (authorityPill) {
        authorityPill.textContent = currentAdmin.role;
        authorityPill.className = `authority-badge-pill ${currentAdmin.role === "Barangay Captain" ? "captain" : (currentAdmin.role === "Super Admin" ? "super-admin" : "staff")}`;
      }
    }

    if (openAddAdminBtn) {
      if (hasAuthority) {
        openAddAdminBtn.disabled = false;
        openAddAdminBtn.style.opacity = "1";
        openAddAdminBtn.style.cursor = "pointer";
        openAddAdminBtn.title = "Create a new admin staff account";
      } else {
        openAddAdminBtn.disabled = true;
        openAddAdminBtn.style.opacity = "0.5";
        openAddAdminBtn.style.cursor = "not-allowed";
        openAddAdminBtn.title = "Action reserved for Barangay Captain and Super Admin";
      }
    }
  }

  function renderAdminsTable() {
    if (!adminsTableBody) return;
    const currentAdmin = getActiveAdmin();
    const hasAuthority = isAuthorizedAdmin(currentAdmin.role);
    const admins = getAdmins();

    const search = (adminSearchInput?.value || "").trim().toLowerCase();
    const filterRole = adminRoleFilter?.value || "";
    const filterStatus = adminStatusFilter?.value || "";

    const filtered = admins.filter(a => {
      if (filterRole && a.role !== filterRole) return false;
      if (filterStatus && a.status !== filterStatus) return false;
      if (search) {
        const query = `${a.name} ${a.username} ${a.role} ${a.phone || ""}`.toLowerCase();
        if (!query.includes(search)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      adminsTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; padding:32px 16px; color:var(--muted);">
            <strong>No admin accounts match your filter criteria.</strong>
          </td>
        </tr>
      `;
      return;
    }

    adminsTableBody.innerHTML = filtered.map(a => {
      const isSelf = a.id === currentAdmin.id;
      const roleClass = a.role === "Barangay Captain" ? "captain" : (a.role === "Super Admin" ? "super-admin" : "staff");
      const statusBadge = a.status === "Active" ? "badge approved" : "badge rejected";

      return `
        <tr data-admin-id="${esc(a.id)}">
          <td>
            <div style="display:flex; align-items:center; gap:10px;">
              <div class="avatar-sm" style="background:#003366; color:#fff; font-size:11px;">${esc(a.avatarText || getInitials(a.name))}</div>
              <div>
                <strong style="display:block; font-size:13px; color:#0f172a;">${esc(a.name)}</strong>
                ${isSelf ? '<span style="font-size:10px; color:#1d4ed8; font-weight:700;">★ Currently Logged In</span>' : (a.phone ? `<small class="muted" style="font-size:11px;">${esc(a.phone)}</small>` : '')}
              </div>
            </div>
          </td>
          <td><code style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-size:11px; font-weight:700; color:#334155;">@${esc(a.username)}</code></td>
          <td><span class="authority-badge-pill ${roleClass}">${esc(a.role)}</span></td>
          <td><span class="${statusBadge}">${esc(a.status)}</span></td>
          <td><small class="muted" style="font-size:11px;">${esc(a.lastLogin || 'Never')}</small></td>
          <td style="text-align:right;">
            <div class="table-action-btns" style="justify-content:flex-end;">
              <button class="btn-table-action btn-table-edit" data-edit-admin="${esc(a.id)}" ${!hasAuthority ? 'disabled title="Authority reserved for Barangay Captain & Super Admin"' : ''}>
                ✏️ Edit
              </button>
              <button class="btn-table-action btn-table-delete" data-delete-admin="${esc(a.id)}" ${(!hasAuthority || isSelf) ? 'disabled title="' + (isSelf ? 'Cannot delete your own active account' : 'Authority reserved for Barangay Captain & Super Admin') + '"' : ''}>
                🗑️ Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    // Attach row events
    adminsTableBody.querySelectorAll("[data-edit-admin]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!isAuthorizedAdmin(getActiveAdmin().role)) {
          toast("Authority Denied: Only the Barangay Captain or Super Admin can edit staff details.");
          return;
        }
        openEditAdminModal(btn.dataset.editAdmin);
      });
    });

    adminsTableBody.querySelectorAll("[data-delete-admin]").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!isAuthorizedAdmin(getActiveAdmin().role)) {
          toast("Authority Denied: Only the Barangay Captain or Super Admin can delete admin accounts.");
          return;
        }
        openDeleteAdminModal(btn.dataset.deleteAdmin);
      });
    });
  }

  // Open Add Admin Modal
  openAddAdminBtn?.addEventListener("click", () => {
    const currentAdmin = getActiveAdmin();
    if (!isAuthorizedAdmin(currentAdmin.role)) {
      toast("Authority Denied: Only Barangay Captain or Super Admin can add new admins.");
      return;
    }
    addAdminForm?.reset();
    addAdminModal?.classList.remove("hidden");
  });

  // Close Add Admin Modal
  closeAddAdminModalBtn?.addEventListener("click", () => addAdminModal?.classList.add("hidden"));
  cancelAddAdminBtn?.addEventListener("click", () => addAdminModal?.classList.add("hidden"));

  // Submit Add Admin Form
  addAdminForm?.addEventListener("submit", e => {
    e.preventDefault();
    const currentAdmin = getActiveAdmin();
    if (!isAuthorizedAdmin(currentAdmin.role)) {
      toast("Authority Denied: Insufficient permissions.");
      return;
    }

    const name = document.getElementById("newAdminName")?.value.trim();
    const username = document.getElementById("newAdminUsername")?.value.trim().toLowerCase();
    const role = document.getElementById("newAdminRole")?.value;
    const status = document.getElementById("newAdminStatus")?.value;
    const phone = document.getElementById("newAdminPhone")?.value.trim();
    const pass = document.getElementById("newAdminPass")?.value;
    const confirmPass = document.getElementById("newAdminPassConfirm")?.value;

    if (pass !== confirmPass) {
      toast("Passwords do not match. Please verify.");
      return;
    }

    const admins = getAdmins();
    if (admins.some(a => a.username.toLowerCase() === username)) {
      toast(`Username "@${username}" already exists. Please choose a different username.`);
      return;
    }

    const newId = `ADM-${String(Date.now()).slice(-4)}`;
    const newAdmin = {
      id: newId,
      name,
      username,
      password: pass,
      role,
      status,
      phone: phone || "—",
      lastLogin: "Never",
      avatarText: getInitials(name)
    };

    admins.push(newAdmin);
    saveAdmins(admins);
    addAdminModal?.classList.add("hidden");
    renderAdminsTable();

    // Audit Log compliant with RA 10173
    addAuditLog(
      "Created",
      "Staff & Access",
      newId,
      `${currentAdmin.name} (${currentAdmin.role}) created new official staff account for ${name} as ${role}.`,
      currentAdmin.name
    );

    toast(`Admin account for ${name} (${role}) created successfully!`);
  });

  // Open Edit Admin Modal
  function openEditAdminModal(adminId) {
    const admins = getAdmins();
    const target = admins.find(a => a.id === adminId);
    if (!target) return;

    const idInput = document.getElementById("editAdminId");
    const nameInput = document.getElementById("editAdminName");
    const userInput = document.getElementById("editAdminUsername");
    const roleInput = document.getElementById("editAdminRole");
    const statusInput = document.getElementById("editAdminStatus");
    const phoneInput = document.getElementById("editAdminPhone");
    const passInput = document.getElementById("editAdminPass");

    if (idInput) idInput.value = target.id;
    if (nameInput) nameInput.value = target.name;
    if (userInput) userInput.value = target.username;
    if (roleInput) roleInput.value = target.role;
    if (statusInput) statusInput.value = target.status;
    if (phoneInput) phoneInput.value = target.phone || "";
    if (passInput) passInput.value = "";
    if (editAdminTargetNameDisplay) editAdminTargetNameDisplay.textContent = target.name;

    editAdminModal?.classList.remove("hidden");
  }

  closeEditAdminModalBtn?.addEventListener("click", () => editAdminModal?.classList.add("hidden"));
  cancelEditAdminBtn?.addEventListener("click", () => editAdminModal?.classList.add("hidden"));

  // Submit Edit Admin Form
  editAdminForm?.addEventListener("submit", e => {
    e.preventDefault();
    const currentAdmin = getActiveAdmin();
    if (!isAuthorizedAdmin(currentAdmin.role)) {
      toast("Authority Denied: Insufficient permissions.");
      return;
    }

    const id = document.getElementById("editAdminId")?.value;
    const name = document.getElementById("editAdminName")?.value.trim();
    const username = document.getElementById("editAdminUsername")?.value.trim().toLowerCase();
    const role = document.getElementById("editAdminRole")?.value;
    const status = document.getElementById("editAdminStatus")?.value;
    const phone = document.getElementById("editAdminPhone")?.value.trim();
    const newPass = document.getElementById("editAdminPass")?.value;

    const admins = getAdmins();
    const targetIdx = admins.findIndex(a => a.id === id);
    if (targetIdx === -1) return;

    // Check unique username collision
    if (admins.some(a => a.id !== id && a.username.toLowerCase() === username)) {
      toast(`Username "@${username}" is taken by another staff member.`);
      return;
    }

    const previousRole = admins[targetIdx].role;
    admins[targetIdx].name = name;
    admins[targetIdx].username = username;
    admins[targetIdx].role = role;
    admins[targetIdx].status = status;
    admins[targetIdx].phone = phone || "—";
    admins[targetIdx].avatarText = getInitials(name);
    if (newPass) admins[targetIdx].password = newPass;

    saveAdmins(admins);

    // If editing currently active session admin, update active session too
    if (currentAdmin.id === id) {
      setActiveAdmin(admins[targetIdx]);
      updateAdminTopBar();
      renderAuthorityState();
    }

    editAdminModal?.classList.add("hidden");
    renderAdminsTable();

    // Audit Log entry
    addAuditLog(
      "Updated",
      "Staff & Access",
      id,
      `${currentAdmin.name} (${currentAdmin.role}) updated details for ${name} (Role: ${role}, Status: ${status}).`,
      currentAdmin.name
    );

    toast(`Updated details for ${name} successfully.`);
  });

  // Open Delete Admin Modal
  function openDeleteAdminModal(adminId) {
    const currentAdmin = getActiveAdmin();
    const admins = getAdmins();
    const target = admins.find(a => a.id === adminId);
    if (!target) return;

    if (target.id === currentAdmin.id) {
      toast("Security Safeguard: You cannot delete your own currently active account.");
      return;
    }

    if (deleteAdminIdInput) deleteAdminIdInput.value = target.id;
    if (deleteAdminNameDisplay) deleteAdminNameDisplay.textContent = target.name;
    if (deleteAdminRoleDisplay) deleteAdminRoleDisplay.textContent = target.role;

    deleteAdminModal?.classList.remove("hidden");
  }

  closeDeleteAdminModalBtn?.addEventListener("click", () => deleteAdminModal?.classList.add("hidden"));
  cancelDeleteAdminBtn?.addEventListener("click", () => deleteAdminModal?.classList.add("hidden"));

  // Confirm Delete Admin
  confirmDeleteAdminBtn?.addEventListener("click", () => {
    const currentAdmin = getActiveAdmin();
    if (!isAuthorizedAdmin(currentAdmin.role)) {
      toast("Authority Denied: Insufficient permissions.");
      return;
    }

    const id = deleteAdminIdInput?.value;
    let admins = getAdmins();
    const target = admins.find(a => a.id === id);
    if (!target) return;

    if (target.id === currentAdmin.id) {
      toast("Security Safeguard: You cannot delete your own active account.");
      return;
    }

    admins = admins.filter(a => a.id !== id);
    saveAdmins(admins);
    deleteAdminModal?.classList.add("hidden");
    renderAdminsTable();

    // Audit Log entry
    addAuditLog(
      "Deleted",
      "Staff & Access",
      id,
      `${currentAdmin.name} (${currentAdmin.role}) deleted admin account for ${target.name} (formerly ${target.role}).`,
      currentAdmin.name
    );

    toast(`Admin account for ${target.name} deleted.`);
  });

  // Filter & Search events
  adminSearchInput?.addEventListener("input", renderAdminsTable);
  adminRoleFilter?.addEventListener("change", renderAdminsTable);
  adminStatusFilter?.addEventListener("change", renderAdminsTable);

  // Initialize Users & Roles view
  if (adminsTableBody) {
    renderAuthorityState();
    renderAdminsTable();
  }

  document.getElementById("announcementForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const form = e.target;
    const inputs = form.querySelectorAll("input, select, textarea");
    const title    = inputs[0]?.value.trim();
    const category = inputs[1]?.value || "General";
    const rawDate  = inputs[2]?.value;
    const message  = inputs[3]?.value.trim();
    if (!title || !message) { toast("Please fill in the title and message."); return; }

    const dateLabel = rawDate
      ? new Date(rawDate + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    const announcements = (() => { try { return JSON.parse(localStorage.getItem("eViejoAnnouncements")) || []; } catch(e) { return []; } })();
    const newEntry = { title, category, date: dateLabel, message, postedAt: Date.now() };
    announcements.unshift(newEntry);
    localStorage.setItem("eViejoAnnouncements", JSON.stringify(announcements));

    // Re-render published list on admin/announcements.html
    const publishedPanel = document.getElementById("publishedAnnouncementsPanel");
    if (publishedPanel) {
      publishedPanel.innerHTML = announcements.map(a => `
        <article class="mini-news">
          <span>◉</span>
          <div>
            <strong>${String(a.title || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}</strong>
            <small>Published ${String(a.date || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))} &bull; ${String(a.category || "General")}</small>
          </div>
        </article>
      `).join("");
    }

    if (typeof addAuditLog === "function") {
      addAuditLog("Created", "Announcements", "ANN-" + Date.now(), `Announcement published: "${title}" (${category}).`);
    }
    toast("Announcement published successfully.");
    form.reset();
  });
  document.querySelectorAll(".toggle").forEach(btn=>btn.addEventListener("click",()=>{const on=btn.textContent.trim()!=="OFF";btn.textContent=on?"OFF":"ON";btn.classList.toggle("active",!on);toast(on?"Setting disabled.":"Setting enabled.");}));

  // =========================================================
  // ANNOUNCEMENTS: Render on resident and admin pages from localStorage
  // =========================================================
  function renderAnnouncementsPage() {
    const storedRaw = localStorage.getItem("eViejoAnnouncements");
    let announcements = [];
    try {
      announcements = JSON.parse(storedRaw) || [];
    } catch(e) {}

    // Add seed data if empty
    if (announcements.length === 0) {
      const now = new Date();
      announcements = [
        {
          title: "Barangay Town Hall Meeting",
          category: "General",
          date: now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          message: "All residents are invited to the upcoming town hall meeting to discuss the new community park project.",
          postedAt: now.getTime() - 86400000 * 2 // 2 days ago
        },
        {
          title: "Road Repair Advisory",
          category: "Advisory",
          date: new Date(now.getTime() - 86400000 * 5).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
          message: "Please be advised that road repairs will commence on J.P. Rizal St. next week. Expect moderate traffic.",
          postedAt: now.getTime() - 86400000 * 5 // 5 days ago
        }
      ];
      localStorage.setItem("eViejoAnnouncements", JSON.stringify(announcements));
    }

    // Resident announcements full page grid
    const residentGrid = document.getElementById("residentAnnouncementGrid");
    if (residentGrid) {
      if (announcements.length === 0) {
        residentGrid.innerHTML = `<div style="text-align:center; padding:40px; color:var(--muted); font-size:13px;">No announcements have been posted yet. Check back soon.</div>`;
      } else {
        residentGrid.innerHTML = announcements.map(a => {
          const safeTitle = esc(a.title || "");
          const safeMsg   = esc(a.message || "");
          const safeCat   = esc(a.category || "General");
          const safeDate  = esc(a.date || "");
          // Format short date label (e.g. "SEP 14")
          const shortDate = (() => {
            try {
              const d = new Date(a.postedAt || Date.now());
              return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
            } catch(e2) { return safeDate.toUpperCase().slice(0, 6); }
          })();
          return `
            <article class="announcement">
              <span class="date">${shortDate}</span>
              <div>
                <strong>${safeTitle}</strong>
                <p>${safeMsg}</p>
                <small>${safeDate} &bull; ${safeCat}</small>
              </div>
            </article>
          `;
        }).join("");
      }
    }

    // Admin published panel (admin/announcements.html)
    const adminPublished = document.getElementById("publishedAnnouncementsPanel");
    if (adminPublished) {
      if (announcements.length === 0) {
        adminPublished.innerHTML = `<div style="text-align:center; padding:16px; color:var(--muted); font-size:12px;">No announcements posted yet.</div>`;
      } else {
        adminPublished.innerHTML = announcements.map(a => `
          <article class="mini-news">
            <span>◉</span>
            <div>
              <strong>${esc(a.title || "")}</strong>
              <small>Published ${esc(a.date || "")} &bull; ${esc(a.category || "General")}</small>
            </div>
          </article>
        `).join("");
      }
    }
  }

  renderAnnouncementsPage();

  // =========================================================
  // ADMIN DASHBOARD: Fix "Good day, Admin User." greeting with real admin name
  // =========================================================
  const adminGreeting = document.querySelector(".page-heading h1");
  if (adminGreeting && adminGreeting.textContent.includes("Admin User")) {
    try {
      const activeAdmin = JSON.parse(sessionStorage.getItem("eViejoActiveAdmin"));
      if (activeAdmin && activeAdmin.name) {
        adminGreeting.textContent = `Good day, ${activeAdmin.name}.`;
        document.querySelectorAll(".top-user strong").forEach(el => { el.textContent = activeAdmin.name; });
        document.querySelectorAll(".top-user .avatar").forEach(av => {
          const initials = (activeAdmin.avatarText || activeAdmin.name.split(/\s+/).map(p => p[0]).join("")).slice(0, 2).toUpperCase();
          if (!av.querySelector("img")) av.textContent = initials;
        });
      }
    } catch(e) {}
  }
});

/* =========================================================
   PHILIPPINE STANDARD TIME
   ========================================================= */

function updatePHSTClock() {
  const clock = document.getElementById("phstTime");

  if (!clock) return;

  const now = new Date();

  const phTime = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(now);

  clock.textContent = phTime;
}

/* Show immediately */
updatePHSTClock();

/* Keep clock running every second */
setInterval(updatePHSTClock, 1000);
/* =========================================================
   PUBLIC MOBILE NAVIGATION
   ========================================================= */

const publicMobileMenu =
  document.getElementById("publicMobileMenu");

const publicNav =
  document.getElementById("publicNav");

if (publicMobileMenu && publicNav) {

  publicMobileMenu.addEventListener("click", () => {

    const isOpen =
      publicNav.classList.toggle("mobile-open");

    publicMobileMenu.setAttribute(
      "aria-expanded",
      isOpen ? "true" : "false"
    );

    publicMobileMenu.textContent =
      isOpen ? "×" : "☰";
  });


  /* Close menu after clicking a navigation link */

  publicNav.querySelectorAll("a").forEach(link => {

    link.addEventListener("click", () => {

      publicNav.classList.remove("mobile-open");

      publicMobileMenu.setAttribute(
        "aria-expanded",
        "false"
      );

      publicMobileMenu.textContent = "☰";

    });

  });

}

/* =========================================================
   SCROLL POP-UP / REVEAL EFFECT (INDEX PAGE)
   ========================================================= */
(function initIndexScrollReveal() {
  const isIndexPage = document.querySelector(".hero") || document.querySelector(".service-grid") || document.querySelector(".barangay-info-grid");
  if (!isIndexPage) return;

  const targetSelector = [
    ".section-head",
    ".info-banner",
    ".service-card",
    ".info-card",
    ".announcement",
    ".captain-card",
    ".official-card",
    ".sk-chairperson"
  ].join(",");

  const elements = document.querySelectorAll(targetSelector);
  if (!elements.length) return;

  elements.forEach((el, idx) => {
    el.classList.add("reveal-item");

    // Add slight natural stagger for grouped elements inside grids
    const parentGrid = el.closest(".service-grid, .barangay-info-grid, .announcement-grid, .officials-grid, .admin-official-grid, .sk-grid");
    if (parentGrid) {
      const siblings = Array.from(parentGrid.children).filter(child => child.matches(targetSelector));
      const childIndex = siblings.indexOf(el);
      if (childIndex > 0) {
        el.style.transitionDelay = `${Math.min(childIndex * 70, 280)}ms`;
      }
    }
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: "0px 0px -40px 0px",
      threshold: 0.12
    });

    elements.forEach(el => observer.observe(el));
  } else {
    // Fallback if IntersectionObserver is not supported
    elements.forEach(el => el.classList.add("is-visible"));
  }
})();
