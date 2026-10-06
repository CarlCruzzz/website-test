/**
 * ====================================================================
 * BARANGAY GUADALUPE VIEJO — ID EXTRACTION ENGINE (extract.js)
 * Handles physical ID scanning, image uploads, backend extraction API,
 * and auto-filling of constituent registration & login forms.
 * ====================================================================
 */

(function () {
  'use strict';

  // Standard constituent reference data (matching assets/id-front.jpg, assets/id-back.jpg & digital-id.html)
  const CONSTITUENT_TEMPLATE = {
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
    emergencyPhone: "8470-0081"
  };

  /**
   * Extract constituent fields from uploaded front and back ID files.
   * Sends files to backend Express /api/extract-id (Gemini Vision AI),
   * with automatic fallback if backend server is not reachable.
   */
  async function extractId(fileFront, fileBack, onProgress) {
    const file = fileFront || fileBack;
    if (!file) return null;

    if (onProgress) onProgress("Uploading ID photo to extraction engine...");

    // 1. Attempt backend API extraction
    try {
      const formData = new FormData();
      if (fileFront) {
        if (typeof File !== "undefined" && fileFront instanceof File) formData.append("front", fileFront);
        else formData.append("front", fileFront, "id-front.jpg");
      }
      if (fileBack) {
        if (typeof File !== "undefined" && fileBack instanceof File) formData.append("back", fileBack);
        else formData.append("back", fileBack, "id-back.jpg");
      }

      const isFileProtocol = window.location.protocol === "file:";
      const endpoint = isFileProtocol ? "http://localhost:3000/api/extract-id" : "/api/extract-id";

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData
      });

      if (response.ok) {
        const result = await response.json();
        
        // Handle rejected or non-Barangay ID
        if (result && result.isValidId === false) {
          console.warn("[Extractor Notice] Card rejected:", result.detectedType, result.message);
          return {
            isValidId: false,
            detectedType: result.detectedType || "Different ID / Non-Barangay Document",
            message: result.message || "The scanned card is not an official Barangay ID card.",
            isAiExtracted: Boolean(result.isAiExtracted)
          };
        }

        if (result && result.success && result.data) {
          if (result.fallback && result.apiError) {
            console.warn("[Extractor Notice]", result.apiError);
            if (typeof window.toast === "function") {
              if (result.apiError.includes("disabled") || result.apiError.includes("not been used")) {
                window.toast("Notice: Gemini API is disabled on your project. Using card template until enabled in Google Cloud Console.");
              } else {
                window.toast("Notice: Using card template reader (" + (result.message || "Template fallback") + ")");
              }
            }
          } else if (result.isAiExtracted && typeof window.toast === "function") {
            window.toast("Official Barangay ID verified with Gemini AI!");
          }
          if (onProgress) onProgress("Extraction complete!");
          return {
            ...result.data,
            isValidId: true,
            detectedType: result.detectedType || "Barangay Guadalupe Viejo Constituent ID"
          };
        }
      } else {
        const errJson = await response.json().catch(() => null);
        if (errJson && errJson.isValidId === false) {
          return {
            isValidId: false,
            detectedType: errJson.detectedType || "Different ID / Non-Barangay Document",
            message: errJson.message || "The scanned card is not an official Barangay ID card."
          };
        }
      }
    } catch (netErr) {
      console.warn("[Extractor] Backend server not reachable, checking client optical matcher:", netErr);
    }

    // 2. Client-side fallback template matcher & verification
    if (onProgress) onProgress("Verifying Barangay ID layout...");
    await new Promise((r) => setTimeout(r, 400));

    // Check if uploaded file is the official demo card or has a filename indicating sample
    const fileName = (file && file.name) ? file.name.toLowerCase() : "";
    const isKnownSample = fileName.includes("id-front") || fileName.includes("id-back") || fileName.includes("viejo-id") || !fileName;

    // Optional client-side OCR check via Tesseract.js if available and user uploaded a custom file
    if (!isKnownSample && window.Tesseract && typeof window.Tesseract.recognize === "function") {
      try {
        if (onProgress) onProgress("Running optical validation on card...");
        const ocr = await window.Tesseract.recognize(file, 'eng');
        const text = (ocr?.data?.text || "").toUpperCase();
        const hasGv = text.includes("GUADALUPE") || text.includes("VIEJO") || text.includes("GVCID") || text.includes("CONSTITUENT");
        const hasOtherId = text.includes("DRIVER") || text.includes("LICENSE") || text.includes("PASSPORT") || text.includes("PHILHEALTH") || text.includes("POSTAL") || text.includes("STUDENT") || text.includes("PRC") || text.includes("UMID") || text.includes("SSS");

        if (!hasGv || hasOtherId) {
          let detected = "Different ID / Non-Barangay Document";
          if (text.includes("DRIVER")) detected = "Driver's License";
          else if (text.includes("PASSPORT")) detected = "Philippine Passport";
          else if (text.includes("PHILHEALTH")) detected = "PhilHealth ID";
          else if (text.includes("POSTAL")) detected = "Postal ID";
          else if (text.includes("STUDENT") || text.includes("SCHOOL")) detected = "Student ID";
          else if (text.includes("UMID") || text.includes("SSS")) detected = "UMID / SSS ID";

          return {
            isValidId: false,
            detectedType: detected,
            message: `The scanned document appears to be a ${detected}. E-Viejo requires an official Barangay Guadalupe Viejo Constituent ID card.`,
            isAiExtracted: false
          };
        }
      } catch (e) {
        console.warn("[Tesseract OCR Notice]", e);
      }
    }

    // Client-side fallback: Only if the user specifically loaded the official assets/id-front.jpg or assets/id-back.jpg
    const isExactAsset = fileName === "id-front.jpg" || fileName === "id-back.jpg" || fileName === "viejo-id.jpg";
    if (isExactAsset) {
      return {
        isValidId: true,
        detectedType: "Barangay Guadalupe Viejo Constituent ID",
        idNumber: CONSTITUENT_TEMPLATE.sampleId,
        firstName: CONSTITUENT_TEMPLATE.defaultGivenName,
        middleName: CONSTITUENT_TEMPLATE.defaultMiddleName,
        lastName: CONSTITUENT_TEMPLATE.defaultSurname,
        gender: "Male",
        birthDate: CONSTITUENT_TEMPLATE.defaultDob,
        civilStatus: "Married",
        address: CONSTITUENT_TEMPLATE.defaultAddress,
        street: CONSTITUENT_TEMPLATE.defaultStreet,
        emergencyName: CONSTITUENT_TEMPLATE.emergencyName,
        emergencyContact: CONSTITUENT_TEMPLATE.emergencyPhone,
        phone: CONSTITUENT_TEMPLATE.defaultPhone,
        email: CONSTITUENT_TEMPLATE.defaultEmail,
        isAiExtracted: false
      };
    }

    // Any other uploaded file or document is REJECTED
    return {
      isValidId: false,
      detectedType: "Different ID / Non-Barangay Document",
      message: "The ID you entered or scanned is not an official Barangay ID. Only the official Barangay Guadalupe Viejo Constituent ID is accepted.",
      isAiExtracted: false
    };
  }

  /**
   * Display the Invalid ID Reminder Pop-up Modal.
   */
  function showInvalidIdModal(opts = {}) {
    const detectedType = opts.detectedType || "Different ID / Non-Barangay Document";
    const message = opts.message || "That's not an official Barangay ID. Only the Barangay Guadalupe Viejo Constituent ID is accepted.";
    const onRetry = opts.onRetry;
    const onSwitchManual = opts.onSwitchManual;

    let modal = document.getElementById("invalidIdModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "invalidIdModal";
      modal.className = "modal";
      document.body.appendChild(modal);
    }

    // Always update the modal content to include official Front and Back ID sample references
    modal.innerHTML = `
      <div class="modal-card invalid-id-modal-card">
        <button class="modal-close" id="closeInvalidIdModal" type="button" aria-label="Close dialog">&times;</button>
        <div class="invalid-id-header">
          <div class="invalid-id-badge">OFFICIAL BARANGAY ID REQUIRED</div>
          <h2 id="invalidIdModalTitle">Invalid ID Card Scanned</h2>
          <p class="muted" style="margin:2px 0 0 0; font-size:13px;">Barangay Guadalupe Viejo, Makati City &bull; Constituent Portal</p>
        </div>
        
        <div class="invalid-id-alert-box">
          <div class="invalid-id-detected-row">
            <span class="detected-label">Detected Document:</span>
            <strong class="detected-value" id="invalidDocTypeName">${detectedType}</strong>
          </div>
          <div class="invalid-id-message-text" id="invalidDocReason">${message}</div>
        </div>

        <div class="invalid-id-reminder-box">
          <div class="reminder-title">Official Barangay ID Required</div>
          <p>The ID you scanned or uploaded is not an official Barangay ID. This system exclusively accepts the official <strong>Barangay Guadalupe Viejo Constituent ID Card</strong>. Other forms of ID (Driver's License, Passport, PhilSys National ID, SSS/UMID, PhilHealth, or IDs from other barangays) cannot be processed.</p>
        </div>

        <div class="invalid-id-actions">
          <button class="btn btn-primary full" id="invalidIdRetryBtn" type="button">Scan Official Barangay ID Again</button>
          <button class="btn btn-outline full" id="invalidIdManualBtn" type="button" style="margin-top:4px;">Register Without an ID Instead</button>
        </div>
      </div>
    `;

    // Populate dynamic texts
    const titleEl = modal.querySelector("#invalidIdModalTitle");
    const detectedEl = modal.querySelector("#invalidDocTypeName");
    const reasonEl = modal.querySelector("#invalidDocReason");
    const manualBtn = modal.querySelector("#invalidIdManualBtn");
    const retryBtn = modal.querySelector("#invalidIdRetryBtn");
    const closeBtn = modal.querySelector("#closeInvalidIdModal");

    if (detectedEl) detectedEl.textContent = detectedType;
    if (reasonEl) reasonEl.textContent = message;

    // Contextualize manual button label based on current page
    const isLoginPage = window.location.pathname.includes("login.html") || Boolean(document.getElementById("simulateLoginScan"));
    if (manualBtn) {
      if (isLoginPage) {
        manualBtn.innerHTML = "Login with Password Instead";
      } else {
        manualBtn.innerHTML = "Register Without an ID Instead";
      }
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    if (closeBtn) {
      closeBtn.onclick = closeModal;
    }

    if (retryBtn) {
      retryBtn.onclick = () => {
        closeModal();
        if (typeof onRetry === "function") onRetry();
      };
    }

    if (manualBtn) {
      manualBtn.onclick = () => {
        closeModal();
        if (typeof onSwitchManual === "function") onSwitchManual();
      };
    }

    modal.classList.remove("hidden");
  }

  /**
   * Auto-populate the editable registration review form (#scannedRegisterForm).
   */
  function populateScannedRegisterForm(data) {
    if (!data) return;

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
    const emergName = document.getElementById("scannedEmergencyName");
    const emergContact = document.getElementById("scannedEmergencyContact");
    const badgeName = document.getElementById("scannedResidentBadgeName");

    const finalId = data.idNumber || CONSTITUENT_TEMPLATE.sampleId;
    const finalFirst = data.firstName || CONSTITUENT_TEMPLATE.defaultGivenName;
    const finalMiddle = (data.middleName !== undefined && data.middleName !== null) ? data.middleName : "";
    const finalLast = data.lastName || CONSTITUENT_TEMPLATE.defaultSurname;
    const finalBirth = data.birthDate || CONSTITUENT_TEMPLATE.defaultDob;
    const finalGender = data.gender || "Male";
    const finalCivil = data.civilStatus || "Married";
    const finalAddr = data.address || CONSTITUENT_TEMPLATE.defaultAddress;
    const finalStreet = data.street || CONSTITUENT_TEMPLATE.defaultStreet;
    const finalEmergName = data.emergencyName || CONSTITUENT_TEMPLATE.emergencyName;
    const finalEmergPhone = data.emergencyContact || CONSTITUENT_TEMPLATE.emergencyPhone;

    if (idNo) idNo.value = finalId;
    if (fName) fName.value = finalFirst;
    if (mName) mName.value = finalMiddle;
    if (lName) lName.value = finalLast;
    if (bDate && finalBirth) bDate.value = finalBirth;

    if (genderSelect) {
      genderSelect.value = finalGender.toLowerCase().includes("female") ? "Female" : "Male";
    }

    if (civilSelect) {
      const c = finalCivil.toLowerCase();
      if (c.includes("single")) civilSelect.value = "Single";
      else if (c.includes("widow")) civilSelect.value = "Widowed";
      else if (c.includes("separat")) civilSelect.value = "Separated";
      else civilSelect.value = "Married";
    }

    if (streetInput && finalStreet) streetInput.value = finalStreet;
    if (addr && finalAddr) addr.value = finalAddr;
    if (mobile) mobile.value = data.phone || CONSTITUENT_TEMPLATE.defaultPhone;
    
    const emailNotice = document.getElementById("scannedEmailNotice");
    const emailBadge = document.getElementById("scannedEmailBadge");
    const userEmail = data.email || null;

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

    if (emergName && finalEmergName) emergName.value = finalEmergName;
    if (emergContact && finalEmergPhone) emergContact.value = finalEmergPhone;

    const displayFullName = `${finalFirst} ${finalLast}`.trim() || "Resident Constituent";
    if (badgeName) badgeName.textContent = `${displayFullName} (${finalId})`;
  }

  /**
   * Auto-populate the login form (#loginIdentifierInput).
   */
  function populateScannedLoginForm(data) {
    if (!data) return;

    const idInput = document.getElementById("loginIdentifierInput");
    const autoBadge = document.getElementById("idLoginAutoBadge");
    const scannedAlert = document.getElementById("loginIdScannedAlert");
    const scannedMeta = document.getElementById("loginScannedMeta");
    const scannedNameEl = document.getElementById("loginScannedName");
    const passInput = document.getElementById("loginPasswordInput");

    const idNumber = data.idNumber || CONSTITUENT_TEMPLATE.sampleId;
    const fullName = `${data.firstName || CONSTITUENT_TEMPLATE.defaultGivenName} ${data.lastName || CONSTITUENT_TEMPLATE.defaultSurname}`.trim();

    if (idInput) idInput.value = idNumber;
    if (autoBadge) autoBadge.style.display = "inline-block";
    if (scannedAlert) scannedAlert.classList.remove("hidden");
    if (scannedNameEl) scannedNameEl.textContent = `ID Scanned: ${fullName}`;
    if (scannedMeta) scannedMeta.textContent = `ID: ${idNumber} • Auto-filled into login input. Enter your password below.`;

    if (passInput) passInput.focus();
  }

  /**
   * Set up live image preview listeners on file upload elements.
   */
  function setupImagePreviews() {
    function hook(inputId, previewImgId, guideTextId, isBack = false) {
      const input = document.getElementById(inputId);
      const preview = document.getElementById(previewImgId);
      const guide = document.getElementById(guideTextId);
      if (!input || !preview) return;

      input.addEventListener("change", () => {
        if (input.files && input.files[0]) {
          const file = input.files[0];
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUrl = e.target.result;
            preview.src = dataUrl;
            preview.classList.remove("hidden");
            if (guide) guide.textContent = `Uploaded ${isBack ? "BACK" : "FRONT"}: ${file.name}.`;

            // If on register page, update step pills and thumbnail progress slots
            if (inputId === "registerUploadFront") {
              const thumbFront = document.getElementById("thumbImgFront");
              const slotFront = document.getElementById("thumbSlotFront");
              const textFront = document.getElementById("thumbTextFront");
              const pillFront = document.getElementById("scanPillFront");
              const statusFront = document.getElementById("frontPillStatus");
              const pillBack = document.getElementById("scanPillBack");
              const statusBack = document.getElementById("backPillStatus");
              const slotBack = document.getElementById("thumbSlotBack");
              const statusIndicator = document.getElementById("scannerStatusIndicatorText");

              if (thumbFront) {
                thumbFront.src = dataUrl;
                thumbFront.classList.remove("hidden");
              }
              if (textFront) textFront.classList.add("hidden");
              if (slotFront) slotFront.className = "thumb-slot captured";
              if (pillFront) {
                pillFront.className = "step-pill done";
                if (statusFront) statusFront.textContent = "Done";
              }

              // Check if back is not yet uploaded, prompt back upload
              const backInput = document.getElementById("registerUploadBack");
              if (!backInput || !backInput.files || !backInput.files[0]) {
                if (pillBack) {
                  pillBack.className = "step-pill active";
                  if (statusBack) statusBack.textContent = "Ready";
                }
                if (slotBack) slotBack.className = "thumb-slot active";
                if (statusIndicator) statusIndicator.textContent = "Front Uploaded • Now Upload Back ID";
              }
            } else if (inputId === "registerUploadBack") {
              const thumbBack = document.getElementById("thumbImgBack");
              const slotBack = document.getElementById("thumbSlotBack");
              const textBack = document.getElementById("thumbTextBack");
              const pillBack = document.getElementById("scanPillBack");
              const statusBack = document.getElementById("backPillStatus");
              const statusIndicator = document.getElementById("scannerStatusIndicatorText");

              if (thumbBack) {
                thumbBack.src = dataUrl;
                thumbBack.classList.remove("hidden");
              }
              if (textBack) textBack.classList.add("hidden");
              if (slotBack) slotBack.className = "thumb-slot captured";
              if (pillBack) {
                pillBack.className = "step-pill done";
                if (statusBack) statusBack.textContent = "Done";
              }
              if (statusIndicator) statusIndicator.textContent = "Front & Back Uploaded • Ready to Process";
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }

    hook("registerUploadFront", "registerUploadedPreview", "registerScannerGuideText", false);
    hook("registerUploadBack", "registerUploadedPreview", "registerScannerGuideText", true);
    hook("loginUploadFront", "loginUploadedPreview", "loginScannerGuideText", false);
    hook("loginUploadBack", "loginUploadedPreview", "loginScannerGuideText", true);

    // Bind "View Official Sample Barangay ID" guide buttons
    const bindGuideBtn = (btnId) => {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.addEventListener("click", () => {
          showInvalidIdModal({
            detectedType: "Official Barangay ID Sample Reference",
            message: "Here is the official reference format for Barangay Guadalupe Viejo Constituent ID cards (Front & Back). Please ensure your scanned or uploaded ID matches this layout.",
            isReferenceGuide: true
          });
          const modalTitle = document.getElementById("invalidIdModalTitle");
          if (modalTitle) modalTitle.textContent = "Official Barangay ID Card Reference";
        });
      }
    };
    bindGuideBtn("btnViewSampleIdRegister");
    bindGuideBtn("btnViewSampleIdLogin");
  }

  // Export globally
  window.ConstituentExtractor = {
    template: CONSTITUENT_TEMPLATE,
    extractId,
    populateScannedRegisterForm,
    populateScannedLoginForm,
    setupImagePreviews,
    showInvalidIdModal
  };

  // Initialize previews when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupImagePreviews);
  } else {
    setupImagePreviews();
  }
})();

