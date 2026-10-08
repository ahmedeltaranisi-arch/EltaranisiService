# Eltaranisi Service+ — interactive preview

A responsive, bilingual (Arabic RTL / English LTR) front-end preview based on the attached product brief. It uses local HTML, CSS, and JavaScript with no external assets or dependencies.

## What works in this preview

- Arabic/English language toggle and light/dark theme.
- Responsive navigation and command palette (`Ctrl/Cmd + K`).
- Drag-and-drop or local file selection, file name/type/size display, local image preview, and a short local text preview.
- Interactive tool/plan dialogs and FAQ disclosures.
- Files are never uploaded by this UI preview.

## Important scope note

This is a **front-end preview**, not the production document platform. Authentication, cloud storage, OCR, conversion, AI, subscriptions, background jobs, and team features are not connected. The tool dialogs explicitly say so; no simulated processing result is presented as real. A production launch will need the backend, storage, queue, document-processing engines, and security architecture described in the product brief.

## Run locally

Requires Node.js 18 or newer; there are no npm dependencies.

```bash
npm run dev
```

Open `http://localhost:4173`.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In Vercel, choose **Add New → Project** and import that repository.
3. Select **Other** (static files) if asked for a framework. Leave Build Command and Install Command blank; set the output directory to `.` if prompted.
4. Deploy. The site is a static front-end and needs no environment variables.

`vercel.json` is included. This preview can also be served from GitHub Pages as static files.
