require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory file upload storage (RAM buffer - no leftover temp files)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per image
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS Middleware (allows local file previews to talk to backend API)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve static project files
app.use(express.static(path.join(__dirname)));

// Reference template data for Barangay Guadalupe Viejo Constituent ID
const GV_CONSTITUENT_REFERENCE = {
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

// Extraction Endpoint
app.post('/api/extract-id', upload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 }
]), async (req, res) => {
  try {
    const frontFile = req.files?.front?.[0];
    const backFile = req.files?.back?.[0];

    if (!frontFile && !backFile) {
      return res.status(400).json({
        success: false,
        message: "No ID image was provided. Please upload front and/or back image."
      });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[Extraction] No GEMINI_API_KEY set in .env. Rejection response sent.");
      return res.json({
        success: false,
        isValidId: false,
        detectedType: "Unverified Document",
        message: "That's not an official Barangay ID. Only the Barangay Guadalupe Viejo Constituent ID is accepted."
      });
    }

    // Prepare parts for Gemini Multimodal API
    const parts = [];
    const promptText = `You are an expert official document validator and structured data extractor for the official Barangay Guadalupe Viejo Constituent Identification Card (City of Makati, Metro Manila, Philippines).

Analyze the provided ID card image(s) (front and/or back).

STEP 1: DOCUMENT VALIDATION & CLASSIFICATION (CRITICAL)
Determine whether this document is an official Barangay ID (specifically Barangay Guadalupe Viejo Constituent ID or Makati Barangay ID).
- Look for markers: "Barangay Guadalupe Viejo", "Constituent ID", "City of Makati", "GVCID", official barangay seal/logo, or Philippine barangay credentials.
- If the image is a DIFFERENT ID (e.g. Driver's License, Philippine Passport, PhilSys National ID, SSS/UMID, PhilHealth, Postal ID, PRC ID, Voter's ID, Student/School ID, Company ID, an ID from another barangay/city, a receipt, or a random photo):
  - Set "isBarangayId": false
  - Set "documentType" to the specific document detected (e.g. "Driver's License", "Philippine Passport", "National ID (PhilSys)", "UMID", "PhilHealth ID", "Student ID", "ID from Another Barangay", or "Unrecognized Non-ID Document").
  - Set "rejectionReason" to a clear message: "The scanned document appears to be a [documentType]. E-Viejo requires an official Barangay Guadalupe Viejo Constituent ID card."
- If the image IS an official Barangay ID / Barangay Guadalupe Viejo Constituent ID:
  - Set "isBarangayId": true
  - Set "documentType": "Barangay Guadalupe Viejo Constituent ID"
  - Set "rejectionReason": null

STEP 2: EXTRACT CONSTITUENT DATA (if valid)
Front Layout Reference:
- Constituent's ID No. (e.g. GVCID-2025-02-0996)
- SURNAME (Surname / Last Name - e.g. "DELA CRUZ")
- GIVEN NAME (First Name / Given Name - including two-word or compound second names like "JUAN CARLOS", "MARY ANNE", "JOSE LUIS". Do NOT put the second given name into middleName!)
- MIDDLE NAME (Middle Name / Maternal Surname - e.g. "SANTOS". If only an initial like "S." is present or none, extract accordingly.)
- SEX (Male or Female)
- DATE OF BIRTH (Format: YYYY-MM-DD)
- CIVIL STATUS (Single, Married, Widowed, Separated)
- ADDRESS (Full residential address in Guadalupe Viejo, Makati City)

Name Parsing Rules:
- "firstName" must contain the complete given name (e.g., if the person's given name has a first and second name like "John Paul" or "Maria Theresa", BOTH words belong in "firstName").
- "middleName" must ONLY contain the middle name / mother's maiden surname (or middle initial), NEVER the second part of a compound given name.
- "lastName" must contain the surname / family name.

Back Layout Reference:
- IN CASE OF EMERGENCY / ACCIDENT, PLEASE NOTIFY:
  - NAME (Emergency Contact Person)
  - ADDRESS
  - CONTACT NO. (e.g. 8470-0081 or phone number)

Street Recognition:
Identify the street inside Guadalupe Viejo from the address (e.g. Gumamela Street, Camia Street, P. Burgos Street, Progreso Street, Coronado Street, San Jose Street, San Nicolas Street, Viejo Ville, etc.).

Note: Physical constituent ID cards do NOT contain an email address. Always return "email": null.

Return ONLY a valid JSON object conforming exactly to this structure (no markdown fences, no explanation):
{
  "isBarangayId": true,
  "documentType": "Barangay Guadalupe Viejo Constituent ID",
  "rejectionReason": null,
  "idNumber": "string",
  "lastName": "string",
  "firstName": "string",
  "middleName": "string",
  "gender": "Male | Female",
  "birthDate": "YYYY-MM-DD",
  "civilStatus": "Single | Married | Widowed | Separated",
  "address": "string",
  "street": "string",
  "emergencyName": "string",
  "emergencyContact": "string",
  "email": null
}`;

    parts.push({ text: promptText });

    if (frontFile) {
      parts.push({
        inlineData: {
          mimeType: frontFile.mimetype || "image/jpeg",
          data: frontFile.buffer.toString('base64')
        }
      });
    }

    if (backFile) {
      parts.push({
        inlineData: {
          mimeType: backFile.mimetype || "image/jpeg",
          data: backFile.buffer.toString('base64')
        }
      });
    }

    let parsedData = null;
    let geminiError = null;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const candidateModels = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.8-flash'];
      let response;
      for (const m of candidateModels) {
        try {
          response = await ai.models.generateContent({
            model: m,
            contents: [{ role: 'user', parts }],
            config: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            }
          });
          if (response?.text) {
            console.log(`[Gemini Extraction] Model ${m} successfully processed card.`);
            break;
          }
        } catch (mErr) {
          geminiError = mErr.message || String(mErr);
        }
      }

      const responseText = response?.text;
      if (responseText) {
        const cleanJsonStr = responseText.replace(/^```json/gi, "").replace(/```$/g, "").trim();
        parsedData = JSON.parse(cleanJsonStr);
      }
    } catch (apiErr) {
      geminiError = apiErr.message || String(apiErr);
      console.warn("[Gemini API Warning]", geminiError);
    }

    // If Gemini verified the card as NOT a Barangay ID
    if (parsedData && parsedData.isBarangayId === false) {
      console.warn(`[Extraction Rejected] Non-Barangay ID detected: ${parsedData.documentType}`);
      return res.json({
        success: false,
        isValidId: false,
        detectedType: parsedData.documentType || "Different ID / Non-Barangay Document",
        message: parsedData.rejectionReason || "The scanned card is not an official Barangay ID card.",
        isAiExtracted: true
      });
    }

    // If Gemini succeeded and confirmed it is a Barangay ID
    if (parsedData && (parsedData.isBarangayId === true || (parsedData.idNumber && parsedData.lastName))) {
      return res.json({
        success: true,
        isValidId: true,
        detectedType: parsedData.documentType || "Barangay Guadalupe Viejo Constituent ID",
        data: {
          idNumber: parsedData.idNumber || "",
          firstName: parsedData.firstName || "",
          middleName: parsedData.middleName || "",
          lastName: parsedData.lastName || "",
          gender: parsedData.gender || "Male",
          birthDate: parsedData.birthDate || "",
          civilStatus: parsedData.civilStatus || "Single",
          address: parsedData.address || "",
          street: parsedData.street || "",
          emergencyName: parsedData.emergencyName || "",
          emergencyContact: parsedData.emergencyContact || "",
          phone: parsedData.phone || "",
          email: null,
          isAiExtracted: true
        }
      });
    }

    // If Gemini was unable to verify the card as an official Barangay ID: STRICT REJECTION
    return res.json({
      success: false,
      isValidId: false,
      detectedType: "Unverified / Non-Barangay Document",
      message: "That's not an official Barangay ID. The scanned document could not be verified as an official Barangay Guadalupe Viejo Constituent ID.",
      apiError: geminiError
    });
  } catch (err) {
    console.error("[Server Extraction Error]", err);
    res.status(500).json({
      success: false,
      message: "Internal server error during ID extraction",
      error: err.message
    });
  }
});

// Status check
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    portal: 'Barangay Guadalupe Viejo (E-Viejo)',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY)
  });
});

// Start Server (runs locally; on Vercel it runs as a serverless function)
if (!process.env.VERCEL && require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(` 🇵🇭 E-Viejo Barangay Portal & Extraction Server`);
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(` Gemini Vision AI Key configured: ${process.env.GEMINI_API_KEY ? 'YES' : 'NO'}`);
    console.log(`====================================================`);
  });
}

module.exports = app;

