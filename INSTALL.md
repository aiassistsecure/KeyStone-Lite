# Keystone Lite Installation Guide

## Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **AiAS API Key** - Required for AI features. Get one at [aiassist.net](https://aiassist.net)

### Platform-Specific Requirements (for building from source, not for release binaries)

**Windows:**
- Windows 10 or later
- Visual Studio Build Tools (for native modules)

**macOS:**
- macOS 10.15 (Catalina) or later
- Xcode Command Line Tools: `xcode-select --install`

**Linux:**
- Ubuntu 18.04+ / Debian 10+ / Fedora 32+
- Required packages: `sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0 libsecret-1-0`

---

## Option 1: Install Pre-Built Release

Download the latest release for your platform:

| Platform | File |
|----------|------|
| Windows | `Keystone-Lite-Setup-x.x.x.exe` |
Other platforms: coming soon!

### Windows Installation
1. Download the `.exe` installer
2. Run the installer
3. Follow the setup wizard
4. Launch from Start Menu or Desktop shortcut

### macOS Installation
1. Download the `.dmg` file
2. Open the DMG
3. Drag Keystone Lite to Applications
4. First launch: Right-click → Open (to bypass Gatekeeper)

### Linux Installation

**Debian/Ubuntu:**
```bash
sudo dpkg -i keystone-lite_x.x.x_amd64.deb
sudo apt-get install -f  # Install dependencies if needed
```

**Fedora/RHEL:**
```bash
sudo rpm -i keystone-lite-x.x.x.x86_64.rpm
```

**AppImage:**
```bash
chmod +x Keystone-Lite-x.x.x.AppImage
./Keystone-Lite-x.x.x.AppImage
```

---

## Option 2: Build from Source

### 1. Clone the Repository

```bash
git clone https://github.com/aiassistsecure/keystone-lite.git
cd keystone-lite
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Development Mode

Run in development with hot-reload:

```bash
# Terminal 1: Start the renderer (Vite)
npm run dev

# Terminal 2: Start Electron
npm start
```

### 4. Build for Distribution

**Build for your current platform:**
```bash
npm run dist
```

**Build for all platforms** (requires each platform's toolchain):
```bash
npm run dist:all
```

**Build for specific platforms:**
```bash
# Windows
npm run dist -- --win

# macOS
npm run dist -- --mac

# Linux
npm run dist -- --linux
```

Built files appear in the `dist/` folder.

---

## First Run Setup

1. **Launch Keystone Lite**
2. **Enter your AiAS API Key**
   - Get a key at [aiassist.net](https://aiassist.net)
   - The key starts with `aai_`
3. **Choose to save the key** (optional - stored securely on your machine)
4. **Select a default model** (optional)
5. **Start coding!**

---

## Configuration

### API Key Storage

Keys are stored securely using Electron's `safeStorage` API when available, falling back to encrypted local storage.

Location varies by platform:
- **Windows:** `%APPDATA%/keystone-lite/`
- **macOS:** `~/Library/Application Support/keystone-lite/`
- **Linux:** `~/.config/keystone-lite/`

---

## Troubleshooting

### "API Key Invalid"
- Ensure your key starts with `aai_`
- Check your subscription is active at aiassist.net
- Verify network connectivity

### "Cannot connect to API"
- Check firewall settings
- Try a different network
- For custom endpoints, verify the server is running

### macOS: "App is damaged"
This is a Gatekeeper warning. Fix with:
```bash
xattr -cr /Applications/Keystone\ Lite.app
```

### Linux: Missing libraries
Install required dependencies:
```bash
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6
```

---

## Uninstallation

**Windows:** Use Add/Remove Programs or run the uninstaller

**macOS:** Drag from Applications to Trash

**Linux:**
```bash
# Debian/Ubuntu
sudo apt remove keystone-lite

# Fedora/RHEL
sudo rpm -e keystone-lite

# AppImage: just delete the file
```

To remove configuration:
```bash
# macOS/Linux
rm -rf ~/.config/keystone-lite

# Windows (PowerShell)
Remove-Item -Recurse "$env:APPDATA\keystone-lite"
```

---

## Support

- **Issues:** GitHub Issues
- **API Support:** dev@interchained.org
