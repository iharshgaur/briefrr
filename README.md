# Briefrr — Chrome Extension

Instantly understand any webpage — get highlights or in-depth explanations powered by Google Gemini AI.

## Features

- **Highlights Mode** — Key points in 30 seconds (5-7 bullet point summary)
- **Explain Mode** — Detailed, educational breakdown of page content
- **Streaming Responses** — See the AI response appear in real-time
- **Side Drawer** — Clean panel slides in from the right, doesn't disrupt the page
- **Shadow DOM Isolation** — Drawer styling never clashes with host page CSS
- **Smart Content Extraction** — Uses Mozilla Readability with a fallback for dynamic pages

## Setup

### 1. Load the Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `briefrr/` folder

### 2. Get a Free API Key

1. The onboarding page will open automatically after installation
2. Follow the link to get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
3. Paste the key into the onboarding page and click **Verify & Save**

### 3. Use Briefrr

1. Navigate to any webpage
2. Click the **Briefrr** icon in your toolbar
3. Choose **Highlights** or **Explain**
4. A panel slides in from the right with your AI-generated summary

## File Structure

```
briefrr/
├── manifest.json              # Manifest V3 configuration
├── background.js              # Service worker (install handler, message broker)
├── content.js                 # Content script (drawer, streaming, markdown)
├── content.css                # Host-page styles for drawer container
├── popup.html/js/css          # Extension popup (mode selector)
├── onboarding.html/js/css     # First-time setup wizard
├── options.html/js/css        # Settings / API key management
├── libs/
│   └── Readability.js         # Content extraction library
├── utils/
│   ├── gemini-api.js          # Gemini API streaming integration
│   ├── content-extractor.js   # Readability-based extraction
│   └── storage.js             # Chrome storage helpers
└── icons/                     # Extension icons (16–128px)
```

## Tech Stack

- **Manifest V3** Chrome Extension
- **Vanilla JavaScript** — no build tools or frameworks
- **Gemini 2.5 Flash-Lite** — fast, free-tier compatible model (15 RPM, 1000 RPD)
- **Shadow DOM** — fully isolated drawer UI
- **SSE Streaming** — real-time response display

## Version

1.0.0

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2026 Harsh Gaur
