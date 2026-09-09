# Original Project Plan (archive)

Converted from `mobile build.odt` (uploaded 2026-09-10). This is the
original FrogPaper desktop-to-mobile conversion plan. Progress against it
is tracked in `docs/PLAN_STATUS.md`.

## Complete Breakdown: FrogPaper Desktop to Mobile App Conversion

### Phase 1: Architecture & Planning (2-3 weeks)

**1.1 Technology Stack Selection**
- Frontend Framework: React Native (cross-platform iOS/Android)
- Backend Option A: REST API with Node.js/Express
- Backend Option B: Python Flask/FastAPI (reuse existing logic)
- Database: SQLite (mobile) + optional cloud sync
- Image Processing: React Native image processing libraries
- State Management: Redux Toolkit or Zustand
- Navigation: React Navigation

**1.2 Mobile-Feature Analysis**

What needs to change:
- Windows wallpaper integration -> Use mobile wallpaper APIs
- System tray -> Background services/notifications
- File system structure -> Mobile storage permissions
- Tkinter UI -> React Native components
- Desktop keyboard shortcuts -> Touch gestures
- Windows-specific APIs -> Cross-platform alternatives

What stays the same:
- AI provider integrations (API calls work identically)
- Prompt building logic
- Gallery management concepts
- Database structure (SQLite works on mobile)
- Style transfer algorithms (need mobile implementation)

**1.3 Project Structure Design**

```
FrogPaperMobile/
|-- backend/      # API server (Python or Node.js)
|-- mobile-app/   # React Native app
|   `-- src/
|       |-- screens/       # UI screens
|       |-- components/    # Reusable components
|       |-- services/      # API calls, storage
|       |-- utils/         # Helper functions
|       `-- navigation/    # Navigation setup
|-- shared/       # Shared types/interfaces
`-- docs/         # API documentation
```

### Phase 2: Backend API Development (4-6 weeks)

**2.1 Core API Endpoints**

Image Generation:
- POST /api/generate - Generate image with prompt
- GET /api/providers - List available AI providers
- POST /api/providers/config - Configure provider credentials

Gallery Management:
- GET /api/gallery - List all images
- POST /api/gallery/upload - Upload custom images
- DELETE /api/gallery/:id - Delete image
- GET /api/gallery/:id - Get image details

Image Processing:
- POST /api/images/:id/style - Apply style transfer
- POST /api/images/:id/text - Add text overlay
- GET /api/images/:id/download - Download processed image

Slideshow:
- GET /api/slideshow/config - Get slideshow settings
- POST /api/slideshow/config - Update slideshow settings
- POST /api/slideshow/next - Get next wallpaper

Tags & Organization:
- GET /api/tags - List all tags
- POST /api/images/:id/tags - Add tags to image
- DELETE /api/images/:id/tags/:tag - Remove tag

**2.2 Extract Core Business Logic** - wallpaper_generator, prompt_builder,
style_transfer, slideshow, gallery_manager -> API services.

**2.3 Database Schema Migration** - keep SQLite structure, add mobile
indexes, implement cloud sync.

**2.4 Authentication & Security** - API key management, OAuth, rate
limiting, input validation.

### Phase 3: Mobile App Development (8-12 weeks)

- 3.1 Core screens: Home, Generate, Gallery, Image Detail, Settings,
  Slideshow
- 3.2 Prompt Builder UI (pickers, presets, negative prompts)
- 3.3 Gallery (lazy grid, pull-to-refresh, pinch-zoom, swipes, long-press)
- 3.4 Generation UI (progress + cancel, background jobs, history, batch)
- 3.5 Style transfer mobile implementation (react-native-image-filter-kit)
- 3.6 Text overlay mobile UI (drag, fonts, colors, live preview)
- 3.7 Slideshow mobile features (background service, notifications,
  lock screen, battery)

### Phase 4: Mobile-Specific Features (3-4 weeks)

- 4.1 Wallpaper integration (Android WallpaperManager; iOS save-to-gallery)
- 4.2 Storage management (permissions, cache, SD card, usage monitoring)
- 4.3 Background services (background generation, slideshow timer, sync)
- 4.4 Offline support (local cache, call queue, offline gallery)

### Phase 5: Cloud Integration (2-3 weeks)

- 5.1 Cloud storage APIs (Google Drive, OneDrive, Dropbox, OAuth)
- 5.2 Sync mechanisms (conflict resolution, scheduling, bandwidth)

### Phase 6: Testing & QA (3-4 weeks)

- 6.1 Device/OS/performance/network/accessibility testing
- 6.2 Automated tests (unit, API integration, UI, E2E)
- 6.3 Beta programs (TestFlight, Play Beta, crash reporting)

### Phase 7: Deployment & Maintenance (2-3 weeks)

- 7.1 App store submissions (assets, privacy policy, compliance)
- 7.2 Backend deployment (cloud hosting, DB, CDN, monitoring)
- 7.3 Post-launch support

**Original estimates:** 24-35 weeks total (6-9 months) with 1 backend dev,
1-2 mobile devs, part-time designer/QA/DevOps; $50k-150k build cost.
