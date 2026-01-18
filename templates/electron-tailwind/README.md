# Electron + Tailwind + TypeScript Template

A minimal Electron desktop app with Tailwind CSS and TypeScript.

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Package for distribution
npm run package
```

## Project Structure

```
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # App entry point
│   │   └── preload.ts  # Preload script (context bridge)
│   └── renderer/       # Frontend (Chromium)
│       ├── index.html  # Main HTML
│       ├── style.css   # Tailwind CSS entry
│       └── app.ts      # Renderer scripts
├── dist/               # Compiled output
├── release/            # Packaged apps
└── package.json
```

## Customization

### Colors
Edit `tailwind.config.js` to customize the color palette:

```js
theme: {
  extend: {
    colors: {
      primary: { ... }
    }
  }
}
```

### Window Options
Edit `src/main/index.ts` to change window size, frame style, etc.

### CSP
Content Security Policy is set in `src/renderer/index.html`. Update if you need external resources.

## Building

```bash
# Windows
npm run package  # Creates .exe installer

# macOS
npm run package  # Creates .dmg

# Linux
npm run package  # Creates AppImage
```

## License

MIT
