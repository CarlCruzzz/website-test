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

  // 1. Fetch all requests from Supabase
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

  // 2. Insert a request to Supabase
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

  // 3. Update request status in Supabase
  async updateRequestStatus(refNo, newStatus, newPayment, newPickup) {
    const updateBody = { status: newStatus };
    if (newPayment) updateBody.payment_status = newPayment;
    if (newPickup) updateBody.pickup_instruction = newPickup;
    return this.request(`requests?reference_no=eq.${encodeURIComponent(refNo)}`, {
      method: "PATCH",
      body: updateBody
    });
  },

  // 4. Create incident / complaint
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

  // 5. Register resident
  async registerResident(resident) {
    return this.request("residents", {
      method: "POST",
      body: {
        full_name: resident.name,
        phone: resident.phone,
        email: resident.email,
        address: resident.address,
        is_verified: true
      }
    });
  }
};

// Initial sync: fetch Supabase data in background and update cache without clobbering local unsynced requests
if (typeof window !== "undefined") {
  window.eViejoDB.fetchRequests().then(remoteRequests => {
    if (remoteRequests && remoteRequests.length > 0) {
      try {
        let localList = JSON.parse(localStorage.getItem("eViejoRequests") || "[]");
        if (!Array.isArray(localList)) localList = [];
        const remoteIds = new Set(remoteRequests.map(r => r.id));
        const merged = [...remoteRequests];
        localList.forEach(l => {
          if (l && l.id && !remoteIds.has(l.id)) {
            merged.unshift(l);
          }
        });
        localStorage.setItem("eViejoRequests", JSON.stringify(merged));
      } catch(e) {
        localStorage.setItem("eViejoRequests", JSON.stringify(remoteRequests));
      }
      console.log(`[E-Viejo] Synced ${remoteRequests.length} requests from Supabase.`);
    }
  });
}


