# E-Viejo Test Automation

Playwright end-to-end and API tests for:

**Barangay Guadalupe Viejo — E-Viejo Digital Resident Services Portal**

The suite covers public pages, authentication, registration UI, resident services, complaint/request forms, responsive navigation, and backend API validation.

## 1. Put these files in your project

Copy:

- `playwright.config.js`
- `package.json`
- `tests/`

into the root of your `website-test` repository.

## 2. Install

From the `website-test` folder:

```bash
npm install
npx playwright install chromium
```

If your existing `package.json` already contains the E-Viejo dependencies, add `@playwright/test` instead of replacing your package file.

## 3. Run the tests

```bash
npm test
```

The Playwright config starts your existing Express server automatically with:

```bash
npm start
```

Your existing server listens on port 3000 by default.

## Useful commands

Run with the browser visible:

```bash
npm run test:headed
```

Run only the smoke/auth tests:

```bash
npm run test:smoke
```

Run resident tests:

```bash
npm run test:resident
```

Run API tests:

```bash
npm run test:api
```

Open the HTML report:

```bash
npm run report
```

## Test coverage

### Public
- Homepage loads
- Page title
- Main navigation
- Login/Register navigation
- Service-card destinations
- Announcements and officials sections
- Mobile menu

### Authentication
- Login page
- Required login fields
- Invalid login
- Forgot password message
- Password visibility
- Registration method selection
- Manual registration
- Required registration fields
- ID scanner screen
- Privacy consent behavior
- Admin login page
- Required admin login fields

### Resident portal
- Dashboard
- Sidebar navigation
- Digital ID display
- Six document services
- Barangay Clearance request modal
- Required request fields
- Request cancellation
- Complaint modal
- Required complaint fields
- Complaint cancellation
- Mobile sidebar

### API
- `/api/status`
- `/api/extract-id` validation when no image is provided

## Important

The tests intentionally do **not** create a real resident account or submit a real complaint/request by default. Those actions change application data and can make repeated automated runs unreliable.

For real login testing, use dedicated test credentials through environment variables rather than hard-coding a password into the test files.
