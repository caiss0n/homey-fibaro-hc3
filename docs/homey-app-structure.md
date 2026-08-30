# Homey App Structure

Based on the official Homey Apps SDK documentation.

## 📁 Basic Folder Structure

```
com.yourcompany.appname/
├── .homeycompose/          # Source configs (used to generate app.json)
│   ├── app.json            # Main app configuration
│   └── ...                 # Other compose files
├── assets/                 # App-level icons and images
│   ├── icon.svg            # App icon
│   └── images/             # Marketing images (small.png, large.png, xlarge.png)
├── drivers/                # Device drivers
│   └── my_driver/          # Each driver has its own folder
│       ├── assets/         # Driver-specific icons/images
│       │   ├── icon.svg
│       │   └── images/     # small.png, large.png, xlarge.png
│       ├── device.js       # Device class logic
│       └── driver.js       # Driver class (pairing flow)
├── locales/                # Translations
│   ├── en.json
│   └── nl.json
├── settings/               # App settings UI
│   └── index.html          # Custom settings page
├── api.js                  # REST API endpoints for the app
├── app.js                  # Main App class (entry point)
├── app.json                # Generated manifest (DO NOT edit manually!)
├── env.json                # Environment variables/secrets
└── README.txt              # Documentation
```

## 🔑 Key Components

### 1. App Manifest (`/.homeycompose/app.json`)

- Defines what your app does, its capabilities, permissions, etc.
- The root `app.json` is auto-generated via "Homey Compose" from `.homeycompose/` files
- **Never edit the generated `app.json` directly** — always edit source files in `.homeycompose/`

### 2. App Class (`app.js` / `app.mts` / `app.py`)

- Instantiated once when the app starts
- Shared logic across your entire app
- Accessible from drivers/devices via `this.homey.app`

**JavaScript Example:**

```javascript
const Homey = require('homey');

class App extends Homey.App {
    async onInit() {
        // Initialize shared resources once
        this.client = new ApiClient();
    }
}

module.exports = App;
```

**TypeScript (ESM) Example:**

```typescript
import Homey from 'homey';
import ApiClient from 'your-external-api-client';

export default class App extends Homey.App {
    client?: ApiClient;

    async onInit(): Promise<void> {
        // create an ApiClient once when the app is started
        this.client = new ApiClient();
    }
}
```

**Python Example:**

```python
from homey import app
from your_external_api_client import ApiClient

class App(app.App):
    client: ApiClient

    async def on_init(self) -> None:
        # create an ApiClient once when the app is started
        self.client = ApiClient()

homey_export = App
```

### 3. Drivers & Devices

Each driver handles a type of device (e.g., "light", "sensor").

- `driver.js` — Handles pairing/discovery flow
- `device.js` — Handles individual device logic and capabilities

**Device Example:**

```javascript
const Homey = require('homey');

class Device extends Homey.Device {
    async onInit() {
        // Access shared app resources
        const data = await this.homey.app.client.getData();
    }
}

module.exports = Device;
```

**TypeScript Device Example:**

```typescript
import Homey from 'homey';
import type App from '../../app.mjs';

export default class Device extends Homey.Device {
    async onInit(): Promise<void> {
        // access the ApiClient through the App instance
        const data = await (this.homey.app as App).client?.getData();
    }
}
```

**Python Device Example:**

```python
from typing import cast
from homey import device
from ...app import App

class Device(device.Device):
    async def on_init(self) -> None:
        data = await cast(App, self.homey.app).client.get_data()

homey_export = Device
```

### 4. Environment Variables (`env.json`)

- Stores secrets like API keys, client IDs/secrets
- Accessed via `Homey.env.VARIABLE_NAME` (JS/TS) or `Homey.env.get("VARIABLE")` (Python)

**Example:**

```json
{
    "CLIENT_ID": "12345abcde",
    "CLIENT_SECRET": "secret-value"
}
```

**Accessing in code:**

JavaScript:
```javascript
const Homey = require('homey');
const CLIENT_ID = Homey.env.CLIENT_ID;
```

TypeScript:
```typescript
import Homey from 'homey';
const CLIENT_ID = Homey.env.CLIENT_ID;
```

Python:
```python
from homey.homey import Homey
CLIENT_ID = Homey.env.get("CLIENT_ID")
```

### 5. Locales (`locales/`)

- JSON files for translations (en.json, nl.json, etc.)
- Used throughout the app UI and flows

### 6. Settings Page (`settings/index.html`)

- Custom HTML page for user-configurable settings

### 7. API Endpoints (`api.js` / `api.mts` / `api.py`)

- Define REST API endpoints exposed by your app

## 🛠 Supported Wireless Technologies

Homey apps can use one or more of:

- Wi-Fi
- Bluetooth LE
- Z-Wave
- Zigbee
- 433 MHz
- Infrared
- Matter

Most apps use only one wireless technology, but it's possible to combine them.

## 💡 Key Concepts

1. **Language Support**: Apps can be written in JavaScript (CommonJS or ESM), TypeScript, or Python
2. **Homey Compose**: Generates the final `app.json` from `.homeycompose/` source files with templating support
3. **Shared State**: The App class is a singleton shared across all drivers and devices via `this.homey.app`

## 📚 References

- Official Documentation: https://apps.developer.homey.app/the-basics/app
- Homey Apps SDK Reference: https://apps.developer.homey.app/
